---
name: AI config key priority
description: How aiConfig.ts resolves OpenAI vs Groq keys and base URLs; prevents sending sk-proj keys to groq.com.
---

# AI Config Key Priority (api-server)

File: `artifacts/api-server/src/services/aiConfig.ts`

## Key priority for OpenAI calls
1. `OPENAI_API_KEY` (real OpenAI key, sk-proj-…)
2. `AI_INTEGRATIONS_OPENAI_API_KEY` (integration-linked key, may be Groq)

## Base URL logic
- `OPENAI_BASE_URL` — always wins if set
- `AI_INTEGRATIONS_OPENAI_BASE_URL` — IGNORED when it contains `groq.com`, `openrouter.ai`, `anthropic.com`, `together.ai`, `mistral.ai`
- Default: `https://api.openai.com/v1`

**Why:** AI_INTEGRATIONS_OPENAI_BASE_URL is sometimes set to Groq's endpoint. Sending an sk-proj key to Groq always 401s. The guard prevents this silent failure mode.

## Groq fallback (CRM AI only)
`callAI()` tries OpenAI first, automatically falls back to `GROQ_API_KEY` if OpenAI fails or is unconfigured. Groq model: `llama-3.3-70b-versatile`.

## Voice agent (NOT CRM AI)
`twilio-voice-agent.ts` requires real OpenAI Realtime API — cannot fall back to Groq (no equivalent WebSocket API). The inbound AI voice agent is currently PAUSED (routes to voicemail).

## CRM AI features using callAI()
- Deal Scorer (POST /crm/leads/:id/ai-deal-score)
- Seller Script (POST /crm/leads/:id/ai-seller-script)  
- Offer Letter (POST /crm/leads/:id/ai-offer-letter)
- Call coaching/summary
- SMS AI agent
- Transcription (Whisper → Groq Whisper fallback)
