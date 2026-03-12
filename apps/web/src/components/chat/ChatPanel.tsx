import { useState, useEffect, useCallback, useRef } from "react";
import type { ChatMessage } from "@gigwatch/shared";
import type { ChatStreamEvent } from "../../api";
import { api } from "../../api";
import { MessageList } from "./MessageList";
import { ChatInput } from "./ChatInput";
import "./ChatPanel.css";

interface Props {
  shrink: boolean;
}

export const ChatPanel = ({ shrink }: Props) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamingId, setStreamingId] = useState<string | null>(null);
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

      const ts = Date.now();
      const userMsg: ChatMessage = {
        id: `user-${ts}`,
        role: "user",
        content: text,
      };
      const assistantId = `assistant-${ts}`;
      const assistantMsg: ChatMessage = {
        id: assistantId,
        role: "assistant",
        content: "",
      };

      // Insert both user message and empty assistant placeholder at once.
      // The assistant bubble stays in the DOM for the entire lifecycle.
      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setStreamingId(assistantId);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        await api.sendChatMessage(
          text,
          (event: ChatStreamEvent) => {
            switch (event.type) {
              case "token":
                if (event.content) {
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === assistantId
                        ? { ...m, content: m.content + event.content }
                        : m
                    )
                  );
                }
                break;
              case "done":
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId
                      ? { ...m, content: event.reply }
                      : m
                  )
                );
                setStreamingId(null);
                break;
              case "error":
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId
                      ? { ...m, content: event.message }
                      : m
                  )
                );
                setStreamingId(null);
                break;
            }
          },
          controller.signal
        );
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, content: "网络错误，请稍后重试。" }
                : m
            )
          );
        }
        setStreamingId(null);
      } finally {
        setIsSending(false);
        abortRef.current = null;
      }
    },
    [isSending]
  );

  return (
    <div className={`chat-panel ${shrink ? "chat-panel--shrink" : ""}`}>
      <MessageList
        messages={messages}
        streamingId={streamingId}
        historyCount={historyCount}
      />
      <ChatInput
        onSend={handleSend}
        disabled={isSending}
        showAbort={isSending}
        onAbort={() => abortRef.current?.abort()}
      />
    </div>
  );
};
