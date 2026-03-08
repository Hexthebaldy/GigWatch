import { memo } from "react";
import Markdown from "markdown-to-jsx";
import type { ChatMessage } from "../../data/mockData";
import "./MessageBubble.css";

interface Props {
  message: ChatMessage;
  animate: boolean;
  animateIndex: number;
  streaming?: boolean;
}

export const MessageBubble = memo(({ message, animate, animateIndex, streaming }: Props) => {
  const isUser = message.role === "user";
  const cls = [
    "bubble",
    isUser ? "bubble--user" : "bubble--assistant",
    animate ? "bubble--animate" : "",
  ].join(" ");

  return (
    <div
      className={cls}
      style={animate ? { animationDelay: `${animateIndex * 0.06}s` } : undefined}
    >
      {isUser ? (
        <div className="bubble__content">{message.content}</div>
      ) : (
        <div className="bubble__content bubble__markdown">
          <Markdown>{message.content}</Markdown>
          {streaming && <span className="bubble__cursor" />}
        </div>
      )}
    </div>
  );
});
