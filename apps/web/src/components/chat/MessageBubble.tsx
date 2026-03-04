import { memo } from "react";
import type { ChatMessage } from "../../data/mockData";
import "./MessageBubble.css";

interface Props {
  message: ChatMessage;
  /** Whether to play entrance animation */
  animate: boolean;
  /** Index within new messages, used for staggered delay */
  animateIndex: number;
  streaming?: boolean;
}

export const MessageBubble = memo(({ message, animate, animateIndex, streaming }: Props) => {
  const isUser = message.role === "user";
  const className = [
    "p5-bubble",
    isUser ? "p5-bubble--user" : "p5-bubble--assistant",
    animate ? "p5-bubble--animate" : "",
  ].join(" ");

  return (
    <div
      className={className}
      style={animate ? { animationDelay: `${animateIndex * 0.08}s` } : undefined}
    >
      {!isUser && <div className="p5-bubble__label">GIGWATCH</div>}
      <div className="p5-bubble__content">
        {message.content.split("\n").map((line, i) => (
          <p key={i}>{line}</p>
        ))}
        {streaming && <span className="p5-bubble__cursor" />}
      </div>
    </div>
  );
});
