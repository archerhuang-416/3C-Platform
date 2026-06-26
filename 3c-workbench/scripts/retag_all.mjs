// v1.2 重打标主入口
// 用法：
//   node scripts/retag_all.mjs --dry --limit 10        # 试跑前 10 条不写盘
//   node scripts/retag_all.mjs --limit 10              # 试跑前 10 条写盘
//   node scripts/retag_all.mjs                         # 全量
//   node scripts/retag_all.mjs --filter manual-xxx     # 单条调试
//
// 写盘目标：
//   1. web/data/minutes.json：每条增加 final_primary / final_dimension / final_tags /
//                              topic_tags / matched_rule / candidates / ai_used /
//                              ai_scores / ai_reason / confidence / review_status
//   2. scripts/.cache/retag-report.json：完整留痕（含原 topic/entities 对照）
//   3. scripts/.cache/retag-review-queue.json：review_status=pending_review 的子集
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { retagReport } from "./lib/retag_engine.mjs";
import { fetchReports, filterMinutes } from "./lib/fetch_source.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const DATA_FILE = path.join(ROOT, "web", "data", "minutes.json");
const CACHE_DIR = path.join(HERE, ".cache");
const REPORT_FILE = path.join(CACHE_DIR, "retag-report.json");
const REVIEW_FILE = path.join(CACHE_DIR, "retag-review-queue.json");

function parseArgs(argv) {
  const out = { dry: false, limit: 0, filter: "", verbose: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry" || a === "--dry-run") out.dry = true;
    else if (a === "--limit") {
      out.limit = Number(argv[++i] || "0");
    } else if (a === "--filter") {
      out.filter = String(argv[++i] || "");
    } else if (a === "--verbose" || a === "-v") out.verbose = true;
  }
  return out;
}

async function readJson(file) {
  const t = await fs.readFile(file, "utf-8");
  return JSON.parse(t);
}

async function fetchExpertIntroMap() {
  try {
    const data = await fetchReports();
    const minutes = filterMinutes(data.reports);
    const m = new Map();
    for (const r of minutes) {
      m.set(r.id, {
        creatorIntro: r.creatorIntro || "",
        sections: Array.isArray(r.sections) ? r.sections : [],
        section: r.section || "",
      });
    }
    return m;
  } catch (err) {
    console.warn(`[retag] fetch expert-intro failed: ${err.message}（将用 item.src 兜底）`);
    return new Map();
  }
}

function summarizeBranch(records) {
  const stat = {};
  for (const r of records) {
    stat[r.matched_rule] = (stat[r.matched_rule] || 0) + 1;
  }
  return stat;
}

