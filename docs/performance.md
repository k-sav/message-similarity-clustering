# Performance Guide

Optimization strategies for scaling similarity clustering.

## Current Performance (POC)

Benchmarks from local development environment:

| Operation | Latency (p95) | Throughput | Notes |
|-----------|---------------|------------|-------|
| Generate embedding | 1.2s | 1 msg/s | OpenAI API call (blocking) |
| Trigram similarity check | 5ms | N/A | PostgreSQL GIST index |
| Vector similarity search | 25ms | N/A | HNSW index, 10K messages |
| Vector similarity search | 100ms | N/A | HNSW index, 1M messages |
| List clusters query | 15ms | N/A | With proper indexes |
| Get cluster detail | 20ms | N/A | Single cluster with messages |
| Action cluster mutation | 30ms | N/A | Single transaction |
| Remove message mutation | 25ms | N/A | Single transaction |

**Bottleneck:** OpenAI API calls (1-3 seconds per embedding).

---

## Optimization Strategies

### 1. Async Embedding Generation

**Problem:** `IngestMessage` blocks for 1-3s waiting for OpenAI.

**Solution:** Queue messages for background processing.

```typescript
// messages.service.ts
async ingestMessage(input: IngestMessageInput): Promise<IngestResult> {
  // Store message immediately
  const messageId = await this.storeMessage(input);
  
  // Queue for embedding generation (non-blocking)
  await this.embeddingQueue.add('generate', { messageId, text: input.text });
  
  return { messageId, clusterId: null, status: 'pending' };
}

// embedding.processor.ts (separate worker)
@Processor('embedding')
export class EmbeddingProcessor {
  @Process('generate')
  async handleGenerate(job: Job) {
    const { messageId, text } = job.data;
    
    // Generate embedding
    const embedding = await this.openai.embeddings.create({ ... });
    
    // Update message
    await this.db.query(`UPDATE messages SET embedding = $1 WHERE id = $2`, [embedding, messageId]);
    
    // Cluster asynchronously
    await this.clusteringService.findOrCreateCluster(messageId);
  }
}
```

**Benefits:**
- API responds in <50ms
- Background workers scale horizontally
- Failed embeddings can retry

**Trade-off:** Clustering is no longer synchronous (acceptable for most use cases).

---

### 2. Batch Embedding Generation

**Problem:** One API call per message is slow and expensive.

**Solution:** Batch 10-50 messages per API call.

```typescript
async generateEmbeddings(texts: string[]): Promise<number[][]> {
  const response = await this.openai.embeddings.create({
    input: texts,  // Up to 2048 texts
    model: 'text-embedding-3-small'
  });
  
  return response.data.map(d => d.embedding);
}

// Usage in queue processor
const pendingMessages = await this.getPendingMessages(50);
const embeddings = await this.generateEmbeddings(pendingMessages.map(m => m.text));

await Promise.all(
  pendingMessages.map((msg, i) => 
    this.db.query(`UPDATE messages SET embedding = $1 WHERE id = $2`, [embeddings[i], msg.id])
  )
);
```

**Benefits:**
- 10-50x throughput improvement
- Same cost per message
- Lower API rate limit pressure

---

### 3. Embedding Caching

**Problem:** Identical messages generate duplicate embeddings.

**Solution:** Cache embeddings by text hash.

```typescript
async generateEmbedding(text: string): Promise<number[]> {
  // Normalize and hash
  const normalized = text.toLowerCase().trim();
  const hash = crypto.createHash('sha256').update(normalized).digest('hex');
  const cacheKey = `emb:${hash}`;
  
  // Check cache
  const cached = await this.redis.get(cacheKey);
  if (cached) {
    return JSON.parse(cached);
  }
  
  // Generate
  const embedding = await this.openai.embeddings.create({ input: text });
  
  // Cache for 30 days
  await this.redis.setex(cacheKey, 30 * 24 * 60 * 60, JSON.stringify(embedding));
  
  return embedding;
}
```

**Expected hit rate:** 30-50% for common questions like "How much?", "When available?", etc.

**Cost savings:** ~$30-50/day for 1M messages/day workload.

---

### 4. Database Query Optimization

#### List Clusters Query

**Before (N+1 problem):**
```typescript
const clusters = await this.db.query(`SELECT * FROM clusters WHERE creator_id = $1`);
for (const cluster of clusters) {
  cluster.messages = await this.db.query(`SELECT * FROM messages WHERE cluster_id = $1`, [cluster.id]);
}
```

**After (single query with JOINs):**
```typescript
const clusters = await this.db.query(`
  SELECT 
    c.*,
    json_agg(json_build_object('id', m.id, 'text', m.text)) as messages
  FROM clusters c
  LEFT JOIN cluster_messages cm ON c.id = cm.cluster_id
  LEFT JOIN messages m ON cm.message_id = m.id
  WHERE c.creator_id = $1
  GROUP BY c.id
