/**
 * Document classifier using Groq LLM.
 * Classifies uploaded documents into categories and types.
 */
import { chatCompletion } from "./groqClient.js";

export interface ClassificationResult {
  category: string;
  documentType: string;
  language: string;
  confidence: number;
}

export async function classifyDocument(
  text: string,
  fileName: string
): Promise<ClassificationResult> {
  const sampleText = text.slice(0, 2000);

  const systemPrompt = `You are a document classifier for a home document management system.
Analyze the given text from a document and classify it.

Return ONLY a JSON object with these fields:
- category: the device/product category in Hebrew (e.g., "תנור", "מקרר", "מכונת כביסה", "כיסא בטיחות", "מזגן")
- documentType: one of "manual", "warranty", "installation", "other"
- language: one of "hebrew", "english", "other"
- confidence: a number between 0 and 1

Example response:
{"category": "כיסא בטיחות", "documentType": "manual", "language": "hebrew", "confidence": 0.95}

Return ONLY the JSON, no explanation.`;

  const userPrompt = `File name: ${fileName}

Document text (first 2000 chars):
${sampleText}`;

  try {
    const response = await chatCompletion(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      { temperature: 0.1, model: "llama-3.1-8b-instant" }
    );

    // Parse JSON response, handling potential markdown wrapping
    let jsonStr = response.trim();
    if (jsonStr.startsWith("```")) {
      jsonStr = jsonStr.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    }

    const result = JSON.parse(jsonStr) as ClassificationResult;

    return {
      category: result.category || "כללי",
      documentType: result.documentType || "other",
      language: result.language || "other",
      confidence: Math.min(1, Math.max(0, result.confidence || 0.5)),
    };
  } catch (error) {
    console.error("Classification error:", error);
    // Fallback classification
    return {
      category: "כללי",
      documentType: "other",
      language: detectLanguage(text),
      confidence: 0.3,
    };
  }
}

function detectLanguage(text: string): "hebrew" | "english" | "other" {
  const hebrewPattern = /[\u0590-\u05FF]/g;
  const englishPattern = /[a-zA-Z]/g;

  const hebrewCount = (text.match(hebrewPattern) || []).length;
  const englishCount = (text.match(englishPattern) || []).length;

  if (hebrewCount > englishCount) return "hebrew";
  if (englishCount > hebrewCount) return "english";
  return "other";
}
