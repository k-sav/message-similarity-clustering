# Similarity Buckets POC (GraphQL + pgvector + React UI)

Local playground for similarity clustering + bulk reply workflow. No external side effects.

## Run

```bash
docker-compose up --build
```

**Services:**

- Frontend UI: `http://localhost:5173`
- GraphQL API: `http://localhost:3000/graphql`
- PostgreSQL: `localhost:5432`
- Redis: `localhost:6379`

## Frontend UI

The React UI provides:

- **Cluster List**: View all open clusters with 2+ channels
- **Cluster Detail**: View individual messages in a cluster
- **Bulk Reply**: Send one response to all messages in a cluster
- **Remove Messages**: Exclude specific messages from clusters
- **Seed Data**: Generate test messages for development

### Features

- Real-time updates (polls every 3 seconds)
- Two-panel layout matching the design spec
- Avatar display from message payloads
- Relative timestamps ("5m ago")
- Auto-refresh after mutations

## GraphQL operations

### Ingest a message

```
mutation Ingest($input: IngestMessageInput!) {
  ingestMessage(input: $input) {
    messageId
    clusterId
    matchedMessageId
    similarity
  }
}
```

Variables (mapped from your Stream payload):

```
{
  "input": {
    "creatorId": "584f0f9d-f952-4251-9fd7-cf8bb1f40931",
    "messageId": "873d1104-97b7-4254-a2e1-e47a031ac400",
    "text": "hello",
    "channelId": "!members-q7fVGv3qWpk2jUUWmXb-fIcc-XvTksxZZzYHxad12r0",
    "channelCid": "messaging:!members-q7fVGv3qWpk2jUUWmXb-fIcc-XvTksxZZzYHxad12r0",
    "visitorUserId": "584f0f9d-f952-4251-9fd7-cf8bb1f40931",
    "visitorUsername": "k_sav1",
    "createdAt": "2025-10-21T12:55:27.453888Z",
    "isPaidDm": false,
    "rawPayload": {
      "user": { "id": "...", "name": "k_sav1", "image": "https://..." },
      "type": "regular",
      "html": "<p>hello</p>"
    }
  }
}
```

`rawPayload` is optional - stores the full Stream message for future use (avatars, metadata).

### List clusters

```graphql
query ListClusters {
  clusters(
    creatorId: "584f0f9d-f952-4251-9fd7-cf8bb1f40931"
    status: Open
    minChannelCount: 2
  ) {
    id
    status
    channelCount
    previewText
    representativeVisitor
    additionalVisitorCount
    visitorAvatarUrls
    createdAt
    updatedAt
  }
}
```

**Parameters:**

- `status` (optional): Filter by `Open` or `Actioned`
- `minChannelCount` (optional): Only show clusters with at least N channels (use `2` to hide single-message clusters)

### Cluster detail

```graphql
query ClusterDetail {
  cluster(id: "CLUSTER_ID") {
    id
    status
    responseText
    channelCount
    messages {
      id
      text
      createdAt
      channelId
      visitorUserId
      visitorUsername
      visitorAvatarUrl
    }
  }
}
```

### Action a cluster (bulk reply)

```graphql
mutation ActionCluster {
  actionCluster(id: "CLUSTER_ID", responseText: "Thanks for reaching out!") {
    id
    status
    responseText
    updatedAt
  }
}
```

**Note:** This marks the cluster as `Actioned` and removes all messages from it (deleted from `cluster_messages`).

### Remove a message from a cluster

```graphql
mutation RemoveMessage {
  removeClusterMessage(clusterId: "CLUSTER_ID", messageId: "MESSAGE_ID") {
    id
    channelCount
  }
}
```

**Note:** Returns `null` if this was the last message in the cluster (cluster is auto-deleted).

## Config

Copy `.env.example` to `.env` for local runs outside Docker.

**Thresholds** (hardcoded in `messages.service.ts`, TODO: move to feature flags):

- `SIMILARITY_THRESHOLD = 0.9` - Vector cosine similarity (semantic matching, precision > recall)
- `TRIGRAM_THRESHOLD = 0.85` - pg_trgm similarity (near-exact text matching)

**Environment Variables:**

- `EMBEDDING_PROVIDER` = `stub` or `openai`
  - `stub` - Hash-based embeddings (fast, deterministic, no semantic similarity)
  - `openai` - Real semantic embeddings via OpenAI API
- `OPENAI_API_KEY` - Required if using `openai` provider
- `OPENAI_EMBEDDING_MODEL` - Defaults to `text-embedding-3-small`

**Testing:**

- Tests use `EMBEDDING_PROVIDER=stub` (see `.env.test`)
- Tests use identical text to trigger trigram matches (stub embeddings don't capture semantic similarity)

## Key Behaviors

### One Message Per Channel Rule

**Important:** Each channel can only have ONE message in a cluster at any time. This enforces a 1:1 Creator-Visitor relationship.

When a new message arrives from a channel that already has a message in a cluster:

1. The **old message** from that channel is **removed** from all clusters
2. The **new message** is added to the matched cluster (or creates a new one)

**Example:**

```
1. Visitor sends: "How much do you charge?" (channel-1) → Added to Cluster A
2. Different visitor sends: "What are your rates?" (channel-2) → Joins Cluster A
3. First visitor sends: "Still waiting on pricing" (channel-1) → Supersedes message 1 in Cluster A
```

Result: Cluster A now contains messages from channel-1 (message 3) and channel-2 (message 2).

**Why?** Prevents duplicate responses to the same visitor and ensures `channelCount === messages.length` always holds.

**Test Coverage:** See `test/app.e2e-spec.ts` → `"should supersede old message from same channel"`

### Seeding Behavior

The **Seed Test Data** button in the UI creates 7 similar messages using **fixed user IDs** (`user-1` through `user-7`).

- **First seed**: Creates 7 new messages, forms a cluster
- **Subsequent seeds**: Supersedes the previous messages (same channels), updates the cluster with newer timestamps
- **channelCount**: Will always be 7 (one message per visitor/channel)

**Before you seed again**: If you've already actioned a cluster, new seeds with the same text will join the actioned cluster (won't appear in "Open" filter). To test repeatedly, either:

1. Reset the database: `docker-compose down -v && docker-compose up --build`
2. Change the seed text to create different clusters
