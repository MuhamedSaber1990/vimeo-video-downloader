// server.js
import express from "express";
import http from "http";
import { WebSocketServer } from "ws";
import bodyParser from "body-parser";
import path from "path";
import fs from "fs";

import { downloadVimeoPrivateVideo } from "./vimeoDownloader.js";
import { uploadToGoogleDrive } from "./google-drive-client.js";

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const clients = new Set();

wss.on("connection", (ws) => {
  clients.add(ws);
  ws.on("close", () => clients.delete(ws));
});

function broadcast(dataObj) {
  const message = JSON.stringify(dataObj);
  for (const ws of clients) {
    if (ws.readyState === ws.OPEN) {
      ws.send(message);
    }
  }
}

// Serve static files from /public and parse JSON bodies
app.use(express.static(path.join(process.cwd(), "public")));
app.use(bodyParser.json());

/**
 * POST /api/download
 * Body: { vimeoUrl: string, filename?: string }
 *
 * 1) Convert standard Vimeo URL → player URL if needed
 * 2) Pick a local path under ./downloads/…
 * 3) Await downloadVimeoPrivateVideo(...) so the file is 100% written
 * 4) Once download finishes, call uploadToGoogleDrive(...)
 * 5) Broadcast progress/completion via WebSocket
 */
app.post("/api/download", async (req, res) => {
  let { vimeoUrl, filename } = req.body;

  if (!vimeoUrl) {
    return res.status(400).json({ error: "Missing vimeoUrl" });
  }

  // 1) Convert a “https://vimeo.com/123456789” → “https://player.vimeo.com/video/123456789”
  const match = vimeoUrl.match(/vimeo\.com\/(\d+)(?:$|[/?])/);
  if (match && match[1]) {
    vimeoUrl = `https://player.vimeo.com/video/${match[1]}`;
  }

  // 2) Determine a local file path under ./downloads/
  let localPath;
  if (filename && filename.trim() !== "") {
    localPath = path.join(process.cwd(), "downloads", `${filename.trim()}.mp4`);
  } else {
    // If no custom filename, use the numeric ID or a timestamp
    const idMatch = vimeoUrl.match(/video\/(\d+)(?:$|[/?])/);
    const id = idMatch ? idMatch[1] : Date.now().toString();
    localPath = path.join(process.cwd(), "downloads", `${id}.mp4`);
  }

  // Ensure the ./downloads directory exists
  fs.mkdirSync(path.dirname(localPath), { recursive: true });

  // 3) Immediately respond so the front‐end knows the job started
  res.json({ status: "started" });

  try {
    // ───────────────────────────────────────────────────────────────────────────────
    // 4a) Download the Vimeo video into localPath, reporting progress via WebSocket
    // ───────────────────────────────────────────────────────────────────────────────
    await downloadVimeoPrivateVideo(
      vimeoUrl,
      "https://player.vimeo.com/",
      localPath,
      600, // this is the default duration (seconds) if you aren’t sending “duration” from client
      "[Server] ", // a prefix for any console logs or progress messages
      (progressData) => {
        // Every time downloadVimeoPrivateVideo calls `onProgress(...)`,
        // we broadcast that data over WebSocket so the front‐end can update its bar.
        broadcast(progressData);
      }
    );

    // At this point the MP4 is fully written to disk (downloadVimeoPrivateVideo() has resolved).
    // Let’s double‐check:
    const stats = fs.statSync(localPath);
    console.log(
      `DEBUG: Local file written: ${localPath} (${stats.size} bytes)`
    );

    // ───────────────────────────────────────────────────────────────────────────────
    // 4b) Upload the now‐complete MP4 into Google Drive under “VimeoDownloads/<filename>.mp4”
    // ───────────────────────────────────────────────────────────────────────────────
    const driveFolderName = "VimeoDownloads"; // top‐level folder in the user’s Drive
    const driveFileName = path.basename(localPath); // e.g. "123456789.mp4" or "my-video.mp4"

    await uploadToGoogleDrive(localPath, driveFolderName, driveFileName);

    // Once Google Drive upload finishes, broadcast a “gdrive_upload_complete” event
    broadcast({ type: "gdrive_upload_complete", file: driveFileName });
  } catch (err) {
    console.error("Error in download or upload:", err);
    // If anything goes wrong (download or upload), send an error message to the front‐end
    broadcast({ type: "error", message: err.message || String(err) });
  }
});

// Start listening
const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Server listening at http://localhost:${PORT}`);
});
