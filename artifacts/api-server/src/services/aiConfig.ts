/**
 * aiConfig.ts — Centralized AI configuration resolver.
 *
 * Provider priority for chat completions and transcription:
 *   1. OpenAI  (OPENAI_API_KEY or AI_INTEGRATIONS_OPENAI_API_KEY)
 *   2. Groq    (GROQ_API_KEY)  ← free, fast fallback
 *
 * Base URL precedence for OpenAI calls:
 *   1. OPENAI_BASE_URL
 *   2. AI_INTEGRATIONS_OPENAI_BASE_URL
 *   3. https://api.openai.com/v1  (default)
 *
 * Groq is used automatically when OpenAI fails or is not configured.
 * The AI Voice Agent (twilio-voice-agent.ts) requires OpenAI Realtime and
 * cannot fall back to Groq — Groq has no equivalent WebSocket Realtime API.
 */

// ── OpenAI ────────────────────────────────────────────────────────────────────

/** Returns the best available OpenAI-compatible API key, or undefined if none. */
export function getOpenAIKey(): string | undefined {
  return (
    process.env.OPENAI_API_KEY ||
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY ||
    undefined
  );
}

/**
 * Returns the base URL for real OpenAI API calls.
 *
 * IMPORTANT: AI_INTEGRATIONS_OPENAI_BASE_URL is sometimes set to a
 * Groq-compatible endpoint (api.groq.com).  We must never send a real
 * OpenAI sk-proj key to groq.com — it will always 401.  When the
 * integration base URL points to a non-OpenAI host we fall through to
 * the canonical OpenAI endpoint so the real key works correctly.
 * Groq is handled separately by getGroqBaseUrl() / getGroqKey().
 */
export function getOpenAIBaseUrl(): string {
  // Explicit override always wins, regardless of content
  if (process.env.OPENAI_BASE_URL) return process.env.OPENAI_BASE_URL;

  // Only use AI_INTEGRATIONS_OPENAI_BASE_URL when it actually points at
  // OpenAI (or a compatible proxy such as Azure OpenAI / LiteLLM).
  // If it points at groq.com/openrouter.ai/etc., ignore it here — those
  // providers have their own dedicated helpers.
  const integrationUrl = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || "";
  const isNonOpenAIEndpoint =
    integrationUrl.includes("groq.com") ||
    integrationUrl.includes("openrouter.ai") ||
    integrationUrl.includes("anthropic.com") ||
    integrationUrl.includes("together.ai") ||
    integrationUrl.includes("mistral.ai");

  if (integrationUrl && !isNonOpenAIEndpoint) return integrationUrl;

  return "https://api.openai.com/v1";
}

/** Returns true if any OpenAI key is configured. */
export function hasOpenAI(): boolean {
  return !!getOpenAIKey();
}

// ── Groq ──────────────────────────────────────────────────────────────────────

/** Returns the Groq API key, or undefined if not configured. */
export function getGroqKey(): string | undefined {
  return process.env.GROQ_API_KEY || undefined;
}

/** Returns the Groq base URL (OpenAI-compatible endpoint). */
export function getGroqBaseUrl(): string {
  return process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1";
}

/**
 * Returns the Groq chat model.
 * llama-3.3-70b-versatile is Groq's most capable and still very fast.
 */
export function getGroqModel(): string {
  return process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
}

/** Returns true if Groq is configured. */
export function hasGroq(): boolean {
  return !!getGroqKey();
}

// ── Shared helpers ────────────────────────────────────────────────────────────

/** Returns true if ANY AI provider (OpenAI or Groq) is available. */
export function hasAI(): boolean {
  return hasOpenAI() || hasGroq();
}

/** Returns the default chat completion model (OpenAI). */
export function getChatModel(): string {
  return process.env.AI_MODEL || "gpt-4o-mini";
}

/** Returns the SMS-specific completion model. */
export function getSmsModel(): string {
  return process.env.AI_SMS_MODEL || process.env.AI_MODEL || "gpt-4o-mini";
}

/** Convenience: build a Bearer auth header for OpenAI. */
export function openAIAuthHeader(): { Authorization: string } {
  return { Authorization: `Bearer ${getOpenAIKey() ?? ""}` };
}

// ── Unified AI call (OpenAI → Groq fallback) ─────────────────────────────────

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CallAIOptions {
  /** Overrides getChatModel() for OpenAI, and getGroqModel() for Groq. */
  model?: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  /** If true, wrap response in json_object response_format (OpenAI only; Groq skips if no "json" in prompt). */
  jsonMode?: boolean;
}

/**
 * Unified AI chat completion.
 * Tries OpenAI first; automatically falls back to Groq if OpenAI is
 * unavailable or returns an error. Throws only if both providers fail.
 */
