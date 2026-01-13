import type { Database } from "bun:sqlite";

export const initSchema = (db: Database) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      external_id TEXT,
      name TEXT,
      city_name TEXT,
      venue_name TEXT,
      show_time TEXT,
      perform_start_time TEXT,
      category_name TEXT,
      sub_category_name TEXT,
      artist_name TEXT,
      actors TEXT,
      tours TEXT,
      price_str TEXT,
      promotion_price TEXT,
      site_status TEXT,
      buy_url TEXT,
      source TEXT,
      raw_json TEXT,
      first_seen_at TEXT,
      last_seen_at TEXT,
      UNIQUE(name, venue_name, show_time, city_name, perform_start_time)
    );

    CREATE TABLE IF NOT EXISTS artist_news (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      artist TEXT NOT NULL,
      title TEXT,
      url TEXT,
      date TEXT,
      content TEXT,
      source TEXT,
      fetched_at TEXT
    );

    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_at TEXT NOT NULL,
      report_text TEXT NOT NULL,
      report_json TEXT NOT NULL
    );
  `);
};
