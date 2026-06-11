import * as React from "react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Hls from "hls.js";
import "./styles.css";

type Candidate = {
  url: string;
  kind: string;
  foundBy: string;
  displayedAs: string;
  sourceType: "hls" | "mp4" | "embed" | string;
  contentType?: string;
};

type InspectResult = {
  pageUrl: string;
  metadata: {
    title: string;
    thumbnail: string;
    description: string;
  };
  candidates: Candidate[];
  fallbackEmbeds: Candidate[];
  warnings: string[];
};

type VideoRecord = {
  id: number;
  title: string;
  description: string;
  thumbnail: string;
  pageUrl: string;
  sourceUrl: string;
  sourceType: string;
  duration: number | null;
};

type SaveState = "idle" | "saving" | "saved" | "error";

function App() {
  const path = window.location.pathname;
  if (path.startsWith("/admin")) return <AdminPage />;
  if (path.startsWith("/watch/")) return <WatchPage />;
  return <CatalogPage />;
}

function AdminPage() {
  const [mode, setMode] = useState<"single" | "bulk">("single");
  const [url, setUrl] = useState("");
  const [limit, setLimit] = useState(12);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("");
  const [results, setResults] = useState<InspectResult[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [selected, setSelected] = useState<Record<number, Candidate | undefined>>({});
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveMessage, setSaveMessage] = useState("");

  const active = results[activeIndex];
  const activeSource = active ? selected[activeIndex] ?? getDefaultSource(active) : undefined;

  async function inspectSingle() {
    if (!url.trim()) return;
    resetRun("Inspecting page...");
    try {
      setProgress(18);
      const response = await fetch("/api/admin/inspect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Inspect failed");
      setProgress(100);
      setResults([data]);
      setActiveIndex(0);
      setSelected({ 0: getDefaultSource(data) });
      setStatus(formatResultStatus(data));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function inspectBulk() {
    if (!url.trim()) return;
    resetRun("Discovering movie pages...");
    const nextResults: InspectResult[] = [];
    try {
      const response = await fetch("/api/admin/bulk-inspect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim(), limit })
      });
      if (!response.body) throw new Error("Streaming response is not available");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line);
          if (typeof event.progress === "number") setProgress(event.progress);
          if (event.message) setStatus(event.message);
          if (event.type === "discovered") setStatus(`Found ${event.total} candidate page(s).`);
          if (event.type === "result") {
            nextResults.push(event.result);
            setResults([...nextResults]);
            setSelected((current) => ({
              ...current,
              [nextResults.length - 1]: getDefaultSource(event.result)
            }));
            setActiveIndex(nextResults.length - 1);
          }
          if (event.type === "error") setStatus(event.error);
          if (event.type === "fatal") throw new Error(event.error);
        }
      }

      setProgress(100);
      setStatus(nextResults.length ? `Completed ${nextResults.length} page(s).` : "No movie pages found.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  function resetRun(message: string) {
    setBusy(true);
    setProgress(4);
    setStatus(message);
    setResults([]);
    setActiveIndex(0);
    setSelected({});
    setSaveState("idle");
    setSaveMessage("");
  }

  async function saveActive() {
    if (!active || !activeSource) return;
    setSaveState("saving");
    setSaveMessage("Saving video...");
    try {
      const response = await fetch("/api/videos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: active.metadata.title,
          description: active.metadata.description,
          thumbnail: active.metadata.thumbnail,
          pageUrl: active.pageUrl,
          sourceUrl: activeSource.url,
          sourceType: activeSource.sourceType,
          duration: null
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Save failed");
      setSaveState("saved");
      setSaveMessage(`Saved. Open /watch/${data.video.id}`);
    } catch (error) {
      setSaveState("error");
      setSaveMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function saveAllReady() {
    const ready = results
      .map((result, index) => ({ result, source: selected[index] ?? getDefaultSource(result) }))
      .filter((item): item is { result: InspectResult; source: Candidate } => Boolean(item.source));
    if (!ready.length) return;

    setSaveState("saving");
    setSaveMessage(`Saving ${ready.length} video(s)...`);
    try {
      for (const item of ready) {
        await fetch("/api/videos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: item.result.metadata.title,
            description: item.result.metadata.description,
            thumbnail: item.result.metadata.thumbnail,
            pageUrl: item.result.pageUrl,
            sourceUrl: item.source.url,
            sourceType: item.source.sourceType,
            duration: null
          })
        });
      }
      setSaveState("saved");
      setSaveMessage(`Saved ${ready.length} video(s).`);
    } catch (error) {
      setSaveState("error");
      setSaveMessage(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <main className="admin-shell">
      <header className="topbar">
        <div>
          <h1>Admin</h1>
          <p>Inspect one page or crawl a site homepage for movie detail pages.</p>
        </div>
        <a className="nav-link" href="/">
          View site
        </a>
      </header>

      <section className="admin-hero">
        <div className="panel import-panel">
          <div className="mode-tabs">
            <button className={mode === "single" ? "active" : ""} onClick={() => setMode("single")}>
              Single URL
            </button>
            <button className={mode === "bulk" ? "active" : ""} onClick={() => setMode("bulk")}>
              Crawl site
            </button>
          </div>
          <div className="inspect-row">
            <input
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder={mode === "single" ? "Paste movie page URL" : "Paste site homepage URL"}
            />
            {mode === "bulk" && (
              <input
                className="limit-input"
                type="number"
                min={1}
                max={50}
                value={limit}
                onChange={(event) => setLimit(Number(event.target.value))}
                title="Max pages"
              />
            )}
            <button disabled={busy} onClick={mode === "single" ? inspectSingle : inspectBulk}>
              Inspect
            </button>
          </div>
          <Progress progress={progress} busy={busy} status={status} />
        </div>

        <div className="panel preview-panel">
          <h2>Preview</h2>
          <Player source={activeSource?.url ?? ""} sourceType={activeSource?.sourceType ?? ""} />
        </div>
      </section>

      <section className="workspace-grid">
        <div className="panel results-panel">
          <div className="panel-head">
            <h2>Inspect Results</h2>
            {results.length > 1 && (
              <button className="subtle-button" onClick={saveAllReady} disabled={saveState === "saving"}>
                Save ready
              </button>
            )}
          </div>
          <div className="result-list">
            {results.length === 0 ? (
              <div className="empty-state">No inspected results yet.</div>
            ) : (
              results.map((result, index) => (
                <ResultCard
                  key={`${result.pageUrl}-${index}`}
                  result={result}
                  active={index === activeIndex}
                  selected={selected[index] ?? getDefaultSource(result)}
                  onClick={() => setActiveIndex(index)}
                  onSelect={(candidate) => setSelected((current) => ({ ...current, [index]: candidate }))}
                />
              ))
            )}
          </div>
        </div>

        <MetadataPanel
          result={active}
          source={activeSource}
          onSave={saveActive}
          disabled={!activeSource || activeSource.sourceType === "embed" || saveState === "saving"}
        />
      </section>

      {saveMessage && <div className={`toast ${saveState}`}>{saveMessage}</div>}
    </main>
  );
}

function Progress({ progress, busy, status }: { progress: number; busy: boolean; status: string }) {
  return (
    <div className="progress-wrap">
      <div className="progress-meta">
        <span>{status || "Ready"}</span>
        <strong>{busy ? `${Math.max(1, Math.min(100, progress))}%` : progress >= 100 ? "100%" : ""}</strong>
      </div>
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} />
      </div>
    </div>
  );
}

function ResultCard({
  result,
  active,
  selected,
  onClick,
  onSelect
}: {
  result: InspectResult;
  active: boolean;
  selected?: Candidate;
  onClick: () => void;
  onSelect: (candidate: Candidate) => void;
}) {
  const sources = [...result.candidates, ...result.fallbackEmbeds];
  return (
    <article className={`result-card ${active ? "active" : ""}`} onClick={onClick}>
      <ImagePreview src={result.metadata.thumbnail} title={result.metadata.title} />
      <div className="result-body">
        <h3>{result.metadata.title || "Untitled"}</h3>
        <p>{result.metadata.description || "No description"}</p>
        <div className="chips">
          <span className={result.candidates.length ? "chip good" : "chip warn"}>
            {result.candidates.length ? `${result.candidates.length} direct` : "no direct"}
          </span>
          {!!result.fallbackEmbeds.length && <span className="chip warn">{result.fallbackEmbeds.length} fallback</span>}
        </div>
        {!!result.warnings.length && <div className="warning-text">{result.warnings.join(" ")}</div>}
        <div className="source-list">
          {sources.map((candidate) => (
            <label key={candidate.url} className="source-row" onClick={(event) => event.stopPropagation()}>
              <input
                type="radio"
                checked={selected?.url === candidate.url}
                onChange={() => onSelect(candidate)}
              />
              <span>{candidate.sourceType}</span>
              <code>{candidate.url}</code>
            </label>
          ))}
        </div>
      </div>
    </article>
  );
}

function MetadataPanel({
  result,
  source,
  onSave,
  disabled
}: {
  result?: InspectResult;
  source?: Candidate;
  onSave: () => void;
  disabled: boolean;
}) {
  return (
    <div className="panel metadata-panel">
      <div className="panel-head">
        <h2>Metadata</h2>
        <button onClick={onSave} disabled={disabled}>
          Save Video
        </button>
      </div>
      {!result ? (
        <div className="empty-state">Select an inspected result.</div>
      ) : (
        <div className="metadata-grid">
          <label>
            Title
            <input readOnly value={result.metadata.title || ""} />
          </label>
          <label>
            Thumbnail
            <input readOnly value={result.metadata.thumbnail || ""} />
          </label>
          <div className="thumb-large">
            <ImagePreview src={result.metadata.thumbnail} title={result.metadata.title} />
          </div>
          <label className="wide">
            Description
            <textarea readOnly value={result.metadata.description || ""} />
          </label>
          <label className="wide">
            Selected Source
            <input readOnly value={source?.url ?? ""} />
          </label>
          <label>
            Source Type
            <input readOnly value={source?.sourceType ?? ""} />
          </label>
          <label>
            Page URL
            <input readOnly value={result.pageUrl} />
          </label>
        </div>
      )}
    </div>
  );
}

function CatalogPage() {
  const [videos, setVideos] = useState<VideoRecord[]>([]);
  const [status, setStatus] = useState("Loading...");

  useEffect(() => {
    fetch("/api/videos")
      .then((response) => response.json())
      .then((data) => {
        setVideos(data.videos || []);
        setStatus(data.videos?.length ? "" : "No videos saved yet.");
      })
      .catch((error) => setStatus(error instanceof Error ? error.message : String(error)));
  }, []);

  return (
    <main className="site-shell">
      <header className="topbar">
        <div>
          <h1>Stream Library</h1>
          <p>Saved videos from your inspector database.</p>
        </div>
        <a className="nav-link" href="/admin">
          Admin
        </a>
      </header>
      <section className="catalog-grid">
        {videos.map((video) => (
          <a className="movie-card" key={video.id} href={`/watch/${video.id}`}>
            <ImagePreview src={video.thumbnail} title={video.title} />
            <strong>{video.title}</strong>
          </a>
        ))}
      </section>
      {status && <div className="empty-state">{status}</div>}
    </main>
  );
}

function WatchPage() {
  const id = window.location.pathname.split("/").filter(Boolean).pop();
  const [video, setVideo] = useState<VideoRecord | undefined>();
  const [status, setStatus] = useState("Loading...");

  useEffect(() => {
    fetch(`/api/videos/${encodeURIComponent(id || "")}`)
      .then((response) => response.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setVideo(data.video);
        setStatus("");
      })
      .catch((error) => setStatus(error instanceof Error ? error.message : String(error)));
  }, [id]);

  return (
    <main className="watch-shell">
      <nav className="watch-nav">
        <a className="nav-link" href="/">
          Back
        </a>
        <a className="nav-link" href="/admin">
          Admin
        </a>
      </nav>
      {video ? (
        <section className="watch-grid">
          <div className="watch-player-panel">
            <Player source={video.sourceUrl} sourceType={video.sourceType} />
          </div>
          <aside className="watch-meta">
            <ImagePreview src={video.thumbnail} title={video.title} />
            <h1>{video.title}</h1>
            <p>{video.description}</p>
          </aside>
        </section>
      ) : (
        <div className="empty-state">{status}</div>
      )}
    </main>
  );
}

