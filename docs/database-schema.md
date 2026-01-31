# Database Schema

PostgreSQL database structure with pgvector extension for similarity search.

## Extensions

```sql
CREATE EXTENSION IF NOT EXISTS vector;     -- Vector embeddings support
CREATE EXTENSION IF NOT EXISTS pg_trgm;    -- Trigram text similarity
CREATE EXTENSION IF NOT EXISTS "uuid-ossp"; -- UUID generation
```

---

## Tables

### messages

Stores all inbound messages with their embeddings.

```sql
CREATE TABLE messages (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  creator_id text NOT NULL,
  external_message_id text NOT NULL,
  text text NOT NULL,
  embedding vector(1536),  -- OpenAI text-embedding-3-small
  channel_id text NOT NULL,
  channel_cid text NOT NULL,
  visitor_user_id text NOT NULL,
  visitor_username text NOT NULL,
  is_paid_dm boolean NOT NULL DEFAULT false,
  raw_payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  
  UNIQUE (external_message_id)
);
```

**Key Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `id` | `uuid` | Internal message identifier (PK) |
| `creator_id` | `text` | Creator who received this message |
| `external_message_id` | `text` | StreamChat message ID (unique) |
| `text` | `text` | Message content for display and similarity |
| `embedding` | `vector(1536)` | Semantic embedding from OpenAI |
| `channel_id` | `text` | StreamChat channel ID (e.g., `channel-visitor-1`) |
| `channel_cid` | `text` | Full channel CID (e.g., `messaging:channel-visitor-1`) |
| `visitor_user_id` | `text` | Visitor's user ID |
| `visitor_username` | `text` | Visitor's display name |
| `is_paid_dm` | `boolean` | Whether message is from paid DM (excluded from clustering) |
| `raw_payload` | `jsonb` | Full StreamChat message object |
| `created_at` | `timestamptz` | Message timestamp |
| `updated_at` | `timestamptz` | Last modified timestamp |

**Indexes:**

```sql
-- Primary lookup by creator
CREATE INDEX idx_messages_creator ON messages (creator_id);

-- External ID lookup
CREATE UNIQUE INDEX idx_messages_external ON messages (external_message_id);

-- Channel lookup for supersede logic
CREATE INDEX idx_messages_channel ON messages (channel_id);

-- Text similarity (trigram for fast pre-filtering)
CREATE INDEX idx_messages_text_trgm ON messages USING gist (text gist_trgm_ops);

-- Vector similarity (HNSW for semantic search)
CREATE INDEX idx_messages_embedding ON messages 
  USING hnsw (embedding vector_cosine_ops) 
  WITH (m = 16, ef_construction = 64);
```

---

### clusters

Groups of similar messages.

```sql
CREATE TABLE clusters (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  creator_id text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'actioned')),
  response_text text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

**Key Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `id` | `uuid` | Cluster identifier (PK) |
| `creator_id` | `text` | Creator who owns this cluster |
| `status` | `text` | `open` (active) or `actioned` (replied) |
| `response_text` | `text` | Creator's bulk reply (null until actioned) |
| `created_at` | `timestamptz` | Cluster creation timestamp |
| `updated_at` | `timestamptz` | Last modified timestamp |

**Indexes:**

```sql
-- Primary lookup by creator and status
CREATE INDEX idx_clusters_creator_status ON clusters (creator_id, status);

-- Timestamp ordering for list views
CREATE INDEX idx_clusters_created ON clusters (created_at DESC);
```

---

### cluster_messages

Join table linking messages to clusters (many-to-one).

```sql
CREATE TABLE cluster_messages (
  cluster_id uuid NOT NULL REFERENCES clusters (id) ON DELETE CASCADE,
  message_id uuid NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  
  PRIMARY KEY (cluster_id, message_id),
  UNIQUE (message_id)  -- One message can only be in one cluster
);
```

**Key Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `cluster_id` | `uuid` | Foreign key to `clusters` |
| `message_id` | `uuid` | Foreign key to `messages` |
| `created_at` | `timestamptz` | When message was added to cluster |

**Indexes:**

```sql
-- Reverse lookup: find cluster for a message
CREATE INDEX idx_cluster_messages_message ON cluster_messages (message_id);

