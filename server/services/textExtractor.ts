/**
 * Text extraction service.
 * Extracts text from PDFs (with OCR fallback) and images (via Tesseract.js).
 * Supports Hebrew + English OCR.
 *
 * Enhanced features:
 *  - Better table structure preservation
 *  - OCR artifact cleanup
 *  - Post-processing pipeline for cleaner output
 */
import fs from "fs";
import { PDFParse } from "pdf-parse";
import { createWorker, type Worker } from "tesseract.js";

const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "bmp", "tiff", "tif"];

// Reusable OCR worker — created lazily on first use
let ocrWorker: Worker | null = null;

async function getOCRWorker(): Promise<Worker> {
  if (!ocrWorker) {
    console.log("    🔄 Initializing Tesseract OCR worker (heb+eng)...");
    ocrWorker = await createWorker("heb+eng");
    console.log("    ✅ OCR worker ready");
  }
  return ocrWorker;
}

/**
 * Post-process extracted text to improve quality.
 * Handles common issues with PDF extraction and OCR output.
 */
function postProcessText(text: string): string {
  let processed = text;

  // 1. Fix broken words across line breaks (common in column-based PDFs)
  //    e.g., "tempera-\nture" → "temperature"
  processed = processed.replace(/(\w)-\n(\w)/g, "$1$2");

  // 2. Normalize whitespace: collapse multiple spaces within lines
  processed = processed.replace(/[ \t]+/g, " ");

  // 3. Preserve table-like structures:
  //    Re-add spacing for lines that look like table rows
  processed = processed.replace(
    new RegExp(`^(.+?)\\s{2,}(.+?)$`, "gm"),
    (match) => {
      // If line has 2+ segments separated by multiple spaces, keep it formatted
      const segments = match.split(/\s{2,}/);
      if (segments.length >= 2) {
        return segments.join("  |  "); // Use pipe to make table structure explicit
      }
      return match;
    }
  );

  // 4. Remove common OCR noise patterns
  //    - Lines that are just dots, dashes, or symbols
  processed = processed.replace(/^[.\-_=~*]{5,}$/gm, "---");
  //    - Remove null/control characters
  // eslint-disable-next-line no-control-regex
  processed = processed.replace(new RegExp("[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F]", "g"), "");

  // 5. Normalize line endings
  processed = processed.replace(/\r\n/g, "\n");

  // 6. Collapse 3+ blank lines into 2
  processed = processed.replace(/\n{3,}/g, "\n\n");

  // 7. Mark likely section headers (ALL CAPS lines, short lines before longer ones)
  processed = processed.replace(
    /^([A-Z][A-Z\s]{3,50})$/gm,
    "\n## $1\n"
  );

  return processed.trim();
}

/**
 * Extract text from any supported file type.
 */
export async function extractTextFromFile(filePath: string): Promise<string> {
  const ext = filePath.toLowerCase().split(".").pop() || "";

  if (ext === "pdf") {
    return extractFromPDF(filePath);
  }

  if (ext === "txt") {
    return fs.readFileSync(filePath, "utf-8");
  }

  if (IMAGE_EXTENSIONS.includes(ext)) {
    return extractFromImage(filePath);
  }

  throw new Error(`סוג קובץ לא נתמך: .${ext}`);
}

/**
 * Extract text from PDF.
 * If the PDF yields little/no text (scanned document), falls back to OCR
 * by extracting page screenshots and running Tesseract on them.
 */
async function extractFromPDF(filePath: string): Promise<string> {
  const buffer = fs.readFileSync(filePath);
  const pdf = new PDFParse({ data: new Uint8Array(buffer) });

  // Try native text extraction first
  const result = await pdf.getText();
  const nativeText = result.text?.trim() || "";

  // If we got meaningful text, post-process and return
  if (nativeText.length > 50) {
    console.log(`    📝 PDF: extracted ${nativeText.length} chars (native text layer)`);
    return postProcessText(nativeText);
  }

  // Scanned PDF — fall back to OCR via screenshots
  console.log("    🔍 PDF has little/no text layer — running OCR...");
  try {
    const screenshotResult = await pdf.getScreenshot({ scale: 2 });
    const pages = screenshotResult?.pages || [];

    if (pages.length === 0) {
      // If screenshots aren't available, return whatever native text we have
      return postProcessText(nativeText) || "[מסמך PDF ללא טקסט ניתן לחילוץ]";
    }

    const ocrTexts: string[] = [];

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      if (page?.data) {
        console.log(`    🔍 OCR page ${i + 1}/${pages.length}...`);
        const pageText = await runOCR(Buffer.from(page.data));
        if (pageText.trim()) {
          ocrTexts.push(pageText.trim());
        }
      }
    }

    const combinedText = ocrTexts.join("\n\n");

    if (combinedText.length > 0) {
      console.log(`    ✅ OCR extracted ${combinedText.length} chars from ${ocrTexts.length} pages`);
      return postProcessText(combinedText);
    }

    return postProcessText(nativeText) || "[מסמך PDF ללא טקסט ניתן לחילוץ]";
  } catch (ocrError) {
    console.error("    ⚠️ PDF OCR fallback failed:", ocrError);
    // Return whatever native text we got, even if minimal
    return postProcessText(nativeText) || "[מסמך PDF — OCR נכשל]";
  }
}

/**
 * Extract text from an image file using Tesseract.js OCR.
 * Uses Hebrew + English languages for best results.
 */
async function extractFromImage(filePath: string): Promise<string> {
  console.log(`    🔍 Running OCR on image: ${filePath.split(/[\\/]/).pop()}`);
  const buffer = fs.readFileSync(filePath);
  const text = await runOCR(buffer);

  if (!text || text.trim().length === 0) {
    throw new Error("לא ניתן לחלץ טקסט מהתמונה. ודא שהתמונה ברורה ומכילה טקסט.");
  }

  console.log(`    ✅ OCR extracted ${text.trim().length} chars from image`);
  return text.trim();
}

/**
 * Run Tesseract OCR on a buffer (image data).
 * Uses a persistent worker with heb+eng for bilingual documents.
 */
async function runOCR(imageBuffer: Buffer): Promise<string> {
  const worker = await getOCRWorker();
  const result = await worker.recognize(imageBuffer);
  return result.data.text || "";
}
