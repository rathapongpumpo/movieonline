import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createVideo, getVideo, listVideos, type VideoInput } from "./db.js";
import { inspectSite, type MediaItem } from "./inspector.js";

const app = express();
const port = Number(process.env.PORT ?? 3000);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(root, "public")));

app.get("/admin", (_req, res) => {
  res.sendFile(path.join(root, "public", "admin.html"));
});

app.get("/watch/:id", (_req, res) => {
  res.sendFile(path.join(root, "public", "watch.html"));
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
    let allSources = uniqueBy(result.media.filter(isPlayableSource), (item) => item.finalUrl).map((item) => ({
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

    res.json({
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
    });
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

app.get("/api/videos", (_req, res) => {
  res.json({ videos: listVideos() });
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
  if (item.displayedAs.toLowerCase().includes("iframe")) return true;
  if (/\/hdr__[^/]+\.bin(?:\?|$)/.test(item.finalUrl)) return false;
  if (/\/s_\d+\.bin(?:\?|$)/.test(item.finalUrl)) return false;
  return isDirectVideoSource(item);
}

function validateVideoInput(value: Record<string, unknown>): VideoInput {
  const title = String(value.title ?? "").trim();
  const sourceUrl = String(value.sourceUrl ?? "").trim();
  const pageUrl = String(value.pageUrl ?? "").trim();
  if (!title) throw new Error("Title is required");
  if (!sourceUrl) throw new Error("Source URL is required");
  if (!pageUrl) throw new Error("Page URL is required");
  return {
    title,
    sourceUrl,
    pageUrl,
    description: String(value.description ?? ""),
    thumbnail: String(value.thumbnail ?? ""),
    sourceType: String(value.sourceType ?? "hls"),
    duration: typeof value.duration === "number" ? value.duration : null
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
