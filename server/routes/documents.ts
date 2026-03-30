/**
 * Document routes — upload, list, download, delete.
 * Supports topic-based grouping: documents uploaded together share a topic.
 * All stores are persisted to disk so data survives server restarts.
 */
import { Router, Request, Response } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { v4 as uuidv4 } from "uuid";
import { extractTextFromFile } from "../services/textExtractor.js";
import { classifyDocument } from "../services/classifier.js";
import { chunkText } from "../services/chunker.js";
import { generateSimpleEmbedding } from "../services/groqClient.js";
import {
  storeChunks,
  getDocumentList,
  getCategories,
  removeDocument,
  type StoredChunk,
} from "../services/vectorStore.js";
import { loadData, saveData } from "../services/persistence.js";

const router = Router();

// ── Persisted stores ──────────────────────────────────────────

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

const documentMetadataStore = new Map<string, DocumentMeta>();
const topicStore = new Map<string, TopicRecord>();

// ── Hydrate from disk ─────────────────────────────────────────

const savedDocs = loadData<Record<string, DocumentMeta>>("documents");
if (savedDocs) {
  for (const [k, v] of Object.entries(savedDocs)) {
    documentMetadataStore.set(k, v);
  }
  console.log(`📦 Restored ${documentMetadataStore.size} document metadata records`);
}

const savedTopics = loadData<Record<string, TopicRecord>>("topics");
if (savedTopics) {
  for (const [k, v] of Object.entries(savedTopics)) {
    topicStore.set(k, v);
  }
  console.log(`📦 Restored ${topicStore.size} topics`);
}

// ── Persist helpers ───────────────────────────────────────────

function persistDocuments(): void {
  saveData("documents", Object.fromEntries(documentMetadataStore));
}

function persistTopics(): void {
  saveData("topics", Object.fromEntries(topicStore));
}

// ── Multer setup ──────────────────────────────────────────────

const uploadDir = process.env.UPLOAD_DIR || "./uploads";
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    const name = `${uuidv4()}${ext}`;
    cb(null, name);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max
  fileFilter: (_req, file, cb) => {
    const allowedTypes = [
      "application/pdf",
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/tiff",
      "image/bmp",
      "text/plain",
    ];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`סוג קובץ לא נתמך: ${file.mimetype}`));
    }
  },
});

// ── Helper: generate a topic name from classification ─────────

function generateTopicName(
  classification: { category: string; documentType: string },
  fileName: string
): string {
  const cat = classification.category || "כללי";
  // Use category as topic name; if it's too generic, include the first file name
  if (cat === "אחר" || cat === "כללי" || cat === "other") {
    const base = path.basename(fileName, path.extname(fileName));
    return base.length > 30 ? base.slice(0, 30) : base;
  }
  return cat;
}

// ── Routes ────────────────────────────────────────────────────

/**
 * POST /api/documents/upload
 * Upload multiple documents. All files in one request share the same topic.
 * Query params:
 *   ?topicId=<existing-topic-id>  — add to an existing topic
 *   ?topicName=<name>             — use a custom topic name (new topic)
 */
router.post(
  "/upload",
  upload.array("files", 20),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const files = req.files as Express.Multer.File[] | undefined;

      if (!files || files.length === 0) {
        res.status(400).json({ error: "לא הועלו קבצים" });
        return;
      }

      const existingTopicId = req.query.topicId as string | undefined;
      const customTopicName = req.query.topicName as string | undefined;

      // Resolve or create topic
      let topicId: string;
      let topic: TopicRecord;

      if (existingTopicId && topicStore.has(existingTopicId)) {
        topicId = existingTopicId;
        topic = topicStore.get(existingTopicId)!;
      } else {
        topicId = uuidv4();
        topic = {
          id: topicId,
          name: customTopicName || "", // Will be set from first classification
          documentIds: [],
          createdAt: new Date().toISOString(),
        };
        topicStore.set(topicId, topic);
      }

      const results: Array<{
        id: string;
        fileName: string;
        category: string;
        documentType: string;
        language: string;
        confidence: number;
        chunksCount: number;
      }> = [];

      for (const file of files) {
        const filePath = file.path;
        const originalName = Buffer.from(file.originalname, "latin1").toString("utf8");
        const docId = uuidv4();

        console.log(`📄 Processing document: ${originalName}`);

        // Step 1: Extract text
        const isImage = /\.(jpg|jpeg|png|webp|bmp|tiff?)$/i.test(originalName);
        console.log(`  → Extracting text${isImage ? " (OCR)" : ""}...`);
        const text = await extractTextFromFile(filePath);

        if (!text || text.trim().length === 0) {
          console.warn(`  ⚠️ No text extracted from ${originalName}, skipping`);
          continue;
        }

        // Step 2: Classify
        console.log("  → Classifying document...");
        const classification = await classifyDocument(text, originalName);

        // Auto-name topic from first document if name is empty
        if (!topic.name) {
          topic.name = customTopicName || generateTopicName(classification, originalName);
        }

        // Step 3: Chunk text
        console.log("  → Chunking text...");
        const textChunks = chunkText(text);

        // Step 4: Embed & store
        console.log(`  → Generating embeddings for ${textChunks.length} chunks...`);
        const storedChunks: StoredChunk[] = textChunks.map((chunk, index) => ({
          id: `${docId}-chunk-${index}`,
          documentId: docId,
          content: chunk.content,
          embedding: generateSimpleEmbedding(chunk.content),
          metadata: {
            fileName: originalName,
            category: classification.category,
            topicId,
            documentType: classification.documentType,
            position: chunk.position,
          },
        }));

        storeChunks(storedChunks);

        // Store metadata
        const metadata: DocumentMeta = {
          id: docId,
          fileName: originalName,
          category: classification.category,
          topicId,
          documentType: classification.documentType,
          language: classification.language,
          confidence: classification.confidence,
          createdAt: new Date().toISOString(),
          filePath,
        };
        documentMetadataStore.set(docId, metadata);

        // Link doc to topic
        topic.documentIds.push(docId);

        // Persist after each doc
        persistDocuments();
        persistTopics();

        console.log(`  ✅ Document processed: ${storedChunks.length} chunks stored`);

        results.push({
          id: docId,
          fileName: originalName,
          category: classification.category,
          documentType: classification.documentType,
          language: classification.language,
          confidence: classification.confidence,
          chunksCount: storedChunks.length,
        });
      }

      if (results.length === 0) {
        // All files failed — clean up empty topic if we created it
        if (!existingTopicId) {
          topicStore.delete(topicId);
          persistTopics();
        }
        res.status(400).json({ error: "לא ניתן לחלץ טקסט מאף קובץ" });
        return;
      }

      res.json({
        success: true,
        topic: {
          id: topic.id,
          name: topic.name,
          documentCount: topic.documentIds.length,
        },
        documents: results,
      });
    } catch (error) {
      console.error("Upload error:", error);
      res.status(500).json({
        error: "שגיאה בעיבוד המסמכים",
        details: error instanceof Error ? error.message : String(error),
      });
    }
  }
);

