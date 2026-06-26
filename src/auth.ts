import crypto from "node:crypto";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

export type AdminUser = {
  username: string;
  password: string;
  role: string;
  active: boolean;
};

const COOKIE_NAME = "ssi_admin";
const DEFAULT_SECRET = "site-source-inspector-local-secret";
const SESSION_TTL_MS = 1000 * 60 * 60 * 12;

const usersFilePath = path.join(process.cwd(), "data", "users.json");

export const defaultAdminUsers: AdminUser[] = [
  {
    username: "rpumpo",
    password: "Z24312433z",
    role: "owner",
    active: true
  }
];

export function getAdminUsersSync(): AdminUser[] {
  try {
    if (fs.existsSync(usersFilePath)) {
      const data = JSON.parse(fs.readFileSync(usersFilePath, "utf8"));
      if (Array.isArray(data)) {
        return data;
      }
    }
  } catch (err) {
    console.error("Failed to read users.json:", err);
  }
  return defaultAdminUsers;
}

export function createSessionCookie(username: string): string {
  const issuedAt = Date.now();
  const payload = Buffer.from(JSON.stringify({ username, issuedAt })).toString("base64url");
  const signature = sign(payload);
  const isProd = process.env.NODE_ENV === "production" || !!process.env.VERCEL;
  const secureFlag = isProd ? "; Secure" : "";
  return `${COOKIE_NAME}=${payload}.${signature}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${secureFlag}`;
}

export function clearSessionCookie(): string {
  return `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

export function getSessionUser(cookieHeader: string | undefined): string | undefined {
  const token = parseCookies(cookieHeader)[COOKIE_NAME];
  if (!token) return undefined;
  const [payload, signature] = token.split(".");
  if (!payload || !signature || sign(payload) !== signature) return undefined;

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { username?: string; issuedAt?: number };
    if (!parsed.username || !parsed.issuedAt) return undefined;
    if (Date.now() - parsed.issuedAt > SESSION_TTL_MS) return undefined;
    return parsed.username;
  } catch {
    return undefined;
  }
}

export function validateAdminCredentials(users: AdminUser[], username: string, password: string): AdminUser | undefined {
  return users.find((user) => user.active && user.username === username && user.password === password);
}

function sign(payload: string): string {
  const secret = process.env.ADMIN_SESSION_SECRET || DEFAULT_SECRET;
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of (cookieHeader ?? "").split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (!name || !rest.length) continue;
    cookies[name] = rest.join("=");
  }
  return cookies;
}
