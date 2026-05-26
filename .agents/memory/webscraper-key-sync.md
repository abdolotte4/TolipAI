---
name: WEBSCRAPER_API_KEY sync
description: How the scraper engine API key works across environments
---
The key is an arbitrary shared secret — the value doesn't matter as long as it matches in all three places:
1. Replit env: WEBSCRAPER_API_KEY (current: 1372c12bbd7718...)
2. AWS Secrets Manager: TolipAI/scraper/webscraper-key (updated to match Replit value)
3. Railway production env: WEBSCRAPER_API_KEY (user must verify it matches)
The Fargate container reads the AWS secret at startup — needs a forced redeployment to pick up changes.
