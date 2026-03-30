/**
 * Manual Search Service — find product manuals online.
 *
 * Strategy (tested & verified):
 *   1. DuckDuckGo HTML search — reliable, no API key, returns real links
 *      Two queries run in parallel:
 *        a) "{brand} {model} user manual PDF"          → general results
 *        b) "{brand} {model} site:manualslib.com"      → ManualsLib results
 *   2. Google Custom Search API — optional fallback (needs API key)
 *
 * Note: ManualsLib direct scraping was tested and does NOT work —
 *       they return "Too short or inconsistent query" + captcha blocks.
 *       DuckDuckGo however indexes ManualsLib well and returns direct links.
 *
 * Flow:
 *   search → user picks result → confirm & import → download PDF → process via existing pipeline
 */
import axios from "axios";
import * as cheerio from "cheerio";
import { v4 as uuidv4 } from "uuid";
import fs from "fs";
import path from "path";
import { chatCompletion } from "./groqClient.js";

// ── Types ──────────────────────────────────────────────────────

export interface ManualResult {
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
  /** True when the URL points directly to a .pdf file (most reliable for import) */
  directPdf: boolean;
}

export interface ManualDownloadResult {
  success: boolean;
  filePath: string;
  fileName: string;
  fileSize: number;
}

// ── Constants ──────────────────────────────────────────────────

const HTTP_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9,he;q=0.8",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Encoding": "identity",
};

const TIMEOUT = 15000;

// ── Helpers ────────────────────────────────────────────────────

/** Detect source from URL for nice badge display */
function detectSource(
  url: string
): "ManualsLib" | "Manufacturer" | "DuckDuckGo" | "AI" {
  if (url.includes("manualslib.com")) return "ManualsLib";
  // Known manufacturer domains
  if (
    url.includes("lge.com") ||
    url.includes("lg.com") ||
    url.includes("samsung.com") ||
    url.includes("bosch-home") ||
    url.includes("electra.co.il") ||
    url.includes("miele.com") ||
    url.includes("whirlpool.com") ||
    url.includes("beko.com") ||
    url.includes("siemens-home")
  )
    return "Manufacturer";
  return "DuckDuckGo";
}

/** Extract page count from title if present, e.g. "(101 pages)" */
function extractPages(title: string): number | null {
  const m = title.match(/\((\d+)\s*pages?\)/i);
  return m ? parseInt(m[1], 10) : null;
}

/**
 * STRICT filter: only accept URLs that point to actual PDF files.
 * No HTML viewer pages, no ManualsLib readers, no generic websites.
 */
function isActualPdfUrl(url: string): boolean {
  const lower = url.toLowerCase();

  // Must be a real URL
  try {
    const urlPath = new URL(lower).pathname;
    if (urlPath === "/" || urlPath === "") return false;
  } catch {
    return false;
  }

  // Direct .pdf extension — this is what we want
  if (lower.endsWith(".pdf")) return true;

  // Known download endpoints that serve raw PDF binary
  if (
    lower.includes("downloadfile") ||
    lower.includes("/dl/") && lower.includes(".pdf") ||
    lower.includes("getfile") && lower.includes("pdf")
  ) return true;

  // Everything else (HTML pages, viewers, iframes) — REJECT
  return false;
}

/**
 * Score a PDF result for sorting: higher = more relevant.
 * All results are already verified .pdf URLs at this point.
 */
function scoreResult(r: ManualResult): number {
  let score = 0;
  if (r.source === "Manufacturer") score += 70;
  if (r.pages && r.pages > 0) score += 20;
  const lowerTitle = r.title.toLowerCase();
  if (lowerTitle.includes("user manual")) score += 15;
  if (lowerTitle.includes("owner")) score += 10;
  if (lowerTitle.includes("instruction")) score += 10;
  if (lowerTitle.includes(r.brand.toLowerCase())) score += 5;
  if (lowerTitle.includes(r.model.toLowerCase())) score += 5;
  return score;
}

// ── Hebrew Detection & Translation ─────────────────────────────

