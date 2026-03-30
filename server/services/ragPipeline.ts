/**
 * RAG Pipeline — the core query engine for HomeBrain.
 *
 * Flow:
 * 1. Receive user question + optional category filter
 * 2. Retrieve top-K relevant chunks from vector store
 * 3. Build a grounded prompt with system rules + context
 * 4. Send to Groq LLM
 * 5. Return Hebrew answer with sources
 */
import { chatCompletion, type GroqMessage } from "./groqClient.js";
import { searchSimilarScored, getCandidateChunks, type StoredChunk } from "./vectorStore.js";
import { keywordSearch, mergeSearchResults } from "./keywordSearch.js";

export interface RAGQueryResult {
  answer: string;
  sources: {
    documentId: string;
    fileName: string;
    snippet: string;
  }[];
}

const SYSTEM_PROMPT = `אתה עוזר AI ביתי חכם בשם HomeBrain.
התפקיד שלך הוא לענות על שאלות לגבי מכשירים ביתיים, אך ורק על סמך מסמכים שהועלו למערכת.

כללים קפדניים:
1. ענה אך ורק על סמך המידע שסופק בהקשר (context) למטה.
2. אל תשתמש בידע כללי. אל תמציא מידע.
3. אם התשובה לא נמצאת במסמכים → ענה: "אין לי מידע על כך במסמכים שהועלו"
4. ענה תמיד בעברית, גם אם השאלה באנגלית.
5. ענה בקצרה, בצורה ברורה ופרקטית.
6. השתמש בנקודות (bullet points) כשצריך.
7. אם יש הוראות, החזר שלבים מסודרים.
8. ציין את המקור, לדוגמה: "לפי חוברת ההפעלה של התנור"
9. אם המשתמש מבקש קובץ (למשל תעודת אחריות), ציין את שם הקובץ.
15. כשהשאלה כללית (ללא סינון נושא ספציפי), ציין בסוף התשובה את הנושא הרלוונטי בפורמט: "📂 נושא: <שם הנושא>". שם הנושא מופיע בסוגריים ליד שם הקובץ בכל מקור. אם יש כמה נושאים רלוונטיים — ציין את כולם.

חשוב מאוד — מסמכי מקור באנגלית:
10. רוב המסמכים (מדריכי הפעלה, חוברות טכניות) כתובים באנגלית. קרא את התוכן האנגלי בעיון ותרגם את התשובה לעברית.
11. כאשר המקור באנגלית — הבן את המשמעות ותן תשובה טבעית בעברית. אל תעתיק טקסט באנגלית כמו שהוא.
12. אם יש טבלה או נתונים טכניים באנגלית — תרגם את הכותרות והערכים הרלוונטיים לעברית, אך שמור על מספרים ויחידות מידה כפי שהם (למשל: 220V, 50Hz, 15kg).
13. מונחים טכניים שאין להם תרגום מקובל בעברית — ניתן להשאיר באנגלית עם הסבר.
14. אם הטקסט מכיל ארטיפקטים של OCR (אותיות שבורות, רווחים מוזרים) — נסה להבין את הכוונה ותן תשובה נקייה.`;

/**
 * Execute a RAG query: retrieve relevant chunks, build prompt, get answer.
 */
