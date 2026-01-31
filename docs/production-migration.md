# Production Migration Guide

Step-by-step guide for deploying message similarity clustering to your production application.

## Pre-Migration Checklist

### Infrastructure

- [ ] PostgreSQL 14+ with pgvector extension installed
- [ ] Redis cluster for caching (optional but recommended)
- [ ] OpenAI API key with sufficient quota
- [ ] Monitoring/alerting system configured
- [ ] Feature flag system (Statsig) access

### Capacity Planning

- [ ] Estimate daily message volume
- [ ] Calculate OpenAI API costs (volume × $0.0001)
- [ ] Plan database storage (1536 floats × message_count ≈ 6KB per message)
- [ ] Provision compute for embedding generation (1-3s per message)

---

## Phase 1: Shadow Mode (Weeks 1-2)

**Goal:** Deploy clustering backend without exposing to users. Validate accuracy.

### Step 1: Database Setup

```sql
-- Add pgvector extension (requires superuser)
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Create tables (run via migration tool)
-- Use schema from db/init.sql

-- Build HNSW index (can be slow on large tables)
CREATE INDEX CONCURRENTLY messages_embedding_hnsw_idx
ON messages USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);
```

**Note:** `CONCURRENTLY` prevents blocking production writes.

### Step 2: Deploy Backend Service

```typescript
// Add feature flag check before clustering
async ingestMessage(input: IngestMessageInput): Promise<IngestResult> {
  const isEnabled = await statsig.checkGate('soco_similarity_clustering');

  if (!isEnabled) {
    // Store message only, skip clustering
    return { messageId, clusterId: null };
  }

  // Existing clustering logic...
}
```

**Deploy:** Use canary deployment (5% → 25% → 100% of API servers).

### Step 3: Monitor and Tune

**Key metrics to watch:**

- Embedding generation latency (p50, p95, p99)
- Cluster formation rate (should be 5-15% of messages)
- OpenAI API error rate (should be <1%)
- Database query time for similarity search (should be <100ms)

**Log every cluster formation:**

```typescript
logger.info("Cluster formed", {
  clusterId,
  messageCount,
  avgSimilarity,
  threshold: SIMILARITY_THRESHOLD,
  matchType: "trigram" | "vector",
});
```

**Manual review (sample 50-100 clusters):**

- Are messages actually similar? (precision)
- Are obvious duplicates being missed? (recall)
- Adjust threshold based on findings

---

## Phase 2: Internal Beta (Weeks 3-4)

**Goal:** Show clustering UI to internal team and selected beta creators.

### Step 1: Deploy Frontend

```typescript
// Add feature flag check
const ClusterInbox = () => {
  const { getFlagFromWarehouseNative } = useFlagsFromDualInstances();
  const isEnabled = Boolean(getFlagFromWarehouseNative('soco_similarity_clustering'));

  if (!isEnabled) return null;

  return <ClusterListView />;
};
```

### Step 2: Select Beta Creators

Criteria:

- High message volume (>50 messages/week)
- Active engagement (replies >60% of messages)
- Opted into beta programs
- Mix of free and paid creators

**Statsig targeting:**

```typescript
statsig.overrideGate("soco_similarity_clustering", {
  userID: creatorId,
  custom: {
    messageVolume: "high",
    engagementRate: "high",
    betaOptin: true,
  },
});
```

### Step 3: Collect Feedback

**In-app survey after first cluster action:**

```
Q1: How similar were the messages in the cluster? (1-5)
Q2: Did this save you time? (Yes/No/Unsure)
Q3: Would you use this feature again? (1-5)
Q4: Any messages that shouldn't have been grouped? (Text input)
```

**Analyze:**

- Low similarity ratings → increase threshold
- High "shouldn't be grouped" → increase threshold
- High satisfaction + time saved → expand rollout

---

## Phase 3: Gradual Rollout (Weeks 5-8)

**Goal:** Roll out to increasing % of eligible creators.

### Week 5: 10% of high-volume creators

```typescript
statsig.checkGate("soco_similarity_clustering", {
  userID: creatorId,
  custom: {
    messageVolume: "high",
    rolloutPercent: 10,
  },
});
```

### Week 6: 50% of high-volume creators

Monitor for:

- Database load (query latency, connection pool saturation)
- OpenAI API quota (approaching rate limits?)
- Support tickets (confusion, bugs)

### Week 7: 100% of high-volume creators

### Week 8: Expand to medium-volume creators (20-50 messages/week)

---

## Phase 4: Full Production (Week 9+)

### Step 1: Remove Feature Flag

Once stable, remove gating and make clustering default behavior.

### Step 2: Backfill Historical Messages