/** Hebrew Unicode range: \u0590–\u05FF */
const HEBREW_REGEX = /[\u0590-\u05FF]/;

/** Check if a string contains Hebrew characters */
function containsHebrew(text: string): boolean {
  return HEBREW_REGEX.test(text);
}

/**
 * Translate a Hebrew string to English using the cheapest Groq model.
 * Returns the original string if it's already in English.
 * Uses llama-3.1-8b-instant (~10x cheaper than the main model).
 */
async function translateIfHebrew(text: string): Promise<string> {
  if (!text || !containsHebrew(text)) return text;

  try {
    const translated = await chatCompletion(
      [
        {
          role: "system",
          content:
            "You are a translator. Translate the Hebrew text to English. " +
            "Reply with ONLY the English translation, nothing else. " +
            "If it's a product type (like מקרר, תנור, מכונת כביסה), " +
            "translate to the standard English product name. " +
            "Keep brand names and model numbers as-is (they are already in English/numbers).",
        },
        { role: "user", content: text },
      ],
      {
        temperature: 0,
        maxTokens: 100,
        model: "llama-3.1-8b-instant",
      }
    );

    const result = translated.trim();
    if (result) {
      console.log(`🌐 Translated: "${text}" → "${result}"`);
      return result;
    }
  } catch (err) {
    console.error("[Translation] Error:", (err as Error).message);
  }

  return text; // fallback to original
}

// ── ManualsLib Direct URL Builder ──────────────────────────────

export interface ManualsLibUrlResult {
  url: string;
  translatedQuery: string;
  originalQuery: string;
}

/**
 * Map of brand names → ManualsLib slug.
 * ManualsLib brand pages live at: https://www.manualslib.com/brand/{slug}/
 */
const BRAND_SLUG_MAP: Record<string, string> = {
  lg: "lg",
  samsung: "samsung",
  bosch: "bosch",
  siemens: "siemens",
  miele: "miele",
  electrolux: "electrolux",
  whirlpool: "whirlpool",
  beko: "beko",
  aeg: "aeg",
  electra: "electra",
  haier: "haier",
  hitachi: "hitachi",
  panasonic: "panasonic",
  sharp: "sharp",
  toshiba: "toshiba",
  philips: "philips",
  sony: "sony",
  "general electric": "ge",
  ge: "ge",
  amana: "amana",
  frigidaire: "frigidaire",
  kitchenaid: "kitchenaid",
  maytag: "maytag",
  kenmore: "kenmore",
  zanussi: "zanussi",
  "fisher & paykel": "fisher-and-paykel",
  dyson: "dyson",
  daikin: "daikin",
  mitsubishi: "mitsubishi",
  carrier: "carrier",
  tefal: "tefal",
  delonghi: "de-longhi",
  "de'longhi": "de-longhi",
  braun: "braun",
  gorenje: "gorenje",
  candy: "candy",
  hoover: "hoover",
  smeg: "smeg",
  neff: "neff",
  "black & decker": "black-and-decker",
  "black+decker": "black-and-decker",
  breville: "breville",
  hamilton: "hamilton-beach",
  "hamilton beach": "hamilton-beach",
  honeywell: "honeywell",
  hisense: "hisense",
  tcl: "tcl",
  xiaomi: "xiaomi",
  tadiran: "tadiran",
};

/**
 * Map of product type keywords → ManualsLib category slug.
 * Category pages live at: https://www.manualslib.com/brand/{brand}/{slug}.html
 */
