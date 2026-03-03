import { mockWatchedShows } from "../../data/mockData";
import type { WatchedShow } from "../../data/mockData";
import "./WatchedShows.css";

const statusLabels: Record<WatchedShow["status"], string> = {
  upcoming: "即将开演",
  on_sale: "售票中",
  sold_out: "已售罄",
};

export const WatchedShows = () => (
  <section className="p5-watched">
    <h2 className="p5-watched__title">WATCHED</h2>
    <div className="p5-watched__list">
      {mockWatchedShows.map((show, index) => (
        <article
          key={show.id}
          className="p5-watched__card"
          style={{ animationDelay: `${0.3 + index * 0.1}s` }}
        >
          <div className="p5-watched__header">
            <span className="p5-watched__name">{show.title}</span>
            <span className={`p5-watched__status p5-watched__status--${show.status}`}>
              {statusLabels[show.status]}
            </span>
          </div>
          <div className="p5-watched__meta">
            <span>{show.artist}</span>
            <span>{show.date}</span>
          </div>
          <div className="p5-watched__venue">{show.venue}</div>
        </article>
      ))}
    </div>
  </section>
);
