// auth-google.js
import { OAuth2Client } from "google-auth-library";
import fs from "fs";
import path from "path";
import express from "express";
import cookieParser from "cookie-parser";
import {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI,
} from "./config.js";

const router = express.Router();
router.use(cookieParser());

router.get("/auth/google/login", (req, res) => {
  const oauth2Client = new OAuth2Client(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI
  );
  const authorizeUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: ["https://www.googleapis.com/auth/drive.file"],
  });
  return res.redirect(authorizeUrl);
});

router.get("/auth/google/callback", async (req, res) => {
  const code = req.query.code;
  if (!code) {
    return res.status(400).send("Missing code in callback");
  }
  try {
    const oauth2Client = new OAuth2Client(
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET,
      GOOGLE_REDIRECT_URI
    );
    const { tokens } = await oauth2Client.getToken(code);
    const tokenData = {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      scope: tokens.scope,
      token_type: tokens.token_type,
      expiry_date: tokens.expiry_date,
    };
    fs.writeFileSync(
      path.join(process.cwd(), "google_drive_tokens.json"),
      JSON.stringify(tokenData, null, 2)
    );
    return res.send(`
      <h2>Google Drive Connected!</h2>
      <p>You can now close this window and return to the Vimeo Downloader.</p>
    `);
  } catch (err) {
    console.error("Google callback error:", err);
    return res.status(500).send("Authentication failed: " + err.message);
  }
});

export default router;
