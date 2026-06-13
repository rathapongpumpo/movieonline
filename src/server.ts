import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createEpisode,
  createSeries,
  createVideo,
  deleteEpisode,
  deleteSeries,
  deleteVideo,
  getSeries,
  getVideo,
  listSeries,
  listVideos,
  updateEpisode,
  updateSeries,
  updateVideo,
  type EpisodeInput,
  type SeriesInput,
  type VideoInput
} from "./db.js";
import { inspectSite, type InspectResult, type MediaItem } from "./inspector.js";

const app = express();
const port = Number(process.env.PORT ?? 3000);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const reactRoot = path.join(root, "public", "react");
const reactIndex = path.join(reactRoot, "index.html");

app.use(express.json({ limit: "1mb" }));
app.use(express.static(reactRoot));
app.use(express.static(path.join(root, "public")));

app.get(["/admin", "/admin/series"], (_req, res) => {
  res.sendFile(fs.existsSync(reactIndex) ? reactIndex : path.join(root, "public", "admin.html"));
});

app.get("/watch/:id", (_req, res) => {
  res.sendFile(fs.existsSync(reactIndex) ? reactIndex : path.join(root, "public", "watch.html"));
});

app.get("/", (_req, res) => {
  res.sendFile(fs.existsSync(reactIndex) ? reactIndex : path.join(root, "public", "index.html"));
});

