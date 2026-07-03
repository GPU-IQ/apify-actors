# GPU IQ Apify Actors

Social signal ingestion actors for the GPU IQ Revenue OS platform.

## Actors

| Actor | Platform | Purpose |
|---|---|---|
| `x-signals` | X (Twitter) | Track handles, keyword search, trending topics |
| `instagram-signals` | Instagram | Track brand handles, product launches, engagement |

## Development

### Prerequisites

```bash
npm install -g apify-cli
apify login
```

### Local development

Each actor is an independent npm project. Develop from within the actor directory:

```bash
cd actors/x-signals
npm install
apify run          # runs locally against .apify_storage/
```

Input is read from `.actor/INPUT.json` during local runs. Create this file with your test input (see each actor's `input_schema.json`).

### Deploy

```bash
apify push         # builds and deploys to Apify Console
```

This repo is connected to Apify Console via GitHub integration. Every push to `main` triggers an automatic build for each actor.

### Calling from GPU IQ platform

Actors are invoked from `lib/social/apify.ts` in the `gpuiq-platform` repo via the Apify REST API. Set `APIFY_API_KEY` in the platform's environment variables.

## Architecture

```
Cron: social-ingest (daily 06:00 UTC in gpuiq-platform)
  │
  ├─ x-signals actor
  │    ├─ account_tracking mode: scrape followed handles
  │    └─ keyword_search mode: prospect via AI/GPU keywords
  │
  └─ instagram-signals actor
       ├─ account_tracking mode: scrape followed handles
       └─ keyword_search mode: prospect via hashtags
```

Results are stored in Apify Datasets, then polled and ingested into `social_posts` and `social_signals` tables in the GPU IQ platform DB.

## Signal types produced

- `product_launch` — post contains launch/announce keywords
- `engagement_spike` — likes/reposts 3x above handle average
- `follower_growth` — follower count increased >5% since last run
- `trending_mention` — GPU/AI keyword appearing across multiple handles
- `net_new_prospect` — company posting AI/GPU content not yet in CRM
