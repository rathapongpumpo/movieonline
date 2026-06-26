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

// Establish the database folder path
let dbFolder = path.join(root, "data");

// On Vercel, copy JSON files to /tmp at startup so they are writable
if (process.env.VERCEL) {
  dbFolder = "/tmp";
  try {
    const srcVideos = path.join(root, "data", "videos.json");
    const srcSeries = path.join(root, "data", "series.json");
    const destVideos = path.join("/tmp", "videos.json");
    const destSeries = path.join("/tmp", "series.json");

    if (!fs.existsSync(destVideos) && fs.existsSync(srcVideos)) {
      fs.copyFileSync(srcVideos, destVideos);
    }
    if (!fs.existsSync(destSeries) && fs.existsSync(srcSeries)) {
      fs.copyFileSync(srcSeries, destSeries);
    }
  } catch (err) {
    console.error("Failed to copy JSON files to /tmp on Vercel:", err);
  }
}

const videosPath = path.join(dbFolder, "videos.json");
const seriesPath = path.join(dbFolder, "series.json");

// In-memory data cache
let dbVideos: VideoRecord[] = [];
let dbSeries: SeriesRecord[] = [];

// Load data initially
loadData();

function loadData() {
  try {
    if (fs.existsSync(videosPath)) {
      const data = JSON.parse(fs.readFileSync(videosPath, "utf8"));
      dbVideos = data.videos || [];
    } else {
      dbVideos = [];
    }
  } catch (err) {
    console.error("Failed to load videos.json:", err);
    dbVideos = [];
  }

  try {
    if (fs.existsSync(seriesPath)) {
      const data = JSON.parse(fs.readFileSync(seriesPath, "utf8"));
      dbSeries = data.series || [];
    } else {
      dbSeries = [];
    }
  } catch (err) {
    console.error("Failed to load series.json:", err);
    dbSeries = [];
  }
}

function saveData() {
  try {
    if (!fs.existsSync(dbFolder)) {
      fs.mkdirSync(dbFolder, { recursive: true });
    }

    // Write videos
    const videosCategories = listCategories();
    fs.writeFileSync(
      videosPath,
      JSON.stringify(
        {
          videos: dbVideos,
          total: dbVideos.length,
          categories: videosCategories
        },
        null,
        2
      ),
      "utf8"
    );

    // Write series
    const seriesCatMap = new Map<string, number>();
    for (const s of dbSeries) {
      const name = normalizeCategory(s.category);
      seriesCatMap.set(name, (seriesCatMap.get(name) || 0) + 1);
    }
    fs.writeFileSync(
      seriesPath,
      JSON.stringify(
        {
          series: dbSeries,
          total: dbSeries.length,
          categories: Array.from(seriesCatMap.entries()).map(([name, count]) => ({ name, count }))
        },
        null,
        2
      ),
      "utf8"
    );
  } catch (err) {
    console.error("Failed to save JSON database:", err);
  }
}

const nextVideoId = () => Math.max(0, ...dbVideos.map((v) => v.id)) + 1;
const nextSeriesId = () => Math.max(0, ...dbSeries.map((s) => s.id)) + 1;
const nextEpisodeId = () => {
  let max = 0;
  for (const s of dbSeries) {
    for (const e of s.episodes || []) {
      if (e.id > max) max = e.id;
    }
  }
  return max + 1;
};