const PRODUCT_TYPE_MAP: Record<string, string> = {
  // Cooling
  refrigerator: "refrigerator",
  fridge: "refrigerator",
  freezer: "freezer",
  // Laundry
  "washing machine": "washer",
  washer: "washer",
  dryer: "dryer",
  "clothes dryer": "clothes-dryer",
  // Kitchen
  dishwasher: "dishwasher",
  oven: "oven",
  microwave: "microwave-oven",
  cooktop: "cooktop",
  stove: "ranges",
  range: "ranges",
  // Climate
  "air conditioner": "air-conditioner",
  "air conditioning": "air-conditioner",
  ac: "air-conditioner",
  heater: "heater",
  // Cleaning
  "vacuum cleaner": "vacuum-cleaner",
  vacuum: "vacuum-cleaner",
  "robot vacuum": "robotic-vacuum",
  // Electronics
  tv: "lcd-tv",
  television: "lcd-tv",
  "smart tv": "lcd-tv",
  monitor: "monitor",
  projector: "projector",
  soundbar: "sound-bar",
  speaker: "speakers",
  // Water
  "water heater": "water-heater",
  "water purifier": "water-purifier",
  // Small appliances
  "coffee machine": "coffee-maker",
  "coffee maker": "coffee-maker",
  toaster: "toaster",
  blender: "blender",
  "food processor": "food-processor",
  iron: "iron",
};

/**
 * Detect a known brand in the query text.
 * Returns the brand name as typed and the ManualsLib slug.
 */
function detectBrand(text: string): { name: string; slug: string } | null {
  const lower = text.toLowerCase();
  // Sort by length descending so "general electric" matches before "ge"
  const sorted = Object.entries(BRAND_SLUG_MAP).sort(
    (a, b) => b[0].length - a[0].length
  );
  for (const [name, slug] of sorted) {
    // Word-boundary match to avoid false positives
    const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (re.test(lower)) return { name, slug };
  }
  return null;
}

/**
 * Detect a known product type in the query text.
 * Returns the product keyword and the ManualsLib category slug.
 */
function detectProductType(text: string): { keyword: string; slug: string } | null {
  const lower = text.toLowerCase();
  // Sort by length descending so "washing machine" matches before "washer"
  const sorted = Object.entries(PRODUCT_TYPE_MAP).sort(
    (a, b) => b[0].length - a[0].length
  );
  for (const [keyword, slug] of sorted) {
    if (lower.includes(keyword)) return { keyword, slug };
  }
  return null;
}

/**
 * Build a ManualsLib URL from a user query.
 * Translates Hebrew → English first if needed.
 *
 * URL strategy (ManualsLib blocks /search/?q= with anti-bot measures):
 *   1. Brand + product type → /brand/{brand}/{type}.html  (most specific)
 *   2. Brand only           → /brand/{brand}/             (browse all products)
 *   3. No brand detected    → Google site-search fallback (reliable)
 */
export async function buildManualsLibUrl(query: string): Promise<ManualsLibUrlResult> {
  const originalQuery = query;

  // Translate Hebrew to English if needed
  let translatedQuery = query;
  if (containsHebrew(query)) {
    translatedQuery = await translateIfHebrew(query);
  }

  // Detect brand and product type from translated query
  const brand = detectBrand(translatedQuery);
  const productType = detectProductType(translatedQuery);

  let url: string;

  if (brand && productType) {
    // Most specific: brand + product type category page
    url = `https://www.manualslib.com/brand/${brand.slug}/${productType.slug}.html`;
    console.log(`📘 ManualsLib URL (brand+type): ${url}`);
  } else if (brand) {
    // Brand page — shows all product categories for this brand
    url = `https://www.manualslib.com/brand/${brand.slug}/`;
    console.log(`📘 ManualsLib URL (brand): ${url}`);
  } else {
    // No brand detected — use Google site-search as reliable fallback
    // Google search with site:manualslib.com shows real ManualsLib results
    const googleQuery = encodeURIComponent(
      `site:manualslib.com ${translatedQuery} manual`
    );
    url = `https://www.google.com/search?q=${googleQuery}&igu=1`;
    console.log(`📘 ManualsLib URL (Google fallback): ${url}`);
  }

  return {
    url,
    translatedQuery,
    originalQuery,
  };
}

// ── DuckDuckGo HTML Search ─────────────────────────────────────

/**
 * Search DuckDuckGo HTML endpoint for manuals.
 * This is the most reliable method — no API key needed, returns real URLs
 * via the `uddg=` parameter in redirect links.
 */