`);
```

**Performance:** 500ms → 15ms for 100 clusters.

---

#### Vector Search Optimization

**Important:** Use the distance operator in ORDER BY for index usage:

```sql
-- ✅ GOOD: Uses HNSW index
SELECT * FROM messages
ORDER BY embedding <=> $1::vector
LIMIT 10;

-- ❌ BAD: Full table scan
SELECT *, (1 - (embedding <=> $1::vector)) as sim
FROM messages
WHERE (1 - (embedding <=> $1::vector)) > 0.4
ORDER BY sim DESC;
```

**Always check with EXPLAIN ANALYZE:**
```sql
EXPLAIN ANALYZE
SELECT * FROM messages
ORDER BY embedding <=> '[0.1, 0.2, ...]'::vector
LIMIT 10;
```

Look for: `Index Scan using idx_messages_embedding`

---

### 5. Connection Pooling

**Problem:** Each request creates a new database connection.

**Solution:** Use connection pooling.

```typescript
// db.module.ts
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  min: 5,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000
});
```

**Tuning:**
- **min**: Keep warm connections (reduces latency)
- **max**: Prevent connection exhaustion (tune based on DB limits)
- **idleTimeoutMillis**: Close unused connections (reduces DB load)

**PostgreSQL side:**
```sql
-- Check connection count
SELECT count(*) FROM pg_stat_activity;

-- Max connections (tune in postgresql.conf)
SHOW max_connections;  -- Default: 100
```

---

### 6. Redis Caching for Queries

**Problem:** Same queries run repeatedly (e.g., list clusters every 5s).

**Solution:** Cache query results.

```typescript
async listClusters(creatorId: string): Promise<Cluster[]> {
  const cacheKey = `clusters:${creatorId}`;
  
  // Check cache
  const cached = await this.redis.get(cacheKey);
  if (cached) {
    return JSON.parse(cached);
  }
  
  // Query DB
  const clusters = await this.db.query(`SELECT ...`);
  
  // Cache for 10 seconds
  await this.redis.setex(cacheKey, 10, JSON.stringify(clusters));
  
  return clusters;
}

// Invalidate on mutation
async actionCluster(id: string, responseText: string) {
  const cluster = await this.db.query(`UPDATE clusters ...`);
  
  // Invalidate cache
  await this.redis.del(`clusters:${cluster.creator_id}`);
  
  return cluster;
}
```

**Benefits:**
- Reduces DB load by 80%+
- Faster response times (1ms vs 15ms)
- Stale data limited to 10 seconds (acceptable)

---

### 7. HNSW Index Tuning

**For 10K-100K messages:**
```sql
CREATE INDEX idx_messages_embedding 
ON messages USING hnsw (embedding vector_cosine_ops) 
WITH (m = 16, ef_construction = 64);
```

**For 100K-1M messages:**
```sql
CREATE INDEX idx_messages_embedding 
ON messages USING hnsw (embedding vector_cosine_ops) 
WITH (m = 24, ef_construction = 128);
```

**For 1M+ messages:**
```sql
CREATE INDEX idx_messages_embedding 
ON messages USING hnsw (embedding vector_cosine_ops) 
WITH (m = 32, ef_construction = 200);
```

**Query-time tuning:**
```sql
SET hnsw.ef_search = 100;  -- Higher = better recall, slower (default: 40)
```

**Trade-offs:**

| Parameter | Higher Value | Lower Value |
|-----------|--------------|-------------|
| `m` | Better recall, more memory | Less memory, lower recall |
| `ef_construction` | Better index quality, slower build | Faster build, lower quality |
| `ef_search` | Better recall, slower query | Faster query, lower recall |

---

### 8. Horizontal Scaling

#### API Servers

**Load balancer:**
```
nginx → api-1, api-2, api-3
```

**State considerations:**
- ✅ GraphQL API is stateless (scales perfectly)
- ⚠️ Embedding queue requires shared Redis
- ⚠️ Database connections limited (use pooler like PgBouncer)

#### Background Workers

Scale embedding processors independently:

```bash
# docker-compose.yml
services:
  embedding-worker:
    image: similarity-api
    command: npm run worker:embedding
    replicas: 5  # Scale based on queue depth
```

---

### 9. Database Read Replicas

**For high read volume (>1000 queries/sec):**

```
Write: api → primary DB
Read: api → read replica 1, read replica 2
```

**Implementation:**
```typescript
// db.module.ts
const primaryPool = new Pool({ connectionString: PRIMARY_URL });
const replicaPool = new Pool({ connectionString: REPLICA_URL });

async listClusters() {
  return replicaPool.query(`SELECT ...`);  // Read from replica
}

async actionCluster() {
  return primaryPool.query(`UPDATE ...`);  // Write to primary
}
```

**Replication lag:** Typically 10-100ms (acceptable for this use case).

