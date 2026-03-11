import { useState } from "react";
import { Sidebar } from "./Sidebar";
import { ChatPanel } from "../chat/ChatPanel";
import { EventsPanel } from "../events/EventsPanel";
import { ConfigDialog } from "../config/ConfigDialog";
import "./AppShell.css";

export const AppShell = () => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [eventsOpen, setEventsOpen] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);

  return (
    <div className="app-shell">
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed((p) => !p)}
        onShowEvents={() => setEventsOpen((p) => !p)}
        eventsOpen={eventsOpen}
        onShowConfig={() => setConfigOpen(true)}
      />
      <main className="app-shell__content">
        <ChatPanel shrink={eventsOpen} />
        <EventsPanel open={eventsOpen} onClose={() => setEventsOpen(false)} />
      </main>
      <ConfigDialog open={configOpen} onClose={() => setConfigOpen(false)} />
    </div>
  );
};
