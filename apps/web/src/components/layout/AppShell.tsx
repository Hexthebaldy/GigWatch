import { Header } from "./Header";
import { Sidebar } from "./Sidebar";
import { ChatPanel } from "../chat/ChatPanel";
import "./AppShell.css";

export const AppShell = () => (
  <div className="app-shell">
    <Header />
    <Sidebar />
    <ChatPanel />
  </div>
);
