/**
 * healthHelpers.ts — Thin re-exports so systemHealth.ts can reference
 * service-config helpers without circular imports.
 */

export function getOpenAIKey(): string | undefined {
  return (
    process.env.OPENAI_API_KEY ||
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY ||
    undefined
  );
}

export function getOpenAIBaseUrl(): string {
  if (process.env.OPENAI_BASE_URL) return process.env.OPENAI_BASE_URL;
  const integrationUrl = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || "";
  const isNonOpenAI =
    integrationUrl.includes("groq.com") ||
    integrationUrl.includes("openrouter.ai") ||
    integrationUrl.includes("anthropic.com") ||
    integrationUrl.includes("together.ai") ||
    integrationUrl.includes("mistral.ai");
  if (integrationUrl && !isNonOpenAI) return integrationUrl;
  return "https://api.openai.com/v1";
}

export function getGroqKey(): string | undefined {
  return process.env.GROQ_API_KEY || undefined;
}

export function getGroqBaseUrl(): string {
  return process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1";
}

export function hasAttomKeys(): boolean {
  return !!(process.env.ATTOM_API_KEY?.trim() || process.env.ATTOM_API_KEY_2?.trim());
}
