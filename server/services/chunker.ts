/**
 * Text chunking service.
 * Splits extracted text into semantic chunks for embedding.
 * Target: 300–800 tokens per chunk.
 *
 * Features:
 *  - Table-aware: detects table-like structures and keeps them intact
 *  - Header-aware: keeps headings with their content
 *  - OCR-artifact cleanup: removes common OCR noise
 */

export interface TextChunk {
  content: string;
  position: number;
  /** Hint about chunk type, used for search weighting */
  chunkType?: "text" | "table" | "specs" | "header";
}

const MIN_CHUNK_SIZE = 300; // ~300 tokens ≈ ~1200 chars
const MAX_CHUNK_SIZE = 800; // ~800 tokens ≈ ~3200 chars
const CHAR_PER_TOKEN = 4; // rough approximation

const MIN_CHARS = MIN_CHUNK_SIZE * CHAR_PER_TOKEN;
const MAX_CHARS = MAX_CHUNK_SIZE * CHAR_PER_TOKEN;
const OVERLAP_CHARS = 200; // overlap between chunks for context continuity

/**
 * Clean OCR artifacts from extracted text.
 */
function cleanOCRText(text: string): string {
  return text
    // Remove lines that are just noise (single chars, repeated symbols)
    .replace(/^[^\p{L}\p{N}]{1,3}$/gmu, "")
    // Fix common OCR errors: broken words across lines
    .replace(/(\p{L})-\n(\p{L})/gu, "$1$2")
    // Collapse excessive whitespace within lines (but preserve newlines)
    .replace(/[ \t]{3,}/g, "  ")
    // Remove isolated single characters on their own line (OCR noise)
    .replace(/^\s*[^\p{L}\p{N}\s]\s*$/gmu, "")
    // Collapse multiple blank lines
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Detect if a text block looks like a table.
 * Tables typically have:
 * - Multiple rows with consistent separators (|, tabs, multiple spaces)
 * - Lines with numbers and units aligned
 */
function isTableLike(text: string): boolean {
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length < 2) return false;

  // Check for pipe-separated tables
  const pipeLines = lines.filter((l) => (l.match(/\|/g) || []).length >= 2).length;
  if (pipeLines >= lines.length * 0.5) return true;

  // Check for tab-separated tables
  const tabLines = lines.filter((l) => (l.match(/\t/g) || []).length >= 1).length;
  if (tabLines >= lines.length * 0.5) return true;

  // Check for lines with multiple "columns" separated by 3+ spaces
  const multiSpaceLines = lines.filter((l) => (l.match(/\s{3,}/g) || []).length >= 1).length;
  if (multiSpaceLines >= lines.length * 0.5 && lines.length >= 3) return true;

  return false;
}

/**
 * Detect if a line looks like a heading/title.
 * Used by table detection and section splitting.
 */
export function isHeading(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.length > 200) return false;

  // ALL CAPS heading (common in manuals)
  if (trimmed === trimmed.toUpperCase() && trimmed.length > 3 && /[A-Z]/.test(trimmed)) return true;

  // Numbered section heading: "1.2 Installation" or "Chapter 3: Safety"
  if (/^[\d]+[.\-)]\s*\S/.test(trimmed) && trimmed.length < 100) return true;

  // Short line ending without period (likely a heading)
  if (trimmed.length < 80 && !/[.,:;!?]$/.test(trimmed) && /[A-Za-z\u0590-\u05FF]/.test(trimmed))
    return true;

  return false;
}

/**
 * Split text into overlapping chunks of appropriate size.
 * Enhanced with table detection and OCR cleanup.
 */
