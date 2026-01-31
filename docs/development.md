# Development Guide

Local development workflow, debugging, and troubleshooting.

## Local Development Setup

### Option 1: Full Docker (Recommended for Quick Start)

Everything runs in containers:

```bash
docker-compose up --build
```

**Pros:**
- Consistent environment
- No local dependencies needed
- Matches production setup

**Cons:**
- Slower hot-reload
- More difficult to debug

---

### Option 2: Hybrid (DB in Docker, App Local)

Best for active development:

```bash
# Terminal 1: Start infrastructure only
docker-compose up postgres redis

# Terminal 2: Start API locally
npm install
npm run start:dev

# Terminal 3: Start frontend locally
cd frontend
npm install
npm run dev
```

**Pros:**
- Fast hot-reload (instant)
- Easy to add breakpoints
- Native IDE integration

**Cons:**
- Requires Node.js 20+ installed
- Environment differences from production

**Connection strings for local:**
```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5432/similarity_poc
REDIS_URL=redis://localhost:6379
```

---

## Hot Reload

### Backend (NestJS)

Uses `ts-node-dev` for automatic restart on file changes:

```json
// package.json
"start:dev": "ts-node-dev --respawn --transpile-only src/main.ts"
```

**Restart triggered by:**
- Any `.ts` file change in `src/`
- Not triggered by `.env` changes (requires manual restart)

**Disable hot reload:**
```bash
npm run start  # Standard ts-node, no watch
```

---

### Frontend (Vite)

Vite HMR (Hot Module Replacement) preserves state on most changes:

```typescript
// vite.config.ts
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    hmr: true  // Default: enabled
  }
})
```

**Full reload triggered by:**
- `vite.config.ts` changes
- `tailwind.config.js` changes
- Environment variable changes

---

## Adding Dependencies

### Backend Package

```bash
npm install <package>

# If running in Docker:
docker-compose build api
docker-compose up api
```

**Common packages:**
```bash
npm install @nestjs/axios axios  # HTTP client
npm install class-validator class-transformer  # Validation
npm install @nestjs/schedule  # Cron jobs
```

---

### Frontend Package

```bash
cd frontend
npm install <package>

# If running in Docker:
docker-compose build frontend
docker-compose up frontend
```

**Common packages:**
```bash
npm install date-fns  # Date formatting (already installed)
npm install react-hook-form  # Form management
npm install zod  # Schema validation
```

---

## Database Operations

### Connect to PostgreSQL

```bash
# From host
docker exec -it similarity-buckets-poc-postgres-1 psql -U postgres -d similarity_poc

# From inside container
docker exec -it similarity-buckets-poc-postgres-1 bash
psql -U postgres -d similarity_poc
```

### Useful SQL Commands

```sql
-- List all tables
\dt

-- Describe table schema
\d+ messages

-- Check row counts
SELECT 
  'messages' as table, COUNT(*) FROM messages
UNION ALL
SELECT 'clusters', COUNT(*) FROM clusters
UNION ALL
SELECT 'cluster_messages', COUNT(*) FROM cluster_messages;

-- Check embeddings
SELECT 
  COUNT(*) as total,
  COUNT(embedding) as with_embedding,
  COUNT(*) - COUNT(embedding) as missing
FROM messages;

-- Check similarity scores
SELECT 
  m1.text as text1,
  m2.text as text2,
  ROUND((1 - (m1.embedding <=> m2.embedding))::numeric, 3) as similarity
FROM messages m1
CROSS JOIN messages m2
WHERE m1.id < m2.id
  AND m1.embedding IS NOT NULL
  AND m2.embedding IS NOT NULL
ORDER BY similarity DESC
LIMIT 10;
```

### Reset Database

```bash
# Nuclear option: wipe everything
docker-compose down -v
docker-compose up --build

# Or just truncate tables
docker exec -it similarity-buckets-poc-postgres-1 psql -U postgres -d similarity_poc -c "
TRUNCATE cluster_messages, clusters, messages RESTART IDENTITY CASCADE;
"
```

---

## Schema Migrations

### POC Approach (Current)

Edit `db/init.sql` and rebuild:

```bash
docker-compose down -v
docker-compose up --build
```

**Pros:** Simple, works for POC  
**Cons:** Destroys all data, no rollback

---

### Production Approach (Recommended)

Use a migration tool like `node-pg-migrate`:

```bash
npm install node-pg-migrate

# Create migration
npx node-pg-migrate create add-archived-at-to-clusters

# Edit migrations/xxx_add-archived-at-to-clusters.js
exports.up = (pgm) => {
  pgm.addColumn('clusters', {
    archived_at: {
      type: 'timestamptz',
      notNull: false
    }
  });
};

exports.down = (pgm) => {
  pgm.dropColumn('clusters', 'archived_at');
};

# Run migration
DATABASE_URL=postgres://... npx node-pg-migrate up
```

