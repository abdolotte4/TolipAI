---
name: Scraper engine auth chain
description: How X-API-Key authentication flows between Express and Fargate, and which secrets/env vars to keep in sync.
---

## The key chain

1. Replit env var `WEBSCRAPER_API_KEY` = shared secret (64-char hex)
2. Express `scraperEngineClient.ts` reads `process.env.WEBSCRAPER_API_KEY` and sends it as `X-API-Key` header on every request to Fargate
   - ⚠️ The comment at the top of `scraperEngineClient.ts` incorrectly says `SCRAPER_API_KEY` — the actual code at line 28 correctly reads `WEBSCRAPER_API_KEY`. Don't be misled by the comment.
3. Fargate Python reads `SCRAPER_API_KEY` env var (injected from AWS secret `TolipAI/scraper/api-key`)
4. Python `main.py` auth middleware compares `X-API-Key` header against `SCRAPER_API_KEY`

**Why this matters:** If you change `WEBSCRAPER_API_KEY` in Replit, you must also update `TolipAI/scraper/api-key` in AWS Secrets Manager AND force-redeploy the Fargate service so it picks up the new secret.

**How to apply:** When rotating the API key:
```python
sm.put_secret_value(SecretId='TolipAI/scraper/api-key', SecretString=new_key)
ecs.update_service(cluster='TolipAI-scraper-cluster',
                   service='tolipai-scraper-engine-service-xop',
                   forceNewDeployment=True)
```

## /health is exempt from auth

`/health` returns 200 without any `X-API-Key` header. All other endpoints require auth.
