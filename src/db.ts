import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

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

export type SeriesRecord = {
  id: number;
  title: string;
  description: string;
  poster: string;
  category: string;
  status: string;
  pageUrl: string;
  createdAt: string;
  updatedAt: string;
  episodes: EpisodeRecord[];
};

export type SeriesInput = {
  title: string;
  description: string;
  poster: string;
  category: string;
  status: string;
  pageUrl: string;
};

export type EpisodeRecord = {
  id: number;
  seriesId: number;
  episodeNumber: number;
  title: string;
  description: string;
  thumbnail: string;
  pageUrl: string;
  sourceUrl: string;
  sourceType: string;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export type EpisodeInput = {
  episodeNumber: number;
  title: string;
  description: string;
  thumbnail: string;
  pageUrl: string;
  sourceUrl: string;
  sourceType: string;
  status: string;
};

export type VideoPage = {
  videos: VideoRecord[];
  total: number;
  page: number;
  pageSize: number;
  categories: CategorySummary[];
};

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

let Database: any = null;
let db: any = null;
let useJsonFallback = false;
let fallbackVideos: VideoRecord[] = [];
let fallbackSeries: SeriesRecord[] = [];

// Try loading better-sqlite3 dynamically
try {
  const betterSqlite3 = await import("better-sqlite3");
  Database = betterSqlite3.default;
} catch (err) {
  console.warn("better-sqlite3 failed to load, falling back to JSON storage mode:", err);
  useJsonFallback = true;
}

if (!useJsonFallback && Database) {
  try {
    let dbPath = path.join(root, "site-source-inspector.db");

    if (process.env.VERCEL) {
      const tmpPath = path.join("/tmp", "site-source-inspector.db");
      if (!fs.existsSync(tmpPath) && fs.existsSync(dbPath)) {
        fs.copyFileSync(dbPath, tmpPath);
        const walPath = `${dbPath}-wal`;
        const tmpWalPath = `${tmpPath}-wal`;
        if (fs.existsSync(walPath)) {
          fs.copyFileSync(walPath, tmpWalPath);
        }
        const shmPath = `${dbPath}-shm`;
        const tmpShmPath = `${tmpPath}-shm`;
        if (fs.existsSync(shmPath)) {
          fs.copyFileSync(shmPath, tmpShmPath);
        }
      }
      dbPath = tmpPath;
    }

    db = new Database(dbPath);
    
    // Switch SQLite to DELETE journal mode so that writes are instantly committed to the .db file
    // rather than remaining stuck in .db-wal / .db-shm files (which are gitignored)
    db.pragma("journal_mode = DELETE");

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

    db.exec(`
      CREATE TABLE IF NOT EXISTS series (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        poster TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL DEFAULT 'ยังไม่จัดหมวด',
        status TEXT NOT NULL DEFAULT 'draft',
        page_url TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS episodes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        series_id INTEGER NOT NULL,
        episode_number INTEGER NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        thumbnail TEXT NOT NULL DEFAULT '',
        page_url TEXT NOT NULL DEFAULT '',
        source_url TEXT NOT NULL DEFAULT '',
        source_type TEXT NOT NULL DEFAULT 'hls',
        status TEXT NOT NULL DEFAULT 'draft',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (series_id) REFERENCES series(id) ON DELETE CASCADE
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
      CREATE INDEX IF NOT EXISTS idx_series_updated_at ON series (updated_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS idx_series_category ON series (category);
      CREATE INDEX IF NOT EXISTS idx_episodes_series_order ON episodes (series_id, episode_number ASC, id ASC);
    `);
  } catch (err) {
    console.error("SQLite initialization failed, using JSON fallback:", err);
    useJsonFallback = true;
  }
}

if (useJsonFallback) {
  loadJsonFallbackData();
}

function loadJsonFallbackData() {
  const findJsonFile = (filename: string): string | null => {
    const candidatePaths = [
      path.join(root, "client", "public", "data", filename),
      path.join(root, "dist", "data", filename),
      path.join(root, "data", filename),
      path.join("/tmp", filename)
    ];
    for (const p of candidatePaths) {
      if (fs.existsSync(p)) {
        return p;
      }
    }
    return null;
  };

  const videosPath = findJsonFile("videos.json");
  const seriesPath = findJsonFile("series.json");

  if (videosPath) {
    try {
      const data = JSON.parse(fs.readFileSync(videosPath, "utf8"));
      fallbackVideos = data.videos || [];
      console.log(`[JSON Fallback] Loaded ${fallbackVideos.length} videos from ${videosPath}`);
    } catch (e) {
      console.error(`[JSON Fallback] Failed to parse videos JSON:`, e);
    }
  } else {
    console.error("[JSON Fallback] videos.json not found in any candidate paths.");
  }

  if (seriesPath) {
    try {
      const data = JSON.parse(fs.readFileSync(seriesPath, "utf8"));
      fallbackSeries = data.series || [];
      console.log(`[JSON Fallback] Loaded ${fallbackSeries.length} series from ${seriesPath}`);
    } catch (e) {
      console.error(`[JSON Fallback] Failed to parse series JSON:`, e);
    }
  } else {
    console.error("[JSON Fallback] series.json not found in any candidate paths.");
  }
}

function saveJsonFallbackData() {
  const tmpDir = "/tmp";
  try {
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }
    const videosPath = path.join(tmpDir, "videos.json");
    const seriesPath = path.join(tmpDir, "series.json");
    
    const catMap = new Map<string, number>();
    for (const v of fallbackVideos) {
      const name = normalizeCategory(v.category);
      catMap.set(name, (catMap.get(name) || 0) + 1);
    }
    
    fs.writeFileSync(videosPath, JSON.stringify({
      videos: fallbackVideos,
      total: fallbackVideos.length,
      categories: Array.from(catMap.entries()).map(([name, count]) => ({ name, count }))
    }, null, 2));

    const seriesCatMap = new Map<string, number>();
    for (const s of fallbackSeries) {
      const name = normalizeCategory(s.category);
      seriesCatMap.set(name, (seriesCatMap.get(name) || 0) + 1);
    }
    
    fs.writeFileSync(seriesPath, JSON.stringify({
      series: fallbackSeries,
      total: fallbackSeries.length,
      categories: Array.from(seriesCatMap.entries()).map(([name, count]) => ({ name, count }))
    }, null, 2));
  } catch (e) {
    console.error("[JSON Fallback] Failed to save database to /tmp:", e);
  }
}

