CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(255) NOT NULL
);

CREATE TABLE events (
    id SERIAL PRIMARY KEY,
    channel VARCHAR(255) NOT NULL,
    event_type VARCHAR(255) NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_events_channel_id ON events (channel, id);

CREATE TABLE user_subscriptions (
    user_id INTEGER NOT NULL REFERENCES users(id),
    channel VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, channel)
);

-- Seed users
INSERT INTO users (id, username) VALUES 
(1, 'user1'), 
(2, 'user2');

-- Reset sequence to avoid conflicts on future inserts, just in case
SELECT setval('users_id_seq', (SELECT MAX(id) FROM users));

-- Seed subscriptions
INSERT INTO user_subscriptions (user_id, channel) VALUES 
(1, 'alerts'),
(1, 'test-channel'),
(2, 'notifications');
