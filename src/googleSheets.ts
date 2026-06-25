import { google } from "googleapis";
import type { sheets_v4 } from "googleapis";
import { defaultAdminUsers, type AdminUser } from "./auth.js";
import type { CategorySummary, EpisodeRecord, SeriesRecord, VideoRecord } from "./db.js";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];
export const DEFAULT_GOOGLE_SHEET_ID = "1tmUDB4qbO9gmhCqo2E-djnNydwqmm6nrHGSQz93kpp0";

export type GoogleSheetsExportInput = {
  videos: VideoRecord[];
  series: SeriesRecord[];
  episodes: EpisodeRecord[];
  categories: CategorySummary[];
};

export type GoogleSheetsExportResult = {
  spreadsheetId: string;
  spreadsheetUrl: string;
  videos: number;
  series: number;
  episodes: number;
  categories: number;
  exportedAt: string;
};

type ServiceAccountConfig = {
  spreadsheetId: string;
  clientEmail: string;
  privateKey: string;
};

export async function exportLibraryToGoogleSheets(input: GoogleSheetsExportInput): Promise<GoogleSheetsExportResult> {
  const config = getGoogleSheetsConfig();
  const auth = new google.auth.JWT({
    email: config.clientEmail,
    key: config.privateKey,
    scopes: SCOPES
  });
  const sheets = google.sheets({ version: "v4", auth });
  const exportedAt = new Date().toISOString();
  const spreadsheetId = config.spreadsheetId;

  await ensureSheets(sheets, spreadsheetId, ["Videos", "Series", "Episodes", "Categories", "AdminUsers", "Ads", "LineUsers"]);
  await writeSheet(sheets, spreadsheetId, "Videos", buildVideoRows(input.videos, exportedAt));
  await writeSheet(sheets, spreadsheetId, "Series", buildSeriesRows(input.series, exportedAt));
  await writeSheet(sheets, spreadsheetId, "Episodes", buildEpisodeRows(input.episodes, input.series, exportedAt));
  await writeSheet(sheets, spreadsheetId, "Categories", buildCategoryRows(input, exportedAt));
  await ensureSheetHeader(sheets, spreadsheetId, "AdminUsers", buildAdminUserRows(defaultAdminUsers, exportedAt)[0]);
  await ensureSheetHeader(sheets, spreadsheetId, "Ads", buildAdRows(exportedAt)[0]);
  await ensureSheetHeader(sheets, spreadsheetId, "LineUsers", buildLineUserRows(exportedAt)[0]);

  return {
    spreadsheetId,
    spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
    videos: input.videos.length,
    series: input.series.length,
    episodes: input.episodes.length,
    categories: buildCategorySummaries(input).length,
    exportedAt
  };
}

export async function listGoogleSheetAdminUsers(): Promise<AdminUser[]> {
  const config = getGoogleSheetsConfig();
  const auth = new google.auth.JWT({
    email: config.clientEmail,
    key: config.privateKey,
    scopes: SCOPES
  });
  const sheets = google.sheets({ version: "v4", auth });
  await ensureSheets(sheets, config.spreadsheetId, ["AdminUsers"]);
  await ensureSheetHeader(sheets, config.spreadsheetId, "AdminUsers", buildAdminUserRows(defaultAdminUsers, new Date().toISOString())[0]);

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: config.spreadsheetId,
    range: "'AdminUsers'!A2:D"
  });

  return (response.data.values ?? [])
    .map((row): AdminUser => ({
      username: String(row[0] ?? "").trim(),
      password: String(row[1] ?? "").trim(),
      role: String(row[2] ?? "admin").trim() || "admin",
      active: String(row[3] ?? "TRUE").trim().toLowerCase() !== "false"
    }))
    .filter((user) => user.username && user.password);
}

function getGoogleSheetsConfig(): ServiceAccountConfig {
  const spreadsheetId = String(process.env.GOOGLE_SHEET_ID ?? DEFAULT_GOOGLE_SHEET_ID).trim();

  const jsonConfig = String(process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? "").trim();
  if (jsonConfig) {
    try {
      const parsed = JSON.parse(jsonConfig) as { client_email?: string; private_key?: string };
      if (!parsed.client_email || !parsed.private_key) throw new Error("missing service account fields");
      return {
        spreadsheetId,
        clientEmail: parsed.client_email,
        privateKey: normalizePrivateKey(parsed.private_key)
      };
    } catch {
      throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON ไม่ถูกต้อง");
    }
  }

  const clientEmail = String(process.env.GOOGLE_CLIENT_EMAIL ?? "").trim();
  const privateKey = String(process.env.GOOGLE_PRIVATE_KEY ?? "").trim();
  if (!clientEmail || !privateKey) {
    throw new Error("ยังไม่ได้ตั้งค่า Google service account credential");
  }

  return {
    spreadsheetId,
    clientEmail,
    privateKey: normalizePrivateKey(privateKey)
  };
}

async function ensureSheets(sheets: sheets_v4.Sheets, spreadsheetId: string, sheetNames: string[]) {
  const response = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets(properties(title))" });
  const existing = new Set((response.data.sheets ?? []).map((sheet) => sheet.properties?.title).filter(Boolean));
  const missing = sheetNames.filter((sheetName) => !existing.has(sheetName));
  if (!missing.length) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: missing.map((title) => ({
        addSheet: {
          properties: { title }
        }
      }))
    }
  });
}

