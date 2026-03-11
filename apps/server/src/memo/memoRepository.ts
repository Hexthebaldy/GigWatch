import type { Database } from "bun:sqlite";
import { toIso } from "../utils/datetime";

export type StoredMemo = {
  id: number;
  content: string;
  createdAt: string;
  updatedAt: string;
};

type MemoRow = {
  id: number;
  content: string;
  created_at: string;
  updated_at: string;
};

const toStoredMemo = (row: MemoRow): StoredMemo => ({
  id: row.id,
  content: row.content,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

export class MemoRepository {
  constructor(private db: Database) {}

  listAll(): StoredMemo[] {
    const stmt = this.db.prepare(`
      SELECT id, content, created_at, updated_at
      FROM memos
      ORDER BY id DESC
    `);
    const rows = stmt.all() as MemoRow[];
    return rows.map(toStoredMemo);
  }

  add(content: string): { memo: StoredMemo; created: boolean } {
    const normalized = content.trim();
    if (!normalized) {
      throw new Error("Memo content cannot be empty");
    }

    const existing = this.findByContent(normalized);
    if (existing) {
      return { memo: existing, created: false };
    }

    const now = toIso(new Date());
    const stmt = this.db.prepare(`
      INSERT INTO memos (content, created_at, updated_at)
      VALUES (?, ?, ?)
    `);
    const result = stmt.run(normalized, now, now);
    const memo = this.findById(Number(result.lastInsertRowid));
    if (!memo) {
      throw new Error("Memo inserted but could not be reloaded");
    }
    return { memo, created: true };
  }

  remove(content: string): { memo?: StoredMemo; removed: boolean } {
    const normalized = content.trim();
    if (!normalized) {
      throw new Error("Memo content cannot be empty");
    }

    const existing = this.findByContent(normalized);
    if (!existing) {
      return { removed: false };
    }

    const stmt = this.db.prepare("DELETE FROM memos WHERE id = ?");
    stmt.run(existing.id);
    return { memo: existing, removed: true };
  }

  private findById(id: number): StoredMemo | undefined {
    const stmt = this.db.prepare(`
      SELECT id, content, created_at, updated_at
      FROM memos
      WHERE id = ?
      LIMIT 1
    `);
    const row = stmt.get(id) as MemoRow | undefined;
    return row ? toStoredMemo(row) : undefined;
  }

  private findByContent(content: string): StoredMemo | undefined {
    const stmt = this.db.prepare(`
      SELECT id, content, created_at, updated_at
      FROM memos
      WHERE content = ?
      LIMIT 1
    `);
    const row = stmt.get(content) as MemoRow | undefined;
    return row ? toStoredMemo(row) : undefined;
  }
}
