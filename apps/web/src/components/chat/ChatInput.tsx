import { useState, useRef, useEffect } from "react";
import "./ChatInput.css";

interface Props {
  onSend: (text: string) => void;
  disabled?: boolean;
  /** When true, show an abort button to stop the current LLM stream */
  showAbort?: boolean;
  onAbort?: () => void;
}

export const ChatInput = ({ onSend, disabled, showAbort, onAbort }: Props) => {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const submit = () => {
    const text = value.trim();
    if (!text || disabled) return;
    setValue("");
    onSend(text);
  };

  // Auto-resize textarea height
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  }, [value]);

  return (
    <div className="chat-input">
      <textarea
        ref={textareaRef}
        className="chat-input__field"
        rows={1}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
      />
      {showAbort && onAbort ? (
        <button
          type="button"
          className="chat-input__send"
          onClick={onAbort}
          aria-label="终止"
        >
          <svg width="18" height="18" viewBox="0 0 1024 1024" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
            <path d="M512 1024a512 512 0 1 1 512-512 512 512 0 0 1-512 512z m0-896a384 384 0 1 0 384 384A384 384 0 0 0 512 128z m128 576h-256a64 64 0 0 1-64-64v-256a64 64 0 0 1 64-64h256a64 64 0 0 1 64 64v256a64 64 0 0 1-64 64z" />
          </svg>
        </button>
      ) : (
        <button
          className="chat-input__send"
          onClick={submit}
          disabled={disabled}
          aria-label="发送"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      )}
    </div>
  );
};
