/**
 * File upload component with drag-and-drop support.
 * Supports multiple file selection — all go into one topic.
 */
import React, { useCallback, useRef, useState } from "react";
import type { UploadResult } from "../../services/api";

interface FileUploadProps {
  onUpload: (files: File[]) => Promise<UploadResult | null>;
  isUploading: boolean;
  uploadProgress: string | null;
}

export const FileUpload: React.FC<FileUploadProps> = ({
  onUpload,
  isUploading,
  uploadProgress,
}) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const [lastResult, setLastResult] = useState<UploadResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setLastResult(null);
      const result = await onUpload(files);
      if (result && result.documents.length > 0) {
        setLastResult(result);
        setTimeout(() => setLastResult(null), 8000);
      }
    },
    [onUpload]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) handleFiles(files);
    },
    [handleFiles]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragOver(false);
  }, []);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);
      if (files.length > 0) handleFiles(files);
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    [handleFiles]
  );

  return (
    <div className="upload-section">
      <h3>📄 העלאת מסמכים</h3>

      <div
        className={`drop-zone ${isDragOver ? "drag-over" : ""} ${isUploading ? "uploading" : ""}`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => !isUploading && fileInputRef.current?.click()}
      >
        {isUploading ? (
          <div className="upload-progress">
            <div className="spinner" />
            <p>{uploadProgress || "מעבד..."}</p>
          </div>
        ) : (
          <>
            <span className="drop-icon">📁</span>
            <p>גרור קבצים לכאן או לחץ לבחירה</p>
            <span className="drop-hint">
              קבצים שנבחרו ביחד יקובצו לנושא אחד — PDF, תמונות, טקסט
            </span>
          </>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.jpg,.jpeg,.png,.webp,.bmp,.tiff,.tif,.txt"
        multiple
        onChange={handleInputChange}
        style={{ display: "none" }}
      />

      {lastResult && (
        <div className="upload-result">
          <p>
            ✅ נוצר נושא "{lastResult.topic.name}" עם{" "}
            {lastResult.documents.length} מסמכים
          </p>
          <div className="upload-results-list">
            {lastResult.documents.map((doc, i) => (
              <div key={i} className="result-details">
                <span className="result-filename">{doc.fileName}</span>
                <span>סוג: {doc.documentType}</span>
                <span>חלקים: {doc.chunksCount}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
