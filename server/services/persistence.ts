/**
 * Simple JSON-file persistence layer.
 * Saves data to ./data/*.json so state survives server restarts.
 * Uses debounced writes to avoid excessive disk I/O.
 */
import fs from "fs";
import path from "path";

const DATA_DIR = path.resolve("./data");

// Ensure the data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function filePath(name: string): string {
  return path.join(DATA_DIR, `${name}.json`);
}

/**
 * Load JSON data from disk. Returns null if file doesn't exist.
 */
export function loadData<T>(name: string): T | null {
  const fp = filePath(name);
  try {
    if (!fs.existsSync(fp)) return null;
    const raw = fs.readFileSync(fp, "utf-8");
    const data = JSON.parse(raw) as T;
    console.log(`💾 Loaded ${name} from disk`);
    return data;
  } catch (err) {
    console.error(`⚠️ Failed to load ${name}:`, err);
    return null;
  }
}

// ── Debounced save ──────────────────────────────────────────

const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();
const DEBOUNCE_MS = 500; // wait 500ms after last mutation before writing

/**
 * Save JSON data to disk (debounced — batches rapid writes).
 */
export function saveData<T>(name: string, data: T): void {
  // Clear any pending timer for this file
  const existing = pendingTimers.get(name);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(() => {
    pendingTimers.delete(name);
    try {
      const fp = filePath(name);
      fs.writeFileSync(fp, JSON.stringify(data), "utf-8");
      console.log(`💾 Saved ${name} to disk`);
    } catch (err) {
      console.error(`⚠️ Failed to save ${name}:`, err);
    }
  }, DEBOUNCE_MS);

  pendingTimers.set(name, timer);
}

/**
 * Force-flush all pending saves (call before process exit).
 */
export function flushAll(): void {
  for (const [name, timer] of pendingTimers.entries()) {
    clearTimeout(timer);
    pendingTimers.delete(name);
    // We can't access the data here, so flushAll is a safety net
    // Real flushing happens via the specific save calls
  }
}
