# POC Status

Last updated: 2026-01-30

---

## What This Is

A contained playground for similarity detection + bulk reply workflow. Simulates a production feature where Creator users can respond once to multiple similar inbound messages from GetStream chat.

**Stack**: NestJS, PostgreSQL (pgvector), Redis, Docker Compose

---

## What's Working

- **Message ingestion** with OpenAI embeddings (or stub)
- **Similarity clustering** at configurable threshold (default 0.9)
- **GraphQL API** (code-first, Apollo)
  - `ingestMessage` - insert message, compute embedding, auto-cluster
  - `clusters` - list open clusters for a creator
  - `cluster` - detail view with messages
  - `actionCluster` - mark cluster as actioned, save response
  - `removeClusterMessage` - exclude a message from cluster

### Verified Working

```bash
# Start everything
docker-compose up --build

# GraphQL playground
http://localhost:3000/graphql
```

Ingest two similar messages → they cluster together → action the cluster → done.

---

## Known Issues

### Bruno Collection

Bruno `.bru` files exist in `bruno/requests/` but have had parsing issues:

- "POST body missing" errors
- GraphQL type with `body:graphql` + `body:graphql:vars` format is finicky
- **Workaround**: Use GraphQL playground at `http://localhost:3000/graphql` or curl

### README Outdated

README still shows `html` and `messageType` fields which were removed. Update needed.

### OpenAI API Key

If using `EMBEDDING_PROVIDER=openai`:

- Key needs "Embeddings" permission for `text-embedding-3-small`
- Project-restricted keys may need explicit model access
- **Workaround**: Use unrestricted key, or `EMBEDDING_PROVIDER=stub` for testing

---

## Config

```bash
# .env
DATABASE_URL=postgresql://postgres:postgres@postgres:5432/similarity
REDIS_URL=redis://redis:6379
EMBEDDING_PROVIDER=openai  # or 'stub'
OPENAI_API_KEY=sk-...
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
SIMILARITY_THRESHOLD=0.9
```

---

## Database

Connect via DBeaver or psql:

- Host: `localhost`
- Port: `5432`
- Database: `similarity`
- User: `postgres`
- Password: `postgres`

### Tables

- `messages` - ingested messages with embeddings
- `clusters` - groups of similar messages
- `cluster_messages` - join table with `excluded_at`

### Reset DB

```bash
docker-compose down -v && docker-compose up --build
```

---

## Files Structure

```
├── src/
│   ├── main.ts
│   ├── app.module.ts
│   ├── db/
│   │   ├── db.module.ts
│   │   ├── db.service.ts
│   │   └── vector.ts
│   └── modules/
│       ├── embeddings/
│       │   ├── embeddings.module.ts
│       │   └── embeddings.service.ts
│       ├── messages/
│       │   ├── messages.module.ts
│       │   ├── messages.service.ts
│       │   ├── messages.resolver.ts
│       │   ├── message.model.ts
│       │   ├── ingest-message.input.ts
│       │   └── ingest-result.model.ts
│       └── clusters/
│           ├── clusters.module.ts
│           ├── clusters.service.ts
│           ├── clusters.resolver.ts
│           ├── cluster.model.ts
│           └── cluster-status.enum.ts
├── db/
│   └── init.sql          # runs on postgres startup
├── bruno/
│   ├── bruno.json
│   ├── environments/
│   │   └── local.bru
│   └── requests/
│       ├── ingest-message.bru
│       ├── list-clusters.bru
│       ├── cluster-detail.bru
│       ├── action-cluster.bru
│       └── remove-cluster-message.bru
├── docker-compose.yml
├── Dockerfile
├── .env.example
├── README.md
├── PLAN.md               # next steps for cluster rules + cleanup
└── STATUS.md             # this file
```

---

## Next Steps

See `PLAN.md` for detailed implementation plan. Summary:

1. **Schema**: Add `cluster_message_status` enum to `cluster_messages`
2. **Ingest**: Auto-mark superseded messages (one message per channel per cluster)
3. **External reply**: Add `markChannelReplied` mutation
4. **Cleanup**: Add deletion mutations for user/message/channel
5. **Queries**: Filter by `status = 'active'` instead of `excluded_at IS NULL`
6. **Summary fields**: Add `summary_label`, `summary_description` to clusters

---

## Feature Spec Reference

### Core Flow

1. Visitor sends message to Creator via GetStream
2. System ingests message, computes embedding
3. System finds similar unreplied messages, clusters them
4. Creator sees cluster suggestion in UI
5. Creator writes single response, confirms bulk action
6. System sends response to each channel individually
7. Conversations continue independently

### Key Rules

- **Precision > recall**: Better to miss grouping than to wrongly group
- **Similarity threshold**: 0.9 (90%) by default
- **Paid DMs excluded**: Always personalized response
- **One message per channel per cluster**: Latest message only

### Out of Scope for POC

- GetStream integration (we mock message ingest)
- SNS/SQS (direct API calls instead)
- UI (API-only, use GraphQL playground)
- Sending messages to Stream (just store response)
