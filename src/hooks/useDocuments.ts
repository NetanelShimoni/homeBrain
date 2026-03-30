/**
 * Custom hook for document & topic management.
 * Handles upload, listing, deletion with topic grouping.
 */
import { useState, useCallback, useEffect } from "react";
import type { DocumentMetadata, Topic } from "../types/documents";
import {
  uploadDocuments as uploadDocumentsAPI,
  getDocuments,
  getTopics as getTopicsAPI,
  deleteDocument as deleteDocumentAPI,
  deleteTopic as deleteTopicAPI,
  renameTopic as renameTopicAPI,
  type UploadResult,
} from "../services/api";

export function useDocuments() {
  const [documents, setDocuments] = useState<DocumentMetadata[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchDocuments = useCallback(async () => {
    try {
      const docs = await getDocuments();
      setDocuments(docs);
    } catch {
      console.error("Failed to fetch documents");
    }
  }, []);

  const fetchTopics = useCallback(async () => {
    try {
      const t = await getTopicsAPI();
      setTopics(t);
    } catch {
      console.error("Failed to fetch topics");
    }
  }, []);

  const refreshAll = useCallback(async () => {
    await Promise.all([fetchDocuments(), fetchTopics()]);
  }, [fetchDocuments, fetchTopics]);

  /**
   * Upload files — all files in one call share the same topic.
   */
  const uploadDocuments = useCallback(
    async (
      files: File[],
      topicId?: string,
      topicName?: string
    ): Promise<UploadResult | null> => {
      setIsUploading(true);
      setError(null);
      setUploadProgress(`מעבד ${files.length} קבצים...`);

      try {
        const result = await uploadDocumentsAPI(files, topicId, topicName);
        setUploadProgress(null);
        await refreshAll();

        if (result.documents.length === 0) {
          setError("לא הצלחנו להעלות אף קובץ");
        } else if (result.documents.length < files.length) {
          setError(
            `${result.documents.length} מתוך ${files.length} קבצים הועלו בהצלחה`
          );
        }

        return result;
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "שגיאה בהעלאת הקבצים";
        setError(errorMessage);
        setUploadProgress(null);
        return null;
      } finally {
        setIsUploading(false);
      }
    },
    [refreshAll]
  );

  const removeDocument = useCallback(
    async (id: string) => {
      try {
        await deleteDocumentAPI(id);
        await refreshAll();
      } catch {
        setError("שגיאה במחיקת המסמך");
      }
    },
    [refreshAll]
  );

  const removeTopic = useCallback(
    async (id: string) => {
      try {
        await deleteTopicAPI(id);
        await refreshAll();
      } catch {
        setError("שגיאה במחיקת הנושא");
      }
    },
    [refreshAll]
  );

  const renameTopic = useCallback(
    async (id: string, name: string) => {
      try {
        await renameTopicAPI(id, name);
        await refreshAll();
      } catch {
        setError("שגיאה בשינוי שם הנושא");
      }
    },
    [refreshAll]
  );

  // Load documents and topics on mount
  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  return {
    documents,
    topics,
    isUploading,
    uploadProgress,
    error,
    uploadDocuments,
    removeDocument,
    removeTopic,
    renameTopic,
    refreshAll,
  };
}