async function searchDuckDuckGo(query: string): Promise<ManualResult[]> {
  const results: ManualResult[] = [];
  const encoded = encodeURIComponent(query);
  const ddgUrl = `https://html.duckduckgo.com/html/?q=${encoded}`;

  try {
    const response = await axios.get(ddgUrl, {
      headers: HTTP_HEADERS,
      timeout: TIMEOUT,
    });

    const $ = cheerio.load(response.data);

    // DDG HTML results have class "result" with links containing uddg= redirect URLs
    $(".result").each((_i, el) => {
      const $el = $(el);
      const $link = $el.find(".result__a").first();
      const $snippet = $el.find(".result__snippet").first();

      if (!$link.length) return;

      const title = $link.text().trim();
      const rawHref = $link.attr("href") || "";

      // Extract the real URL from DDG's redirect: //duckduckgo.com/l/?uddg=<real_url>&...
      let realUrl = "";
      const uddgMatch = rawHref.match(/uddg=([^&]+)/);
      if (uddgMatch) {
        realUrl = decodeURIComponent(uddgMatch[1]);
      } else if (rawHref.startsWith("http")) {
        realUrl = rawHref;
      }

      if (!realUrl || !title) return;

      // STRICT: only accept actual PDF file URLs
      if (!isActualPdfUrl(realUrl)) return;

      const snippet = $snippet.text().trim();
      const pages = extractPages(title) || extractPages(snippet);
      const source = detectSource(realUrl);

      // viewUrl = the raw PDF URL (no iframe wrapping)
      const viewUrl = realUrl;

      results.push({
        id: uuidv4(),
        title: title.replace(/\s+/g, " ").replace(/<[^>]+>/g, ""),
        url: realUrl,
        viewUrl,
        source,
        pages,
        brand: "",
        model: "",
        language: null,
        thumbnailUrl: null,
        directPdf: true,
      });
    });
  } catch (err) {
    console.error("[DuckDuckGo] Search error:", (err as Error).message);
  }

  return results;
}

// ── Google Custom Search API (optional) ────────────────────────

export async function searchGooglePDF(
  brand: string,
  model: string,
  productType?: string
): Promise<ManualResult[]> {
  const apiKey = process.env.GOOGLE_API_KEY;
  const cx = process.env.GOOGLE_CX;

  if (!apiKey || !cx) return [];

  const results: ManualResult[] = [];
  const query = `${brand} ${model} ${productType || ""} user manual PDF`.trim();

  try {
    const response = await axios.get(
      "https://www.googleapis.com/customsearch/v1",
      {
        params: {
          key: apiKey,
          cx,
          q: query,
          num: 10,
          fileType: "pdf",
        },
        timeout: TIMEOUT,
      }
    );

    const items = response.data?.items || [];
    for (const item of items) {
      const itemUrl = item.link || "";
      // STRICT: only accept actual PDF URLs
      if (!isActualPdfUrl(itemUrl)) continue;

      results.push({
        id: uuidv4(),
        title: item.title || "",
        url: itemUrl,
        viewUrl: itemUrl,
        source: "Google",
        pages: null,
        brand,
        model,
        language: null,
        thumbnailUrl: item.pagemap?.cse_thumbnail?.[0]?.src || null,
        directPdf: true,
      });
    }
  } catch (err) {
    console.error("[Google] Search error:", (err as Error).message);
  }

  return results;
}

// ── Combined Search ────────────────────────────────────────────

