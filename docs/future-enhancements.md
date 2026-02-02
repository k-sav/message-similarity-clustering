# Future Enhancements

Quick wins to increase adoption and value from message similarity clustering.

## Status Legend

- ✅ **Implemented** - Feature is complete and working
- 🚧 **Planned** - Feature is in the roadmap
- 💡 **Idea** - Potential future enhancement

---

## 1. LLM-Generated Cluster Summaries (💡 Idea)

**Goal:** Replace basic preview text (earliest message) with AI-generated summaries that better represent cluster intent.

### Current State

```typescript
// Currently using earliest message as preview
SELECT m2.text FROM cluster_messages cm2
JOIN messages m2 ON m2.id = cm2.message_id
WHERE cm2.cluster_id = c.id
ORDER BY m2.created_at ASC
LIMIT 1
```

**Problems:**

- First message may not be representative of cluster theme
- Doesn't convey quantity ("3 people asking...")
- Less useful for UI previews

### Architecture

**Approach: Generation at cluster creation/update time** (not query time)

```
┌─────────────────────────────────────────────────────────────┐
│ clusters table (add column)                                  │
├─────────────────────────────────────────────────────────────┤
│ + summary_text: text (nullable)                              │
│   e.g. "3 people asking about collaboration pricing"        │
└─────────────────────────────────────────────────────────────┘
```

**Why creation time?**

- ✅ One-time LLM cost per cluster (~$0.0001)
- ✅ Fast queries (no latency)
- ✅ Cost-effective for frequently viewed clusters
- ❌ Needs regeneration when cluster changes

### Implementation Plan

**Phase 1: Add Summary Column**

```sql
ALTER TABLE clusters ADD COLUMN summary_text TEXT;
```

**Phase 2: Generate Summary on Cluster Events**

```typescript
async function generateClusterSummary(clusterId: string): Promise<string> {
  // Get sample messages from cluster (max 5 for context)
  const messages = await db.query(
    `
    SELECT m.text 
    FROM cluster_messages cm
    JOIN messages m ON m.id = cm.message_id
    WHERE cm.cluster_id = $1
    ORDER BY m.created_at ASC
    LIMIT 5
  `,
    [clusterId],
  );

  const channelCount = await getClusterChannelCount(clusterId);
  const messageTexts = messages.rows.map((r) => r.text).join("\n");

  const prompt = `Summarize this group of ${channelCount} similar customer messages in 5-8 words. Focus on the core question/intent.

Messages:
${messageTexts}

Example summaries:
- "3 people asking about collaboration pricing"
- "5 people requesting availability for next month"
- "4 people reporting broken download links"

Summary:`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.3,
    max_tokens: 20,
  });

  return response.choices[0].message.content?.trim() || null;
}

// Call during cluster lifecycle events
async function onClusterCreated(clusterId: string) {
  const summary = await generateClusterSummary(clusterId);
  await db.query(`UPDATE clusters SET summary_text = $1 WHERE id = $2`, [
    summary,
    clusterId,
  ]);
}

async function onMessageAddedToCluster(clusterId: string) {
  // Regenerate summary when cluster grows
  const summary = await generateClusterSummary(clusterId);
  await db.query(`UPDATE clusters SET summary_text = $1 WHERE id = $2`, [
    summary,
    clusterId,
  ]);
}
```

**Phase 3: Update GraphQL Schema**

```graphql
type Cluster {
  id: ID!
  status: ClusterStatus!
  channelCount: Int!
  previewText: String # Fallback: earliest message
  summaryText: String # AI-generated summary
  # Use summaryText in UI if available, else previewText
}
```

**Phase 4: Query Updates**

```typescript
// In listClusters/getCluster, add summary_text to SELECT
SELECT
  c.summary_text,
  c.preview_text,  -- Keep as fallback
  ...
```

### Cost Analysis

- **Per cluster:** 1 LLM call (~$0.0001 with gpt-4o-mini)
- **Regeneration:** Only when messages added/removed
- **Typical creator:** 10 clusters/day × $0.0001 = $0.001/day
- **Monthly (per creator):** ~$0.03/month

**ROI:** Better UX, clearer intent, minimal cost.

### Success Metrics

- % of clusters with AI summary vs fallback
- Time to understand cluster intent (user testing)
- Creator satisfaction with preview text

---

## 2. Smart Response Suggestions (✅ Implemented)

