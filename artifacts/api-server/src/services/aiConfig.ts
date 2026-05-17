/**
 * aiConfig.ts — Centralized AI / OpenAI configuration resolver.
 *
 * Key precedence (highest to lowest):
 *   1. OPENAI_API_KEY          — direct OpenAI key (used by Realtime API & Whisper)
 *   2. AI_INTEGRATIONS_OPENAI_API_KEY — Replit integration key (any OpenAI-compat provider)
 *
 * Base URL precedence:
 *   1. OPENAI_BASE_URL
 *   2. AI_INTEGRATIONS_OPENAI_BASE_URL
 *   3. https://api.openai.com/v1  (default)
 *
 * Usage:
 *   import { getOpenAIKey, getOpenAIBaseUrl, hasOpenAI } from "../services/aiConfig";
 */

/** Returns the best available OpenAI-compatible API key, or undefined if none. */
export function getOpenAIKey(): string | undefined {
  return (
    process.env.OPENAI_API_KEY ||
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY ||
    undefined
  );
}

/** Returns the base URL for OpenAI-compatible API calls. */
export function getOpenAIBaseUrl(): string {
  return (
    process.env.OPENAI_BASE_URL ||
    process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ||
    "https://api.openai.com/v1"
  );
}

/** Returns true if any OpenAI key is available. */
export function hasOpenAI(): boolean {
  return !!getOpenAIKey();
}

/**
 * Returns the model to use for chat completions.
 * Falls back to gpt-4o-mini if not configured.
 */
export function getChatModel(): string {
  return process.env.AI_MODEL || "gpt-4o-mini";
}

/**
 * Returns the model to use for SMS / short-text generation.
 */
export function getSmsModel(): string {
  return process.env.AI_SMS_MODEL || process.env.AI_MODEL || "gpt-4o-mini";
}

/**
 * Convenience: build a Bearer auth header for OpenAI API calls.
 */
export function openAIAuthHeader(): { Authorization: string } {
  return { Authorization: `Bearer ${getOpenAIKey() ?? ""}` };
}

/**
 * Convenience: build fetch options for a standard chat completions request.
 */
export function buildOpenAIFetchOptions(body: object): RequestInit {
  return {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...openAIAuthHeader(),
    },
    body: JSON.stringify(body),
  };
}
