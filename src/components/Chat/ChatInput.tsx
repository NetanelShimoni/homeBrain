/**
 * Chat input component with send button, @ topic mention support,
 * voice recording, and prompt enhancement.
 */
import React, { useState, useCallback, useRef, useEffect } from "react";
import type { Topic } from "../../types/documents";
import { transcribeAudio, enhancePrompt } from "../../services/api";

interface ChatInputProps {
  onSend: (message: string, topicId?: string) => void;
  disabled: boolean;
  topics: Topic[];
  selectedTopicId?: string;
  onTopicSelect: (topicId: string | undefined) => void;
}

export const ChatInput: React.FC<ChatInputProps> = ({
  onSend,
  disabled,
  topics,
  selectedTopicId,
  onTopicSelect,
}) => {
  const [input, setInput] = useState("");
  const [showMentions, setShowMentions] = useState(false);
  const [mentionFilter, setMentionFilter] = useState("");
  const [mentionIndex, setMentionIndex] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isEnhancing, setIsEnhancing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mentionListRef = useRef<HTMLDivElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const selectedTopic = topics.find((t) => t.id === selectedTopicId);

  const filteredTopics = topics.filter((t) =>
    t.name.includes(mentionFilter)
  );

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed, selectedTopicId);
    setInput("");
  }, [input, disabled, onSend, selectedTopicId]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (showMentions) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setMentionIndex((prev) =>
            prev < filteredTopics.length - 1 ? prev + 1 : 0
          );
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setMentionIndex((prev) =>
            prev > 0 ? prev - 1 : filteredTopics.length - 1
          );
          return;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          if (filteredTopics[mentionIndex]) {
            selectMention(filteredTopics[mentionIndex]);
          }
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setShowMentions(false);
          return;
        }
      }

      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend, showMentions, filteredTopics, mentionIndex]
  );

  const selectMention = (topic: Topic) => {
    // Remove the @... text from the input
    const atIndex = input.lastIndexOf("@");
    const newInput = atIndex >= 0 ? input.slice(0, atIndex).trimEnd() : input;
    setInput(newInput);
    onTopicSelect(topic.id);
    setShowMentions(false);
    setMentionFilter("");
    setMentionIndex(0);
    textareaRef.current?.focus();
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setInput(value);

    // Detect @ mention
    const atIndex = value.lastIndexOf("@");
    if (atIndex >= 0) {
      const textAfterAt = value.slice(atIndex + 1);
      // Only show mentions if there's no space before the next word boundary
      if (!textAfterAt.includes("\n")) {
        setMentionFilter(textAfterAt);
        setShowMentions(true);
        setMentionIndex(0);
        return;
      }
    }
    setShowMentions(false);
  };

  const clearTopicFilter = () => {
    onTopicSelect(undefined);
  };

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = Math.min(textarea.scrollHeight, 120) + "px";
    }
  }, [input]);

  // Scroll mention list to keep active item visible
  useEffect(() => {
    if (showMentions && mentionListRef.current) {
      const active = mentionListRef.current.querySelector(".mention-item.active");
      active?.scrollIntoView({ block: "nearest" });
    }
  }, [mentionIndex, showMentions]);

  // ── Voice recording ──────────────────────────────────────────

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : "audio/webm",
      });
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        // Stop all tracks to release mic
        stream.getTracks().forEach((t) => t.stop());

        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        if (audioBlob.size === 0) return;

        setIsTranscribing(true);
        try {
          const text = await transcribeAudio(audioBlob);
          if (text) {
            setInput((prev) => (prev ? prev + " " + text : text));
          }
        } catch (err) {
          console.error("Transcription failed:", err);
        } finally {
          setIsTranscribing(false);
        }
      };

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start();
      setIsRecording(true);
    } catch (err) {
      console.error("Microphone access denied:", err);
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
  }, []);

  const toggleRecording = useCallback(() => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  }, [isRecording, startRecording, stopRecording]);

  // ── Prompt enhancement ───────────────────────────────────────

  const handleEnhancePrompt = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || isEnhancing) return;

    setIsEnhancing(true);
    try {
      const enhanced = await enhancePrompt(trimmed, selectedTopic?.name);
      if (enhanced) {
        setInput(enhanced);
      }
    } catch (err) {
      console.error("Prompt enhancement failed:", err);
    } finally {
      setIsEnhancing(false);
    }
  }, [input, isEnhancing, selectedTopic]);

  return (
    <div className="chat-input-area">
      {/* Selected topic tag */}
      {selectedTopic && (
        <div className="topic-tag">
          <span className="topic-tag-icon">@</span>
          <span className="topic-tag-name">{selectedTopic.name}</span>
          <button
            className="topic-tag-remove"
            onClick={clearTopicFilter}
            title="הסר סינון נושא"
          >
            ✕
          </button>
        </div>
      )}

      <div className="chat-input-row">
        {/* @ mention dropdown */}
        {showMentions && filteredTopics.length > 0 && (
          <div className="mention-dropdown" ref={mentionListRef}>
            <div className="mention-header">בחר נושא</div>
            {filteredTopics.map((topic, idx) => (
              <div
                key={topic.id}
                className={`mention-item ${idx === mentionIndex ? "active" : ""}`}
                onClick={() => selectMention(topic)}
                onMouseEnter={() => setMentionIndex(idx)}
              >
                <span className="mention-icon">📂</span>
                <span className="mention-name">{topic.name}</span>
                <span className="mention-count">
                  {topic.documentIds.length} מסמכים
                </span>
              </div>
            ))}
          </div>
        )}

        <textarea
          ref={textareaRef}
          className="chat-input"
          value={input}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder={
            isTranscribing
              ? "ממלל הקלטה..."
              : isEnhancing
              ? "משפר שאלה..."
              : selectedTopic
              ? `שאל על "${selectedTopic.name}"...`
              : "שאל שאלה... (הקלד @ לבחירת נושא)"
          }
          disabled={disabled || isTranscribing || isEnhancing}
          rows={1}
          dir="rtl"
        />

        <div className="chat-input-buttons">
          <button
            className={`input-action-btn btn-record ${isRecording ? "recording" : ""}`}
            onClick={toggleRecording}
            disabled={disabled || isTranscribing || isEnhancing}
            title={isRecording ? "עצור הקלטה" : "הקלט הודעה קולית"}
          >
            {isTranscribing ? "⏳" : isRecording ? "⏹️" : "🎤"}
          </button>

          <button
            className={`input-action-btn btn-enhance ${isEnhancing ? "enhancing" : ""}`}
            onClick={handleEnhancePrompt}
            disabled={disabled || !input.trim() || isEnhancing || isTranscribing}
            title="שפר שאלה בעזרת AI"
          >
            {isEnhancing ? "⏳" : "✨"}
          </button>

          <button
            className="send-button"
            onClick={handleSend}
            disabled={disabled || !input.trim() || isTranscribing || isEnhancing}
            title="שלח"
          >
            ➤
          </button>
        </div>
      </div>
    </div>
  );
};
