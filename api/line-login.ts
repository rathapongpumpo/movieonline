import { appendLineUser, verifyLineAccessToken } from "../src/lineUsers.js";

type ApiRequest = {
  method?: string;
  body?: { accessToken?: string };
};

type ApiResponse = {
  status: (code: number) => { json: (body: unknown) => void };
};

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const accessToken = String(req.body?.accessToken ?? "");
    if (!accessToken) throw new Error("Missing LINE access token");
    const profile = await verifyLineAccessToken(accessToken);
    await appendLineUser(profile);
    res.status(200).json({ ok: true, profile: { userId: profile.userId, displayName: profile.displayName, pictureUrl: profile.pictureUrl } });
  } catch (error) {
    res.status(401).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}
