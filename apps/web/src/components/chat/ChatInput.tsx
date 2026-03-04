import { useState } from "react";
import "./ChatInput.css";

interface Props {
  onSend: (text: string) => void;
  disabled?: boolean;
}

export const ChatInput = ({ onSend, disabled }: Props) => {
  const [value, setValue] = useState("");

  const submit = () => {
    const text = value.trim();
    if (!text || disabled) return;
    setValue("");
    onSend(text);
  };

  return (
    <div className="p5-chat-input">
      <input
        className="p5-chat-input__field"
        type="text"
        placeholder="输入消息..."
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
        }}
        disabled={disabled}
      />
      <button
        className="p5-chat-input__send"
        onClick={submit}
        disabled={disabled}
      >
        SEND
      </button>
    </div>
  );
};
