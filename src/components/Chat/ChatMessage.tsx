/**
 * Individual chat message bubble.
 * AI responses are rendered with basic markdown formatting.
 */
import React from "react";
import type { ChatMessage } from "../../types/ai";

/** Parse simple markdown to React elements */
function renderMarkdown(text: string): React.ReactNode[] {
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  let listItems: React.ReactNode[] = [];
  let listType: "ol" | "ul" | null = null;
  let listKey = 0;

  const flushList = () => {
    if (listItems.length > 0 && listType) {
      const Tag = listType;
      elements.push(
        <Tag key={`list-${listKey++}`} className="md-list">
          {listItems}
        </Tag>
      );
      listItems = [];
      listType = null;
    }
  };

  const formatInline = (line: string): React.ReactNode[] => {
    const parts: React.ReactNode[] = [];
    // Bold **text** or __text__
    const regex = /(\*\*|__)(.*?)\1/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(line)) !== null) {
      if (match.index > lastIndex) {
        parts.push(line.slice(lastIndex, match.index));
      }
      parts.push(<strong key={match.index}>{match[2]}</strong>);
      lastIndex = regex.lastIndex;
    }

    if (lastIndex < line.length) {
      parts.push(line.slice(lastIndex));
    }

    return parts.length > 0 ? parts : [line];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Headers: ### / ## / #
    const h3Match = line.match(/^###\s+(.+)/);
    if (h3Match) {
      flushList();
      elements.push(<h4 key={i} className="md-h3">{formatInline(h3Match[1])}</h4>);
      continue;
    }
    const h2Match = line.match(/^##\s+(.+)/);
    if (h2Match) {
      flushList();
      elements.push(<h3 key={i} className="md-h2">{formatInline(h2Match[1])}</h3>);
      continue;
    }
    const h1Match = line.match(/^#\s+(.+)/);
    if (h1Match) {
      flushList();
      elements.push(<h2 key={i} className="md-h1">{formatInline(h1Match[1])}</h2>);
      continue;
    }

    // Ordered list: 1. / 2. etc.
    const olMatch = line.match(/^(\d+)[.)]\s+(.+)/);
    if (olMatch) {
      if (listType !== "ol") {
        flushList();
        listType = "ol";
      }
      listItems.push(<li key={i}>{formatInline(olMatch[2])}</li>);
      continue;
    }

    // Unordered list: - item or • item or * item
    const ulMatch = line.match(/^[-•*]\s+(.+)/);
    if (ulMatch) {
      if (listType !== "ul") {
        flushList();
        listType = "ul";
      }
      listItems.push(<li key={i}>{formatInline(ulMatch[1])}</li>);
      continue;
    }

    // Normal line
    flushList();

    if (line.trim() === "") {
      elements.push(<br key={i} />);
    } else {
      elements.push(
        <p key={i} className="md-p">{formatInline(line)}</p>
      );
    }
  }

  flushList();
  return elements;
}

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
          {isUser ? (
            message.content.split("\n").map((line, i) => (
              <React.Fragment key={i}>
                {line}
                {i < message.content.split("\n").length - 1 && <br />}
              </React.Fragment>
            ))
          ) : (
            <div className="md-content">{renderMarkdown(message.content)}</div>
          )}
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
