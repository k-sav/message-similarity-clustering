# Similarity Buckets POC (GraphQL + pgvector)

Local playground for similarity clustering + bulk reply workflow. No external side effects.

## Run

```
docker-compose up --build
```

GraphQL endpoint: `http://localhost:3000/graphql`

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

- `SIMILARITY_THRESHOLD` defaults to `0.9` (precision > recall)
- `EMBEDDING_PROVIDER` = `stub` or `openai`
- `OPENAI_API_KEY` required if using `openai`