const nextVideoId = () => Math.max(0, ...fallbackVideos.map(v => v.id)) + 1;
const nextSeriesId = () => Math.max(0, ...fallbackSeries.map(s => s.id)) + 1;
const nextEpisodeId = () => {
  let max = 0;
  for (const s of fallbackSeries) {
    for (const e of s.episodes || []) {
      if (e.id > max) max = e.id;
    }
  }
  return max + 1;
};

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

const rowToEpisode = (row: Record<string, unknown>): EpisodeRecord => ({
  id: Number(row.id),
  seriesId: Number(row.series_id),
  episodeNumber: Number(row.episode_number),
  title: String(row.title ?? ""),
  description: String(row.description ?? ""),
  thumbnail: String(row.thumbnail ?? ""),
  pageUrl: String(row.page_url ?? ""),
  sourceUrl: String(row.source_url ?? ""),
  sourceType: String(row.source_type ?? "hls"),
  status: String(row.status ?? "draft"),
  createdAt: String(row.created_at ?? ""),
  updatedAt: String(row.updated_at ?? "")
});

const rowToSeries = (row: Record<string, unknown>): SeriesRecord => ({
  id: Number(row.id),
  title: String(row.title ?? ""),
  description: String(row.description ?? ""),
  poster: String(row.poster ?? ""),
  category: String(row.category ?? "ยังไม่จัดหมวด"),
  status: String(row.status ?? "draft"),
  pageUrl: String(row.page_url ?? ""),
  createdAt: String(row.created_at ?? ""),
  updatedAt: String(row.updated_at ?? ""),
  episodes: listEpisodes(Number(row.id))
});

