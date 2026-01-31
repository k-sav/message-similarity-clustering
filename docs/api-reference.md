# API Reference

Complete GraphQL API documentation for message similarity clustering.

## Mutations

### IngestMessage

Ingest a new message and cluster it with similar messages.

```graphql
mutation IngestMessage($input: IngestMessageInput!) {
  ingestMessage(input: $input) {
    messageId
    clusterId
    matchedMessageId
    similarity
  }
}
```

**Input Fields:**

| Field             | Type        | Required | Description                                          |
| ----------------- | ----------- | -------- | ---------------------------------------------------- |
| `creatorId`       | `ID!`       | Yes      | Creator's user ID                                    |
| `messageId`       | `String!`   | Yes      | External message ID from StreamChat                  |
| `text`            | `String!`   | Yes      | Message content                                      |
| `channelId`       | `String!`   | Yes      | Channel identifier                                   |
| `channelCid`      | `String!`   | Yes      | StreamChat channel CID                               |
| `visitorUserId`   | `String!`   | Yes      | Visitor's user ID                                    |
| `visitorUsername` | `String!`   | Yes      | Visitor's display name                               |
| `createdAt`       | `DateTime!` | Yes      | Message timestamp                                    |
| `isPaidDm`        | `Boolean!`  | Yes      | Whether this is a paid DM (excluded from clustering) |
| `rawPayload`      | `JSON!`     | Yes      | Full StreamChat message object                       |

**Response Fields:**

| Field              | Type    | Description                                     |
| ------------------ | ------- | ----------------------------------------------- |
| `messageId`        | `ID!`   | Internal message UUID                           |
| `clusterId`        | `ID`    | Cluster ID if matched (null if no cluster)      |
| `matchedMessageId` | `ID`    | ID of similar message that triggered clustering |
| `similarity`       | `Float` | Similarity score (0.0-1.0) with matched message |

**Example:**

```json
{
  "input": {
    "creatorId": "00000000-0000-4000-a000-000000000001",
    "messageId": "ext-msg-123",
    "text": "How much do you charge for collaborations?",
    "channelId": "channel-visitor-1",
    "channelCid": "messaging:channel-visitor-1",
    "visitorUserId": "visitor-1",
    "visitorUsername": "Jane Ray",
    "createdAt": "2026-01-31T00:00:00.000Z",
    "isPaidDm": false,
    "rawPayload": {
      "user": {
        "id": "visitor-1",
        "name": "Jane Ray",
        "image": "https://i.pravatar.cc/150?u=visitor-1"
      }
    }
  }
}
```

---

### ActionCluster

Mark a cluster as actioned and record the bulk reply text for specific channels.

```graphql
mutation ActionCluster(
  $id: ID!
  $responseText: String!
  $channelIds: [String!]!
) {
  actionCluster(id: $id, responseText: $responseText, channelIds: $channelIds) {
    id
    status
    responseText
    updatedAt
  }
}
```

**Input:**

| Field          | Type         | Required | Description                     |
| -------------- | ------------ | -------- | ------------------------------- |
| `id`           | `ID!`        | Yes      | Cluster ID                      |
| `responseText` | `String!`    | Yes      | Creator's reply text            |
| `channelIds`   | `[String!]!` | Yes      | Array of channel IDs to send to |

**Response:**

| Field          | Type             | Description           |
| -------------- | ---------------- | --------------------- |
| `id`           | `ID!`            | Cluster ID            |
| `status`       | `ClusterStatus!` | Now set to `Actioned` |
| `responseText` | `String!`        | The reply text stored |
| `updatedAt`    | `DateTime!`      | Timestamp of action   |

**Side Effects:**

- Cluster status changes from `Open` to `Actioned`
- Messages from specified `channelIds` are marked as replied (`replied_at` set)
- **ALL messages are removed from the cluster** (cluster is archived)
- Cluster is auto-deleted (always)

**Why channelIds?**
The `channelIds` parameter specifies **which channels receive the reply**, not which messages stay in the cluster. After actioning:

