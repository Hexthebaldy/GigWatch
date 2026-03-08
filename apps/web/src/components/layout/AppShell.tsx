import { useState } from "react";
import { Sidebar } from "./Sidebar";
import { ChatCard } from "../chat/ChatCard";
import { EventsPanel } from "../events/EventsPanel";
import "./AppShell.css";

export const AppShell = () => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [eventsOpen, setEventsOpen] = useState(false);

  return (
    <div className="app-shell">
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed((p) => !p)}
        onShowEvents={() => setEventsOpen((p) => !p)}
        eventsOpen={eventsOpen}
      />
      <main className="app-shell__content">
        <ChatCard shrink={eventsOpen} />
        <EventsPanel open={eventsOpen} onClose={() => setEventsOpen(false)} />
      </main>
    </div>
  );
};
