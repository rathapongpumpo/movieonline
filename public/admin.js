const urlInput = document.querySelector("#admin-url");
const inspectButton = document.querySelector("#inspect-url");
const statusEl = document.querySelector("#admin-status");
const sourceChoiceEl = document.querySelector("#source-choice");
const player = document.querySelector("#admin-player");
const embed = document.querySelector("#admin-embed");
const playerStatusEl = document.querySelector("#admin-player-status");
const titleInput = document.querySelector("#video-title");
const thumbnailInput = document.querySelector("#video-thumbnail");
const thumbnailPreview = document.querySelector("#thumbnail-preview");
const descriptionInput = document.querySelector("#video-description");
const sourceInput = document.querySelector("#video-source");
const pageUrlInput = document.querySelector("#video-page-url");
const saveButton = document.querySelector("#save-video");
const saveStatusEl = document.querySelector("#save-status");

let controller;
let hls;

inspectButton.addEventListener("click", inspectUrl);
urlInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") inspectUrl();
});
thumbnailInput.addEventListener("input", updateThumbnailPreview);
sourceChoiceEl.addEventListener("change", (event) => {
  if (!event.target.matches("input[name='source']")) return;
  applySource(event.target.value);
});
saveButton.addEventListener("click", saveVideo);

async function inspectUrl() {
  const url = urlInput.value.trim();
  if (!url) return;
  controller?.abort();
  controller = new AbortController();
  statusEl.textContent = "Inspecting...";
  sourceChoiceEl.innerHTML = "";
  sourceInput.value = "";
  saveButton.disabled = true;
  saveStatusEl.textContent = "";
  playerStatusEl.textContent = "";
  player.hidden = true;
  embed.hidden = true;

  try {
    const response = await fetch("/api/admin/inspect", {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Inspect failed");
    renderInspectResult(data);
  } catch (error) {
    if (error.name === "AbortError") return;
    statusEl.textContent = error instanceof Error ? error.message : String(error);
  }
}

function renderInspectResult(data) {
  titleInput.value = data.metadata?.title || "";
  thumbnailInput.value = data.metadata?.thumbnail || "";
  updateThumbnailPreview();
  descriptionInput.value = data.metadata?.description || "";
  pageUrlInput.value = data.pageUrl || "";
  sourceInput.value = "";
  saveButton.disabled = true;
  player.hidden = true;
  embed.hidden = true;
  playerStatusEl.textContent = "";

  const warnings = data.warnings || [];
  statusEl.textContent = warnings.length ? warnings.join(" ") : "Ready to save.";

  if (!data.candidates?.length) {
    sourceChoiceEl.innerHTML = [
      `<div class="empty">No direct video source found</div>`,
      renderFallbackEmbeds(data.fallbackEmbeds || [])
    ].join("");
    if (data.fallbackEmbeds?.[0]) {
      saveButton.disabled = false;
      applySource(data.fallbackEmbeds[0].url);
    }
    return;
  }

  sourceChoiceEl.innerHTML = data.candidates
    .map((candidate, index) => {
      const checked = index === 0 ? "checked" : "";
      return `
        <label class="source-option">
          <input type="radio" name="source" value="${escapeHtml(candidate.url)}" ${checked} />
          <span>${escapeHtml(candidate.kind)} / ${escapeHtml(candidate.displayedAs)}</span>
          <span>${escapeHtml(candidate.sourceType || "")}</span>
          <code>${escapeHtml(candidate.url)}</code>
          ${candidate.sourceType === "embed" ? `<em>Embedded fallback may include third-party UI or ads.</em>` : ""}
        </label>
      `;
    })
    .join("");

  saveButton.disabled = false;
  applySource(data.candidates[0].url);
}

function renderFallbackEmbeds(embeds) {
  if (!embeds.length) return "";
  return `
    <div class="fallback-box">
      <strong>Fallback embeds</strong>
      <p>These can display a third-party player, but they are not direct video sources.</p>
      ${embeds
        .map(
          (embed, index) => `
            <label class="fallback-item">
              <input type="radio" name="source" value="${escapeHtml(embed.url)}" ${index === 0 ? "checked" : ""} />
              <span>${escapeHtml(embed.kind)} / ${escapeHtml(embed.displayedAs)}</span>
              <span>embed</span>
              <code>${escapeHtml(embed.url)}</code>
              <em>Fallback embed may include third-party UI or ads.</em>
            </label>
          `
        )
        .join("")}
    </div>
  `;
}

function updateThumbnailPreview() {
  const url = thumbnailInput.value.trim();
  thumbnailPreview.hidden = !url;
  if (url) thumbnailPreview.src = url;
}

function applySource(source) {
  sourceInput.value = source;
  loadPlayer(source);
}

function loadPlayer(source) {
  if (hls) {
    hls.destroy();
    hls = undefined;
  }
  const sourceType = selectedSourceType();
  if (sourceType === "embed" || source.includes("/embed")) {
    player.hidden = true;
    embed.hidden = false;
    embed.src = source;
    playerStatusEl.textContent = "Loaded embedded fallback. It may include third-party UI or ads.";
    return;
  }

  embed.hidden = true;
  player.hidden = false;
  player.pause();
  player.removeAttribute("src");
  player.load();
  playerStatusEl.textContent = "Loading...";

  player.onloadedmetadata = () => {
    playerStatusEl.textContent = `Loaded ${player.videoWidth}x${player.videoHeight}, ${formatDuration(player.duration)}.`;
  };
  player.onplaying = () => {
    playerStatusEl.textContent = `Playing ${player.videoWidth}x${player.videoHeight}, ${formatDuration(player.duration)}.`;
  };
  player.onerror = () => {
    playerStatusEl.textContent = player.error?.message ? `Playback error: ${player.error.message}` : "Playback error.";
  };

  if (source.includes(".m3u8") && window.Hls?.isSupported()) {
    hls = new window.Hls({ debug: false });
    hls.on(window.Hls.Events.ERROR, (_event, data) => {
      if (data.fatal) playerStatusEl.textContent = `Fatal HLS error: ${data.type} / ${data.details}`;
    });
    hls.loadSource(source);
    hls.attachMedia(player);
    player.play().catch(() => undefined);
    return;
  }

  player.src = source;
  player.play().catch((error) => {
    playerStatusEl.textContent = `Playback failed: ${error.message}`;
  });
}

async function saveVideo() {
  saveStatusEl.textContent = "Saving...";
  try {
    const response = await fetch("/api/videos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: titleInput.value,
        thumbnail: thumbnailInput.value,
        description: descriptionInput.value,
        sourceUrl: sourceInput.value,
        pageUrl: pageUrlInput.value,
        sourceType: selectedSourceType(),
        duration: Number.isFinite(player.duration) ? player.duration : null
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Save failed");
    saveStatusEl.innerHTML = `Saved. <a href="/watch/${data.video.id}">Open video</a>`;
  } catch (error) {
    saveStatusEl.textContent = error instanceof Error ? error.message : String(error);
  }
}

function selectedSourceType() {
  const checked = document.querySelector("input[name='source']:checked");
  const value = checked?.closest(".source-option")?.querySelector("span:nth-of-type(2)")?.textContent?.trim();
  if (value) return value;
  if (sourceInput.value.includes(".m3u8")) return "hls";
  if (sourceInput.value.includes("/embed")) return "embed";
  return "mp4";
}

function formatDuration(value) {
  if (!Number.isFinite(value)) return "unknown duration";
  const seconds = Math.round(value);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" };
    return map[char];
  });
}
