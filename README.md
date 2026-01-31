# Similarity Buckets POC

AI-powered similarity clustering for bulk message replies. Detect and group similar inbound messages so creators can respond once to many.

## Quick Start

```bash
cp .env.example .env
# Add your OPENAI_API_KEY to .env
docker-compose up --build
```

**Access:**

- 🎨 Frontend UI: http://localhost:5173
- 🔌 GraphQL API: http://localhost:3000/graphql
- 🗄️ PostgreSQL: `localhost:5432`
- 📦 Redis: `localhost:6379`

## Features

✅ **Semantic Similarity Matching** - OpenAI embeddings detect similar questions even with different wording  
✅ **Embedding Caching** - Redis caches embeddings for 30 days (30-50% cost reduction)  
✅ **Bulk Reply** - Respond once to multiple similar messages  
✅ **Smart Superseding** - Only latest message per channel appears in clusters  
✅ **Auto-Cleanup** - Empty clusters automatically deleted  
✅ **Paid DM Protection** - Paid messages never cluster with free messages  
✅ **Real-time UI** - React frontend with auto-refresh

## Tech Stack

- **Backend**: NestJS, GraphQL (Code-first), PostgreSQL + pgvector, Redis
- **Frontend**: React, TypeScript, Vite, Tailwind CSS, Apollo Client
- **AI**: OpenAI text-embedding-3-small (1536 dimensions)
- **Deployment**: Docker Compose

## How It Works

```
1. Message arrives → Generate embedding
                  ↓
2. Check similarity → Trigram (85%+) or Vector (40%+)
                  ↓
3. Match found? → Join existing cluster
   No match?    → Create new cluster
                  ↓
4. UI shows clusters with 2+ messages
                  ↓
5. Creator replies → All messages marked as actioned
```

## Key Behaviors

### One Message Per Channel Rule

Each channel (visitor) can only have **one message** in a cluster at any time.

**Example:**

```
Jane sends: "How much do you charge?" → Cluster A
Bob sends:  "What are your rates?"   → Joins Cluster A
Jane sends: "Still waiting"           → Replaces Jane's first message in Cluster A
```

Result: Cluster A has 2 messages (Jane's latest + Bob's message)

**Why?** Prevents duplicate responses and enforces 1:1 Creator-Visitor relationship.

### Clustering Thresholds

- **Vector similarity**: 70% (semantic matching via OpenAI embeddings)
- **Trigram similarity**: 85% (near-exact text matching via PostgreSQL)

**Note:** 70% is conservative to reduce false positives. "How much do you charge?" and "When are you available?" won't cluster together at 70%.

## Documentation

### Getting Started

- 📘 [Quick Start Guide](./docs/getting-started.md) - Setup, architecture, configuration, testing
- 📖 [API Reference](./docs/api-reference.md) - Complete GraphQL schema and examples
- 🗄️ [Database Schema](./docs/database-schema.md) - Tables, indexes, and pgvector details

### Development

- 💻 [Development Guide](./docs/development.md) - Local workflow, debugging, troubleshooting
- ⚡ [Performance Guide](./docs/performance.md) - Optimization strategies and benchmarks

### Production

- 🏭 [Production Migration](./docs/production-migration.md) - Deployment strategy and rollout phases
- 🚀 [Future Enhancements](./docs/future-enhancements.md) - Roadmap with implementation plans

## Testing

```bash
npm run test:e2e
```

11 tests covering:

- Message ingestion and clustering
- Supersede logic (one message per channel)
- Cluster queries with UI fields
- Mutations (action, remove message)
- Auto-delete empty clusters
- Paid DM exclusion

Tests use `EMBEDDING_PROVIDER=stub` for speed and determinism.

## Production Readiness

This is a **Proof of Concept**. Before production:

### Required

- [ ] Move thresholds to feature flags (Statsig)
- [ ] Add async job queue for embedding generation
- [ ] Implement proper database migrations
- [ ] Add monitoring and alerting
- [ ] Set up OpenAI API key rotation
- [ ] Add rate limiting on ingestion
- [ ] Backfill embeddings for existing messages
- [ ] Load testing (1000+ messages/minute)

### Recommended

- [ ] Embedding caching (Redis)
- [ ] Batch embedding generation (10-50 messages at once)
- [ ] Circuit breaker for OpenAI failures
- [ ] Message de-duplication
- [ ] Creator-specific threshold tuning
- [ ] Analytics dashboard (cluster formation rate, action rate)
- [ ] GDPR compliance (embedding deletion)

See [docs/future-enhancements.md](./docs/future-enhancements.md) for detailed implementation plans.

## Cost Estimates

**OpenAI Embeddings:**

- Model: `text-embedding-3-small`
- Cost: ~$0.0001 per message
- 1M messages/day = ~$100/day

**Optimization:** Cache embeddings for identical message text (reduce by ~30-50%).

## License

MIT
