---
name: AI_MODEL env var routing
description: AI_MODEL is set to a Groq model name (llama-3.3-70b-versatile). getChatModel() guards against sending it to OpenAI. getGroqModel() correctly picks it up.
---

# AI_MODEL Environment Variable Routing

## The situation
`AI_MODEL` secret = `llama-3.3-70b-versatile` (a Groq model name, NOT an OpenAI model).
`AI_INTEGRATIONS_OPENAI_BASE_URL` = `https://api.groq.com/openai/v1` (Groq endpoint).

## The guards in aiConfig.ts
`NON_OPENAI_MODEL_PATTERNS` list: `llama`, `mixtral`, `gemma`, `mistral`, `falcon`, `qwen`, `deepseek`, `phi-`, `command-`, `claude`, `gemini`.

`isNonOpenAIModel(model)` checks `AI_MODEL` against this list.

- `getChatModel()`: checks `OPENAI_MODEL` first → then `AI_MODEL` only if NOT in patterns → defaults to `gpt-4o-mini`
- `getSmsModel()`: same guard as getChatModel
- `getGroqModel()`: checks `GROQ_MODEL` → then `AI_MODEL` if IS in patterns → defaults to `llama-3.3-70b-versatile`

**Why:** Without this guard, all OpenAI API calls fail with model-not-found because `llama-3.3-70b-versatile` doesn't exist on api.openai.com.

**How to apply:** Any new function that reads `AI_MODEL` directly for an OpenAI call MUST either use `getChatModel()` or apply the `isNonOpenAIModel()` guard itself.

## Recommended long-term fix
Set `OPENAI_MODEL=gpt-4o-mini` as a separate secret so the model selection is fully explicit and doesn't depend on the pattern-matching guard.

## propertyApi.ts special case
`estimateMarketPricePerSqft()` explicitly uses `AI_INTEGRATIONS_OPENAI_BASE_URL` (Groq URL) and `AI_INTEGRATIONS_OPENAI_API_KEY` (Groq key). Its model = `GROQ_MODEL || AI_MODEL || "llama-3.3-70b-versatile"`. This is intentional — it IS calling the Groq endpoint.
