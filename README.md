# LAN Chat

Lightweight LAN messaging tool for quick communication between devices on the same network. No login, no authentication — just open and chat.

## Features

- **Text messages** — Enter to send, Shift+Enter for newline, hover to copy
- **Image sharing** — Upload, paste from clipboard, or drag & drop
- **File sharing** — Send any file type with download card
- **Real-time** — WebSocket broadcast, auto-reconnect on disconnect
- **Persistent storage** — PostgreSQL backed, messages survive restarts
- **Pagination** — Loads latest 50 messages, scroll up to load more
- **Device identity** — Each device gets a unique local ID (stored in localStorage)
- **New message alert** — Badge notification when scrolled up, click to jump to latest
- **Resizable window** — Drag corner to resize, size saved locally
- **Dark theme** — Clean dark UI, centered card layout

## Tech Stack

- **Runtime:** Node.js
- **Frontend:** Vue 3 (CDN, no build step)
- **Real-time:** WebSocket (ws)
- **Database:** PostgreSQL
- **Upload:** Formidable

## Quick Start

```bash
# Prerequisites: Node.js, PostgreSQL running on localhost

# Install dependencies
npm install

# Start server
node server.js
```

Open `http://localhost:3210` on any device in your LAN.

## Configuration

Environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3210` | Server port |
| `DATABASE_URL` | `postgresql://postgres:admin123@localhost:5432/lan_chat` | PostgreSQL connection string |

The database and table are created automatically on first run.

## Project Structure

```
lan-chat/
├── server.js          # HTTP + WebSocket server, API routes
├── public/
│   └── index.html     # Vue 3 SPA (single file, no build)
├── uploads/           # Uploaded files storage
├── package.json
└── README.md
```
