// server.js
import express from "express";
import http from "http";
import { WebSocketServer } from "ws";
import bodyParser from "body-parser";
import path from "path";
import fs from "fs";

// ───────────────────────────────────────────────────────────────────────────────
// 1) ■ Import the Google‐auth router so Express “knows” about /auth/google/…
// ───────────────────────────────────────────────────────────────────────────────
import authRouter from "./auth-google.js";  // :contentReference[oaicite:0]{index=0}

import { downloadVimeoPrivateVideo } from "./vimeoDownloader.js";
import { uploadToGoogleDrive } from "./google-drive-client.js";

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const clients = new Set();

// ───────────────────────────────────────────────────────────────────────────────
// 2) Mount authRouter BEFORE static or API routes
//    This ensures /auth/google/login and /auth/google/callback actually work.
// ───────────────────────────────────────────────────────────────────────────────
app.use(authRouter);   // now Express knows about /auth/google/… :contentReference[oaicite:1]{index=1}

// ───────────────────────────────────────────────────────────────────────────────
// 3) Serve static files from /public and parse JSON bodies
// ───────────────────────────────────────────────────────────────────────────────
app.use(express.static(path.join(process.cwd(), "public")));
app.use(bodyParser.json());

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

/**
 * POST /api/download
 * Body: { vimeoUrl: string, filename?: string }
 */
app.post("/api/download", async (req, res) => {
  let { vimeoUrl, filename } = req.body;
  if (!vimeoUrl) {
    return res.status(400).json({ error: "Missing vimeoUrl" });
  }

  // Convert “vimeo.com/123” → “player.vimeo.com/video/123”
  const match = vimeoUrl.match(/vimeo\.com\/(\d+)(?:$|[/?])/);
  if (match && match[1]) {
    vimeoUrl = `https://player.vimeo.com/video/${match[1]}`;
  }

  // Determine a local path under ./downloads/
  let localPath;
  if (filename && filename.trim() !== "") {
    localPath = path.join(process.cwd(), "downloads", `${filename.trim()}.mp4`);
  } else {
    const idMatch = vimeoUrl.match(/video\/(\d+)(?:$|[/?])/);
    const id = idMatch ? idMatch[1] : Date.now().toString();
    localPath = path.join(process.cwd(), "downloads", `${id}.mp4`);
  }

  fs.mkdirSync(path.dirname(localPath), { recursive: true });
  res.json({ status: "started" });

  try {
    // 4a) Download Vimeo → local (awaits completion)
    await downloadVimeoPrivateVideo(
      vimeoUrl,
      "https://player.vimeo.com/",
      localPath,
      600,
      "[Server] ",
      (progressData) => {
        broadcast(progressData);
      }
    );

    // Confirm file is fully written
    const stats = fs.statSync(localPath);
    console.log(
      `DEBUG: Local file written: ${localPath} (${stats.size} bytes)`
    );

    // 4b) Upload to Drive under “VimeoDownloads/…”
    const driveFolderName = "VimeoDownloads";
    const driveFileName = path.basename(localPath);

    await uploadToGoogleDrive(localPath, driveFolderName, driveFileName);
    broadcast({ type: "gdrive_upload_complete", file: driveFileName });
  } catch (err) {
    console.error("Error in download or upload:", err);
    broadcast({ type: "error", message: err.message || String(err) });
  }
});

// Start listening on port 3000 (bound to all interfaces)
const PORT = 3000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server listening at http://0.0.0.0:${PORT}`);
});
