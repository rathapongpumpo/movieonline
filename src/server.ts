import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  clearSessionCookie,
  createSessionCookie,
  defaultAdminUsers,
  getSessionUser,
  validateAdminCredentials,
  type AdminUser
} from "./auth.js";
import {
  createEpisode,
  createSeries,
  createVideo,
  deleteEpisode,
  deleteSeries,
  deleteVideo,
  getSeries,
  getVideo,
  listAllEpisodes,
  listAllVideos,
  listCategories,
  listSeries,
  listVideos,
  updateEpisode,
  updateSeries,
  updateVideo,
  type EpisodeInput,
  type SeriesInput,
  type VideoRecord,
  type VideoInput
} from "./db.js";
import { exportLibraryToGoogleSheets, listGoogleSheetAdminUsers } from "./googleSheets.js";
import { discoverMovieCards, inspectSite, type InspectResult, type MediaItem } from "./inspector.js";

export const app = express();
const port = Number(process.env.PORT ?? 3000);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const reactRoot = fs.existsSync(path.join(root, "dist")) ? path.join(root, "dist") : path.join(root, "public", "react");
const reactIndex = path.join(reactRoot, "index.html");

app.use(express.json({ limit: "1mb" }));
app.use(express.static(reactRoot));
app.use(express.static(path.join(root, "public")));

