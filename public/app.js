const catalogEl = document.querySelector("#catalog");
const statusEl = document.querySelector("#catalog-status");

loadCatalog();

async function loadCatalog() {
  statusEl.textContent = "Loading...";
  try {
    const response = await fetch("/api/videos");
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Load failed");
    renderCatalog(data.videos || []);
    statusEl.textContent = data.videos?.length ? "" : "No videos saved yet.";
  } catch (error) {
    statusEl.textContent = error instanceof Error ? error.message : String(error);
  }
}

function renderCatalog(videos) {
  catalogEl.innerHTML = videos
    .map(
      (video) => `
        <a class="movie-card" href="/watch/${video.id}">
          <div class="poster">
            ${video.thumbnail ? `<img src="${escapeHtml(video.thumbnail)}" alt="${escapeHtml(video.title)}" />` : `<span>No image</span>`}
          </div>
          <div class="movie-title">${escapeHtml(video.title)}</div>
        </a>
      `
    )
    .join("");
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" };
    return map[char];
  });
}
