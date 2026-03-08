import { useState, useEffect, useCallback } from "react";
import type { ShowStartEvent } from "@gigwatch/shared";
import { api } from "../../api";
import { Close } from "../ui/Icon";
import "./EventsPanel.css";

type Tab = "recent" | "focus";

interface Props {
  open: boolean;
  onClose: () => void;
}

export const EventsPanel = ({ open, onClose }: Props) => {
  const [tab, setTab] = useState<Tab>("recent");
  const [events, setEvents] = useState<ShowStartEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [focusArtists, setFocusArtists] = useState<string[]>([]);
  const [hasFetched, setHasFetched] = useState(false);

  // Load focusArtists from config once
  useEffect(() => {
    api.getConfig()
      .then((cfg) => setFocusArtists(cfg.monitoring.focusArtists || []))
      .catch(console.error);
  }, []);

  const fetchEvents = useCallback(async (t: Tab) => {
    setLoading(true);
    try {
      if (t === "recent") {
        const data = await api.queryEvents({ limit: 10 });
        setEvents(data);
      } else {
        const data = await api.queryEvents({ artists: focusArtists, limit: 100 });
        setEvents(data);
      }
    } catch (err) {
      console.error(err);
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [focusArtists]);

  // Fetch on first open, and when tab changes while open
  useEffect(() => {
    if (open) {
      setHasFetched(true);
      fetchEvents(tab);
    }
  }, [open, tab, fetchEvents]);

  const switchTab = (t: Tab) => {
    if (t !== tab) setTab(t);
  };

  return (
    <div className={`events-panel ${open ? "events-panel--open" : ""}`}>
      <div className="events-panel__inner">
        <div className="events-panel__header">
          <div className="events-panel__tabs">
            <button
              className={`events-panel__tab ${tab === "recent" ? "events-panel__tab--active" : ""}`}
              onClick={() => switchTab("recent")}
            >
              最近演出
            </button>
            <button
              className={`events-panel__tab ${tab === "focus" ? "events-panel__tab--active" : ""}`}
              onClick={() => switchTab("focus")}
            >
              关注艺人
            </button>
          </div>
          <button className="events-panel__close" onClick={onClose} aria-label="关闭">
            <Close />
          </button>
        </div>

        <div className="events-panel__list">
          {!hasFetched || loading ? (
            <div className="events-panel__empty">{hasFetched ? "搜索中..." : ""}</div>
          ) : events.length === 0 ? (
            <div className="events-panel__empty">
              {tab === "focus" && focusArtists.length === 0
                ? "尚未配置关注艺人"
                : "暂无演出数据"}
            </div>
          ) : (
            events.map((ev) => (
              <a
                key={ev.id}
                className="event-card"
                href={ev.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                {ev.poster && (
                  <img className="event-card__poster" src={ev.poster} alt="" loading="lazy" />
                )}
                <div className="event-card__body">
                  <div className="event-card__title">{ev.title}</div>
                  <div className="event-card__meta">
                    {ev.cityName && <span>{ev.cityName}</span>}
                    {ev.siteName && <span>{ev.siteName}</span>}
                  </div>
                  {ev.showTime && (
                    <div className="event-card__time">{ev.showTime}</div>
                  )}
                  <div className="event-card__footer">
                    {ev.price && <span className="event-card__price">{ev.price}</span>}
                    {ev.performers && (
                      <span className="event-card__performers">{ev.performers}</span>
                    )}
                    {ev.soldOut === 1 && <span className="event-card__tag event-card__tag--soldout">已售罄</span>}
                  </div>
                </div>
              </a>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