---

### 10. CDN for Avatars

**Problem:** Frontend loads avatar images from pravatar.cc (slow, no caching).

**Solution:** Proxy through CDN (Cloudflare, CloudFront).

```typescript
// When storing message
const avatarUrl = input.rawPayload.user.image;
const cdnUrl = `https://cdn.example.com/avatars/${hash(avatarUrl)}`;

// Store CDN URL instead of original
await this.db.query(`UPDATE messages SET visitor_avatar_url = $1`, [cdnUrl]);
```

**Benefits:**
- 200ms → 10ms load time
- Reduces third-party dependency
- Better privacy (no external requests)

---

## Performance Monitoring

### Key Metrics

**API:**
- Request latency (p50, p95, p99)
- Error rate (should be <1%)
- Requests per second

**Database:**
- Connection pool utilization (should be <80%)
- Query latency (should be <100ms p95)
- Slow queries (>1s)

**OpenAI:**
- Embedding generation latency
- API error rate
- Daily cost

**Queue:**
- Job processing time
- Queue depth (should be <1000)
- Failed job rate

---

### Logging Slow Operations

```typescript
import { Logger } from '@nestjs/common';

const logger = new Logger('Performance');

async someOperation() {
  const start = performance.now();
  
  // ... operation ...
  
  const duration = performance.now() - start;
  if (duration > 100) {  // Log if >100ms
    logger.warn(`Slow operation: ${duration}ms`);
  }
}
```

---

### Database Query Analysis

```sql
-- Enable pg_stat_statements
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- Find slow queries
SELECT 
  substring(query, 1, 50) as query,
  calls,
  ROUND(mean_exec_time::numeric, 2) as avg_ms,
  ROUND(total_exec_time::numeric, 2) as total_ms
FROM pg_stat_statements
ORDER BY mean_exec_time DESC
LIMIT 10;

-- Reset stats
SELECT pg_stat_statements_reset();
```

---

## Load Testing

### Basic Load Test

```bash
npm install -g artillery

# artillery.yml
config:
  target: 'http://localhost:3000'
  phases:
    - duration: 60
      arrivalRate: 10  # 10 requests/sec

scenarios:
  - name: 'Ingest messages'
    flow:
      - post:
          url: '/graphql'
          json:
            query: 'mutation { ingestMessage(...) { messageId } }'
```

Run:
```bash
artillery run artillery.yml
```

---

### Expected Throughput

| Configuration | Ingest (msg/s) | List Clusters (req/s) |
|---------------|----------------|----------------------|
| 1 API server, sync embedding | 1 | 100 |
| 1 API server, async embedding | 200 | 100 |
| 3 API servers, async, caching | 1000 | 1000 |
| 10 API servers, read replicas | 5000 | 10000 |

---

## Cost Optimization

### OpenAI API

**Current cost:** $0.0001 per message

**Optimizations:**
1. **Caching:** 30-50% reduction → **$0.00005-0.00007/message**
2. **Deduplication:** Skip messages with identical text → **5-10% additional reduction**
3. **Batch processing:** Same cost, but better throughput

**1M messages/day:**
- Without optimization: **$100/day**
- With caching: **$50-70/day**
- With caching + dedup: **$45-65/day**

---

### Database Storage

**Current:** ~6KB per message (1536 floats)

**1M messages:**
- Storage: ~6GB
- Index overhead: ~2GB
- Total: ~8GB

**PostgreSQL pricing (AWS RDS):**
- db.t4g.medium (2 vCPU, 4GB RAM): ~$60/month
- 10GB storage: ~$1.15/month
- **Total: ~$61/month for 1M messages**

**Optimization:** Archive old messages (>90 days) to S3.

---

### Compute Costs

**API servers (AWS ECS Fargate):**
- 0.5 vCPU, 1GB RAM: ~$15/month per instance
- 3 instances: **~$45/month**

**Workers:**
- 0.5 vCPU, 1GB RAM: ~$15/month per instance
- 2 instances: **~$30/month**

**Total compute: ~$75/month for 1M messages/day**

---

## Summary

### Quick Wins (Immediate)

1. ✅ **HNSW index** - Already implemented
2. **Connection pooling** - 5 min setup
3. **Redis caching for list queries** - 1 hour

**Expected improvement:** 3-5x query performance

---

### Medium Effort (1-2 weeks)

4. **Async embedding generation** - Queue infrastructure
5. **Batch embedding** - Refactor embedding service
6. **Embedding caching** - Redis integration

**Expected improvement:** 10-50x ingestion throughput

---

### Long Term (Production)

7. **Read replicas** - Database setup
8. **Horizontal scaling** - Load balancer, orchestration
9. **CDN for avatars** - Infrastructure setup
10. **Monitoring and alerting** - Observability stack

**Expected improvement:** Scale to 10M+ messages/day
