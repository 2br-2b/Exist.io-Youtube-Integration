# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A cross-browser extension (Chrome and Firefox) that tracks YouTube video watch time and logs it to Exist.io using their API. The extension uses a multi-script architecture to handle YouTube's player API access and cross-origin API requests.

## Architecture

This is a Manifest V3 extension with OAuth authentication:

### Core Files

- **src/manifest.json** - Extension manifest with Chrome/Firefox compatibility, host permissions for Exist.io API
- **src/background.js** - Service worker handling OAuth token exchange, API calls (to avoid CORS), and message passing
- **src/content-script.js** - Runs in ISOLATED world on YouTube, injects monitoring script, relays messages to background
- **src/injected.js** - Runs in MAIN world to access YouTube's player API, sends watch time via postMessage
- **src/options.html / options.js** - Popup UI for OAuth credential management, shown when clicking extension icon

### Script Communication Flow

1. **injected.js** (MAIN world) → listens to YouTube player state changes
2. **injected.js** → sends `postMessage` with watch duration to content script
3. **content-script.js** (ISOLATED world) → receives message, sends `chrome.runtime.sendMessage` to background
4. **background.js** → makes authenticated API call to Exist.io (avoids CORS issues)

### Browser Compatibility

Uses `chrome.*` API which works on both Chrome and Firefox. Promise wrappers convert callback-based Chrome APIs to async/await style.

## Development

### Loading the Extension

**Chrome:**
1. Open `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select the `src` folder

**Firefox:**
1. Open `about:debugging#/runtime/this-firefox`
2. Click "Load Temporary Add-on"
3. Select `src/manifest.json`

### Testing

Manual testing only - open a YouTube video, play/pause, and check the browser console and service worker console for logging output.

### Debugging

- **Popup console**: Right-click extension icon → Inspect popup
- **Background script**: Chrome extensions page → "Service worker" link
- **Content script**: YouTube page DevTools console

## OAuth Flow

1. User clicks "Authorize" in popup
2. Popup opens Exist.io auth page in new tab via `chrome.tabs.create()`
3. User authorizes, Exist.io redirects to `chrome.identity.getRedirectURL()`
4. Background script's `tabs.onUpdated` listener captures the redirect URL
5. Background script extracts auth code, exchanges for tokens, stores them
6. Background script calls `setupAttribute()` to create/acquire the YouTube Minutes attribute

Tokens are stored in `chrome.storage.local` and include access token, refresh token, and expiry timestamp.

## Exist.io Integration

### Attribute Setup

After OAuth authorization, the background script automatically:
1. Checks if `youtube_minutes` attribute exists via `GET /api/2/attributes/`
2. Creates it if missing via `POST /api/2/attributes/create/` (media group, duration type)
3. Acquires ownership via `POST /api/2/attributes/acquire/`

### Data Logging

Uses `POST /api/2/attributes/increment/` to add watch time. Handles 202 responses with partial failures by attempting to re-setup the attribute.

### Scopes

Requires `media_write` scope to create and write to attributes.

## Key Implementation Details

### Why Separate Scripts?

- **injected.js** must run in MAIN world to access `document.getElementById('movie_player')` and its `onStateChange` event
- **content-script.js** runs in ISOLATED world with access to `chrome.*` APIs
- **background.js** makes API calls to avoid CORS (content scripts can't make cross-origin requests from YouTube's context)

### Chrome API Promise Wrappers

```javascript
const storage = {
    get: (keys) => new Promise(r => chrome.storage.local.get(keys, r)),
    set: (items) => new Promise(r => chrome.storage.local.set(items, r)),
    remove: (keys) => new Promise(r => chrome.storage.local.remove(keys, r))
};
```

### YouTube Player State Tracking

The injected script listens for `onStateChange` events on the `movie_player` element:
- State 1 (PLAYING): Record start timestamp
- Any other state: Calculate duration, send to content script

Also handles YouTube's SPA navigation via `yt-navigate-finish` event.