app.post("/api/inspect", async (req, res) => {
  try {
    const url = String(req.body?.url ?? "");
    const maxPages = Number(req.body?.maxPages ?? 25);
    const result = await inspectSite(url, { maxPages });
    res.json(result);
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

app.post("/api/admin/inspect", async (req, res) => {
  try {
    const url = String(req.body?.url ?? "");
    const result = await inspectSite(url, { maxPages: 1 });
    res.json(buildAdminInspectResult(result));
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

app.get("/api/videos", (req, res) => {
  const page = Number(req.query.page ?? 1);
  const pageSize = Number(req.query.pageSize ?? 24);
  const search = String(req.query.search ?? "");
  const category = String(req.query.category ?? "");
  res.json(listVideos({ page, pageSize, search, category }));
});

app.get("/api/videos/:id", (req, res) => {
  const video = getVideo(Number(req.params.id));
  if (!video) {
    res.status(404).json({ error: "Video not found" });
    return;
  }
  res.json({ video });
});

app.post("/api/videos", (req, res) => {
  try {
    const input = validateVideoInput(req.body);
    const video = createVideo(input);
    res.status(201).json({ video });
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

app.put("/api/videos/:id", (req, res) => {
  try {
    const input = validateVideoInput(req.body);
    const video = updateVideo(Number(req.params.id), input);
    res.json({ video });
  } catch (error) {
    res.status(error instanceof Error && error.message === "Video not found" ? 404 : 400).json({
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

app.delete("/api/videos/:id", (req, res) => {
  const deleted = deleteVideo(Number(req.params.id));
  if (!deleted) {
    res.status(404).json({ error: "Video not found" });
    return;
  }
  res.status(204).end();
});

app.get("/api/series", (_req, res) => {
  res.json({ series: listSeries() });
});

app.get("/api/series/:id", (req, res) => {
  const series = getSeries(Number(req.params.id));
  if (!series) {
    res.status(404).json({ error: "Series not found" });
    return;
  }
  res.json({ series });
});

app.post("/api/series", (req, res) => {
  try {
    const input = validateSeriesInput(req.body);
    const series = createSeries(input);
    res.status(201).json({ series });
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

app.put("/api/series/:id", (req, res) => {
  try {
    const input = validateSeriesInput(req.body);
    const series = updateSeries(Number(req.params.id), input);
    res.json({ series });
  } catch (error) {
    res.status(error instanceof Error && error.message === "Series not found" ? 404 : 400).json({
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

app.delete("/api/series/:id", (req, res) => {
  const deleted = deleteSeries(Number(req.params.id));
  if (!deleted) {
    res.status(404).json({ error: "Series not found" });
    return;
  }
  res.status(204).end();
});

app.post("/api/series/:id/episodes", (req, res) => {
  try {
    const input = validateEpisodeInput(req.body, false);
    const episode = createEpisode(Number(req.params.id), input);
    res.status(201).json({ episode });
  } catch (error) {
    res.status(error instanceof Error && error.message === "Series not found" ? 404 : 400).json({
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

app.put("/api/episodes/:id", (req, res) => {
  try {
    const input = validateEpisodeInput(req.body, false);
    const episode = updateEpisode(Number(req.params.id), input);
    res.json({ episode });
  } catch (error) {
    res.status(error instanceof Error && error.message === "Episode not found" ? 404 : 400).json({
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

app.delete("/api/episodes/:id", (req, res) => {
  const deleted = deleteEpisode(Number(req.params.id));
  if (!deleted) {
    res.status(404).json({ error: "Episode not found" });
    return;
  }
  res.status(204).end();
});

app.listen(port, () => {
  console.log(`Site Source Inspector running at http://localhost:${port}`);
});

function isDirectVideoSource(item: MediaItem): boolean {
  if (!["video", "stream"].includes(item.kind)) return false;
  if (item.finalUrl.startsWith("blob:")) return false;
  return !item.displayedAs.toLowerCase().includes("iframe");
}

function isPlayableSource(item: MediaItem): boolean {
  if (item.finalUrl.startsWith("blob:")) return false;
  if (isBlockedMediaUrl(item.finalUrl)) return false;
  if (item.displayedAs.toLowerCase().includes("iframe")) return true;
  if (/\/hdr__[^/]+\.bin(?:\?|$)/.test(item.finalUrl)) return false;
  if (/\/s_\d+\.bin(?:\?|$)/.test(item.finalUrl)) return false;
  if (isLikelySidecarPlaylist(item.finalUrl)) return false;
  return isDirectVideoSource(item);
}

function buildAdminInspectResult(result: InspectResult) {
  let allSources = uniqueBy(
    result.media
      .filter(isPlayableSource)
      .sort((a, b) => scoreMediaSource(b) - scoreMediaSource(a)),
    (item) => item.finalUrl
  ).map((item) => ({
    url: item.finalUrl,
    kind: item.kind,
    foundBy: item.foundBy,
    displayedAs: item.displayedAs,
    sourceType: item.displayedAs.toLowerCase().includes("iframe") ? "embed" : item.finalUrl.includes(".m3u8") ? "hls" : "mp4",
    contentType: item.contentType ?? "",
    probe: item.probe
  }));
  if (allSources.some((candidate) => !isYoutubeUrl(candidate.url))) {
    allSources = allSources.filter((candidate) => !isYoutubeUrl(candidate.url));
  }
  const candidates = allSources.filter((candidate) => candidate.sourceType !== "embed");
  const fallbackEmbeds = allSources.filter((candidate) => candidate.sourceType === "embed");

  return {
    pageUrl: result.startUrl,
    metadata: result.metadata,
    candidates,
    fallbackEmbeds,
    needsSelection: candidates.length !== 1,
    warnings: [
      ...(candidates.length === 0 ? ["No direct video source found."] : []),
      ...(candidates.length > 1 ? ["Multiple direct video sources found. Select one before saving."] : []),
      ...(candidates.length === 0 && fallbackEmbeds.length > 0
        ? ["Embedded fallback was found, but it is not a direct video source and may include third-party UI or ads."]
        : []),
      ...result.errors
    ]
  };
}

function validateVideoInput(value: Record<string, unknown>): VideoInput {
  const title = String(value.title ?? "").trim();
  const sourceUrl = String(value.sourceUrl ?? "").trim();
  const pageUrl = String(value.pageUrl ?? "").trim();
  if (!title) throw new Error("Title is required");
  if (!sourceUrl) throw new Error("Source URL is required");
  if (isBlockedMediaUrl(sourceUrl)) throw new Error("Blocked ad/tracker media source");
  if (isLikelySidecarPlaylist(sourceUrl)) throw new Error("Blocked sidecar playlist source");
  if (!pageUrl) throw new Error("Page URL is required");
  return {
    title,
    sourceUrl,
    pageUrl,
    description: String(value.description ?? ""),
    thumbnail: String(value.thumbnail ?? ""),
    category: String(value.category ?? "Uncategorized"),
    sourceType: String(value.sourceType ?? "hls"),
    duration: typeof value.duration === "number" ? value.duration : null
  };
}

function validateSeriesInput(value: Record<string, unknown>): SeriesInput {
  const title = String(value.title ?? "").trim();
  if (!title) throw new Error("Title is required");
  return {
    title,
    description: String(value.description ?? ""),
    poster: String(value.poster ?? ""),
    category: String(value.category ?? "ยังไม่จัดหมวด"),
    status: String(value.status ?? "draft"),
    pageUrl: String(value.pageUrl ?? "")
  };
}

function validateEpisodeInput(value: Record<string, unknown>, requireSource: boolean): EpisodeInput {
  const title = String(value.title ?? "").trim();
  const sourceUrl = String(value.sourceUrl ?? "").trim();
  if (!title) throw new Error("Title is required");
  if (requireSource && !sourceUrl) throw new Error("Source URL is required");
  if (sourceUrl && isBlockedMediaUrl(sourceUrl)) throw new Error("Blocked ad/tracker media source");
  if (sourceUrl && isLikelySidecarPlaylist(sourceUrl)) throw new Error("Blocked sidecar playlist source");
  return {
    episodeNumber: Number(value.episodeNumber ?? 1),
    title,
    description: String(value.description ?? ""),
    thumbnail: String(value.thumbnail ?? ""),
    pageUrl: String(value.pageUrl ?? ""),
    sourceUrl,
    sourceType: String(value.sourceType ?? "hls"),
    status: String(value.status ?? "draft")
  };
}

function uniqueBy<T>(items: T[], getKey: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = getKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isYoutubeUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "");
    return hostname === "youtube.com" || hostname === "youtu.be" || hostname.endsWith(".youtube.com");
  } catch {
    return false;
  }
}

function scoreMediaSource(item: MediaItem): number {
  let score = 0;
  const url = item.finalUrl.toLowerCase();
  const displayedAs = item.displayedAs.toLowerCase();
  if (!displayedAs.includes("iframe")) score += 100;
  if (item.kind === "stream") score += 40;
  if (item.kind === "video") score += 30;
  if (url.includes(".m3u8")) score += 30;
  if (url.endsWith("/playlist.m3u8") || url.includes("/playlist.m3u8?")) score += 50;
  if (item.foundBy === "dom") score += 10;
  if (displayedAs.includes("onclick") || displayedAs === "media" || displayedAs === "xhr") score += 10;
  if (/\/tracks-[^/]+\/|\/audio\/|mono\.|subtitle|captions|\/hlsr\//.test(url)) score -= 80;
  return score;
}

function isLikelySidecarPlaylist(url: string): boolean {
  const normalized = url.toLowerCase();
  return normalized.includes(".m3u8") && /\/tracks-[^/]+\/|\/audio\/|mono\.|subtitle|captions/.test(normalized);
}

function isBlockedMediaUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();
    const blockedHosts = [
      "ads.",
      "ad.",
      "doubleclick.net",
      "googlesyndication.com",
      "googleadservices.com",
      "p2p-cdnmovie.xyz"
    ];
    return blockedHosts.some((blocked) => host === blocked || host.includes(blocked)) || /(^|\/)(ads?|banner|promo|pop|preroll)(\/|[-_.])/.test(path);
  } catch {
    return false;
  }
}
