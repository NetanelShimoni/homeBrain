/**
 * Groq API client for HomeBrain.
 * Handles all communication with the Groq LLM API.
 */
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_API_KEY = process.env.GROQ_API_KEY || "";
const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

export interface GroqMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface GroqCompletionResponse {
  choices: {
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// ── Cost tracking ────────────────────────────────────────────
// Groq pricing per 1M tokens (USD)
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "llama-3.3-70b-versatile": { input: 0.59, output: 0.79 },
  "llama-3.1-8b-instant":    { input: 0.05, output: 0.08 },
};

let totalSessionCost = 0;

function logCallCost(
  model: string,
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
) {
  const pricing = MODEL_PRICING[model] || { input: 0.59, output: 0.79 };
  const inputCost  = (usage.prompt_tokens / 1_000_000) * pricing.input;
  const outputCost = (usage.completion_tokens / 1_000_000) * pricing.output;
  const callCost   = inputCost + outputCost;
  totalSessionCost += callCost;

  console.log(
    `💰 API call cost: $${callCost.toFixed(6)} ` +
    `(input: ${usage.prompt_tokens} tok → $${inputCost.toFixed(6)}, ` +
    `output: ${usage.completion_tokens} tok → $${outputCost.toFixed(6)}) ` +
    `| model: ${model} ` +
    `| session total: $${totalSessionCost.toFixed(6)}`
  );
}

export async function chatCompletion(
  messages: GroqMessage[],
  options?: {
    temperature?: number;
    maxTokens?: number;
    model?: string;
  }
): Promise<string> {
  if (!GROQ_API_KEY || GROQ_API_KEY === "your_groq_api_key_here") {
    throw new Error("GROQ_API_KEY is not configured. Please set it in .env");
  }

  const model = options?.model || GROQ_MODEL;

  try {
    const response = await axios.post<GroqCompletionResponse>(
      GROQ_API_URL,
      {
        model,
        messages,
        temperature: options?.temperature ?? 0.1,
        max_tokens: options?.maxTokens ?? 2048,
      },
      {
        headers: {
          Authorization: `Bearer ${GROQ_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    // Log cost for this call
    if (response.data.usage) {
      logCallCost(model, response.data.usage);
    }

    return response.data.choices[0]?.message?.content || "";
  } catch (error: unknown) {
    if (axios.isAxiosError(error) && error.response) {
      const errData = error.response.data as Record<string, unknown>;
      console.error(`\n❌ Groq API error (${error.response.status}):`, JSON.stringify(errData, null, 2));
      const errMsg = (errData?.error as Record<string, unknown>)?.message || error.response.statusText;
      throw new Error(`Groq API ${error.response.status}: ${errMsg}`);
    }
    throw error;
  }
}

/**
 * Generate a simple embedding using Groq.
 * Since Groq doesn't have a dedicated embedding endpoint,
 * we use a lightweight hashing approach for similarity search.
 */
export function generateSimpleEmbedding(text: string): number[] {
  const DIMENSION = 128;
  const embedding = new Array(DIMENSION).fill(0);
  const normalized = text.toLowerCase().trim();

  // Create a deterministic embedding based on character n-grams
  for (let i = 0; i < normalized.length; i++) {
    const charCode = normalized.charCodeAt(i);
    for (let d = 0; d < DIMENSION; d++) {
      embedding[d] += Math.sin(charCode * (d + 1) * 0.1 + i * 0.01);
    }
  }

  // Bigram features
  for (let i = 0; i < normalized.length - 1; i++) {
    const bigram = normalized.charCodeAt(i) * 256 + normalized.charCodeAt(i + 1);
    for (let d = 0; d < DIMENSION; d++) {
      embedding[d] += Math.cos(bigram * (d + 1) * 0.001);
    }
  }

  // Normalize to unit vector
  const magnitude = Math.sqrt(embedding.reduce((sum: number, v: number) => sum + v * v, 0));
  if (magnitude > 0) {
    for (let i = 0; i < DIMENSION; i++) {
      embedding[i] /= magnitude;
    }
  }

  return embedding;
}