export function chunkText(text: string): TextChunk[] {
  if (!text || text.trim().length === 0) {
    return [];
  }

  // Step 1: Clean OCR artifacts
  const cleanedText = cleanOCRText(text);

  if (cleanedText.length <= MAX_CHARS) {
    return [{ content: cleanedText, position: 0, chunkType: "text" }];
  }

  const chunks: TextChunk[] = [];
  // Split into sections — respect double newlines as paragraph boundaries,
  // but also detect table blocks and heading + content blocks
  const sections = splitIntoSections(cleanedText);

  let currentChunk = "";
  let currentType: TextChunk["chunkType"] = "text";
  let position = 0;

  for (const section of sections) {
    const trimmed = section.text.trim();
    if (!trimmed) continue;

    // If this is a table, treat it as its own chunk
    if (section.type === "table") {
      // Save current chunk if it has content
      if (currentChunk.length >= MIN_CHARS) {
        chunks.push({ content: currentChunk.trim(), position: position++, chunkType: currentType });
        currentChunk = "";
        currentType = "text";
      }

      // Table chunk — even if big, keep it together (up to 2x max)
      if (trimmed.length <= MAX_CHARS * 2) {
        chunks.push({ content: trimmed, position: position++, chunkType: "table" });
      } else {
        // Very large table — split by rows while keeping header
        const rows = trimmed.split("\n");
        const header = rows[0];
        let tableChunk = header;

        for (let i = 1; i < rows.length; i++) {
          if (tableChunk.length + rows[i].length > MAX_CHARS && tableChunk.length > MIN_CHARS) {
            chunks.push({ content: tableChunk.trim(), position: position++, chunkType: "table" });
            tableChunk = header + "\n" + rows[i]; // repeat header in each chunk
          } else {
            tableChunk += "\n" + rows[i];
          }
        }
        if (tableChunk.trim().length > 0) {
          chunks.push({ content: tableChunk.trim(), position: position++, chunkType: "table" });
        }
      }
      continue;
    }

    // Regular text handling
    if (currentChunk.length + trimmed.length > MAX_CHARS && currentChunk.length >= MIN_CHARS) {
      chunks.push({ content: currentChunk.trim(), position: position++, chunkType: currentType });

      // Start new chunk with overlap from previous
      const overlapStart = Math.max(0, currentChunk.length - OVERLAP_CHARS);
      currentChunk = currentChunk.slice(overlapStart) + "\n\n" + trimmed;
      currentType = "text";
    } else if (trimmed.length > MAX_CHARS) {
      // If single paragraph is too long, split by sentences
      if (currentChunk.length >= MIN_CHARS) {
        chunks.push({ content: currentChunk.trim(), position: position++, chunkType: currentType });
        currentChunk = "";
        currentType = "text";
      }

      const sentenceChunks = splitLongParagraph(trimmed);
      for (const sc of sentenceChunks) {
        if (currentChunk.length + sc.length > MAX_CHARS && currentChunk.length >= MIN_CHARS) {
          chunks.push({ content: currentChunk.trim(), position: position++, chunkType: currentType });
          const overlapStart = Math.max(0, currentChunk.length - OVERLAP_CHARS);
          currentChunk = currentChunk.slice(overlapStart);
        }
        currentChunk += (currentChunk ? " " : "") + sc;
      }
    } else {
      currentChunk += (currentChunk ? "\n\n" : "") + trimmed;
    }
  }

  // Don't forget the last chunk
  if (currentChunk.trim().length > 0) {
    chunks.push({ content: currentChunk.trim(), position: position, chunkType: currentType });
  }

  return chunks;
}

/**
 * Split text into typed sections (text, table, heading).
 */
function splitIntoSections(text: string): { text: string; type: "text" | "table" }[] {
  const paragraphs = text.split(/\n\n+/);
  const sections: { text: string; type: "text" | "table" }[] = [];

  let currentText = "";
  let inTable = false;
  let tableText = "";

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;

    if (isTableLike(trimmed)) {
      // Save any accumulated text
      if (currentText.trim()) {
        sections.push({ text: currentText.trim(), type: "text" });
        currentText = "";
      }
      // Accumulate table rows
      if (inTable) {
        tableText += "\n\n" + trimmed;
      } else {
        inTable = true;
        tableText = trimmed;
      }
    } else {
      // Save any accumulated table
      if (inTable) {
        sections.push({ text: tableText.trim(), type: "table" });
        tableText = "";
        inTable = false;
      }
      currentText += (currentText ? "\n\n" : "") + trimmed;
    }
  }

  // Flush remaining
  if (inTable && tableText.trim()) {
    sections.push({ text: tableText.trim(), type: "table" });
  }
  if (currentText.trim()) {
    sections.push({ text: currentText.trim(), type: "text" });
  }

  return sections;
}

function splitLongParagraph(text: string): string[] {
  // Split by sentences (Hebrew and English)
  const sentences = text.split(/(?<=[.!?。])\s+/);
  const parts: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    if (current.length + sentence.length > MAX_CHARS && current.length > 0) {
      parts.push(current);
      current = sentence;
    } else {
      current += (current ? " " : "") + sentence;
    }
  }

  if (current) {
    parts.push(current);
  }

  return parts;
}