export async function searchManuals(
  brand: string,
  model: string,
  productType?: string
): Promise<ManualResult[]> {
  // Translate Hebrew inputs to English for better search results
  const translatedBrand = await translateIfHebrew(brand);
  const translatedModel = await translateIfHebrew(model);
  const translatedProductType = productType
    ? await translateIfHebrew(productType)
    : undefined;

  // Use translated values for search, keep originals for display
  const searchBrand = translatedBrand;
  const searchModel = translatedModel;

  console.log(
    `🔍 Search: brand="${searchBrand}" model="${searchModel}"` +
      (translatedProductType ? ` type="${translatedProductType}"` : "") +
      (searchBrand !== brand || searchModel !== model
        ? ` (translated from: ${brand} ${model}${productType ? " " + productType : ""})`
        : "")
  );

  // Build search queries — all focused on finding actual PDF files
  const baseQuery = [searchBrand, searchModel, translatedProductType]
    .filter(Boolean)
    .join(" ");
  const filetypePdfQuery = `${baseQuery} user manual filetype:pdf`;
  const pdfQuery = `${baseQuery} user manual PDF download`;
  const directPdfQuery = `${baseQuery} manual .pdf`;

  // Run searches in parallel — all focused on finding actual PDF files
  const [ddgFiletypeResults, ddgPdfResults, ddgDirectResults, googleResults] =
    await Promise.allSettled([
      searchDuckDuckGo(filetypePdfQuery),
      searchDuckDuckGo(pdfQuery),
      searchDuckDuckGo(directPdfQuery),
      searchGooglePDF(brand, model, productType),
    ]);

  const allResults: ManualResult[] = [];

  if (ddgFiletypeResults.status === "fulfilled") {
    allResults.push(...ddgFiletypeResults.value);
  }
  if (ddgPdfResults.status === "fulfilled") {
    allResults.push(...ddgPdfResults.value);
  }
  if (ddgDirectResults.status === "fulfilled") {
    allResults.push(...ddgDirectResults.value);
  }
  if (googleResults.status === "fulfilled") {
    allResults.push(...googleResults.value);
  }

  // Fill in brand/model for all results
  for (const r of allResults) {
    if (!r.brand) r.brand = brand;
    if (!r.model) r.model = model;
  }

  // Deduplicate by URL
  const seen = new Set<string>();
  const unique = allResults.filter((r) => {
    if (seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  });

  // Sort by relevance score
  unique.sort((a, b) => scoreResult(b) - scoreResult(a));

  console.log(`   → ${unique.length} PDF results after filtering`);

  // ── AI Fallback: if no PDF results found, ask the LLM for direct PDF links ──
  if (unique.length === 0) {
    console.log("🤖 No PDF results found — trying AI fallback...");
    try {
      const aiResults = await searchWithAI(searchBrand, searchModel, translatedProductType);
      if (aiResults.length > 0) {
        console.log(`   → AI suggested ${aiResults.length} PDF links`);
        unique.push(...aiResults);
      }
    } catch (err) {
      console.error("[AI Fallback] Error:", (err as Error).message);
    }
  }

  // Final: if still no PDFs → return empty array (0 results)
  if (unique.length === 0) {
    console.log("❌ No actual PDF files found for this product.");
  }

  return unique;
}

// ── AI Fallback Search ─────────────────────────────────────────

/**
 * Ask the LLM to suggest known URLs for product manuals.
 * The AI knows about common patterns for manufacturer support pages
 * and manual databases. Used only when DDG + Google return nothing.
 */
async function searchWithAI(
  brand: string,
  model: string,
  productType?: string
): Promise<ManualResult[]> {
  const productDesc = productType
    ? `${productType} ${brand} ${model}`
    : `${brand} ${model}`;

  const prompt = `You are a helpful assistant that finds product user manuals online.
I need the user manual / instruction manual PDF for: ${productDesc}

Please provide a JSON array of up to 5 real, likely working URLs where I can find or download the manual PDF.
For each result provide:
- "title": a descriptive title
- "url": the direct URL (must be a real URL pattern, not made up)
- "source": where the link comes from

Focus on DIRECT PDF download links only:
1. Manufacturer official support pages that have direct .pdf download URLs
2. Direct PDF file links from any source
3. PDF mirrors or hosting sites

IMPORTANT:
- Every URL MUST end in .pdf or be a known direct-download endpoint
- Do NOT suggest HTML viewer pages (like ManualsLib reader pages)
- Do NOT suggest pages that just link to PDFs — I need the DIRECT .pdf URL
- Do NOT invent random URLs
- If you're not confident about a direct PDF URL, skip it

Respond ONLY with a valid JSON array, no markdown, no explanation. Example:
[{"title": "LG GR-B220 Owner Manual", "url": "https://www.manualslib.com/manual/12345/Lg-Gr-B220.html", "source": "ManualsLib"}]`;

  const response = await chatCompletion(
    [
      {
        role: "system",
        content:
          "You are a product manual search assistant. Respond only with valid JSON arrays. Never use markdown code blocks.",
      },
      { role: "user", content: prompt },
    ],
    { temperature: 0.3, maxTokens: 1024 }
  );

  // Parse the AI response
  const results: ManualResult[] = [];
  try {
    // Strip potential markdown code fences
    const cleaned = response
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();
    const parsed = JSON.parse(cleaned);

    if (!Array.isArray(parsed)) return results;

    for (const item of parsed) {
      if (!item.url || !item.title) continue;

      const url = String(item.url);
      // Basic validation — must be a proper URL
      if (!url.startsWith("https://") && !url.startsWith("http://")) continue;

      // STRICT: only accept actual PDF URLs from AI too
      if (!isActualPdfUrl(url)) continue;

      results.push({
        id: uuidv4(),
        title: String(item.title).replace(/\s+/g, " "),
        url,
        viewUrl: url,
        source: "AI",
        pages: null,
        brand,
        model,
        language: null,
        thumbnailUrl: null,
        directPdf: true,
      });
    }
  } catch (parseErr) {
    console.error("[AI Fallback] Failed to parse AI response:", parseErr);
  }

  // Validate AI URLs — try HEAD request to see if they actually exist
  const validated: ManualResult[] = [];
  for (const result of results) {
    try {
      const head = await axios.head(result.url, {
        headers: HTTP_HEADERS,
        timeout: 5000,
        maxRedirects: 3,
        validateStatus: (s) => s < 400,
      });
      if (head.status < 400) {
        validated.push(result);
      }
    } catch {
      // URL doesn't work — skip it
      console.log(`   ✗ AI link not accessible: ${result.url}`);
    }
  }

  return validated;
}

// ── Download PDF from URL ──────────────────────────────────────

/** Check if a buffer starts with the PDF magic bytes (%PDF) */
function isPDFBuffer(buf: Buffer): boolean {
  return buf.length > 4 && buf.subarray(0, 5).toString("ascii").startsWith("%PDF");
}

/**
 * Try to find a direct PDF download link inside an HTML page.
 * Works for ManualsLib download pages, manufacturer portals, etc.
 */
function extractPdfLinkFromHtml(html: string, baseUrl: string): string | null {
  const $ = cheerio.load(html);
  const candidates: string[] = [];

  // Look for links that point to .pdf files or download endpoints
  $("a[href]").each((_i, el) => {
    const href = $(el).attr("href") || "";
    const lower = href.toLowerCase();
    if (
      lower.endsWith(".pdf") ||
      lower.includes("download") ||
      lower.includes("/dl/") ||
      lower.includes("file=") ||
      lower.includes("getfile")
    ) {
      candidates.push(href);
    }
  });

  // Also check meta refresh or iframe src
  $("iframe[src], embed[src], object[data]").each((_i, el) => {
    const src = $(el).attr("src") || $(el).attr("data") || "";
    if (src.toLowerCase().endsWith(".pdf") || src.includes("download")) {
      candidates.push(src);
    }
  });

  // Prioritize .pdf links
  const pdfLink = candidates.find((c) => c.toLowerCase().endsWith(".pdf"));
  const downloadLink = pdfLink || candidates[0];

  if (!downloadLink) return null;

  // Resolve relative URLs
  try {
    return new URL(downloadLink, baseUrl).href;
  } catch {
    return downloadLink.startsWith("http") ? downloadLink : null;
  }
}

/**
 * Pre-check a URL via HEAD request to see if it serves a PDF.
 * Returns the final URL (after redirects) and content type.
 */
async function headCheckPdf(
  url: string
): Promise<{ isPdf: boolean; contentType: string; finalUrl: string }> {
  try {
    const head = await axios.head(url, {
      headers: HTTP_HEADERS,
      timeout: 10000,
      maxRedirects: 5,
      validateStatus: (s) => s < 400,
    });
    const ct = (head.headers["content-type"] || "").toLowerCase();
    const finalUrl =
      head.request?.res?.responseUrl || head.request?.responseURL || url;
    return {
      isPdf: ct.includes("application/pdf") || ct.includes("application/octet-stream"),
      contentType: ct,
      finalUrl,
    };
  } catch {
    return { isPdf: false, contentType: "", finalUrl: url };
  }
}

export async function downloadManualPDF(
  url: string,
  brand: string,
  model: string
): Promise<ManualDownloadResult> {
  const uploadDir = process.env.UPLOAD_DIR || "./uploads";
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }

  const safeModel = model.replace(/[^a-zA-Z0-9_-]/g, "_");
  const safeBrand = brand.replace(/[^a-zA-Z0-9_-]/g, "_");
  const fileName = `${safeBrand}_${safeModel}_manual_${uuidv4().slice(0, 8)}.pdf`;
  const filePath = path.join(uploadDir, fileName);

  // Step 0: HEAD pre-check — verify the URL serves a PDF before downloading
  console.log(`  → HEAD check: ${url}`);
  const headInfo = await headCheckPdf(url);
  const downloadUrl = headInfo.finalUrl || url;

  if (!headInfo.isPdf && !downloadUrl.toLowerCase().endsWith(".pdf")) {
    console.log(
      `  ⚠ HEAD says content-type: "${headInfo.contentType}" — trying to extract PDF link from page`
    );

    // If HEAD says it's HTML, fetch the page and look for a real PDF link
    try {
      const pageResp = await axios.get(downloadUrl, {
        headers: HTTP_HEADERS,
        timeout: 15000,
        responseType: "text",
      });
      const html = typeof pageResp.data === "string" ? pageResp.data : "";
      const realPdfUrl = extractPdfLinkFromHtml(html, downloadUrl);

      if (realPdfUrl) {
        console.log(`  → Found embedded PDF link: ${realPdfUrl}`);
        const secondCheck = await headCheckPdf(realPdfUrl);
        if (secondCheck.isPdf || realPdfUrl.toLowerCase().endsWith(".pdf")) {
          return await doDownloadAndValidate(
            secondCheck.finalUrl || realPdfUrl,
            filePath,
            fileName
          );
        }
      }
    } catch (e) {
      console.log(`  ⚠ Could not fetch page for link extraction: ${(e as Error).message}`);
    }

    throw new Error(
      'הקישור אינו מוביל לקובץ PDF. נסה לבחור תוצאה אחרת — עדיף כזו המסומנת "PDF ישיר"'
    );
  }

  return await doDownloadAndValidate(downloadUrl, filePath, fileName);
}

