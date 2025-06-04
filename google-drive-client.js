// google-drive-client.js
import fs from "fs";
import path from "path";
import { OAuth2Client } from "google-auth-library";
import { google } from "googleapis";
import {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI,
} from "./config.js";

const TOKEN_PATH = path.join(process.cwd(), "google_drive_tokens.json");

/**
 * Returns an authorized OAuth2 client, refreshing tokens if needed.
 */
async function getAuthorizedClient() {
  if (!fs.existsSync(TOKEN_PATH)) {
    throw new Error(
      "No stored Google Drive tokens. Run /auth/google/login first."
    );
  }

  const raw = fs.readFileSync(TOKEN_PATH, "utf-8");
  const tokenData = JSON.parse(raw);
  const { access_token, refresh_token, expiry_date } = tokenData;

  const oauth2Client = new OAuth2Client(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI
  );
  oauth2Client.setCredentials({
    access_token,
    refresh_token,
    expiry_date,
  });

  // If expired (or within 1 minute of expiring), refresh:
  if (Date.now() > (expiry_date || 0) - 60 * 1000) {
    try {
      const newTokens = await oauth2Client.refreshAccessToken();
      oauth2Client.setCredentials(newTokens.credentials);
      const updated = {
        access_token: newTokens.credentials.access_token,
        refresh_token: newTokens.credentials.refresh_token || refresh_token,
        expiry_date: newTokens.credentials.expiry_date,
      };
      fs.writeFileSync(TOKEN_PATH, JSON.stringify(updated, null, 2));
    } catch (err) {
      console.error("Error refreshing token:", err);
      throw err;
    }
  }

  return oauth2Client;
}

/**
 * Find or create a folder named `folderName` under the user’s Drive root.
 * Returns the folder’s ID.
 */
async function getOrCreateFolder(drive, folderName) {
  // Check if it already exists under root
  const res = await drive.files.list({
    q: `mimeType='application/vnd.google-apps.folder' and name='${folderName}' and 'root' in parents and trashed=false`,
    fields: "files(id, name)",
    spaces: "drive",
  });

  if (res.data.files && res.data.files.length > 0) {
    return res.data.files[0].id;
  }

  // Create it under root
  const fileMetadata = {
    name: folderName,
    mimeType: "application/vnd.google-apps.folder",
    parents: ["root"],
  };
  const folder = await drive.files.create({
    resource: fileMetadata,
    fields: "id",
  });
  return folder.data.id;
}

/**
 * Uploads localFilePath → Google Drive under [root]/folderName/driveFileName.
 */
export async function uploadToGoogleDrive(
  localFilePath,
  folderName,
  driveFileName
) {
  // (A) Get an authorized OAuth2 client (refreshing if needed)
  const oauth2Client = await getAuthorizedClient();

  // (B) Instantiate the Drive client
  const drive = google.drive({
    version: "v3",
    auth: oauth2Client,
  });

  // (C) Ensure the folder exists (or create it)
  const folderId = await getOrCreateFolder(drive, folderName);

  // (D) Prepare the media upload (resumable for large files)
  const fileSize = fs.statSync(localFilePath).size;
  const mimeType = "video/mp4"; // since we’re uploading an MP4

  const fileMetadata = {
    name: driveFileName,
    parents: [folderId],
  };
  const media = {
    mimeType,
    body: fs.createReadStream(localFilePath),
  };

  console.log(
    `⏳ Uploading ${driveFileName} (${(fileSize / 1024 / 1024).toFixed(
      1
    )} MB) to Google Drive…`
  );

  try {
    const res = await drive.files.create(
      {
        resource: fileMetadata,
        media,
        fields: "id, webViewLink",
      },
      {
        // ← Make this a resumable upload, so large videos don't get cut off
        resumable: true,
        onUploadProgress: (evt) => {
          const progress = (evt.bytesRead / fileSize) * 100;
          const pct = Math.round(progress);
          console.log(`  → upload ${pct}%`);
        },
      }
    );

    console.log(`✅ Upload complete! File ID: ${res.data.id}`);
    console.log(`🔗 View it here: ${res.data.webViewLink}`);
    return res.data;
  } catch (err) {
    console.error("❌ Google Drive upload failed:", err);
    throw err;
  }
}