export function listVideos(query: VideoQuery = {}): VideoPage {
  const page = clampInteger(query.page ?? 1, 1, 100000);
  const pageSize = clampInteger(query.pageSize ?? 24, 1, 100);

  let filtered = [...dbVideos];

  const search = String(query.search ?? "").trim().toLowerCase();
  if (search) {
    filtered = filtered.filter(
      (v) =>
        v.title.toLowerCase().includes(search) ||
        v.description.toLowerCase().includes(search) ||
        v.pageUrl.toLowerCase().includes(search)
    );
  }

  const category = String(query.category ?? "").trim();
  if (category && category !== "All") {
    filtered = filtered.filter((v) => v.category === category);
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

export function listAllVideos(): VideoRecord[] {
  return [...dbVideos].sort((a, b) => {
    const timeA = new Date(a.createdAt).getTime();
    const timeB = new Date(b.createdAt).getTime();
    if (timeA !== timeB) return timeB - timeA;
    return b.id - a.id;
  });
}

export function getVideo(id: number): VideoRecord | undefined {
  return dbVideos.find((v) => v.id === id);
}

export function createVideo(input: VideoInput): VideoRecord {
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
  dbVideos.push(video);
  saveData();
  return video;
}

export function updateVideo(id: number, input: VideoInput): VideoRecord {
  const index = dbVideos.findIndex((v) => v.id === id);
  if (index === -1) throw new Error("Video not found");
  const prev = dbVideos[index];
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
  dbVideos[index] = video;
  saveData();
  return video;
}

export function deleteVideo(id: number): boolean {
  const index = dbVideos.findIndex((v) => v.id === id);
  if (index === -1) return false;
  dbVideos.splice(index, 1);
  saveData();
  return true;
}

export function listCategories(): CategorySummary[] {
  const catMap = new Map<string, number>();
  for (const v of dbVideos) {
    const name = normalizeCategory(v.category);
    catMap.set(name, (catMap.get(name) || 0) + 1);
  }
  return Array.from(catMap.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

export function listSeries(): SeriesRecord[] {
  return [...dbSeries].sort((a, b) => {
    const timeA = new Date(a.updatedAt || a.createdAt).getTime();
    const timeB = new Date(b.updatedAt || b.createdAt).getTime();
    if (timeA !== timeB) return timeB - timeA;
    return b.id - a.id;
  });
}

export function getSeries(id: number): SeriesRecord | undefined {
  return dbSeries.find((s) => s.id === id);
}

export function createSeries(input: SeriesInput): SeriesRecord {
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
  dbSeries.push(series);
  saveData();
  return series;
}

export function updateSeries(id: number, input: SeriesInput): SeriesRecord {
  const index = dbSeries.findIndex((s) => s.id === id);
  if (index === -1) throw new Error("Series not found");
  const prev = dbSeries[index];
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
  dbSeries[index] = series;
  saveData();
  return series;
}

export function deleteSeries(id: number): boolean {
  const index = dbSeries.findIndex((s) => s.id === id);
  if (index === -1) return false;
  dbSeries.splice(index, 1);
  saveData();
  return true;
}

export function listEpisodes(seriesId: number): EpisodeRecord[] {
  const series = getSeries(seriesId);
  if (!series) return [];
  return [...(series.episodes || [])].sort((a, b) => {
    if (a.episodeNumber !== b.episodeNumber) return a.episodeNumber - b.episodeNumber;
    return a.id - b.id;
  });
}

export function listAllEpisodes(): EpisodeRecord[] {
  const eps: EpisodeRecord[] = [];
  for (const s of dbSeries) {
    eps.push(...(s.episodes || []));
  }
  return eps.sort((a, b) => {
    if (a.seriesId !== b.seriesId) return a.seriesId - b.seriesId;
    if (a.episodeNumber !== b.episodeNumber) return a.episodeNumber - b.episodeNumber;
    return a.id - b.id;
  });
}

export function getEpisode(id: number): EpisodeRecord | undefined {
  for (const s of dbSeries) {
    const ep = (s.episodes || []).find((e) => e.id === id);
    if (ep) return ep;
  }
  return undefined;
}

export function createEpisode(seriesId: number, input: EpisodeInput): EpisodeRecord {
  const seriesIndex = dbSeries.findIndex((s) => s.id === seriesId);
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
  if (!dbSeries[seriesIndex].episodes) {
    dbSeries[seriesIndex].episodes = [];
  }
  dbSeries[seriesIndex].episodes.push(episode);
  dbSeries[seriesIndex].updatedAt = now;
  saveData();
  return episode;
}

export function updateEpisode(id: number, input: EpisodeInput): EpisodeRecord {
  let found = false;
  let episode!: EpisodeRecord;
  const now = new Date().toISOString();

  for (let sIdx = 0; sIdx < dbSeries.length; sIdx++) {
    const epIndex = (dbSeries[sIdx].episodes || []).findIndex((e) => e.id === id);
    if (epIndex !== -1) {
      const prev = dbSeries[sIdx].episodes[epIndex];
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
      dbSeries[sIdx].episodes[epIndex] = episode;
      dbSeries[sIdx].updatedAt = now;
      found = true;
      break;
    }
  }

  if (!found) throw new Error("Episode not found");
  saveData();
  return episode;
}

export function deleteEpisode(id: number): boolean {
  const now = new Date().toISOString();
  for (let sIdx = 0; sIdx < dbSeries.length; sIdx++) {
    const epIndex = (dbSeries[sIdx].episodes || []).findIndex((e) => e.id === id);
    if (epIndex !== -1) {
      dbSeries[sIdx].episodes.splice(epIndex, 1);
      dbSeries[sIdx].updatedAt = now;
      saveData();
      return true;
    }
  }
  return false;
}

function normalizeCategory(value: string): string {
  const category = value.trim();
  return category || "Uncategorized";
}

function normalizeStatus(value: string): string {
  return ["draft", "published", "hidden"].includes(value) ? value : "draft";
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(Math.trunc(value), min), max);
}
