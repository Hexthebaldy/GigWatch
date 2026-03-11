import { useEffect, useRef } from "react";
import type { ChatMessage } from "@gigwatch/shared";
import { MessageBubble } from "./MessageBubble";
import "./MessageList.css";

interface Props {
  messages: ChatMessage[];
  streamingId: string | null;
  historyCount: number;
}

export const MessageList = ({ messages, streamingId, historyCount }: Props) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      endRef.current?.scrollIntoView();
    } else {
      endRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  return (
    <div className="message-list" ref={containerRef}>
      {messages.map((msg, index) => (
        <MessageBubble
          key={msg.id}
          message={msg}
          animate={index >= historyCount}
          animateIndex={index - historyCount}
          streaming={msg.id === streamingId}
        />
      ))}
      <div ref={endRef} />
    </div>
  );
};
