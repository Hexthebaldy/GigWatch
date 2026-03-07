import { useState, useEffect, useCallback, useRef } from "react";
import type { ChatMessage } from "../../data/mockData";
import type { ChatStreamEvent } from "../../api";
import { api } from "../../api";
import { MessageList } from "./MessageList";
import { ChatInput } from "./ChatInput";
import "./ChatPanel.css";

export const ChatPanel = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamingContent, setStreamingContent] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [historyCount, setHistoryCount] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    api.getChatMessages().then((msgs) => {
      setMessages(msgs);
      setHistoryCount(msgs.length);
    }).catch(console.error);
  }, []);

  const handleSend = useCallback(
    async (text: string) => {
      if (isSending) return;
      setIsSending(true);

      const tempUserMsg: ChatMessage = {
        id: `temp-user-${Date.now()}`,
        role: "user",
        content: text,
      };
      setMessages((prev) => [...prev, tempUserMsg]);
      setStreamingContent("");

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        await api.sendChatMessage(
          text,
          (event: ChatStreamEvent) => {
            switch (event.type) {
              case "token":
                if (event.content) {
                  setStreamingContent((prev) => prev + event.content);
                }
                break;
              case "done":
                setStreamingContent("");
                setMessages((prev) => [
                  ...prev,
                  {
                    id: `assistant-${Date.now()}`,
                    role: "assistant",
                    content: event.reply,
                  },
                ]);
                break;
              case "error":
                setStreamingContent("");
                setMessages((prev) => [
                  ...prev,
                  {
                    id: `error-${Date.now()}`,
                    role: "assistant",
                    content: event.message,
                  },
                ]);
                break;
            }
          },
          controller.signal
        );
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setStreamingContent("");
          setMessages((prev) => [
            ...prev,
            {
              id: `error-${Date.now()}`,
              role: "assistant",
              content: "网络错误，请稍后重试。",
            },
          ]);
        }
      } finally {
        setIsSending(false);
        abortRef.current = null;
      }
    },
    [isSending]
  );

  return (
    <div className="chat-panel">
      <MessageList
        messages={messages}
        streamingContent={streamingContent}
        historyCount={historyCount}
      />
      <ChatInput onSend={handleSend} disabled={isSending} />
    </div>
  );
};