function Player({ source, sourceType }: { source: string; sourceType: string }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [status, setStatus] = useState(source ? "Loading player..." : "No source selected.");

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let hls: Hls | undefined;

    video.pause();
    video.removeAttribute("src");
    video.load();

    if (!source) {
      setStatus("No source selected.");
      return;
    }

    if (sourceType === "embed" || source.includes("/embed")) {
      setStatus("Loaded embedded fallback. It may include third-party UI or ads.");
      return;
    }

    const onLoaded = () => setStatus(`Loaded ${video.videoWidth}x${video.videoHeight}, ${formatDuration(video.duration)}.`);
    const onPlaying = () => setStatus(`Playing ${video.videoWidth}x${video.videoHeight}, ${formatDuration(video.duration)}.`);
    const onError = () => setStatus(video.error?.message ? `Playback error: ${video.error.message}` : "Playback error.");
    video.addEventListener("loadedmetadata", onLoaded);
    video.addEventListener("playing", onPlaying);
    video.addEventListener("error", onError);

    if (source.includes(".m3u8") && Hls.isSupported()) {
      hls = new Hls({ debug: false });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) setStatus(`Fatal HLS error: ${data.type} / ${data.details}`);
      });
      hls.loadSource(source);
      hls.attachMedia(video);
      video.play().catch(() => undefined);
    } else {
      video.src = source;
      video.play().catch((error) => setStatus(`Playback failed: ${error.message}`));
    }

    return () => {
      hls?.destroy();
      video.removeEventListener("loadedmetadata", onLoaded);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("error", onError);
    };
  }, [source, sourceType]);

  if (source && (sourceType === "embed" || source.includes("/embed"))) {
    return (
      <div>
        <iframe className="player-frame" src={source} allowFullScreen />
        <div className="player-status">{status}</div>
      </div>
    );
  }

  return (
    <div>
      <video className="player-video" ref={videoRef} controls playsInline />
      <div className="player-status">{status}</div>
    </div>
  );
}

function ImagePreview({ src, title }: { src: string; title: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <div className="image-fallback">No image</div>;
  return <img className="image-preview" src={src} alt={title} referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
}

function getDefaultSource(result: InspectResult): Candidate | undefined {
  return result.candidates[0];
}

function formatResultStatus(result: InspectResult): string {
  if (result.candidates.length === 1) return "Ready to save.";
  if (result.candidates.length > 1) return "Multiple direct video sources found. Select one before saving.";
  if (result.fallbackEmbeds.length) return "No direct video source found. Fallback embed is available.";
  return "No direct video source found.";
}

function formatDuration(value: number) {
  if (!Number.isFinite(value)) return "unknown duration";
  const seconds = Math.round(value);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function useState<T>(initial: T | (() => T)): [T, React.Dispatch<React.SetStateAction<T>>];
function useState<T = undefined>(): [T | undefined, React.Dispatch<React.SetStateAction<T | undefined>>];
function useState<T>(initial?: T | (() => T)) {
  return React.useState(initial);
}

function useEffect(effect: React.EffectCallback, deps?: React.DependencyList) {
  return React.useEffect(effect, deps);
}

function useRef<T>(initial: T) {
  return React.useRef(initial);
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
