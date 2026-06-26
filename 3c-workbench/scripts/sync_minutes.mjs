// 主同步脚本：拉源 API → 增量映射 → 可选 AI 打标/摘要 → 可选上传 JoySpace → 写入 web/data/minutes.json
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fetchReports, filterMinutes } from "./lib/fetch_source.mjs";
import { mapToBoardItem } from "./lib/map_to_board.mjs";
import { renderMarkdown } from "./lib/render_markdown.mjs";
import { classifyAndSummarize } from "./lib/classify_and_summarize.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const DATA_FILE = path.join(ROOT, "web", "data", "minutes.json");
const CACHE_DIR = path.join(HERE, ".cache");

const JOYSPACE_FOLDER =
  "https://joyspace.jd.com/h/personal/documents/7Euv0xaI6zwXq8Xe0MwH";

const args = parseCliArgs(process.argv.slice(2));

async function readJsonOrEmpty(file) {
  try {
    const text = await fs.readFile(file, "utf-8");
    return JSON.parse(text);
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

function parseCliArgs(argv) {
  const out = {
    upload: false,
    reupload: false,
    limit: 0,
    dryRun: false,
    ai: true, // 默认开 AI 打标 / 摘要
    reAi: false, // 强制对所有条目重新跑 AI
  };
  for (let i = 0; i < argv.length; i += 1) {
    const cur = argv[i];
    if (cur === "--upload") out.upload = true;
    else if (cur === "--no-upload") out.upload = false;
    else if (cur === "--reupload") {
      out.reupload = true;
      out.upload = true;
    } else if (cur === "--limit") {
      out.limit = Number(argv[i + 1] || "0");
      i += 1;
    } else if (cur === "--dry-run") out.dryRun = true;
    else if (cur === "--no-ai") out.ai = false;
    else if (cur === "--ai") out.ai = true;
    else if (cur === "--re-ai") {
      out.reAi = true;
      out.ai = true;
    }
  }
  return out;
}

async function maybeUpload(item, mdPath) {
  if (!args.upload) return "";
  const { uploadToJoyspace } = await import("./lib/upload_joyspace.mjs");
  return await uploadToJoyspace(mdPath, JOYSPACE_FOLDER);
}

function summarizeKinds(pending) {
  const c = {};
  for (const t of pending) c[t.kind] = (c[t.kind] || 0) + 1;
  return Object.entries(c).map(([k, v]) => `${k}=${v}`).join(", ") || "none";
}

async function main() {
  console.log(`[sync] fetching source...`);
  const data = await fetchReports();
  const remoteMinutes = filterMinutes(data.reports);
  console.log(`[sync] generatedAt=${data.generatedAt}, total minutes=${remoteMinutes.length}`);

  const localFile = await readJsonOrEmpty(DATA_FILE);
  const local = localFile || { generatedAt: "", items: [] };
  const localMap = new Map(local.items.map((it) => [it.id, it]));
  const remoteIds = new Set(remoteMinutes.map((r) => r.id));

  // 1. 删除：远程没了的本地条目
  const removed = local.items.filter((it) => !remoteIds.has(it.id));
  if (removed.length > 0) {
    console.log(`[sync] removed (no longer in remote): ${removed.length}`);
    for (const it of removed) localMap.delete(it.id);
  }

  // 2. 待处理列表：
  //    - 新条目（永远处理）
  //    - 已有但 joyspaceUrl 为空且开启上传 → 补传
  //    - 已有但缺 AI 标签且开启 AI → 补打标（不重传 joyspace）
  //    - --reupload：所有条目都重传
  //    - --re-ai：所有条目重打 AI 标
  const pending = [];
  for (const r of remoteMinutes) {
    const existing = localMap.get(r.id);
    if (!existing) {
      pending.push({ kind: "new", report: r });
    } else if (args.reupload) {
      pending.push({ kind: "reupload", report: r, existing });
    } else if (args.reAi) {
      pending.push({ kind: "re-ai", report: r, existing });
    } else if (args.upload && !existing.joyspaceUrl) {
      pending.push({ kind: "retry-upload", report: r, existing });
    } else if (args.ai && (!existing.topic || !existing.aiSummary)) {
      pending.push({ kind: "fill-ai", report: r, existing });
    }
  }
  console.log(`[sync] pending: ${pending.length} (kinds: ${summarizeKinds(pending)})`);

  await fs.mkdir(CACHE_DIR, { recursive: true });

  let toProcess = pending;
  if (args.limit > 0) {
    toProcess = pending.slice(0, args.limit);
    console.log(`[sync] limited to first ${toProcess.length}`);
  }

  let added = 0;
  let uploaded = 0;
  let uploadFailed = 0;
  let aiTagged = 0;
  let aiFailed = 0;
  for (const task of toProcess) {
    const { report, kind, existing } = task;
    const item =
      kind === "new" ? mapToBoardItem(report) : { ...existing, ...mapToBoardItem(report), joyspaceUrl: existing.joyspaceUrl };

    // 跨同步保留已有 AI 标签：mapToBoardItem 总是返回空的 topic/entities/aiSummary
    if (kind !== "new" && existing) {
      item.topic = existing.topic || "";
      item.entities = Array.isArray(existing.entities) ? existing.entities : [];
      item.aiSummary = existing.aiSummary || "";
    }

    // AI 打标 / 摘要：当 ai 开启 且（条目缺 AI 字段 或 强制重打）
    const needsAi = args.ai && (args.reAi || !item.topic || !item.aiSummary);
    if (needsAi) {
      try {
        const r = await classifyAndSummarize(report);
        item.topic = r.topic;
        item.entities = r.entities;
        item.aiSummary = r.aiSummary;
        aiTagged += 1;
        console.log(`  [ai] ${report.id} → topic=${r.topic} entities=${JSON.stringify(r.entities)}`);
      } catch (err) {
        aiFailed += 1;
        console.warn(`  [ai-fail] ${report.id}: ${err.message}`);
      }
    }

    const md = renderMarkdown(item);
    const mdPath = path.join(CACHE_DIR, `${report.id}.md`);
    await fs.writeFile(mdPath, md, "utf-8");

    if (args.upload) {
      try {
        const url = await maybeUpload(item, mdPath);
        if (url) {
          item.joyspaceUrl = url;
          uploaded += 1;
          console.log(`  [up] ${report.id} → ${url}`);
        } else {
          uploadFailed += 1;
          console.warn(`  [up-fail] ${report.id} (empty url)`);
        }
      } catch (err) {
        uploadFailed += 1;
        console.warn(`  [up-fail] ${report.id}: ${err.message}`);
      }
    }

    localMap.set(item.id, item);
    if (kind === "new") added += 1;
  }

  // 3. 排序 + 写盘
  const items = Array.from(localMap.values()).sort((a, b) =>
    (b.date || "").localeCompare(a.date || "")
  );
  const out = {
    generatedAt: data.generatedAt,
    syncedAt: new Date().toISOString(),
    total: items.length,
    items,
  };

  if (args.dryRun) {
    console.log(`[sync] dry-run: would write ${items.length} items`);
  } else {
    await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
    await fs.writeFile(DATA_FILE, JSON.stringify(out, null, 2), "utf-8");
    console.log(`[sync] wrote ${DATA_FILE} (${items.length} items)`);
  }

  console.log(
    `[sync] done. added=${added}, removed=${removed.length}, ai-tagged=${aiTagged}, ai-failed=${aiFailed}, uploaded=${uploaded}, upload-failed=${uploadFailed}`
  );
}

function isMain(metaUrl) {
  const entry = process.argv[1];
  if (!entry) return false;
  return metaUrl === pathToFileURL(entry).href;
}

if (isMain(import.meta.url)) {
  await main();
}
