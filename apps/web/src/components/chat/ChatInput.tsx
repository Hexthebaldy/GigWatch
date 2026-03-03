import { useState } from "react";
import "./ChatInput.css";

export const ChatInput = () => {
  const [value, setValue] = useState("");

  return (
    <div className="p5-chat-input">
      <input
        className="p5-chat-input__field"
        type="text"
        placeholder="输入消息..."
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && value.trim()) {
            setValue("");
          }
        }}
      />
      <button
        className="p5-chat-input__send"
        onClick={() => {
          if (value.trim()) setValue("");
        }}
      >
        SEND
      </button>
    </div>
  );
};