**Status:** Complete and working in POC. Ready for production port to ltfollowers.

**Goal:** Pre-fill the bulk reply input with suggested responses based on creator's past replies to similar questions.

### Implementation Summary

**Table Created:**

- `response_templates` table with vector embeddings
- HNSW index for fast similarity search
- Usage count tracking and last used timestamps

**Key Features:**

1. **Automatic template saving** - When a cluster is actioned, the response is saved as a template with the cluster's representative embedding
2. **Smart retrieval** - Uses vector similarity (>0.8 threshold) to find relevant past responses
3. **Ranking** - Orders by similarity, usage count, and recency
4. **Top 3 suggestions** - Returns the most relevant suggestions

**Code Reference:**

- Template saving: `clusters.service.ts` `actionCluster()` method (lines 213-244)
- Suggestion retrieval: `clusters.service.ts` `getSuggestedResponses()` method (lines 385-425)
- GraphQL integration: `clusters.resolver.ts` (lines 38-42)

### Success Metrics

- Template reuse rate (track: % of clusters actioned using suggested responses)
- Time to reply reduction
- Creator satisfaction score (survey)

---

## 3. Common Questions Analytics (💡 Idea)

**Goal:** Show creators their most frequently asked questions to help them create FAQs or update their link-in-bio.

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ New Table: question_analytics                                │
├─────────────────────────────────────────────────────────────┤
│ - id: uuid                                                   │
│ - creator_id: text                                           │
│ - question_category: text (e.g. "pricing", "availability")  │
│ - representative_question: text                              │
│ - cluster_count: integer (rolling 30 days)                  │
│ - message_count: integer (rolling 30 days)                  │
│ - first_seen: timestamptz                                    │
│ - last_seen: timestamptz                                     │
└─────────────────────────────────────────────────────────────┘
```

### Implementation Plan

**Phase 1: Category Detection**

```typescript
// Use OpenAI to categorize question types
async function categorizeQuestion(text: string): Promise<string> {
  const prompt = `Categorize this customer question into ONE category:
  - pricing
  - availability
  - product_info
  - technical_support
  - shipping
  - other
  
  Question: "${text}"
  
  Return only the category name.`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    temperature: 0,
  });

  return response.choices[0].message.content?.trim() || "other";
}

// Update analytics when cluster is created
async function updateQuestionAnalytics(cluster: Cluster) {
  const category = await categorizeQuestion(cluster.previewText);

  await db.query(
    `
    INSERT INTO question_analytics (
      creator_id,
      question_category,
      representative_question,
      cluster_count,
      message_count,
      first_seen,
      last_seen
    ) VALUES ($1, $2, $3, 1, $4, now(), now())
    ON CONFLICT (creator_id, question_category)
    DO UPDATE SET
      cluster_count = question_analytics.cluster_count + 1,
      message_count = question_analytics.message_count + $4,
      representative_question = CASE 
        WHEN $4 > question_analytics.message_count 
        THEN $3 
        ELSE question_analytics.representative_question 
      END,
      last_seen = now()
  `,
    [cluster.creatorId, category, cluster.previewText, cluster.channelCount],
  );
}
```

**Phase 2: Analytics Dashboard**

```graphql
type QuestionAnalytic {
  category: String!
  representativeQuestion: String!
  clusterCount: Int!
  messageCount: Int!
  percentOfTotal: Float!
  trend: String! # "up", "down", "stable"
}

query GetQuestionAnalytics($creatorId: ID!, $days: Int = 30) {
  questionAnalytics(creatorId: $creatorId, days: $days) {
    category
    representativeQuestion
    clusterCount
    messageCount
    percentOfTotal
    trend
  }
}
```

**Phase 3: Actionable Insights**

```typescript
// In new Analytics component
<InsightsCard>
  <h3>💡 Top Questions (Last 30 Days)</h3>
  <ol>
    <li>
      <strong>Pricing</strong> - 45% of messages
      <p>"How much do you charge for collaborations?"</p>
      <button>Add to FAQ</button> {/* Opens link-in-bio editor */}
    </li>
    <li>
      <strong>Availability</strong> - 30% of messages
      <p>"When are you available for a call?"</p>
      <button>Add Calendar Link</button> {/* Suggests adding Calendly */}
    </li>
  </ol>
