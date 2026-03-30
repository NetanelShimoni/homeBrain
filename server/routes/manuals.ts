/**
 * Manual search routes — search on ManualsLib, import downloaded PDFs.
 *
 * POST /api/manuals/search-url  — get a ManualsLib search URL (translating Hebrew → English)
 * POST /api/manuals/search      — (legacy) search for manuals by brand + model
 * POST /api/manuals/import      — download a confirmed manual and process it
 */
import { Router, Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import {
  searchManuals,
  downloadManualPDF,
  buildManualsLibUrl,
  type ManualResult,
} from "../services/manualSearch.js";
import { extractTextFromFile } from "../services/textExtractor.js";
import { classifyDocument } from "../services/classifier.js";
import { chunkText } from "../services/chunker.js";
import { generateSimpleEmbedding } from "../services/groqClient.js";
import {
  storeChunks,
  type StoredChunk,
} from "../services/vectorStore.js";
import { loadData, saveData } from "../services/persistence.js";

const router = Router();

// ── Shared stores (same as documents route — kept in sync via persistence) ──

interface DocumentMeta {
  id: string;
  fileName: string;
  category: string;
  topicId: string;
  documentType: string;
  language: string;
  confidence: number;
  createdAt: string;
  filePath: string;
}

interface TopicRecord {
  id: string;
  name: string;
  documentIds: string[];
  createdAt: string;
}

// Hydrate stores from disk (shares data with documents route)
const documentMetadataStore = new Map<string, DocumentMeta>();
const topicStore = new Map<string, TopicRecord>();

function hydrateStores() {
  const savedDocs = loadData<Record<string, DocumentMeta>>("documents");
  if (savedDocs) {
    documentMetadataStore.clear();
    for (const [k, v] of Object.entries(savedDocs)) {
      documentMetadataStore.set(k, v);
    }
  }
  const savedTopics = loadData<Record<string, TopicRecord>>("topics");
  if (savedTopics) {
    topicStore.clear();
    for (const [k, v] of Object.entries(savedTopics)) {
      topicStore.set(k, v);
    }
  }
}

// Initial hydration
hydrateStores();

function persistDocuments(): void {
  saveData("documents", Object.fromEntries(documentMetadataStore));
}

function persistTopics(): void {
  saveData("topics", Object.fromEntries(topicStore));
}

// ── Routes ────────────────────────────────────────────────────

/**
 * POST /api/manuals/search-url
 * Build a ManualsLib search URL after translating Hebrew → English.
 * Body: { query: string } — e.g. "LG מקרר GR-B220" or "Samsung washing machine WF45"
 */
router.post("/search-url", async (req: Request, res: Response): Promise<void> => {
  try {
    const { query } = req.body;

    if (!query || !query.trim()) {
      res.status(400).json({ error: "נדרש טקסט לחיפוש" });
      return;
    }

    console.log(`🔍 Building ManualsLib URL for: "${query}"`);

    const result = await buildManualsLibUrl(query.trim());

    console.log(`   → URL: ${result.url}`);
    if (result.translatedQuery !== query.trim()) {
      console.log(`   → Translated: "${query.trim()}" → "${result.translatedQuery}"`);
    }

    res.json(result);
  } catch (error) {
    console.error("ManualsLib URL build error:", error);
    res.status(500).json({
      error: "שגיאה ביצירת קישור לחיפוש",
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * POST /api/manuals/search
 * Search for manuals online (legacy — still works).
 * Body: { brand: string, model: string, productType?: string }
 */
router.post("/search", async (req: Request, res: Response): Promise<void> => {
  try {
    const { brand, model, productType } = req.body;

    if (!brand || !model) {
      res.status(400).json({ error: "נדרש שם יצרן ודגם" });
      return;
    }

    console.log(`🔍 Searching manuals for: ${brand} ${model} ${productType || ""}`);

    const results: ManualResult[] = await searchManuals(
      brand.trim(),
      model.trim(),
      productType?.trim()
    );

    console.log(`   → Found ${results.length} results`);

    res.json({
      results,
      count: results.length,
      query: { brand, model, productType },
    });
  } catch (error) {
    console.error("Manual search error:", error);
    res.status(500).json({
      error: "שגיאה בחיפוש מדריכים",
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * POST /api/manuals/import
 * Download a manual PDF from URL and process it through the RAG pipeline.
 * Body: { url: string, title: string, brand: string, model: string, topicName?: string }
 */
router.post("/import", async (req: Request, res: Response): Promise<void> => {
  try {
    const { url, title, brand, model, topicName } = req.body;

    if (!url) {
      res.status(400).json({ error: "נדרש קישור למדריך" });
      return;
    }

    console.log(`📥 Importing manual: ${title || url}`);

    // Step 1: Download the PDF
    console.log("  → Downloading PDF...");
    const download = await downloadManualPDF(url, brand || "manual", model || "doc");

    console.log(`  → Downloaded: ${download.fileName} (${(download.fileSize / 1024).toFixed(1)} KB)`);

    // Step 2: Extract text
    console.log("  → Extracting text...");
    const text = await extractTextFromFile(download.filePath);

    if (!text || text.trim().length === 0) {
      res.status(400).json({ error: "לא ניתן לחלץ טקסט מהמדריך" });
      return;
    }

    // Step 3: Classify document
    console.log("  → Classifying...");
    const classification = await classifyDocument(text, download.fileName);

    // Step 4: Create topic
    // Re-read stores to get up-to-date data
    hydrateStores();

    const topicId = uuidv4();
    const docId = uuidv4();
    const resolvedTopicName =
      topicName || `${brand} ${model} - ${classification.documentType}`;

    const topic: TopicRecord = {
      id: topicId,
      name: resolvedTopicName,
      documentIds: [docId],
      createdAt: new Date().toISOString(),
    };
    topicStore.set(topicId, topic);

    // Step 5: Chunk text
    console.log("  → Chunking text...");
    const textChunks = chunkText(text);

    // Step 6: Embed & store chunks
    console.log(`  → Generating embeddings for ${textChunks.length} chunks...`);
    const storedChunks: StoredChunk[] = textChunks.map((chunk, index) => ({
      id: `${docId}-chunk-${index}`,
      documentId: docId,
      content: chunk.content,
      embedding: generateSimpleEmbedding(chunk.content),
      metadata: {
        fileName: download.fileName,
        category: classification.category,
        topicId,
        documentType: classification.documentType,
        position: chunk.position,
      },
    }));

    storeChunks(storedChunks);

    // Step 7: Store metadata
    const metadata: DocumentMeta = {
      id: docId,
      fileName: title || download.fileName,
      category: classification.category,
      topicId,
      documentType: classification.documentType,
      language: classification.language,
      confidence: classification.confidence,
      createdAt: new Date().toISOString(),
      filePath: download.filePath,
    };
    documentMetadataStore.set(docId, metadata);

    // Persist
    persistDocuments();
    persistTopics();

    console.log(`  ✅ Manual imported: ${storedChunks.length} chunks stored`);

    res.json({
      success: true,
      document: {
        id: docId,
        fileName: title || download.fileName,
        category: classification.category,
        documentType: classification.documentType,
        language: classification.language,
        confidence: classification.confidence,
        chunksCount: storedChunks.length,
      },
      topic: {
        id: topicId,
        name: resolvedTopicName,
        documentCount: 1,
      },
    });
  } catch (error) {
    console.error("Manual import error:", error);
    res.status(500).json({
      error: "שגיאה בייבוא המדריך",
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

export default router;
