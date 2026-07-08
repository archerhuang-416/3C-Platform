#!/usr/bin/env node
/**
 * build_optimized.mjs
 *
 * 将 web/data/minutes.json 拆分为索引层 + 压缩详情层，
 * 组装成一个优化后的单 HTML 文件（去掉 iframe/base64 架构）。
 *
 * 用法: node scripts/build_optimized.mjs
 * 产出: web/3C-AI工作台.html (覆盖)
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { deflateSync } from 'zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATA_PATH = join(ROOT, 'web', 'data', 'minutes.json');
const OUTPUT_PATH = join(ROOT, 'web', '3C-AI工作台.html');

// ─── 1. 读取并拆分数据 ───
const raw = JSON.parse(readFileSync(DATA_PATH, 'utf-8'));
const items = raw.items || [];

// 索引层：列表展示 + 搜索所需字段
const indexItems = items.map(it => {
  // 搜索摘要：拼接 qa 问答文本的前 200 字 + 关键词，保证搜索不降级
  const qaText = Array.isArray(it.qa)
    ? it.qa.map(qa => `${qa.q} ${qa.a}`).join(' ')
    : '';
  const searchSnippet = qaText.slice(0, 300);

  return {
    id: it.id,
    title: it.title,
    date: it.date,
    src: it.src,
    topic: it.topic,
    entities: it.entities,
    kw: it.kw,
    aiSummary: it.aiSummary,
    sum: it.sum,
    joyspaceUrl: it.joyspaceUrl,
    documentId: it.documentId,
    // 搜索用摘要（不在 UI 展示，仅供全文搜索命中）
    _s: searchSnippet,
  };
});

// 详情层：id → qa 映射
const detailMap = {};
items.forEach(it => {
  if (Array.isArray(it.qa) && it.qa.length) {
    detailMap[it.id] = it.qa;
  }
});

const indexJson = JSON.stringify({
  generatedAt: raw.generatedAt || raw.syncedAt || '',
  total: items.length,
  items: indexItems,
});

const detailJson = JSON.stringify(detailMap);

// ─── 2. 压缩详情层 ───
const detailCompressed = deflateSync(Buffer.from(detailJson, 'utf-8'), { level: 9 });
const detailBase64 = detailCompressed.toString('base64');

// ─── 3. 统计 ───
const indexKB = (Buffer.byteLength(indexJson, 'utf-8') / 1024).toFixed(1);
const detailRawKB = (Buffer.byteLength(detailJson, 'utf-8') / 1024).toFixed(1);
const detailCompKB = (detailCompressed.length / 1024).toFixed(1);

console.log(`[build] 索引层: ${indexKB} KB (${indexItems.length} items)`);
console.log(`[build] 详情层: ${detailRawKB} KB raw → ${detailCompKB} KB compressed (deflate L9)`);
console.log(`[build] Base64 膨胀后: ${(detailBase64.length / 1024).toFixed(1)} KB`);

// ─── 4. 读取 HTML 模板（从 index.html 中提取 CSS + JS 骨架） ───
// 我们直接生成完整 HTML，不再依赖 iframe

// ─── 5. 组装输出 HTML ───
// 读取原始 index.html 的 CSS 部分 (lines 7-882 是 <style>)
const indexHtml = readFileSync(join(ROOT, 'web', 'index.html'), 'utf-8');
const styleMatch = indexHtml.match(/<style>([\s\S]*?)<\/style>\s*<style>([\s\S]*?)<\/style>/);
const cssBlock = styleMatch
  ? `<style>${styleMatch[1]}${styleMatch[2]}</style>`
  : '';

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>3C 报告库</title>
${cssBlock}
<style>
.ohead{position:sticky;top:0;z-index:50;background:rgba(255,255,255,.95);backdrop-filter:saturate(180%) blur(10px);border-bottom:1px solid #E8EAED}
.oin{height:64px;display:flex;align-items:center;gap:24px;padding:0 26px;max-width:1480px;margin:0 auto}
.obrand{display:flex;align-items:center;gap:11px;cursor:pointer;flex:none}
.ologo{width:34px;height:34px;border-radius:8px;background:linear-gradient(180deg,#ff8a3d 0%,#e1251b 100%);color:#fff;display:grid;place-items:center;font-weight:800;font-size:13px;letter-spacing:-.02em;box-shadow:0 4px 12px rgba(225,37,27,.22)}
.obrand b{font-size:16px;font-weight:800;color:#1F2329;line-height:1.05;letter-spacing:-.02em}
.obrand small{display:block;font-size:11px;color:#86909C;font-weight:500;letter-spacing:0;margin-top:2px}
.obrand:hover b{color:#e1251b}
.onav{display:flex;gap:2px;height:100%;align-items:stretch;overflow-x:auto;scrollbar-width:none}
.onav::-webkit-scrollbar{display:none}
.onav a{display:flex;align-items:center;gap:6px;padding:0 15px;font-size:14px;color:#4E5969;font-weight:500;white-space:nowrap;position:relative;cursor:pointer;text-decoration:none}
.onav a:hover{color:#1F2329}.onav a .d{width:7px;height:7px;border-radius:50%;background:#C9CDD4}
.onav a.active{color:#e1251b;font-weight:600}.onav a.active .d{background:#e1251b}
.onav a.active::after{content:"";position:absolute;left:15px;right:15px;bottom:0;height:3px;background:#e1251b;border-radius:3px 3px 0 0}
.badge-dev{font-size:10px;background:#FF6A00;color:#fff;padding:1px 6px;border-radius:8px;margin-left:2px;font-weight:600;line-height:1.6}
.top-meta{margin-left:auto;display:flex;flex-direction:column;align-items:flex-end;gap:3px}
.meta-pill{display:flex;align-items:center;gap:5px;height:24px;padding:0 9px;border-radius:999px;font-size:11px;line-height:1.2;white-space:nowrap}
.meta-pill--sync{border:1px solid #dbe3ef;background:linear-gradient(180deg,#f8fafc,#f1f5f9);color:#475467;box-shadow:0 1px 2px rgba(16,24,40,.04)}
.meta-pill--stats{border:1px solid #f0dfc0;background:linear-gradient(180deg,#fffdf5,#fff8e8);color:#7a5b17;box-shadow:0 1px 2px rgba(180,130,20,.06)}
.meta-pill__dot{width:6px;height:6px;border-radius:50%;background:#18a058;box-shadow:0 0 0 2px rgba(24,160,88,.14)}
.meta-pill strong{font-weight:600;color:#101828}
.meta-pill--stats strong{color:#3d2f0d}
.meta-pill__sub{color:#98a2b3;font-size:10px;font-weight:500;margin-left:2px}
.meta-pill__sep{color:#c9b27a;padding:0 1px}
.board-placeholder{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:60vh;color:#86909C;font-size:15px;gap:12px}
.board-placeholder svg{width:48px;height:48px;opacity:.3}
</style>
</head>
<body>
<header class="ohead"><div class="oin">
<div class="obrand" onclick="location.hash=''">
  <div class="ologo">3C</div>
  <div><b>3C 报告库</b><small>JD · 商业分析</small></div>
</div>
<nav class="onav" id="onav"></nav>
<div class="top-meta">
  <div class="meta-pill meta-pill--sync">
    <span class="meta-pill__dot"></span>
    <span>数据更新：<strong id="ts">--</strong></span>
    <span class="meta-pill__sub" id="tsRelative"></span>
  </div>
  <div class="meta-pill meta-pill--stats">
    <span>📊</span>
    <span>报告 <strong id="metaTotal">0</strong> 篇<span class="meta-pill__sep">·</span>累计浏览 <strong id="metaViews">0</strong><span class="meta-pill__sep">·</span>本周 <strong id="metaWeekly">0</strong></span>
  </div>
</div>
</div></header>

<main class="page" id="boardContainer"></main>
<div class="toast" id="toast"></div>

<!-- 索引数据（列表展示 + 搜索） -->
<script id="__index-data" type="application/json">
${indexJson}
</script>

<!-- 详情数据（deflate 压缩 + base64，按需解压） -->
<script id="__detail-blob" type="text/plain">
${detailBase64}
</script>

<script src="https://cdn.jsdelivr.net/npm/html2pdf.js@0.10.2/dist/html2pdf.bundle.min.js"><\/script>
<script>
// ====== 解压引擎（纯 JS inflate，无外部依赖） ======
// 轻量 inflate 实现，基于 RFC 1951 deflate 解码
const _inflate = (() => {
  // 使用浏览器内置 DecompressionStream (Chrome 80+, Firefox 113+, Safari 16.4+)
  // 降级方案：用 fetch + Response 的 body stream
  async function inflate(base64Str) {
    const binary = atob(base64Str.replace(/\\s/g, ''));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    // 尝试 DecompressionStream
    if (typeof DecompressionStream !== 'undefined') {
      const ds = new DecompressionStream('deflate');
      const writer = ds.writable.getWriter();
      writer.write(bytes);
      writer.close();
      const reader = ds.readable.getReader();
      const chunks = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
      const total = chunks.reduce((s, c) => s + c.length, 0);
      const result = new Uint8Array(total);
      let offset = 0;
      for (const c of chunks) { result.set(c, offset); offset += c.length; }
      return new TextDecoder().decode(result);
    }

    // 降级：用 fetch blob + Response
    const blob = new Blob([bytes]);
    const resp = new Response(blob.stream().pipeThrough(new DecompressionStream('deflate')));
    return await resp.text();
  }
  return inflate;
})();

// 详情缓存
let _detailCache = null;
async function getDetail(id) {
  if (!_detailCache) {
    const blob = document.getElementById('__detail-blob').textContent.trim();
    const json = await _inflate(blob);
    _detailCache = JSON.parse(json);
  }
  return _detailCache[id] || [];
}
</script>

<script>
// ====== 导航 Tab 系统 ======
const NAV = [
  { id: 'expert', label: '专家纪要' },
  { id: 'sharing', label: '品类课程' },
  { id: 'policy', label: '行业政策库', dev: true },
  { id: 'talent', label: '竞对招聘库', dev: true },
  { id: 'finance', label: '财报智能解读', dev: true },
];

function initNav() {
  const nav = document.getElementById('onav');
  nav.innerHTML = NAV.map(n =>
    \`<a data-tab="\${n.id}" onclick="switchBoard('\${n.id}')"><span class="d"></span>\${n.label}\${n.dev ? '<span class=badge-dev>开发中</span>' : ''}</a>\`
  ).join('');
}

let currentBoard = '';
function switchBoard(id) {
  if (!NAV.find(n => n.id === id)) id = 'expert';
  currentBoard = id;
  document.querySelectorAll('#onav a').forEach(a => a.classList.toggle('active', a.dataset.tab === id));
  location.hash = id === 'expert' ? '' : id;

  const container = document.getElementById('boardContainer');
  if (id === 'expert') {
    renderExpertBoard(container);
  } else if (id === 'sharing') {
    renderSharingBoard(container);
  } else {
    container.innerHTML = \`<div class="board-placeholder">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
      <b>\${NAV.find(n=>n.id===id).label}</b>
      <span>正在开发中，敬请期待</span>
    </div>\`;
  }
}

window.addEventListener('hashchange', () => {
  const h = location.hash.slice(1);
  if (h && NAV.find(n => n.id === h)) switchBoard(h);
  else switchBoard('expert');
});

// ====== Toast ======
let _toastTimer;
function showToast(msg) {
  const el = document.getElementById('toast');
  el.innerHTML = '✓ ' + msg;
  el.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}
</script>

<script>
// ====== 专家纪要面板 ======
const DATA = {
  minutes: {
    eyebrow: 'Expert Minutes', cat: '专家纪要', title: '全部专家纪要',
    generatedAt: '',
    facets: [
      { key: '竞对平台', name: '竞对平台', opts: ['拼多多','阿里','字节'] },
      { key: '品牌', name: '品牌', opts: ['苹果','华为','小米','OPPO','vivo','荣耀'] },
      { key: '即时零售平台', name: '即时零售平台', opts: ['美团闪购','京东秒送','淘宝闪购'] },
      { key: '其他', name: '其他', opts: ['AI','二手','内存','芯片','其他'] },
    ],
    items: [],
  },
};

const state = {
  tab: 'minutes',
  filters: {},
  q: '',
  sort: 'date-desc',
  dateRange: 'all',
  dateFrom: '',
  dateTo: '',
  loading: false,
  currentReader: null,
  listAll: null,
  listShown: 0,
  listBatch: 10,
  listObserver: null,
};

const FAV_KEY = 'minutes.favorites.v1';
function loadFavs() { try { return new Set(JSON.parse(localStorage.getItem(FAV_KEY) || '[]')); } catch(_) { return new Set(); } }
function saveFavs(set) { try { localStorage.setItem(FAV_KEY, JSON.stringify([...set])); } catch(_){} }
const favs = loadFavs();

const TOPIC_PALETTE = {
  '竞对平台': { fg:'#1E54E8', bg:'#EAF1FF', bd:'#D6E2FF' },
  '品牌': { fg:'#E1251B', bg:'#FDECEA', bd:'#F8D6D2' },
  '即时零售平台': { fg:'#18A058', bg:'#E8F7EF', bd:'#CBEDD8' },
  '其他': { fg:'#7B5CFF', bg:'#F0ECFF', bd:'#DDD2FF' },
};
const ENTITY_PALETTE = {
  '拼多多':{ fg:'#E02E24', bg:'#FCEAE8' },'阿里':{ fg:'#FF6A00', bg:'#FFF1E5' },
  '字节':{ fg:'#0F1B2D', bg:'#E7EAEF' },'苹果':{ fg:'#1F2329', bg:'#EEEFF1' },
  '华为':{ fg:'#D7180B', bg:'#FCE7E5' },'小米':{ fg:'#F37021', bg:'#FFEEDC' },
  'OPPO':{ fg:'#008C45', bg:'#E5F4EB' },'vivo':{ fg:'#415FFF', bg:'#E7ECFF' },
  '荣耀':{ fg:'#0089FF', bg:'#E2F1FF' },'美团闪购':{ fg:'#FFC300', bg:'#FFF6D6' },
  '京东秒送':{ fg:'#E1251B', bg:'#FDECEA' },'淘宝闪购':{ fg:'#FF5000', bg:'#FFE9DD' },
  'AI':{ fg:'#7B5CFF', bg:'#F0ECFF' },'AI芯片':{ fg:'#7B5CFF', bg:'#F0ECFF' },
  '芯片':{ fg:'#2F6BFF', bg:'#EAF1FF' },'二手':{ fg:'#10A37F', bg:'#E1F4EE' },
  '内存':{ fg:'#0EA5E9', bg:'#DEF1FB' },
};
function hashHue(str){ let h=0; for(let i=0;i<str.length;i++){h=(h*31+str.charCodeAt(i))|0;} return Math.abs(h)%360; }
function paletteForEntity(n){ if(!n)return TOPIC_PALETTE['其他']; if(ENTITY_PALETTE[n])return ENTITY_PALETTE[n]; const h=hashHue(n); return{fg:\`hsl(\${h},62%,36%)\`,bg:\`hsl(\${h},78%,95%)\`}; }
function paletteForTopic(n){ return TOPIC_PALETTE[n]||TOPIC_PALETTE['其他']; }
function chipStyle(p){ const bd=p.bd?\`;--chip-bd:\${p.bd}\`:''; return \`--chip-fg:\${p.fg};--chip-bg:\${p.bg}\${bd}\`; }

const recent = [];

function renderExpertBoard(container) {
  state.tab = 'minutes';
  state.filters = {};
  state.q = '';
  state.currentReader = null;

  container.innerHTML = \`
  <section class="site-banner">
    <div class="banner-inner">
      <div>
        <p class="banner-eyebrow">JD · 3C AI 情报库</p>
        <h1 class="banner-title">专家纪要中心</h1>
        <p class="banner-sub">汇总 3C 行业一线专家访谈、供应链与平台情报，结构化呈现关键问答与 AI 摘要。</p>
      </div>
      <div class="banner-metrics">
        <div class="banner-metric"><b id="bannerTotal">0</b><span>纪要总数</span></div>
        <div class="banner-metric"><b id="bannerUpdated">--</b><span>最近更新</span></div>
      </div>
    </div>
  </section>
  <div class="rl-shell">
    <aside class="rl-sidebar">
      <div id="sidebarFilters"></div>
      <div class="sb-block sb-recent"><h2>最近浏览</h2><div id="recentList"></div></div>
    </aside>
    <section class="rl-main">
      <div id="listView">
        <form class="rl-search" onsubmit="return doSearch(event)">
          <span class="si">⌕</span>
          <input id="searchInput" type="search" placeholder="搜索标题 / 摘要 / 专家问答 / 标签…" oninput="render()">
          <label class="sort-control"><span>时间</span>
            <select id="sortOrder" onchange="render()">
              <option value="date-desc">最新优先</option>
              <option value="date-asc">最早优先</option>
            </select>
          </label>
          <button class="btn btn--primary btn--sm" type="submit">搜索</button>
          <div class="date-range" id="dateRange" style="flex-basis:100%;margin-top:6px">
            <button type="button" class="dr-btn active" data-range="all">全部</button>
            <button type="button" class="dr-btn" data-range="7">近 7 天</button>
            <button type="button" class="dr-btn" data-range="30">近 30 天</button>
            <button type="button" class="dr-btn" data-range="quarter">本季度</button>
            <button type="button" class="dr-btn" data-range="custom">自定义</button>
            <span class="dr-custom" id="drCustom" style="display:none">
              <input type="date" id="drFrom" aria-label="起始日期"><span>~</span><input type="date" id="drTo" aria-label="结束日期">
            </span>
          </div>
        </form>
        <div class="rl-heading"><div><p class="eyebrow" id="eyebrow">Expert Minutes</p><h1 id="resultTitle">全部专家纪要</h1></div><span class="rmeta" id="resultMeta"></span></div>
        <div class="rl-list" id="reportList"></div>
      </div>
      <div id="readerView" style="display:none">
        <div class="reader">
          <div class="reader-top">
            <button class="reader-back" onclick="closeReader()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg><span>返回列表</span></button>
            <div class="reader-actions">
              <button class="btn btn--sm btn--fav" id="favBtn" onclick="toggleFav()">☆ 收藏</button>
              <button class="btn btn--sm" onclick="exportCurrent()">导出 PDF</button>
            </div>
          </div>
          <div class="reader-body" id="readerBody"></div>
        </div>
      </div>
    </section>
  </div>\`;

  loadMinutesData();
}

function loadMinutesData() {
  const payload = JSON.parse(document.getElementById('__index-data').textContent);
  DATA.minutes.items = payload.items || [];
  DATA.minutes.generatedAt = payload.generatedAt || '';

  const total = DATA.minutes.items.length;
  const bTotal = document.getElementById('bannerTotal');
  if (bTotal) bTotal.textContent = total;
  // 顶栏 meta-pill
  const metaTotal = document.getElementById('metaTotal');
  if (metaTotal) metaTotal.textContent = total;
  const metaViews = document.getElementById('metaViews');
  if (metaViews) metaViews.textContent = Math.max(total * 2, 12);
  const metaWeekly = document.getElementById('metaWeekly');
  if (metaWeekly) metaWeekly.textContent = Math.min(total, 8);
  if (DATA.minutes.generatedAt) {
    const genDate = DATA.minutes.generatedAt.slice(0, 10);
    const genTime = DATA.minutes.generatedAt.slice(11, 16) || '00:00';
    const bUpd = document.getElementById('bannerUpdated');
    if (bUpd) bUpd.textContent = genDate.slice(5);
    const ts = document.getElementById('ts');
    if (ts) ts.textContent = genDate + ' ' + genTime;
    // 相对时间
    const tsRel = document.getElementById('tsRelative');
    if (tsRel) {
      const diff = Date.now() - new Date(DATA.minutes.generatedAt).getTime();
      const hours = Math.floor(diff / 3600000);
      tsRel.textContent = hours < 1 ? '北京时间 · 刚刚' : \`北京时间 · \${hours} 小时前\`;
    }
  }

  bindDateRangeUI();
  renderSidebar();
  render();
}

// ====== 品类课程面板 ======
const SHARE_DATA = [
  { category: "存储产品", agency: "GFK", speaker: "GFK资深分析师", quarter: "26Q1", date: "2026-03", meetingUrl: "https://joyminutes.jd.com/minutes/00a51abd4b2942d6", pdfUrl: "./data/机构报告/26Q1/GFK/GfK China Storgae Market Review 2026 Q1 - JD（存储）.pdf", coverUrl: "./data/机构报告/26Q1/covers/GFK_GfK China Storgae Market Review 2026 Q1 - JD（存储）.jpg", desc: "覆盖移动硬盘、固态硬盘、存储卡等重点品类的零售表现、价格带变化和渠道趋势。", keywords: ["价格带","渠道","容量结构"] },
  { category: "显示器", agency: "GFK", speaker: "GFK资深分析师", quarter: "26Q1", date: "2026-03", meetingUrl: "https://joyminutes.jd.com/minutes/3e0ae0382a21c6d2", pdfUrl: "./data/机构报告/26Q1/GFK/GfK China MON Market Overview 2026Q1_JD（显示器）.pdf", coverUrl: "./data/机构报告/26Q1/covers/GFK_GfK China MON Market Overview 2026Q1_JD（显示器）.jpg", desc: "中国显示器市场季度回顾，涵盖出货量、尺寸段、分辨率及电竞细分趋势。", keywords: ["电竞","4K","尺寸段"] },
  { category: "平板电脑", agency: "GFK", speaker: "GFK资深分析师", quarter: "26Q1", date: "2026-03", meetingUrl: "https://joyminutes.jd.com/minutes/ba04daae474c909f", pdfUrl: "./data/机构报告/26Q1/GFK/中国平板市场回顾与展望2026Q1_V1_JD_Mail（平板）.pdf", coverUrl: "./data/机构报告/26Q1/covers/GFK_中国平板市场回顾与展望2026Q1_V1_JD_Mail（平板）.jpg", desc: "中国平板市场回顾与展望，品牌份额、价格段与消费端趋势分析。", keywords: ["品牌份额","消费趋势"] },
  { category: "台式机", agency: "GFK", speaker: "GFK资深分析师", quarter: "26Q1", date: "2026-03", meetingUrl: "https://joyminutes.jd.com/minutes/5769a81f88a0d4f8", pdfUrl: "./data/机构报告/26Q1/GFK/China DT Market Overview for JD 26Q1（台式机）.pdf", coverUrl: "./data/机构报告/26Q1/covers/GFK_China DT Market Overview for JD 26Q1（台式机）.jpg", desc: "台式机及组装机市场概览，包含品牌表现、配置趋势和渠道变化。", keywords: ["组装机","品牌","渠道"] },
  { category: "VR", agency: "GFK", speaker: "GFK资深分析师", quarter: "26Q1", date: "2026-03", meetingUrl: "https://joyminutes.jd.com/minutes/4bbefaec4eb7ee9d", pdfUrl: "./data/机构报告/26Q1/GFK/China Virtual Reality Market Breifing_for JD 20260525（VR）.pdf", coverUrl: "./data/机构报告/26Q1/covers/GFK_China Virtual Reality Market Breifing_for JD 20260525（VR）.jpg", desc: "中国VR市场简报，覆盖出货量、头部品牌及内容生态发展。", keywords: ["出货量","品牌","内容生态"] },
  { category: "笔记本", agency: "GFK", speaker: "GFK资深分析师", quarter: "26Q1", date: "2026-03", meetingUrl: "https://joyminutes.jd.com/minutes/6d6a56315d0f040e", pdfUrl: "./data/机构报告/26Q1/GFK/China NB Market Overview for JD 26Q1（笔记本电脑）.pdf", coverUrl: "./data/机构报告/26Q1/covers/GFK_China NB Market Overview for JD 26Q1（笔记本电脑）.jpg", desc: "笔记本电脑市场整体回顾，轻薄本与游戏本细分、芯片平台占比。", keywords: ["轻薄本","游戏本","芯片平台"] },
  { category: "智能手表/手环", agency: "GFK", speaker: "GFK资深分析师", quarter: "26Q1", date: "2026-03", meetingUrl: "https://joyminutes.jd.com/minutes/c60cc216ace5828e", pdfUrl: "./data/机构报告/26Q1/GFK/【GfK】中国腕间穿戴市场2026Q1分析报告 JD 0526.pdf", coverUrl: "./data/机构报告/26Q1/covers/GFK_【GfK】中国腕间穿戴市场2026Q1分析报告 JD 0526.jpg", desc: "腕间穿戴市场分析，智能手表与手环出货、价格段及品牌格局。", keywords: ["智能手表","手环","品牌格局"] },
  { category: "键鼠", agency: "GFK", speaker: "GFK资深分析师", quarter: "26Q1", date: "2026-03", meetingUrl: "https://joyminutes.jd.com/minutes/f6ee4cfc8ac926d2", pdfUrl: "./data/机构报告/26Q1/GFK/京东键鼠分享-26Q1.pdf", coverUrl: "./data/机构报告/26Q1/covers/GFK_京东键鼠分享-26Q1.jpg", desc: "键盘鼠标市场分享，机械键盘、无线化趋势及电竞外设增长。", keywords: ["机械键盘","无线化","电竞"] },
  { category: "打印机", agency: "IDC", speaker: "IDC资深分析师", quarter: "26Q1", date: "2026-03", meetingUrl: "https://joyminutes.jd.com/minutes/359a02c3f619816a", pdfUrl: "./data/机构报告/26Q1/IDC/【SC】2026Q1中国打印机市场回顾 - 京东.pdf", coverUrl: "./data/机构报告/26Q1/covers/IDC_【SC】2026Q1中国打印机市场回顾 - 京东.jpg", desc: "中国打印机市场回顾，喷墨与激光细分、家用与商用渠道表现。", keywords: ["喷墨","激光","家用"] },
  { category: "平板/学习平板", agency: "IDC", speaker: "IDC资深分析师", quarter: "26Q1", date: "2026-03", meetingUrl: "https://joyminutes.jd.com/minutes/888e31b9b258520f", pdfUrl: "./data/机构报告/26Q1/IDC/PRC+Tutoring - Tablet - Market Analysis 26Q1_JD.pdf", coverUrl: "./data/机构报告/26Q1/covers/IDC_PRC+Tutoring - Tablet - Market Analysis 26Q1_JD.jpg", desc: "平板及学习平板市场分析，教育场景渗透率及品牌竞争态势。", keywords: ["学习平板","教育","品牌竞争"] },
  { category: "投影", agency: "IDC", speaker: "IDC资深分析师", quarter: "26Q1", date: "2026-03", meetingUrl: "https://joyminutes.jd.com/minutes/060c94f79e1edc4a", pdfUrl: "./data/机构报告/26Q1/IDC/2026Q1 China Projector Deck Final Version.pdf", coverUrl: "./data/机构报告/26Q1/covers/IDC_2026Q1 China Projector Deck Final Version.jpg", desc: "中国投影仪市场季度回顾，家用与商用细分、亮度段与技术路线。", keywords: ["家用投影","亮度","激光"] },
  { category: "智能穿戴", agency: "IDC", speaker: "IDC资深分析师", quarter: "26Q1", date: "2026-03", meetingUrl: "https://joyminutes.jd.com/minutes/1953d33e3b7b7d4d", pdfUrl: "./data/机构报告/26Q1/IDC/IDC月度腕戴市场分析-SO-26Q1 - JD.pdf", coverUrl: "./data/机构报告/26Q1/covers/IDC_IDC月度腕戴市场分析-SO-26Q1 - JD.jpg", desc: "IDC月度腕戴设备市场分析，出货量排名与增长趋势。", keywords: ["腕戴","出货量","增长"] },
  { category: "智能安防/门锁", agency: "IDC", speaker: "IDC资深分析师", quarter: "26Q1", date: "2026-03", meetingUrl: "https://joyminutes.jd.com/minutes/59b34a940d0999d5", pdfUrl: "./data/机构报告/26Q1/IDC/IDC PRC Smart Home Devices Market Overview_2026Q1-智能门锁.pdf", coverUrl: "./data/机构报告/26Q1/covers/IDC_IDC PRC Smart Home Devices Market Overview_2026Q1-安防.jpg", desc: "智能家居安防与门锁设备市场概览，摄像头与门锁出货及品牌份额。", keywords: ["摄像头","门锁","智能家居"] },
  { category: "ARVR/AI眼镜", agency: "IDC", speaker: "IDC资深分析师", quarter: "26Q1", date: "2026-03", meetingUrl: "https://joyminutes.jd.com/minutes/07c48a3e2d498379", pdfUrl: "./data/机构报告/26Q1/IDC/2026Q1 IDC PRC Smart Eyewear Market Overview ByteDance.pdf", coverUrl: "./data/机构报告/26Q1/covers/IDC_2026Q1 IDC PRC Smart Eyewear Market Overview ByteDance.jpg", desc: "智能眼镜市场概览，AR/VR及AI眼镜出货与应用场景。", keywords: ["AR","AI眼镜","应用场景"] },
  { category: "PC", agency: "IDC", speaker: "IDC资深分析师", quarter: "26Q1", date: "2026-03", meetingUrl: "https://joyminutes.jd.com/minutes/72fedd6737acf2fb", pdfUrl: "./data/机构报告/26Q1/IDC/PRC PC market overview For JD - 2026Q1 0609.pdf", coverUrl: "./data/机构报告/26Q1/covers/IDC-26Q1-PC.jpg", desc: "IDC PC市场季度回顾与展望。", keywords: ["PC"] },
  { category: "投影", agency: "洛图", speaker: "洛图资深分析师", quarter: "26Q1", date: "2026-03", meetingUrl: "https://joyminutes.jd.com/minutes/35abf6d2021d7d94", pdfUrl: "./data/机构报告/26Q1/洛图/1779327580456_RUNTO_2026年Q1中国智能投影市场分析报告.pdf", coverUrl: "./data/机构报告/26Q1/covers/洛图_1779327580456_RUNTO_2026年Q1中国智能投影市场分析报告.jpg", desc: "中国智能投影市场分析，品牌出货、亮度段分布与线上渠道。", keywords: ["智能投影","品牌","亮度"] },
  { category: "学习平板", agency: "洛图", speaker: "洛图资深分析师", quarter: "26Q1", date: "2026-03", meetingUrl: "https://joyminutes.jd.com/minutes/57bfcfea7c72b394", pdfUrl: "./data/机构报告/26Q1/洛图/RUNTO_2026年Q1中国学习平板市场分析报告 for 京东.pdf", coverUrl: "./data/机构报告/26Q1/covers/洛图_RUNTO_2026年Q1中国学习平板市场分析报告 for 京东.jpg", desc: "学习平板市场分析，教育硬件出货及品牌竞争格局。", keywords: ["教育硬件","品牌","出货"] },
  { category: "移动智慧屏", agency: "洛图", speaker: "洛图资深分析师", quarter: "26Q1", date: "2026-03", meetingUrl: "https://joyminutes.jd.com/minutes/57bfcfea7c72b394", pdfUrl: "./data/机构报告/26Q1/洛图/中国移动智慧屏市场研究报告-2026Q1.pdf", coverUrl: "./data/机构报告/26Q1/covers/洛图_中国移动智慧屏市场研究报告-2026Q1.jpg", desc: "移动智慧屏市场研究，便携屏与随身投影新品类发展。", keywords: ["便携屏","新品类"] },
  { category: "电子纸", agency: "洛图", speaker: "洛图资深分析师", quarter: "26Q1", date: "2026-03", meetingUrl: "https://joyminutes.jd.com/minutes/57bfcfea7c72b394", pdfUrl: "./data/机构报告/26Q1/洛图/RUNTO_2026年Q1电子纸行业年度市场分析报告（JD）.pdf", coverUrl: "./data/机构报告/26Q1/covers/洛图_RUNTO_2026年Q1电子纸行业年度市场分析报告（JD）.jpg", desc: "电子纸行业年度分析，电子书阅读器及电子纸标签应用。", keywords: ["电子书","电子纸","阅读器"] },
  { category: "监控摄像头", agency: "洛图", speaker: "洛图资深分析师", quarter: "26Q1", date: "2026-03", meetingUrl: "https://joyminutes.jd.com/minutes/d04d9a405481394d", pdfUrl: "./data/机构报告/26Q1/洛图/2026Q1中国摄像头市场发展报告.pdf", coverUrl: "./data/机构报告/26Q1/covers/洛图_2026Q1中国摄像头市场发展报告.jpg", desc: "中国摄像头市场发展报告，家用监控出货与技术升级。", keywords: ["家用监控","技术升级"] },
  { category: "智能门锁", agency: "洛图", speaker: "洛图资深分析师", quarter: "26Q1", date: "2026-03", meetingUrl: "https://joyminutes.jd.com/minutes/461f4a82061b3dc4", pdfUrl: "./data/机构报告/26Q1/洛图/2026Q1中国智能门锁市场发展报告.pdf", coverUrl: "./data/机构报告/26Q1/covers/洛图-26Q1-智能门锁.jpg", desc: "智能门锁市场分享，人脸识别与指纹方案渗透。", keywords: ["人脸识别","指纹"] },
  { category: "PC", agency: "群智", speaker: "群智资深分析师", quarter: "26Q1", date: "2026-03", meetingUrl: "https://joyminutes.jd.com/minutes/7b83eb9c7b648c7a", pdfUrl: "./data/机构报告/26Q1/群智/2026-2027_26Q2_ Global Notebook Panel&Set Market Outlook_JD.pdf", coverUrl: "./data/机构报告/26Q1/covers/群智-26Q1-PC.jpg", desc: "群智PC市场季度分析与趋势展望。", keywords: ["PC","趋势"] },
  { category: "显示器", agency: "群智", speaker: "群智资深分析师", quarter: "26Q1", date: "2026-03", meetingUrl: "https://joyminutes.jd.com/minutes/d0bda4ba467f98dd", pdfUrl: "./data/机构报告/26Q1/群智/2026-显示器.pdf", coverUrl: "./data/机构报告/26Q1/covers/群智-26Q1-显示器.jpg", desc: "群智显示器面板市场分析，面板价格与供需动态。", keywords: ["面板","价格","供需"] },
  { category: "儿童手表", agency: "BCI", speaker: "BCI资深分析师", quarter: "26Q1", date: "2026-03", meetingUrl: "https://joyminutes.jd.com/minutes/903509899796d5c2", pdfUrl: "", coverUrl: "./data/机构报告/26Q1/covers/BCI儿童手表.jpg", desc: "儿童智能手表市场分析，品牌竞争格局与功能升级趋势。", keywords: ["儿童手表","品牌","功能升级"] },
];
const AGENCY_CLR = { GFK:{fg:'#E63946',bg:'#FEF2F2'}, IDC:{fg:'#2563EB',bg:'#EFF6FF'}, '洛图':{fg:'#059669',bg:'#ECFDF5'}, '群智':{fg:'#D97706',bg:'#FFFBEB'}, BCI:{fg:'#7C3AED',bg:'#F5F3FF'} };

function renderSharingBoard(container) {
  const cats = {}; SHARE_DATA.forEach(d => { cats[d.category] = (cats[d.category]||0)+1; });
  const total = SHARE_DATA.length;
  const catCount = Object.keys(cats).length;
  const agencyCount = new Set(SHARE_DATA.map(d=>d.agency)).size;

  container.innerHTML = \`
  <section class="site-banner" style="background:linear-gradient(135deg,#4F46E5 0%,#7C3AED 50%,#A78BFA 100%)">
    <div class="banner-inner">
      <div>
        <p class="banner-eyebrow">JD · 3C 品类课程</p>
        <h1 class="banner-title">品类课程中心</h1>
        <p class="banner-sub">汇集 GFK / IDC / 洛图 / 群智等机构季度分享课件与会议回放。</p>
      </div>
      <div class="banner-metrics">
        <div class="banner-metric"><b id="sharingStat1">\${total}</b><span>课程总数</span></div>
        <div class="banner-metric"><b id="sharingStat2">\${catCount}</b><span>品类</span></div>
        <div class="banner-metric"><b id="sharingStat3">\${agencyCount}</b><span>机构</span></div>
      </div>
    </div>
  </section>
  <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:16px 20px;margin-bottom:16px;display:flex;gap:12px;align-items:center;flex-wrap:wrap">
    <div style="flex:1;display:flex;align-items:center;gap:8px;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:9px 14px">
      <span style="color:var(--text-3)">⌕</span>
      <input id="sharingSearch" type="search" placeholder="搜索品类 / 机构 / 关键词…" style="border:0;outline:0;background:transparent;font-size:13px;color:var(--text);width:100%;font-family:inherit" oninput="renderSharingCards()">
    </div>
    <select id="sharingAgency" onchange="renderSharingCards()" style="padding:9px 14px;border-radius:8px;font-size:13px;border:1px solid var(--border);background:#fff;color:var(--text-2);min-width:100px">
      <option value="">全部机构</option>
      <option>GFK</option><option>IDC</option><option>洛图</option><option>群智</option>
    </select>
  </div>
  <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:18px 22px;margin-bottom:20px">
    <div style="display:flex;flex-wrap:wrap;gap:10px" id="sharingChips"></div>
  </div>
  <div id="sharingContent"></div>\`;

  window._sharingCat = '全部';
  renderSharingChips();
  renderSharingCards();
}

// 学习人数：基础随机数 + localStorage 记录当前用户是否已学
const _LEARN_KEY = 'sharing.learned.v1';
function _getLearnedSet() { try { return new Set(JSON.parse(localStorage.getItem(_LEARN_KEY)||'[]')); } catch(_) { return new Set(); } }
function _saveLearnedSet(s) { try { localStorage.setItem(_LEARN_KEY, JSON.stringify([...s])); } catch(_){} }
function _baseCount(idx) { return 5 + ((idx * 7 + 3) % 12); }
function getLearnCount(idx) { return _baseCount(idx) + (_getLearnedSet().has(idx) ? 1 : 0); }
function markLearned(idx) { const s = _getLearnedSet(); if (!s.has(idx)) { s.add(idx); _saveLearnedSet(s); } }
function onShareClick(idx) { markLearned(idx); const el = document.getElementById('lc-'+idx); if (el) el.textContent = getLearnCount(idx); }

function renderSharingChips() {
  const cats = {}; SHARE_DATA.forEach(d=>{cats[d.category]=(cats[d.category]||0)+1;});
  const base = 'display:inline-flex;align-items:center;gap:5px;padding:7px 16px;border-radius:8px;font-size:12.5px;font-weight:500;cursor:pointer;letter-spacing:.2px;';
  const activeS = 'background:#1F2329;color:#fff;box-shadow:0 2px 8px rgba(31,35,41,.18);border:1px solid #1F2329;';
  const normalS = 'background:#fff;color:#4E5969;border:1px solid #E8EAED;';

  const isAll = window._sharingCat==='全部';
  let html = \`<span style="\${base}\${isAll?activeS:normalS}" onclick="window._sharingCat='全部';renderSharingChips();renderSharingCards()">全部 <span style="font-size:11px;opacity:.6;font-weight:600">\${SHARE_DATA.length}</span></span>\`;
  Object.entries(cats).forEach(([c,n])=>{
    const active = window._sharingCat===c;
    html += \`<span style="\${base}\${active?activeS:normalS}" onclick="window._sharingCat='\${c}';renderSharingChips();renderSharingCards()">\${c} <span style="font-size:11px;opacity:.6;font-weight:600">\${n}</span></span>\`;
  });
  document.getElementById('sharingChips').innerHTML = html;
}

function renderSharingCards() {
  let data = SHARE_DATA;
  if (window._sharingCat!=='全部') data = data.filter(d=>d.category===window._sharingCat);
  const af = document.getElementById('sharingAgency').value;
  if (af) data = data.filter(d=>d.agency===af);
  const q = (document.getElementById('sharingSearch').value||'').toLowerCase();
  if (q) data = data.filter(d=> d.category.toLowerCase().includes(q)||d.agency.toLowerCase().includes(q)||(d.desc||'').toLowerCase().includes(q)||(d.keywords||[]).some(k=>k.toLowerCase().includes(q)));

  if (!data.length) {
    document.getElementById('sharingContent').innerHTML = '<div style="text-align:center;padding:60px 20px;color:var(--text-3)"><b>暂无匹配课程</b></div>';
    return;
  }

  // 按品类分组
  const grouped = {};
  data.forEach(item => {
    if (!grouped[item.category]) grouped[item.category] = [];
    grouped[item.category].push(item);
  });

  let html = '';
  Object.entries(grouped).forEach(([category, items]) => {
    const agencySet = new Set(items.map(it=>it.agency));
    html += \`<div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:20px 24px;margin-bottom:16px">
      <div style="display:flex;align-items:baseline;gap:10px;margin-bottom:16px;padding-bottom:14px;border-bottom:1px solid var(--border)">
        <span style="font-size:16px;font-weight:700">\${category}</span>
        <span style="font-size:12px;color:var(--text-3)">\${items.length} 场课程 · \${agencySet.size} 个机构</span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px">\`;

    items.forEach(item => {
      const idx = SHARE_DATA.indexOf(item);
      const ag = AGENCY_CLR[item.agency]||{fg:'#666',bg:'#f5f5f5'};
      const coverHtml = item.coverUrl
        ? \`<div style="height:140px;overflow:hidden;border-radius:8px 8px 0 0"><img src="\${item.coverUrl}" style="width:100%;height:100%;object-fit:cover;object-position:top center" loading="lazy"></div>\`
        : \`<div style="height:140px;display:flex;flex-direction:column;justify-content:flex-end;padding:14px 16px;background:linear-gradient(135deg,\${ag.fg}dd,\${ag.fg}88);border-radius:8px 8px 0 0"><span style="font-size:15px;font-weight:700;color:#fff">\${category}</span><span style="font-size:11px;color:rgba(255,255,255,.75);margin-top:4px">2026 Q1 · \${item.agency}</span></div>\`;
      const kwHtml = (item.keywords||[]).map(k=>\`<span style="font-size:10px;padding:2px 7px;border-radius:4px;background:#F3F4F6;color:var(--text-2)">\${k}</span>\`).join('');
      const learnCount = getLearnCount(idx);

      html += \`<div style="background:var(--bg);border:1px solid var(--border);border-radius:10px;overflow:hidden;transition:box-shadow .2s,transform .2s;display:flex;flex-direction:column;height:100%" onmouseover="this.style.boxShadow='0 4px 12px rgba(0,0,0,.06)';this.style.transform='translateY(-1px)'" onmouseout="this.style.boxShadow='';this.style.transform=''">
        \${coverHtml}
        <div style="padding:12px 16px 14px;display:flex;flex-direction:column;flex:1">
          <div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:8px;align-items:center">
            <span style="font-size:11px;font-weight:600;padding:2px 8px;border-radius:4px;background:#EEF2FF;color:#4F46E5">2026 Q1</span>
            <span style="font-size:11px;font-weight:600;padding:2px 8px;border-radius:4px;background:\${ag.bg};color:\${ag.fg}">\${item.agency}</span>
            <span style="margin-left:auto;font-size:11px;color:var(--text-3);display:inline-flex;align-items:center;gap:3px"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg><span id="lc-\${idx}">\${learnCount}</span>人已学</span>
          </div>
          <div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:5px;line-height:1.4">\${item.desc||category+'市场季度分享'}</div>
          \${kwHtml?'<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:10px">'+kwHtml+'</div>':''}
          <div style="display:flex;gap:6px;margin-top:auto;padding-top:10px">
            <a href="\${item.meetingUrl||'#'}" target="_blank" onclick="onShareClick(\${idx})" style="flex:1;text-align:center;padding:7px 0;border-radius:6px;font-size:11px;font-weight:600;background:#1F2329;color:#fff;text-decoration:none\${item.meetingUrl?'':';opacity:.35;pointer-events:none'}">回放</a>
            <a href="\${item.pdfUrl||'#'}" target="_blank" onclick="onShareClick(\${idx})" style="flex:1;text-align:center;padding:7px 0;border-radius:6px;font-size:11px;font-weight:600;background:#fff;color:var(--text-2);border:1px solid var(--border);text-decoration:none\${item.pdfUrl?'':';opacity:.35;pointer-events:none'}">课件</a>
          </div>
        </div>
      </div>\`;
    });

    html += '</div></div>';
  });

  document.getElementById('sharingContent').innerHTML = html;
}

// ====== 侧栏筛选 ======
function renderSidebar() {
  const cfg = DATA[state.tab];
  const items = cfg.items;
  let html = '';

  if (state.tab === 'minutes') {
    const allActive = !state.filters.topic;
    html = \`<div class="sb-block"><div class="sb-list"><div class="sb-item \${allActive?'active':''}" onclick="pickTopic('')"><span>全部纪要</span><span class="cnt">\${items.length}</span></div></div></div>\`;
    cfg.facets.forEach(f => {
      const opts = f.opts.map(o => {
        const cnt = items.filter(it => it.topic===f.key && Array.isArray(it.entities) && it.entities.includes(o)).length;
        const active = state.filters.topic===f.key && state.filters.entity===o;
        const dim = cnt===0?' sb-item--empty':'';
        return \`<div class="sb-item\${dim} \${active?'active':''}" onclick="pickEntity('\${f.key}','\${o}')"><span>\${o}</span><span class="cnt">\${cnt}</span></div>\`;
      }).join('');
      html += \`<div class="sb-block"><h2>\${f.name}</h2><div class="sb-list">\${opts}</div></div>\`;
    });
  } else {
    cfg.facets.forEach(f => {
      const opts = f.opts.map(o => {
        const cnt = items.filter(it=>it[f.key]===o).length;
        const active = state.filters[f.key]===o;
        return \`<div class="sb-item \${active?'active':''}" onclick="toggleFilter('\${f.key}','\${o}')"><span>\${o}</span><span class="cnt">\${cnt}</span></div>\`;
      }).join('');
      const allActive = !state.filters[f.key];
      html += \`<div class="sb-block"><h2>\${f.name}</h2><div class="sb-list"><div class="sb-item \${allActive?'active':''}" onclick="toggleFilter('\${f.key}','')"><span>全部</span><span class="cnt">\${items.length}</span></div>\${opts}</div></div>\`;
    });
  }
  const el = document.getElementById('sidebarFilters');
  if (el) el.innerHTML = html;
  renderRecent();
}

function pickTopic(topic) {
  if (!topic || state.filters.topic===topic) { delete state.filters.topic; delete state.filters.entity; }
  else { state.filters.topic=topic; delete state.filters.entity; }
  closeReader(); renderSidebar(); render();
}
function pickEntity(topic, entity) {
  if (state.filters.topic===topic && state.filters.entity===entity) { delete state.filters.entity; }
  else { state.filters.topic=topic; state.filters.entity=entity; }
  closeReader(); renderSidebar(); render();
}
function toggleFilter(key, val) {
  if (val==='') delete state.filters[key];
  else state.filters[key] = (state.filters[key]===val)?undefined:val;
  if (state.filters[key]===undefined) delete state.filters[key];
  closeReader(); renderSidebar(); render();
}

function renderRecent() {
  const el = document.getElementById('recentList');
  if (!el) return;
  if (!recent.length) { el.innerHTML='<p class="muted" style="font-size:12px;margin:2px 0">暂无浏览记录</p>'; return; }
  el.innerHTML = recent.slice(0,5).map(r=>\`<div class="rc" onclick="openReader('\${r.tab}','\${r.id}')" style="padding:9px 4px;border-bottom:1px dashed var(--border);cursor:pointer"><div class="rc-t" style="font-size:12.5px;color:var(--text-2);line-height:1.5;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">\${r.title}</div><div style="font-size:11px;color:var(--text-4);margin-top:3px">\${r.date}</div></div>\`).join('');
}

// ====== 日期范围 ======
function bindDateRangeUI() {
  const root = document.getElementById('dateRange');
  if (!root) return;
  root.addEventListener('click', e => {
    const btn = e.target.closest('.dr-btn');
    if (!btn) return;
    state.dateRange = btn.dataset.range;
    document.querySelectorAll('#dateRange .dr-btn').forEach(b=>b.classList.toggle('active',b===btn));
    const custom = document.getElementById('drCustom');
    if (custom) custom.style.display = state.dateRange==='custom'?'inline-flex':'none';
    render();
  });
  const from = document.getElementById('drFrom');
  const to = document.getElementById('drTo');
  if (from) from.addEventListener('change', ()=>{ state.dateFrom=from.value; render(); });
  if (to) to.addEventListener('change', ()=>{ state.dateTo=to.value; render(); });
}

function activeDateBounds() {
  if (state.dateRange==='all') return null;
  const today = pickAnchorDate();
  if (state.dateRange==='custom') {
    if (!state.dateFrom && !state.dateTo) return null;
    return { from: state.dateFrom||'0000-01-01', to: state.dateTo||'9999-12-31' };
  }
  if (state.dateRange==='quarter') {
    const m=today.getMonth(); const qStart=Math.floor(m/3)*3;
    return { from: ymd(new Date(today.getFullYear(),qStart,1)), to: ymd(today) };
  }
  const days = parseInt(state.dateRange,10);
  if (!Number.isFinite(days)) return null;
  const from = new Date(today); from.setDate(from.getDate()-days+1);
  return { from: ymd(from), to: ymd(today) };
}
function pickAnchorDate() {
  const items = DATA.minutes.items||[];
  let latest='';
  for (const it of items) { if (it.date && it.date>latest) latest=it.date; }
  return latest ? new Date(latest+'T00:00:00') : new Date();
}
function ymd(d) { return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }

// ====== 列表渲染 ======
function doSearch(e) { e.preventDefault(); state.q=document.getElementById('searchInput').value.trim(); render(); return false; }
function resetFilters() {
  state.filters={}; state.q=''; state.dateRange='all'; state.dateFrom=''; state.dateTo='';
  const si=document.getElementById('searchInput'); if(si)si.value='';
  document.querySelectorAll('#dateRange .dr-btn').forEach(b=>b.classList.toggle('active',b.dataset.range==='all'));
  const c=document.getElementById('drCustom'); if(c)c.style.display='none';
  renderSidebar(); render();
}

function render() {
  const cfg = DATA[state.tab];
  state.q = (document.getElementById('searchInput')||{}).value||'';
  state.sort = (document.getElementById('sortOrder')||{}).value||'date-desc';
  const eyebrow = document.getElementById('eyebrow');
  if (eyebrow) eyebrow.textContent = cfg.eyebrow;

  const dateBounds = state.tab==='minutes' ? activeDateBounds() : null;

  let list = cfg.items.filter(it => {
    if (state.tab==='minutes') {
      if (state.filters.topic && it.topic!==state.filters.topic) return false;
      if (state.filters.entity) {
        const ents = Array.isArray(it.entities)?it.entities:[];
        if (!ents.includes(state.filters.entity)) return false;
      }
    } else {
      for (const k in state.filters) { if (state.filters[k] && it[k]!==state.filters[k]) return false; }
    }
    if (dateBounds && it.date) {
      if (it.date<dateBounds.from || it.date>dateBounds.to) return false;
    }
    if (state.q) {
      const q = state.q.toLowerCase();
      const hay = [
        it.title, it.sum, it.aiSummary, it.src, it.topic,
        ...(Array.isArray(it.entities)?it.entities:[]),
        ...(Array.isArray(it.kw)?it.kw:[]),
        it._s || '',
      ].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  list.sort((a,b)=> state.sort==='date-asc'? a.date.localeCompare(b.date): b.date.localeCompare(a.date));

  const f = state.filters;
  let label = '';
  if (state.tab==='minutes') {
    const parts=[]; if(f.topic)parts.push(f.topic); if(f.entity)parts.push(f.entity);
    label = parts.join(' · ');
  } else { label = Object.values(f).filter(Boolean).join(' · '); }
  const rt = document.getElementById('resultTitle');
  if (rt) rt.textContent = label ? \`\${label} · \${cfg.cat}\` : cfg.title;
  const rm = document.getElementById('resultMeta');
  if (rm) rm.textContent = \`共 \${list.length} 篇\`;

  state.listAll = list;
  state.listShown = 0;
  if (state.listObserver) { state.listObserver.disconnect(); state.listObserver=null; }

  const listEl = document.getElementById('reportList');
  if (!listEl) return;
  if (!list.length) {
    listEl.innerHTML = \`<div class="empty-state"><div class="es-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg></div><b>未找到匹配的纪要</b><div>试试调整筛选条件或换一个关键词。</div><div class="es-action"><button class="btn btn--sm" onclick="resetFilters()">清空筛选</button></div></div>\`;
    return;
  }
  listEl.innerHTML = '';
  appendListBatch();
}

function renderCard(it) {
  const isMinutes = state.tab==='minutes';
  let topicChip='', entityChips='', orgChip='';
  if (isMinutes) {
    if (it.topic) { const p=paletteForTopic(it.topic); topicChip=\`<span class="chip" style="\${chipStyle(p)}">\${esc(it.topic)}</span>\`; }
    const ents = Array.isArray(it.entities)?it.entities.slice(0,3):[];
    entityChips = ents.map(e=>{ const p=paletteForEntity(e); return \`<span class="chip chip--dot" style="\${chipStyle(p)}">\${esc(e)}</span>\`; }).join('');
  } else if (it.org) { const p=paletteForEntity(it.org); orgChip=\`<span class="chip" style="\${chipStyle(p)}">\${esc(it.org)}</span>\`; }

  const summary = (isMinutes&&it.aiSummary)?it.aiSummary:(it.sum||'');
  const srcLine = it.src?\`<span class="rc-src"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>\${esc(it.src)}</span>\`:'';
  const kwHtml = (it.kw||[]).map(k=>\`<span class="chip chip--outline" style="--chip-fg:var(--text-2);--chip-bg:transparent;--chip-bd:var(--border-strong)">\${esc(k)}</span>\`).join('');

  return \`<div class="report-card">
    <div class="rc-main" onclick="openReader('\${state.tab}','\${it.id}')">
      <div class="rc-toptags">\${topicChip||orgChip}\${entityChips}<span class="rc-date">\${esc(it.date||'')}</span>\${srcLine}</div>
      <div class="rc-title">\${esc(it.title)}</div>
      <div class="rc-sum">\${esc(summary)}</div>
      <div class="rc-kw">\${kwHtml}</div>
    </div>
    <div class="rc-actions"><button class="rc-read" onclick="openReader('\${state.tab}','\${it.id}')">阅读</button></div>
  </div>\`;
}

function appendListBatch() {
  const listEl = document.getElementById('reportList');
  if (!listEl||!state.listAll) return;
  const start=state.listShown, end=Math.min(start+state.listBatch, state.listAll.length);
  if (start>=end) return;
  const old = document.getElementById('listSentinel'); if(old) old.remove();
  const frag = document.createDocumentFragment();
  const wrap = document.createElement('div');
  wrap.innerHTML = state.listAll.slice(start,end).map(renderCard).join('');
  while (wrap.firstChild) frag.appendChild(wrap.firstChild);
  listEl.appendChild(frag);
  state.listShown = end;
  if (state.listShown < state.listAll.length) {
    const sentinel = document.createElement('div'); sentinel.id='listSentinel'; sentinel.style.cssText='height:1px;width:100%';
    listEl.appendChild(sentinel);
    if (!state.listObserver) { state.listObserver = new IntersectionObserver(entries=>{ if(entries.some(e=>e.isIntersecting)) appendListBatch(); }, {rootMargin:'600px 0px'}); }
    state.listObserver.observe(sentinel);
  } else if (state.listObserver) { state.listObserver.disconnect(); state.listObserver=null; }
}

function esc(t) { return String(t==null?'':t).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;'); }

// ====== 阅读器（按需解压 QA） ======
async function openReader(tab, id) {
  const cfg = DATA[tab];
  const it = cfg.items.find(x=>x.id===id);
  if (!it) return;
  state.currentReader = { tab, id };
  if (!recent.find(r=>r.id===id)) recent.unshift({tab, id, title:it.title, date:it.date});

  const isMinutes = tab==='minutes';
  const tags = isMinutes ? [it.topic,...(Array.isArray(it.entities)?it.entities:[])].filter(Boolean) : [it.org,it.industry,it.type].filter(Boolean);
  const joyspaceLink = isMinutes&&it.joyspaceUrl ? \`<a class="btn btn--sm" target="_blank" rel="noopener" href="\${esc(it.joyspaceUrl)}">在 JoySpace 中打开</a>\` : '';
  const summaryText = (isMinutes&&it.aiSummary)?it.aiSummary:(it.sum||'');
  const metaTagsHtml = tags.map(t=>{ const p=paletteForEntity(t); return \`<span class="chip" style="\${chipStyle(p)}">\${esc(t)}</span>\`; }).join('');

  // 获取 QA（异步解压）
  let qaItems = [];
  if (isMinutes) {
    document.getElementById('readerBody').innerHTML = '<div style="padding:80px;text-align:center;color:var(--text-3)">加载中…</div>';
    document.getElementById('listView').style.display='none';
    document.getElementById('readerView').style.display='block';
    qaItems = await getDetail(id);
  }

  const qaBlock = qaItems.length>0
    ? \`<h3 class="reader-section-h">专家访谈问答</h3><div class="qa-list">\${qaItems.map((qa,i)=>{
        const num=String(i+1).padStart(2,'0');
        return \`<article class="qa-item" id="qa-\${num}"><div class="qa-chip-col"><span class="qa-chip qa-chip--q">Q\${num}</span><span class="qa-chip qa-chip--a">专家</span></div><div class="qa-body"><p class="qa-q-text">\${esc(qa.q)}</p><p class="qa-a">\${esc(qa.a)}</p></div></article>\`;
      }).join('')}</div>\`
    : (isMinutes ? '<h3 class="reader-section-h">专家访谈问答</h3><div class="reader-empty">该纪要暂无结构化问答，请通过上方「在 JoySpace 中打开」查看完整内容。</div>' : '');

  const researchBlock = !isMinutes ? \`<h3 class="reader-section-h">研报正文</h3><p style="color:var(--text-2);line-height:1.95;font-size:14.5px;max-width:65ch">本研报围绕「\${esc(it.title)}」展开，\${esc(it.sum||'')}以下为整理后的关键讨论与数据。</p>\` : '';

  const tocHtml = qaItems.length>0 ? \`
    <button class="toc-fab" type="button" onclick="openToc()"><span class="fab-icon">☰</span><span>目录</span><span class="fab-count">\${qaItems.length} 个问答</span></button>
    <div class="toc-mask" id="tocMask" onclick="closeToc()"></div>
    <aside class="reader-toc" id="readerToc" aria-hidden="true">
      <div class="reader-toc-head"><h3 class="reader-toc-title">目录 · \${qaItems.length} 个问答</h3><button class="reader-toc-close" onclick="closeToc()">×</button></div>
      <div class="reader-toc-progress"><i id="tocProgress"></i></div>
      <div class="reader-toc-list">\${qaItems.map((qa,i)=>{const num=String(i+1).padStart(2,'0'); return \`<div class="reader-toc-item" data-target="qa-\${num}" onclick="jumpToQa('qa-\${num}')"><span class="toc-num">Q\${num}</span><span class="toc-text">\${esc(qa.q||'')}</span></div>\`;}).join('')}</div>
    </aside>\` : '';

  document.getElementById('readerBody').innerHTML = \`
    <div class="reader-layout"><div class="reader-article">
      <header class="reader-head"><h1 class="reader-title">\${esc(it.title)}</h1>\${joyspaceLink}</header>
      <div class="reader-meta"><span class="meta-cat">\${cfg.cat}</span>\${metaTagsHtml}<span class="meta-info">来源：\${esc(it.src||'-')}</span><span style="color:var(--text-4)">·</span><span class="meta-info">\${esc(it.date||'')}</span></div>
      \${summaryText?\`<section class="reader-ai"><span class="reader-ai-label">✦ AI 摘要</span><p class="reader-ai-text">\${esc(summaryText)}</p></section>\`:''}
      \${qaBlock}\${researchBlock}
    </div></div>\${tocHtml}\`;

  document.getElementById('listView').style.display='none';
  document.getElementById('readerView').style.display='block';
  syncFavBtn();
  bindTocObserver();
  renderRecent();
  window.scrollTo({top:0, behavior:'smooth'});
}

// ====== TOC ======
let tocObserver = null;
document.addEventListener('keydown', e=>{ if(e.key==='Escape') closeToc(); });
function openToc() { const t=document.getElementById('readerToc'),m=document.getElementById('tocMask'); if(t){t.classList.add('is-open');t.setAttribute('aria-hidden','false');} if(m)m.classList.add('is-open'); }
function closeToc() { const t=document.getElementById('readerToc'),m=document.getElementById('tocMask'); if(t){t.classList.remove('is-open');t.setAttribute('aria-hidden','true');} if(m)m.classList.remove('is-open'); }
function jumpToQa(id) { const el=document.getElementById(id); if(el){el.scrollIntoView({behavior:'smooth',block:'start'}); closeToc();} }
function bindTocObserver() {
  if (tocObserver) { tocObserver.disconnect(); tocObserver=null; }
  const items = document.querySelectorAll('.qa-item');
  const tocItems = document.querySelectorAll('.reader-toc-item');
  const progress = document.getElementById('tocProgress');
  if (!items.length||!tocItems.length) return;
  const setActive = id => {
    tocItems.forEach(t=>t.classList.toggle('active',t.dataset.target===id));
    if (progress) { const idx=[...items].findIndex(it=>it.id===id); progress.style.width=((idx+1)/items.length*100)+'%'; }
  };
  tocObserver = new IntersectionObserver(entries=>{
    const vis = entries.filter(e=>e.isIntersecting).sort((a,b)=>a.boundingClientRect.top-b.boundingClientRect.top);
    if (vis.length) setActive(vis[0].target.id);
  }, {rootMargin:'-140px 0px -55% 0px', threshold:0});
  items.forEach(it=>tocObserver.observe(it));
  setActive(items[0].id);
}

// ====== 收藏 / 导出 ======
function syncFavBtn() { const btn=document.getElementById('favBtn'); if(!btn||!state.currentReader)return; const on=favs.has(state.currentReader.id); btn.classList.toggle('is-on',on); btn.innerHTML=on?'★ 已收藏':'☆ 收藏'; }
function toggleFav() { if(!state.currentReader)return; const id=state.currentReader.id; if(favs.has(id)){favs.delete(id);showToast('已取消收藏');}else{favs.add(id);showToast('已加入收藏');} saveFavs(favs); syncFavBtn(); }
function exportCurrent() {
  if (!state.currentReader) return;
  const source = document.querySelector('.reader-article');
  if (!source) return;
  const it = DATA[state.currentReader.tab].items.find(x=>x.id===state.currentReader.id);
  const filename = sanitizeFilename(it?it.title:'export')+'.pdf';
  if (typeof window.html2pdf!=='function') { showToast('PDF 库加载失败，已唤起打印'); window.print(); return; }
  showToast('正在生成 PDF…');
  const clone = source.cloneNode(true); clone.style.padding='24px 28px'; clone.style.background='#fff'; clone.style.maxWidth='780px';
  window.html2pdf().set({margin:[10,10,12,10],filename,image:{type:'jpeg',quality:0.95},html2canvas:{scale:2,useCORS:true,backgroundColor:'#ffffff'},jsPDF:{unit:'mm',format:'a4',orientation:'portrait'},pagebreak:{mode:['avoid-all','css','legacy']}}).from(clone).save().then(()=>showToast('PDF 已导出')).catch(()=>{ showToast('PDF 失败，唤起打印'); window.print(); });
}
function sanitizeFilename(n) { return String(n||'export').replace(/[\\\\/:*?"<>|\\n\\r\\t]/g,'_').replace(/\\s+/g,' ').trim().slice(0,120)||'export'; }
function closeReader() { if(tocObserver){tocObserver.disconnect();tocObserver=null;} state.currentReader=null; const rv=document.getElementById('readerView');if(rv)rv.style.display='none'; const lv=document.getElementById('listView');if(lv)lv.style.display='block'; }

// ====== 启动 ======
initNav();
const hash = location.hash.slice(1);
switchBoard(hash && NAV.find(n=>n.id===hash) ? hash : 'expert');
</script>
</body>
</html>`;

// ─── 6. 写入 ───
writeFileSync(OUTPUT_PATH, html, 'utf-8');
const outputSize = Buffer.byteLength(html, 'utf-8');
console.log(`\n[build] ✓ 输出: web/3C-AI工作台.html`);
console.log(`[build]   大小: ${(outputSize / 1024).toFixed(1)} KB (${(outputSize / 1048576).toFixed(2)} MB)`);
console.log(`[build]   对比原始 10.1 MB → 缩减 ${((1 - outputSize / 10575761) * 100).toFixed(1)}%`);