function summarizeDimension(records) {
  const stat = {};
  for (const r of records) {
    stat[r.final_dimension] = (stat[r.final_dimension] || 0) + 1;
  }
  return stat;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const local = await readJson(DATA_FILE);
  let items = local.items;

  if (args.filter) {
    items = items.filter((it) => it.id.includes(args.filter));
  }
  if (args.limit > 0) items = items.slice(0, args.limit);

  console.log(`[retag] 处理 ${items.length} 条（dry=${args.dry}）`);

  // 拉一次源 API 拿 creatorIntro 等元数据
  const expertMap = await fetchExpertIntroMap();

  await fs.mkdir(CACHE_DIR, { recursive: true });

  const records = [];
  const reviewQueue = [];
  const idToItem = new Map(local.items.map((it) => [it.id, it]));
  let aiCalls = 0;
  let failures = 0;

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const meta = expertMap.get(it.id) || {};
    const expertIntro = meta.creatorIntro || it.src || "";
    try {
      const r = await retagReport({ item: it, expertIntro });
      if (r.ai_used) aiCalls += 1;

      const rec = {
        report_id: it.id,
        title: it.title,
        source_url: "",
        crawled_at: it.date || "",
        original_tags: it.kw || [],
        original_topic: it.topic || "",
        original_entities: it.entities || [],
        original_section: meta.section || "",
        original_sections: meta.sections || [],
        expert_identity: expertIntro,
        final_primary: r.final_primary,
        final_dimension: r.final_dimension,
        final_tags: r.final_tags,
        topic_tags: r.topic_tags,
        matched_rule: r.matched_rule,
        candidates: r.candidates,
        ai_used: r.ai_used,
        ai_scores: r.ai_scores,
        ai_reason: r.ai_reason,
        confidence: r.confidence,
        review_status: r.review_status,
        reviewer: "",
        reviewed_primary: "",
      };
      records.push(rec);
      if (rec.review_status === "pending_review") reviewQueue.push(rec);

      // 回填到 items
      const target = idToItem.get(it.id);
      if (target) {
        target.final_primary = r.final_primary;
        target.final_dimension = r.final_dimension;
        target.final_tags = r.final_tags;
        target.topic_tags = r.topic_tags;
        target.matched_rule = r.matched_rule;
        target.candidates = r.candidates;
        target.ai_used = r.ai_used;
        target.ai_scores = r.ai_scores;
        target.ai_reason = r.ai_reason;
        target.confidence = r.confidence;
        target.review_status = r.review_status;
        // 兼容旧前端：topic 用 final_dimension（板块名），entities 用 final_primary + final_tags
        target.topic = r.final_dimension;
        target.entities =
          r.final_primary === "其他"
            ? r.final_tags
            : [r.final_primary, ...r.final_tags];
      }

      if (args.verbose) {
        console.log(
          `  [${i + 1}/${items.length}] ${it.id} → [${r.final_dimension}] ${r.final_primary}  rule=${r.matched_rule}  conf=${r.confidence}  ${r.review_status === "pending_review" ? "🔍" : ""}`
        );
      } else {
        process.stdout.write(`\r  [${i + 1}/${items.length}] ${r.matched_rule}  ${r.final_primary}                       `);
      }
    } catch (err) {
      failures += 1;
      console.warn(`\n  [fail] ${it.id}: ${err.message}`);
    }
  }
  console.log("");

  // 输出汇总
  const branchStat = summarizeBranch(records);
  const dimStat = summarizeDimension(records);
  console.log(`\n[retag] 完成。共 ${records.length} 条，AI 调用 ${aiCalls} 次，失败 ${failures} 条`);
  console.log(`  分支分布:`, branchStat);
  console.log(`  板块分布:`, dimStat);
  console.log(`  人工复核队列: ${reviewQueue.length} 条`);

  if (args.dry) {
    console.log(`[retag] dry-run：跳过写盘`);
    // 但仍写一份留痕到 .cache 方便 review
    await fs.writeFile(
      path.join(CACHE_DIR, "retag-report.dry.json"),
      JSON.stringify({ generatedAt: new Date().toISOString(), records, reviewQueue }, null, 2),
      "utf-8"
    );
    console.log(`[retag] dry 留痕: ${path.join(CACHE_DIR, "retag-report.dry.json")}`);
    return;
  }

  // 写盘
  const out = {
    ...local,
    syncedAt: new Date().toISOString(),
    items: Array.from(idToItem.values()),
  };
  await fs.writeFile(DATA_FILE, JSON.stringify(out, null, 2), "utf-8");
  console.log(`[retag] 已写回 ${DATA_FILE}`);

  await fs.writeFile(
    REPORT_FILE,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        total: records.length,
        branchStat,
        dimStat,
        records,
      },
      null,
      2
    ),
    "utf-8"
  );
  await fs.writeFile(
    REVIEW_FILE,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        total: reviewQueue.length,
        items: reviewQueue,
      },
      null,
      2
    ),
    "utf-8"
  );
  console.log(`[retag] 完整留痕: ${REPORT_FILE}`);
  console.log(`[retag] 复核队列: ${REVIEW_FILE}`);
}

function isMain(metaUrl) {
  const entry = process.argv[1];
  if (!entry) return false;
  return metaUrl === pathToFileURL(entry).href;
}

if (isMain(import.meta.url)) {
  await main();
}
