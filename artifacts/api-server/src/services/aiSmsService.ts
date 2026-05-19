/**
 * aiSmsService.ts — AI-powered SMS reply generation.
 *
 * Provider chain: OpenAI (gpt-4o-mini) → Groq (llama-3.3-70b-versatile) fallback.
 * Uses the unified callAI() helper from aiConfig so provider selection is automatic.
 *
 * Features:
 * - Per-personality system prompts (professional_investor / friendly / aggressive)
 * - Circuit breaker: stops calling AI after 5 consecutive failures in 60 s
 * - Guardrails: empty or too-long replies fall back to a safe static reply
 * - Cap: 320 chars (2 SMS segments max)
 */

import { logger } from "../lib/logger";
import { callAI, getSmsModel, hasAI } from "./aiConfig";

class CircuitBreaker {
  private failures = 0;
  private lastFailure = 0;
  private readonly threshold = 5;
  private readonly windowMs = 60_000;

  isOpen(): boolean {
    if (this.failures >= this.threshold) {
      if (Date.now() - this.lastFailure < this.windowMs) return true;
      this.failures = 0;
    }
    return false;
  }

  recordFailure() {
    this.failures++;
    this.lastFailure = Date.now();
  }

  recordSuccess() {
    this.failures = 0;
  }
}

export const aiSmsBreaker = new CircuitBreaker();

export const AI_SMS_COST_USD = 0.005;
export const AI_SMS_FALLBACK =
  "Thanks for reaching out! Can we schedule a quick call? — TolipAI Team";

const PERSONALITIES: Record<string, string> = {
  professional_investor: `You are a professional real estate investor following up with a property owner.
Be concise, respectful, and professional. Focus on a fair cash offer and quick closing.
Keep replies under 160 characters when possible. Absolute max 320 characters (2 SMS segments).
Do not use emojis. Do not make up prices unless they are in the lead context provided.`,

  friendly: `You are a friendly local real estate investor who buys homes in the area.
Be warm, casual, and genuinely helpful. Show real interest in solving the homeowner's situation.
Keep replies short and conversational — under 160 characters ideally, max 320 characters.`,

  aggressive: `You are a motivated cash buyer who needs to close deals quickly.
Be direct, create urgency, and emphasize speed and certainty of a cash sale.
Stay under 160 characters, max 320. Be assertive but never rude.`,
};

export interface SmsConversationMessage {
  direction: "inbound" | "outbound";
  body: string;
  createdAt?: Date | string | null;
}

export interface LeadSmsContext {
  sellerName?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  askingPrice?: string | null;
  arv?: string | null;
}

export interface GenerateAiSmsReplyParams {
  lead: LeadSmsContext;
  inboundMessage: string;
  conversationHistory: SmsConversationMessage[];
  personality: string;
  promptOverride?: string | null;
}

export async function generateAiSmsReply({
  lead,
  inboundMessage,
  conversationHistory,
  personality,
  promptOverride,
}: GenerateAiSmsReplyParams): Promise<string> {
  if (aiSmsBreaker.isOpen()) {
    logger.warn("[aiSmsService] circuit breaker open — returning fallback");
    return AI_SMS_FALLBACK;
  }

  if (!hasAI()) {
    logger.warn("[aiSmsService] no AI provider configured (set OPENAI_API_KEY or GROQ_API_KEY) — returning fallback");
    return AI_SMS_FALLBACK;
  }

  const personalityPrompt =
    PERSONALITIES[personality] ?? PERSONALITIES.professional_investor;

  const ctx = [
    lead.sellerName ? `Seller: ${lead.sellerName}` : null,
    lead.address
      ? `Property: ${[lead.address, lead.city, lead.state].filter(Boolean).join(", ")}`
      : null,
    lead.askingPrice
      ? `Asking: $${Number(lead.askingPrice).toLocaleString()}`
      : null,
    lead.arv ? `ARV: $${Number(lead.arv).toLocaleString()}` : null,
  ]
    .filter(Boolean)
    .join(" | ");

  const systemPrompt = [
    personalityPrompt,
    ctx ? `\nLead context: ${ctx}` : "",
    promptOverride ? `\nYour specific goal for this message: ${promptOverride}` : "",
    "\nRULES: Reply ONLY with the SMS text — no labels, no quotes, no explanations.",
    "If the lead texts HUMAN, CALL ME, or TALK TO PERSON, acknowledge and say someone will follow up soon.",
  ].join("\n");

  const messages = [
    { role: "system" as const, content: systemPrompt },
    ...conversationHistory.slice(-10).map((m) => ({
      role: (m.direction === "outbound" ? "assistant" : "user") as "assistant" | "user",
      content: m.body,
    })),
    { role: "user" as const, content: inboundMessage },
  ];

  try {
    const raw = await callAI(messages, {
      model: getSmsModel(),
      maxTokens: 150,
      temperature: 0.7,
      timeoutMs: 15_000,
    });

    if (!raw || raw.length < 2) {
      logger.warn("[aiSmsService] empty reply from AI — returning fallback");
      return AI_SMS_FALLBACK;
    }
    if (raw.length > 500) {
      logger.warn({ len: raw.length }, "[aiSmsService] reply too long — truncating");
    }

    const reply = raw.length > 320 ? raw.slice(0, 317) + "..." : raw;
    aiSmsBreaker.recordSuccess();
    return reply;
  } catch (err) {
    logger.error(err, "[aiSmsService] generateAiSmsReply failed");
    aiSmsBreaker.recordFailure();
    return AI_SMS_FALLBACK;
  }
}

// Keywords that trigger immediate opt-out
export const OPT_OUT_KEYWORDS = ["STOP", "UNSUBSCRIBE", "CANCEL", "QUIT", "END"];

// Keywords that trigger human-handoff flag
export const HUMAN_HANDOFF_KEYWORDS = [
  "CALL ME",
  "TALK TO PERSON",
  "HUMAN",
  "REAL PERSON",
  "AGENT",
];

export function isOptOutMessage(body: string): boolean {
  const upper = body.trim().toUpperCase();
  return OPT_OUT_KEYWORDS.some(
    (k) =>
      upper === k || upper.startsWith(k + " ") || upper.endsWith(" " + k)
  );
}

export function isHumanHandoffRequest(body: string): boolean {
  const upper = body.trim().toUpperCase();
  return HUMAN_HANDOFF_KEYWORDS.some((k) => upper.includes(k));
}