/**
 * GET /api/documents
 * List all uploaded documents.
 */
router.get("/", (_req: Request, res: Response) => {
  const documents = getDocumentList().map((doc) => {
    const meta = documentMetadataStore.get(doc.id);
    return {
      ...doc,
      topicId: meta?.topicId || doc.topicId || "",
      language: meta?.language || "unknown",
      confidence: meta?.confidence || 0,
      createdAt: meta?.createdAt || new Date().toISOString(),
    };
  });

  res.json({ documents });
});

/**
 * GET /api/documents/categories
 * Get all unique categories.
 */
router.get("/categories", (_req: Request, res: Response) => {
  const categories = getCategories();
  res.json({ categories });
});

/**
 * GET /api/documents/topics
 * Get all topics with their documents.
 */
router.get("/topics", (_req: Request, res: Response) => {
  const topics = Array.from(topicStore.values()).map((t) => ({
    id: t.id,
    name: t.name,
    documentIds: t.documentIds,
    createdAt: t.createdAt,
  }));
  res.json({ topics });
});

/**
 * PUT /api/documents/topics/:id
 * Rename a topic.
 */
router.put("/topics/:id", (req: Request, res: Response): void => {
  const id = req.params.id as string;
  const topic = topicStore.get(id);
  if (!topic) {
    res.status(404).json({ error: "נושא לא נמצא" });
    return;
  }
  const { name } = req.body;
  if (name && typeof name === "string") {
    topic.name = name.trim();
    persistTopics();
  }
  res.json({ success: true, topic });
});

/**
 * DELETE /api/documents/topics/:id
 * Delete a topic and all its documents.
 */
router.delete("/topics/:id", (req: Request, res: Response): void => {
  const id = req.params.id as string;
  const topic = topicStore.get(id);
  if (!topic) {
    res.status(404).json({ error: "נושא לא נמצא" });
    return;
  }

  // Delete each document in the topic
  for (const docId of topic.documentIds) {
    const meta = documentMetadataStore.get(docId);
    if (meta) {
      removeDocument(docId);
      if (fs.existsSync(meta.filePath)) {
        fs.unlinkSync(meta.filePath);
      }
      documentMetadataStore.delete(docId);
    }
  }

  topicStore.delete(id);
  persistDocuments();
  persistTopics();
  res.json({ success: true, message: "הנושא וכל מסמכיו נמחקו בהצלחה" });
});

/**
 * GET /api/documents/:id/download
 * Download original file.
 */
router.get("/:id/download", (req: Request, res: Response): void => {
  const id = req.params.id as string;
  const meta = documentMetadataStore.get(id);
  if (!meta) {
    res.status(404).json({ error: "מסמך לא נמצא" });
    return;
  }

  if (!fs.existsSync(meta.filePath)) {
    res.status(404).json({ error: "קובץ לא נמצא בשרת" });
    return;
  }

  res.download(meta.filePath, meta.fileName);
});

/**
 * DELETE /api/documents/:id
 * Delete a document and its chunks. Also removes from parent topic.
 */
router.delete("/:id", (req: Request, res: Response): void => {
  const id = req.params.id as string;
  const meta = documentMetadataStore.get(id);
  if (!meta) {
    res.status(404).json({ error: "מסמך לא נמצא" });
    return;
  }

  // Remove from vector store
  removeDocument(id);

  // Remove file from disk
  if (fs.existsSync(meta.filePath)) {
    fs.unlinkSync(meta.filePath);
  }

  // Remove from topic
  const topic = topicStore.get(meta.topicId);
  if (topic) {
    topic.documentIds = topic.documentIds.filter((d) => d !== id);
    // If topic is now empty, delete it
    if (topic.documentIds.length === 0) {
      topicStore.delete(topic.id);
    }
  }

  // Remove metadata
  documentMetadataStore.delete(id);

  persistDocuments();
  persistTopics();

  res.json({ success: true, message: "המסמך נמחק בהצלחה" });
});

export default router;
