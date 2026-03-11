import { LayoutSidebar, Calendar, Bell } from "../ui/Icon";
import "./Sidebar.css";

interface Props {
  collapsed: boolean;
  onToggle: () => void;
  onShowEvents: () => void;
  eventsOpen: boolean;
  onShowConfig: () => void;
}

export const Sidebar = ({ collapsed, onToggle, onShowEvents, eventsOpen, onShowConfig }: Props) => (
  <aside className={`sidebar ${collapsed ? "sidebar--collapsed" : ""}`}>
    <button className="sidebar__toggle" onClick={onToggle}>
      <span className="sidebar__brand">GIG WATCH</span>
      <LayoutSidebar size={18} className="sidebar__toggle-icon" />
    </button>

    {!collapsed && (
      <nav className="sidebar__nav">
        <button
          className={`sidebar__item ${eventsOpen ? "sidebar__item--active" : ""}`}
          onClick={onShowEvents}
        >
          <Calendar />
          <span>演出</span>
        </button>
        <button className="sidebar__item" onClick={onShowConfig}>
          <Bell />
          <span>订阅</span>
        </button>
      </nav>
    )}
  </aside>
);
