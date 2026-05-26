---
name: Frontend app directories
description: Where the actual CRM, tools, and website frontend code lives
---
Real code: artifacts/TolipAI-crm/ (crm, port 3001), artifacts/TolipAI-tools/ (tools, port 3002), artifacts/TolipAI-website/ (website, port 3000), artifacts/TolipAI-scraper-engine/ (Python FastAPI).
artifacts/digor-crm/, digor-tools/, digor-website/ are EMPTY — workflow was pointing at them incorrectly. Fixed workflow to use TolipAI-* dirs.