export function listVideos(query: VideoQuery = {}): VideoPage {
  if (useJsonFallback) {
    const page = clampInteger(query.page ?? 1, 1, 100000);
    const pageSize = clampInteger(query.pageSize ?? 24, 1, 100);
    
    let filtered = [...fallbackVideos];
    
    const search = String(query.search ?? "").trim().toLowerCase();
    if (search) {
      filtered = filtered.filter(v => 
        v.title.toLowerCase().includes(search) || 
        v.description.toLowerCase().includes(search) || 
        v.pageUrl.toLowerCase().includes(search)
      );
    }
    
    const category = String(query.category ?? "").trim();
    if (category && category !== "All") {
      filtered = filtered.filter(v => v.category === category);
    }
    
    filtered.sort((a, b) => {
      const timeA = new Date(a.createdAt).getTime();
      const timeB = new Date(b.createdAt).getTime();
      if (timeA !== timeB) return timeB - timeA;
      return b.id - a.id;
    });
    
    const total = filtered.length;
    const offset = (page - 1) * pageSize;
    const paginated = filtered.slice(offset, offset + pageSize);
    
    return {
      videos: paginated,
      total,
      page,
      pageSize,
      categories: listCategories()
    };
  }

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

export function listAllVideos(): VideoRecord[] {
  if (useJsonFallback) {
    return [...fallbackVideos].sort((a, b) => {
      const timeA = new Date(a.createdAt).getTime();
      const timeB = new Date(b.createdAt).getTime();
      if (timeA !== timeB) return timeB - timeA;
      return b.id - a.id;
    });
  }

  const rows = db.prepare("SELECT * FROM videos ORDER BY created_at DESC, id DESC").all() as Record<string, unknown>[];
  return rows.map(rowToVideo);
}

export function getVideo(id: number): VideoRecord | undefined {
  if (useJsonFallback) {
    return fallbackVideos.find((v) => v.id === id);
  }

  const row = db.prepare("SELECT * FROM videos WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return row ? rowToVideo(row) : undefined;
}

export function createVideo(input: VideoInput): VideoRecord {
  if (useJsonFallback) {
    const now = new Date().toISOString();
    const video: VideoRecord = {
      id: nextVideoId(),
      title: input.title.trim(),
      description: input.description.trim(),
      thumbnail: input.thumbnail.trim(),
      category: normalizeCategory(input.category),
      pageUrl: input.pageUrl.trim(),
      sourceUrl: input.sourceUrl.trim(),
      sourceType: input.sourceType.trim() || "hls",
      duration: input.duration ?? null,
      createdAt: now,
      updatedAt: now
    };
    fallbackVideos.push(video);
    saveJsonFallbackData();
    return video;
  }

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
  if (useJsonFallback) {
    const index = fallbackVideos.findIndex((v) => v.id === id);
    if (index === -1) throw new Error("Video not found");
    const prev = fallbackVideos[index];
    const video: VideoRecord = {
      ...prev,
      title: input.title.trim(),
      description: input.description.trim(),
      thumbnail: input.thumbnail.trim(),
      category: normalizeCategory(input.category),
      pageUrl: input.pageUrl.trim(),
      sourceUrl: input.sourceUrl.trim(),
      sourceType: input.sourceType.trim() || "hls",
      duration: input.duration ?? null,
      updatedAt: new Date().toISOString()
    };
    fallbackVideos[index] = video;
    saveJsonFallbackData();
    return video;
  }

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
  if (useJsonFallback) {
    const index = fallbackVideos.findIndex((v) => v.id === id);
    if (index === -1) return false;
    fallbackVideos.splice(index, 1);
    saveJsonFallbackData();
    return true;
  }

  const result = db.prepare("DELETE FROM videos WHERE id = ?").run(id);
  return result.changes > 0;
}

export function listCategories(): CategorySummary[] {
  if (useJsonFallback) {
    const catMap = new Map<string, number>();
    for (const v of fallbackVideos) {
      const name = normalizeCategory(v.category);
      catMap.set(name, (catMap.get(name) || 0) + 1);
    }
    return Array.from(catMap.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  }

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

export function listSeries(): SeriesRecord[] {
  if (useJsonFallback) {
    return [...fallbackSeries].sort((a, b) => {
      const timeA = new Date(a.updatedAt || a.createdAt).getTime();
      const timeB = new Date(b.updatedAt || b.createdAt).getTime();
      if (timeA !== timeB) return timeB - timeA;
      return b.id - a.id;
    });
  }

  const rows = db.prepare("SELECT * FROM series ORDER BY updated_at DESC, id DESC").all() as Record<string, unknown>[];
  return rows.map(rowToSeries);
}

export function getSeries(id: number): SeriesRecord | undefined {
  if (useJsonFallback) {
    return fallbackSeries.find((s) => s.id === id);
  }

  const row = db.prepare("SELECT * FROM series WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return row ? rowToSeries(row) : undefined;
}

export function createSeries(input: SeriesInput): SeriesRecord {
  if (useJsonFallback) {
    const now = new Date().toISOString();
    const series: SeriesRecord = {
      id: nextSeriesId(),
      title: input.title.trim(),
      description: input.description.trim(),
      poster: input.poster.trim(),
      category: normalizeCategory(input.category),
      status: normalizeStatus(input.status),
      pageUrl: input.pageUrl.trim(),
      createdAt: now,
      updatedAt: now,
      episodes: []
    };
    fallbackSeries.push(series);
    saveJsonFallbackData();
    return series;
  }

  const result = db
    .prepare(
      `
      INSERT INTO series (title, description, poster, category, status, page_url)
      VALUES (@title, @description, @poster, @category, @status, @pageUrl)
      `
    )
    .run(normalizeSeriesInput(input));
  const series = getSeries(Number(result.lastInsertRowid));
  if (!series) throw new Error("Series was not saved");
  return series;
}

export function updateSeries(id: number, input: SeriesInput): SeriesRecord {
  if (useJsonFallback) {
    const index = fallbackSeries.findIndex((s) => s.id === id);
    if (index === -1) throw new Error("Series not found");
    const prev = fallbackSeries[index];
    const series: SeriesRecord = {
      ...prev,
      title: input.title.trim(),
      description: input.description.trim(),
      poster: input.poster.trim(),
      category: normalizeCategory(input.category),
      status: normalizeStatus(input.status),
      pageUrl: input.pageUrl.trim(),
      updatedAt: new Date().toISOString()
    };
    fallbackSeries[index] = series;
    saveJsonFallbackData();
    return series;
  }

  const result = db
    .prepare(
      `
      UPDATE series
      SET title = @title,
          description = @description,
          poster = @poster,
          category = @category,
          status = @status,
          page_url = @pageUrl,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = @id
      `
    )
    .run({ id, ...normalizeSeriesInput(input) });
  if (result.changes === 0) throw new Error("Series not found");
  const series = getSeries(id);
  if (!series) throw new Error("Series not found");
  return series;
}

export function deleteSeries(id: number): boolean {
  if (useJsonFallback) {
    const index = fallbackSeries.findIndex((s) => s.id === id);
    if (index === -1) return false;
    fallbackSeries.splice(index, 1);
    saveJsonFallbackData();
    return true;
  }

  const result = db.prepare("DELETE FROM series WHERE id = ?").run(id);
  return result.changes > 0;
}

export function listEpisodes(seriesId: number): EpisodeRecord[] {
  if (useJsonFallback) {
    const series = getSeries(seriesId);
    if (!series) return [];
    return [...(series.episodes || [])].sort((a, b) => {
      if (a.episodeNumber !== b.episodeNumber) return a.episodeNumber - b.episodeNumber;
      return a.id - b.id;
    });
  }

  const rows = db
    .prepare("SELECT * FROM episodes WHERE series_id = ? ORDER BY episode_number ASC, id ASC")
    .all(seriesId) as Record<string, unknown>[];
  return rows.map(rowToEpisode);
}

export function listAllEpisodes(): EpisodeRecord[] {
  if (useJsonFallback) {
    const eps: EpisodeRecord[] = [];
    for (const s of fallbackSeries) {
      eps.push(...(s.episodes || []));
    }
    return eps.sort((a, b) => {
      if (a.seriesId !== b.seriesId) return a.seriesId - b.seriesId;
      if (a.episodeNumber !== b.episodeNumber) return a.episodeNumber - b.episodeNumber;
      return a.id - b.id;
    });
  }

  const rows = db
    .prepare("SELECT * FROM episodes ORDER BY series_id ASC, episode_number ASC, id ASC")
    .all() as Record<string, unknown>[];
  return rows.map(rowToEpisode);
}

export function getEpisode(id: number): EpisodeRecord | undefined {
  if (useJsonFallback) {
    for (const s of fallbackSeries) {
      const ep = (s.episodes || []).find((e) => e.id === id);
      if (ep) return ep;
    }
    return undefined;
  }

  const row = db.prepare("SELECT * FROM episodes WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return row ? rowToEpisode(row) : undefined;
}

export function createEpisode(seriesId: number, input: EpisodeInput): EpisodeRecord {
  if (useJsonFallback) {
    const seriesIndex = fallbackSeries.findIndex((s) => s.id === seriesId);
    if (seriesIndex === -1) throw new Error("Series not found");
    const now = new Date().toISOString();
    const episode: EpisodeRecord = {
      id: nextEpisodeId(),
      seriesId,
      episodeNumber: clampInteger(input.episodeNumber, 1, 100000),
      title: input.title.trim(),
      description: input.description.trim(),
      thumbnail: input.thumbnail.trim(),
      pageUrl: input.pageUrl.trim(),
      sourceUrl: input.sourceUrl.trim(),
      sourceType: input.sourceType.trim() || "hls",
      status: normalizeStatus(input.status),
      createdAt: now,
      updatedAt: now
    };
    if (!fallbackSeries[seriesIndex].episodes) {
      fallbackSeries[seriesIndex].episodes = [];
    }
    fallbackSeries[seriesIndex].episodes.push(episode);
    fallbackSeries[seriesIndex].updatedAt = now;
    saveJsonFallbackData();
    return episode;
  }

  if (!getSeries(seriesId)) throw new Error("Series not found");
  const result = db
    .prepare(
      `
      INSERT INTO episodes (series_id, episode_number, title, description, thumbnail, page_url, source_url, source_type, status)
      VALUES (@seriesId, @episodeNumber, @title, @description, @thumbnail, @pageUrl, @sourceUrl, @sourceType, @status)
      `
    )
    .run({ seriesId, ...normalizeEpisodeInput(input) });
  touchSeries(seriesId);
  const episode = getEpisode(Number(result.lastInsertRowid));
  if (!episode) throw new Error("Episode was not saved");
  return episode;
}

export function updateEpisode(id: number, input: EpisodeInput): EpisodeRecord {
  if (useJsonFallback) {
    let found = false;
    let episode!: EpisodeRecord;
    const now = new Date().toISOString();
    
    for (let sIdx = 0; sIdx < fallbackSeries.length; sIdx++) {
      const epIndex = (fallbackSeries[sIdx].episodes || []).findIndex((e) => e.id === id);
      if (epIndex !== -1) {
        const prev = fallbackSeries[sIdx].episodes[epIndex];
        episode = {
          ...prev,
          episodeNumber: clampInteger(input.episodeNumber, 1, 100000),
          title: input.title.trim(),
          description: input.description.trim(),
          thumbnail: input.thumbnail.trim(),
          pageUrl: input.pageUrl.trim(),
          sourceUrl: input.sourceUrl.trim(),
          sourceType: input.sourceType.trim() || "hls",
          status: normalizeStatus(input.status),
          updatedAt: now
        };
        fallbackSeries[sIdx].episodes[epIndex] = episode;
        fallbackSeries[sIdx].updatedAt = now;
        found = true;
        break;
      }
    }
    
    if (!found) throw new Error("Episode not found");
    saveJsonFallbackData();
    return episode;
  }

  const previous = getEpisode(id);
  if (!previous) throw new Error("Episode not found");
  const result = db
    .prepare(
      `
      UPDATE episodes
      SET episode_number = @episodeNumber,
          title = @title,
          description = @description,
          thumbnail = @thumbnail,
          page_url = @pageUrl,
          source_url = @sourceUrl,
          source_type = @sourceType,
          status = @status,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = @id
      `
    )
    .run({ id, ...normalizeEpisodeInput(input) });
  if (result.changes === 0) throw new Error("Episode not found");
  touchSeries(previous.seriesId);
  const episode = getEpisode(id);
  if (!episode) throw new Error("Episode not found");
  return episode;
}

export function deleteEpisode(id: number): boolean {
  if (useJsonFallback) {
    const now = new Date().toISOString();
    for (let sIdx = 0; sIdx < fallbackSeries.length; sIdx++) {
      const epIndex = (fallbackSeries[sIdx].episodes || []).findIndex((e) => e.id === id);
      if (epIndex !== -1) {
        fallbackSeries[sIdx].episodes.splice(epIndex, 1);
        fallbackSeries[sIdx].updatedAt = now;
        saveJsonFallbackData();
        return true;
      }
    }
    return false;
  }

  const episode = getEpisode(id);
  const result = db.prepare("DELETE FROM episodes WHERE id = ?").run(id);
  if (episode && result.changes > 0) touchSeries(episode.seriesId);
  return result.changes > 0;
}

function normalizeCategory(value: string): string {
  const category = value.trim();
  return category || "Uncategorized";
}

function normalizeSeriesInput(input: SeriesInput) {
  return {
    title: input.title.trim(),
    description: input.description.trim(),
    poster: input.poster.trim(),
    category: normalizeCategory(input.category),
    status: normalizeStatus(input.status),
    pageUrl: input.pageUrl.trim()
  };
}

function normalizeEpisodeInput(input: EpisodeInput) {
  const sourceUrl = input.sourceUrl.trim();
  if (sourceUrl && isBlockedPersistedSource(sourceUrl)) throw new Error("Blocked ad/tracker media source");
  if (sourceUrl && isLikelySidecarPlaylistUrl(sourceUrl)) throw new Error("Blocked sidecar playlist source");
  return {
    episodeNumber: clampInteger(input.episodeNumber, 1, 100000),
    title: input.title.trim(),
    description: input.description.trim(),
    thumbnail: input.thumbnail.trim(),
    pageUrl: input.pageUrl.trim(),
    sourceUrl,
    sourceType: input.sourceType.trim() || "hls",
    status: normalizeStatus(input.status)
  };
}

function normalizeStatus(value: string): string {
  return ["draft", "published", "hidden"].includes(value) ? value : "draft";
}

function touchSeries(id: number) {
  db.prepare("UPDATE series SET updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
}

function isBlockedPersistedSource(url: string): boolean {
  return /doubleclick|googlesyndication|google-analytics|facebook\.com\/tr|adsystem|adservice|popads/i.test(url);
}

function isLikelySidecarPlaylistUrl(url: string): boolean {
  const normalized = url.toLowerCase();
  return normalized.includes(".m3u8") && /\/tracks-[^/]+\/|\/audio\/|mono\.|subtitle|captions/.test(normalized);
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(Math.trunc(value), min), max);
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}
