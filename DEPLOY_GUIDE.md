# Deployment & Background Indexing Guide

This guide covers environment setup, cron scheduling, and background indexing for the Mimir application.

## Overview

The Mimir application uses a **background indexer** to sync on-chain claim data to PostgreSQL. This reduces SSR/build-time RPC pressure and enables faster page loads by serving cached data instead of making expensive on-chain calls.

### Key Components

- **VS Indexer** (`lib/server/vs-index.ts`): Reconciles on-chain claims with the database, pages through new claims, and refreshes active claim states.
- **Cron Endpoint** (`app/api/cron/sync/route.ts`): HTTP GET endpoint that triggers `reconcileVsIndex()` and returns a summary of synced claims.
- **Database** (Neon/Supabase PostgreSQL): Persists indexed claims and sync metadata (last sync time, claim count).

## Environment Variables

### Required for Production

```bash
# Database connection (keep private, never commit)
DATABASE_URL=postgresql://<user>:<password>@<host>/<database>?sslmode=require

# Cron endpoint authorization (required to call /api/cron/sync)
CRON_SECRET=<random-secret-32-chars-or-longer>

# RPC endpoints (optional; with fallback logic)
NEXT_PUBLIC_ARC_RPC=https://arc-node.thecanteenapp.com    # Preferred RPC
ARC_RPC=https://rpc.testnet.arc.network                      # Server-only fallback
```

### Optional Tuning

```bash
# RPC concurrency for getLogs (default: 12)
ARC_LOG_CONCURRENCY=12

# RPC batch size (default: 10, provider-dependent)
RPC_BATCH_SIZE=10
```

### Local Development

Copy `.env.local.example` → `.env.local` and fill in values:

```bash
cp .env.local.example .env.local
# Edit .env.local with your DATABASE_URL, CRON_SECRET, and optional NEXT_PUBLIC_ARC_RPC
```

## Configuring the Cron Job

The cron endpoint is located at:
```
GET /api/cron/sync
Authorization: <CRON_SECRET>
```

### Option A: Vercel Cron (Recommended for Vercel Deployments)

1. **Create `.vercel/crons.json`** in the repo root:
   ```json
   [
     {
       "path": "/api/cron/sync",
       "schedule": "0 */6 * * *"
     }
   ]
   ```

2. **Set `CRON_SECRET` in Vercel Project Settings:**
   - Vercel Dashboard → Project → Settings → Environment Variables
   - Add: `CRON_SECRET` = (random 32+ char string)
   - Ensure it is applied to Production, Preview, and Development environments

3. **Vercel automatically includes the Authorization header** with the CRON_SECRET when calling the endpoint.

### Option B: GitHub Actions Cron

Create `.github/workflows/cron-sync.yml`:

```yaml
name: Cron Sync VS Index

on:
  schedule:
    - cron: '0 */6 * * *'  # Every 6 hours
  workflow_dispatch:        # Manual trigger

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger cron sync
        run: |
          curl -X GET \
            -H "Authorization: ${{ secrets.CRON_SECRET }}" \
            "${{ secrets.DEPLOYMENT_URL }}/api/cron/sync"
        env:
          CRON_SECRET: ${{ secrets.CRON_SECRET }}
          DEPLOYMENT_URL: ${{ secrets.DEPLOYMENT_URL }}
```

Then set secrets in GitHub:
- `CRON_SECRET`: Random 32+ char string
- `DEPLOYMENT_URL`: Your app URL (e.g., `https://mimir.example.com`)

### Option C: External Cron Service (e.g., EasyCron, Cron-job.org)

1. Create a free account on [EasyCron](https://www.easycron.com/) or similar.
2. Add a cron job:
   - **URL**: `https://<your-app-url>/api/cron/sync`
   - **Headers**: `Authorization: <CRON_SECRET>`
   - **Schedule**: Every 6 hours (or as needed)
3. Add the custom header in the cron service UI.

## Monitoring & Observabilty

### Logging

The cron endpoint logs to stdout/stderr:

```
[cron/sync] Starting reconciliation...
[cron/sync] Reconciliation complete: synced=15, new=2, stateChanges=1, elapsed=3450ms
[cron/sync] Reconciliation failed: <error message>
[cron/sync] Unauthorized access attempt
```

Check logs in:
- **Vercel**: Vercel Dashboard → Logs
- **Docker/K8s**: `kubectl logs <pod>`
- **Local**: stdout from `npm run dev` or `npm run build`

### Response Format

Successful cron call returns:

```json
{
  "synced": 15,
  "new": 2,
  "stateChanges": 1,
  "elapsed": 3450,
  "timestamp": "2026-08-12T20:00:00.000Z"
}
```

### Database Monitoring

Check sync status via database:

```sql
-- Last sync timestamp
SELECT * FROM sync_meta WHERE key = 'last_sync_at';

-- Latest claims in index
SELECT COUNT(*) FROM claims;

-- Challenger tracking
SELECT COUNT(*) FROM challengers;
```

## Build-Time Optimization

During `npm run build`, the application:

1. Avoids heavy on-chain reads if `NEXT_PUBLIC_CONTRACT_ADDRESS` is not set (guarded).
2. Marks heavy pages as dynamic (e.g., `/stats`, `/agents`, `/council`) to skip SSR and avoid RPC load during build.
3. Uses cached DB data (if available) instead of hitting RPC directly.

To avoid 429 rate-limits during build:

- **Preferred**: Pre-populate the database with `npm run warm:vs-index` before deploy.
- **Fallback**: Use a dedicated/paid RPC with higher rate limits.
- **Conservative**: Set `ARC_LOG_CONCURRENCY=6` and `RPC_BATCH_SIZE=5` in env.

## Troubleshooting

### Cron not running

- ✅ Verify `CRON_SECRET` is set and non-empty in the deployment environment.
- ✅ Check that the cron job URL is correct (e.g., `https://your-domain.com/api/cron/sync`).
- ✅ Verify the cron job is enabled in Vercel / GitHub Actions / external service.
- ✅ Check logs for "Unauthorized access attempt" (wrong CRON_SECRET).

### Slow reconciliation

- ✅ Check RPC latency; if high, use `NEXT_PUBLIC_ARC_RPC` to override with a faster node.
- ✅ Reduce `ARC_LOG_CONCURRENCY` if RPC returns 429 errors.
- ✅ Verify database connection pool isn't exhausted (Neon/Supabase dashboard).

### Partial reconciliation (synced < expected)

The indexer is designed to checkpoint progress. If a reconciliation run is interrupted:
- The next run resumes from the last synced claim ID (not from the start).
- Logs will show which claims were synced and any gaps encountered.
- RPC failures are recoverable; the indexer retries on the next run.

## Summary

| Component        | Role                           | Deploy Config                    |
|------------------|--------------------------------|----------------------------------|
| Cron Schedule    | Triggers indexer               | Vercel crons.json / GitHub Actions / EasyCron |
| CRON_SECRET      | Authorizes cron requests       | Environment variable (32+ chars) |
| DATABASE_URL     | Postgres persistence           | Environment variable (secret)    |
| reconcileVsIndex | Syncs on-chain → DB            | Automatic (called by cron)      |
| /api/cron/sync   | HTTP endpoint for cron         | Logs to stdout/stderr            |

Once configured, the background indexer keeps your database fresh and enables SSR/pages to serve cached data instead of hammering the RPC.
