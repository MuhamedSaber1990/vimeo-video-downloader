# Vimeo Video Downloader to Google Drive

## Overview

This project allows users to enter a Vimeo video URL, download the video via FFmpeg, and automatically upload it to a specified Google Drive folder. Progress updates are displayed in real-time via WebSocket.

## test-link
output test for the project: http://84.32.188.34:3000/

## Features

- **Download from Vimeo**: Supports both public and private Vimeo videos by scraping the `playerConfig` JSON.
- **FFmpeg Integration**: Uses FFmpeg to remux HLS streams into MP4 and tracks progress.
- **Real-Time Progress**: WebSocket-based progress updates for both download and upload.
- **Google Drive Upload**: Resumable uploads via the Google Drive API, ensuring large files are fully transferred.
- **Custom Filename**: Users can specify a custom filename for the downloaded video.
- **Configurable & Extensible**: Environment-based configuration for OAuth credentials and redirect URIs.

## Repository Structure

```
├── downloads/                  # Local folder for downloaded MP4s (ignored via .gitignore)
├── public/                     # Frontend assets
│   ├── index.html              # Main HTML (split into separate CSS/JS in this repo)
│   ├── style.css               # CSS for styling
│   └── script.js               # Frontend JavaScript
├── vimeoDownloader.js          # Module to scrape and download Vimeo videos via FFmpeg
├── google-drive-client.js      # Module to upload MP4s to Google Drive with resumable uploads
├── auth-google.js              # Express router for Google OAuth 2.0 login & callback
├── server.js                   # Main Express + WebSocket server
├── config.js                   # Loads OAuth credentials & redirect URI from environment
├── package.json
├── .gitignore
└── README.md                   # This file
```

## Prerequisites

- **Node.js** ≥ 14 (recommended v18+)
- **npm** (comes with Node.js)
- **FFmpeg** (installed via `apt install ffmpeg` on Ubuntu)
- **Google Cloud project** with Drive API enabled and OAuth 2.0 credentials

## Installation

1. **Clone the repository**

   ```bash
   git clone https://github.com/MuhamedSaber1990/vimeo-video-downloader.git
   cd vimeo-to-drive-downloader
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Configure environment variables**

   Create a `.env` file in the project root with:

   ```ini
   GOOGLE_CLIENT_ID=your-google-client-id
   GOOGLE_CLIENT_SECRET=your-google-client-secret
   GOOGLE_REDIRECT_URI=https://your-hostname/auth/google/callback
   ```

## Usage

1. **Start the server**

   - **Local HTTP (for quick tests)**:

     ```bash
     npm start
     ```

     By default, listens on `http://localhost:3000`.


2. **Authenticate with Google Drive**

   - Open your browser and navigate to:
     ```
     http://localhost:3000/auth/google/login
     ```
     (or `https://localhost/auth/google/login` for HTTPS)
   - Sign in, grant `drive.file` permission, and let the app save `google_drive_tokens.json`.

3. **Download a Vimeo video**

   - Open your browser at:
     ```
     http://localhost:3000/
     ```
   - Enter a Vimeo URL (e.g. `https://vimeo.com/123456789`) into the form.
   - Click **Download Video** (optionally enter a custom filename).
   - Watch real-time progress. Once FFmpeg finishes, the app uploads the MP4 to Google Drive.

4. **Check your Google Drive**
   - The video is saved under a folder named `VimeoDownloads` (created automatically).

## .gitignore

```gitignore
node_modules/
downloads/
google_drive_tokens.json
.env
ssl/
.DS_Store
npm-debug.log*
```

## Security & Best Practices

- **Do not commit** `google_drive_tokens.json` or actual `config.js` values—always load from environment variables.
- **Use HTTPS** in production. For local testing, you can use self-signed certificates.
- **Limit Drive scopes** to `drive.file` to follow the principle of least privilege.
- **Validate Vimeo URLs** before passing to FFmpeg to avoid injection or misuse.

## Future Improvements

- Move token storage to a secure vault (e.g. AWS Secrets Manager).
- Scale downloads with a job queue (Redis + workers).
- Add support for other platforms (YouTube, Dailymotion) via a plugin architecture.
- Improve front-end UI/UX (React, TailwindCSS).

## License

MIT License © Mohamed Kenawi
