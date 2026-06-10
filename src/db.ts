import Database from "better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type VideoRecord = {
  id: number;
  title: string;
  description: string;
  thumbnail: string;
  pageUrl: string;
  sourceUrl: string;
  sourceType: string;
  duration: number | null;
  createdAt: string;
  updatedAt: string;
};

export type VideoInput = {
  title: string;
  description: string;
  thumbnail: string;
  pageUrl: string;
  sourceUrl: string;
  sourceType: string;
  duration?: number | null;
};

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const db = new Database(path.join(root, "site-source-inspector.db"));

db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS videos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    thumbnail TEXT NOT NULL DEFAULT '',
    page_url TEXT NOT NULL,
    source_url TEXT NOT NULL,
    source_type TEXT NOT NULL DEFAULT 'hls',
    duration REAL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

const rowToVideo = (row: Record<string, unknown>): VideoRecord => ({
  id: Number(row.id),
  title: String(row.title ?? ""),
  description: String(row.description ?? ""),
  thumbnail: String(row.thumbnail ?? ""),
  pageUrl: String(row.page_url ?? ""),
  sourceUrl: String(row.source_url ?? ""),
  sourceType: String(row.source_type ?? "hls"),
  duration: row.duration === null || row.duration === undefined ? null : Number(row.duration),
  createdAt: String(row.created_at ?? ""),
  updatedAt: String(row.updated_at ?? "")
});

export function listVideos(): VideoRecord[] {
  const rows = db.prepare("SELECT * FROM videos ORDER BY created_at DESC, id DESC").all() as Record<string, unknown>[];
  return rows.map(rowToVideo);
}

export function getVideo(id: number): VideoRecord | undefined {
  const row = db.prepare("SELECT * FROM videos WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return row ? rowToVideo(row) : undefined;
}

export function createVideo(input: VideoInput): VideoRecord {
  const result = db
    .prepare(
      `
      INSERT INTO videos (title, description, thumbnail, page_url, source_url, source_type, duration)
      VALUES (@title, @description, @thumbnail, @pageUrl, @sourceUrl, @sourceType, @duration)
      `
    )
    .run({
      title: input.title.trim(),
      description: input.description.trim(),
      thumbnail: input.thumbnail.trim(),
      pageUrl: input.pageUrl.trim(),
      sourceUrl: input.sourceUrl.trim(),
      sourceType: input.sourceType.trim() || "hls",
      duration: input.duration ?? null
    });

  const video = getVideo(Number(result.lastInsertRowid));
  if (!video) throw new Error("Video was not saved");
  return video;
}
