/**
 * Keyword-based search (BM25-like scoring).
 *
 * Complements the vector search with exact keyword matching.
 * Critical for cross-language scenarios (Hebrew query → English document)
 * where naive hash-based embeddings fail.
 *
 * Features:
 *  - Hebrew ↔ English common term mapping for home appliance domain
 *  - TF-IDF inspired scoring with BM25 saturation
 *  - Handles OCR artifacts and noisy text gracefully
 */

import type { StoredChunk } from "./vectorStore.js";

// ── BM25 parameters ──────────────────────────────────────────
const K1 = 1.5; // term frequency saturation
const B = 0.75; // length normalization

// ── Hebrew ↔ English domain terms for home appliances ────────
// This helps bridge the language gap when querying in Hebrew
// against English manuals
const CROSS_LANG_MAP: Record<string, string[]> = {
  // Hebrew → English keywords
  "טמפרטורה": ["temperature", "temp", "degrees", "celsius", "fahrenheit"],
  "מכונת כביסה": ["washing machine", "washer", "laundry"],
  "כביסה": ["wash", "washing", "laundry", "cycle"],
  "מייבש": ["dryer", "drying", "dry"],
  "מדיח": ["dishwasher", "dishes"],
  "תנור": ["oven", "bake", "baking", "roast"],
  "מיקרוגל": ["microwave"],
  "מקרר": ["refrigerator", "fridge", "freezer", "cooling"],
  "מזגן": ["air conditioner", "ac", "cooling", "heating", "hvac"],
  "שואב אבק": ["vacuum", "vacuum cleaner"],
  "טלוויזיה": ["television", "tv", "screen", "display"],
  "מסך": ["screen", "display", "monitor"],
  "שלט": ["remote", "remote control", "controller"],
  "הפעלה": ["power", "turn on", "start", "activate", "operation"],
  "כיבוי": ["power off", "turn off", "shut down", "shutdown"],
  "התקנה": ["installation", "install", "setup", "mounting"],
  "תחזוקה": ["maintenance", "service", "cleaning", "clean"],
  "ניקוי": ["cleaning", "clean", "wash", "filter"],
  "פילטר": ["filter", "filters"],
  "מסנן": ["filter", "strainer"],
  "תקלה": ["error", "fault", "problem", "issue", "troubleshoot", "malfunction"],
  "שגיאה": ["error", "fault", "code", "warning"],
  "אחריות": ["warranty", "guarantee"],
  "הוראות": ["instructions", "manual", "guide", "directions"],
  "בטיחות": ["safety", "caution", "warning", "danger"],
  "חשמל": ["electric", "electrical", "power", "voltage", "watt"],
  "מים": ["water", "drain", "inlet", "outlet", "hose"],
  "חיבור": ["connection", "connect", "plug", "port", "cable"],
  "לחצן": ["button", "press", "key"],
  "תוכנית": ["program", "programme", "cycle", "mode"],
  "מצב": ["mode", "status", "state", "setting"],
  "קיבולת": ["capacity", "volume", "size", "load"],
  "משקל": ["weight", "load", "kg"],
  "צריכת חשמל": ["power consumption", "energy", "watt", "kwh"],
  "רעש": ["noise", "sound", "decibel", "db", "loud", "quiet"],
  "דלת": ["door", "lid", "cover"],
  "מגש": ["tray", "shelf", "rack", "drawer"],
  "מדף": ["shelf", "rack", "tray"],
  "טיימר": ["timer", "delay", "schedule", "time"],
  "חיישן": ["sensor", "detector"],
  "מנוע": ["motor", "engine", "compressor"],
  "צינור": ["pipe", "hose", "tube", "duct"],
  "ייבוש": ["drying", "dry"],
  "סחיטה": ["spin", "spinning", "centrifuge"],
  "מהירות": ["speed", "rpm"],
  "לד": ["led", "light", "lamp", "indicator"],
  "נורה": ["light", "lamp", "led", "bulb", "indicator"],
};

// Build reverse map (English → Hebrew)
const REVERSE_MAP: Record<string, string[]> = {};
for (const [heb, engList] of Object.entries(CROSS_LANG_MAP)) {
  for (const eng of engList) {
    if (!REVERSE_MAP[eng]) REVERSE_MAP[eng] = [];
    if (!REVERSE_MAP[eng].includes(heb)) {
      REVERSE_MAP[eng].push(heb);
    }
  }
}

// ── Tokenization ─────────────────────────────────────────────

/** Normalize and tokenize text into searchable terms */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ") // keep letters, numbers, spaces
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

