import { MessageList } from "./MessageList";
import { ChatInput } from "./ChatInput";
import "./ChatPanel.css";

export const ChatPanel = () => (
  <main className="p5-chat-panel">
    <MessageList />
    <ChatInput />
  </main>
);