export async function queryRAG(
  question: string,
  topicFilter?: string
): Promise<RAGQueryResult> {
  // Step 1: Hybrid retrieval — combine vector similarity with keyword search
  const vectorResults = searchSimilarScored(question, 10, topicFilter);
  const candidateChunks = getCandidateChunks(topicFilter);
  const keywordResults = keywordSearch(question, candidateChunks, 10);

  // Merge results: keyword search gets higher weight because our embeddings
  // are hash-based (not semantic), while BM25 handles cross-language via term expansion
  const relevantChunks = mergeSearchResults(
    vectorResults,
    keywordResults,
    8, // retrieve more chunks for re-ranking
    0.3, // vector weight (low — hash embeddings aren't great)
    0.7  // keyword weight (high — BM25 with cross-lang expansion)
  );

  if (relevantChunks.length === 0) {
    return {
      answer: "אין לי מידע על כך במסמכים שהועלו. נסה להעלות מסמכים רלוונטיים למערכת.",
      sources: [],
    };
  }

  // Step 2: LLM-based re-ranking — ask Groq to pick the most relevant chunks
  const rerankedChunks = await rerankWithLLM(question, relevantChunks);

  // Step 3: Build context from re-ranked chunks
  const context = buildContext(rerankedChunks);

  // Step 4: Build messages
  const messages: GroqMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `הקשר ממסמכים שהועלו:
---
${context}
---

${!topicFilter ? '(שאלה כללית — ציין את הנושא הרלוונטי בסוף התשובה)' : ''}
שאלת המשתמש: ${question}`,
    },
  ];

  // Step 5: Get LLM response
  try {
    const answer = await chatCompletion(messages, {
      temperature: 0.1,
      maxTokens: 2048,
    });

    // Step 6: Build sources list
    const sources = getUniqueSources(rerankedChunks);

    return { answer, sources };
  } catch (error) {
    console.error("RAG query error:", error);
    return {
      answer: "אירעה שגיאה בעיבוד השאלה. אנא נסה שוב.",
      sources: [],
    };
  }
}

/**
 * LLM-based re-ranking: Ask Groq to select the most relevant chunks
 * for the user's question. This compensates for weak embeddings and
 * ensures we send only the best context to the final answer generation.
 */
async function rerankWithLLM(
  question: string,
  chunks: StoredChunk[]
): Promise<StoredChunk[]> {
  // If few chunks, skip re-ranking
  if (chunks.length <= 3) return chunks;

  try {
    const chunkSummaries = chunks
      .map(
        (c, i) =>
          `[${i}] (${c.metadata.fileName}): ${c.content.slice(0, 300)}...`
      )
      .join("\n\n");

    const rerankMessages: GroqMessage[] = [
      {
        role: "system",
        content: `You are a relevance judge. Given a user question and numbered text chunks, return ONLY the indices of the most relevant chunks (up to 5), as a JSON array of numbers. Example: [0, 3, 1]
Consider:
- The question may be in Hebrew but chunks in English (or vice versa) — match by MEANING not language
- Tables and technical specs are relevant for questions about measurements, capacity, settings
- Prefer chunks with specific answers over general introductions`,
      },
      {
        role: "user",
        content: `Question: ${question}\n\nChunks:\n${chunkSummaries}\n\nReturn the indices of the most relevant chunks as a JSON array:`,
      },
    ];

    const response = await chatCompletion(rerankMessages, {
      temperature: 0,
      maxTokens: 100,
      model: "llama-3.1-8b-instant", // fast & cheap model for re-ranking
    });

    // Parse the JSON array of indices
    const match = response.match(/\[[\d,\s]+\]/);
    if (match) {
      const indices: number[] = JSON.parse(match[0]);
      const reranked = indices
        .filter((i) => i >= 0 && i < chunks.length)
        .map((i) => chunks[i]);

      if (reranked.length > 0) {
        console.log(
          `🔄 Re-ranked: ${chunks.length} → ${reranked.length} chunks (indices: ${indices.join(", ")})`
        );
        return reranked;
      }
    }
  } catch (error) {
    console.warn("⚠️ LLM re-ranking failed, using original order:", error);
  }

  // Fallback: return top 5 from original order
  return chunks.slice(0, 5);
}

function buildContext(chunks: StoredChunk[]): string {
  return chunks
    .map(
      (chunk, index) =>
        `[מקור ${index + 1}: ${chunk.metadata.fileName} | נושא: ${chunk.metadata.category}]\n${chunk.content}`
    )
    .join("\n\n---\n\n");
}

function getUniqueSources(
  chunks: StoredChunk[]
): { documentId: string; fileName: string; snippet: string }[] {
  const seen = new Set<string>();
  const sources: { documentId: string; fileName: string; snippet: string }[] = [];

  for (const chunk of chunks) {
    if (!seen.has(chunk.documentId)) {
      seen.add(chunk.documentId);
      sources.push({
        documentId: chunk.documentId,
        fileName: chunk.metadata.fileName,
        snippet: chunk.content.slice(0, 150) + "...",
      });
    }
  }

  return sources;
}
