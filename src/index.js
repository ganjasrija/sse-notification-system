const express = require('express');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
app.use(express.json());

const port = process.env.PORT || 8080;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

// Array to store active connected SSE clients
// Format: { userId, channels: [], res }
let clients = [];

// Endpoint: GET /health
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// Periodic Heartbeat every 30 seconds
setInterval(() => {
  for (const client of clients) {
    client.res.write(': heartbeat\n\n');
  }
}, 30000);

// Endpoint: POST /api/events/publish
app.post('/api/events/publish', async (req, res) => {
  const { channel, eventType, payload } = req.body;
  if (!channel || !eventType || !payload) {
    return res.status(400).json({ error: 'Missing required fields: channel, eventType, payload' });
  }

  try {
    const result = await pool.query(
      'INSERT INTO events (channel, event_type, payload) VALUES ($1, $2, $3) RETURNING *',
      [channel, eventType, payload]
    );

    const event = result.rows[0];

    console.log(`Event published: ${eventType} to channel ${channel}`);

    // Push to active subscribers
    for (const client of clients) {
      if (client.channels.includes(channel)) {
        client.res.write(`event: ${eventType}\n`);
        client.res.write(`data: ${JSON.stringify(payload)}\n\n`);
        console.log(`Event sent to client: ${client.userId}`);
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Endpoint: POST /api/events/channels/subscribe
app.post('/api/events/channels/subscribe', async (req, res) => {
  const { userId, channel } = req.body;
  
  if (userId == null || !channel) {
      return res.status(400).json({ error: 'userId and channel are required' });
  }

  try {
    // Upsert user if needed to fulfill foreign key references just in case the provided testing user isn't seeded
    await pool.query(
      'INSERT INTO users (id, username) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING',
      [userId, `user_${userId}`]
    );

    await pool.query(
      'INSERT INTO user_subscriptions (user_id, channel) VALUES ($1, $2) ON CONFLICT (user_id, channel) DO NOTHING',
      [userId, channel]
    );

    res.status(201).json({
      status: 'subscribed',
      userId,
      channel
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Endpoint: POST /api/events/channels/unsubscribe
app.post('/api/events/channels/unsubscribe', async (req, res) => {
  const { userId, channel } = req.body;

  if (userId == null || !channel) {
      return res.status(400).json({ error: 'userId and channel are required' });
  }

  try {
    await pool.query(
      'DELETE FROM user_subscriptions WHERE user_id = $1 AND channel = $2',
      [userId, channel]
    );

    res.status(200).json({
      status: 'unsubscribed',
      userId,
      channel
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Endpoint: GET /api/events/stream
app.get('/api/events/stream', async (req, res) => {
  const userId = parseInt(req.query.userId, 10);
  const rawChannels = req.query.channels;

  if (isNaN(userId) || !rawChannels) {
    return res.status(400).json({ error: 'valid userId and channels query parameters are required' });
  }

  const channelsArray = rawChannels
    ? String(rawChannels).split(',').map(c => c.trim()).filter(Boolean)
    : [];

  try {
    // Verify user is subscribed to these channels
    const result = await pool.query(
        'SELECT channel FROM user_subscriptions WHERE user_id = $1 AND channel = ANY($2)',
        [userId, channelsArray]
    );
    const subscribedChannels = result.rows.map(row => row.channel);

    // Only allow streaming for channels they are actually subscribed to
    const validChannels = channelsArray.filter(c => subscribedChannels.includes(c));

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    // Flush the headers right away
    if (res.flushHeaders) {
        res.flushHeaders();
    }

    const lastEventIdStr = req.headers['last-event-id'];
    const lastEventId = parseInt(lastEventIdStr, 10);

    if (lastEventIdStr && !isNaN(lastEventId) && validChannels.length > 0) {
        // Replay events
        const replayResult = await pool.query(
            'SELECT * FROM events WHERE channel = ANY($1) AND id > $2 ORDER BY id ASC',
            [validChannels, lastEventId]
        );

        for (const event of replayResult.rows) {
            const data = JSON.stringify(event.payload);
            res.write(`id: ${event.id}\n`);
            res.write(`event: ${event.event_type}\n`);
            res.write(`data: ${data}\n\n`);
        }
    }

    const clientObj = {
      userId,
      channels: channelsArray,
      res
    };

    clients.push(clientObj);
    console.log("Client connected:", userId, channelsArray);

    // Clean up on disconnect
    req.on('close', () => {
        console.log(`Client disconnected: userId=${userId}`);
        const index = clients.indexOf(clientObj);
        if (index !== -1) {
            clients.splice(index, 1);
        }
    });

  } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Internal server error' });
  }
});

// Endpoint: GET /api/events/history
app.get('/api/events/history', async (req, res) => {
  const channel = req.query.channel;
  const afterIdStr = req.query.afterId;
  const limit = parseInt(req.query.limit, 10) || 50;

  if (!channel) {
      return res.status(400).json({ error: 'channel is required' });
  }

  try {
      let query = '';
      let params = [];

      if (afterIdStr) {
          const afterId = parseInt(afterIdStr, 10);
          query = 'SELECT id, channel, event_type as "eventType", payload, created_at as "createdAt" FROM events WHERE channel = $1 AND id > $2 ORDER BY id ASC LIMIT $3';
          params = [channel, afterId, limit];
      } else {
          query = 'SELECT id, channel, event_type as "eventType", payload, created_at as "createdAt" FROM events WHERE channel = $1 ORDER BY id ASC LIMIT $2';
          params = [channel, limit];
      }

      const result = await pool.query(query, params);
      
      res.status(200).json({
          events: result.rows
      });
  } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Internal server error' });
  }
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
