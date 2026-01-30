import type { Database } from "bun:sqlite";

export const initSchema = (db: Database) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER,
      title TEXT NOT NULL,
      city_name TEXT,
      site_name TEXT,
      show_time TEXT,
      price TEXT,
      performers TEXT,
      poster TEXT,
      url TEXT,
      source TEXT,
      raw_json TEXT,
      first_seen_at TEXT,
      last_seen_at TEXT,
      UNIQUE(event_id)
    );

    CREATE TABLE IF NOT EXISTS search_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      query_name TEXT NOT NULL,
      url TEXT NOT NULL,
      city_code TEXT,
      keyword TEXT,
      run_at TEXT NOT NULL,
      results_count INTEGER
    );

    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_at TEXT NOT NULL,
      report_json TEXT NOT NULL
    );
  `);
};
