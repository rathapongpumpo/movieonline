const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");

const root = path.dirname(__dirname);
const dbPath = path.join(root, "site-source-inspector.db");
const outDir = path.join(root, "client", "public", "data");
const posterDir = path.join(root, "client", "public", "posters");
const thumbnailDir = path.join(root, "client", "public", "thumbnails");
const outFile = path.join(outDir, "videos.json");
const seriesOutFile = path.join(outDir, "series.json");

fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(posterDir, { recursive: true });
fs.mkdirSync(thumbnailDir, { recursive: true });

const db = new Database(dbPath, { readonly: true });
const rows = db.prepare("SELECT * FROM videos ORDER BY created_at DESC, id DESC").all();
const seriesRows = db.prepare("SELECT * FROM series ORDER BY updated_at DESC, id DESC").all();
const episodeRows = db.prepare("SELECT * FROM episodes ORDER BY series_id ASC, episode_number ASC, id ASC").all();
db.close();

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  const videos = [];
  let cachedCount = 0;
  for (const row of rows) {
    const id = Number(row.id);
    const title = String(row.title ?? "");
    const remoteThumbnail = String(row.thumbnail ?? "");
    const posterFile = `${id}.svg`;
    fs.writeFileSync(path.join(posterDir, posterFile), buildPosterSvg(title, String(row.category ?? "Uncategorized"), id));
    const cachedThumbnail = await cacheRemoteThumbnail(id, remoteThumbnail);
    if (cachedThumbnail) cachedCount += 1;
    videos.push({
      id,
      title,
      description: String(row.description ?? ""),
      thumbnail: cachedThumbnail || remoteThumbnail,
      remoteThumbnail,
      fallbackThumbnail: `/posters/${posterFile}`,
      category: String(row.category ?? "Uncategorized"),
      pageUrl: String(row.page_url ?? ""),
      sourceUrl: String(row.source_url ?? ""),
      sourceType: String(row.source_type ?? "hls"),
      playbackUrl: String(row.source_url ?? ""),
      duration: row.duration === null || row.duration === undefined ? null : Number(row.duration),
      createdAt: String(row.created_at ?? ""),
      updatedAt: String(row.updated_at ?? "")
    });
  }

  const categoryMap = new Map();
  for (const video of videos) {
    const category = video.category || "Uncategorized";
    categoryMap.set(category, (categoryMap.get(category) ?? 0) + 1);
  }

  fs.writeFileSync(
    outFile,
    JSON.stringify(
      {
        videos,
        total: videos.length,
        categories: [...categoryMap.entries()].map(([name, count]) => ({ name, count }))
      },
      null,
      2
    )
  );

  const series = [];
  let cachedSeriesCount = 0;
  const episodesBySeries = new Map();
  for (const episode of episodeRows) {
    const seriesId = Number(episode.series_id);
    episodesBySeries.set(seriesId, [...(episodesBySeries.get(seriesId) ?? []), episode]);
  }

  for (const row of seriesRows) {
    const id = Number(row.id);
    const title = String(row.title ?? "");
    const remotePoster = String(row.poster ?? "");
    const posterFile = `series-${id}.svg`;
    fs.writeFileSync(path.join(posterDir, posterFile), buildPosterSvg(title, String(row.category ?? "Series"), id + 1000));
    const cachedPoster = await cacheRemoteThumbnail(`series-${id}`, remotePoster);
    if (cachedPoster) cachedSeriesCount += 1;
    series.push({
      id,
      title,
      description: String(row.description ?? ""),
      poster: cachedPoster || remotePoster,
      remotePoster,
      fallbackPoster: `/posters/${posterFile}`,
      category: String(row.category ?? "Series"),
      status: String(row.status ?? "draft"),
      pageUrl: String(row.page_url ?? ""),
      createdAt: String(row.created_at ?? ""),
      updatedAt: String(row.updated_at ?? ""),
      episodes: (episodesBySeries.get(id) ?? []).map((episode) => ({
        id: Number(episode.id),
        seriesId: Number(episode.series_id),
        episodeNumber: Number(episode.episode_number),
        title: String(episode.title ?? ""),
        description: String(episode.description ?? ""),
        thumbnail: String(episode.thumbnail ?? "") || cachedPoster || remotePoster,
        pageUrl: String(episode.page_url ?? ""),
        sourceUrl: String(episode.source_url ?? ""),
        sourceType: String(episode.source_type ?? "hls"),
        status: String(episode.status ?? "draft")
      }))
    });
  }

  const seriesCategoryMap = new Map();
  for (const item of series) {
    const category = item.category || "Series";
    seriesCategoryMap.set(category, (seriesCategoryMap.get(category) ?? 0) + 1);
  }

  fs.writeFileSync(
    seriesOutFile,
    JSON.stringify(
      {
        series,
        total: series.length,
        categories: [...seriesCategoryMap.entries()].map(([name, count]) => ({ name, count }))
      },
      null,
      2
    )
  );

  console.log(
    `Exported ${videos.length} videos to ${path.relative(root, outFile)} (${cachedCount} cached thumbnails), ` +
      `${series.length} series to ${path.relative(root, seriesOutFile)} (${cachedSeriesCount} cached posters)`
  );
}

