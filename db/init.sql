CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'cluster_status') THEN
    CREATE TYPE cluster_status AS ENUM ('open', 'actioned');
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_message_id text NOT NULL,
  creator_id text NOT NULL,
  channel_id text NOT NULL,
  channel_cid text,
  visitor_user_id text,
  visitor_username text,
  text text NOT NULL,
  html text,
  message_type text,
  embedding vector(1536) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  replied_at timestamptz,
  is_paid_dm boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS clusters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id text NOT NULL,
  status cluster_status NOT NULL DEFAULT 'open',
  response_text text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cluster_messages (
  cluster_id uuid NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  excluded_at timestamptz,
  PRIMARY KEY (cluster_id, message_id),
  UNIQUE (message_id)
);

CREATE INDEX IF NOT EXISTS idx_messages_creator ON messages (creator_id);
CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages (channel_id);
CREATE INDEX IF NOT EXISTS idx_messages_replied ON messages (replied_at);
CREATE INDEX IF NOT EXISTS idx_clusters_creator ON clusters (creator_id);
CREATE INDEX IF NOT EXISTS idx_clusters_status ON clusters (status);
CREATE INDEX IF NOT EXISTS idx_cluster_messages_cluster ON cluster_messages (cluster_id);
CREATE INDEX IF NOT EXISTS idx_messages_embedding ON messages USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
