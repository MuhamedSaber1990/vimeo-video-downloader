document.addEventListener("DOMContentLoaded", () => {
  const vimeoUrlInput = document.getElementById("vimeoUrl");
  const downloadBtn = document.getElementById("downloadBtn");
  const downloadBtnText = document.getElementById("downloadBtnText");
  const statusDiv = document.getElementById("status");
  const progressContainer = document.getElementById("progressContainer");
  const progressFill = document.getElementById("progressFill");
  const progressText = document.getElementById("progressText");

  let ws = null;

  function showStatus(message, type) {
    statusDiv.textContent = message;
    statusDiv.className = `status ${type}`;
    statusDiv.style.display = "block";
  }

  function hideStatus() {
    statusDiv.style.display = "none";
  }

  function connectWebSocket() {
    const wsUrl = `ws://${location.host}`;
    console.log("▶️ Connecting to WebSocket at", wsUrl);
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log("✅ WebSocket connected.");
    };
    ws.onclose = () => {
      console.warn("⚠️ WebSocket closed, retrying in 3s…");
      setTimeout(connectWebSocket, 3000);
    };
    ws.onerror = (err) => {
      console.error("❌ WebSocket error:", err);
    };
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      console.log("📩 WS message:", data);
      handleProgressUpdate(data);
    };
  }

  function handleProgressUpdate(data) {
    switch (data.type) {
      case "progress":
        updateProgress(data.percentage, data.status);
        break;
      case "complete":
        showStatus(
          "🎉 Download complete. Now uploading to Google Drive…",
          "info"
        );
        break;
      case "error":
        showStatus("❌ Error: " + data.message, "error");
        resetUI();
        break;
      case "gdrive_upload_complete":
        showStatus("✔︎ Uploaded to Google Drive: " + data.file, "success");
        resetUI();
        break;
      default:
        console.warn("ℹ️ Unknown WS message type:", data.type);
    }
  }

  function updateProgress(percent, status) {
    progressContainer.style.display = "block";
    progressFill.style.width = `${percent}%`;
    progressText.textContent = `${status} – ${percent}%`;
  }

  function resetUI() {
    downloadBtn.disabled = false;
    downloadBtnText.innerHTML = "Download Video";
    progressContainer.style.display = "none";
    progressFill.style.width = "0%";
    hideStatus();
  }

  downloadBtn.addEventListener("click", async () => {
    const vimeoUrl = vimeoUrlInput.value.trim();
    if (!vimeoUrl) {
      showStatus("⚠️ Please enter a valid Vimeo URL", "error");
      return;
    }

    downloadBtn.disabled = true;
    downloadBtnText.innerHTML = '<span class="loader"></span> Starting…';
    showStatus("🟢 Download initiated…", "info");

    try {
      // Ensure WebSocket is connected
      if (!ws || ws.readyState === WebSocket.CLOSED) {
        connectWebSocket();
      }

      const response = await axios.post("/api/download", {
        vimeoUrl,
      });
      if (response.status === 200) {
        showStatus("🚀 Server has started processing your request.", "info");
      } else {
        throw new Error("Server error: " + response.statusText);
      }
    } catch (err) {
      console.error("🔴 /api/download error:", err);
      showStatus("❌ " + (err.response?.data?.error || err.message), "error");
      resetUI();
    }
  });

  // Kick off the first WebSocket connection
  connectWebSocket();
});
