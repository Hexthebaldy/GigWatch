import { useEffect, useMemo, useState } from "react";
import type { DailyReport, MonitoringPayload, SearchLogRecord } from "@gigwatch/shared";
import { api } from "./api";

const parseCsv = (value: string) =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const joinCsv = (items?: string[]) => (items && items.length > 0 ? items.join(", ") : "");

const initialPayload: MonitoringPayload = {
  focusArtists: [],
  cityCodes: [],
  showStyles: [],
  keywords: []
};

export const App = () => {
  const [report, setReport] = useState<DailyReport | null>(null);
  const [logs, setLogs] = useState<SearchLogRecord[]>([]);
  const [form, setForm] = useState<MonitoringPayload>(initialPayload);
  const [isRunning, setIsRunning] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [status, setStatus] = useState("Ready");
  const [error, setError] = useState<string | null>(null);

  const formFields = useMemo(
    () => ({
      focusArtists: joinCsv(form.focusArtists),
      cityCodes: joinCsv(form.cityCodes),
      showStyles: joinCsv(form.showStyles),
      keywords: joinCsv(form.keywords)
    }),
    [form]
  );

  const loadDashboard = async () => {
    setError(null);
    const [latestReport, latestLogs] = await Promise.all([api.getLatestReport(), api.getLogs()]);
    setReport(latestReport);
    setLogs(latestLogs);
  };

  const loadConfig = async () => {
    const cfg = await api.getConfig();
    setForm({
      focusArtists: cfg.monitoring.focusArtists || [],
      cityCodes: cfg.monitoring.cityCodes || [],
      showStyles: cfg.monitoring.showStyles || [],
      keywords: cfg.monitoring.keywords || []
    });
  };

  useEffect(() => {
    void (async () => {
      try {
        setStatus("Loading data...");
        await Promise.all([loadDashboard(), loadConfig()]);
        setStatus("Data loaded");
      } catch (err) {
        setError(String(err));
        setStatus("Load failed");
      }
    })();
  }, []);

  const runNow = async () => {
    try {
      setIsRunning(true);
      setStatus("Running monitor job...");
      const nextReport = await api.runNow();
      setReport(nextReport);
      setLogs(await api.getLogs());
      setStatus("Run completed");
      setError(null);
    } catch (err) {
      setError(String(err));
      setStatus("Run failed");
    } finally {
      setIsRunning(false);
    }
  };

  const saveConfig = async () => {
    try {
      setIsSaving(true);
      setStatus("Saving config...");
      await api.saveMonitoring(form);
      setStatus("Config saved");
      setError(null);
    } catch (err) {
      setError(String(err));
      setStatus("Save failed");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <main className="layout">
      <header className="hero">
        <p className="eyebrow">GigWatch Console</p>
        <h1>ShowStart Monitoring</h1>
        <p className="muted">Monorepo React frontend. API comes from Bun server.</p>
        <p className="status">{status}</p>
        {error ? <p className="error">{error}</p> : null}
      </header>

      <section className="grid">
        <article className="panel">
          <h2>Run Monitoring</h2>
          <button className="action" disabled={isRunning} onClick={runNow}>
            {isRunning ? "Running..." : "Run Now"}
          </button>
          {report ? (
            <div className="report">
              <p>
                <strong>Run At:</strong> {report.runAt} ({report.timezone})
              </p>
              <p>
                <strong>Summary:</strong> {report.summary}
              </p>
              <p>
                <strong>Events:</strong> {report.events.length}
              </p>
            </div>
          ) : (
            <p className="muted">No report yet.</p>
          )}
        </article>

        <article className="panel">
          <h2>Monitoring Config</h2>
          <label>
            Focus Artists
            <textarea
              value={formFields.focusArtists}
              onChange={(e) => setForm({ ...form, focusArtists: parseCsv(e.target.value) })}
              placeholder="五月天, 周杰伦"
            />
          </label>
          <label>
            City Codes
            <textarea
              value={formFields.cityCodes}
              onChange={(e) => setForm({ ...form, cityCodes: parseCsv(e.target.value) })}
              placeholder="21, 10"
            />
          </label>
          <label>
            Show Styles
            <textarea
              value={formFields.showStyles}
              onChange={(e) => setForm({ ...form, showStyles: parseCsv(e.target.value) })}
              placeholder="2, 3"
            />
          </label>
          <label>
            Keywords
            <textarea
              value={formFields.keywords}
              onChange={(e) => setForm({ ...form, keywords: parseCsv(e.target.value) })}
              placeholder="音乐节, 巡演"
            />
          </label>
          <button className="action" disabled={isSaving} onClick={saveConfig}>
            {isSaving ? "Saving..." : "Save Config"}
          </button>
        </article>
      </section>

      <section className="panel">
        <h2>Recent Search Logs</h2>
        {logs.length === 0 ? (
          <p className="muted">No logs yet.</p>
        ) : (
          <ul className="logs">
            {logs.map((log) => (
              <li key={`${log.query_name}-${log.run_at}-${log.url}`}>
                <code>{log.query_name}</code>
                <span>{log.keyword || "-"}</span>
                <span>{log.city_code || "-"}</span>
                <span>{log.results_count ?? 0}</span>
                <time>{log.run_at}</time>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
};
