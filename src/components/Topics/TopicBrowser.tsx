/**
 * TopicBrowser — displays topics as expandable folders.
 * Each folder contains its documents with download/delete actions.
 * Topics can be deleted entirely (removes all docs inside).
 */
import React, { useState } from "react";
import type { Topic, DocumentMetadata } from "../../types/documents";
import { getDownloadUrl } from "../../services/api";

const DOC_TYPE_LABELS: Record<string, string> = {
  manual: "📖 מדריך",
  warranty: "🛡️ אחריות",
  installation: "🔧 התקנה",
  other: "📄 אחר",
};

interface TopicBrowserProps {
  topics: Topic[];
  documents: DocumentMetadata[];
  onDeleteDocument: (id: string) => void;
  onDeleteTopic: (id: string) => void;
  onRenameTopic: (id: string, name: string) => void;
}

export const TopicBrowser: React.FC<TopicBrowserProps> = ({
  topics,
  documents,
  onDeleteDocument,
  onDeleteTopic,
  onRenameTopic,
}) => {
  const [expandedTopics, setExpandedTopics] = useState<Set<string>>(new Set());
  const [editingTopicId, setEditingTopicId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  const toggleTopic = (topicId: string) => {
    setExpandedTopics((prev) => {
      const next = new Set(prev);
      if (next.has(topicId)) {
        next.delete(topicId);
      } else {
        next.add(topicId);
      }
      return next;
    });
  };

  const getTopicDocuments = (topic: Topic): DocumentMetadata[] => {
    return documents.filter((d) => topic.documentIds.includes(d.id));
  };

  const startEditing = (topic: Topic, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingTopicId(topic.id);
    setEditingName(topic.name);
  };

  const cancelEditing = () => {
    setEditingTopicId(null);
    setEditingName("");
  };

  const submitRename = () => {
    if (editingTopicId && editingName.trim()) {
      onRenameTopic(editingTopicId, editingName.trim());
    }
    cancelEditing();
  };

  if (topics.length === 0) {
    return (
      <div className="topics-section">
        <h3>📁 נושאים</h3>
        <p className="topics-empty">אין נושאים. העלה מסמכים כדי ליצור נושא.</p>
      </div>
    );
  }

  return (
    <div className="topics-section">
      <h3>📁 נושאים ({topics.length})</h3>
      <div className="topics-list">
        {topics.map((topic) => {
          const isExpanded = expandedTopics.has(topic.id);
          const topicDocs = getTopicDocuments(topic);

          return (
            <div key={topic.id} className="topic-folder">
              <div
                className={`topic-header ${isExpanded ? "expanded" : ""}`}
                onClick={() => editingTopicId !== topic.id && toggleTopic(topic.id)}
              >
                <div className="topic-header-right">
                  <span className="topic-chevron">
                    {isExpanded ? "▾" : "◂"}
                  </span>
                  <span className="topic-icon">📂</span>
                  {editingTopicId === topic.id ? (
                    <input
                      className="topic-name-input"
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") submitRename();
                        if (e.key === "Escape") cancelEditing();
                      }}
                      onBlur={submitRename}
                      onClick={(e) => e.stopPropagation()}
                      autoFocus
                    />
                  ) : (
                    <>
                      <span className="topic-name">{topic.name}</span>
                      <span className="topic-count">({topicDocs.length})</span>
                    </>
                  )}
                </div>
                <div className="topic-actions">
                  {editingTopicId !== topic.id && (
                    <button
                      className="btn-icon btn-edit-topic"
                      title="ערוך שם נושא"
                      onClick={(e) => startEditing(topic, e)}
                    >
                      ✏️
                    </button>
                  )}
                  <button
                    className="btn-icon btn-delete-topic"
                    title="מחק נושא"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`למחוק את הנושא "${topic.name}" וכל מסמכיו?`)) {
                        onDeleteTopic(topic.id);
                      }
                    }}
                  >
                    🗑️
                  </button>
                </div>
              </div>

              {isExpanded && (
                <div className="topic-documents">
                  {topicDocs.length === 0 ? (
                    <p className="topic-docs-empty">אין מסמכים בנושא זה</p>
                  ) : (
                    topicDocs.map((doc) => (
                      <div key={doc.id} className="document-item">
                        <div className="document-info">
                          <span className="document-name" title={doc.fileName}>
                            {doc.fileName}
                          </span>
                          <div className="document-meta">
                            <span className="document-type">
                              {DOC_TYPE_LABELS[doc.documentType] ||
                                doc.documentType}
                            </span>
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
                            onClick={() => onDeleteDocument(doc.id)}
                          >
                            🗑️
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
