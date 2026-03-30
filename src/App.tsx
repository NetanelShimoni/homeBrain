/**
 * HomeBrain — Main Application Component
 *
 * RAG-based home document assistant.
 * Answers MUST be grounded in uploaded documents only.
 * Language: Hebrew בלבד.
 */
import { useState, useEffect, useCallback } from "react";
import { Header } from "./components/Layout/Header";
import { Sidebar } from "./components/Layout/Sidebar";
import { ChatContainer } from "./components/Chat/ChatContainer";
import { useChat } from "./hooks/useChat";
import { useDocuments } from "./hooks/useDocuments";
import { checkHealth } from "./services/api";
import "./App.css";

function App() {
  const [isConnected, setIsConnected] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  const { messages, isLoading, sendMessage, clearChat } = useChat();
  const {
    documents,
    topics,
    isUploading,
    uploadProgress,
    uploadDocuments,
    removeDocument,
    removeTopic,
    renameTopic,
    refreshAll,
  } = useDocuments();

  // Health check on mount
  useEffect(() => {
    const check = async () => {
      try {
        await checkHealth();
        setIsConnected(true);
      } catch {
        setIsConnected(false);
      }
    };
    check();
    const interval = setInterval(check, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleSendMessage = useCallback(
    (message: string, topicId?: string) => {
      sendMessage(message, topicId);
    },
    [sendMessage]
  );

  const toggleSidebar = useCallback(() => {
    setIsSidebarOpen((prev) => !prev);
  }, []);

  const closeSidebar = useCallback(() => {
    setIsSidebarOpen(false);
  }, []);

  return (
    <div className="app" dir="rtl">
      <Header
        documentsCount={documents.length}
        isConnected={isConnected}
        onToggleSidebar={toggleSidebar}
        isSidebarOpen={isSidebarOpen}
      />

      <div className="app-body">
        {/* Overlay for mobile sidebar */}
        {isSidebarOpen && (
          <div className="sidebar-overlay" onClick={closeSidebar} />
        )}

        <Sidebar
          documents={documents}
          topics={topics}
          onUpload={uploadDocuments}
          onDeleteDocument={removeDocument}
          onDeleteTopic={removeTopic}
          onRenameTopic={renameTopic}
          isUploading={isUploading}
          uploadProgress={uploadProgress}
          isOpen={isSidebarOpen}
          onClose={closeSidebar}
          onManualImported={refreshAll}
        />

        <ChatContainer
          messages={messages}
          isLoading={isLoading}
          onSendMessage={handleSendMessage}
          onClearChat={clearChat}
          topics={topics}
        />
      </div>
    </div>
  );
}

export default App
