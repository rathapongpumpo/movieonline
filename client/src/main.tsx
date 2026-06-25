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
    category?: string;
  };
  candidates: Candidate[];
  fallbackEmbeds: Candidate[];
  episodes?: Array<{
    title: string;
    episodeNumber: number;
    pageUrl: string;
    sourceUrl: string;
    sourceType: string;
  }>;
  warnings: string[];
};

type VideoRecord = {
  id: number;
  title: string;
  description: string;
  thumbnail: string;
  fallbackThumbnail?: string;
  category: string;
  pageUrl: string;
  sourceUrl: string;
  sourceType: string;
  playbackUrl?: string;
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

type CardCandidate = {
  url: string;
  title: string;
  thumbnail: string;
  score: number;
};

type BatchCard = CardCandidate & {
  selected: boolean;
  status: "pending" | "inspecting" | "ready" | "review" | "saved" | "error";
  message: string;
  form?: VideoForm;
};

type EpisodeRecord = {
  id: number;
  seriesId: number;
  episodeNumber: number;
  title: string;
  description: string;
  thumbnail: string;
  pageUrl: string;
  sourceUrl: string;
  sourceType: string;
  status: string;
};

type SeriesRecord = {
  id: number;
  title: string;
  description: string;
  poster: string;
  category: string;
  status: string;
  pageUrl: string;
  episodes: EpisodeRecord[];
};

type SeriesForm = {
  title: string;
  description: string;
  poster: string;
  category: string;
  status: string;
  pageUrl: string;
};

type EpisodeForm = {
  episodeNumber: number;
  title: string;
  description: string;
  thumbnail: string;
  pageUrl: string;
  sourceUrl: string;
  sourceType: string;
  status: string;
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

type LiffProfile = {
  userId: string;
  displayName: string;
  pictureUrl?: string;
};

type LiffClient = {
  init: (options: { liffId: string }) => Promise<void>;
  isLoggedIn: () => boolean;
  isInClient: () => boolean;
  login: (options?: { redirectUri?: string }) => void;
  getAccessToken: () => string | null;
  getProfile: () => Promise<LiffProfile>;
};

type GoogleSheetsExportResult = {
  spreadsheetUrl: string;
  videos: number;
  series: number;
  episodes: number;
  categories: number;
};

type SourceHealthResult = {
  ok: boolean;
  reason?: string;
  normalizedContentType?: string;
};

const emptyForm: VideoForm = {
  title: "",
  description: "",
  thumbnail: "",
  category: "ยังไม่จัดหมวด",
  pageUrl: "",
  sourceUrl: "",
  sourceType: ""
};

const emptySeriesForm: SeriesForm = {
  title: "",
  description: "",
  poster: "",
  category: "ซีรีส์",
  status: "draft",
  pageUrl: ""
};

const emptyEpisodeForm: EpisodeForm = {
  episodeNumber: 1,
  title: "",
  description: "",
  thumbnail: "",
  pageUrl: "",
  sourceUrl: "",
  sourceType: "hls",
  status: "draft"
};

const movieTypes = [
  "ยังไม่จัดหมวด",
  "หนังใหม่",
  "แอ็กชัน",
  "ผจญภัย",
  "ตลก",
  "ดราม่า",
  "แฟนตาซี",
  "สยองขวัญ",
  "โรแมนติก",
  "ไซไฟ",
  "ระทึกขวัญ",
  "อนิเมชัน",
  "ซีรีส์",
  "หนังไทย"
];

function App() {
  const path = window.location.pathname;
  if (path.startsWith("/admin/series")) return <AdminGate><SeriesAdminPage /></AdminGate>;
  if (path.startsWith("/admin")) return <AdminGate><AdminPage /></AdminGate>;
  if (path.startsWith("/watch/")) return <LiffViewerGate><WatchPage /></LiffViewerGate>;
  return <LiffViewerGate><CatalogPage /></LiffViewerGate>;
}

function LiffViewerGate({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState("กำลังตรวจสอบ LINE...");
  const [ready, setReady] = useState(isLocalDevHost());

  useEffect(() => {
    if (isLocalDevHost()) return;
    const win = window as unknown as { liff?: LiffClient };
    const liffId = getLiffId();
    const liffUrl = `https://liff.line.me/${liffId}`;

    if (!win.liff) {
      window.location.replace(liffUrl);
      return;
    }

    win.liff
      .init({ liffId })
      .then(async () => {
        if (!win.liff) return;
        if (!win.liff.isLoggedIn()) {
          win.liff.login({ redirectUri: window.location.href });
          return;
        }
        if (!win.liff.isInClient()) {
          window.location.replace(liffUrl);
          return;
        }

        const accessToken = win.liff.getAccessToken();
        if (accessToken) {
          await fetch("/api/line-login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ accessToken })
          }).catch(() => undefined);
        }
        setReady(true);
      })
      .catch(() => {
        setStatus("กรุณาเปิดผ่าน LINE OA");
        window.location.replace(liffUrl);
      });
  }, []);

  if (!ready) {
    return (
      <main className="line-gate-shell">
        <div className="line-gate-panel">
          <strong>เปิดผ่าน LINE เท่านั้น</strong>
          <span>{status}</span>
          <a href={`https://liff.line.me/${getLiffId()}`}>เปิดผ่าน LINE</a>
        </div>
      </main>
    );
  }

  return <>{children}</>;
}

function AdminGate({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<"loading" | "ready" | "login">("loading");
  const [username, setUsername] = useState("rpumpo");
  const [password, setPassword] = useState("");
  const [notice, setNotice] = useState<Notice>({ tone: "idle", text: "" });

  useEffect(() => {
    fetch("/api/admin/me")
      .then((response) => {
        if (!response.ok) throw new Error("login");
        return response.json();
      })
      .then(() => setStatus("ready"))
      .catch(() => setStatus("login"));
  }, []);

  async function login() {
    setNotice({ tone: "loading", text: "กำลังเข้าสู่ระบบ..." });
    const response = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setNotice({ tone: "error", text: data.error || "เข้าสู่ระบบไม่สำเร็จ" });
      return;
    }
    setNotice({ tone: "success", text: "เข้าสู่ระบบแล้ว" });
    setStatus("ready");
  }

  if (status === "loading") return <main className="admin-shell"><div className="empty-state">กำลังตรวจสอบสิทธิ์...</div></main>;
  if (status === "ready") return <>{children}</>;

  return (
    <main className="login-shell">
      <section className="login-panel">
        <h1>เข้าสู่ระบบหลังบ้าน</h1>
        <p>กรุณาเข้าสู่ระบบก่อนจัดการข้อมูลวิดีโอ</p>
        <label>
          ผู้ใช้
          <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" />
        </label>
        <label>
          รหัสผ่าน
          <input
            value={password}
            type="password"
            onChange={(event) => setPassword(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") login();
            }}
            autoComplete="current-password"
          />
        </label>
        <button className="primary-save" onClick={login} disabled={!username.trim() || !password || notice.tone === "loading"}>
          เข้าสู่ระบบ
        </button>
        {notice.text && <div className={`save-notice ${notice.tone}`}>{notice.text}</div>}
      </section>
    </main>
  );
}

function AdminPage() {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [inspectStatus, setInspectStatus] = useState("พร้อมใช้งาน");
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
  const [libraryStatus, setLibraryStatus] = useState("กำลังโหลดคลังหนัง...");
  const [batchUrl, setBatchUrl] = useState("");
  const [batchItems, setBatchItems] = useState<BatchCard[]>([]);
  const [batchNotice, setBatchNotice] = useState<Notice>({ tone: "idle", text: "" });
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchProgress, setBatchProgress] = useState(0);

  useEffect(() => {
    loadVideos();
  }, [page, pageSize, search, categoryFilter]);

  async function loadVideos() {
    setLibraryStatus("กำลังโหลดคลังหนัง...");
    try {
      const data = await fetchVideoPage({ page, pageSize, search, category: categoryFilter });
      setVideos(data.videos);
      setCategories(data.categories);
      setTotal(data.total);
      setLibraryStatus(data.total ? "" : "ไม่พบรายการที่ตรงกับเงื่อนไข");
    } catch (error) {
      setLibraryStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function inspectSingle() {
    if (!url.trim()) return;
    setBusy(true);
    setProgress(8);
    setInspectStatus("กำลังตรวจสอบหน้าเว็บ...");
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
      if (!response.ok) throw new Error(data.error || "ตรวจสอบไม่สำเร็จ");

      const source = getDefaultSource(data);
      setInspectResult(data);
      setSelectedSource(source);
      setForm({
        title: data.metadata.title || "",
        description: data.metadata.description || "",
        thumbnail: data.metadata.thumbnail || "",
        category: data.metadata.category || inferCategory(data.metadata.title, data.metadata.description),
        pageUrl: data.pageUrl || url.trim(),
        sourceUrl: source?.url ?? "",
        sourceType: source?.sourceType ?? ""
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
    setInspectStatus("พร้อมใช้งาน");
    setInspectResult(undefined);
    setSelectedSource(undefined);
    setEditingId(undefined);
    setForm(emptyForm);
    setNotice({ tone: "idle", text: "" });
  }

  function selectSource(candidate: Candidate) {
    setSelectedSource(candidate);
    setForm((current) =>
      candidate.sourceType === "embed"
        ? current
        : {
            ...current,
            sourceUrl: candidate.url,
            sourceType: candidate.sourceType
          }
    );
  }

  async function saveVideo() {
    setNotice({ tone: "loading", text: editingId ? "กำลังอัปเดต..." : "กำลังบันทึก..." });
    try {
      if (form.sourceType !== "embed") {
        await checkSourceHealth(form.sourceUrl);
      }
      const response = await fetch(editingId ? `/api/videos/${editingId}` : "/api/videos", {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(translateError(data.error || "บันทึกไม่สำเร็จ"));
      setNotice({ tone: "success", text: editingId ? "อัปเดตแล้ว" : `บันทึกแล้ว: ${data.video.title}` });
      if (!editingId) {
        setUrl("");
        setProgress(0);
        setInspectStatus("พร้อมใช้งาน");
        setInspectResult(undefined);
        setSelectedSource(undefined);
        setForm(emptyForm);
      } else {
        setEditingId(data.video.id);
      }
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
    setInspectStatus(`กำลังแก้ไข #${video.id}`);
    setNotice({ tone: "idle", text: "" });
  }

  async function deleteVideoRecord(video: VideoRecord) {
    if (!window.confirm(`ลบ "${video.title}" ใช่ไหม?`)) return;
    const response = await fetch(`/api/videos/${video.id}`, { method: "DELETE" });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setNotice({ tone: "error", text: data.error || "ลบไม่สำเร็จ" });
      return;
    }
    if (editingId === video.id) startNew();
    setNotice({ tone: "success", text: "ลบแล้ว" });
    await loadVideos();
  }

  async function discoverBatchCards() {
    if (!batchUrl.trim()) {
      setBatchNotice({ tone: "error", text: "กรุณาวาง URL หน้าหมวดหมู่ก่อน" });
      return;
    }
    setBatchBusy(true);
    setBatchProgress(8);
    setBatchNotice({ tone: "loading", text: "กำลังดึงลิงก์จาก card หนัง..." });
    setBatchItems([]);
    try {
      const response = await fetch("/api/admin/discover-cards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: batchUrl.trim(), limit: 80 })
      });
      const data = (await response.json()) as { cards?: CardCandidate[]; error?: string };
      if (!response.ok) throw new Error(data.error || "ดึงรายการจากหน้าหมวดหมู่ไม่สำเร็จ");
      const items = (data.cards ?? []).map((card) => ({
        ...card,
        selected: true,
        status: "pending" as const,
        message: "รอตรวจสอบ"
      }));
      setBatchItems(items);
      setBatchProgress(100);
      setBatchNotice({
        tone: items.length ? "success" : "error",
        text: items.length ? `พบ card หนัง ${items.length} รายการ เลือกแล้วกดตรวจสอบที่เลือก` : "ไม่พบ card หนังในหน้านี้"
      });
    } catch (error) {
      setBatchProgress(0);
      setBatchNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBatchBusy(false);
    }
  }

  function toggleBatchItem(url: string, selected: boolean) {
    setBatchItems((items) => items.map((item) => (item.url === url ? { ...item, selected } : item)));
  }

  function toggleAllBatchItems(selected: boolean) {
    setBatchItems((items) => items.map((item) => ({ ...item, selected })));
  }

  async function inspectBatchCards() {
    const selectedItems = batchItems.filter((item) => item.selected);
    if (!selectedItems.length) {
      setBatchNotice({ tone: "error", text: "กรุณาเลือกรายการอย่างน้อย 1 รายการ" });
      return;
    }
    setBatchBusy(true);
    setBatchProgress(0);
    setBatchNotice({ tone: "loading", text: `กำลังตรวจสอบ ${selectedItems.length} รายการ...` });

    let completed = 0;
    for (const item of selectedItems) {
      setBatchItems((items) =>
        items.map((current) => (current.url === item.url ? { ...current, status: "inspecting", message: "กำลังตรวจสอบ source..." } : current))
      );
      try {
        const response = await fetch("/api/admin/inspect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: item.url })
        });
        const data = (await response.json()) as InspectResult & { error?: string };
        if (!response.ok) throw new Error(data.error || "ตรวจสอบไม่สำเร็จ");
        const source = getDefaultSource(data);
        const prepared: VideoForm | undefined = source
          ? {
              title: data.metadata.title || item.title,
              description: data.metadata.description || "",
              thumbnail: data.metadata.thumbnail || item.thumbnail,
              category: data.metadata.category || inferCategory(data.metadata.title || item.title, data.metadata.description || ""),
              pageUrl: data.pageUrl || item.url,
              sourceUrl: source.url,
              sourceType: source.sourceType
            }
          : undefined;
        let status: BatchCard["status"] = "review";
        let message = formatResultStatus(data);
        let readyForm: VideoForm | undefined;
        if (source && data.candidates.length === 1 && prepared) {
          if (source.sourceType === "embed") {
            message = "พบเฉพาะ embed ไม่ใช่ direct video source";
          } else {
            const health = await checkSourceHealth(source.url);
            status = health.ok ? "ready" : "error";
            message = health.ok ? "พร้อมบันทึก: source เล่นได้" : `source เล่นไม่ได้: ${health.reason || "ตรวจสอบไม่ผ่าน"}`;
            readyForm = health.ok ? prepared : undefined;
          }
        }
        setBatchItems((items) =>
          items.map((current) =>
            current.url === item.url
              ? {
                  ...current,
                  title: prepared?.title || item.title,
                  thumbnail: prepared?.thumbnail || item.thumbnail,
                  status,
                  message,
                  form: readyForm
                }
              : current
          )
        );
      } catch (error) {
        setBatchItems((items) =>
          items.map((current) =>
            current.url === item.url
              ? {
                  ...current,
                  status: "error",
                  message: error instanceof Error ? error.message : String(error)
                }
              : current
          )
        );
      } finally {
        completed += 1;
        setBatchProgress(Math.round((completed / selectedItems.length) * 100));
      }
    }

    setBatchBusy(false);
    setBatchNotice({ tone: "success", text: "ตรวจสอบชุดนี้เสร็จแล้ว ตรวจรายการพร้อมบันทึกได้เลย" });
  }

  async function saveReadyBatchCards() {
    const readyItems = batchItems.filter((item) => item.status === "ready" && item.form);
    if (!readyItems.length) {
      setBatchNotice({ tone: "error", text: "ยังไม่มีรายการที่พร้อมบันทึก" });
      return;
    }
    setBatchBusy(true);
    setBatchProgress(0);
    setBatchNotice({ tone: "loading", text: `กำลังบันทึก ${readyItems.length} รายการ...` });

    let completed = 0;
    for (const item of readyItems) {
      try {
        const response = await fetch("/api/videos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(item.form)
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(translateError(data.error || "บันทึกไม่สำเร็จ"));
        setBatchItems((items) => items.map((current) => (current.url === item.url ? { ...current, status: "saved", message: "บันทึกแล้ว" } : current)));
      } catch (error) {
        setBatchItems((items) =>
          items.map((current) =>
            current.url === item.url
              ? {
                  ...current,
                  status: "error",
                  message: error instanceof Error ? error.message : String(error)
                }
              : current
          )
        );
      } finally {
        completed += 1;
        setBatchProgress(Math.round((completed / readyItems.length) * 100));
      }
    }

    setBatchBusy(false);
    setBatchNotice({ tone: "success", text: "บันทึก batch เสร็จแล้ว" });
    await loadVideos();
  }

  function clearBatch() {
    setBatchUrl("");
    setBatchItems([]);
    setBatchNotice({ tone: "idle", text: "" });
    setBatchProgress(0);
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
  const directSources = inspectResult?.candidates ?? [];
  const fallbackSources = inspectResult?.fallbackEmbeds ?? [];
  const canSave = Boolean(form.title.trim() && form.pageUrl.trim() && form.sourceUrl.trim() && form.sourceType !== "embed" && notice.tone !== "loading");

  return (
    <main className="admin-shell">
      <header className="admin-topbar">
        <div>
          <h1>หลังบ้าน</h1>
          <p>นำเข้าหนัง ตรวจสอบแหล่งวิดีโอตรง แก้ไขข้อมูล และจัดการคลังหนัง</p>
          <AdminTabs active="movies" />
        </div>
        <div className="admin-stats">
          <Stat label="ทั้งหมด" value={total} />
          <Stat label="หมวดหมู่" value={categories.length} />
          <GoogleSheetsExportAction />
          <a className="nav-link" href="/">
            ดูหน้าเว็บ
          </a>
        </div>
      </header>

      <section className="admin-dashboard">
        <div className="admin-left">
          <div className="panel import-panel">
            <div className="panel-head">
              <h2>นำเข้าหนังทีละเรื่อง</h2>
              <button className="subtle-button" onClick={startNew}>
                เริ่มใหม่
              </button>
            </div>
            <div className="inspect-row">
              <input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="วางลิงก์หน้าหนัง" />
              <button disabled={busy || !url.trim()} onClick={inspectSingle}>
                ตรวจสอบ
              </button>
            </div>
            <Progress progress={progress} busy={busy} status={inspectStatus} />
            {inspectResult && (
              <SourcePicker
                result={inspectResult}
                directSources={directSources}
                fallbackSources={fallbackSources}
                selected={selectedSource}
                onSelect={selectSource}
              />
            )}
          </div>

          <BatchImportPanel
            url={batchUrl}
            items={batchItems}
            notice={batchNotice}
            busy={batchBusy}
            progress={batchProgress}
            onUrl={setBatchUrl}
            onDiscover={discoverBatchCards}
            onInspect={inspectBatchCards}
            onSave={saveReadyBatchCards}
            onClear={clearBatch}
            onToggle={toggleBatchItem}
            onToggleAll={toggleAllBatchItems}
          />

          <VideoEditor form={form} editingId={editingId} notice={notice} canSave={canSave} onChange={setForm} onSave={saveVideo} />
        </div>

        <div className="admin-right">
          <div className="panel preview-panel compact">
            <div className="panel-head">
              <h2>ตัวอย่างการเล่น</h2>
              {!form.sourceUrl && <span className="warn-label">ยังไม่มีแหล่งวิดีโอตรง</span>}
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

function GoogleSheetsExportAction() {
  const [notice, setNotice] = useState<Notice>({ tone: "idle", text: "" });

  async function exportSheets() {
    setNotice({ tone: "loading", text: "กำลังส่งออก..." });
    try {
      const response = await fetch("/api/admin/export/google-sheets", { method: "POST" });
      const data = (await response.json().catch(() => ({}))) as Partial<GoogleSheetsExportResult> & { error?: string };
      if (!response.ok) throw new Error(data.error || "ส่งออก Google Sheet ไม่สำเร็จ");
      setNotice({
        tone: "success",
        text: `ส่งออกแล้ว: หนัง ${data.videos ?? 0}, ซีรีส์ ${data.series ?? 0}, ตอน ${data.episodes ?? 0}`
      });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    }
  }

  return (
    <div className="sheet-export">
      <button className="subtle-button" disabled={notice.tone === "loading"} onClick={exportSheets}>
        ส่งออก Google Sheet
      </button>
      {notice.text && <div className={`sheet-export-notice ${notice.tone}`}>{notice.text}</div>}
    </div>
  );
}

function AdminTabs({ active }: { active: "movies" | "series" }) {
  return (
    <nav className="admin-tabs">
      <a className={active === "movies" ? "active" : ""} href="/admin">
        หนังเดี่ยว
      </a>
      <a className={active === "series" ? "active" : ""} href="/admin/series">
        ซีรีส์
      </a>
      <span>การ์ตูน</span>
    </nav>
  );
}

function EpisodeDraftList({ episodes }: { episodes: EpisodeForm[] }) {
  if (episodes.length === 0) return <div className="empty-state small">ยังไม่พบรายการตอนจากหน้านี้</div>;
  return (
    <div className="episode-draft-list">
      {episodes.map((episode) => (
        <div className="episode-draft" key={`${episode.episodeNumber}-${episode.pageUrl}`}>
          <strong>
            EP.{episode.episodeNumber} {episode.title}
          </strong>
          <span>{episode.sourceUrl ? `มี source ${episode.sourceType}` : "มีลิงก์ตอนแล้ว รอตรวจ source รายตอน"}</span>
          <code>{episode.sourceUrl || episode.pageUrl}</code>
        </div>
      ))}
    </div>
  );
}

function SeriesInspectSummary({ form, episodes, sourceCount }: { form: SeriesForm; episodes: EpisodeForm[]; sourceCount: number }) {
  const withSource = episodes.filter((episode) => episode.sourceUrl.trim()).length;
  return (
    <div className="series-summary">
      <ImagePreview src={form.poster} title={form.title} />
      <div className="series-summary-copy">
        <span className="category-kicker">{displayCategory(form.category)}</span>
        <h3>{form.title || "ยังไม่มีชื่อซีรีส์"}</h3>
        <p>{form.description || "ไม่มีรายละเอียด"}</p>
        <div className="summary-metrics">
          <span>{episodes.length} ตอน</span>
          <span>{withSource} ตอนมี source แล้ว</span>
          <span>{sourceCount} direct source</span>
        </div>
      </div>
      <div className="series-summary-episodes">
        <EpisodeDraftList episodes={episodes} />
      </div>
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
  directSources,
  fallbackSources,
  selected,
  onSelect
}: {
  result: InspectResult;
  directSources: Candidate[];
  fallbackSources: Candidate[];
  selected?: Candidate;
  onSelect: (candidate: Candidate) => void;
}) {
  return (
    <div className="source-picker">
      <div className="chips">
        <span className={result.candidates.length ? "chip good" : "chip warn"}>
          {result.candidates.length ? `เจอแหล่งวิดีโอ ${result.candidates.length} รายการ` : "ไม่พบแหล่งวิดีโอตรง"}
        </span>
        {!!result.fallbackEmbeds.length && <span className="chip warn">ตัวสำรอง {result.fallbackEmbeds.length} รายการ</span>}
      </div>
      {!!result.warnings.length && <div className="warning-text">{result.warnings.map(translateWarning).join(" ")}</div>}
      <div className="source-group">
        <strong>แหล่งวิดีโอตรง</strong>
        <div className="source-list">
          {directSources.length === 0 ? (
            <div className="empty-state small danger-state">ยังไม่พบแหล่งวิดีโอตรง จึงยังบันทึกไม่ได้</div>
          ) : (
            directSources.map((candidate) => (
              <label key={candidate.url} className="source-row">
                <input type="radio" checked={selected?.url === candidate.url} onChange={() => onSelect(candidate)} />
                <span>{candidate.sourceType}</span>
                <code>{candidate.url}</code>
              </label>
            ))
          )}
        </div>
      </div>
      {fallbackSources.length > 0 && (
        <div className="source-group fallback-group">
          <strong>ตัวเล่นสำรอง / ตัวอย่างหนัง</strong>
          <p>รายการนี้ไม่ใช่แหล่งวิดีโอตรง ระบบแสดงไว้ให้ตรวจสอบเท่านั้น และจะไม่ใช้บันทึก</p>
          <div className="source-list">
            {fallbackSources.map((candidate) => (
              <div key={candidate.url} className="source-row muted">
                <span className="radio-placeholder" />
                <span>{candidate.sourceType}</span>
                <code>{candidate.url}</code>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function BatchImportPanel({
  url,
  items,
  notice,
  busy,
  progress,
  onUrl,
  onDiscover,
  onInspect,
  onSave,
  onClear,
  onToggle,
  onToggleAll
}: {
  url: string;
  items: BatchCard[];
  notice: Notice;
  busy: boolean;
  progress: number;
  onUrl: (value: string) => void;
  onDiscover: () => void;
  onInspect: () => void;
  onSave: () => void;
  onClear: () => void;
  onToggle: (url: string, selected: boolean) => void;
  onToggleAll: (selected: boolean) => void;
}) {
  const selectedCount = items.filter((item) => item.selected).length;
  const readyCount = items.filter((item) => item.status === "ready").length;
  const savedCount = items.filter((item) => item.status === "saved").length;

  return (
    <div className="panel batch-panel">
      <div className="panel-head">
        <div>
          <h2>นำเข้าจากหน้าหมวดหมู่</h2>
          <p>ดึงลิงก์จาก card หนังในหน้านั้น แล้วตรวจสอบ direct source เป็นชุด</p>
        </div>
        <button className="subtle-button" disabled={busy} onClick={onClear}>
          ล้างชุดนี้
        </button>
      </div>

      <div className="inspect-row">
        <input value={url} onChange={(event) => onUrl(event.target.value)} placeholder="วาง URL หน้าหมวดหมู่ เช่น https://www.24hd.net/category/หนังใหม่2026/" />
        <button disabled={busy || !url.trim()} onClick={onDiscover}>
          ดึงรายการ
        </button>
      </div>

      {(busy || progress > 0 || notice.text) && <Progress progress={progress} busy={busy} status={notice.text || "พร้อมใช้งาน"} />}
      {notice.text && !busy && <div className={`save-notice ${notice.tone}`}>{notice.text}</div>}

      {!!items.length && (
        <>
          <div className="batch-toolbar">
            <div className="chips">
              <span className="chip">{items.length} card</span>
              <span className="chip">{selectedCount} เลือกไว้</span>
              <span className="chip good">{readyCount} พร้อมบันทึก</span>
              <span className="chip">{savedCount} บันทึกแล้ว</span>
            </div>
            <div className="row-actions">
              <button className="subtle-button" disabled={busy} onClick={() => onToggleAll(true)}>
                เลือกทั้งหมด
              </button>
              <button className="subtle-button" disabled={busy} onClick={() => onToggleAll(false)}>
                ไม่เลือกทั้งหมด
              </button>
              <button disabled={busy || selectedCount === 0} onClick={onInspect}>
                ตรวจสอบที่เลือก
              </button>
              <button className="primary-inline" disabled={busy || readyCount === 0} onClick={onSave}>
                บันทึกที่พร้อม
              </button>
            </div>
          </div>

          <div className="batch-list">
            {items.map((item) => (
              <div key={item.url} className={`batch-card ${item.status}`}>
                <label className="batch-check">
                  <input type="checkbox" checked={item.selected} disabled={busy || item.status === "saved"} onChange={(event) => onToggle(item.url, event.target.checked)} />
                </label>
                <ImagePreview src={item.thumbnail} title={item.title} />
                <div className="batch-info">
                  <strong>{item.title}</strong>
                  <a href={item.url} target="_blank" rel="noreferrer">
                    {item.url}
                  </a>
                  {item.form?.sourceUrl && <code>{item.form.sourceUrl}</code>}
                </div>
                <span className={`batch-status ${item.status}`}>{batchStatusText(item)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function VideoEditor({
  form,
  editingId,
  notice,
  canSave,
  onChange,
  onSave
}: {
  form: VideoForm;
  editingId?: number;
  notice: Notice;
  canSave: boolean;
  onChange: (form: VideoForm) => void;
  onSave: () => void;
}) {
  const update = (key: keyof VideoForm, value: string) => onChange({ ...form, [key]: value });
  return (
    <div className="panel editor-panel">
      <div className="panel-head">
        <h2>{editingId ? `แก้ไขวิดีโอ #${editingId}` : "ข้อมูลวิดีโอ"}</h2>
      </div>
      <div className="save-callout">
        <label className="save-type">
          ประเภทหนัง
          <select value={form.category} onChange={(event) => update("category", event.target.value)}>
            {movieTypes.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>
        <button className="primary-save" onClick={onSave} disabled={!canSave}>
          {editingId ? "อัปเดตวิดีโอ" : "บันทึกวิดีโอ"}
        </button>
        <span>{canSave ? "ตรวจข้อมูลให้ถูกต้องแล้วกดบันทึก" : "ต้องมีชื่อ, หน้าต้นทาง และแหล่งวิดีโอตรงก่อนบันทึก"}</span>
        {notice.text && <div className={`save-notice ${notice.tone}`}>{notice.text}</div>}
      </div>
      <div className="editor-grid">
        <label className="wide">
          ชื่อเรื่อง
          <input value={form.title} onChange={(event) => update("title", event.target.value)} />
        </label>
        <label className="wide">
          ประเภทแหล่งวิดีโอ
          <select value={form.sourceType} onChange={(event) => update("sourceType", event.target.value)}>
            <option value="">ไม่มี</option>
            <option value="hls">hls</option>
            <option value="mp4">mp4</option>
            <option value="embed">embed</option>
          </select>
        </label>
        <label className="wide">
          รูปปก
          <input value={form.thumbnail} onChange={(event) => update("thumbnail", event.target.value)} />
        </label>
        <div className="thumb-review">
          <ImagePreview src={form.thumbnail} title={form.title} />
        </div>
        <label className="wide">
          รายละเอียด
          <textarea value={form.description} onChange={(event) => update("description", event.target.value)} />
        </label>
        <label className="wide">
          แหล่งวิดีโอตรง
          <input value={form.sourceUrl} onChange={(event) => update("sourceUrl", event.target.value)} />
        </label>
        <label className="wide">
          URL หน้าต้นทาง
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
        <h2>คลังหนัง</h2>
        <span className="count-pill">{total} เรื่อง</span>
      </div>

      <div className="library-toolbar">
        <input
          value={searchDraft}
          onChange={(event) => onSearchDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") onApplySearch();
          }}
          placeholder="ค้นหาชื่อเรื่อง รายละเอียด หรือ URL"
        />
        <select value={categoryFilter} onChange={(event) => onCategoryFilter(event.target.value)}>
          <option value="All">ทุกหมวดหมู่</option>
          {categories.map((category) => (
            <option key={category.name} value={category.name}>
              {displayCategory(category.name)} ({category.count})
            </option>
          ))}
        </select>
        <button className="subtle-button" onClick={onApplySearch}>
          ค้นหา
        </button>
        <button className="subtle-button" onClick={onClearSearch}>
          ล้าง
        </button>
      </div>

      <div className="table-wrap">
        <table className="video-table">
          <thead>
            <tr>
              <th>หนัง</th>
              <th>หมวดหมู่</th>
              <th>แหล่งวิดีโอ</th>
              <th>จัดการ</th>
            </tr>
          </thead>
          <tbody>
            {videos.map((video) => (
              <tr key={video.id} className={activeId === video.id ? "active" : ""}>
                <td data-label="หนัง">
                  <div className="movie-cell">
                    <ImagePreview src={video.thumbnail} title={video.title} />
                    <div>
                      <strong>{video.title}</strong>
                      <span>#{video.id}</span>
                    </div>
                  </div>
                </td>
                <td data-label="หมวดหมู่">{displayCategory(video.category)}</td>
                <td data-label="แหล่งวิดีโอ">
                  <span className={`source-badge ${video.sourceType === "embed" ? "warn" : ""}`}>{video.sourceType}</span>
                </td>
                <td data-label="จัดการ">
                  <div className="row-actions">
                    <button className="subtle-button" onClick={() => onEdit(video)}>
                      แก้ไข
                    </button>
                    <button className="danger-button" onClick={() => onDelete(video)}>
                      ลบ
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
          ก่อนหน้า
        </button>
        <span>
          หน้า {page} / {pageCount}
        </span>
        <button className="subtle-button" disabled={page >= pageCount} onClick={() => onPage(page + 1)}>
          ถัดไป
        </button>
        <select value={pageSize} onChange={(event) => onPageSize(Number(event.target.value))}>
          <option value={10}>10 รายการ/หน้า</option>
          <option value={20}>20 รายการ/หน้า</option>
          <option value={50}>50 รายการ/หน้า</option>
          <option value={100}>100 รายการ/หน้า</option>
        </select>
      </div>
    </div>
  );
}

function SeriesAdminPage() {
  const [seriesList, setSeriesList] = useState<SeriesRecord[]>([]);
  const [selectedSeriesId, setSelectedSeriesId] = useState<number | undefined>();
  const [seriesUrl, setSeriesUrl] = useState("");
  const [seriesForm, setSeriesForm] = useState<SeriesForm>(emptySeriesForm);
  const [episodeForm, setEpisodeForm] = useState<EpisodeForm>(emptyEpisodeForm);
  const [editingEpisodeId, setEditingEpisodeId] = useState<number | undefined>();
  const [episodeSources, setEpisodeSources] = useState<Candidate[]>([]);
  const [detectedEpisodes, setDetectedEpisodes] = useState<EpisodeForm[]>([]);
  const [seriesNotice, setSeriesNotice] = useState<Notice>({ tone: "idle", text: "" });
  const [episodeNotice, setEpisodeNotice] = useState<Notice>({ tone: "idle", text: "" });
  const [busy, setBusy] = useState(false);
  const [showSeriesEditor, setShowSeriesEditor] = useState(false);
  const [showEpisodeEditor, setShowEpisodeEditor] = useState(false);

  useEffect(() => {
    loadSeries();
  }, []);

  const selectedSeries = seriesList.find((item) => item.id === selectedSeriesId);
  const totalEpisodes = seriesList.reduce((sum, item) => sum + item.episodes.length, 0);
  const hasSeriesDraft = Boolean(selectedSeriesId || seriesForm.title.trim() || seriesForm.pageUrl.trim());

  async function loadSeries(nextSelectedId?: number) {
    const response = await fetch("/api/series");
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "โหลดซีรีส์ไม่สำเร็จ");
    const items = data.series as SeriesRecord[];
    setSeriesList(items);
    const resolvedId = nextSelectedId ?? selectedSeriesId;
    if (resolvedId && items.some((item) => item.id === resolvedId)) {
      setSelectedSeriesId(resolvedId);
      const current = items.find((item) => item.id === resolvedId);
      if (current) setSeriesForm(seriesToForm(current));
    } else {
      setSelectedSeriesId(undefined);
      setSeriesForm(emptySeriesForm);
    }
  }

  async function inspectSeriesPage() {
    if (!seriesUrl.trim()) {
      setSeriesNotice({ tone: "error", text: "กรุณาวาง URL หน้าซีรีส์ก่อนตรวจสอบ" });
      return;
    }
    setBusy(true);
    setSelectedSeriesId(undefined);
    setSeriesNotice({ tone: "loading", text: "กำลังตรวจสอบหน้าซีรีส์และดึงข้อมูล..." });
    setEpisodeNotice({ tone: "idle", text: "" });
    setEpisodeSources([]);
    setShowSeriesEditor(false);
    setShowEpisodeEditor(false);
    try {
      const response = await fetch("/api/admin/inspect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: seriesUrl.trim() })
      });
      const data = (await response.json()) as InspectResult & { error?: string };
      if (!response.ok) throw new Error(data.error || "ตรวจสอบซีรีส์ไม่สำเร็จ");
      const source = data.candidates[0];
      const nextCategory = data.metadata.category || inferCategory(data.metadata.title, data.metadata.description);
      const detected = buildEpisodeDrafts(data, source, seriesUrl.trim());
      setSeriesForm({
        title: data.metadata.title || "",
        description: data.metadata.description || "",
        poster: data.metadata.thumbnail || "",
        category: nextCategory === "ยังไม่จัดหมวด" ? "ซีรีส์" : nextCategory,
        status: "draft",
        pageUrl: data.pageUrl || seriesUrl.trim()
      });
    setDetectedEpisodes(detected);
    setEpisodeForm(detected[0] ?? emptyEpisodeForm);
      setEpisodeSources(data.candidates);
      setEditingEpisodeId(undefined);
      setSeriesNotice({
        tone: "success",
        text: `ดึงข้อมูลซีรีส์แล้ว พบตอน ${detected.length} ตอน และเจอ source ${data.candidates.length} รายการ`
      });
    } catch (error) {
      setSeriesNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  }

  function startNewSeries() {
    setSeriesUrl("");
    setSelectedSeriesId(undefined);
    setSeriesForm(emptySeriesForm);
    setEpisodeForm(emptyEpisodeForm);
    setEditingEpisodeId(undefined);
    setEpisodeSources([]);
    setDetectedEpisodes([]);
    setShowSeriesEditor(false);
    setShowEpisodeEditor(false);
    setSeriesNotice({ tone: "idle", text: "" });
    setEpisodeNotice({ tone: "idle", text: "" });
  }

  function selectSeries(item: SeriesRecord) {
    setSelectedSeriesId(item.id);
    setSeriesForm(seriesToForm(item));
    setEpisodeForm(nextEpisodeForm(item));
    setEditingEpisodeId(undefined);
    setEpisodeSources([]);
    setDetectedEpisodes([]);
    setShowSeriesEditor(false);
    setShowEpisodeEditor(false);
    setSeriesNotice({ tone: "idle", text: "" });
    setEpisodeNotice({ tone: "idle", text: "" });
  }

  async function saveSeries() {
    if (!seriesForm.title.trim()) {
      setSeriesNotice({ tone: "error", text: "กรุณาระบุชื่อซีรีส์" });
      return;
    }
    setSeriesNotice({ tone: "loading", text: selectedSeriesId ? "กำลังอัปเดตซีรีส์..." : "กำลังสร้างซีรีส์..." });
    try {
      const response = await fetch(selectedSeriesId ? `/api/series/${selectedSeriesId}` : "/api/series", {
        method: selectedSeriesId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(seriesForm)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(translateError(data.error || "บันทึกซีรีส์ไม่สำเร็จ"));
      setSeriesNotice({ tone: "success", text: selectedSeriesId ? "อัปเดตซีรีส์แล้ว" : "สร้างซีรีส์แล้ว เพิ่มตอนได้เลย" });
      setEpisodeForm((current) =>
        selectedSeriesId
          ? current
          : {
              ...current,
              episodeNumber: current.episodeNumber || 1,
              title: current.title || "ตอนที่ 1",
              thumbnail: current.thumbnail || data.series.poster,
              pageUrl: current.pageUrl || data.series.pageUrl,
              sourceType: current.sourceType || "hls"
            }
      );
      setEditingEpisodeId(undefined);
      setEpisodeSources([]);
      await loadSeries(data.series.id);
    } catch (error) {
      setSeriesNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    }
  }

  async function saveSeriesAndDetectedEpisodes() {
    if (!seriesForm.title.trim()) {
      setSeriesNotice({ tone: "error", text: "กรุณาตรวจสอบ URL หรือระบุชื่อซีรีส์ก่อนบันทึก" });
      return;
    }
    setSeriesNotice({ tone: "loading", text: `กำลังบันทึกซีรีส์พร้อม ${detectedEpisodes.length} ตอน...` });
    try {
      const seriesResponse = await fetch("/api/series", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(seriesForm)
      });
      const seriesData = await seriesResponse.json();
      if (!seriesResponse.ok) throw new Error(translateError(seriesData.error || "บันทึกซีรีส์ไม่สำเร็จ"));

      for (const episode of detectedEpisodes) {
        const episodeResponse = await fetch(`/api/series/${seriesData.series.id}/episodes`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(episode)
        });
        const episodeData = await episodeResponse.json().catch(() => ({}));
        if (!episodeResponse.ok) throw new Error(translateError(episodeData.error || `บันทึกตอนที่ ${episode.episodeNumber} ไม่สำเร็จ`));
      }

      setSeriesNotice({ tone: "success", text: `บันทึกซีรีส์และตอนทั้งหมดแล้ว (${detectedEpisodes.length} ตอน)` });
      setDetectedEpisodes([]);
      setShowSeriesEditor(false);
      setShowEpisodeEditor(false);
      await loadSeries(seriesData.series.id);
    } catch (error) {
      setSeriesNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    }
  }

  async function deleteSelectedSeries() {
    if (!selectedSeries) return;
    if (!window.confirm(`ลบซีรีส์ "${selectedSeries.title}" พร้อมตอนทั้งหมดใช่ไหม?`)) return;
    const response = await fetch(`/api/series/${selectedSeries.id}`, { method: "DELETE" });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setSeriesNotice({ tone: "error", text: data.error || "ลบซีรีส์ไม่สำเร็จ" });
      return;
    }
    startNewSeries();
    await loadSeries();
  }

  async function inspectEpisode() {
    if (!episodeForm.pageUrl.trim()) {
      setEpisodeNotice({ tone: "error", text: "กรุณาวาง URL หน้าตอนก่อนตรวจสอบ" });
      return;
    }
    setBusy(true);
    setEpisodeNotice({ tone: "loading", text: "กำลังตรวจสอบแหล่งวิดีโอตรงของตอนนี้..." });
    setEpisodeSources([]);
    try {
      const response = await fetch("/api/admin/inspect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: episodeForm.pageUrl.trim() })
      });
      const data = (await response.json()) as InspectResult & { error?: string };
      if (!response.ok) throw new Error(data.error || "ตรวจสอบตอนไม่สำเร็จ");
      const source = data.candidates[0];
      setEpisodeSources(data.candidates);
      setEpisodeForm((current) => ({
        ...current,
        title: current.title || data.metadata.title || `ตอนที่ ${current.episodeNumber}`,
        description: current.description || data.metadata.description || "",
        thumbnail: current.thumbnail || data.metadata.thumbnail || selectedSeries?.poster || "",
        sourceUrl: source?.url ?? current.sourceUrl,
        sourceType: source?.sourceType ?? current.sourceType,
        pageUrl: data.pageUrl || current.pageUrl
      }));
      setEpisodeNotice({
        tone: source ? "success" : "error",
        text: source ? `เจอแหล่งวิดีโอ ${data.candidates.length} รายการ` : "ไม่พบแหล่งวิดีโอตรงของตอนนี้"
      });
    } catch (error) {
      setEpisodeNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  }

  async function saveEpisode() {
    if (!selectedSeries) {
      setEpisodeNotice({ tone: "error", text: "กรุณาสร้างหรือเลือกซีรีส์ก่อน" });
      return;
    }
    if (!episodeForm.title.trim()) {
      setEpisodeNotice({ tone: "error", text: "กรุณาระบุชื่อตอน" });
      return;
    }
    setEpisodeNotice({ tone: "loading", text: editingEpisodeId ? "กำลังอัปเดตตอน..." : "กำลังบันทึกตอน..." });
    try {
      const response = await fetch(editingEpisodeId ? `/api/episodes/${editingEpisodeId}` : `/api/series/${selectedSeries.id}/episodes`, {
        method: editingEpisodeId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(episodeForm)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(translateError(data.error || "บันทึกตอนไม่สำเร็จ"));
      setEpisodeNotice({ tone: "success", text: editingEpisodeId ? "อัปเดตตอนแล้ว" : "เพิ่มตอนแล้ว" });
      setEditingEpisodeId(undefined);
      setEpisodeSources([]);
      await loadSeries(selectedSeries.id);
      const refreshed = seriesList.find((item) => item.id === selectedSeries.id) ?? selectedSeries;
      setEpisodeForm(nextEpisodeForm(refreshed));
    } catch (error) {
      setEpisodeNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    }
  }

  async function saveDetectedEpisodes() {
    if (!selectedSeries || detectedEpisodes.length === 0) return;
    setEpisodeNotice({ tone: "loading", text: `กำลังบันทึก ${detectedEpisodes.length} ตอน...` });
    try {
      for (const episode of detectedEpisodes) {
        const response = await fetch(`/api/series/${selectedSeries.id}/episodes`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(episode)
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(translateError(data.error || `บันทึกตอนที่ ${episode.episodeNumber} ไม่สำเร็จ`));
      }
      setEpisodeNotice({ tone: "success", text: `บันทึกตอนที่ตรวจพบแล้ว ${detectedEpisodes.length} ตอน` });
      setDetectedEpisodes([]);
      await loadSeries(selectedSeries.id);
      setEpisodeForm(nextEpisodeForm(selectedSeries));
    } catch (error) {
      setEpisodeNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    }
  }

  function editEpisode(episode: EpisodeRecord) {
    setEditingEpisodeId(episode.id);
    setEpisodeForm(episodeToForm(episode));
    setEpisodeSources([]);
    setEpisodeNotice({ tone: "idle", text: "" });
  }

  async function deleteEpisodeRecord(episode: EpisodeRecord) {
    if (!window.confirm(`ลบตอน "${episode.title}" ใช่ไหม?`)) return;
    const response = await fetch(`/api/episodes/${episode.id}`, { method: "DELETE" });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setEpisodeNotice({ tone: "error", text: data.error || "ลบตอนไม่สำเร็จ" });
      return;
    }
    setEpisodeNotice({ tone: "success", text: "ลบตอนแล้ว" });
    setEditingEpisodeId(undefined);
    setEpisodeForm(emptyEpisodeForm);
    await loadSeries(selectedSeries?.id);
  }

  const updateSeriesForm = (key: keyof SeriesForm, value: string) => setSeriesForm((current) => ({ ...current, [key]: value }));
  const updateEpisodeForm = (key: keyof EpisodeForm, value: string | number) =>
    setEpisodeForm((current) => ({ ...current, [key]: value }));

  return (
    <main className="admin-shell">
      <header className="admin-topbar">
        <div>
          <h1>หลังบ้านซีรีส์</h1>
          <p>สร้างซีรีส์ จัดการตอน และตรวจสอบแหล่งวิดีโอตรงรายตอน</p>
          <AdminTabs active="series" />
        </div>
        <div className="admin-stats">
          <Stat label="ซีรีส์" value={seriesList.length} />
          <Stat label="ตอน" value={totalEpisodes} />
          <GoogleSheetsExportAction />
          <a className="nav-link" href="/">
            ดูหน้าเว็บ
          </a>
        </div>
      </header>

      <section className="series-admin-grid">
        <div className="admin-left">
          <div className="panel import-panel">
            <div className="panel-head">
              <h2>นำเข้าซีรีส์จาก URL</h2>
              <button className="subtle-button" onClick={startNewSeries}>
                เริ่มใหม่
              </button>
            </div>
            <div className="inspect-row">
              <input
                value={seriesUrl}
                onChange={(event) => setSeriesUrl(event.target.value)}
                placeholder="วางลิงก์หน้าซีรีส์ เช่น https://example.com/series-name/"
              />
              <button disabled={busy || !seriesUrl.trim()} onClick={inspectSeriesPage}>
                ตรวจสอบซีรีส์
              </button>
            </div>
            <p>ระบบจะดึงชื่อเรื่อง รูปปก รายละเอียด และ URL ต้นทางมาใส่ฟอร์มให้ก่อนบันทึก</p>
            {busy && <Progress progress={65} busy={busy} status="กำลังตรวจสอบซีรีส์และค้นหารายการตอน..." />}
            {seriesNotice.text && <div className={`save-notice ${seriesNotice.tone}`}>{seriesNotice.text}</div>}
          </div>

          {!hasSeriesDraft && (
            <div className="panel empty-guide">
              <h2>เริ่มจากวางลิงก์ซีรีส์</h2>
              <p>วาง URL หน้าซีรีส์ด้านบนแล้วกดตรวจสอบ ระบบจะเติมข้อมูลให้ก่อนค่อยบันทึก</p>
            </div>
          )}

          {hasSeriesDraft && !selectedSeries && !showSeriesEditor && (
            <div className="panel inspect-summary">
              <div className="panel-head">
                <h2>ผลตรวจสอบซีรีส์</h2>
                <span className="count-pill">{detectedEpisodes.length} ตอน</span>
              </div>
              <SeriesInspectSummary form={seriesForm} episodes={detectedEpisodes} sourceCount={episodeSources.length} />
              <div className="decision-actions">
                <button className="primary-save" onClick={saveSeriesAndDetectedEpisodes} disabled={seriesNotice.tone === "loading"}>
                  บันทึกซีรีส์และตอนทั้งหมด
                </button>
                <button className="subtle-button" onClick={() => setShowSeriesEditor(true)}>
                  แก้ไขรายละเอียด
                </button>
              </div>
              {seriesNotice.text && <div className={`save-notice ${seriesNotice.tone}`}>{seriesNotice.text}</div>}
            </div>
          )}

          {selectedSeries && !showSeriesEditor && (
            <div className="panel inspect-summary">
              <div className="panel-head">
                <h2>ซีรีส์ที่เลือก</h2>
                <span className="count-pill">{selectedSeries.episodes.length} ตอน</span>
              </div>
              <SeriesInspectSummary form={seriesForm} episodes={selectedSeries.episodes.map(episodeToForm)} sourceCount={0} />
              <div className="decision-actions">
                <button className="primary-save" onClick={() => setShowEpisodeEditor(true)}>
                  เพิ่มตอนเอง
                </button>
                <button className="subtle-button" onClick={() => setShowSeriesEditor(true)}>
                  แก้ไขข้อมูลซีรีส์
                </button>
              </div>
              {seriesNotice.text && <div className={`save-notice ${seriesNotice.tone}`}>{seriesNotice.text}</div>}
            </div>
          )}

          {hasSeriesDraft && showSeriesEditor && (
            <div className="panel editor-panel">
              <div className="panel-head">
                <h2>{selectedSeriesId ? `แก้ไขซีรีส์ #${selectedSeriesId}` : "ตรวจข้อมูลซีรีส์ก่อนบันทึก"}</h2>
                <span className="count-pill">{selectedSeriesId ? "โหมดแก้ไข" : "ข้อมูลจาก URL"}</span>
              </div>
              <div className="editor-grid">
                <label className="wide">
                  ชื่อซีรีส์
                  <input value={seriesForm.title} onChange={(event) => updateSeriesForm("title", event.target.value)} />
                </label>
                <label>
                  หมวดหมู่
                  <select value={seriesForm.category} onChange={(event) => updateSeriesForm("category", event.target.value)}>
                    {movieTypes.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  สถานะ
                  <select value={seriesForm.status} onChange={(event) => updateSeriesForm("status", event.target.value)}>
                    <option value="draft">ร่าง</option>
                    <option value="published">เผยแพร่</option>
                    <option value="hidden">ซ่อน</option>
                  </select>
                </label>
                <label className="wide">
                  รูปปกซีรีส์
                  <input value={seriesForm.poster} onChange={(event) => updateSeriesForm("poster", event.target.value)} />
                </label>
                <div className="thumb-review">
                  <ImagePreview src={seriesForm.poster} title={seriesForm.title} />
                </div>
                <label className="wide">
                  URL ต้นทางของซีรีส์
                  <input value={seriesForm.pageUrl} onChange={(event) => updateSeriesForm("pageUrl", event.target.value)} />
                </label>
                <label className="wide">
                  รายละเอียดซีรีส์
                  <textarea value={seriesForm.description} onChange={(event) => updateSeriesForm("description", event.target.value)} />
                </label>
              </div>
              <div className="save-callout">
                <button className="primary-save" onClick={saveSeries}>
                  {selectedSeriesId ? "อัปเดตซีรีส์" : "บันทึกซีรีส์"}
                </button>
                {selectedSeriesId && (
                  <button className="danger-button tall-button" onClick={deleteSelectedSeries}>
                    ลบซีรีส์นี้
                  </button>
                )}
                {seriesNotice.text && <div className={`save-notice ${seriesNotice.tone}`}>{seriesNotice.text}</div>}
              </div>
            </div>
          )}

          {selectedSeries && showEpisodeEditor && (
            <div className="panel editor-panel">
              <div className="panel-head">
                <h2>{editingEpisodeId ? `แก้ไขตอน #${editingEpisodeId}` : "เพิ่มตอน"}</h2>
                <span className="count-pill">{selectedSeries.title}</span>
              </div>
              <div className="episode-toolbar">
                <label>
                  ตอนที่
                  <input
                    type="number"
                    min={1}
                    value={episodeForm.episodeNumber}
                    onChange={(event) => updateEpisodeForm("episodeNumber", Number(event.target.value))}
                  />
                </label>
                <label>
                  สถานะ
                  <select value={episodeForm.status} onChange={(event) => updateEpisodeForm("status", event.target.value)}>
                    <option value="draft">ร่าง</option>
                    <option value="published">เผยแพร่</option>
                    <option value="hidden">ซ่อน</option>
                  </select>
                </label>
              </div>
              <div className="inspect-row">
                <input
                  value={episodeForm.pageUrl}
                  onChange={(event) => updateEpisodeForm("pageUrl", event.target.value)}
                  placeholder="วางลิงก์หน้าตอนเพื่อค้นหา source"
                />
                <button disabled={busy} onClick={inspectEpisode}>
                  ตรวจสอบตอน
                </button>
              </div>
              {episodeSources.length > 1 && (
                <div className="source-list">
                  {episodeSources.map((source) => (
                    <label key={source.url} className="source-row">
                      <input
                        type="radio"
                        checked={episodeForm.sourceUrl === source.url}
                        onChange={() => {
                          updateEpisodeForm("sourceUrl", source.url);
                          updateEpisodeForm("sourceType", source.sourceType);
                        }}
                      />
                      <span>{source.sourceType}</span>
                      <code>{source.url}</code>
                    </label>
                  ))}
                </div>
              )}
              <div className="editor-grid">
                <label className="wide">
                  ชื่อตอน
                  <input value={episodeForm.title} onChange={(event) => updateEpisodeForm("title", event.target.value)} />
                </label>
                <label className="wide">
                  รูปตอน
                  <input value={episodeForm.thumbnail} onChange={(event) => updateEpisodeForm("thumbnail", event.target.value)} />
                </label>
                <label className="wide">
                  แหล่งวิดีโอตรง
                  <input value={episodeForm.sourceUrl} onChange={(event) => updateEpisodeForm("sourceUrl", event.target.value)} />
                </label>
                <label className="wide">
                  ประเภท source
                  <select value={episodeForm.sourceType} onChange={(event) => updateEpisodeForm("sourceType", event.target.value)}>
                    <option value="hls">hls</option>
                    <option value="mp4">mp4</option>
                    <option value="dash">dash</option>
                  </select>
                </label>
                <label className="wide">
                  รายละเอียดตอน
                  <textarea value={episodeForm.description} onChange={(event) => updateEpisodeForm("description", event.target.value)} />
                </label>
              </div>
              <div className="save-callout">
                <button className="primary-save" disabled={episodeNotice.tone === "loading"} onClick={saveEpisode}>
                  {editingEpisodeId ? "อัปเดตตอน" : "บันทึกตอน"}
                </button>
                <span>วางลิงก์รายตอน กดตรวจสอบตอน แล้วบันทึกเข้าซีรีส์นี้</span>
                {episodeNotice.text && <div className={`save-notice ${episodeNotice.tone}`}>{episodeNotice.text}</div>}
                <button className="subtle-button" onClick={() => setShowEpisodeEditor(false)}>
                  ปิดฟอร์มเพิ่มตอน
                </button>
              </div>
            </div>
          )}

          {selectedSeries && detectedEpisodes.length > 0 && (
            <div className="panel detected-episodes-panel">
              <div className="panel-head">
                <h2>ตอนที่ตรวจพบจาก URL</h2>
                <span className="count-pill">{detectedEpisodes.length} ตอน</span>
              </div>
              <EpisodeDraftList episodes={detectedEpisodes} />
              <button className="primary-save" onClick={saveDetectedEpisodes} disabled={episodeNotice.tone === "loading"}>
                บันทึกตอนที่ตรวจพบทั้งหมด
              </button>
            </div>
          )}
        </div>

        <div className="admin-right">
          {selectedSeries && (
            <div className="panel preview-panel compact">
              <div className="panel-head">
                <h2>ตัวอย่างตอน</h2>
                {!episodeForm.sourceUrl && <span className="warn-label">ยังไม่มี source ของตอน</span>}
              </div>
              <Player source={episodeForm.sourceUrl} sourceType={episodeForm.sourceType} />
            </div>
          )}

          <div className="panel library-panel">
            <div className="panel-head">
              <h2>รายการซีรีส์</h2>
              <span className="count-pill">{seriesList.length} เรื่อง</span>
            </div>
            <div className="series-list">
              {seriesList.length === 0 && <div className="empty-state">ยังไม่มีซีรีส์</div>}
              {seriesList.map((item) => (
                <button
                  key={item.id}
                  className={`series-card ${item.id === selectedSeriesId ? "active" : ""}`}
                  onClick={() => selectSeries(item)}
                >
                  <ImagePreview src={item.poster} title={item.title} />
                  <span>
                    <strong>{item.title}</strong>
                    <small>
                      {displayCategory(item.category)} · {item.episodes.length} ตอน · {displayStatus(item.status)}
                    </small>
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="panel library-panel">
            <div className="panel-head">
              <h2>ตอนในซีรีส์</h2>
              <span className="count-pill">{selectedSeries?.episodes.length ?? 0} ตอน</span>
            </div>
            <div className="episode-list">
              {!selectedSeries && <div className="empty-state">เลือกซีรีส์เพื่อดูรายการตอน</div>}
              {selectedSeries?.episodes.length === 0 && <div className="empty-state">ยังไม่มีตอน</div>}
              {selectedSeries?.episodes.map((episode) => (
                <div className="episode-card" key={episode.id}>
                  <div>
                    <strong>
                      EP.{episode.episodeNumber} {episode.title}
                    </strong>
                    <span>
                      {episode.sourceUrl ? episode.sourceType : "ยังไม่มี source"} · {displayStatus(episode.status)}
                    </span>
                  </div>
                  <div className="row-actions">
                    <button className="subtle-button" onClick={() => editEpisode(episode)}>
                      แก้ไข
                    </button>
                    <button className="danger-button" onClick={() => deleteEpisodeRecord(episode)}>
                      ลบ
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

function CatalogPage() {
  const [videos, setVideos] = useState<VideoRecord[]>([]);
  const [categories, setCategories] = useState<CategorySummary[]>([]);
  const [total, setTotal] = useState(0);
  const [category, setCategory] = useState("All");
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("กำลังโหลด...");

  useEffect(() => {
    loadCatalog();
  }, [category, search]);

  async function loadCatalog() {
    setStatus("กำลังโหลด...");
    try {
      const data = await fetchVideoPage({ page: 1, pageSize: 96, search, category });
      setVideos(data.videos);
      setCategories(data.categories);
      setTotal(data.total);
      setStatus(data.total ? "" : "ไม่พบหนัง");
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
          คลังหนัง
        </a>
        <nav className="category-menu">
          {["All", ...categories.map((item) => item.name)].map((item) => (
            <button key={item} className={category === item ? "active" : ""} onClick={() => setCategory(item)}>
              {item === "All" ? "ทั้งหมด" : displayCategory(item)}
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
            placeholder="ค้นหาหนัง"
          />
        </div>
      </header>

      {featured && (
        <section className="hero-feature">
          <ImagePreview src={featured.thumbnail} fallbackSrc={featured.fallbackThumbnail} title={featured.title} />
          <div className="hero-copy">
            <span className="category-kicker">{displayCategory(featured.category)}</span>
            <h1>{featured.title}</h1>
            <p>{featured.description}</p>
            <div className="hero-actions">
              <a className="play-link" href={`/watch/${featured.id}`}>
                เล่น
              </a>
              <span>มีทั้งหมด {total} เรื่อง</span>
            </div>
          </div>
        </section>
      )}

      <section className="content-rails">
        {status && <div className="empty-state">{status}</div>}
        {Object.entries(grouped).map(([name, items]) => (
          <PosterRail key={name} name={name} items={items} />
        ))}
      </section>
    </main>
  );
}

function PosterRail({ name, items }: { name: string; items: VideoRecord[] }) {
  const rowRef = useRef<HTMLDivElement | null>(null);

  function scrollRail(direction: "left" | "right") {
    const row = rowRef.current;
    if (!row) return;
    row.scrollBy({
      left: direction === "left" ? -row.clientWidth * 0.82 : row.clientWidth * 0.82,
      behavior: "smooth"
    });
  }

  return (
    <div className="rail">
      <div className="rail-head">
        <h2>{displayCategory(name)}</h2>
        <div className="rail-controls" aria-label="เลื่อนรายการหนัง">
          <button type="button" onClick={() => scrollRail("left")} aria-label="เลื่อนไปซ้าย">‹</button>
          <button type="button" onClick={() => scrollRail("right")} aria-label="เลื่อนไปขวา">›</button>
        </div>
      </div>
      <div className="poster-row" ref={rowRef}>
        {items.map((video) => (
          <a className="poster-card" key={video.id} href={`/watch/${video.id}`}>
            <ImagePreview src={video.thumbnail} fallbackSrc={video.fallbackThumbnail} title={video.title} />
            <strong>{video.title}</strong>
          </a>
        ))}
      </div>
    </div>
  );
}

function WatchPage() {
  const id = window.location.pathname.split("/").filter(Boolean).pop();
  const [video, setVideo] = useState<VideoRecord | undefined>();
  const [status, setStatus] = useState("กำลังโหลด...");

  useEffect(() => {
    fetchWatchVideo(id || "")
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
          กลับ
        </a>
      </nav>
      {video ? (
        <MovieWatchLayout video={video} />
      ) : (
        <div className="empty-state">{status}</div>
      )}
    </main>
  );
}

function MovieWatchLayout({ video }: { video: VideoRecord }) {
  return (
    <section className="movie-watch-layout">
      <AdColumn side="left" />
      <div className="movie-watch-main">
        <AdSlot slot="top-wide" />
        <AdSlot slot="hero-wide" />
        <AdSlot slot="pre-player" />
        <h1 className="watch-title-strip">{video.title}</h1>
        <div className="watch-player-frame">
          <div className="player-label">ตัวเล่นหลัก</div>
          <Player source={video.playbackUrl || video.sourceUrl} sourceType={video.sourceType} />
        </div>
        <section className="watch-detail-panel">
          <ImagePreview src={video.thumbnail} fallbackSrc={video.fallbackThumbnail} title={video.title} />
          <div>
            <span className="category-kicker">{displayCategory(video.category)}</span>
            <h2>{video.title}</h2>
            <p>{video.description || "ไม่มีรายละเอียด"}</p>
          </div>
        </section>
      </div>
      <AdColumn side="right" />
    </section>
  );
}

function AdColumn({ side }: { side: "left" | "right" }) {
  return (
    <aside className={`ad-column ${side}`}>
      <AdSlot slot={`${side}-tower-1`} />
      <AdSlot slot={`${side}-tower-2`} />
      <AdSlot slot={`${side}-tower-3`} />
    </aside>
  );
}

function AdSlot({ slot }: { slot: string }) {
  const size = getAdSlotSize(slot);
  return (
    <div className={`ad-slot ${slot}`}>
      <span>พื้นที่โฆษณา</span>
      <strong>{slot}</strong>
      <small>{size}</small>
    </div>
  );
}

function getAdSlotSize(slot: string): string {
  if (slot.includes("tower")) return "แนะนำ 300 x 600 px";
  if (slot === "pre-player") return "แนะนำ 970 x 250 px";
  if (slot === "top-wide" || slot === "hero-wide") return "แนะนำ 970 x 90 px";
  return "แนะนำ 728 x 90 px";
}

async function promptRemotePlayback(video: HTMLVideoElement | null, setCastStatus: (value: string) => void) {
  const remote = (video as unknown as { remote?: { prompt?: () => Promise<void> } } | null)?.remote;
  if (!remote?.prompt) {
    setCastStatus("อุปกรณ์หรือ browser นี้ยังไม่รองรับการเชื่อมต่อทีวี");
    return;
  }
  try {
    await remote.prompt();
    setCastStatus("กำลังเชื่อมต่อทีวี...");
  } catch {
    setCastStatus("ยังไม่ได้เชื่อมต่อทีวี");
  }
}

function Player({ source, sourceType }: { source: string; sourceType: string }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [status, setStatus] = useState(source ? "กำลังโหลดเครื่องเล่น..." : "ยังไม่ได้เลือกแหล่งวิดีโอ");
  const [castStatus, setCastStatus] = useState("");

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let hls: Hls | undefined;

    video.pause();
    video.removeAttribute("src");
    video.load();

    if (!source) {
      setStatus("ยังไม่ได้เลือกแหล่งวิดีโอ");
      return;
    }

    if (sourceType === "embed" || source.includes("/embed")) {
      setStatus("โหลด embedded fallback แล้ว อาจมี UI หรือโฆษณาจากเว็บภายนอก");
      return;
    }

    const onLoaded = () => setStatus(`โหลดแล้ว ${video.videoWidth}x${video.videoHeight}, ${formatDuration(video.duration)}`);
    const onPlaying = () => setStatus(`กำลังเล่น ${video.videoWidth}x${video.videoHeight}, ${formatDuration(video.duration)}`);
    const onError = () => setStatus(video.error?.message ? `เล่นไม่ได้: ${video.error.message}` : "เล่นไม่ได้");
    video.addEventListener("loadedmetadata", onLoaded);
    video.addEventListener("playing", onPlaying);
    video.addEventListener("error", onError);

    if ((sourceType === "hls" || source.includes(".m3u8")) && Hls.isSupported()) {
      hls = new Hls({ debug: false });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) setStatus(`HLS error: ${data.type} / ${data.details}`);
      });
      hls.loadSource(source);
      hls.attachMedia(video);
      video.play().catch(() => undefined);
    } else {
      video.src = source;
      video.play().catch((error) => setStatus(`เล่นไม่ได้: ${error.message}`));
    }

    return () => {
      hls?.destroy();
      video.removeEventListener("loadedmetadata", onLoaded);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("error", onError);
    };
  }, [source, sourceType]);

  if (!source) {
    return (
      <div>
        <div className="player-empty">
          <strong>ยังไม่มีแหล่งวิดีโอตรง</strong>
          <span>ระบบยังไม่พบแหล่งวิดีโอที่นำมาเล่นหรือบันทึกได้จากหน้านี้</span>
        </div>
        <div className="player-status">{status}</div>
      </div>
    );
  }

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
      <video
        className="player-video"
        ref={videoRef}
        controls
        playsInline
        controlsList="nodownload noplaybackrate noremoteplayback"
        disablePictureInPicture
        onContextMenu={(event) => event.preventDefault()}
      />
      <button className="cast-button" type="button" onClick={() => promptRemotePlayback(videoRef.current, setCastStatus)}>
        เชื่อมต่อทีวี
      </button>
      {castStatus && <div className="player-status">{castStatus}</div>}
      <div className="player-status">{status}</div>
    </div>
  );
}

function ImagePreview({ src, title, fallbackSrc }: { src: string; title: string; fallbackSrc?: string }) {
  const [activeSrc, setActiveSrc] = useState(src || fallbackSrc || "");
  useEffect(() => setActiveSrc(src || fallbackSrc || ""), [src, fallbackSrc]);
  if (!activeSrc) return <div className="image-fallback">ไม่มีรูป</div>;
  return (
    <img
      className="image-preview"
      src={activeSrc}
      alt={title}
      referrerPolicy="no-referrer"
      onError={() => {
        if (fallbackSrc && activeSrc !== fallbackSrc) {
          setActiveSrc(fallbackSrc);
          return;
        }
        setActiveSrc("");
      }}
    />
  );
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
  try {
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Load failed");
    return data;
  } catch (error) {
    return fetchStaticVideoPage({ page, pageSize, search, category });
  }
}

async function fetchStaticVideoPage({
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
  const response = await fetch("/data/videos.json");
  const data = (await response.json()) as Pick<VideoPage, "videos" | "total" | "categories">;
  if (!response.ok) throw new Error("Load failed");
  const searchText = search.trim().toLowerCase();
  const filtered = data.videos.filter((video) => {
    const matchesCategory = !category || category === "All" || video.category === category;
    const matchesSearch =
      !searchText ||
      `${video.title} ${video.description} ${video.pageUrl}`.toLowerCase().includes(searchText);
    return matchesCategory && matchesSearch;
  });
  const offset = (page - 1) * pageSize;
  return {
    videos: filtered.slice(offset, offset + pageSize),
    total: filtered.length,
    page,
    pageSize,
    categories: data.categories
  };
}

async function fetchWatchVideo(id: string): Promise<{ video: VideoRecord; error?: string }> {
  try {
    const response = await fetch(`/api/watch/${encodeURIComponent(id)}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Load failed");
    return data;
  } catch {
    const staticData = await fetchStaticVideoPage({ page: 1, pageSize: 100, search: "", category: "All" });
    const video = staticData.videos.find((item) => String(item.id) === String(id));
    if (!video) throw new Error("Video not found");
    return { video };
  }
}

function recordToForm(video: VideoRecord): VideoForm {
  return {
    title: video.title,
    description: video.description,
    thumbnail: video.thumbnail,
    category: displayCategory(video.category),
    pageUrl: video.pageUrl,
    sourceUrl: video.sourceUrl,
    sourceType: video.sourceType
  };
}

function seriesToForm(series: SeriesRecord): SeriesForm {
  return {
    title: series.title,
    description: series.description,
    poster: series.poster,
    category: displayCategory(series.category),
    status: series.status,
    pageUrl: series.pageUrl
  };
}

function episodeToForm(episode: EpisodeRecord): EpisodeForm {
  return {
    episodeNumber: episode.episodeNumber,
    title: episode.title,
    description: episode.description,
    thumbnail: episode.thumbnail,
    pageUrl: episode.pageUrl,
    sourceUrl: episode.sourceUrl,
    sourceType: episode.sourceType || "hls",
    status: episode.status || "draft"
  };
}

function buildEpisodeDrafts(result: InspectResult, firstSource: Candidate | undefined, fallbackUrl: string): EpisodeForm[] {
  const detected = result.episodes ?? [];
  if (detected.length === 0) {
    return [
      {
        ...emptyEpisodeForm,
        episodeNumber: 1,
        title: firstSource ? result.metadata.title || "ตอนที่ 1" : "ตอนที่ 1",
        description: result.metadata.description || "",
        thumbnail: result.metadata.thumbnail || "",
        pageUrl: result.pageUrl || fallbackUrl,
        sourceUrl: firstSource?.url ?? "",
        sourceType: firstSource?.sourceType ?? "hls"
      }
    ];
  }

  return detected.map((episode) => ({
    ...emptyEpisodeForm,
    episodeNumber: episode.episodeNumber,
    title: episode.title || `ตอนที่ ${episode.episodeNumber}`,
    description: result.metadata.description || "",
    thumbnail: result.metadata.thumbnail || "",
    pageUrl: episode.pageUrl || result.pageUrl || fallbackUrl,
    sourceUrl: episode.sourceUrl || "",
    sourceType: episode.sourceType || "hls"
  }));
}

function nextEpisodeForm(series: SeriesRecord): EpisodeForm {
  const maxEpisode = series.episodes.reduce((max, episode) => Math.max(max, episode.episodeNumber), 0);
  return {
    ...emptyEpisodeForm,
    episodeNumber: maxEpisode + 1,
    thumbnail: series.poster,
    title: `ตอนที่ ${maxEpisode + 1}`,
    pageUrl: series.pageUrl
  };
}

function getDefaultSource(result: InspectResult): Candidate | undefined {
  return result.candidates[0];
}

async function checkSourceHealth(sourceUrl: string): Promise<SourceHealthResult> {
  const response = await fetch("/api/admin/source-health", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourceUrl })
  });
  const data = (await response.json().catch(() => ({}))) as SourceHealthResult & { error?: string };
  if (!response.ok || !data.ok) {
    throw new Error(data.reason || data.error || "source เล่นไม่ได้");
  }
  return data;
}

function formatResultStatus(result: InspectResult): string {
  if (result.candidates.length === 1) return "พร้อมบันทึก";
  if (result.candidates.length > 1) return "พบแหล่งวิดีโอตรงหลายรายการ กรุณาเลือกรายการที่ถูกต้อง";
  if (result.fallbackEmbeds.length) return "ไม่พบแหล่งวิดีโอตรง พบเฉพาะตัวเล่นสำรอง";
  return "ไม่พบแหล่งวิดีโอตรง";
}

function inferCategory(title: string, description: string) {
  const text = `${title} ${description}`.toLowerCase();
  const matches = [
    ["action", "แอ็กชัน"],
    ["adventure", "ผจญภัย"],
    ["animation", "อนิเมชัน"],
    ["comedy", "ตลก"],
    ["crime", "อาชญากรรม"],
    ["drama", "ดราม่า"],
    ["fantasy", "แฟนตาซี"],
    ["horror", "สยองขวัญ"],
    ["romance", "โรแมนติก"],
    ["sci-fi", "ไซไฟ"],
    ["science fiction", "ไซไฟ"],
    ["thriller", "ระทึกขวัญ"]
  ];
  return matches.find(([keyword]) => text.includes(keyword))?.[1] ?? "ยังไม่จัดหมวด";
}

function groupByCategory(videos: VideoRecord[]) {
  return videos.reduce<Record<string, VideoRecord[]>>((groups, video) => {
    const category = video.category?.trim() || "Uncategorized";
    groups[category] = [...(groups[category] ?? []), video];
    return groups;
  }, {});
}

function formatDuration(value: number) {
  if (!Number.isFinite(value)) return "ไม่ทราบความยาว";
  const seconds = Math.round(value);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function displayCategory(value: string) {
  if (!value || value === "Uncategorized") return "ยังไม่จัดหมวด";
  const legacy: Record<string, string> = {
    Action: "แอ็กชัน",
    Adventure: "ผจญภัย",
    Animation: "อนิเมชัน",
    Comedy: "ตลก",
    Crime: "อาชญากรรม",
    Drama: "ดราม่า",
    Fantasy: "แฟนตาซี",
    Horror: "สยองขวัญ",
    Romance: "โรแมนติก",
    "Sci-Fi": "ไซไฟ",
    Thriller: "ระทึกขวัญ",
    Documentary: "สารคดี",
    Series: "ซีรีส์",
    War: "สงคราม"
  };
  if (legacy[value]) return legacy[value];
  return value;
}

function displayStatus(value: string) {
  if (value === "published") return "เผยแพร่";
  if (value === "hidden") return "ซ่อน";
  return "ร่าง";
}

function batchStatusText(item: BatchCard) {
  if (item.status === "pending") return "รอตรวจสอบ";
  if (item.status === "inspecting") return "กำลังตรวจสอบ";
  if (item.status === "ready") return "พร้อมบันทึก";
  if (item.status === "review") return item.message || "ต้องตรวจเอง";
  if (item.status === "saved") return "บันทึกแล้ว";
  return item.message || "ผิดพลาด";
}

function translateWarning(value: string) {
  if (value.includes("No direct video source found")) return "ไม่พบแหล่งวิดีโอตรง";
  if (value.includes("Multiple direct video sources")) return "พบแหล่งวิดีโอตรงหลายรายการ กรุณาเลือกก่อนบันทึก";
  if (value.includes("Embedded fallback")) return "พบเฉพาะตัวเล่นสำรอง ซึ่งไม่ใช่แหล่งวิดีโอตรง และอาจมี UI/โฆษณาจากเว็บอื่น";
  return value;
}

function translateError(value: string) {
  if (value.includes("Title is required")) return "กรุณาระบุชื่อเรื่อง";
  if (value.includes("Source URL is required")) return "กรุณาระบุแหล่งวิดีโอตรง";
  if (value.includes("Page URL is required")) return "กรุณาระบุ URL หน้าต้นทาง";
  if (value.includes("Blocked ad")) return "Source นี้เป็นโฆษณาหรือ tracker ระบบไม่อนุญาตให้บันทึก";
  if (value.includes("Blocked sidecar")) return "Source นี้เป็น playlist ย่อย ระบบไม่อนุญาตให้บันทึก";
  if (value.includes("Video not found")) return "ไม่พบวิดีโอ";
  return value;
}

function initializeLiffIfConfigured() {
  const win = window as unknown as {
    liff?: { init: (options: { liffId: string }) => Promise<void> };
    SSI_LIFF_ID?: string;
  };
  const liffId = win.SSI_LIFF_ID || document.querySelector<HTMLMetaElement>("meta[name='liff-id']")?.content || "";
  if (!liffId || win.liff === undefined) return;
  win.liff.init({ liffId }).catch(() => undefined);
}

function getLiffId() {
  return document.querySelector<HTMLMetaElement>("meta[name='liff-id']")?.content || "2010511616-ZBXEZgi4";
}

function isLocalDevHost() {
  return ["localhost", "127.0.0.1"].includes(window.location.hostname);
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
