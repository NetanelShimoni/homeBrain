/**
 * Custom hook for chat state management.
 * Manages conversation history and AI queries.
 */
import { useState, useCallback } from "react";
import { v4 as uuidv4 } from "uuid";
import type { ChatMessage } from "../types/ai";
import { queryAI } from "../services/api";

export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendMessage = useCallback(
    async (question: string, topicFilter?: string) => {
      setError(null);

      // Add user message
      const userMessage: ChatMessage = {
        id: uuidv4(),
        role: "user",
        content: question,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, userMessage]);
      setIsLoading(true);

      try {
        const response = await queryAI(question, topicFilter);

        const assistantMessage: ChatMessage = {
          id: uuidv4(),
          role: "assistant",
          content: response.answer,
          sources: response.sources,
          timestamp: new Date(),
        };

        setMessages((prev) => [...prev, assistantMessage]);
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "שגיאה בחיבור לשרת";
        setError(errorMessage);

        const errorAssistantMessage: ChatMessage = {
          id: uuidv4(),
          role: "assistant",
          content: "אירעה שגיאה בעיבוד השאלה. אנא ודא שהשרת פעיל ונסה שוב.",
          timestamp: new Date(),
        };

        setMessages((prev) => [...prev, errorAssistantMessage]);
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  const clearChat = useCallback(() => {
    setMessages([]);
    setError(null);
  }, []);

  return {
    messages,
    isLoading,
    error,
    sendMessage,
    clearChat,
  };
}
