/**
 * Chat container — holds message list and input.
 * Supports @ topic mentions for filtered queries.
 */
import React, { useRef, useEffect, useState } from "react";
import { ChatMessageBubble } from "./ChatMessage";
import { ChatInput } from "./ChatInput";
import type { ChatMessage } from "../../types/ai";
import type { Topic } from "../../types/documents";

interface ChatContainerProps {
  messages: ChatMessage[];
  isLoading: boolean;
  onSendMessage: (message: string, topicId?: string) => void;
  onClearChat: () => void;
  topics: Topic[];
}

export const ChatContainer: React.FC<ChatContainerProps> = ({
  messages,
  isLoading,
  onSendMessage,
  onClearChat,
  topics,
}) => {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [selectedTopicId, setSelectedTopicId] = useState<string | undefined>();

  const selectedTopic = topics.find((t) => t.id === selectedTopicId);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <main className="chat-container">
      <div className="chat-header">
        <h2>💬 שאל אותי על המכשירים שלך</h2>
        <div className="chat-header-actions">
          {selectedTopic && (
            <span className="active-filter-badge">
              @ {selectedTopic.name}
            </span>
          )}
          {messages.length > 0 && (
            <button className="btn-clear" onClick={onClearChat}>
              🗑️ נקה שיחה
            </button>
          )}
        </div>
      </div>

      <div className="messages-area">
        {messages.length === 0 && (
          <div className="empty-chat">
            <div className="empty-chat-icon">🧠</div>
            <h3>ברוכים הבאים ל-HomeBrain!</h3>
            <p>
              העלה מסמכים של מכשירי בית (מדריכים, אחריות, הוראות התקנה)
              <br />
              ושאל שאלות — אני אענה על סמך המסמכים שהעלית.
            </p>
            <div className="example-questions">
              <p>🔹 דוגמאות לשאלות:</p>
              <ul>
                <li>"איך לנקות את המסנן של המזגן?"</li>
                <li>"מתי פג תוקף האחריות על המקרר?"</li>
                <li>הקלד <strong>@</strong> כדי לשאול על נושא ספציפי</li>
              </ul>
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <ChatMessageBubble key={msg.id} message={msg} />
        ))}

        {isLoading && (
          <div className="message assistant-message loading-message">
            <div className="message-avatar">🧠</div>
            <div className="message-content">
              <div className="typing-indicator">
                <span></span>
                <span></span>
                <span></span>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <ChatInput
        onSend={onSendMessage}
        disabled={isLoading}
        topics={topics}
        selectedTopicId={selectedTopicId}
        onTopicSelect={setSelectedTopicId}
      />
    </main>
  );
};