/** Actually download the URL and validate the bytes are a real PDF */
async function doDownloadAndValidate(
  url: string,
  filePath: string,
  fileName: string
): Promise<ManualDownloadResult> {
  console.log(`  → Downloading: ${url}`);
  const response = await axios.get(url, {
    headers: HTTP_HEADERS,
    responseType: "arraybuffer",
    timeout: 60000,
    maxContentLength: 100 * 1024 * 1024,
  });

  const buffer = Buffer.from(response.data);

  if (!isPDFBuffer(buffer)) {
    const ct = (response.headers["content-type"] || "").toLowerCase();
    console.log(
      `  ✗ Downloaded content is NOT a PDF (content-type: ${ct}, ` +
        `first bytes: "${buffer.subarray(0, 15).toString("ascii").replace(/[^\x20-\x7E]/g, "?")}")`
    );
    throw new Error(
      'הקובץ שהתקבל אינו PDF תקין. ייתכן שהאתר חוסם הורדה ישירה. נסה לבחור תוצאה אחרת, עדיף כזו המסומנת "PDF ישיר"'
    );
  }

  fs.writeFileSync(filePath, buffer);
  console.log(`  ✓ Saved valid PDF: ${fileName} (${(buffer.length / 1024).toFixed(1)} KB)`);

  return {
    success: true,
    filePath,
    fileName,
    fileSize: buffer.length,
  };
}