async function cacheRemoteThumbnail(id, remoteUrl) {
  if (!remoteUrl || !/^https?:\/\//i.test(remoteUrl)) return "";
  try {
    const response = await fetch(remoteUrl, {
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
        accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        referer: new URL(remoteUrl).origin + "/"
      },
      signal: AbortSignal.timeout(12000),
      redirect: "follow"
    });
    const contentType = response.headers.get("content-type") ?? "";
    if (!response.ok || !contentType.startsWith("image/")) return "";
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < 512) return "";
    const ext = extensionFromContentType(contentType) || extensionFromUrl(response.url || remoteUrl) || "jpg";
    const fileName = `${id}.${ext}`;
    fs.writeFileSync(path.join(thumbnailDir, fileName), bytes);
    return `/thumbnails/${fileName}`;
  } catch {
    return "";
  }
}

function extensionFromContentType(contentType) {
  if (contentType.includes("webp")) return "webp";
  if (contentType.includes("png")) return "png";
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return "jpg";
  if (contentType.includes("svg")) return "svg";
  if (contentType.includes("avif")) return "avif";
  return "";
}

function extensionFromUrl(url) {
  try {
    const ext = path.extname(new URL(url).pathname).replace(".", "").toLowerCase();
    return ["webp", "png", "jpg", "jpeg", "svg", "avif"].includes(ext) ? (ext === "jpeg" ? "jpg" : ext) : "";
  } catch {
    return "";
  }
}

function buildPosterSvg(title, category, id) {
  const cleanTitle = stripLeadIn(title)
    .replace(/\s+ดูหนังฟรี\s+หนังHD$/i, "")
    .trim();
  const lines = wrapText(cleanTitle, 20).slice(0, 6);
  const palette = [
    ["#111827", "#dc2626", "#f8fafc"],
    ["#111111", "#b91c1c", "#fef2f2"],
    ["#0f172a", "#2563eb", "#e0f2fe"],
    ["#18181b", "#16a34a", "#dcfce7"],
    ["#1c1917", "#ea580c", "#ffedd5"]
  ][id % 5];
  const titleText = lines
    .map((line, index) => `<text x="32" y="${150 + index * 42}" class="title">${escapeXml(line)}</text>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="360" height="540" viewBox="0 0 360 540" role="img" aria-label="${escapeXml(cleanTitle)}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${palette[0]}"/>
      <stop offset="1" stop-color="#020617"/>
    </linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${palette[1]}"/>
      <stop offset="1" stop-color="#ef4444"/>
    </linearGradient>
    <style>
      .brand { fill: ${palette[2]}; font: 700 18px Arial, sans-serif; letter-spacing: 2px; }
      .title { fill: #fff; font: 800 31px Arial, sans-serif; }
      .meta { fill: #cbd5e1; font: 600 16px Arial, sans-serif; }
    </style>
  </defs>
  <rect width="360" height="540" fill="url(#bg)"/>
  <rect x="0" y="0" width="360" height="8" fill="url(#accent)"/>
  <circle cx="286" cy="82" r="78" fill="${palette[1]}" opacity="0.2"/>
  <circle cx="70" cy="470" r="92" fill="${palette[1]}" opacity="0.16"/>
  <text x="32" y="62" class="brand">MOVIE ONLINE</text>
  <text x="32" y="102" class="meta">${escapeXml(category || "Movie")}</text>
  ${titleText}
  <rect x="32" y="458" width="120" height="4" rx="2" fill="url(#accent)"/>
  <text x="32" y="502" class="meta">WATCH NOW</text>
</svg>`;
}

function stripLeadIn(value) {
  return value.replace(/^ดูหนัง\s+/i, "");
}

function wrapText(value, maxLength) {
  const words = value.split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxLength && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : ["Movie"];
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
