/**
 * Header component for HomeBrain.
 * Includes mobile sidebar toggle button.
 */
import React from "react";

interface HeaderProps {
  documentsCount: number;
  isConnected: boolean;
  onToggleSidebar: () => void;
  isSidebarOpen: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  documentsCount,
  isConnected,
  onToggleSidebar,
  isSidebarOpen,
}) => {
  return (
    <header className="header">
      <div className="header-content">
        <div className="header-right">
          <button
            className="sidebar-toggle"
            onClick={onToggleSidebar}
            aria-label={isSidebarOpen ? "סגור תפריט" : "פתח תפריט"}
          >
            {isSidebarOpen ? "✕" : "☰"}
          </button>
          <div className="header-title">
            <span className="header-icon">🧠</span>
            <h1>HomeBrain</h1>
            <span className="header-subtitle">העוזר החכם למסמכי הבית</span>
          </div>
        </div>
        <div className="header-status">
          <span className={`status-dot ${isConnected ? "connected" : "disconnected"}`} />
          <span className="status-text">
            {isConnected ? "מחובר" : "לא מחובר"}
          </span>
          <span className="docs-count">{documentsCount} מסמכים</span>
        </div>
      </div>
    </header>
  );
};
