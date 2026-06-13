import { chromium, type Browser, type Page, type Request, type Response } from "playwright";

export type InspectOptions = {
  maxPages?: number;
};

export type DiscoveredPage = {
  url: string;
  text: string;
  score: number;
};

export type MediaItem = {
  pageUrl: string;
  kind: "image" | "video" | "stream" | "background" | "unknown";
  foundBy: "dom" | "network";
  displayedAs: string;
  source: string;
  finalUrl: string;
  contentType?: string;
  status?: number;
  size?: {
    width?: number;
    height?: number;
  };
  probe?: SourceProbe;
};

export type SourceProbe = {
  playlistUrl: string;
  childPlaylistUrl?: string;
  firstSegmentUrl?: string;
  firstSegmentContentType?: string;
  verdict: "video" | "not-video" | "unknown";
  reason: string;
};

export type LinkItem = {
  pageUrl: string;
  text: string;
  url: string;
  internal: boolean;
};

export type EpisodeCandidate = {
  pageUrl: string;
  title: string;
  episodeNumber: number;
  url: string;
};

export type MenuItem = {
  pageUrl: string;
  area: string;
  text: string;
  url: string;
};

export type PageResult = {
  url: string;
  title: string;
  metadata: PageMetadata;
  media: MediaItem[];
  episodes: EpisodeCandidate[];
  links: LinkItem[];
  menus: MenuItem[];
};

export type PageMetadata = {
  title: string;
  thumbnail: string;
  description: string;
};

export type InspectResult = {
  startUrl: string;
  pagesScanned: number;
  pages: PageResult[];
  metadata: PageMetadata;
  media: MediaItem[];
  episodes: EpisodeCandidate[];
  links: LinkItem[];
  menus: MenuItem[];
  errors: string[];
};

type DomExtraction = {
  title: string;
  metadata: PageMetadata;
  media: Omit<MediaItem, "pageUrl" | "foundBy">[];
  episodes: Omit<EpisodeCandidate, "pageUrl">[];
  links: Omit<LinkItem, "pageUrl" | "internal">[];
  menus: Omit<MenuItem, "pageUrl">[];
};

const IMAGE_TYPES = ["image/"];
const VIDEO_TYPES = ["video/", "application/vnd.apple.mpegurl", "application/x-mpegurl", "application/dash+xml"];
const MEDIA_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg", ".avif", ".mp4", ".webm", ".mov", ".m3u8", ".mpd"];

export async function discoverCandidatePages(rawUrl: string, limit = 24): Promise<DiscoveredPage[]> {
  const startUrl = normalizeInputUrl(rawUrl);
  const start = new URL(startUrl);
  let browser: Browser | undefined;

  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1366, height: 900 },
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36 SiteSourceInspector/0.1"
    });
    const page = await context.newPage();
    await gotoInspectablePage(page, startUrl);

    const links = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]")).map((anchor) => ({
        text: (anchor.innerText || anchor.getAttribute("aria-label") || anchor.title || "").replace(/\s+/g, " ").trim(),
        url: anchor.href || anchor.getAttribute("href") || ""
      }))
    );

    await context.close();

    const candidates = links
      .map((link) => {
        const url = normalizeComparableUrl(resolveUrl(link.url, startUrl));
        return { url, text: cleanText(link.text), score: scoreCandidatePage(url, link.text, start) };
      })
      .filter((link) => link.score > 0)
      .sort((a, b) => b.score - a.score);

    return uniqueBy(candidates, (item) => item.url).slice(0, clamp(limit, 1, 100));
  } finally {
    await browser?.close();
  }
}

