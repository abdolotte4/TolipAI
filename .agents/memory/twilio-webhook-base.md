---
name: Twilio webhook base URL
description: How getWebhookBase() builds production callback URLs for Twilio
---
Priority: 1. API_BASE_URL env var (https://tolipai.com/api) 2. x-forwarded-host header 3. host header.
REPLIT_DEV_DOMAIN was checked FIRST — this caused all Twilio callbacks to route to the Replit dev server in production, silencing calls and breaking inbound. Removed entirely.
**How to apply:** Never re-add REPLIT_DEV_DOMAIN. Set API_BASE_URL=https://tolipai.com/api in Railway.