-- Lookup all messages in a cluster
CREATE INDEX idx_cluster_messages_cluster ON cluster_messages (cluster_id);
```

**Constraints:**

- **One message, one cluster**: The `UNIQUE (message_id)` constraint ensures no message can be in multiple clusters simultaneously.
- **Cascade delete**: If a cluster is deleted, all `cluster_messages` rows are auto-deleted. If a message is deleted, its cluster association is removed.

---

## Vector Index Details

### HNSW Index

**What it is:** Hierarchical Navigable Small World - a graph-based approximate nearest neighbor algorithm.

**Why we use it:** Best query performance for large datasets (>10K vectors).

**Parameters:**

```sql
CREATE INDEX idx_messages_embedding 
ON messages USING hnsw (embedding vector_cosine_ops) 
WITH (
  m = 16,                -- connections per layer (higher = better recall, more memory)
  ef_construction = 64   -- build-time accuracy (higher = better index, slower build)
);
```

**Tuning guidance:**

| Dataset Size | m | ef_construction | Build Time | Query Time | Memory |
|--------------|---|-----------------|------------|------------|--------|
| <10K msgs | 16 | 64 | Fast | ~20ms | Low |
| 10K-100K | 16 | 64 | Medium | ~30ms | Medium |
| 100K-1M | 24 | 128 | Slow | ~50ms | Medium |
| 1M+ | 32 | 200 | Very slow | ~100ms | High |

**Query-time tuning:**

```sql
SET hnsw.ef_search = 100;  -- Higher = better recall, slower query (default: 40)
```

### IVFFlat Alternative

If HNSW build time is too slow:

```sql
CREATE INDEX idx_messages_embedding 
ON messages USING ivfflat (embedding vector_cosine_ops) 
WITH (lists = 100);
```

**Trade-offs:**
- ✅ Faster index build
- ✅ Lower memory usage
- ❌ Slower queries (~2-3x slower than HNSW)
- ❌ Requires `VACUUM ANALYZE` after bulk inserts

---

## Similarity Search Queries

### Trigram Similarity (Text-based)

Fast pre-filtering for near-exact text matches.

```sql
SELECT 
  id, 
  text,
  similarity(text, 'How much do you charge?') as sim
FROM messages
WHERE text % 'How much do you charge?'  -- Trigram operator
  AND creator_id = $1
  AND is_paid_dm = false
ORDER BY sim DESC
LIMIT 10;
```

**Performance:** ~5ms for 100K messages (with GIST index)

**Threshold:** Default `pg_trgm.similarity_threshold = 0.3` (adjust via `SET` command)

---

### Vector Similarity (Semantic)

Semantic search using cosine distance.

```sql
SELECT 
  id, 
  text,
  (1 - (embedding <=> $1::vector)) as similarity  -- <=> is cosine distance
FROM messages
WHERE creator_id = $2
  AND embedding IS NOT NULL
  AND is_paid_dm = false
ORDER BY embedding <=> $1::vector  -- Use operator in ORDER BY for index usage
LIMIT 10;
```

**Performance:** ~25ms for 10K messages, ~100ms for 1M messages (with HNSW index)

**Distance operators:**

- `<=>` - Cosine distance (use this for text embeddings)
- `<->` - L2 distance (Euclidean)
- `<#>` - Inner product

**Important:** Always use the **operator in ORDER BY** for the index to be used!

---

## Common Queries

### Get cluster with UI fields

```sql
SELECT 
  c.id,
  c.status,
  c.response_text,
  COUNT(DISTINCT cm.message_id) as channel_count,
  (
    SELECT text 
    FROM messages m 
    JOIN cluster_messages cm2 ON m.id = cm2.message_id 
    WHERE cm2.cluster_id = c.id 
    LIMIT 1
  ) as preview_text,
  (
    SELECT visitor_username 
    FROM messages m 
    JOIN cluster_messages cm2 ON m.id = cm2.message_id 
    WHERE cm2.cluster_id = c.id 
    ORDER BY m.created_at ASC 
    LIMIT 1
  ) as representative_visitor,
  ARRAY(
    SELECT jsonb_extract_path_text(m.raw_payload, 'user', 'image')
    FROM messages m
    JOIN cluster_messages cm2 ON m.id = cm2.message_id
    WHERE cm2.cluster_id = c.id
    ORDER BY m.created_at ASC
    LIMIT 3
  ) as visitor_avatar_urls
FROM clusters c
LEFT JOIN cluster_messages cm ON c.id = cm.cluster_id
WHERE c.creator_id = $1
  AND c.status = $2
GROUP BY c.id
HAVING COUNT(DISTINCT cm.message_id) >= $3
ORDER BY c.created_at DESC;
```

