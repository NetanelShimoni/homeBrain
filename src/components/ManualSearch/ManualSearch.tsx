/**
 * ManualSearch — search for product manuals on ManualsLib.
 *
 * New simplified flow:
 *   1. User types a free-text search query (brand, model, product type — anything)
 *   2. If Hebrew → translated to English automatically on the server
 *   3. ManualsLib opens in a centered iframe overlay (brand/category pages)
 *      — Google site-search fallback opens in a new tab
 *   4. User browses ManualsLib directly and downloads the manual they want
 *   5. User then uploads the downloaded PDF via the regular upload flow
 */
import React, { useState, useCallback, useRef } from "react";
import { getManualsLibUrl } from "../../services/api";

interface ManualSearchProps {
  onImportComplete?: () => void;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const ManualSearch: React.FC<ManualSearchProps> = (_props) => {
  const [query, setQuery] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // iframe overlay state
  const [iframeUrl, setIframeUrl] = useState<string | null>(null);
  const [translatedQuery, setTranslatedQuery] = useState<string | null>(null);
  const [iframeBlocked, setIframeBlocked] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // ── Search ────────────────────────────────────────────────

  const handleSearch = useCallback(async () => {
    const trimmed = query.trim();
    if (!trimmed) {
      setError("יש להזין טקסט לחיפוש");
      return;
    }

    setIsLoading(true);
    setError(null);
    setIframeBlocked(false);

    try {
      const result = await getManualsLibUrl(trimmed);

      // If it's a Google fallback URL, open directly in a new tab
      if (result.url.includes("google.com/search")) {
        window.open(result.url, "_blank");
        setIsLoading(false);
        return;
      }

      setIframeUrl(result.url);
      setTranslatedQuery(
        result.translatedQuery !== result.originalQuery
          ? result.translatedQuery
          : null
      );
    } catch (err) {
      setError("שגיאה בחיפוש. נסה שוב.");
      console.error("ManualsLib search error:", err);
    } finally {
      setIsLoading(false);
    }
  }, [query]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") handleSearch();
    },
    [handleSearch]
  );

  const handleCloseIframe = useCallback(() => {
    setIframeUrl(null);
    setTranslatedQuery(null);
    setIframeBlocked(false);
  }, []);

  // Open in external browser tab
  const handleOpenExternal = useCallback(() => {
    if (iframeUrl) {
      window.open(iframeUrl, "_blank");
    }
  }, [iframeUrl]);

  // Detect if iframe loading failed (X-Frame-Options block)
  const handleIframeError = useCallback(() => {
    setIframeBlocked(true);
  }, []);

  // ── Render ────────────────────────────────────────────────

  return (
    <>
      {/* Search form — in sidebar */}
      <div className="manual-search">
        <h3>🔍 חיפוש מדריך הפעלה</h3>

        <div className="manual-search-form">
          <div className="manual-search-fields">
            <input
              type="text"
              className="manual-input"
              placeholder="חפש: יצרן, דגם או סוג מוצר..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isLoading}
            />
            <div className="manual-search-hint">
              💡 ניתן לכתוב בעברית — יתורגם אוטומטית
            </div>
          </div>
          <button
            className="manual-search-btn"
            onClick={handleSearch}
            disabled={isLoading || !query.trim()}
          >
            {isLoading ? (
              <>
                <span className="spinner-small" />
                מחפש...
              </>
            ) : (
              "🔍 חפש ב-ManualsLib"
            )}
          </button>
        </div>

        {error && (
          <div className="manual-error">
            <span>⚠️</span> {error}
          </div>
        )}
      </div>

      {/* ── ManualsLib iframe overlay — centered on screen ── */}
      {iframeUrl && (
        <div className="manualslib-overlay" onClick={handleCloseIframe}>
          <div className="manualslib-modal" onClick={(e) => e.stopPropagation()}>
            <div className="manualslib-header">
              <div className="manualslib-header-right">
                <button
                  className="manualslib-close-btn"
                  onClick={handleCloseIframe}
                  title="סגור"
                >
                  ✕
                </button>
                <div className="manualslib-title-area">
                  <span className="manualslib-title">ManualsLib</span>
                  {translatedQuery && (
                    <span className="manualslib-translated">
                      🌐 תורגם ל: "{translatedQuery}"
                    </span>
                  )}
                </div>
              </div>
              <div className="manualslib-header-left">
                <button
                  className="manualslib-external-btn"
                  onClick={handleOpenExternal}
                  title="פתח בטאב חדש"
                >
                  🔗 פתח בדפדפן
                </button>
              </div>
            </div>
            <div className="manualslib-info-bar">
              <span>📖 מצא את המדריך המתאים, הורד אותו כ-PDF, ואז העלה אותו למערכת דרך כפתור "העלאת קבצים"</span>
            </div>
            <div className="manualslib-body">
              {iframeBlocked ? (
                <div className="manualslib-blocked">
                  <p>⚠️ האתר חוסם הצגה בתוך המערכת.</p>
                  <button
                    className="manualslib-external-btn"
                    onClick={handleOpenExternal}
                  >
                    🔗 פתח את ManualsLib בטאב חדש
                  </button>
                </div>
              ) : (
                <iframe
                  ref={iframeRef}
                  src={iframeUrl}
                  title="ManualsLib Search"
                  sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-popups-to-escape-sandbox"
                  referrerPolicy="no-referrer"
                  onError={handleIframeError}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};