---

## Debugging

### Backend Debugging (VS Code)

Create `.vscode/launch.json`:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Debug NestJS",
      "runtimeExecutable": "npm",
      "runtimeArgs": ["run", "start:debug"],
      "sourceMaps": true,
      "cwd": "${workspaceFolder}",
      "protocol": "inspector",
      "console": "integratedTerminal"
    }
  ]
}
```

Add to `package.json`:
```json
"start:debug": "nest start --debug --watch"
```

Set breakpoints in `.ts` files and press F5.

---

### Frontend Debugging (Browser DevTools)

1. Open http://localhost:5173
2. Press F12 → Sources tab
3. Find file in `src/` tree
4. Click line number to set breakpoint

**React DevTools:**
```bash
# Install browser extension
# Chrome: https://chrome.google.com/webstore (search "React Developer Tools")
# Then access via React tab in DevTools
```

---

### GraphQL Query Debugging

**Playground:** http://localhost:3000/graphql

**cURL:**
```bash
curl http://localhost:3000/graphql \
  -H "Content-Type: application/json" \
  -d '{
    "query": "query { clusters(creatorId: \"00000000-0000-4000-a000-000000000001\") { id } }"
  }'
```

**Apollo Client DevTools:**
Install browser extension, then inspect cache and queries in DevTools.

---

## Logging

### Backend Logs

```bash
# Follow logs
docker logs similarity-buckets-poc-api-1 -f

# Last 100 lines
docker logs similarity-buckets-poc-api-1 --tail 100

# Since timestamp
docker logs similarity-buckets-poc-api-1 --since 2026-01-31T10:00:00
```

**Add custom logging:**
```typescript
import { Logger } from '@nestjs/common';

const logger = new Logger('MessagesService');

async ingestMessage(input: IngestMessageInput) {
  logger.log(`Ingesting message: ${input.messageId}`);
  logger.debug(`Full input: ${JSON.stringify(input)}`);
  // ...
}
```

---

### Frontend Logs

Open browser console (F12 → Console).

**Add custom logging:**
```typescript
console.log('Cluster selected:', clusterId);
console.debug('Apollo cache:', client.cache.extract());
```

---

## Troubleshooting

### No clusters appearing after seeding

**Step 1: Check if messages were created**
```sql
SELECT COUNT(*) FROM messages;
```

**Step 2: Check if embeddings were generated**
```sql
SELECT text, embedding IS NOT NULL FROM messages LIMIT 5;
```

If `embedding` is NULL, check OpenAI API key:
```bash
docker exec similarity-buckets-poc-api-1 printenv | grep OPENAI
```

**Step 3: Check similarity scores**
```sql
SELECT 
  m1.text, 
  m2.text, 
  ROUND((1 - (m1.embedding <=> m2.embedding))::numeric, 3) as sim
FROM messages m1, messages m2 
WHERE m1.id < m2.id 
LIMIT 5;
```

If similarity < 0.4, lower threshold in `messages.service.ts`.

**Step 4: Check cluster creation**
```sql
SELECT * FROM clusters;
SELECT * FROM cluster_messages;
```

---

### CSS not loading in frontend

**Symptom:** Unstyled UI, huge images, no Tailwind classes

**Fix:**
```bash
# Rebuild frontend container
docker-compose down
docker-compose build frontend --no-cache
docker-compose up frontend
```

**Check:** `frontend/node_modules` should exist inside container
```bash
docker exec similarity-buckets-poc-frontend-1 ls -la /app/node_modules | head
```

---

### Port already in use

**Symptom:** `Error: listen EADDRINUSE: address already in use :::3000`

**Fix:**
```bash
# Find process
lsof -ti:3000

# Kill it
lsof -ti:3000 | xargs kill -9

# Or use different port
PORT=3001 npm run start:dev
```

---

### CORS errors in frontend

**Symptom:** `Access to fetch at 'http://localhost:3000/graphql' blocked by CORS`

**Fix:** Ensure backend has CORS enabled in `main.ts`:
```typescript
app.enableCors({
  origin: 'http://localhost:5173',
  credentials: true
});
```

**Docker:** Restart API container after changes:
```bash
docker-compose restart api
```

---

### TypeScript errors in IDE but code runs

**Symptom:** Red squiggles in VS Code but `npm run start:dev` works

**Fix:**
```bash
# Restart TypeScript server
# CMD+Shift+P → "TypeScript: Restart TS Server"

