// vimeoDownloader.js
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import axios from "axios";
import { load } from "cheerio";

/**
 * Convert a "HH:MM:SS.xx" string into total seconds (float).
 */
function convertToSeconds(timeStr) {
  const [hours, minutes, seconds] = timeStr.split(":");
  return (
    parseInt(hours, 10) * 3600 +
    parseInt(minutes, 10) * 60 +
    parseFloat(seconds)
  );
}

/**
 * Calculate integer percentage given "HH:MM:SS.xx" and totalDuration (in seconds).
 */
function calculatePercentage(timeStr, totalDurationSec) {
  try {
    const elapsedSeconds = convertToSeconds(timeStr);
    return Math.round((elapsedSeconds / totalDurationSec) * 100);
  } catch {
    return 0;
  }
}

/**
 * Download an HLS stream via FFmpeg, sending progress updates via progressCallback.
 *
 * Returns a Promise that resolves only when FFmpeg has fully closed (i.e. file is fully written),
 * or rejects if FFmpeg errors. Progress data objects look like:
 *   { type: "progress", percentage, status, duration, size }
 *   { type: "complete" }
 *   { type: "error", message }
 *
 * @param {string} m3u8Url           – the HLS URL
 * @param {string} outputFilename    – where to write the .mp4
 * @param {number} durationInSeconds – expected total duration (sec)
 * @param {(data: object) => void} progressCallback  – called with progress objects
 * @param {string} pre               – optional prefix for console logs
 * @returns {Promise<void>}
 */
function downloadHLSStream(
  m3u8Url,
  outputFilename,
  durationInSeconds = 600,
  progressCallback = null,
  pre = ""
) {
  // Ensure output directory exists
  const outputDir = path.dirname(outputFilename);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // If a file already exists at outputFilename, delete it
  try {
    fs.rmSync(outputFilename);
  } catch {
    // ignore if deletion fails
  }

  const ffmpegArgs = [
    "-i",
    m3u8Url,
    "-c",
    "copy",
    "-bsf:a",
    "aac_adtstoasc",
    outputFilename,
  ];

  console.log(pre + `Starting FFmpeg for ${m3u8Url}`);
  const ffmpeg = spawn("ffmpeg", ffmpegArgs);

  let lastPercentage = 0;

  ffmpeg.stderr.on("data", (chunk) => {
    const dataStr = chunk.toString();
    // Whenever FFmpeg prints something containing "time=", parse it:
    if (dataStr.includes("time=")) {
      const timeMatch = dataStr.match(/time=([0-9:.]+)/);
      const sizeMatch = dataStr.match(/size=\s*([^\s]+)/);
      if (timeMatch) {
        const timePart = timeMatch[1].trim();
        const sizePart = sizeMatch ? sizeMatch[1] : "";
        // Trim off the seconds so we only show HH:MM
        const hhmm = timePart.split(":").slice(0, 2).join(":");
        const perc = calculatePercentage(timePart, durationInSeconds);

        if (perc !== lastPercentage) {
          lastPercentage = perc;
          if (progressCallback) {
            progressCallback({
              type: "progress",
              percentage: perc,
              status: "Downloading",
              duration: hhmm,
              size: sizePart,
            });
          }
        }
      }
    }
  });

  return new Promise((resolve, reject) => {
    ffmpeg.on("close", (code) => {
      if (code === 0) {
        // Completed successfully
        if (progressCallback) {
          progressCallback({ type: "complete" });
        }
        resolve();
      } else {
        const msg = `FFmpeg exited with code ${code}`;
        console.error(pre + msg);
        if (progressCallback) {
          progressCallback({ type: "error", message: msg });
        }
        reject(new Error(msg));
      }
    });

    ffmpeg.on("error", (err) => {
      const msg = `Failed to start FFmpeg: ${err.message}`;
      console.error(pre + msg);
      if (progressCallback) {
        progressCallback({ type: "error", message: msg });
      }
      reject(err);
    });
  });
}

/**
 * Extract the Vimeo “playerConfig” JSON blob from a Vimeo private-video page.
 * (UNCHANGED from your original version, except we removed CLI-progress references.)
 */
async function extractVimeoPlayerConfig(url, domain) {
  try {
    const response = await axios.get(url, {
      headers: {
        Accept: "*/*",
        Referer: domain,
        "User-Agent": "Vimeo-Downloader",
      },
    });
    const html = response.data;
    const $ = load(html);

    const playerConfigScript = $("script")
      .filter((i, el) => $(el).html().includes("window.playerConfig ="))
      .first();

    const playerConfigString = playerConfigScript
      .html()
      .replace("window.playerConfig = ", "")
      .replace(/;$/, "");
    const playerConfig = JSON.parse(playerConfigString);

    return {
      videoId: playerConfig.video.id,
      title: playerConfig.video.title,
      duration: playerConfig.video.duration,
      width: playerConfig.video.width,
      height: playerConfig.video.height,
      thumbnails: playerConfig.video.thumbs,
      streamQualities: playerConfig.request.files.dash.streams.map(
        (stream) => stream.quality
      ),
      owner: {
        id: playerConfig.video.owner.id,
        name: playerConfig.video.owner.name,
      },
      streamUrls: {
        dash: {
          primary:
            playerConfig.request.files.dash.cdns.akfire_interconnect_quic
              .avc_url,
          alternate: playerConfig.request.files.dash.cdns.fastly_skyfire.url,
        },
        hls: {
          primary:
            playerConfig.request.files.hls.cdns.akfire_interconnect_quic
              .avc_url,
          alternate: playerConfig.request.files.hls.cdns.fastly_skyfire.avc_url,
        },
      },
    };
  } catch (error) {
    // If Vimeo returns a cookie-based security challenge, retry once.
    if (
      error?.response?.headers?.["set-cookie"] &&
      error?.response?.headers?.["set-cookie"].length > 0
    ) {
      axios.defaults.headers.common["Cookie"] =
        error.response.headers["set-cookie"].join("; ");
      return extractVimeoPlayerConfig(url, domain);
    } else {
      throw new Error(
        "Error extracting Vimeo player config: " + (error.message || error)
      );
    }
  }
}

/**
 * downloadVimeoPrivateVideo:
 * - Fetches playerConfig (to find HLS URL),
 * - Then calls downloadHLSStream(...) and waits until it's fully finished before resolving.
 *
 * @param {string} vimeoUrl
 * @param {string} domain
 * @param {string} outputFilename
 * @param {number} durationInSeconds
 * @param {string} pre
 * @param {(data: object) => void} progressCallback
 */
async function downloadVimeoPrivateVideo(
  vimeoUrl,
  domain = "https://player.vimeo.com/",
  outputFilename,
  durationInSeconds = 600,
  pre = "",
  progressCallback = null
) {
  console.log(pre + "Downloading Vimeo video...");
  let playerConfig = null;

  // Retry loop to get a valid playerConfig
  while (!playerConfig) {
    try {
      playerConfig = await extractVimeoPlayerConfig(vimeoUrl, domain);
      break;
    } catch (err) {
      console.warn(pre + "Retrying playerConfig extraction...");
      // Wait 3 seconds before retrying
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }

  const hlsUrl = playerConfig.streamUrls.hls.primary;

  // Kick off the HLS download; only return after FFmpeg finishes
  await downloadHLSStream(
    hlsUrl,
    outputFilename,
    durationInSeconds,
    (data) => {
      // Forward each progress/error/complete update to the caller
      if (progressCallback) {
        progressCallback(data);
      }
    },
    pre
  );
}

export { downloadVimeoPrivateVideo };
