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

type CategorySummary = {
  name: string;
  count: number;
};

type VideoPage = {
  videos: VideoRecord[];
  total: number;
  page: number;
  pageSize: number;
  categories: CategorySummary[];
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

type Notice = {
  tone: "idle" | "loading" | "success" | "error";
  text: string;
};

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
  const [inspectStatus, setInspectStatus] = useState("Ready");
  const [inspectResult, setInspectResult] = useState<InspectResult | undefined>();
  const [selectedSource, setSelectedSource] = useState<Candidate | undefined>();
  const [form, setForm] = useState<VideoForm>(emptyForm);
  const [editingId, setEditingId] = useState<number | undefined>();
  const [notice, setNotice] = useState<Notice>({ tone: "idle", text: "" });

  const [videos, setVideos] = useState<VideoRecord[]>([]);
  const [categories, setCategories] = useState<CategorySummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [libraryStatus, setLibraryStatus] = useState("Loading library...");

  useEffect(() => {
    loadVideos();
  }, [page, pageSize, search, categoryFilter]);

  async function loadVideos() {
    setLibraryStatus("Loading library...");
    try {
      const data = await fetchVideoPage({ page, pageSize, search, category: categoryFilter });
      setVideos(data.videos);
      setCategories(data.categories);
      setTotal(data.total);
      setLibraryStatus(data.total ? "" : "No matching videos.");
    } catch (error) {
      setLibraryStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function inspectSingle() {
    if (!url.trim()) return;
    setBusy(true);
    setProgress(8);
    setInspectStatus("Inspecting page...");
    setNotice({ tone: "idle", text: "" });
    setInspectResult(undefined);
    setSelectedSource(undefined);

    try {
      const response = await fetch("/api/admin/inspect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() })
      });
      setProgress(62);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Inspect failed");

      const source = getDefaultSource(data);
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
      setProgress(100);
      setInspectStatus(formatResultStatus(data));
    } catch (error) {
      setInspectStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  function startNew() {
    setUrl("");
    setProgress(0);
    setInspectStatus("Ready");
    setInspectResult(undefined);
    setSelectedSource(undefined);
    setEditingId(undefined);
    setForm(emptyForm);
    setNotice({ tone: "idle", text: "" });
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
    setNotice({ tone: "loading", text: editingId ? "Updating video..." : "Saving video..." });
    try {
      const response = await fetch(editingId ? `/api/videos/${editingId}` : "/api/videos", {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Save failed");
      setEditingId(data.video.id);
      setNotice({ tone: "success", text: editingId ? "Updated." : `Saved. Open /watch/${data.video.id}` });
      await loadVideos();
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    }
  }

  function editVideo(video: VideoRecord) {
    setEditingId(video.id);
    setInspectResult(undefined);
    setSelectedSource({
      url: video.sourceUrl,
      kind: video.sourceUrl.includes(".m3u8") ? "stream" : "video",
      foundBy: "dom",
      displayedAs: video.sourceType,
      sourceType: video.sourceType
    });
    setForm(recordToForm(video));
    setProgress(0);
    setInspectStatus(`Editing #${video.id}`);
    setNotice({ tone: "idle", text: "" });
  }

  async function deleteVideoRecord(video: VideoRecord) {
    if (!window.confirm(`Delete "${video.title}"?`)) return;
    const response = await fetch(`/api/videos/${video.id}`, { method: "DELETE" });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setNotice({ tone: "error", text: data.error || "Delete failed" });
      return;
    }
    if (editingId === video.id) startNew();
    setNotice({ tone: "success", text: "Deleted." });
    await loadVideos();
  }

  function applySearch() {
    setPage(1);
    setSearch(searchDraft.trim());
  }

  function clearSearch() {
    setSearchDraft("");
    setSearch("");
    setCategoryFilter("All");
    setPage(1);
  }

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const sources = inspectResult ? [...inspectResult.candidates, ...inspectResult.fallbackEmbeds] : [];
  const canSave = Boolean(form.title.trim() && form.pageUrl.trim() && form.sourceUrl.trim() && form.sourceType !== "embed" && notice.tone !== "loading");

  return (
    <main className="admin-shell">
      <header className="admin-topbar">
        <div>
          <h1>Admin</h1>
          <p>Import, review, edit, search, and organize the video library.</p>
        </div>
        <div className="admin-stats">
          <Stat label="Total" value={total} />
          <Stat label="Categories" value={categories.length} />
          <a className="nav-link" href="/">
            View site
          </a>
        </div>
      </header>

      <section className="admin-dashboard">
        <div className="admin-left">
          <div className="panel import-panel">
            <div className="panel-head">
              <h2>Import One Movie</h2>
              <button className="subtle-button" onClick={startNew}>
                New
              </button>
            </div>
            <div className="inspect-row">
              <input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="Paste movie page URL" />
              <button disabled={busy || !url.trim()} onClick={inspectSingle}>
                Inspect
              </button>
            </div>
            <Progress progress={progress} busy={busy} status={inspectStatus} />
            {inspectResult && <SourcePicker result={inspectResult} sources={sources} selected={selectedSource} onSelect={selectSource} />}
          </div>

          <VideoEditor form={form} editingId={editingId} canSave={canSave} onChange={setForm} onSave={saveVideo} />
          {notice.text && <div className={`inline-notice ${notice.tone}`}>{notice.text}</div>}
        </div>

        <div className="admin-right">
          <div className="panel preview-panel compact">
            <div className="panel-head">
              <h2>Preview</h2>
              {form.sourceType === "embed" && <span className="warn-label">Fallback only</span>}
            </div>
            <Player source={form.sourceUrl} sourceType={form.sourceType} />
          </div>

          <LibraryPanel
            videos={videos}
            categories={categories}
            total={total}
            page={page}
            pageSize={pageSize}
            pageCount={pageCount}
            searchDraft={searchDraft}
            categoryFilter={categoryFilter}
            status={libraryStatus}
            activeId={editingId}
            onSearchDraft={setSearchDraft}
            onApplySearch={applySearch}
            onClearSearch={clearSearch}
            onCategoryFilter={(value) => {
              setCategoryFilter(value);
              setPage(1);
            }}
            onPageSize={(value) => {
              setPageSize(value);
              setPage(1);
            }}
            onPage={setPage}
            onEdit={editVideo}
            onDelete={deleteVideoRecord}
          />
        </div>
      </section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Progress({ progress, busy, status }: { progress: number; busy: boolean; status: string }) {
  return (
    <div className="progress-wrap">
      <div className="progress-meta">
        <span>{status}</span>
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
            <label key={candidate.url} className={`source-row ${candidate.sourceType === "embed" ? "muted" : ""}`}>
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

function VideoEditor({
  form,
  editingId,
  canSave,
  onChange,
  onSave
}: {
  form: VideoForm;
  editingId?: number;
  canSave: boolean;
  onChange: (form: VideoForm) => void;
  onSave: () => void;
}) {
  const update = (key: keyof VideoForm, value: string) => onChange({ ...form, [key]: value });
  return (
    <div className="panel editor-panel">
      <div className="panel-head">
        <h2>{editingId ? `Edit Video #${editingId}` : "Metadata"}</h2>
        <button onClick={onSave} disabled={!canSave}>
          {editingId ? "Update" : "Save"}
        </button>
      </div>
      <div className="editor-grid">
        <label className="wide">
          Title
          <input value={form.title} onChange={(event) => update("title", event.target.value)} />
        </label>
        <label>
          Category
          <input value={form.category} onChange={(event) => update("category", event.target.value)} placeholder="Action, Drama, Thai..." />
        </label>
        <label>
          Source Type
          <select value={form.sourceType} onChange={(event) => update("sourceType", event.target.value)}>
            <option value="hls">hls</option>
            <option value="mp4">mp4</option>
            <option value="embed">embed</option>
          </select>
        </label>
        <label className="wide">
          Thumbnail
          <input value={form.thumbnail} onChange={(event) => update("thumbnail", event.target.value)} />
        </label>
        <div className="thumb-review">
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
        <label className="wide">
          Page URL
          <input value={form.pageUrl} onChange={(event) => update("pageUrl", event.target.value)} />
        </label>
      </div>
    </div>
  );
}

function LibraryPanel({
  videos,
  categories,
  total,
  page,
  pageSize,
  pageCount,
  searchDraft,
  categoryFilter,
  status,
  activeId,
  onSearchDraft,
  onApplySearch,
  onClearSearch,
  onCategoryFilter,
  onPageSize,
  onPage,
  onEdit,
  onDelete
}: {
  videos: VideoRecord[];
  categories: CategorySummary[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  searchDraft: string;
  categoryFilter: string;
  status: string;
  activeId?: number;
  onSearchDraft: (value: string) => void;
  onApplySearch: () => void;
  onClearSearch: () => void;
  onCategoryFilter: (value: string) => void;
  onPageSize: (value: number) => void;
  onPage: (value: number) => void;
  onEdit: (video: VideoRecord) => void;
  onDelete: (video: VideoRecord) => void;
}) {
  return (
    <div className="panel library-panel">
      <div className="panel-head">
        <h2>Library</h2>
        <span className="count-pill">{total} videos</span>
      </div>

      <div className="library-toolbar">
        <input
          value={searchDraft}
          onChange={(event) => onSearchDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") onApplySearch();
          }}
          placeholder="Search title, description, page URL"
        />
        <select value={categoryFilter} onChange={(event) => onCategoryFilter(event.target.value)}>
          <option value="All">All categories</option>
          {categories.map((category) => (
            <option key={category.name} value={category.name}>
              {category.name} ({category.count})
            </option>
          ))}
        </select>
        <button className="subtle-button" onClick={onApplySearch}>
          Search
        </button>
        <button className="subtle-button" onClick={onClearSearch}>
          Clear
        </button>
      </div>

      <div className="table-wrap">
        <table className="video-table">
          <thead>
            <tr>
              <th>Movie</th>
              <th>Category</th>
              <th>Source</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {videos.map((video) => (
              <tr key={video.id} className={activeId === video.id ? "active" : ""}>
                <td>
                  <div className="movie-cell">
                    <ImagePreview src={video.thumbnail} title={video.title} />
                    <div>
                      <strong>{video.title}</strong>
                      <span>#{video.id}</span>
                    </div>
                  </div>
                </td>
                <td>{video.category || "Uncategorized"}</td>
                <td>
                  <span className={`source-badge ${video.sourceType === "embed" ? "warn" : ""}`}>{video.sourceType}</span>
                </td>
                <td>
                  <div className="row-actions">
                    <button className="subtle-button" onClick={() => onEdit(video)}>
                      Edit
                    </button>
                    <button className="danger-button" onClick={() => onDelete(video)}>
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {status && <div className="empty-state">{status}</div>}
      </div>

      <div className="pagination">
        <button className="subtle-button" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </button>
        <span>
          Page {page} / {pageCount}
        </span>
        <button className="subtle-button" disabled={page >= pageCount} onClick={() => onPage(page + 1)}>
          Next
        </button>
        <select value={pageSize} onChange={(event) => onPageSize(Number(event.target.value))}>
          <option value={10}>10 / page</option>
          <option value={20}>20 / page</option>
          <option value={50}>50 / page</option>
          <option value={100}>100 / page</option>
        </select>
      </div>
    </div>
  );
}

function CatalogPage() {
  const [videos, setVideos] = useState<VideoRecord[]>([]);
  const [categories, setCategories] = useState<CategorySummary[]>([]);
  const [total, setTotal] = useState(0);
  const [category, setCategory] = useState("All");
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("Loading...");

  useEffect(() => {
    loadCatalog();
  }, [category, search]);

  async function loadCatalog() {
    setStatus("Loading...");
    try {
      const data = await fetchVideoPage({ page: 1, pageSize: 96, search, category });
      setVideos(data.videos);
      setCategories(data.categories);
      setTotal(data.total);
      setStatus(data.total ? "" : "No videos found.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  const featured = videos[0];
  const grouped = groupByCategory(videos);

  return (
    <main className="netflix-shell">
      <header className="catalog-topbar">
        <a className="brand" href="/">
          Stream Library
        </a>
        <nav className="category-menu">
          {["All", ...categories.map((item) => item.name)].map((item) => (
            <button key={item} className={category === item ? "active" : ""} onClick={() => setCategory(item)}>
              {item}
            </button>
          ))}
        </nav>
        <div className="catalog-actions">
          <input
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") setSearch(searchDraft.trim());
            }}
            placeholder="Search movies"
          />
          <a className="nav-link" href="/admin">
            Admin
          </a>
        </div>
      </header>

      {featured && (
        <section className="hero-feature">
          <ImagePreview src={featured.thumbnail} title={featured.title} />
          <div className="hero-copy">
            <span className="category-kicker">{featured.category || "Uncategorized"}</span>
            <h1>{featured.title}</h1>
            <p>{featured.description}</p>
            <div className="hero-actions">
              <a className="play-link" href={`/watch/${featured.id}`}>
                Play
              </a>
              <span>{total} titles available</span>
            </div>
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

async function fetchVideoPage({
  page,
  pageSize,
  search,
  category
}: {
  page: number;
  pageSize: number;
  search: string;
  category: string;
}): Promise<VideoPage> {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
    search,
    category
  });
  const response = await fetch(`/api/videos?${params.toString()}`);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Load failed");
  return data;
}

function recordToForm(video: VideoRecord): VideoForm {
  return {
    title: video.title,
    description: video.description,
    thumbnail: video.thumbnail,
    category: video.category || "Uncategorized",
    pageUrl: video.pageUrl,
    sourceUrl: video.sourceUrl,
    sourceType: video.sourceType
  };
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
  const matches = ["Action", "Adventure", "Animation", "Comedy", "Crime", "Drama", "Fantasy", "Horror", "Romance", "Sci-Fi", "Thriller"];
  return matches.find((item) => text.includes(item.toLowerCase())) ?? "Uncategorized";
}

function groupByCategory(videos: VideoRecord[]) {
  return videos.reduce<Record<string, VideoRecord[]>>((groups, video) => {
    const category = video.category?.trim() || "Uncategorized";
    groups[category] = [...(groups[category] ?? []), video];
    return groups;
  }, {});
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
