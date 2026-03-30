/**
 * AI query routes — handles RAG-based questions, transcription, and prompt enhancement.
 */
import { Router, Request, Response } from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import axios from "axios";
import FormData from "form-data";
import { queryRAG } from "../services/ragPipeline.js";
import { chatCompletion, type GroqMessage } from "../services/groqClient.js";
import { getChunkCount } from "../services/vectorStore.js";

const router = Router();

// Multer for audio uploads (temp storage)
const audioUpload = multer({
  dest: "./uploads/audio-temp",
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB max for Whisper
});

/**
 * POST /api/ai/query
 * Ask a question using the RAG pipeline.
 */
router.post("/query", async (req: Request, res: Response): Promise<void> => {
  try {
    const { question, topicFilter } = req.body;

    if (!question || typeof question !== "string" || question.trim().length === 0) {
      res.status(400).json({ error: "נדרשת שאלה" });
      return;
    }

    // Check if we have any documents
    if (getChunkCount() === 0) {
      res.json({
        answer: "אין מסמכים במערכת. אנא העלה מסמכים תחילה כדי שאוכל לענות על שאלות.",
        sources: [],
      });
      return;
    }

    console.log(`❓ Query: "${question}"${topicFilter ? ` [topic: ${topicFilter}]` : ""}`);

    const result = await queryRAG(question, topicFilter);

    console.log(`✅ Answer generated (${result.sources.length} sources)`);

    res.json({
      answer: result.answer,
      sources: result.sources,
    });
  } catch (error) {
    console.error("Query error:", error);
    res.status(500).json({
      error: "שגיאה בעיבוד השאלה",
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * GET /api/ai/health
 * Health check for the AI service.
 */
router.get("/health", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    chunksInStore: getChunkCount(),
    groqConfigured: !!process.env.GROQ_API_KEY && process.env.GROQ_API_KEY !== "your_groq_api_key_here",
  });
});

/**
 * POST /api/ai/transcribe
 * Transcribe audio using Groq Whisper API.
 */
router.post(
  "/transcribe",
  audioUpload.single("audio"),
  async (req: Request, res: Response): Promise<void> => {
    const tempPath = (req.file as Express.Multer.File | undefined)?.path;
    try {
      if (!req.file) {
        res.status(400).json({ error: "לא הועלה קובץ שמע" });
        return;
      }

      const GROQ_API_KEY = process.env.GROQ_API_KEY || "";
      if (!GROQ_API_KEY || GROQ_API_KEY === "your_groq_api_key_here") {
        res.status(500).json({ error: "GROQ_API_KEY is not configured" });
        return;
      }

      // Build form-data for Groq Whisper
      const form = new FormData();
      form.append("file", fs.createReadStream(req.file.path), {
        filename: "audio.webm",
        contentType: req.file.mimetype || "audio/webm",
      });
      form.append("model", "whisper-large-v3");
      form.append("language", "he"); // default to Hebrew
      form.append("response_format", "json");

      const response = await axios.post(
        "https://api.groq.com/openai/v1/audio/transcriptions",
        form,
        {
          headers: {
            Authorization: `Bearer ${GROQ_API_KEY}`,
            ...form.getHeaders(),
          },
          timeout: 30000,
        }
      );

      // Clean up temp file
      fs.unlinkSync(req.file.path);

      const text = (response.data as { text: string }).text || "";
      console.log(`🎤 Transcribed: "${text.slice(0, 80)}..."`);

      res.json({ text });
    } catch (error) {
      // Clean up temp file on error
      if (tempPath && fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
      console.error("Transcription error:", error);
      res.status(500).json({
        error: "שגיאה בתמלול השמע",
        details: error instanceof Error ? error.message : String(error),
      });
    }
  }
);

/**
 * POST /api/ai/enhance-prompt
 * Takes a user's rough prompt and optional topic name, returns an improved version.
 */
router.post("/enhance-prompt", async (req: Request, res: Response): Promise<void> => {
  try {
    const { prompt, topicName } = req.body;

    if (!prompt || typeof prompt !== "string" || prompt.trim().length === 0) {
      res.status(400).json({ error: "נדרש טקסט לשיפור" });
      return;
    }

    const topicContext = topicName
      ? `הנושא שהמשתמש בחר: "${topicName}" (מכשיר/מוצר ביתי).`
      : "לא נבחר נושא ספציפי.";

    const messages: GroqMessage[] = [
      {
        role: "system",
        content: `אתה עוזר שמשפר שאלות של משתמשים למערכת HomeBrain — מערכת RAG שעונה על שאלות לגבי מכשירי בית, אך ורק על סמך מסמכים שהועלו (מדריכי הפעלה, אחריות, הוראות התקנה).

התפקיד שלך: לקחת את השאלה הגולמית של המשתמש ולשכתב אותה כך שמנוע ה-RAG ימצא את התשובה הטובה ביותר במסמכים.

כללים חשובים:
1. שמור על הכוונה המקורית — אל תשנה את מה שהמשתמש רוצה לדעת
2. הפוך שאלות מעורפלות לספציפיות: "איך עושים?" → "מהם שלבי התהליך ל...?"
3. הוסף מילות מפתח שסביר שיופיעו במדריך הפעלה (כמו: הוראות שימוש, תחזוקה, פתרון תקלות, מפרט טכני, התקנה, ניקוי, הגדרות)
4. אם הנושא ידוע — השתמש בשם המכשיר בצורה טבעית בשאלה, אבל אל תהפוך את כל השאלה לשם המכשיר
5. חשוב על איזה סוג תוכן במדריך יכיל את התשובה, ונסח את השאלה כך שתתאים
6. שמור על עברית טבעית וקצרה
7. החזר רק את השאלה המשופרת, ללא הסברים או הערות
8. אם השאלה כבר ספציפית וטובה — החזר אותה כמו שהיא
9. אל תמציא מידע ואל תניח הנחות שלא משתמעות מהשאלה

דוגמאות:
- "רעש" → "מה הסיבות לרעש חריג ואיך לפתור את הבעיה?"
- "ניקוי" → "מהן הוראות הניקוי והתחזוקה השוטפת?"
- "לא עובד" → "מהם שלבי פתרון התקלות כאשר המכשיר אינו פועל?"
- "טמפרטורה" → "מהן הגדרות הטמפרטורה המומלצות ואיך לכוונן אותן?"`,
      },
      {
        role: "user",
        content: `${topicContext}\n\nשאלה מקורית: "${prompt.trim()}"\n\nשאלה משופרת:`,
      },
    ];

    const enhanced = await chatCompletion(messages, {
      temperature: 0.3,
      maxTokens: 300,
      model: "llama-3.1-8b-instant", // fast & cheap
    });

    const cleanEnhanced = enhanced.replace(/^["']|["']$/g, "").trim();
    console.log(`✨ Enhanced prompt: "${prompt.trim()}" → "${cleanEnhanced}"`);

    res.json({ enhanced: cleanEnhanced });
  } catch (error) {
    console.error("Enhance prompt error:", error);
    res.status(500).json({
      error: "שגיאה בשיפור השאלה",
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

export default router;