### Find messages from same channel in cluster

```sql
SELECT m.id
FROM messages m
JOIN cluster_messages cm ON m.id = cm.message_id
WHERE cm.cluster_id = $1
  AND m.channel_id = $2;
```

Used for supersede logic (remove old message when new message arrives from same channel).

---

## Database Maintenance

### Vacuum for IVFFlat

If using IVFFlat index, run after bulk inserts:

```sql
VACUUM ANALYZE messages;
```

### Check Index Usage

```sql
SELECT 
  schemaname, 
  tablename, 
  indexname, 
  idx_scan as scans,
  idx_tup_read as tuples_read,
  idx_tup_fetch as tuples_fetched
FROM pg_stat_user_indexes
WHERE tablename IN ('messages', 'clusters', 'cluster_messages')
ORDER BY idx_scan DESC;
```

Look for indexes with `idx_scan = 0` (unused indexes).

### Check Table Sizes

```sql
SELECT 
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

**Expected sizes:**
- `messages`: ~6KB per message (1536 floats for embedding)
- `clusters`: ~1KB per cluster
- `cluster_messages`: ~100 bytes per link

---

## Backup and Restore

### Dump Schema Only

```bash
pg_dump -U postgres -d similarity_poc --schema-only > schema.sql
```

### Dump Data Only

```bash
pg_dump -U postgres -d similarity_poc --data-only > data.sql
```

### Restore

```bash
psql -U postgres -d similarity_poc < schema.sql
psql -U postgres -d similarity_poc < data.sql
```

**Note:** Vector indexes may need to be rebuilt after restore.

---

## Scaling Considerations

### Partitioning (for 1M+ messages)

Partition by `creator_id` for large multi-tenant deployments:

```sql
CREATE TABLE messages (
  -- columns...
) PARTITION BY HASH (creator_id);

CREATE TABLE messages_0 PARTITION OF messages FOR VALUES WITH (MODULUS 4, REMAINDER 0);
CREATE TABLE messages_1 PARTITION OF messages FOR VALUES WITH (MODULUS 4, REMAINDER 1);
CREATE TABLE messages_2 PARTITION OF messages FOR VALUES WITH (MODULUS 4, REMAINDER 2);
CREATE TABLE messages_3 PARTITION OF messages FOR VALUES WITH (MODULUS 4, REMAINDER 3);
```

### Read Replicas

For high read volume, use PostgreSQL streaming replication:
- Primary: Write operations (`IngestMessage`, `ActionCluster`)
- Replica: Read operations (`ListClusters`, `GetCluster`)

### Connection Pooling

Use PgBouncer or Supabase Pooler:

```
Application → PgBouncer (100 connections) → PostgreSQL (20 connections)
```

---

## Migration Strategy

For adding to existing database:

```sql
-- Step 1: Add vector extension (requires superuser)
CREATE EXTENSION IF NOT EXISTS vector;

-- Step 2: Create tables (run via migration tool)
-- ... (tables as defined above)

-- Step 3: Build indexes CONCURRENTLY (doesn't block writes)
CREATE INDEX CONCURRENTLY idx_messages_embedding 
ON messages USING hnsw (embedding vector_cosine_ops) 
WITH (m = 16, ef_construction = 64);

-- Step 4: Backfill embeddings for existing messages (async job)
-- See production-migration.md for details
```

---

## Troubleshooting

### Query not using vector index

**Symptoms:** Slow queries (>1s) on similarity search

**Check:**
```sql
EXPLAIN ANALYZE
SELECT * FROM messages
ORDER BY embedding <=> $1::vector
LIMIT 10;
```

**Look for:** `Index Scan using idx_messages_embedding`

**Fix:** Ensure you're using the operator in ORDER BY, not in SELECT or WHERE.

### HNSW index build is stuck

**Symptoms:** Index creation runs for hours

**Fix:** Lower `ef_construction` or switch to IVFFlat temporarily:

```sql
DROP INDEX IF EXISTS idx_messages_embedding;
CREATE INDEX idx_messages_embedding 
ON messages USING ivfflat (embedding vector_cosine_ops) 
WITH (lists = 100);
```

### Out of memory during index build

**Symptoms:** PostgreSQL crashes or OOM errors

**Fix:** Increase `maintenance_work_mem`:

```sql
SET maintenance_work_mem = '2GB';
CREATE INDEX ...;
```

Or build index on smaller batches.