async function writeSheet(sheets: sheets_v4.Sheets, spreadsheetId: string, sheetName: string, values: string[][]) {
  const range = `'${sheetName.replace(/'/g, "''")}'!A:Z`;
  await sheets.spreadsheets.values.clear({ spreadsheetId, range });
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${sheetName.replace(/'/g, "''")}'!A1`,
    valueInputOption: "RAW",
    requestBody: { values }
  });
}

async function ensureSheetHeader(sheets: sheets_v4.Sheets, spreadsheetId: string, sheetName: string, header: string[]) {
  const range = `'${sheetName.replace(/'/g, "''")}'!A1:Z1`;
  const response = await sheets.spreadsheets.values.get({ spreadsheetId, range }).catch(() => undefined);
  const current = response?.data.values?.[0] ?? [];
  if (current.length) return;
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${sheetName.replace(/'/g, "''")}'!A1`,
    valueInputOption: "RAW",
    requestBody: { values: [header] }
  });
}

function buildVideoRows(videos: VideoRecord[], exportedAt: string): string[][] {
  return [
    [
      "id",
      "title",
      "category",
      "description",
      "thumbnail",
      "page_url",
      "source_url",
      "source_type",
      "duration",
      "created_at",
      "updated_at",
      "exported_at"
    ],
    ...videos.map((video) => [
      String(video.id),
      video.title,
      video.category,
      video.description,
      video.thumbnail,
      video.pageUrl,
      video.sourceUrl,
      video.sourceType,
      video.duration === null ? "" : String(video.duration),
      video.createdAt,
      video.updatedAt,
      exportedAt
    ])
  ];
}

function buildSeriesRows(series: SeriesRecord[], exportedAt: string): string[][] {
  return [
    ["id", "title", "category", "status", "description", "poster", "page_url", "episode_count", "created_at", "updated_at", "exported_at"],
    ...series.map((item) => [
      String(item.id),
      item.title,
      item.category,
      item.status,
      item.description,
      item.poster,
      item.pageUrl,
      String(item.episodes.length),
      item.createdAt,
      item.updatedAt,
      exportedAt
    ])
  ];
}

function buildEpisodeRows(episodes: EpisodeRecord[], series: SeriesRecord[], exportedAt: string): string[][] {
  const seriesTitleById = new Map(series.map((item) => [item.id, item.title]));
  return [
    [
      "id",
      "series_id",
      "series_title",
      "episode_number",
      "title",
      "status",
      "description",
      "thumbnail",
      "page_url",
      "source_url",
      "source_type",
      "created_at",
      "updated_at",
      "exported_at"
    ],
    ...episodes.map((episode) => [
      String(episode.id),
      String(episode.seriesId),
      seriesTitleById.get(episode.seriesId) ?? "",
      String(episode.episodeNumber),
      episode.title,
      episode.status,
      episode.description,
      episode.thumbnail,
      episode.pageUrl,
      episode.sourceUrl,
      episode.sourceType,
      episode.createdAt,
      episode.updatedAt,
      exportedAt
    ])
  ];
}

function buildCategoryRows(input: GoogleSheetsExportInput, exportedAt: string): string[][] {
  return [
    ["category", "videos", "series", "total", "exported_at"],
    ...buildCategorySummaries(input).map((category) => [
      category.name,
      String(category.videos),
      String(category.series),
      String(category.total),
      exportedAt
    ])
  ];
}

function buildAdminUserRows(users: AdminUser[], exportedAt: string): string[][] {
  return [
    ["username", "password", "role", "active", "exported_at"],
    ...users.map((user) => [user.username, user.password, user.role, user.active ? "TRUE" : "FALSE", exportedAt])
  ];
}

function buildAdRows(exportedAt: string): string[][] {
  return [
    ["slot", "title", "image_url", "target_url", "active", "sort_order", "exported_at"],
    ["top-banner", "", "", "", "FALSE", "10", exportedAt],
    ["pre-player", "", "", "", "FALSE", "20", exportedAt],
    ["sidebar-left", "", "", "", "FALSE", "30", exportedAt],
    ["sidebar-right", "", "", "", "FALSE", "40", exportedAt]
  ];
}

function buildLineUserRows(exportedAt: string): string[][] {
  return [["logged_at", "line_user_id", "display_name", "picture_url", "status_message", "source", "exported_at"], ["", "", "", "", "", "", exportedAt]];
}

function buildCategorySummaries(input: GoogleSheetsExportInput) {
  const map = new Map<string, { name: string; videos: number; series: number; total: number }>();
  for (const category of input.categories) {
    map.set(category.name, { name: category.name, videos: category.count, series: 0, total: category.count });
  }
  for (const item of input.series) {
    const name = item.category || "Uncategorized";
    const row = map.get(name) ?? { name, videos: 0, series: 0, total: 0 };
    row.series += 1;
    row.total = row.videos + row.series;
    map.set(name, row);
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function normalizePrivateKey(value: string): string {
  return value.replace(/\\n/g, "\n");
}
