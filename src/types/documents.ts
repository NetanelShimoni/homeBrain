/**
 * Document-related types for the HomeBrain RAG system.
 * Used across both frontend and backend.
 */

export type DocumentType = "manual" | "warranty" | "installation" | "other";

/** A topic groups documents that were uploaded together. */
export interface Topic {
  id: string;
  name: string;
  documentIds: string[];
  createdAt: string;
}

export interface DocumentMetadata {
  id: string;
  fileName: string;
  category: string;
  topicId: string;
  documentType: DocumentType;
  language: "hebrew" | "english" | "other";
  createdAt: string;
  fileSize?: number;
  pageCount?: number;
}

export interface DocumentChunk {
  id: string;
  documentId: string;
  content: string;
  embedding?: number[];
  metadata?: {
    page?: number;
    position?: number;
  };
}

export interface UploadedDocument {
  metadata: DocumentMetadata;
  chunks: DocumentChunk[];
  originalPath: string;
}

export interface DocumentListItem {
  id: string;
  fileName: string;
  category: string;
  topicId: string;
  documentType: DocumentType;
  createdAt: string;
}