```typescript
// Batch job: generate embeddings for existing messages
async function backfillEmbeddings() {
  const batchSize = 100;
  let offset = 0;

  while (true) {
    const messages = await db.query(
      `
      SELECT id, text 
      FROM messages 
      WHERE embedding IS NULL 
        AND created_at > now() - interval '90 days'
      LIMIT $1 OFFSET $2
    `,
      [batchSize, offset],
    );

    if (messages.rows.length === 0) break;

    // Batch embed
    const texts = messages.rows.map((m) => m.text);
    const embeddings = await openai.embeddings.create({
      input: texts,
      model: "text-embedding-3-small",
    });

    // Update in parallel
    await Promise.all(
      messages.rows.map((msg, i) =>
        db.query(
          `
        UPDATE messages SET embedding = $1 WHERE id = $2
      `,
          [toVectorLiteral(embeddings.data[i].embedding), msg.id],
        ),
      ),
    );

    offset += batchSize;
    await sleep(1000); // Rate limiting
  }
}
```

**Run during off-peak hours** (2am-6am UTC).

### Step 3: Monitor at Scale

**Alerts to configure:**

```yaml
# OpenAI API Issues
- Alert: "OpenAI embedding error rate > 5%"
  Action: Switch to stub provider temporarily

# Performance Degradation
- Alert: "Embedding generation p95 latency > 5s"
  Action: Scale up workers or enable caching

# Business Impact
- Alert: "Cluster formation rate < 3%"
  Action: Check if threshold is too high

- Alert: "Cluster action rate < 10%"
  Action: Might indicate poor clustering quality
```

### Step 4: Optimize Costs

**Embedding caching (30-50% cost reduction):**

```typescript
const textHash = sha256(normalizeText(messageText));
const cachedEmbedding = await redis.get(`emb:${textHash}`);

if (cachedEmbedding) {
  return JSON.parse(cachedEmbedding);
}

const embedding = await openai.embeddings.create(...);
await redis.setex(`emb:${textHash}`, 7 * 24 * 60 * 60, JSON.stringify(embedding));
```

**Batch processing (reduce API calls):**

```typescript
// Instead of 1 API call per message:
const embeddings = await openai.embeddings.create({
  input: [msg1.text, msg2.text, ...], // Up to 2048 texts
  model: 'text-embedding-3-small'
});
```

---

## Database Migration Strategy

### For Existing Large Tables

If your `messages` table already has millions of rows:

**Option A: Gradual Backfill (Recommended)**

```sql
-- Add column first (doesn't require table scan)
ALTER TABLE messages ADD COLUMN embedding vector(1536);

-- Build index after backfill completes (not during)
CREATE INDEX CONCURRENTLY messages_embedding_hnsw_idx ...;
```

**Option B: New Table (Zero Downtime)**

```sql
-- Create separate table for embeddings
CREATE TABLE message_embeddings (
  message_id uuid PRIMARY KEY REFERENCES messages(id),
  embedding vector(1536) NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Backfill incrementally
-- Join in queries: messages m LEFT JOIN message_embeddings me ON m.id = me.message_id
```

---

## Rollback Plan

### If clustering is causing issues:

**Step 1: Disable feature flag**

```typescript
statsig.shutdownGate("soco_similarity_clustering");
```

**Step 2: Drain in-flight operations**

```bash
# Wait for all pending embedding jobs to complete
# Monitor job queue depth → 0
```

**Step 3: (Optional) Remove schema**

```sql
DROP INDEX IF EXISTS messages_embedding_hnsw_idx;
ALTER TABLE messages DROP COLUMN IF EXISTS embedding;
DROP TABLE IF EXISTS cluster_messages;
DROP TABLE IF EXISTS clusters;
```

**Note:** Keep data for post-mortem analysis before dropping.

---

## Integration Points

### With StreamChat

```typescript
// Listen for new messages via webhook or stream
streamChat.on("message.new", async (event) => {
  if (event.message.user.id === creatorId) return; // Skip creator's own messages

  await graphqlClient.mutate({
    mutation: INGEST_MESSAGE,
    variables: {
      input: {
        creatorId: event.channel.data.createdBy.id,
        messageId: event.message.id,
        text: event.message.text,
        channelId: event.channel.id,
        channelCid: event.channel.cid,
        visitorUserId: event.user.id,
        visitorUsername: event.user.name,
        createdAt: event.message.created_at,
        isPaidDm: event.channel.data.isPaidDm || false,
        rawPayload: event.message,
      },
    },
  });
});
```

### With Existing Inbox UI

```typescript
// Add "Duplicates" tab to inbox navigation
<Tabs>
  <Tab label="All Messages" />
  <Tab label="Unread" />
  <Tab label="Duplicates" badge={clusterCount} /> {/* NEW */}
  <Tab label="Archived" />
</Tabs>

// When tab clicked, render ClusterList component
{activeTab === 'duplicates' && <ClusterInbox creatorId={creatorId} />}
```

### With Notifications

```typescript
// Send notification when cluster reaches 3+ messages
if (cluster.channelCount >= 3 && isNewCluster) {
  await notificationService.send({
    creatorId: cluster.creator_id,
    type: "cluster_formed",
    title: "3 similar messages detected",
    message: "You have similar messages waiting - reply to all at once",
    deepLink: `/inbox/clusters/${cluster.id}`,
  });
}
```

---

## Performance Benchmarks

Based on POC testing:

