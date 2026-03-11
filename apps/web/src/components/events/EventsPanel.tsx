import { useState, useEffect, useCallback, useRef } from "react";
import type { ShowStartEvent } from "@gigwatch/shared";
import { api } from "../../api";
import { useStore } from "../../store";
import { Close } from "../ui/Icon";
import { Thumb } from "../ui/Thumb";
import "./EventsPanel.css";

type Tab = "recent" | "focus";

interface Props {
  open: boolean;
  onClose: () => void;
}

export const EventsPanel = ({ open, onClose }: Props) => {
  const { monitoring } = useStore();
  const focusArtists = monitoring.focusArtists;
  const [tab, setTab] = useState<Tab>("recent");
  const [events, setEvents] = useState<ShowStartEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasFetched, setHasFetched] = useState(false);

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

  const [settled, setSettled] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) setSettled(false);
  }, [open]);

  useEffect(() => {
    const el = panelRef.current;
    if (!el || !open) return;
    const onEnd = (e: TransitionEvent) => {
      if (e.target === el && e.propertyName === "flex-grow") setSettled(true);
    };
    el.addEventListener("transitionend", onEnd);
    return () => el.removeEventListener("transitionend", onEnd);
  }, [open]);

  const switchTab = (t: Tab) => {
    if (t !== tab) setTab(t);
  };

  return (
    <div ref={panelRef} className={`events-panel ${open ? "events-panel--open" : ""}`}>
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
                  settled
                    ? <Thumb className="event-card__poster" src={ev.poster} size={52} />
                    : <div className="event-card__poster" />
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
