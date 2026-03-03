import { FunctionMenu } from "../sidebar/FunctionMenu";
import { WatchedShows } from "../sidebar/WatchedShows";
import "./Sidebar.css";

export const Sidebar = () => (
  <aside className="p5-sidebar">
    <FunctionMenu />
    <WatchedShows />
  </aside>
);