| Operation                | Latency (p95) | Notes                    |
| ------------------------ | ------------- | ------------------------ |
| Generate embedding       | 1.2s          | OpenAI API call          |
| Trigram similarity check | 5ms           | PostgreSQL               |
| Vector similarity search | 25ms          | HNSW index, 10K messages |
| Vector similarity search | 100ms         | HNSW index, 1M messages  |
| Cluster list query       | 15ms          | With proper indexes      |
| Action cluster mutation  | 30ms          | Single transaction       |

**Bottleneck:** OpenAI API calls. Consider async processing.

---

## Success Criteria

Define success metrics before rollout:

### Adoption

- [ ] 40%+ of eligible creators use feature within 30 days
- [ ] 60%+ of creators who try it use it again

### Efficiency

- [ ] Average time to reply reduces by 30%+
- [ ] Cluster action rate >15% (15% of clusters get replied to)

### Quality

- [ ] False positive rate <5% (messages incorrectly grouped)
- [ ] Creator satisfaction score >4/5
- [ ] Support tickets about clustering <1% of total

### Business Impact

- [ ] Creator retention +2% for users of feature
- [ ] Message reply rate +10%
- [ ] Creator NPS +5 points

---

## Common Issues

### High False Positive Rate

**Symptoms:** Messages incorrectly grouped together  
**Fix:** Increase `SIMILARITY_THRESHOLD` from 0.4 → 0.6  
**Deploy:** Via feature flag (no code change needed)

### High False Negative Rate

**Symptoms:** Obvious duplicates not clustering  
**Fix:** Decrease `SIMILARITY_THRESHOLD` or check embedding quality  
**Debug:** Log similarity scores for manual review

### Performance Degradation

**Symptoms:** Slow cluster queries (>500ms)  
**Fix:**

1. Check HNSW index exists: `\d+ messages` in psql
2. Increase connection pool size
3. Add Redis caching for cluster list queries

### OpenAI API Rate Limits

**Symptoms:** 429 errors from OpenAI  
**Fix:**

1. Implement exponential backoff
2. Queue messages for batch processing
3. Contact OpenAI for quota increase
4. Consider fallback to trigram-only matching

---

## Deployment Checklist

Before deploying to production:

**Day Before:**

- [ ] Run load test with 10x expected volume
- [ ] Review all logs from shadow mode
- [ ] Brief support team on new feature
- [ ] Prepare rollback script
- [ ] Set up real-time monitoring dashboard

**Deployment Day:**

- [ ] Deploy during low-traffic window
- [ ] Monitor error rates for first hour
- [ ] Check first 10 clusters manually
- [ ] Send announcement to beta group
- [ ] Keep team on standby for 2 hours post-deploy

**Day After:**

- [ ] Review overnight metrics
- [ ] Sample and review 50 clusters
- [ ] Collect initial user feedback
- [ ] Tune threshold if needed

---

## Scaling Guidelines

### 10K messages/day

- Single API server
- Standard PostgreSQL instance
- No special optimization needed

### 100K messages/day

- 3+ API servers (load balanced)
- Read replica for cluster queries
- Redis caching for embeddings
- Batch embedding generation (10-50 messages)

### 1M+ messages/day

- Dedicated embedding generation service
- PostgreSQL partitioning by creator_id
- Increase HNSW index parameters (m=32)
- Consider approximate nearest neighbor search
- CDN for avatar images

---

## Support Runbook

### "Clusters not forming"

1. Check similarity scores in database
2. Verify embeddings are being generated
3. Check if threshold is too high
4. Verify OpenAI API is responding

### "Messages incorrectly grouped"

1. Log the cluster ID and message IDs
2. Check actual similarity scores
3. If score > threshold, threshold is too low
4. Add to training set for threshold tuning

### "Performance is slow"

1. Check database query times
2. Verify HNSW index exists and is being used
3. Check OpenAI API latency
4. Review connection pool utilization

---

## Post-Launch

### Week 1-2: Monitor closely

- Daily metric review
- Quick threshold adjustments via feature flag
- Respond to creator feedback within 24h

### Week 3-4: Optimize

- Implement caching based on patterns
- Tune index parameters if needed
- Address any performance bottlenecks

### Month 2+: Enhance

- Add smart suggestions (see future-enhancements.md)
- Build analytics dashboard
- Implement auto-archive

---

## Risk Mitigation

| Risk                     | Impact | Mitigation                                  |
| ------------------------ | ------ | ------------------------------------------- |
| OpenAI API outage        | High   | Fallback to trigram-only matching           |
| High false positive rate | Medium | Quick threshold adjustment via feature flag |
| Database performance     | Medium | Read replicas, caching                      |
| Cost overrun             | Low    | Usage alerts, embedding caching             |
| Creator confusion        | Low    | In-app tutorial, good UX copy               |

---

## Success Story Template

After 30 days, measure impact:

```
Results from Similarity Clustering Beta:
- 1,247 creators used the feature
- 8,934 clusters actioned (avg 4.2 messages per cluster)
- Estimated time saved: 2,983 hours
- Creator satisfaction: 4.3/5
- 23% of creators added FAQ to their profile after seeing analytics
- Message reply rate increased from 62% → 71%
```

Use this data to justify full rollout and future enhancements.
