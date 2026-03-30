/**
 * AI-related types for the HomeBrain RAG system.
 * Covers queries, responses, and classification.
 */

export interface AIQuery {
  question: string;
  topicFilter?: string;
}

export interface AISource {
  documentId: string;
  fileName: string;
  snippet?: string;
}

export interface AIResponse {
  answer: string;
  sources: AISource[];
}

export interface ClassificationResult {
  category: string;
  documentType: string;
  language: string;
  confidence: number;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: AISource[];
  timestamp: Date;
}
