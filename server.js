process.on('uncaughtException', (err) => console.error('Uncaught:', err.message));
process.on('unhandledRejection', (err) => console.error('Unhandled:', err));

const http = require('http');
const { WebSocketServer } = require('ws');
const { Pool } = require('pg');
const { formidable } = require('formidable');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

// ── Config ──────────────────────────────────────────────
const PORT = process.env.PORT || 3210;
const DB_URL = process.env.DATABASE_URL || 'postgresql://postgres:admin123@localhost:5432/lan_chat';
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const HTML_PATH = path.join(__dirname, 'public', 'index.html');
const MAX_FILE_SIZE = 20 * 1024 * 1024;
const PAGE_SIZE = 50;

// ── Database ────────────────────────────────────────────
const pool = new Pool({ connectionString: DB_URL });

async function initDB() {
  const initPool = new Pool({
    connectionString: 'postgresql://postgres:admin123@localhost:5432/postgres',
  });
  try {
    const { rows } = await initPool.query(
      "SELECT 1 FROM pg_database WHERE datname = 'lan_chat'"
    );
    if (rows.length === 0) {
      await initPool.query('CREATE DATABASE lan_chat');
      console.log('Created database: lan_chat');
    }
  } finally {
    await initPool.end();
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      type VARCHAR(10) DEFAULT 'text',
      content TEXT NOT NULL,
      sender_name VARCHAR(50) DEFAULT '匿名',
      sender_id VARCHAR(16) NOT NULL DEFAULT '',
      sender_color VARCHAR(7) DEFAULT '#7E45F2',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  console.log('Database ready');
}

// ── WebSocket ───────────────────────────────────────────
const clients = new Set();

function broadcast(data) {
  const msg = JSON.stringify(data);
  for (const ws of clients) {
    if (ws.readyState === 1) ws.send(msg);
  }
}

// ── HTTP Server ─────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  // Serve uploaded files
  if (req.method === 'GET' && req.url.startsWith('/uploads/')) {
    const filePath = path.join(__dirname, decodeURIComponent(req.url));
    const safePath = path.resolve(filePath);
    if (!safePath.startsWith(UPLOADS_DIR)) {
      res.writeHead(403);
      return res.end('Forbidden');
    }
    if (!fs.existsSync(safePath)) {
      res.writeHead(404);
      return res.end('Not found');
    }
    const ext = path.extname(safePath).toLowerCase();
    const mimeTypes = {
      '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
      '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
      '.mp4': 'video/mp4', '.pdf': 'application/pdf',
    };
    res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');
    fs.createReadStream(safePath).pipe(res);
    return;
  }

  // Upload endpoint
  if (req.method === 'POST' && req.url === '/upload') {
    const form = formidable({
      uploadDir: UPLOADS_DIR,
      keepExtensions: true,
      maxFileSize: MAX_FILE_SIZE,
      filename: (_name, ext) => Date.now() + '-' + crypto.randomBytes(4).toString('hex') + ext,
    });
    try {
      const [, files] = await form.parse(req);
      const file = files.file?.[0];
      if (!file) {
        res.writeHead(400);
        return res.end(JSON.stringify({ error: 'No file' }));
      }
      const filename = path.basename(file.filepath);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ url: '/uploads/' + filename }));
    } catch (err) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // History API with cursor pagination
  if (req.method === 'GET' && req.url.startsWith('/api/messages')) {
    try {
      const params = new URL(req.url, 'http://localhost').searchParams;
      const before = parseInt(params.get('before')) || 0;
      const limit = Math.min(parseInt(params.get('limit')) || PAGE_SIZE, 200);

      let rows;
      if (before > 0) {
        ({ rows } = await pool.query(
          'SELECT * FROM messages WHERE id < $1 ORDER BY id DESC LIMIT $2',
          [before, limit]
        ));
      } else {
        ({ rows } = await pool.query(
          'SELECT * FROM messages ORDER BY id DESC LIMIT $1',
          [limit]
        ));
      }
      const hasMore = rows.length === limit;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ messages: rows.reverse(), hasMore }));
    } catch (err) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Serve frontend
  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    fs.createReadStream(HTML_PATH).pipe(res);
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

// ── WebSocket Server ────────────────────────────────────
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  clients.add(ws);
  ws.on('message', async (raw) => {
    try {
      const msg = JSON.parse(raw);
      if (!msg.content || !msg.content.trim()) return;

      const { rows } = await pool.query(
        `INSERT INTO messages (type, content, sender_name, sender_id, sender_color)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [msg.type || 'text', msg.content.trim(), msg.sender_name || '匿名', msg.sender_id || '', msg.sender_color || '#7E45F2']
      );
      broadcast({ type: 'message', data: rows[0] });
    } catch (err) {
      console.error('Message error:', err.message);
    }
  });
  ws.on('close', () => clients.delete(ws));
});

// ── Get LAN IP ──────────────────────────────────────────
function getLanIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return 'localhost';
}

// ── Start ───────────────────────────────────────────────
async function main() {
  try {
    await initDB();
  } catch (err) {
    console.error('Database init failed:', err.message);
    process.exit(1);
  }

  server.listen(PORT, '0.0.0.0', () => {
    const ip = getLanIP();
    console.log('');
    console.log('  ╔══════════════════════════════════════╗');
    console.log('  ║         LAN Chat is running!         ║');
    console.log('  ╠══════════════════════════════════════╣');
    console.log('  ║  Local:   http://localhost:' + PORT + '     ║');
    console.log('  ║  LAN:     http://' + ip + ':' + PORT + '  ║');
    console.log('  ╚══════════════════════════════════════╝');
    console.log('');
  });
}

main();
