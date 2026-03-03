import { mockMenuItems } from "../../data/mockData";
import "./FunctionMenu.css";

export const FunctionMenu = () => (
  <nav className="p5-menu">
    <h2 className="p5-menu__title">MENU</h2>
    <ul className="p5-menu__list">
      {mockMenuItems.map((item, index) => (
        <li
          key={item.id}
          className={`p5-menu__item ${item.id === "chat" ? "p5-menu__item--active" : ""}`}
          style={{ animationDelay: `${0.1 + index * 0.08}s` }}
        >
          <span className="p5-menu__icon">{item.icon}</span>
          <span className="p5-menu__label">{item.label}</span>
          {item.badge != null && (
            <span className="p5-menu__badge">{item.badge}</span>
          )}
        </li>
      ))}
    </ul>
  </nav>
);
