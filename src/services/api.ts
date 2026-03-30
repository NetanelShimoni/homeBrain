/**
 * API service for communicating with the HomeBrain backend.
 */
import axios from "axios";
import type { AIResponse } from "../types/ai";
import type { DocumentMetadata, Topic } from "../types/documents";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3001/api";

const api = axios.create({
  baseURL: API_BASE,
  timeout: 60000, // 60s timeout for LLM calls
});

// --- Auth APIs ---

export async function login(
  username: string,
  password: string
): Promise<{ success: boolean; user: { username: string } }> {
  const { data } = await api.post("/auth/login", { username, password });
  return data;
}

// --- Document APIs ---

export interface UploadResult {
  success: boolean;
  topic: {
    id: string;
    name: string;
    documentCount: number;
  };
  documents: Array<{
    id: string;
    fileName: string;
    category: string;
    documentType: string;
    language: string;
    confidence: number;
    chunksCount: number;
  }>;
}

export async function uploadDocuments(
  files: File[],
  topicId?: string,
  topicName?: string
): Promise<UploadResult> {
  const formData = new FormData();
  for (const file of files) {
    formData.append("files", file);
  }

  const params = new URLSearchParams();
  if (topicId) params.set("topicId", topicId);
  if (topicName) params.set("topicName", topicName);

  const url = `/documents/upload${params.toString() ? `?${params}` : ""}`;

  const response = await api.post<UploadResult>(url, formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });

  return response.data;
}

export async function getDocuments(): Promise<DocumentMetadata[]> {
  const response = await api.get<{ documents: DocumentMetadata[] }>("/documents");
  return response.data.documents;
}

export async function getTopics(): Promise<Topic[]> {
  const response = await api.get<{ topics: Topic[] }>("/documents/topics");
  return response.data.topics;
}

export async function renameTopic(id: string, name: string): Promise<void> {
  await api.put(`/documents/topics/${id}`, { name });
}

export async function deleteTopic(id: string): Promise<void> {
  await api.delete(`/documents/topics/${id}`);
}

export async function getCategories(): Promise<string[]> {
  const response = await api.get<{ categories: string[] }>("/documents/categories");
  return response.data.categories;
}

export async function deleteDocument(id: string): Promise<void> {
  await api.delete(`/documents/${id}`);
}

export function getDownloadUrl(id: string): string {
  return `${API_BASE}/documents/${id}/download`;
}

// --- AI APIs ---

export async function queryAI(
  question: string,
  topicFilter?: string
): Promise<AIResponse> {
  const response = await api.post<AIResponse>("/ai/query", {
    question,
    topicFilter,
  });

  return response.data;
}

// --- Health ---

export async function checkHealth(): Promise<{
  status: string;
  chunksInStore: number;
  groqConfigured: boolean;
}> {
  const response = await api.get("/ai/health");
  return response.data;
}

// --- Voice Transcription ---

export async function transcribeAudio(audioBlob: Blob): Promise<string> {
  const formData = new FormData();
  formData.append("audio", audioBlob, "recording.webm");

  const response = await api.post<{ text: string }>("/ai/transcribe", formData, {
    headers: { "Content-Type": "multipart/form-data" },
    timeout: 30000,
  });

  return response.data.text;
}

// --- Prompt Enhancement ---

export async function enhancePrompt(
  prompt: string,
  topicName?: string
): Promise<string> {
  const response = await api.post<{ enhanced: string }>("/ai/enhance-prompt", {
    prompt,
    topicName,
  });

  return response.data.enhanced;
}

// --- Manual Search APIs ---

export interface ManualsLibUrlResponse {
  url: string;
  translatedQuery: string;
  originalQuery: string;
}

/**
 * Get a ManualsLib search URL for the given query.
 * Hebrew text is translated to English on the server side.
 */
export async function getManualsLibUrl(
  query: string
): Promise<ManualsLibUrlResponse> {
  const response = await api.post<ManualsLibUrlResponse>("/manuals/search-url", {
    query,
  });
  return response.data;
}

export interface ManualSearchResult {
  id: string;
  title: string;
  url: string;
  viewUrl: string;
  source: "ManualsLib" | "Google" | "DuckDuckGo" | "Manufacturer" | "AI";
  pages: number | null;
  brand: string;
  model: string;
  language: string | null;
  thumbnailUrl: string | null;
  directPdf: boolean;
}

export interface ManualSearchResponse {
  results: ManualSearchResult[];
  count: number;
  query: { brand: string; model: string; productType?: string };
}

export interface ManualImportResponse {
  success: boolean;
  document: {
    id: string;
    fileName: string;
    category: string;
    documentType: string;
    language: string;
    confidence: number;
    chunksCount: number;
  };
  topic: {
    id: string;
    name: string;
    documentCount: number;
  };
}

export async function searchManuals(
  brand: string,
  model: string,
  productType?: string
): Promise<ManualSearchResponse> {
  const response = await api.post<ManualSearchResponse>("/manuals/search", {
    brand,
    model,
    productType,
  });
  return response.data;
}

export async function importManual(
  url: string,
  title: string,
  brand: string,
  model: string,
  topicName?: string
): Promise<ManualImportResponse> {
  const response = await api.post<ManualImportResponse>("/manuals/import", {
    url,
    title,
    brand,
    model,
    topicName,
  });
  return response.data;
}
