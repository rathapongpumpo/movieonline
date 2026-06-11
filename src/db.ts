import Database from "better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type VideoRecord = {
  id: number;
  title: string;
  description: string;
  thumbnail: string;
  category: string;
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
  category: string;
  pageUrl: string;
  sourceUrl: string;
  sourceType: string;
  duration?: number | null;
};

export type VideoQuery = {
  page?: number;
  pageSize?: number;
  search?: string;
  category?: string;
};

export type CategorySummary = {
  name: string;
  count: number;
};

export type VideoPage = {
  videos: VideoRecord[];
  total: number;
  page: number;
  pageSize: number;
  categories: CategorySummary[];
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
    category TEXT NOT NULL DEFAULT 'Uncategorized',
    page_url TEXT NOT NULL,
    source_url TEXT NOT NULL,
    source_type TEXT NOT NULL DEFAULT 'hls',
    duration REAL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

const columns = db.prepare("PRAGMA table_info(videos)").all() as Array<{ name: string }>;
if (!columns.some((column) => column.name === "category")) {
  db.exec("ALTER TABLE videos ADD COLUMN category TEXT NOT NULL DEFAULT 'Uncategorized'");
}

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_videos_created_at ON videos (created_at DESC, id DESC);
  CREATE INDEX IF NOT EXISTS idx_videos_category ON videos (category);
  CREATE INDEX IF NOT EXISTS idx_videos_title ON videos (title);
`);

const rowToVideo = (row: Record<string, unknown>): VideoRecord => ({
  id: Number(row.id),
  title: String(row.title ?? ""),
  description: String(row.description ?? ""),
  thumbnail: String(row.thumbnail ?? ""),
  category: String(row.category ?? "Uncategorized"),
  pageUrl: String(row.page_url ?? ""),
  sourceUrl: String(row.source_url ?? ""),
  sourceType: String(row.source_type ?? "hls"),
  duration: row.duration === null || row.duration === undefined ? null : Number(row.duration),
  createdAt: String(row.created_at ?? ""),
  updatedAt: String(row.updated_at ?? "")
});

export function listVideos(query: VideoQuery = {}): VideoPage {
  const page = clampInteger(query.page ?? 1, 1, 100000);
  const pageSize = clampInteger(query.pageSize ?? 24, 1, 100);
  const params: Record<string, unknown> = {
    limit: pageSize,
    offset: (page - 1) * pageSize
  };
  const where: string[] = [];

  const search = String(query.search ?? "").trim();
  if (search) {
    params.search = `%${escapeLike(search)}%`;
    where.push("(title LIKE @search ESCAPE '\\' OR description LIKE @search ESCAPE '\\' OR page_url LIKE @search ESCAPE '\\')");
  }

  const category = String(query.category ?? "").trim();
  if (category && category !== "All") {
    params.category = category;
    where.push("category = @category");
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const rows = db
    .prepare(`SELECT * FROM videos ${whereSql} ORDER BY created_at DESC, id DESC LIMIT @limit OFFSET @offset`)
    .all(params) as Record<string, unknown>[];
  const totalRow = db.prepare(`SELECT COUNT(*) AS total FROM videos ${whereSql}`).get(params) as { total: number };

  return {
    videos: rows.map(rowToVideo),
    total: Number(totalRow.total ?? 0),
    page,
    pageSize,
    categories: listCategories()
  };
}

export function getVideo(id: number): VideoRecord | undefined {
  const row = db.prepare("SELECT * FROM videos WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return row ? rowToVideo(row) : undefined;
}

export function createVideo(input: VideoInput): VideoRecord {
  const result = db
    .prepare(
      `
      INSERT INTO videos (title, description, thumbnail, category, page_url, source_url, source_type, duration)
      VALUES (@title, @description, @thumbnail, @category, @pageUrl, @sourceUrl, @sourceType, @duration)
      `
    )
    .run({
      title: input.title.trim(),
      description: input.description.trim(),
      thumbnail: input.thumbnail.trim(),
      category: normalizeCategory(input.category),
      pageUrl: input.pageUrl.trim(),
      sourceUrl: input.sourceUrl.trim(),
      sourceType: input.sourceType.trim() || "hls",
      duration: input.duration ?? null
    });

  const video = getVideo(Number(result.lastInsertRowid));
  if (!video) throw new Error("Video was not saved");
  return video;
}

export function updateVideo(id: number, input: VideoInput): VideoRecord {
  const result = db
    .prepare(
      `
      UPDATE videos
      SET title = @title,
          description = @description,
          thumbnail = @thumbnail,
          category = @category,
          page_url = @pageUrl,
          source_url = @sourceUrl,
          source_type = @sourceType,
          duration = @duration,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = @id
      `
    )
    .run({
      id,
      title: input.title.trim(),
      description: input.description.trim(),
      thumbnail: input.thumbnail.trim(),
      category: normalizeCategory(input.category),
      pageUrl: input.pageUrl.trim(),
      sourceUrl: input.sourceUrl.trim(),
      sourceType: input.sourceType.trim() || "hls",
      duration: input.duration ?? null
    });

  if (result.changes === 0) throw new Error("Video not found");
  const video = getVideo(id);
  if (!video) throw new Error("Video not found");
  return video;
}

export function deleteVideo(id: number): boolean {
  const result = db.prepare("DELETE FROM videos WHERE id = ?").run(id);
  return result.changes > 0;
}

export function listCategories(): CategorySummary[] {
  const rows = db
    .prepare(
      `
      SELECT category AS name, COUNT(*) AS count
      FROM videos
      GROUP BY category
      ORDER BY category COLLATE NOCASE ASC
      `
    )
    .all() as Array<{ name: string; count: number }>;
  return rows.map((row) => ({
    name: String(row.name || "Uncategorized"),
    count: Number(row.count ?? 0)
  }));
}

function normalizeCategory(value: string): string {
  const category = value.trim();
  return category || "Uncategorized";
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(Math.trunc(value), min), max);
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}