</InsightsCard>
```

### Success Metrics

- % creators who add FAQ after seeing insights (target: >25%)
- Reduction in repeat questions after FAQ added (target: -30%)
- NPS increase for creators using analytics

---

## 4. Auto-Archive Stale Clusters (💡 Idea)

**Goal:** Automatically archive clusters that haven't been actioned after 7 days to keep the inbox clean.

### Architecture

No new tables needed - add `archived_at` column to `clusters`:

```sql
ALTER TABLE clusters ADD COLUMN archived_at timestamptz;
CREATE INDEX idx_clusters_archived ON clusters (archived_at)
  WHERE archived_at IS NOT NULL;
```

### Implementation Plan

**Phase 1: Background Job**

```typescript
// New cron job: runs daily at 2am
@Cron('0 2 * * *')
async archiveStaleClusters() {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const archived = await db.query(`
    UPDATE clusters
    SET
      archived_at = now(),
      status = 'archived'
    WHERE status = 'open'
      AND created_at < $1
      AND archived_at IS NULL
    RETURNING id, creator_id
  `, [sevenDaysAgo]);

  // Send notification to creator
  for (const cluster of archived.rows) {
    await notificationService.send({
      creatorId: cluster.creator_id,
      type: 'cluster_archived',
      message: 'A similarity cluster was auto-archived after 7 days'
    });
  }

  logger.info(`Archived ${archived.rowCount} stale clusters`);
}
```

**Phase 2: UI for Archived Clusters**

```typescript
// Add status filter in ClusterList
enum ClusterStatusFilter {
  OPEN = 'open',
  ACTIONED = 'actioned',
  ARCHIVED = 'archived',
  ALL = 'all'
}

// GraphQL query update
query ListClusters(
  $creatorId: ID!
  $status: ClusterStatusFilter
  $minChannelCount: Float
) {
  clusters(
    creatorId: $creatorId
    status: $status
    minChannelCount: $minChannelCount
  ) {
    # ... fields
    archivedAt
  }
}
```

**Phase 3: Manual Controls**

```typescript
// Add mutations
mutation ArchiveCluster($id: ID!) {
  archiveCluster(id: $id) {
    id
    status
    archivedAt
  }
}

mutation UnarchiveCluster($id: ID!) {
  unarchiveCluster(id: $id) {
    id
    status
    archivedAt
  }
}

// UI: Add archive button to cluster detail
<Button
  variant="secondary"
  onClick={() => archiveCluster({ variables: { id: clusterId } })}
>
  Archive Cluster
</Button>
```

**Phase 4: Configurable Duration**

```typescript
// Add to creator settings
type CreatorSettings {
  autoArchiveDays: number // Default: 7, range: 1-30
  autoArchiveEnabled: boolean // Default: true
}

// Update cron job
const settings = await getCreatorSettings(cluster.creator_id);
if (!settings.autoArchiveEnabled) return;

const cutoffDate = new Date(
  Date.now() - settings.autoArchiveDays * 24 * 60 * 60 * 1000
);
```

### Success Metrics

- Reduction in "ignored" clusters (target: -80%)
- Creator inbox cleanliness score (survey)
- Time saved not manually reviewing stale clusters

---

## 5. Multi-Message Context Concatenation (💡 Idea)

**Goal:** Capture full conversation context by concatenating consecutive follower messages before clustering, improving semantic understanding and preventing "still waiting?" type messages from creating separate clusters.

### Current Limitation

Currently, only the latest message from a channel is stored in a cluster. If a follower sends multiple messages in a row:

```
Follower: "Hey! Do you do collabs?"
Follower: "For my fitness brand"
Follower: "Still waiting..."
```

Only "Still waiting..." gets clustered, which lacks context and may not cluster well.

### Proposed Solution

**Concatenate consecutive follower messages at ingestion time**, before passing to the clustering system.

### Architecture

**Implementation in ltfollowers processor** (ingestion layer):

```typescript
// In streamchat.tagging.processor.ts
async function handleMessageClustering(input: MessageInput) {
  // 1. Fetch recent channel history from Stream Chat
  const channelHistory = await streamChatService.getChannelMessages(
    input.channelId,
    { limit: 10, id_lt: input.streamMessageId }, // Messages before current
  );

  // 2. Find consecutive messages from this follower (going backwards)
  const followerMessages = [input.text]; // Start with current message

  for (const msg of channelHistory) {
    if (msg.user.id === input.followerUserId) {
      followerMessages.unshift(msg.text); // Add to beginning
    } else {
      break; // Stop at first non-follower message (creator reply)
    }
  }

  // 3. Concatenate with line breaks
  const combinedText = followerMessages.join("\n\n");

  // 4. Pass to clustering with full context
  await messagingService.clusterMessage({
    ...input,
    text: combinedText, // ← Enhanced with context
  });
}
```

### Implementation Plan

**Phase 1: Add Context Fetching**

```typescript
// Add method to StreamChatService
async getRecentChannelMessages(
  channelId: string,
  beforeMessageId: string,
  limit = 10
): Promise<StreamMessage[]> {
  const channel = this.getChannel(channelId);
  const messages = await channel.query({
    messages: {
      limit,
      id_lt: beforeMessageId
    }
  });
  return messages.messages;
}
```

**Phase 2: Concatenation Logic**

```typescript
// Add helper function
function extractFollowerContext(
  currentMessage: string,
  currentUserId: string,
  channelHistory: StreamMessage[],
): string {
  const messages = [currentMessage];

  // Look backwards for consecutive follower messages
  for (const msg of channelHistory) {
    if (msg.user.id === currentUserId && !msg.deleted_at) {
      messages.unshift(msg.text);
    } else {
      break; // Stop at creator reply or other user
    }
  }

  // Join with double line breaks for readability
  return messages.join("\n\n");
}
```

**Phase 3: Update Processor**

```typescript
// In streamchat.tagging.processor.ts
const combinedText = await this.extractFollowerMessageContext(
  message.text,
  message.user.id,
  eventPayload.channel_id,
  message.id,
);

