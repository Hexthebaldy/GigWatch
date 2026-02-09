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

    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      source TEXT NOT NULL,
      external_chat_id TEXT,
      external_user_id TEXT,
      visible INTEGER NOT NULL DEFAULT 1,
      metadata_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_chat_messages_visible_id
    ON chat_messages(visible, id);

    CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at
    ON chat_messages(created_at DESC);

    CREATE TABLE IF NOT EXISTS chat_context_summaries (
      scope TEXT PRIMARY KEY,
      until_message_id INTEGER NOT NULL DEFAULT 0,
      summary_text TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trigger_message_id INTEGER,
      source TEXT NOT NULL,
      status TEXT NOT NULL,
      model TEXT,
      error TEXT,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      metadata_json TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_agent_runs_started_at
    ON agent_runs(started_at DESC);

    CREATE TABLE IF NOT EXISTS agent_run_steps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL,
      step_index INTEGER NOT NULL,
      step_type TEXT NOT NULL,
      tool_name TEXT,
      payload_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_agent_run_steps_run_id
    ON agent_run_steps(run_id, step_index);
  `);
};
