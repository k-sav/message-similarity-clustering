# Getting Started

Quick guide to running the Similarity Clusters POC locally.

## Prerequisites

- Docker Desktop or OrbStack
- Node.js 20+ (for local development outside Docker)
- OpenAI API key (for semantic similarity)

## Quick Start

### 1. Clone and Setup

```bash
git clone <repo-url>
cd similarity-buckets-poc
cp .env.example .env
```

### 2. Add OpenAI API Key

Edit `.env` and add your OpenAI API key:

```bash
OPENAI_API_KEY=sk-proj-your-key-here
```

### 3. Start All Services

```bash
docker-compose up --build
```

This starts:

- **PostgreSQL** (with pgvector) on port `5432`
- **Redis** on port `6379`
- **API** (NestJS + GraphQL) on port `3000`
- **Frontend** (React + Vite) on port `5173`

### 4. Open the UI

Navigate to http://localhost:5173

Click **"Seed Test Data"** to generate sample clusters.

---

## Architecture Overview

```
┌──────────────┐      ┌──────────────┐      ┌──────────────┐
│   Frontend   │─────▶│   GraphQL    │─────▶│  PostgreSQL  │
│  React + UI  │      │  NestJS API  │      │  + pgvector  │
└──────────────┘      └──────────────┘      └──────────────┘
                              │
                              ▼
                       ┌──────────────┐
                       │   OpenAI     │
                       │  Embeddings  │
                       └──────────────┘
```

### Data Flow

1. **Message Ingestion** (`IngestMessage` mutation)
   - Generate embedding via OpenAI
   - Check for trigram match (>85% text similarity)
   - If no trigram, check vector similarity (>40% semantic similarity)
   - Add to existing cluster or create new one

2. **Supersede Rule**
   - One message per channel/visitor per cluster
   - New message from same channel → remove old message from cluster
   - Ensures `channelCount === messages.length`

3. **Clustering Algorithm**
   ```typescript
   if (trigramMatch && similarity > 0.85) {
     joinCluster(existingClusterId);
   } else if (vectorMatch && similarity > 0.4) {
     joinCluster(existingClusterId);
   } else {
     createNewCluster();
   }
   ```

---

## Configuration

### Environment Variables

| Variable                 | Default                  | Description                                             |
| ------------------------ | ------------------------ | ------------------------------------------------------- |
| `PORT`                   | `3000`                   | API server port                                         |
| `DATABASE_URL`           | `postgres://...`         | PostgreSQL connection string                            |
| `REDIS_URL`              | `redis://...`            | Redis connection string                                 |
| `EMBEDDING_PROVIDER`     | `openai`                 | `openai` or `stub`                                      |
| `EMBEDDING_DIM`          | `1536`                   | Embedding dimension (for OpenAI text-embedding-3-small) |
| `OPENAI_API_KEY`         | -                        | Your OpenAI API key (required for `openai` provider)    |
| `OPENAI_EMBEDDING_MODEL` | `text-embedding-3-small` | OpenAI model to use                                     |

### Similarity Thresholds

Configured in `src/modules/messages/messages.service.ts`:

```typescript
const SIMILARITY_THRESHOLD = 0.4; // 40% semantic similarity
const TRIGRAM_THRESHOLD = 0.85; // 85% text similarity
```

**Tuning guidance:**

- **Higher threshold** (0.6-0.9): More precise clusters, fewer false positives, might miss valid matches
- **Lower threshold** (0.3-0.5): More inclusive clusters, higher recall, more false positives
- **Production recommendation**: Start at 0.6, A/B test and tune based on creator feedback

### Embedding Providers

**OpenAI** (production):

- Real semantic similarity
- ~$0.0001 per message
- 1-3 second latency per embedding
- ✅ **Cached in Redis** (30-50% cost reduction for repeated questions)

**Stub** (testing):

- Deterministic hash-based embeddings
- Free and instant
- No semantic understanding (only matches identical text)
- No caching needed (already instant)

---

## Testing

### Run E2E Tests

```bash
npm run test:e2e
```

Tests use `EMBEDDING_PROVIDER=stub` (configured in `.env.test`) for speed and determinism.

### Test Coverage

- ✅ Message ingestion and clustering
- ✅ Supersede logic (one message per channel)
- ✅ Cluster queries with UI fields
- ✅ Cluster mutations (action, remove message)
- ✅ Status filtering
- ✅ Auto-delete empty clusters
- ✅ `minChannelCount` filtering
- ✅ Paid DM exclusion

### Manual Testing

1. **Seed data** via UI button
2. **Verify 4 clusters** appear (pricing, availability, portfolio, tech support)
3. **Click a cluster** to see messages
4. **Remove a message** - verify cluster updates
5. **Send bulk reply** - verify cluster marked as "Actioned"
6. **Seed again** - verify supersede logic (old messages replaced)

---

## Next Steps

- 📖 [API Reference](./api-reference.md) - GraphQL queries and mutations
- 🗄️ [Database Schema](./database-schema.md) - Tables, indexes, and structure
- 💻 [Development Guide](./development.md) - Local dev workflow, debugging, troubleshooting
- ⚡ [Performance Guide](./performance.md) - Optimization tips for scale
- 🚀 [Production Migration](./production-migration.md) - Deployment strategy
- 🎯 [Future Enhancements](./future-enhancements.md) - Roadmap and quick wins
