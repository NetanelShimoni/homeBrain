/**
 * In-memory vector store for document chunks.
 * Persisted to disk via ./data/chunks.json so data survives restarts.
 */
import { generateSimpleEmbedding } from "./groqClient.js";
import { loadData, saveData } from "./persistence.js";

export interface StoredChunk {
  id: string;
  documentId: string;
  content: string;
  embedding: number[];
  metadata: {
    fileName: string;
    category: string;
    topicId: string;
    documentType: string;
    position: number;
  };
}

// In-memory storage — hydrated from disk on startup
const chunks: StoredChunk[] = [];

// ── Load persisted chunks on module init ──────────────────────
const saved = loadData<StoredChunk[]>("chunks");
if (saved && Array.isArray(saved)) {
  chunks.push(...saved);
  console.log(`📦 Restored ${chunks.length} chunks from disk`);
}

function persistChunks(): void {
  saveData("chunks", chunks);
}

/**
 * Store a chunk with its embedding.
 */
export function storeChunk(chunk: StoredChunk): void {
  chunks.push(chunk);
  persistChunks();
}

/**
 * Store multiple chunks at once.
 */
export function storeChunks(newChunks: StoredChunk[]): void {
  chunks.push(...newChunks);
  persistChunks();
}

/**
 * Search for the most similar chunks to a query.
 * Optionally filter by topicId.
 */
export function searchSimilar(
  query: string,
  topK: number = 5,
  topicFilter?: string
): StoredChunk[] {
  const queryEmbedding = generateSimpleEmbedding(query);

  let candidates = chunks;

  // Apply topic filter if specified
  if (topicFilter) {
    candidates = candidates.filter(
      (c) => c.metadata.topicId === topicFilter
    );
  }

  if (candidates.length === 0) {
    return [];
  }

  // Calculate cosine similarity for each chunk
  const scored = candidates.map((chunk) => ({
    chunk,
    score: cosineSimilarity(queryEmbedding, chunk.embedding),
  }));

  // Sort by score descending and return top-K
  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, topK).map((s) => s.chunk);
}

/**
 * Search for similar chunks and return with scores (for hybrid search).
 */
export function searchSimilarScored(
  query: string,
  topK: number = 10,
  topicFilter?: string
): { chunk: StoredChunk; score: number }[] {
  const queryEmbedding = generateSimpleEmbedding(query);

  let candidates = chunks;

  if (topicFilter) {
    candidates = candidates.filter((c) => c.metadata.topicId === topicFilter);
  }

  if (candidates.length === 0) return [];

  const scored = candidates.map((chunk) => ({
    chunk,
    score: cosineSimilarity(queryEmbedding, chunk.embedding),
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

/**
 * Get all candidate chunks, optionally filtered by topic.
 * Used by keyword search.
 */
export function getCandidateChunks(topicFilter?: string): StoredChunk[] {
  if (topicFilter) {
    return chunks.filter((c) => c.metadata.topicId === topicFilter);
  }
  return [...chunks];
}

/**
 * Get all unique categories from stored documents.
 */
export function getCategories(): string[] {
  const categories = new Set<string>();
  for (const chunk of chunks) {
    categories.add(chunk.metadata.category);
  }
  return Array.from(categories);
}

/**
 * Get all stored documents (unique by documentId).
 */
export function getDocumentList(): Array<{
  id: string;
  fileName: string;
  category: string;
  topicId: string;
  documentType: string;
}> {
  const seen = new Map<string, StoredChunk>();
  for (const chunk of chunks) {
    if (!seen.has(chunk.documentId)) {
      seen.set(chunk.documentId, chunk);
    }
  }

  return Array.from(seen.values()).map((chunk) => ({
    id: chunk.documentId,
    fileName: chunk.metadata.fileName,
    category: chunk.metadata.category,
    topicId: chunk.metadata.topicId,
    documentType: chunk.metadata.documentType,
  }));
}

/**
 * Remove all chunks for a specific document.
 */
export function removeDocument(documentId: string): void {
  const indicesToRemove: number[] = [];
  for (let i = chunks.length - 1; i >= 0; i--) {
    if (chunks[i].documentId === documentId) {
      indicesToRemove.push(i);
    }
  }
  for (const idx of indicesToRemove) {
    chunks.splice(idx, 1);
  }
  persistChunks();
}

/**
 * Get total chunk count.
 */
export function getChunkCount(): number {
  return chunks.length;
}

// --- Utility ---

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dotProduct / denominator;
}