await this.handleMessageClustering({
  ...messageData,
  text: combinedText, // Use combined text for clustering
});
```

**Phase 4: Configuration**

```typescript
// Add to environment config
CLUSTERING_CONTEXT_LOOKBACK = 10; // How many messages to look back
CLUSTERING_CONTEXT_ENABLED = true; // Feature flag
```

### Benefits

- ✅ **Better semantic understanding** - Full conversation context
- ✅ **Solves "still waiting" problem** - Follow-ups cluster with original question
- ✅ **No schema changes** - Clustering system is unchanged
- ✅ **No UI changes** - Works transparently
- ✅ **Natural conversation flow** - Respects creator/follower boundaries

### Trade-offs

**Pros:**

- Significantly improves clustering quality
- Handles multi-part questions naturally
- Reduces false negatives (missed clusters)

**Cons:**

- Extra Stream Chat API call per message (~20-50ms latency)
- Concatenated text is longer → higher embedding costs
- Need to handle very long concatenations (token limits)

### Edge Cases

1. **Very long concatenations**: Limit to ~2000 characters or first 5 messages
2. **Time gaps**: Consider adding time window (e.g., only concat if <30 minutes apart)
3. **Deleted messages**: Skip deleted messages in history
4. **Display**: Store both original and concatenated text? Or just concatenated?

### Success Metrics

- Reduction in "context-less" clusters (e.g., "??", "hello?", "still waiting")
- Improvement in cluster quality (user testing)
- % of messages that benefit from concatenation
- Impact on embedding costs

---

## Implementation Priority

1. ~~**Smart Suggestions**~~ - ✅ Complete
2. **Multi-Message Context** - High value, medium complexity, solves real UX issue
3. **LLM-Generated Summaries** - Medium complexity, good UX improvement
4. **Auto-Archive** - Easiest, highest immediate value for inbox management
5. **Analytics** - Most complex, strategic long-term value

## Cost Estimates

- ~~**Smart Suggestions**~~: ✅ Complete - Minimal cost (~$0.0001/cluster, only incremental storage)
- **Multi-Message Context**: Slightly higher embedding costs (longer text), extra Stream Chat API call per message
- **LLM-Generated Summaries**: ~$0.0001/cluster for gpt-4o-mini summary generation
- **Analytics**: ~$0.001/cluster for GPT-4o-mini categorization
- **Auto-Archive**: Free (just DB operations)

## Development Approach

These enhancements will be implemented incrementally and deployed as they're ready, without feature flags:

1. ~~**Smart Suggestions**~~ - ✅ Complete in POC, ready for production port
2. **Multi-Message Context** - Next priority after MVP launch
3. **LLM-Generated Summaries** - Follow-up improvement
4. **Auto-Archive** - Inbox management enhancement
5. **Analytics** - Long-term strategic feature

Each enhancement builds on the core clustering infrastructure and can be developed independently.