export async function callAI(
  messages: ChatMessage[],
  opts: CallAIOptions = {}
): Promise<string> {
  const {
    maxTokens = 300,
    temperature = 0.7,
    timeoutMs = 15_000,
    jsonMode = false,
  } = opts;

  const openaiKey = getOpenAIKey();
  if (openaiKey) {
    try {
      // If AI_INTEGRATIONS_OPENAI_BASE_URL points to Groq, gpt-4o-mini doesn't exist there.
      // Detect Groq-compatible base URLs and use the Groq model name instead.
      const openaiBaseUrl = getOpenAIBaseUrl();
      const isGroqCompatibleUrl = openaiBaseUrl.includes("groq.com");
      const resolvedModel = opts.model || (isGroqCompatibleUrl ? getGroqModel() : getChatModel());
      const body: Record<string, unknown> = {
        model: resolvedModel,
        max_tokens: maxTokens,
        temperature,
        messages,
      };
      if (jsonMode) body.response_format = { type: "json_object" };

      const resp = await fetch(`${getOpenAIBaseUrl()}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiKey}` },
        signal: AbortSignal.timeout(timeoutMs),
        body: JSON.stringify(body),
      });

      if (resp.ok) {
        const data = await resp.json() as any;
        const text: string = (data.choices?.[0]?.message?.content || "").trim();
        if (text) return text;
        throw new Error("Empty response from OpenAI");
      }

      const errText = await resp.text().catch(() => "");
      throw new Error(`OpenAI ${resp.status}: ${errText.slice(0, 200)}`);
    } catch (err: any) {
      // Log and fall through to Groq
      const groqKey = getGroqKey();
      if (!groqKey) throw err; // No fallback available
      // eslint-disable-next-line no-console
      console.warn(`[aiConfig] OpenAI failed (${err?.message}), falling back to Groq`);
    }
  }

  // ── Groq fallback ──────────────────────────────────────────────────────────
  const groqKey = getGroqKey();
  if (!groqKey) {
    throw new Error("No AI provider configured. Set OPENAI_API_KEY or GROQ_API_KEY.");
  }

  const groqBody: Record<string, unknown> = {
    model: getGroqModel(),
    max_tokens: maxTokens,
    temperature,
    messages,
  };
  // Groq requires the word "json" to appear in a message when using json_object mode
  if (jsonMode) groqBody.response_format = { type: "json_object" };

  const resp = await fetch(`${getGroqBaseUrl()}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${groqKey}` },
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify(groqBody),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`Groq ${resp.status}: ${errText.slice(0, 200)}`);
  }

  const data = await resp.json() as any;
  return (data.choices?.[0]?.message?.content || "").trim();
}

// ── Unified transcription (Whisper → Groq Whisper fallback) ──────────────────

/**
 * Transcribes audio using OpenAI Whisper, with Groq Whisper as fallback.
 * Both use the same OpenAI-compatible `/audio/transcriptions` endpoint.
 *
 * Groq offers whisper-large-v3 for free with very fast inference.
 */
export async function transcribeAudio(
  audioBuffer: Buffer,
  filename = "recording.mp3"
): Promise<string> {
  const openaiKey = getOpenAIKey();
  if (openaiKey) {
    try {
      const formData = new FormData();
      formData.append("file", new Blob([audioBuffer], { type: "audio/mpeg" }), filename);
      formData.append("model", "whisper-1");

      const resp = await fetch(`${getOpenAIBaseUrl()}/audio/transcriptions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${openaiKey}` },
        body: formData,
      });

      if (resp.ok) {
        const { text } = await resp.json() as { text: string };
        if (text) return text;
        throw new Error("Empty transcription from OpenAI");
      }

      const errText = await resp.text().catch(() => "");
      throw new Error(`OpenAI Whisper ${resp.status}: ${errText.slice(0, 200)}`);
    } catch (err: any) {
      const groqKey = getGroqKey();
      if (!groqKey) throw err;
      // eslint-disable-next-line no-console
      console.warn(`[aiConfig] OpenAI Whisper failed (${err?.message}), falling back to Groq Whisper`);
    }
  }

  const groqKey = getGroqKey();
  if (!groqKey) {
    throw new Error("No transcription provider configured. Set OPENAI_API_KEY or GROQ_API_KEY.");
  }

  const formData = new FormData();
  formData.append("file", new Blob([audioBuffer], { type: "audio/mpeg" }), filename);
  formData.append("model", process.env.GROQ_WHISPER_MODEL || "whisper-large-v3");

  const resp = await fetch(`${getGroqBaseUrl()}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${groqKey}` },
    body: formData,
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`Groq Whisper ${resp.status}: ${errText.slice(0, 200)}`);
  }

  const { text } = await resp.json() as { text: string };
  return text;
}