- Messages from `channelIds`: Marked as replied (will receive the response)
- Other messages: Not marked as replied (won't receive response, but still removed from cluster)
- Cluster: Always deleted (actioning = done with this cluster)

This enables UX patterns like:

- **Checkboxes** (future): Select who gets the reply
- **Remove button** (current): Exclude bad matches, send to rest

**Example:**

```json
{
  "id": "9cd31176-ba8d-4f78-bb26-108690fb0d67",
  "responseText": "Thanks for asking! My rates start at $500 for brand collaborations.",
  "channelIds": ["channel-visitor-1", "channel-visitor-2"]
}
```

---

### RemoveClusterMessage

Remove a single message from a cluster (e.g., if incorrectly grouped).

```graphql
mutation RemoveClusterMessage($clusterId: ID!, $messageId: ID!) {
  removeClusterMessage(clusterId: $clusterId, messageId: $messageId) {
    id
    channelCount
  }
}
```

**Input:**

| Field       | Type  | Required | Description          |
| ----------- | ----- | -------- | -------------------- |
| `clusterId` | `ID!` | Yes      | Cluster ID           |
| `messageId` | `ID!` | Yes      | Message ID to remove |

**Response:**

Returns the updated cluster, or `null` if this was the last message (cluster auto-deleted).

| Field          | Type  | Description                  |
| -------------- | ----- | ---------------------------- |
| `id`           | `ID`  | Cluster ID (null if deleted) |
| `channelCount` | `Int` | Updated channel count        |

**Example:**

```json
{
  "clusterId": "9cd31176-ba8d-4f78-bb26-108690fb0d67",
  "messageId": "71e08472-a31d-4b19-a1a7-796fad486b53"
}
```

---

## Queries

### ListClusters

List all clusters for a creator with optional filtering.

```graphql
query ListClusters(
  $creatorId: ID!
  $status: ClusterStatus
  $minChannelCount: Float
) {
  clusters(
    creatorId: $creatorId
    status: $status
    minChannelCount: $minChannelCount
  ) {
    id
    status
    channelCount
    previewText
    representativeVisitor
    additionalVisitorCount
    visitorAvatarUrls
    createdAt
  }
}
```

**Input:**

| Field             | Type            | Required | Description                                              |
| ----------------- | --------------- | -------- | -------------------------------------------------------- |
| `creatorId`       | `ID!`           | Yes      | Creator's user ID                                        |
| `status`          | `ClusterStatus` | No       | Filter by status (`Open`, `Actioned`)                    |
| `minChannelCount` | `Float`         | No       | Only show clusters with ≥ this many channels (e.g., `2`) |

**Response Fields:**

| Field                    | Type             | Description                                  |
| ------------------------ | ---------------- | -------------------------------------------- |
| `id`                     | `ID!`            | Cluster UUID                                 |
| `status`                 | `ClusterStatus!` | `Open` or `Actioned`                         |
| `channelCount`           | `Int!`           | Number of unique channels/visitors           |
| `previewText`            | `String!`        | Sample message text (truncated to 60 chars)  |
| `representativeVisitor`  | `String!`        | First visitor's username                     |
| `additionalVisitorCount` | `Int!`           | Count of other visitors (`channelCount - 1`) |
| `visitorAvatarUrls`      | `[String!]!`     | Array of avatar URLs (up to 3)               |
| `createdAt`              | `DateTime!`      | Cluster creation timestamp                   |

**Example:**

```json
{
  "creatorId": "00000000-0000-4000-a000-000000000001",
  "status": "Open",
  "minChannelCount": 2
}
```

**Typical UI Usage:**

Display as: `"Jane Ray +2 more"` with avatar stack and preview text.

---

### GetCluster

Get full details for a single cluster including all messages.

```graphql
query GetCluster($id: ID!) {
  cluster(id: $id) {
    id
    status
    responseText
    channelCount
    previewText
    representativeVisitor
    additionalVisitorCount
    visitorAvatarUrls
    messages {
      id
      text
      visitorUsername
      visitorAvatarUrl
      createdAt
      channelId
    }
  }
}
```

**Input:**

| Field | Type  | Required | Description |
| ----- | ----- | -------- | ----------- |
| `id`  | `ID!` | Yes      | Cluster ID  |

**Response:**

Same as `ListClusters` fields plus:

| Field          | Type          | Description                                 |
| -------------- | ------------- | ------------------------------------------- |
| `responseText` | `String`      | Creator's bulk reply (null if not actioned) |
| `messages`     | `[Message!]!` | Full list of messages in cluster            |

**Message Fields:**

| Field              | Type        | Description            |
| ------------------ | ----------- | ---------------------- |
| `id`               | `ID!`       | Message UUID           |
| `text`             | `String!`   | Full message text      |
| `visitorUsername`  | `String!`   | Visitor's display name |
| `visitorAvatarUrl` | `String!`   | Visitor's avatar URL   |
| `createdAt`        | `DateTime!` | Message timestamp      |
| `channelId`        | `String!`   | StreamChat channel ID  |

**Example:**

```json
{
  "id": "9cd31176-ba8d-4f78-bb26-108690fb0d67"
}
```

---

## Types

### ClusterStatus

Enum representing cluster state.

```graphql
enum ClusterStatus {
  Open # Active cluster, creator hasn't replied yet
  Actioned # Creator has sent bulk reply
}
```

### DateTime

ISO 8601 datetime string.

**Example:** `"2026-01-31T05:44:11.146Z"`

### JSON

Arbitrary JSON object. Used for `rawPayload` field.

---

## Error Handling

### Common Errors

**Message not found:**

```json
{
  "errors": [
    {
      "message": "Message with id '...' not found",
      "extensions": { "code": "NOT_FOUND" }
    }
  ]
}
```

**Cluster not found:**

```json
{
  "errors": [
    {
      "message": "Cluster with id '...' not found",
      "extensions": { "code": "NOT_FOUND" }
    }
  ]
}
```

**Message not in cluster:**

```json
{
  "errors": [
    {
      "message": "Message '...' is not in cluster '...'",
      "extensions": { "code": "BAD_REQUEST" }
    }
  ]
}
```

---

## Best Practices

### Pagination

Currently not implemented (POC). For production, add:

```graphql
query ListClusters(
  $creatorId: ID!
  $limit: Int = 50
  $offset: Int = 0
) {
  clusters(...) {
    # ...
  }
}
```

### Rate Limiting

Not implemented in POC. For production, add per-creator rate limits:

- `IngestMessage`: 100 requests/minute
- `ListClusters`: 1000 requests/minute
- `ActionCluster`: 10 requests/minute

### Caching

Apollo Client caches responses automatically. Recommendations:

```typescript
// Invalidate cache after mutation
refetchQueries: ["ListClusters", "GetCluster"];

// Polling for real-time updates
pollInterval: 5000; // 5 seconds
```

---

## GraphQL Playground

Access the interactive GraphQL playground at:

**http://localhost:3000/graphql**

Use it to:

- Browse full schema documentation
- Test queries and mutations interactively
- See real-time autocomplete for fields
- Validate query syntax

---

## WebSocket Subscriptions

Not implemented in POC. For production, consider adding subscriptions for real-time updates:

```graphql
subscription OnClusterUpdated($creatorId: ID!) {
  clusterUpdated(creatorId: $creatorId) {
    id
    channelCount
    status
  }
}
```

This would eliminate polling and provide instant UI updates.
