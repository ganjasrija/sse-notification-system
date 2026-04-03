# SSE Notification System

This project is a real-time notification backend service using Server-Sent Events (SSE). It demonstrates how to manage persistent connections, push data continuously over an HTTP connection, persist events using PostgreSQL, and efficiently handle reconnection by replaying missed events based on `Last-Event-ID`.

## Architecture Overview

The system runs via two Docker containers:
1. **app**: A Node.js application (Express.js) which handles HTTP and SSE requests. It keeps track of live clients in memory.
2. **db**: A PostgreSQL 13 database utilized both for storing event history and managing user channel subscriptions.

### Features
- **Publish mechanism**: Clients can publish an event (data+type) to a specific channel.
- **Subscription system**: Users can subscribe and unsubscribe to specific channels. 
- **Real-Time Streaming**: Users listen to one or more channels and receive `text/event-stream` payloads upon publication. Only requested channels to which the user is actively subscribed are streamed.
- **Replay**: A robust mechanism to prevent data loss. If a client drops and reconnects with a `Last-Event-ID` HTTP Header, the system automatically fetches past messages that occurred since that ID and streams them to the user.
- **Heartbeat**: To keep load balancers from dropping long-lived connections, a `: heartbeat` comment line is sent every 30 seconds.

## Setup Instructions

1. Ensure [Docker](https://docs.docker.com/get-docker/) and [Docker Compose](https://docs.docker.com/compose/install/) are installed on your machine.
2. Clone this repository locally.
3. Simply execute:
   ```bash
   docker-compose up --build
   ```
4. Wait approximately 10-30 seconds. Docker will initialize the database schema and automatically run the `seeds/` scripts to populate the database with two users (ID 1 and 2). Once both services show as `"healthy"`, you're good to go!

## Running and Testing the Endpoints

### 1. Subscription Management

Subscribe user 1 to the `alerts` channel:
```bash
curl -X POST http://localhost:8080/api/events/channels/subscribe \
  -H "Content-Type: application/json" \
  -d '{"userId": 1, "channel": "alerts"}'
```

Unsubscribe user 1 from `alerts`:
```bash
curl -X POST http://localhost:8080/api/events/channels/unsubscribe \
  -H "Content-Type: application/json" \
  -d '{"userId": 1, "channel": "alerts"}'
```

### 2. Streaming (Listening for Events)

You can open a terminal and run the following command to subscribe. Note the `--no-buffer` flag which is essential for text/event-stream viewing in cURL. Assume user `1` is subscribed to `alerts`:
```bash
curl --no-buffer "http://localhost:8080/api/events/stream?userId=1&channels=alerts"
```
The connection will hang, awaiting incoming data and `: heartbeat` logs.

### 3. Publishing Events

Open a separate terminal and publish an event to the `alerts` channel:
```bash
curl -X POST http://localhost:8080/api/events/publish \
  -H "Content-Type: application/json" \
  -d '{"channel": "alerts", "eventType": "USER_NOTIFICATION", "payload": {"message": "Hello World!"}}'
```
You should see it arrive seamlessly on the stream client outputting:
```text
id: 1
event: USER_NOTIFICATION
data: {"message":"Hello World!"}
```

### 4. Event Replay using Last-Event-ID Validation

Assume that client disconnected at event ID `1`. Now, someone publishes a new event into `alerts`, increasing the sequence to `2`. 
To request the missed events and resume receiving new real-time messages, simply reconnect with the `Last-Event-ID` header:

```bash
curl --no-buffer -H "Last-Event-ID: 1" "http://localhost:8080/api/events/stream?userId=1&channels=alerts"
```
The server will immediately reply with event ID `2` before maintaining the open channel for real-time traffic.

### 5. Fetch Event History

You can query paginated historical events on any channel:
```bash
curl "http://localhost:8080/api/events/history?channel=alerts&limit=5"
```
Use the `afterId` parameter to paginate:
```bash
curl "http://localhost:8080/api/events/history?channel=alerts&limit=5&afterId=100"
```
