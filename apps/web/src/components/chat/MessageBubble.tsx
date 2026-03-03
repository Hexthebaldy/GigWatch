import type { ChatMessage } from "../../data/mockData";
import "./MessageBubble.css";

interface Props {
  message: ChatMessage;
  index: number;
}

export const MessageBubble = ({ message, index }: Props) => {
  const isUser = message.role === "user";

  return (
    <div
      className={`p5-bubble ${isUser ? "p5-bubble--user" : "p5-bubble--assistant"}`}
      style={{ animationDelay: `${index * 0.12}s` }}
    >
      {!isUser && <div className="p5-bubble__label">GIGWATCH</div>}
      <div className="p5-bubble__content">
        {message.content.split("\n").map((line, i) => (
          <p key={i}>{line}</p>
        ))}
      </div>
    </div>
  );
};
