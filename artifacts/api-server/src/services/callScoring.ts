/**
 * callScoring.ts — AI-powered call qualification scoring.
 *
 * Analyses a call transcript and returns a 0-100 score plus structured notes.
 * Uses OpenAI GPT-4o-mini (fast, cheap) with Groq as fallback.
 *
 * Score rubric:
 *   80-100 Hot lead   — motivated, clear property, timeline < 3 months
 *   60-79  Warm lead  — interested but vague on timeline/price
 *   40-59  Lukewarm   — browsing or early-stage, no urgency
 *   20-39  Cold       — just gathering info, no clear intent
 *   0-19   Not a lead — wrong number, unrelated, or hostile
 */

import { logger } from "../lib/logger";
import { getOpenAIKey, getOpenAIBaseUrl, getGroqKey } from "./aiConfig";

export interface CallScoreResult {
  score: number;           // 0-100
  tier: "hot" | "warm" | "lukewarm" | "cold" | "not_a_lead";
  summary: string;         // 1-2 sentence human-readable summary
  strengths: string[];     // positive signals found
  concerns: string[];      // negative signals / missing info
  suggestedNextStep: string;
}

const SCORING_PROMPT = `You are a real estate lead qualification analyst. 
Analyse the following call transcript between an AI agent (Alex) and a property seller.
Return a JSON object with exactly these fields:
{
  "score": <integer 0-100>,
  "tier": <"hot"|"warm"|"lukewarm"|"cold"|"not_a_lead">,
  "summary": "<1-2 sentences>",
  "strengths": ["<signal>", ...],
  "concerns": ["<issue>", ...],
  "suggestedNextStep": "<single actionable next step>"
}

Scoring criteria:
- Seller motivation and urgency (0-25 pts)
- Property information completeness (0-20 pts)
- Realistic price expectations (0-20 pts)
- Timeline clarity (0-15 pts)
- Seller engagement / responsiveness (0-10 pts)
- Contact info / callback potential (0-10 pts)

Tiers:
  hot (80-100): motivated seller, clear property, timeline ≤ 3 months
  warm (60-79): interested but vague timeline or slightly high expectations
  lukewarm (40-59): early-stage, no urgency shown
  cold (20-39): gathering info only, little intent
  not_a_lead (0-19): wrong number, spam, or no real estate intent

Return ONLY the JSON object, no markdown fences.`;

async function callOpenAI(transcript: string): Promise<CallScoreResult | null> {
  const key = getOpenAIKey();
  if (!key) return null;

  const baseUrl = getOpenAIBaseUrl();
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: SCORING_PROMPT },
        { role: "user", content: `TRANSCRIPT:\n${transcript}` },
      ],
      temperature: 0.2,
      max_tokens: 400,
    }),
    signal: AbortSignal.timeout(20_000),
  });

  if (!res.ok) {
    throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  }

  const data = await res.json() as any;
  const raw = data.choices?.[0]?.message?.content?.trim() ?? "";
  return JSON.parse(raw) as CallScoreResult;
}

async function callGroq(transcript: string): Promise<CallScoreResult | null> {
  const key = getGroqKey();
  if (!key) return null;

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: SCORING_PROMPT },
        { role: "user", content: `TRANSCRIPT:\n${transcript}` },
      ],
      temperature: 0.2,
      max_tokens: 400,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    throw new Error(`Groq ${res.status}: ${await res.text()}`);
  }

  const data = await res.json() as any;
  const raw = data.choices?.[0]?.message?.content?.trim() ?? "";
  return JSON.parse(raw) as CallScoreResult;
}

/**
 * Score a call transcript.  Returns null if transcript is too short or AI unavailable.
 * Never throws — callers should fire-and-forget.
 */
export async function scoreCallTranscript(
  transcript: string
): Promise<CallScoreResult | null> {
  if (!transcript || transcript.length < 80) {
    logger.debug("[callScoring] Transcript too short to score");
    return null;
  }

  // Truncate very long transcripts to keep costs low (~4k chars ≈ 1k tokens)
  const t = transcript.length > 6000
    ? transcript.slice(0, 3000) + "\n...[truncated]...\n" + transcript.slice(-2000)
    : transcript;

  try {
    const result = await callOpenAI(t);
    if (result) {
      logger.info({ score: result.score, tier: result.tier }, "[callScoring] Scored via OpenAI");
      return result;
    }
  } catch (err) {
    logger.warn({ err }, "[callScoring] OpenAI scoring failed, trying Groq");
  }

  try {
    const result = await callGroq(t);
    if (result) {
      logger.info({ score: result.score, tier: result.tier }, "[callScoring] Scored via Groq");
      return result;
    }
  } catch (err) {
    logger.warn({ err }, "[callScoring] Groq scoring also failed");
  }

  return null;
}

/** Convert a score result into a compact string for storage in qualification_notes */
export function formatScoreNotes(result: CallScoreResult): string {
  const lines = [
    `Summary: ${result.summary}`,
    result.strengths.length ? `Strengths: ${result.strengths.join("; ")}` : null,
    result.concerns.length  ? `Concerns: ${result.concerns.join("; ")}` : null,
    `Next step: ${result.suggestedNextStep}`,
  ];
  return lines.filter(Boolean).join("\n");
}