app.post("/api/admin/login", async (req, res) => {
  try {
    const username = String(req.body?.username ?? "").trim();
    const password = String(req.body?.password ?? "");
    const user = validateAdminCredentials(await getAdminUsers(), username, password);
    if (!user) {
      res.status(401).json({ error: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" });
      return;
    }
    res.setHeader("Set-Cookie", createSessionCookie(user.username));
    res.json({ user: { username: user.username, role: user.role } });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/api/admin/logout", (_req, res) => {
  res.setHeader("Set-Cookie", clearSessionCookie());
  res.status(204).end();
});

app.get("/api/admin/me", (req, res) => {
  const username = getSessionUser(req.headers.cookie);
  if (!username) {
    res.status(401).json({ error: "ยังไม่ได้เข้าสู่ระบบ" });
    return;
  }
  res.json({ user: { username } });
});

app.use((req, res, next) => {
  if (!requiresAdmin(req.method, req.path)) {
    next();
    return;
  }
  if (!getSessionUser(req.headers.cookie)) {
    res.status(401).json({ error: "กรุณาเข้าสู่ระบบหลังบ้าน" });
    return;
  }
  next();
});

app.get(["/admin", "/admin/series"], (_req, res) => {
  res.sendFile(fs.existsSync(reactIndex) ? reactIndex : path.join(root, "public", "admin.html"));
});

app.get("/series/:id", (_req, res) => {
  res.sendFile(fs.existsSync(reactIndex) ? reactIndex : path.join(root, "public", "index.html"));
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

app.post("/api/admin/discover-cards", async (req, res) => {
  try {
    const url = String(req.body?.url ?? "");
    const limit = Number(req.body?.limit ?? 60);
    const cards = await discoverMovieCards(url, limit);
    res.json({ cards });
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

app.post("/api/admin/export/google-sheets", async (_req, res) => {
  try {
    const result = await exportLibraryToGoogleSheets({
      videos: listAllVideos(),
      series: listSeries(),
      episodes: listAllEpisodes(),
      categories: listCategories()
    });
    res.json(result);
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

app.post("/api/admin/source-health", async (req, res) => {
  try {
    const sourceUrl = String(req.body?.sourceUrl ?? "");
    if (!sourceUrl) throw new Error("Source URL is required");
    const health = await checkPlayableSource(sourceUrl);
    res.status(health.ok ? 200 : 400).json(health);
  } catch (error) {
    res.status(400).json({
      ok: false,
      reason: error instanceof Error ? error.message : String(error)
    });
  }
});

app.get("/api/videos", (req, res) => {
  const page = Number(req.query.page ?? 1);
  const pageSize = Number(req.query.pageSize ?? 24);
  const search = String(req.query.search ?? "");
  const category = String(req.query.category ?? "");
  const data = listVideos({ page, pageSize, search, category });
  res.json(getSessionUser(req.headers.cookie) ? data : { ...data, videos: data.videos.map(toPublicVideo) });
});

app.get("/api/videos/:id", (req, res) => {
  const video = getVideo(Number(req.params.id));
  if (!video) {
    res.status(404).json({ error: "Video not found" });
    return;
  }
  res.json({ video: getSessionUser(req.headers.cookie) ? video : toPublicVideo(video) });
});

app.get("/api/watch/:id", (req, res) => {
  const video = getVideo(Number(req.params.id));
  if (!video) {
    res.status(404).json({ error: "Video not found" });
    return;
  }
  res.json({
    video: {
      ...toPublicVideo(video),
      sourceType: video.sourceType,
      playbackUrl: `/api/play/${video.id}`
    }
  });
});

app.get("/api/play/:id", async (req, res) => {
  const video = getVideo(Number(req.params.id));
  if (!video) {
    res.status(404).send("Not found");
    return;
  }
  await proxyMedia(video.sourceUrl, req.headers.range, res);
});

app.get("/api/play-proxy", async (req, res) => {
  const target = String(req.query.u ?? "");
  if (!target.startsWith("http://") && !target.startsWith("https://")) {
    res.status(400).send("Invalid media URL");
    return;
  }
  await proxyMedia(target, req.headers.range, res);
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

if (!process.env.VERCEL) {
  app.listen(port, () => {
    console.log(`Site Source Inspector running at http://localhost:${port}`);
  });
}

export default app;

async function getAdminUsers(): Promise<AdminUser[]> {
  try {
    const sheetUsers = await listGoogleSheetAdminUsers();
    return [...defaultAdminUsers, ...sheetUsers];
  } catch {
    return defaultAdminUsers;
  }
}

function requiresAdmin(method: string, pathname: string): boolean {
  if (pathname === "/api/admin/login" || pathname === "/api/admin/logout" || pathname === "/api/admin/me") return false;
  if (pathname.startsWith("/api/admin/")) return true;
  if (["POST", "PUT", "PATCH", "DELETE"].includes(method) && /^\/api\/(videos|series|episodes)/.test(pathname)) return true;
  return false;
}

function toPublicVideo(video: VideoRecord) {
  return {
    ...video,
    sourceUrl: ""
  };
}

async function proxyMedia(targetUrl: string, range: string | undefined, res: express.Response) {
  try {
    const response = await fetch(targetUrl, {
      headers: range ? { range } : undefined,
      redirect: "follow",
      signal: AbortSignal.timeout(15000)
    });
    const contentType = response.headers.get("content-type") ?? "";
    const finalUrl = response.url || targetUrl;
    res.status(response.status);
    res.setHeader("Cache-Control", "private, max-age=300");
    res.setHeader("X-Content-Type-Options", "nosniff");

    if (contentType.includes("mpegurl") || finalUrl.toLowerCase().includes(".m3u8")) {
      const text = await response.text();
      res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
      res.send(rewriteHlsPlaylist(text, finalUrl));
      return;
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    const proxiedType = normalizeMediaContentType(contentType, finalUrl, bytes);
    const passHeaders = ["content-length", "content-range", "accept-ranges"];
    for (const header of passHeaders) {
      const value = response.headers.get(header);
      if (value) res.setHeader(header, value);
    }
    if (proxiedType) res.setHeader("Content-Type", proxiedType);
    res.send(bytes);
  } catch (error) {
    res.status(502).send(error instanceof Error ? error.message : String(error));
  }
}

function rewriteHlsPlaylist(text: string, playlistUrl: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith("#")) return rewriteHlsTagUris(line, playlistUrl);
      const absolute = new URL(trimmed, playlistUrl).href;
      return `/api/play-proxy?u=${encodeURIComponent(absolute)}`;
    })
    .join("\n");
}

function rewriteHlsTagUris(line: string, playlistUrl: string): string {
  return line.replace(/URI="([^"]+)"/g, (_match, uri: string) => {
    if (!uri || uri.startsWith("data:")) return `URI="${uri}"`;
    const absolute = new URL(uri, playlistUrl).href;
    return `URI="/api/play-proxy?u=${encodeURIComponent(absolute)}"`;
  });
}

function normalizeMediaContentType(contentType: string, url: string, bytes: Buffer): string {
  const lowerUrl = url.toLowerCase();
  if (bytes[0] === 0x47) return "video/mp2t";
  if (bytes.slice(4, 8).toString("latin1") === "ftyp") return "video/mp4";
  if (contentType && !(contentType.includes("image/") && /\.(jpeg|jpg|png|webp)(?:\?|$)/i.test(lowerUrl))) return contentType;
  if (/\.(ts|m2ts)(?:\?|$)/i.test(lowerUrl)) return "video/mp2t";
  if (/\.(m4s|mp4)(?:\?|$)/i.test(lowerUrl)) return "video/mp4";
  return contentType || "application/octet-stream";
}

async function checkPlayableSource(sourceUrl: string) {
  if (!sourceUrl.startsWith("http://") && !sourceUrl.startsWith("https://")) {
    return { ok: false, reason: "Source URL is not http(s)" };
  }

  if (sourceUrl.toLowerCase().includes(".m3u8")) {
    const playlist = await fetchTextForHealth(sourceUrl);
    const firstEntry = findFirstPlaylistEntry(playlist.text, sourceUrl);
    if (!firstEntry) return { ok: false, reason: "HLS playlist has no media entries" };
    const mediaUrl = firstEntry.toLowerCase().includes(".m3u8") ? findFirstPlaylistEntry((await fetchTextForHealth(firstEntry)).text, firstEntry) : firstEntry;
    if (!mediaUrl) return { ok: false, reason: "Nested HLS playlist has no segment entries" };
    return probeMediaBytes(mediaUrl);
  }

  return probeMediaBytes(sourceUrl);
}

async function fetchTextForHealth(url: string) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`Fetch failed ${response.status}`);
  return { text: await response.text(), url: response.url || url };
}

function findFirstPlaylistEntry(text: string, playlistUrl: string): string | undefined {
  const line = text
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => item && !item.startsWith("#"));
  return line ? new URL(line, playlistUrl).href : undefined;
}

async function probeMediaBytes(url: string) {
  const response = await fetch(url, {
    headers: { range: "bytes=0-63" },
    redirect: "follow",
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok && response.status !== 206) return { ok: false, reason: `Segment fetch failed ${response.status}`, url };
  const contentType = response.headers.get("content-type") ?? "";
  const bytes = Buffer.from(await response.arrayBuffer());
  const normalized = normalizeMediaContentType(contentType, response.url || url, bytes);
  const ok = normalized.startsWith("video/") || normalized.includes("octet-stream");
  return {
    ok,
    reason: ok ? "Playable media bytes detected" : `Unsupported media bytes: ${contentType || "unknown"}`,
    url,
    contentType,
    normalizedContentType: normalized
  };
}

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

  const isMp4 = item.finalUrl.toLowerCase().includes(".mp4") || item.contentType?.includes("video/mp4");
  if (isMp4) {
    const duration = item.duration;
    if (typeof duration === "number" && duration > 0 && duration < 1200) {
      return false;
    }
  }

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
  allSources = dropNestedHlsChildren(allSources);
  const candidates = allSources.filter((candidate) => candidate.sourceType !== "embed");
  const fallbackEmbeds = allSources.filter((candidate) => candidate.sourceType === "embed");
  const episodes = buildEpisodeCandidates(result.episodes ?? [], candidates);

  return {
    pageUrl: result.startUrl,
    metadata: result.metadata,
    candidates,
    fallbackEmbeds,
    episodes,
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

function dropNestedHlsChildren<T extends { url: string; sourceType: string; probe?: { childPlaylistUrl?: string } }>(sources: T[]): T[] {
  const childPlaylists = new Set(
    sources
      .map((source) => source.probe?.childPlaylistUrl)
      .filter((url): url is string => Boolean(url))
      .map((url) => url.toLowerCase())
  );
  return sources.filter((source) => source.sourceType !== "hls" || !childPlaylists.has(source.url.toLowerCase()));
}

function buildEpisodeCandidates(
  episodes: Array<{ title: string; episodeNumber: number; url: string }>,
  candidates: Array<{ url: string; sourceType: string }>
) {
  return episodes.map((episode) => {
    const playerId = getEmbedId(episode.url);
    const source = playerId ? candidates.find((candidate) => candidate.url.includes(playerId)) : undefined;
    const fallbackSourceType = isEmbedPlayerUrl(episode.url) ? "embed" : "hls";
    return {
      title: episode.title,
      episodeNumber: episode.episodeNumber,
      pageUrl: episode.url,
      sourceUrl: source?.url ?? (isEmbedPlayerUrl(episode.url) ? episode.url : ""),
      sourceType: source?.sourceType ?? fallbackSourceType
    };
  });
}

function isEmbedPlayerUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const value = `${parsed.hostname}${parsed.pathname}`.toLowerCase();
    return value.includes("/embed") || value.includes("player");
  } catch {
    return /\/embed|player/i.test(url);
  }
}

function getEmbedId(url: string): string {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/").filter(Boolean);
    const embedIndex = parts.findIndex((part) => part.toLowerCase() === "embed");
    return embedIndex >= 0 ? parts[embedIndex + 1] ?? "" : parts.at(-1) ?? "";
  } catch {
    return "";
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
    const blockedAdMediaNames = /(^|\/)(ufagool|ufa[^/]*|casino|betflix|sagame)[^/]*\.(mp4|m3u8|webm)(\?|$)/;
    return (
      blockedHosts.some((blocked) => host === blocked || host.includes(blocked)) ||
      /(^|\/)(ads?|banner|promo|pop|preroll)(\/|[-_.])/.test(path) ||
      blockedAdMediaNames.test(path)
    );
  } catch {
    return false;
  }
}
