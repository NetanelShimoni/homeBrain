/**
 * Sidebar component — upload, manual search, topic browser.
 * On mobile: slides in as an overlay drawer from the right.
 */
import React from "react";
import { FileUpload } from "../Upload/FileUpload";
import { ManualSearch } from "../ManualSearch/ManualSearch";
import { TopicBrowser } from "../Topics/TopicBrowser";
import type { DocumentMetadata, Topic } from "../../types/documents";
import type { UploadResult } from "../../services/api";

interface SidebarProps {
  documents: DocumentMetadata[];
  topics: Topic[];
  onUpload: (files: File[]) => Promise<UploadResult | null>;
  onDeleteDocument: (id: string) => void;
  onDeleteTopic: (id: string) => void;
  onRenameTopic: (id: string, name: string) => void;
  isUploading: boolean;
  uploadProgress: string | null;
  isOpen: boolean;
  onClose: () => void;
  onManualImported?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  documents,
  topics,
  onUpload,
  onDeleteDocument,
  onDeleteTopic,
  onRenameTopic,
  isUploading,
  uploadProgress,
  isOpen,
  onClose,
  onManualImported,
}) => {
  return (
    <aside className={`sidebar ${isOpen ? "sidebar-open" : ""}`}>
      <div className="sidebar-header-mobile">
        <h3>📋 ניהול מסמכים</h3>
        <button className="sidebar-close-btn" onClick={onClose} aria-label="סגור">
          ✕
        </button>
      </div>

      <FileUpload
        onUpload={onUpload}
        isUploading={isUploading}
        uploadProgress={uploadProgress}
      />

      <ManualSearch onImportComplete={onManualImported} />

      <TopicBrowser
        topics={topics}
        documents={documents}
        onDeleteDocument={onDeleteDocument}
        onDeleteTopic={onDeleteTopic}
        onRenameTopic={onRenameTopic}
      />
    </aside>
  );
};
