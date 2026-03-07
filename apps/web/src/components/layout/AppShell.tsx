import { ChatPanel } from "../chat/ChatPanel";
import "./AppShell.css";

export const AppShell = () => (
  <div className="app-shell">
    <div className="app-shell__page">
      <header className="app-shell__header">
        <span className="app-shell__title">GigWatch</span>
      </header>
      <ChatPanel />
    </div>
  </div>
);
