import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { google } from "googleapis";
import { DEFAULT_GOOGLE_SHEET_ID } from "./googleSheets.js";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export type LineProfile = {
  userId: string;
  displayName: string;
  pictureUrl: string;
  statusMessage: string;
};

export async function verifyLineAccessToken(accessToken: string): Promise<LineProfile> {
  const verifyResponse = await fetch(`https://api.line.me/oauth2/v2.1/verify?access_token=${encodeURIComponent(accessToken)}`);
  if (!verifyResponse.ok) throw new Error("LINE token verify failed");
  const verifyData = (await verifyResponse.json()) as { client_id?: string; expires_in?: number };
  const expectedChannelId = String(process.env.LINE_CHANNEL_ID ?? "2010511616").trim();
  if (expectedChannelId && String(verifyData.client_id ?? "") !== expectedChannelId) {
    throw new Error("LINE token channel mismatch");
  }

  const profileResponse = await fetch("https://api.line.me/v2/profile", {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!profileResponse.ok) throw new Error("LINE profile fetch failed");
  const profile = (await profileResponse.json()) as Partial<LineProfile>;
  if (!profile.userId) throw new Error("LINE profile missing userId");
  return {
    userId: String(profile.userId),
    displayName: String(profile.displayName ?? ""),
    pictureUrl: String(profile.pictureUrl ?? ""),
    statusMessage: String(profile.statusMessage ?? "")
  };
}

export async function appendLineUser(profile: LineProfile) {
  const config = getGoogleConfig();
  const auth = new google.auth.JWT({
    email: config.clientEmail,
    key: config.privateKey,
    scopes: SCOPES
  });
  const sheets = google.sheets({ version: "v4", auth });
  await ensureLineUsersSheet(sheets, config.spreadsheetId);
  await sheets.spreadsheets.values.append({
    spreadsheetId: config.spreadsheetId,
    range: "'LineUsers'!A:F",
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [[new Date().toISOString(), profile.userId, profile.displayName, profile.pictureUrl, profile.statusMessage, "LIFF"]]
    }
  });
}

async function ensureLineUsersSheet(sheets: ReturnType<typeof google.sheets>, spreadsheetId: string) {
  const response = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets(properties(title))" });
  const exists = (response.data.sheets ?? []).some((sheet) => sheet.properties?.title === "LineUsers");
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: "LineUsers" } } }] }
    });
  }
  const header = await sheets.spreadsheets.values.get({ spreadsheetId, range: "'LineUsers'!A1:F1" }).catch(() => undefined);
  if (!header?.data.values?.[0]?.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: "'LineUsers'!A1",
      valueInputOption: "RAW",
      requestBody: { values: [["logged_at", "line_user_id", "display_name", "picture_url", "status_message", "source"]] }
    });
  }
}

function getGoogleConfig() {
  const spreadsheetId = String(process.env.GOOGLE_SHEET_ID ?? DEFAULT_GOOGLE_SHEET_ID).trim();
  const jsonConfig = String(process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? "").trim();
  if (jsonConfig) {
    const parsed = JSON.parse(jsonConfig) as { client_email?: string; private_key?: string };
    if (!parsed.client_email || !parsed.private_key) throw new Error("Google service account JSON missing fields");
    return { spreadsheetId, clientEmail: parsed.client_email, privateKey: normalizePrivateKey(parsed.private_key) };
  }

  const filePath = path.join(root, "ServiceAccountKey.json");
  if (fs.existsSync(filePath)) {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as { client_email?: string; private_key?: string };
    if (!parsed.client_email || !parsed.private_key) throw new Error("ServiceAccountKey.json missing fields");
    return { spreadsheetId, clientEmail: parsed.client_email, privateKey: normalizePrivateKey(parsed.private_key) };
  }

  const clientEmail = String(process.env.GOOGLE_CLIENT_EMAIL ?? "").trim();
  const privateKey = String(process.env.GOOGLE_PRIVATE_KEY ?? "").trim();
  if (!clientEmail || !privateKey) throw new Error("Google service account credential is not configured");
  return { spreadsheetId, clientEmail, privateKey: normalizePrivateKey(privateKey) };
}

function normalizePrivateKey(value: string): string {
  return value.replace(/\\n/g, "\n");
}
