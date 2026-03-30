/**
 * Document list component.
 * Displays uploaded documents with actions.
 */
import React from "react";
import type { DocumentMetadata } from "../../types/documents";
import { getDownloadUrl } from "../../services/api";

interface DocumentListProps {
  documents: DocumentMetadata[];
  onDelete: (id: string) => void;
}

const DOC_TYPE_LABELS: Record<string, string> = {
  manual: "📖 מדריך",
  warranty: "🛡️ אחריות",
  installation: "🔧 התקנה",
  other: "📄 אחר",
};

export const DocumentList: React.FC<DocumentListProps> = ({
  documents,
  onDelete,
}) => {
  if (documents.length === 0) {
    return (
      <div className="documents-section">
        <h3>📚 מסמכים</h3>
        <p className="documents-empty">אין מסמכים. העלה מסמך כדי להתחיל.</p>
      </div>
    );
  }

  return (
    <div className="documents-section">
      <h3>📚 מסמכים ({documents.length})</h3>
      <div className="documents-list">
        {documents.map((doc) => (
          <div key={doc.id} className="document-item">
            <div className="document-info">
              <span className="document-name" title={doc.fileName}>
                {doc.fileName}
              </span>
              <div className="document-meta">
                <span className="document-type">
                  {DOC_TYPE_LABELS[doc.documentType] || doc.documentType}
                </span>
                <span className="document-category">{doc.category}</span>
              </div>
            </div>
            <div className="document-actions">
              <a
                href={getDownloadUrl(doc.id)}
                className="btn-icon"
                title="הורדה"
                target="_blank"
                rel="noopener noreferrer"
              >
                ⬇️
              </a>
              <button
                className="btn-icon btn-delete"
                title="מחיקה"
                onClick={() => onDelete(doc.id)}
              >
                🗑️
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
