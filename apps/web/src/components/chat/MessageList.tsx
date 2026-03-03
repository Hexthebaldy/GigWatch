import { mockMessages } from "../../data/mockData";
import { MessageBubble } from "./MessageBubble";
import "./MessageList.css";

export const MessageList = () => (
  <div className="p5-message-list">
    {mockMessages.map((msg, index) => (
      <MessageBubble key={msg.id} message={msg} index={index} />
    ))}
  </div>
);
