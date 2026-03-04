import { useEffect, useRef } from "react";
import type { ChatMessage } from "../../data/mockData";
import { MessageBubble } from "./MessageBubble";
import "./MessageList.css";

interface Props {
  messages: ChatMessage[];
  streamingContent: string;
  /** Number of messages loaded from history (no animation for these) */
  historyCount: number;
}

export const MessageList = ({ messages, streamingContent, historyCount }: Props) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const isFirstRender = useRef(true);

  // On first load, jump to bottom instantly; on new messages, smooth-scroll
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      endRef.current?.scrollIntoView();
    } else {
      endRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, streamingContent]);

  return (
    <div className="p5-message-list" ref={containerRef}>
      {messages.map((msg, index) => (
        <MessageBubble
          key={msg.id}
          message={msg}
          animate={index >= historyCount}
          animateIndex={index - historyCount}
        />
      ))}
      {streamingContent && (
        <MessageBubble
          key="streaming"
          message={{
            id: "streaming",
            role: "assistant",
            content: streamingContent,
          }}
          animate={false}
          animateIndex={0}
          streaming
        />
      )}
      <div ref={endRef} />
    </div>
  );
};
