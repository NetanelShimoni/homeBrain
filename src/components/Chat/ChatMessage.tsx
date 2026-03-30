/**
 * Individual chat message bubble.
 */
import React from "react";
import type { ChatMessage } from "../../types/ai";

interface ChatMessageBubbleProps {
  message: ChatMessage;
}

export const ChatMessageBubble: React.FC<ChatMessageBubbleProps> = ({
  message,
}) => {
  const isUser = message.role === "user";

  return (
    <div className={`message ${isUser ? "user-message" : "assistant-message"}`}>
      <div className="message-avatar">{isUser ? "👤" : "🧠"}</div>
      <div className="message-body">
        <div className="message-content">
          {message.content.split("\n").map((line, i) => (
            <React.Fragment key={i}>
              {line}
              {i < message.content.split("\n").length - 1 && <br />}
            </React.Fragment>
          ))}
        </div>

        {message.sources && message.sources.length > 0 && (
          <div className="message-sources">
            <span className="sources-label">📎 מקורות:</span>
            {message.sources.map((source, i) => (
              <span key={i} className="source-tag">
                {source.fileName}
              </span>
            ))}
          </div>
        )}

        <span className="message-time">
          {new Date(message.timestamp).toLocaleTimeString("he-IL", {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      </div>
    </div>
  );
};