export async function inspectSite(rawUrl: string, options: InspectOptions = {}): Promise<InspectResult> {
  const startUrl = normalizeInputUrl(rawUrl);
  const start = new URL(startUrl);
  const maxPages = clamp(options.maxPages ?? 25, 1, 100);

  let browser: Browser | undefined;
  const queue = [startUrl];
  const visited = new Set<string>();
  const errors: string[] = [];
  const pages: PageResult[] = [];

  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1366, height: 900 },
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36 SiteSourceInspector/0.1"
    });

    while (queue.length > 0 && visited.size < maxPages) {
      const pageUrl = queue.shift();
      if (!pageUrl || visited.has(pageUrl)) continue;
      visited.add(pageUrl);

      const page = await context.newPage();
      try {
        const result = await inspectPage(page, pageUrl, start);
        pages.push(result);

        for (const link of result.links) {
          if (!link.internal) continue;
          const normalized = normalizeComparableUrl(link.url);
          if (!visited.has(normalized) && queue.length + visited.size < maxPages) {
            queue.push(normalized);
          }
        }
      } catch (error) {
        errors.push(`${pageUrl}: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        await page.close();
      }
    }

    await context.close();
  } finally {
    await browser?.close();
  }

  return {
    startUrl,
    pagesScanned: pages.length,
    pages,
    metadata: pages[0]?.metadata ?? { title: "", thumbnail: "", description: "" },
    media: uniqueBy(pages.flatMap((page) => page.media), (item) => `${item.pageUrl}|${item.foundBy}|${item.finalUrl}|${item.displayedAs}`),
    episodes: uniqueBy(pages.flatMap((page) => page.episodes), (item) => `${item.episodeNumber}|${item.url}`),
    links: uniqueBy(pages.flatMap((page) => page.links), (item) => `${item.pageUrl}|${item.url}|${item.text}`),
    menus: uniqueBy(pages.flatMap((page) => page.menus), (item) => `${item.pageUrl}|${item.area}|${item.url}|${item.text}`),
    errors
  };
}

async function inspectPage(page: Page, pageUrl: string, start: URL): Promise<PageResult> {
  const networkMedia: MediaItem[] = [];

  page.on("response", async (response: Response) => {
    const request = response.request();
    const contentType = response.headers()["content-type"] ?? "";
    const url = response.url();
    if (!looksLikeMedia(request, response, contentType)) return;

    networkMedia.push({
      pageUrl,
      kind: classifyMedia(url, contentType, request.resourceType()),
      foundBy: "network",
      displayedAs: request.resourceType(),
      source: url,
      finalUrl: url,
      contentType,
      status: response.status()
    });
  });

  await gotoInspectablePage(page, pageUrl);
  await page.evaluate("globalThis.__name = globalThis.__name || ((fn) => fn)");
  await activatePlayers(page);

  const extracted = await extractDom(page);
  const media: MediaItem[] = [
    ...extracted.media.map((item) => ({
      ...item,
      pageUrl,
      foundBy: "dom" as const,
      finalUrl: resolveUrl(item.finalUrl || item.source, pageUrl)
    })),
    ...networkMedia
  ];
  const enrichedMedia = await Promise.all(media.map(enrichMediaSource));

  const links = extracted.links
    .map((link) => {
      const url = resolveUrl(link.url, pageUrl);
      return {
        pageUrl,
        text: cleanText(link.text),
        url: normalizeComparableUrl(url),
        internal: isInternalUrl(url, start)
      };
    })
    .filter((link) => link.url.startsWith("http"));

  const menus = extracted.menus
    .map((menu) => ({
      pageUrl,
      area: menu.area,
      text: cleanText(menu.text),
      url: normalizeComparableUrl(resolveUrl(menu.url, pageUrl))
    }))
    .filter((menu) => menu.url.startsWith("http"));

  return {
    url: pageUrl,
    title: extracted.title,
    metadata: extracted.metadata,
    media: uniqueBy(enrichedMedia, (item) => `${item.foundBy}|${item.finalUrl}|${item.displayedAs}`),
    episodes: uniqueBy(
      extracted.episodes.map((episode) => ({
        ...episode,
        pageUrl
      })),
      (item) => `${item.episodeNumber}|${item.url}`
    ),
    links: uniqueBy(links, (item) => `${item.url}|${item.text}`),
    menus: uniqueBy(menus, (item) => `${item.area}|${item.url}|${item.text}`)
  };
}

async function extractDom(page: Page): Promise<DomExtraction> {
  return page.evaluate(() => {
    const absoluteUrl = (value: string) => {
      try {
        return new URL(value, document.baseURI).href;
      } catch {
        return value;
      }
    };

    const parseSrcset = (srcset: string) =>
      srcset
        .split(",")
        .map((part) => part.trim().split(/\s+/)[0])
        .filter(Boolean)
        .map(absoluteUrl);

    const parseCssUrls = (value: string) => {
      const urls: string[] = [];
      const pattern = /url\((['"]?)(.*?)\1\)/g;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(value))) {
        if (match[2] && !match[2].startsWith("data:")) urls.push(absoluteUrl(match[2]));
      }
      return urls;
    };

    const media: DomExtraction["media"] = [];
    const getMeta = (selector: string) => document.querySelector(selector)?.getAttribute("content")?.trim() || "";
    const getMetaUrl = (selector: string) => {
      const value = getMeta(selector);
      return value ? absoluteUrl(value) : "";
    };
    const pushDirectSource = (source: string, displayedAs: string) => {
      const lowerSource = source.toLowerCase();
      if (!lowerSource.includes(".m3u8") && !lowerSource.includes(".mpd") && !lowerSource.includes(".mp4")) return;
      media.push({
        kind: lowerSource.includes(".m3u8") || lowerSource.includes(".mpd") ? "stream" : "video",
        displayedAs,
        source,
        finalUrl: absoluteUrl(source)
      });
    };

    document.querySelectorAll("img").forEach((img) => {
      const element = img as HTMLImageElement;
      const source = element.currentSrc || element.src || element.getAttribute("src") || "";
      if (!source) return;
      media.push({
        kind: "image",
        displayedAs: "img",
        source,
        finalUrl: absoluteUrl(source),
        size: { width: element.naturalWidth || undefined, height: element.naturalHeight || undefined }
      });
      const srcset = element.getAttribute("srcset");
      if (srcset) {
        parseSrcset(srcset).forEach((url) =>
          media.push({ kind: "image", displayedAs: "img[srcset]", source: url, finalUrl: url })
        );
      }
    });

    document.querySelectorAll("picture source, video source").forEach((sourceElement) => {
      const src = sourceElement.getAttribute("src") || sourceElement.getAttribute("srcset") || "";
      if (!src) return;
      parseSrcset(src).forEach((url) => {
        const lowerUrl = url.toLowerCase();
        media.push({
          kind: lowerUrl.includes(".m3u8") || lowerUrl.includes(".mpd") ? "stream" : sourceElement.closest("video") ? "video" : "image",
          displayedAs: sourceElement.closest("video") ? "video source" : "picture source",
          source: url,
          finalUrl: url
        });
      });
    });

    document.querySelectorAll("video").forEach((video) => {
      const element = video as HTMLVideoElement;
      const source = element.currentSrc || element.src || element.getAttribute("src") || "";
      if (source) {
        const lowerSource = source.toLowerCase();
        media.push({
          kind: lowerSource.includes(".m3u8") || lowerSource.includes(".mpd") ? "stream" : "video",
          displayedAs: "video",
          source,
          finalUrl: absoluteUrl(source),
          size: { width: element.videoWidth || undefined, height: element.videoHeight || undefined }
        });
      }
      const poster = element.getAttribute("poster");
      if (poster) {
        media.push({
          kind: "image",
          displayedAs: "video poster",
          source: poster,
          finalUrl: absoluteUrl(poster)
        });
      }
    });

    document.querySelectorAll("iframe[src]").forEach((iframe) => {
      const element = iframe as HTMLIFrameElement;
      const source =
        element.src ||
        element.getAttribute("src") ||
        element.getAttribute("data-original-src") ||
        element.getAttribute("data-real") ||
        element.getAttribute("data-src") ||
        "";
      if (!source || source === "about:blank") return;
      const lowerSource = source.toLowerCase();
      if (lowerSource.includes(".m3u8") || lowerSource.includes(".mpd")) {
        media.push({
          kind: "stream",
          displayedAs: "iframe source",
          source,
          finalUrl: absoluteUrl(source)
        });
        return;
      }
      const looksVideoEmbed =
        lowerSource.includes("/embed") ||
        lowerSource.includes("player") ||
        lowerSource.includes("youtube.com") ||
        lowerSource.includes("youtu.be") ||
        lowerSource.includes("vimeo.com");
      if (!looksVideoEmbed) return;
      media.push({
        kind: "video",
        displayedAs: "iframe embed",
        source,
        finalUrl: absoluteUrl(source)
      });
    });

    document.querySelectorAll("[onclick]").forEach((element) => {
      const onclick = element.getAttribute("onclick") || "";
      const matches = onclick.match(/https?:\/\/[^'")\s]+?\.(?:m3u8|mpd|mp4)(?=$|[?'")\s])(?:\?[^'")\s]*)?/gi) || [];
      matches.forEach((url) => pushDirectSource(url, "inline onclick"));
    });

    document.querySelectorAll("script").forEach((script) => {
      const text = script.textContent || "";
      const matches = text.match(/https?:\/\/[^'")\s]+?\.(?:m3u8|mpd|mp4)(?=$|[?'")\s])(?:\?[^'")\s]*)?/gi) || [];
      matches.forEach((url) => pushDirectSource(url, "inline script"));
    });

    document.querySelectorAll<HTMLElement>("*").forEach((element) => {
      const background = getComputedStyle(element).backgroundImage;
      if (!background || background === "none") return;
      parseCssUrls(background).forEach((url) => {
        media.push({ kind: "background", displayedAs: "css background", source: url, finalUrl: url });
      });
    });

    const links = Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]")).map((anchor) => ({
      text: anchor.innerText || anchor.getAttribute("aria-label") || anchor.title || "",
      url: anchor.href || anchor.getAttribute("href") || ""
    }));

    const episodes = Array.from(document.querySelectorAll<HTMLElement>("[data-link], [data-episode], a[href]"))
      .map((element) => {
        const text = (element.innerText || element.getAttribute("aria-label") || element.title || "").replace(/\s+/g, " ").trim();
        const rawUrl =
          element.getAttribute("data-link") ||
          element.getAttribute("data-url") ||
          element.getAttribute("data-src") ||
          element.getAttribute("href") ||
          "";
        const episodeMatch = text.match(/\bEP\.?\s*(\d+)\b/i);
        if (!episodeMatch || !rawUrl) return undefined;
        const url = absoluteUrl(rawUrl);
        const lowerUrl = url.toLowerCase();
        if (!lowerUrl.includes("/embed") && !lowerUrl.includes("player") && !lowerUrl.includes(".m3u8") && !lowerUrl.includes(".mp4")) {
          return undefined;
        }
        return {
          title: text,
          episodeNumber: Number(episodeMatch[1]),
          url
        };
      })
      .filter((episode): episode is { title: string; episodeNumber: number; url: string } => Boolean(episode))
      .sort((a, b) => a.episodeNumber - b.episodeNumber);

    const menuAreas = Array.from(document.querySelectorAll<HTMLElement>("header, nav, footer, [role='navigation']"));
    const menus = menuAreas.flatMap((area) => {
      const areaName = area.tagName.toLowerCase() === "nav" ? "nav" : area.tagName.toLowerCase();
      return Array.from(area.querySelectorAll<HTMLAnchorElement>("a[href]")).map((anchor) => ({
        area: area.getAttribute("aria-label") || areaName,
        text: anchor.innerText || anchor.getAttribute("aria-label") || anchor.title || "",
        url: anchor.href || anchor.getAttribute("href") || ""
      }));
    });

    return {
      title: document.title,
      metadata: {
        title: getMeta("meta[property='og:title']") || getMeta("meta[name='twitter:title']") || document.title,
        thumbnail: getMetaUrl("meta[property='og:image']") || getMetaUrl("meta[name='twitter:image']"),
        description: getMeta("meta[property='og:description']") || getMeta("meta[name='description']") || getMeta("meta[name='twitter:description']")
      },
      media,
      episodes,
      links,
      menus
    };
  });
}

async function gotoInspectablePage(page: Page, url: string) {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  } catch (error) {
    await page.goto(url, { waitUntil: "commit", timeout: 45000 }).catch(() => {
      throw error;
    });
  }
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
}

async function activatePlayers(page: Page): Promise<void> {
  const selectors = [
    "video",
    ".jwplayer",
    ".plyr",
    ".vjs-big-play-button",
    "button[aria-label*='Play' i]",
    "[class*='play' i]",
    "#player",
    "iframe"
  ];

  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    const count = await locator.count().catch(() => 0);
    if (count < 1) continue;
    await locator.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => undefined);
    await locator.click({ timeout: 2500, force: true }).catch(() => undefined);
    await page.waitForTimeout(1200);
  }

  await page.keyboard.press("Space").catch(() => undefined);
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
  await page.waitForTimeout(7000);
}

function normalizeInputUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) throw new Error("URL is required");
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return normalizeComparableUrl(withProtocol);
}

function normalizeComparableUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    url.hash = "";
    if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "");
    return url.href;
  } catch {
    return rawUrl;
  }
}

function resolveUrl(value: string, base: string): string {
  try {
    return new URL(value, base).href;
  } catch {
    return value;
  }
}

function isInternalUrl(rawUrl: string, start: URL): boolean {
  try {
    const url = new URL(rawUrl);
    return url.hostname === start.hostname || url.hostname.endsWith(`.${start.hostname}`);
  } catch {
    return false;
  }
}

function looksLikeMedia(request: Request, response: Response, contentType: string): boolean {
  const resourceType = request.resourceType();
  const url = response.url().toLowerCase();
  return (
    resourceType === "image" ||
    resourceType === "media" ||
    IMAGE_TYPES.some((type) => contentType.includes(type)) ||
    VIDEO_TYPES.some((type) => contentType.includes(type)) ||
    MEDIA_EXTENSIONS.some((extension) => url.includes(extension))
  );
}

function classifyMedia(url: string, contentType: string, resourceType: string): MediaItem["kind"] {
  const lowerUrl = url.toLowerCase();
  if (contentType.includes("image/") || resourceType === "image") return "image";
  if (lowerUrl.includes(".m3u8") || lowerUrl.includes(".mpd") || contentType.includes("mpegurl") || contentType.includes("dash+xml")) return "stream";
  if (contentType.includes("video/") || resourceType === "media") return "video";
  if (MEDIA_EXTENSIONS.some((extension) => lowerUrl.includes(extension))) return lowerUrl.match(/\.(jpg|jpeg|png|webp|gif|svg|avif)/) ? "image" : "video";
  return "unknown";
}

async function enrichMediaSource(item: MediaItem): Promise<MediaItem> {
  if (!item.finalUrl.toLowerCase().includes(".m3u8")) return item;

  const probe = await probeHlsSource(item.finalUrl).catch((error): SourceProbe => ({
    playlistUrl: item.finalUrl,
    verdict: "unknown",
    reason: error instanceof Error ? error.message : String(error)
  }));

  return { ...item, probe };
}

async function probeHlsSource(playlistUrl: string): Promise<SourceProbe> {
  const playlist = await fetchText(playlistUrl);
  const entries = parsePlaylistEntries(playlist, playlistUrl);
  const childPlaylistUrl = entries.find((url) => url.toLowerCase().includes(".m3u8"));

  if (!childPlaylistUrl) {
    const firstSegmentUrl = entries[0];
    if (!firstSegmentUrl) {
      return {
        playlistUrl,
        verdict: "unknown",
        reason: "Playlist has no child playlist or segment entries"
      };
    }
    return probeSegment(playlistUrl, undefined, firstSegmentUrl);
  }

  const childPlaylist = await fetchText(childPlaylistUrl);
  const childEntries = parsePlaylistEntries(childPlaylist, childPlaylistUrl);
  const firstSegmentUrl = childEntries.find((url) => !url.toLowerCase().includes(".m3u8"));
  if (!firstSegmentUrl) {
    return {
      playlistUrl,
      childPlaylistUrl,
      verdict: "unknown",
      reason: "Child playlist has no segment entries"
    };
  }

  return probeSegment(playlistUrl, childPlaylistUrl, firstSegmentUrl);
}

async function probeSegment(playlistUrl: string, childPlaylistUrl: string | undefined, firstSegmentUrl: string): Promise<SourceProbe> {
  const response = await fetch(firstSegmentUrl, {
    headers: { range: "bytes=0-31" },
    redirect: "follow"
  });
  const contentType = response.headers.get("content-type") ?? "";
  const bytes = new Uint8Array(await response.arrayBuffer());
  const lowerUrl = firstSegmentUrl.toLowerCase();

  if (contentType.includes("image/") || startsWith(bytes, [0x89, 0x50, 0x4e, 0x47])) {
    return {
      playlistUrl,
      childPlaylistUrl,
      firstSegmentUrl,
      firstSegmentContentType: contentType,
      verdict: "unknown",
      reason: "First segment is served as an image; try the player test because some HLS sources disguise segments"
    };
  }

  if (
    lowerUrl.endsWith(".ts") ||
    lowerUrl.endsWith(".m4s") ||
    contentType.includes("video/") ||
    contentType.includes("mp2t") ||
    contentType.includes("octet-stream") ||
    startsWith(bytes, [0x00, 0x00, 0x00]) ||
    bytes[0] === 0x47
  ) {
    return {
      playlistUrl,
      childPlaylistUrl,
      firstSegmentUrl,
      firstSegmentContentType: contentType,
      verdict: "video",
      reason: "First segment looks like a playable video segment"
    };
  }

  return {
    playlistUrl,
    childPlaylistUrl,
    firstSegmentUrl,
    firstSegmentContentType: contentType,
    verdict: "unknown",
    reason: "Segment type could not be confirmed from headers or magic bytes"
  };
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`Fetch failed ${response.status} for ${url}`);
  return response.text();
}

function parsePlaylistEntries(text: string, baseUrl: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => resolveUrl(line, baseUrl));
}

function startsWith(bytes: Uint8Array, prefix: number[]): boolean {
  return prefix.every((byte, index) => bytes[index] === byte);
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function scoreCandidatePage(rawUrl: string, text: string, start: URL): number {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return 0;
  }

  if (!isInternalUrl(url.href, start)) return 0;
  if (url.pathname === "/" || url.pathname === "") return 0;
  if (url.searchParams.size > 0) return 0;
  if (/\.(jpg|jpeg|png|gif|webp|svg|css|js|json|xml|mp4|m3u8|mpd|zip|rar|pdf)$/i.test(url.pathname)) return 0;

  const lowerPath = url.pathname.toLowerCase();
  const blocked = ["/category/", "/tag/", "/author/", "/page/", "/search", "/wp-", "/feed", "/privacy", "/contact", "/terms", "/login"];
  if (blocked.some((part) => lowerPath.includes(part))) return 0;

  const segments = url.pathname.split("/").filter(Boolean);
  let score = 10;
  if (segments.length === 1) score += 20;
  if (/(19|20)\d{2}/.test(url.pathname) || /(19|20)\d{2}/.test(text)) score += 25;
  if (text.trim().length > 0) score += 10;
  if (/ดู|หนัง|movie|film|episode|ซีรี/.test(text.toLowerCase())) score += 5;
  if (segments.length > 3) score -= 20;

  return score;
}