# Or rebuild
npm run build
```

---

### Slow embedding generation

**Symptom:** `IngestMessage` takes >5 seconds

**Check OpenAI latency:**
```typescript
const start = Date.now();
const embedding = await this.embeddingsService.generateEmbedding(text);
console.log(`Embedding took ${Date.now() - start}ms`);
```

**Typical latencies:**
- OpenAI API: 1-3 seconds
- Stub provider: <1ms

**Fix:** Use stub provider for development:
```bash
# .env
EMBEDDING_PROVIDER=stub
```

---

### GraphQL schema out of sync

**Symptom:** Frontend queries fail with "Cannot query field X"

**Fix:** Regenerate GraphQL types:
```bash
# Backend: schema is auto-generated on startup (code-first)
# Just restart API

# Frontend: if using codegen
cd frontend
npm run codegen  # (if configured)
```

---

## Performance Profiling

### Backend Performance

**NestJS built-in:**
```typescript
import { Logger } from '@nestjs/common';

const start = performance.now();
// ... code ...
Logger.log(`Operation took ${performance.now() - start}ms`);
```

**Database query timing:**
```sql
-- Enable query logging
ALTER DATABASE similarity_poc SET log_statement = 'all';
ALTER DATABASE similarity_poc SET log_duration = on;

-- Check slow queries
SELECT query, mean_exec_time, calls
FROM pg_stat_statements
ORDER BY mean_exec_time DESC
LIMIT 10;
```

---

### Frontend Performance

**React DevTools Profiler:**
1. Install React DevTools extension
2. Open DevTools → Profiler tab
3. Click record
4. Interact with UI
5. Stop recording
6. Analyze render times

**Lighthouse:**
```bash
# In Chrome
# F12 → Lighthouse tab → Generate report
```

---

## Testing

### Run All Tests

```bash
npm run test:e2e
```

### Run Specific Test File

```bash
npm run test:e2e -- --testPathPattern=messages
```

### Run Single Test

```bash
npm run test:e2e -- --testNamePattern="should create cluster"
```

### Watch Mode

```bash
npm run test:e2e -- --watch
```

### Coverage

```bash
npm run test:e2e -- --coverage
```

---

## Git Workflow

### Recommended Branches

```bash
main        # Production-ready code
develop     # Integration branch
feature/*   # New features
fix/*       # Bug fixes
```

### Commit Messages

```
feat: add auto-archive for stale clusters
fix: correct supersede logic for same-channel messages
docs: update API reference with new fields
refactor: extract embedding service
test: add e2e test for cluster filters
```

---

## Environment Variables

### Required for Development

```bash
# .env (backend)
DATABASE_URL=postgres://postgres:postgres@localhost:5432/similarity_poc
REDIS_URL=redis://localhost:6379
EMBEDDING_PROVIDER=stub  # Use OpenAI only when needed
OPENAI_API_KEY=sk-proj-...  # Optional if using stub

# frontend/.env (if needed)
VITE_API_URL=http://localhost:3000/graphql
```

### Switching Providers

```bash
# Use OpenAI (costs money, slower)
EMBEDDING_PROVIDER=openai
OPENAI_API_KEY=sk-proj-your-key

# Use stub (free, instant, no semantic matching)
EMBEDDING_PROVIDER=stub
```

**Restart required after changing:**
```bash
docker-compose restart api  # Docker
# or
# Ctrl+C and re-run npm run start:dev  # Local
```

---

## IDE Setup

### VS Code Extensions (Recommended)

```bash
# Install
code --install-extension dbaeumer.vscode-eslint
code --install-extension esbenp.prettier-vscode
code --install-extension ms-vscode.vscode-typescript-next
code --install-extension bradlc.vscode-tailwindcss
code --install-extension GraphQL.vscode-graphql
```

### Workspace Settings

Create `.vscode/settings.json`:

```json
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": true
  },
  "typescript.tsdk": "node_modules/typescript/lib",
  "tailwindCSS.experimental.classRegex": [
    ["clsx\\(([^)]*)\\)", "(?:'|\"|`)([^']*)(?:'|\"|`)"]
  ]
}
```

---

## Docker Compose Tips

### Build specific service

```bash
docker-compose build api
```

### Restart specific service

```bash
docker-compose restart frontend
```

### View service logs

```bash
docker-compose logs -f api
```

### Execute command in service

```bash
docker-compose exec api npm run test:e2e
```

### Remove all containers and volumes

```bash
docker-compose down -v --remove-orphans
```

---

## Next Steps

- 📖 [API Reference](./api-reference.md) - GraphQL schema details
- 🗄️ [Database Schema](./database-schema.md) - Tables and indexes
- ⚡ [Performance Guide](./performance.md) - Optimization tips
