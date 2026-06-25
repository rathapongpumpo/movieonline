const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");

const root = path.dirname(__dirname);
const dbPath = path.join(root, "site-source-inspector.db");
const outDir = path.join(root, "client", "public", "data");
const posterDir = path.join(root, "client", "public", "posters");
const outFile = path.join(outDir, "videos.json");

fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(posterDir, { recursive: true });

const db = new Database(dbPath, { readonly: true });
const rows = db.prepare("SELECT * FROM videos ORDER BY created_at DESC, id DESC").all();
db.close();

const videos = rows.map((row) => {
  const id = Number(row.id);
  const title = String(row.title ?? "");
  const posterFile = `${id}.svg`;
  fs.writeFileSync(path.join(posterDir, posterFile), buildPosterSvg(title, String(row.category ?? "Uncategorized"), id));
  return {
    id,
    title,
    description: String(row.description ?? ""),
    thumbnail: String(row.thumbnail ?? ""),
    fallbackThumbnail: `/posters/${posterFile}`,
    category: String(row.category ?? "Uncategorized"),
    pageUrl: String(row.page_url ?? ""),
    sourceUrl: String(row.source_url ?? ""),
    sourceType: String(row.source_type ?? "hls"),
    playbackUrl: String(row.source_url ?? ""),
    duration: row.duration === null || row.duration === undefined ? null : Number(row.duration),
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? "")
  };
});

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

console.log(`Exported ${videos.length} videos to ${path.relative(root, outFile)}`);

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
