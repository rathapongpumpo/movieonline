const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");

const root = path.dirname(__dirname);
const dbPath = path.join(root, "site-source-inspector.db");
const outDir = path.join(root, "client", "public", "data");
const outFile = path.join(outDir, "videos.json");

fs.mkdirSync(outDir, { recursive: true });

const db = new Database(dbPath, { readonly: true });
const rows = db.prepare("SELECT * FROM videos ORDER BY created_at DESC, id DESC").all();
db.close();

const videos = rows.map((row) => ({
  id: Number(row.id),
  title: String(row.title ?? ""),
  description: String(row.description ?? ""),
  thumbnail: String(row.thumbnail ?? ""),
  category: String(row.category ?? "Uncategorized"),
  pageUrl: String(row.page_url ?? ""),
  sourceUrl: String(row.source_url ?? ""),
  sourceType: String(row.source_type ?? "hls"),
  playbackUrl: String(row.source_url ?? ""),
  duration: row.duration === null || row.duration === undefined ? null : Number(row.duration),
  createdAt: String(row.created_at ?? ""),
  updatedAt: String(row.updated_at ?? "")
}));

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
