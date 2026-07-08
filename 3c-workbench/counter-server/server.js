const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3100;
const DATA_FILE = path.join(__dirname, 'counter_data.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

function loadData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {
    return { pageTotal: 0, weeks: {}, courses: {} };
  }
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function getISOWeek() {
  const now = new Date();
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function json(res, obj) {
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(obj));
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png' };

const server = http.createServer((req, res) => {
  cors(res);

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  if (req.method === 'GET' && pathname === '/api/stats') {
    const data = loadData();
    const week = getISOWeek();
    json(res, {
      pageTotal: data.pageTotal || 0,
      pageWeek: (data.weeks && data.weeks[week]) || 0,
      courses: data.courses || {},
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/pageview') {
    const data = loadData();
    data.pageTotal = (data.pageTotal || 0) + 1;
    const week = getISOWeek();
    if (!data.weeks) data.weeks = {};
    data.weeks[week] = (data.weeks[week] || 0) + 1;
    saveData(data);
    json(res, { total: data.pageTotal, week: data.weeks[week] });
    return;
  }

  const courseMatch = pathname.match(/^\/api\/course\/(\d+)$/);
  if (req.method === 'POST' && courseMatch) {
    const idx = courseMatch[1];
    const data = loadData();
    if (!data.courses) data.courses = {};
    data.courses[idx] = (data.courses[idx] || 0) + 1;
    saveData(data);
    json(res, { idx: Number(idx), count: data.courses[idx] });
    return;
  }

  // 静态文件服务：提供 public/ 目录下的 HTML
  let filePath = pathname === '/' ? '/index.html' : pathname;
  const fullPath = path.join(PUBLIC_DIR, filePath);
  if (fullPath.startsWith(PUBLIC_DIR) && fs.existsSync(fullPath)) {
    const ext = path.extname(fullPath);
    res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
    res.end(fs.readFileSync(fullPath));
    return;
  }

  res.writeHead(404);
  json(res, { error: 'Not Found' });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Counter server running at http://0.0.0.0:${PORT}`);
});