/** Expand a query with cross-language terms */
function expandQuery(query: string): string[] {
  const baseTokens = tokenize(query);
  const expanded = new Set(baseTokens);

  // Also try multi-word Hebrew matches
  const lowerQuery = query.toLowerCase();

  for (const [hebrew, englishTerms] of Object.entries(CROSS_LANG_MAP)) {
    if (lowerQuery.includes(hebrew)) {
      for (const eng of englishTerms) {
        for (const t of tokenize(eng)) {
          expanded.add(t);
        }
      }
    }
  }

  // Try individual token lookups too
  for (const token of baseTokens) {
    // Hebrew token → English
    if (CROSS_LANG_MAP[token]) {
      for (const eng of CROSS_LANG_MAP[token]) {
        for (const t of tokenize(eng)) {
          expanded.add(t);
        }
      }
    }
    // English token → Hebrew
    if (REVERSE_MAP[token]) {
      for (const heb of REVERSE_MAP[token]) {
        for (const t of tokenize(heb)) {
          expanded.add(t);
        }
      }
    }
  }

  return Array.from(expanded);
}

// ── BM25 Scoring ─────────────────────────────────────────────

interface TokenizedDoc {
  chunk: StoredChunk;
  tokens: string[];
  length: number;
}

/**
 * Search chunks using BM25-like keyword scoring with cross-language expansion.
 *
 * @param query  User's search query
 * @param chunks All candidate chunks
 * @param topK   Number of results to return
 * @returns Scored chunks sorted by relevance
 */
export function keywordSearch(
  query: string,
  chunks: StoredChunk[],
  topK: number = 10
): { chunk: StoredChunk; score: number }[] {
  if (chunks.length === 0) return [];

  // Expand query with cross-language terms
  const queryTerms = expandQuery(query);

  if (queryTerms.length === 0) return [];

  // Tokenize all documents
  const docs: TokenizedDoc[] = chunks.map((chunk) => {
    const tokens = tokenize(chunk.content);
    return { chunk, tokens, length: tokens.length };
  });

  // Calculate average document length
  const avgDl = docs.reduce((sum, d) => sum + d.length, 0) / docs.length;

  // Calculate IDF for each query term
  const idf: Record<string, number> = {};
  for (const term of queryTerms) {
    const df = docs.filter((d) => d.tokens.includes(term)).length;
    // BM25 IDF formula
    idf[term] = Math.log((docs.length - df + 0.5) / (df + 0.5) + 1);
  }

  // Score each document
  const scored = docs.map((doc) => {
    let score = 0;
    const termFreqs: Record<string, number> = {};

    // Count term frequencies
    for (const token of doc.tokens) {
      termFreqs[token] = (termFreqs[token] || 0) + 1;
    }

    // BM25 scoring
    for (const term of queryTerms) {
      const tf = termFreqs[term] || 0;
      if (tf === 0) continue;

      const idfScore = idf[term] || 0;
      const tfNorm = (tf * (K1 + 1)) / (tf + K1 * (1 - B + B * (doc.length / avgDl)));
      score += idfScore * tfNorm;
    }

    return { chunk: doc.chunk, score };
  });

  // Filter out zero scores and sort
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

/**
 * Hybrid search: combine vector similarity scores with keyword scores.
 * Returns merged, deduplicated results.
 */
export function mergeSearchResults(
  vectorResults: { chunk: StoredChunk; score: number }[],
  keywordResults: { chunk: StoredChunk; score: number }[],
  topK: number = 5,
  vectorWeight: number = 0.4,
  keywordWeight: number = 0.6
): StoredChunk[] {
  const scoreMap = new Map<string, { chunk: StoredChunk; combinedScore: number }>();

  // Normalize vector scores to 0-1
  const maxVector = Math.max(...vectorResults.map((r) => r.score), 0.001);
  for (const { chunk, score } of vectorResults) {
    const normalized = score / maxVector;
    scoreMap.set(chunk.id, {
      chunk,
      combinedScore: normalized * vectorWeight,
    });
  }

  // Normalize keyword scores to 0-1
  const maxKeyword = Math.max(...keywordResults.map((r) => r.score), 0.001);
  for (const { chunk, score } of keywordResults) {
    const normalized = score / maxKeyword;
    const existing = scoreMap.get(chunk.id);
    if (existing) {
      existing.combinedScore += normalized * keywordWeight;
    } else {
      scoreMap.set(chunk.id, {
        chunk,
        combinedScore: normalized * keywordWeight,
      });
    }
  }

  // Sort by combined score
  return Array.from(scoreMap.values())
    .sort((a, b) => b.combinedScore - a.combinedScore)
    .slice(0, topK)
    .map((s) => s.chunk);
}
