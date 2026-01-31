# Future Enhancements

Quick wins to increase adoption and value from similarity clustering.

## 1. Smart Response Suggestions

**Goal:** Pre-fill the bulk reply input with suggested responses based on creator's past replies to similar questions.

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ New Table: response_templates                                │
├─────────────────────────────────────────────────────────────┤
│ - id: uuid                                                   │
│ - creator_id: text                                           │
│ - question_embedding: vector(1536)                           │
│ - response_text: text                                        │
│ - usage_count: integer                                       │
│ - last_used_at: timestamptz                                  │
│ - created_at: timestamptz                                    │
└─────────────────────────────────────────────────────────────┘
```

### Implementation Plan

**Phase 1: Data Collection**

```typescript
// When cluster is actioned, store the response as a template
async function onClusterActioned(cluster: Cluster, responseText: string) {
  // Get the representative message embedding
  const embedding = await getClusterRepresentativeEmbedding(cluster.id);

  await db.query(
    `
    INSERT INTO response_templates (
      creator_id, 
      question_embedding, 
      response_text, 
      usage_count
    ) VALUES ($1, $2, $3, 1)
    ON CONFLICT (creator_id, similar_embedding) 
    DO UPDATE SET 
      usage_count = response_templates.usage_count + 1,
      last_used_at = now()
  `,
    [cluster.creatorId, toVectorLiteral(embedding), responseText],
  );
}
```

**Phase 2: Suggestion Retrieval**

```typescript
// GraphQL resolver
async getSuggestedResponse(clusterId: string): Promise<string | null> {
  // Get cluster's representative embedding
  const clusterEmbedding = await getClusterRepresentativeEmbedding(clusterId);

  // Find most similar past response (similarity > 0.8)
  const result = await db.query(`
    SELECT response_text,
           (1 - (question_embedding <=> $1)) as similarity
    FROM response_templates
    WHERE creator_id = $2
      AND (1 - (question_embedding <=> $1)) > 0.8
    ORDER BY
      similarity DESC,
      usage_count DESC,
      last_used_at DESC
    LIMIT 1
  `, [toVectorLiteral(clusterEmbedding), creatorId]);

  return result.rows[0]?.response_text || null;
}
```

**Phase 3: UI Integration**

```typescript
// In ClusterDetail.tsx
useEffect(() => {
  if (clusterId) {
    getSuggestedResponse(clusterId).then((suggestion) => {
      if (suggestion && !responseText) {
        setResponseText(suggestion);
        setSuggestionShown(true);
      }
    });
  }
}, [clusterId]);

// Show badge: "💡 Suggested based on your past responses"
```

### Success Metrics

- % of suggestions accepted (target: >60%)
- Time to reply reduction (target: -40%)
- Creator satisfaction score (survey)

---

## 2. Common Questions Analytics

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

## 3. Auto-Archive Stale Clusters

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

## Implementation Priority

1. **Auto-Archive** - Easiest, highest immediate value
2. **Smart Suggestions** - Medium complexity, high engagement boost
3. **Analytics** - Most complex, strategic long-term value

## Cost Estimates

- **Smart Suggestions**: Minimal (~$0.0001/cluster, only incremental storage)
- **Analytics**: ~$0.001/cluster for GPT-4o-mini categorization
- **Auto-Archive**: Free (just DB operations)

## Feature Flags

```typescript
// Recommended Statsig gates
const FEATURE_FLAGS = {
  SMART_SUGGESTIONS: "soco_cluster_suggestions",
  QUESTION_ANALYTICS: "soco_question_analytics",
  AUTO_ARCHIVE: "soco_auto_archive",
  AUTO_ARCHIVE_DAYS: "soco_auto_archive_days", // Dynamic config
};
```
