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
  category: string;
  pageUrl: string;
  sourceUrl: string;
  sourceType: string;
  duration: number | null;
};

type VideoForm = {
  title: string;
  description: string;
  thumbnail: string;
  category: string;
  pageUrl: string;
  sourceUrl: string;
  sourceType: string;
};

type SaveState = "idle" | "saving" | "saved" | "error";

const emptyForm: VideoForm = {
  title: "",
  description: "",
  thumbnail: "",
  category: "Uncategorized",
  pageUrl: "",
  sourceUrl: "",
  sourceType: "hls"
};

function App() {
  const path = window.location.pathname;
  if (path.startsWith("/admin")) return <AdminPage />;
  if (path.startsWith("/watch/")) return <WatchPage />;
  return <CatalogPage />;
}

function AdminPage() {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("");
  const [inspectResult, setInspectResult] = useState<InspectResult | undefined>();
  const [selectedSource, setSelectedSource] = useState<Candidate | undefined>();
  const [form, setForm] = useState<VideoForm>(emptyForm);
  const [videos, setVideos] = useState<VideoRecord[]>([]);
  const [editingId, setEditingId] = useState<number | undefined>();
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveMessage, setSaveMessage] = useState("");

  useEffect(() => {
    loadVideos();
  }, []);

  async function loadVideos() {
    const response = await fetch("/api/videos");
    const data = await response.json();
    setVideos(data.videos || []);
  }

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

      const source = getDefaultSource(data);
      setProgress(100);
      setInspectResult(data);
      setSelectedSource(source);
      setForm({
        title: data.metadata.title || "",
        description: data.metadata.description || "",
        thumbnail: data.metadata.thumbnail || "",
        category: inferCategory(data.metadata.title, data.metadata.description),
        pageUrl: data.pageUrl || url.trim(),
        sourceUrl: source?.url ?? "",
        sourceType: source?.sourceType ?? "hls"
      });
      setEditingId(undefined);
      setStatus(formatResultStatus(data));
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
    setInspectResult(undefined);
    setSelectedSource(undefined);
    setSaveState("idle");
    setSaveMessage("");
  }

  function startNew() {
    setUrl("");
    setProgress(0);
    setStatus("");
    setInspectResult(undefined);
    setSelectedSource(undefined);
    setForm(emptyForm);
    setEditingId(undefined);
    setSaveState("idle");
    setSaveMessage("");
  }

  function selectSource(candidate: Candidate) {
    setSelectedSource(candidate);
    setForm((current) => ({
      ...current,
      sourceUrl: candidate.url,
      sourceType: candidate.sourceType
    }));
  }

  async function saveVideo() {
    setSaveState("saving");
    setSaveMessage(editingId ? "Updating video..." : "Saving video...");
    try {
      const response = await fetch(editingId ? `/api/videos/${editingId}` : "/api/videos", {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Save failed");
      await loadVideos();
      setEditingId(data.video.id);
      setSaveState("saved");
      setSaveMessage(editingId ? "Updated." : `Saved. Open /watch/${data.video.id}`);
    } catch (error) {
      setSaveState("error");
      setSaveMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function deleteVideoRecord(video: VideoRecord) {
    if (!window.confirm(`Delete "${video.title}"?`)) return;
    const response = await fetch(`/api/videos/${video.id}`, { method: "DELETE" });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setSaveState("error");
      setSaveMessage(data.error || "Delete failed");
      return;
    }
    await loadVideos();
    if (editingId === video.id) startNew();
    setSaveState("saved");
    setSaveMessage("Deleted.");
  }

  function editVideo(video: VideoRecord) {
    setEditingId(video.id);
    setInspectResult(undefined);
    setSelectedSource({
      url: video.sourceUrl,
      kind: "video",
      foundBy: "dom",
      displayedAs: video.sourceType,
      sourceType: video.sourceType
    });
    setForm({
      title: video.title,
      description: video.description,
      thumbnail: video.thumbnail,
      category: video.category || "Uncategorized",
      pageUrl: video.pageUrl,
      sourceUrl: video.sourceUrl,
      sourceType: video.sourceType
    });
    setProgress(0);
    setStatus("Editing saved video.");
    setSaveState("idle");
    setSaveMessage("");
  }

  const sources = inspectResult ? [...inspectResult.candidates, ...inspectResult.fallbackEmbeds] : [];
  const canSave = Boolean(form.title.trim() && form.pageUrl.trim() && form.sourceUrl.trim() && form.sourceType !== "embed" && saveState !== "saving");

  return (
    <main className="admin-shell">
      <header className="topbar">
        <div>
          <h1>Admin</h1>
          <p>Inspect one movie page, confirm metadata, then save or edit the library.</p>
        </div>
        <a className="nav-link" href="/">
          View site
        </a>
      </header>

      <section className="admin-hero single-admin">
        <div className="panel import-panel">
          <div className="panel-head">
            <h2>Import</h2>
            <button className="subtle-button" onClick={startNew}>
              New
            </button>
          </div>
          <div className="inspect-row">
            <input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="Paste movie page URL" />
            <button disabled={busy} onClick={inspectSingle}>
              Inspect
            </button>
          </div>
          <Progress progress={progress} busy={busy} status={status} />
          {inspectResult && (
            <SourcePicker
              result={inspectResult}
              sources={sources}
              selected={selectedSource}
              onSelect={selectSource}
            />
          )}
        </div>

        <div className="panel preview-panel">
          <h2>Preview</h2>
          <Player source={form.sourceUrl} sourceType={form.sourceType} />
        </div>
      </section>

      <section className="workspace-grid admin-workspace">
        <VideoFormPanel
          form={form}
          editingId={editingId}
          onChange={setForm}
          onSave={saveVideo}
          canSave={canSave}
        />
        <VideoManager videos={videos} activeId={editingId} onEdit={editVideo} onDelete={deleteVideoRecord} />
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

function SourcePicker({
  result,
  sources,
  selected,
  onSelect
}: {
  result: InspectResult;
  sources: Candidate[];
  selected?: Candidate;
  onSelect: (candidate: Candidate) => void;
}) {
  return (
    <div className="source-picker">
      <div className="chips">
        <span className={result.candidates.length ? "chip good" : "chip warn"}>
          {result.candidates.length ? `${result.candidates.length} direct` : "no direct"}
        </span>
        {!!result.fallbackEmbeds.length && <span className="chip warn">{result.fallbackEmbeds.length} fallback</span>}
      </div>
      {!!result.warnings.length && <div className="warning-text">{result.warnings.join(" ")}</div>}
      <div className="source-list">
        {sources.length === 0 ? (
          <div className="empty-state small">No source found.</div>
        ) : (
          sources.map((candidate) => (
            <label key={candidate.url} className="source-row">
              <input type="radio" checked={selected?.url === candidate.url} onChange={() => onSelect(candidate)} />
              <span>{candidate.sourceType}</span>
              <code>{candidate.url}</code>
            </label>
          ))
        )}
      </div>
    </div>
  );
}

function VideoFormPanel({
  form,
  editingId,
  onChange,
  onSave,
  canSave
}: {
  form: VideoForm;
  editingId?: number;
  onChange: (form: VideoForm) => void;
  onSave: () => void;
  canSave: boolean;
}) {
  const update = (key: keyof VideoForm, value: string) => onChange({ ...form, [key]: value });
  return (
    <div className="panel metadata-panel">
      <div className="panel-head">
        <h2>{editingId ? `Edit #${editingId}` : "Metadata"}</h2>
        <button onClick={onSave} disabled={!canSave}>
          {editingId ? "Update Video" : "Save Video"}
        </button>
      </div>
      <div className="metadata-grid">
        <label>
          Title
          <input value={form.title} onChange={(event) => update("title", event.target.value)} />
        </label>
        <label>
          Category
          <input value={form.category} onChange={(event) => update("category", event.target.value)} placeholder="Action, Drama, Series..." />
        </label>
        <label className="wide">
          Thumbnail
          <input value={form.thumbnail} onChange={(event) => update("thumbnail", event.target.value)} />
        </label>
        <div className="thumb-large">
          <ImagePreview src={form.thumbnail} title={form.title} />
        </div>
        <label className="wide">
          Description
          <textarea value={form.description} onChange={(event) => update("description", event.target.value)} />
        </label>
        <label className="wide">
          Direct Video Source
          <input value={form.sourceUrl} onChange={(event) => update("sourceUrl", event.target.value)} />
        </label>
        <label>
          Source Type
          <select value={form.sourceType} onChange={(event) => update("sourceType", event.target.value)}>
            <option value="hls">hls</option>
            <option value="mp4">mp4</option>
            <option value="embed">embed</option>
          </select>
        </label>
        <label>
          Page URL
          <input value={form.pageUrl} onChange={(event) => update("pageUrl", event.target.value)} />
        </label>
      </div>
    </div>
  );
}

function VideoManager({
  videos,
  activeId,
  onEdit,
  onDelete
}: {
  videos: VideoRecord[];
  activeId?: number;
  onEdit: (video: VideoRecord) => void;
  onDelete: (video: VideoRecord) => void;
}) {
  return (
    <div className="panel library-panel">
      <div className="panel-head">
        <h2>Library</h2>
        <span className="count-pill">{videos.length} videos</span>
      </div>
      <div className="library-list">
        {videos.length === 0 ? (
          <div className="empty-state">No videos saved yet.</div>
        ) : (
          videos.map((video) => (
            <article key={video.id} className={`library-item ${activeId === video.id ? "active" : ""}`}>
              <ImagePreview src={video.thumbnail} title={video.title} />
              <div>
                <h3>{video.title}</h3>
                <div className="library-meta">
                  <span>{video.category || "Uncategorized"}</span>
                  <span>{video.sourceType}</span>
                </div>
                <code>{video.sourceUrl}</code>
                <div className="library-actions">
                  <button className="subtle-button" onClick={() => onEdit(video)}>
                    Edit
                  </button>
                  <button className="danger-button" onClick={() => onDelete(video)}>
                    Delete
                  </button>
                </div>
              </div>
            </article>
          ))
        )}
      </div>
    </div>
  );
}

function CatalogPage() {
  const [videos, setVideos] = useState<VideoRecord[]>([]);
  const [status, setStatus] = useState("Loading...");
  const [category, setCategory] = useState("All");

  useEffect(() => {
    fetch("/api/videos")
      .then((response) => response.json())
      .then((data) => {
        setVideos(data.videos || []);
        setStatus(data.videos?.length ? "" : "No videos saved yet.");
      })
      .catch((error) => setStatus(error instanceof Error ? error.message : String(error)));
  }, []);

  const categories = getCategories(videos);
  const visibleVideos = category === "All" ? videos : videos.filter((video) => normalizeCategory(video.category) === category);
  const featured = visibleVideos[0] ?? videos[0];
  const grouped = groupByCategory(visibleVideos);

  return (
    <main className="netflix-shell">
      <header className="catalog-topbar">
        <a className="brand" href="/">
          Stream Library
        </a>
        <nav className="category-menu">
          {["All", ...categories].map((item) => (
            <button key={item} className={category === item ? "active" : ""} onClick={() => setCategory(item)}>
              {item}
            </button>
          ))}
        </nav>
        <a className="nav-link" href="/admin">
          Admin
        </a>
      </header>

      {featured && (
        <section className="hero-feature">
          <ImagePreview src={featured.thumbnail} title={featured.title} />
          <div className="hero-copy">
            <span className="category-kicker">{featured.category || "Uncategorized"}</span>
            <h1>{featured.title}</h1>
            <p>{featured.description}</p>
            <a className="play-link" href={`/watch/${featured.id}`}>
              Play
            </a>
          </div>
        </section>
      )}

      <section className="content-rails">
        {status && <div className="empty-state">{status}</div>}
        {Object.entries(grouped).map(([name, items]) => (
          <div className="rail" key={name}>
            <h2>{name}</h2>
            <div className="poster-row">
              {items.map((video) => (
                <a className="poster-card" key={video.id} href={`/watch/${video.id}`}>
                  <ImagePreview src={video.thumbnail} title={video.title} />
                  <strong>{video.title}</strong>
                </a>
              ))}
            </div>
          </div>
        ))}
      </section>
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
            <span className="category-kicker">{video.category || "Uncategorized"}</span>
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
  useEffect(() => setFailed(false), [src]);
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

function inferCategory(title: string, description: string) {
  const text = `${title} ${description}`.toLowerCase();
  const matches = [
    "Action",
    "Adventure",
    "Animation",
    "Comedy",
    "Crime",
    "Drama",
    "Fantasy",
    "Horror",
    "Romance",
    "Sci-Fi",
    "Thriller"
  ];
  return matches.find((item) => text.includes(item.toLowerCase())) ?? "Uncategorized";
}

function getCategories(videos: VideoRecord[]) {
  return Array.from(new Set(videos.map((video) => normalizeCategory(video.category)))).sort((a, b) => a.localeCompare(b));
}

function groupByCategory(videos: VideoRecord[]) {
  return videos.reduce<Record<string, VideoRecord[]>>((groups, video) => {
    const category = normalizeCategory(video.category);
    groups[category] = [...(groups[category] ?? []), video];
    return groups;
  }, {});
}

function normalizeCategory(value: string) {
  return value?.trim() || "Uncategorized";
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
