const player = document.querySelector("#watch-player");
const embed = document.querySelector("#watch-embed");
const statusEl = document.querySelector("#watch-status");
const titleEl = document.querySelector("#watch-title");
const descriptionEl = document.querySelector("#watch-description");
const thumbEl = document.querySelector("#watch-thumb");
let hls;

const id = location.pathname.split("/").filter(Boolean).pop();
loadVideo(id);

async function loadVideo(videoId) {
  statusEl.textContent = "Loading...";
  try {
    const response = await fetch(`/api/videos/${encodeURIComponent(videoId)}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Load failed");
    renderVideo(data.video);
  } catch (error) {
    statusEl.textContent = error instanceof Error ? error.message : String(error);
  }
}

function renderVideo(video) {
  document.title = video.title;
  titleEl.textContent = video.title;
  descriptionEl.textContent = video.description || "";
  if (video.thumbnail) {
    thumbEl.src = video.thumbnail;
  } else {
    thumbEl.hidden = true;
  }
  loadPlayer(video.sourceUrl, video.sourceType);
}

function loadPlayer(source, sourceType = "") {
  statusEl.textContent = "Loading player...";
  if (sourceType === "embed" || source.includes("/embed")) {
    player.hidden = true;
    embed.hidden = false;
    embed.src = source;
    statusEl.textContent = "Loaded embedded player.";
    return;
  }

  embed.hidden = true;
  player.hidden = false;
  player.onloadedmetadata = () => {
    statusEl.textContent = `Loaded ${player.videoWidth}x${player.videoHeight}.`;
  };
  player.onplaying = () => {
    statusEl.textContent = "Playing.";
  };
  player.onerror = () => {
    statusEl.textContent = player.error?.message ? `Playback error: ${player.error.message}` : "Playback error.";
  };

  if (source.includes(".m3u8") && window.Hls?.isSupported()) {
    hls = new window.Hls({ debug: false });
    hls.on(window.Hls.Events.ERROR, (_event, data) => {
      if (data.fatal) statusEl.textContent = `Fatal HLS error: ${data.type} / ${data.details}`;
    });
    hls.loadSource(source);
    hls.attachMedia(player);
    player.play().catch(() => undefined);
    return;
  }

  player.src = source;
  player.play().catch((error) => {
    statusEl.textContent = `Playback failed: ${error.message}`;
  });
}
