// 把源 API 一条 report (category=minutes) 映射成 expert 板块需要的 schema
import { pathToFileURL } from "node:url";
import { fetchReports, filterMinutes } from "./fetch_source.mjs";

// 与 expert.html 中 facets 选项对齐（已扩展以覆盖源数据全部 section 值）
const PLATFORM_OPTS = [
  "京东",
  "天猫",
  "阿里",
  "拼多多",
  "抖音",
  "Temu",
  "快手",
  "美团",
];
const BRAND_OPTS = [
  "苹果",
  "华为",
  "小米",
  "OPPO",
  "vivo",
  "VIVO",
  "荣耀",
  "联想",
];
const RETAIL_OPTS = [
  "京东到家",
  "美团闪购",
  "饿了么",
  "抖音小时达",
  "MT闪购",
  "京东秒送",
  "淘宝闪购",
];

// 输出展示用的规范化标签（VIVO → vivo 等）
function normalizeLabel(value) {
  if (value === "VIVO") return "vivo";
  return value;
}

function pickFromList(values, options) {
  for (const v of values) {
    if (!v) continue;
    if (options.includes(v)) return normalizeLabel(v);
  }
  return "";
}

function stripPagination(content) {
  if (!content) return "";
  return content
    .replace(/-- \d+ of \d+ --/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function pickPoints(report) {
  const outline = Array.isArray(report.outline) ? report.outline : [];
  if (outline.length > 0) {
    return outline
      .slice(0, 3)
      .map((p) => (typeof p === "string" ? p : p?.question || p?.text || ""))
      .filter(Boolean);
  }
  // 兜底：从 aiInsight 第二段抽
  const insight = report.aiInsight || "";
  const m = insight.match(/二、关键结论\s*\n([\s\S]*?)(?=\n[一二三四五六七八九十]、|$)/);
  if (m) {
    return m[1]
      .split(/[；。]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 5)
      .slice(0, 3);
  }
  return [];
}

function pickSummary(report) {
  if (report.summary && report.summary.trim()) return report.summary.trim();
  const insight = report.aiInsight || "";
  const m = insight.match(/一、[^\n]*\n([^\n]+)/);
  if (m) return m[1].trim();
  return "";
}

function pickKeywords(report) {
  if (Array.isArray(report.tags) && report.tags.length > 0) {
    return report.tags.slice(0, 6);
  }
  if (Array.isArray(report.sections) && report.sections.length > 0) {
    return report.sections.slice(0, 6);
  }
  return [];
}

function pickSource(report) {
  if (report.creatorIntro && report.creatorIntro.trim()) {
    return report.creatorIntro.trim();
  }
  if (report.source === "manual") return "专家访谈";
  return report.source || "专家纪要";
}

function normalizeQa(qaItems) {
  if (!Array.isArray(qaItems)) return [];
  return qaItems
    .map((qa) => ({
      q: typeof qa.question === "string" ? qa.question.trim() : "",
      a: typeof qa.answer === "string" ? qa.answer.trim() : "",
    }))
    .filter((qa) => qa.q && qa.a);
}

export function mapToBoardItem(report) {
  const sectionPool = [
    report.section,
    ...(Array.isArray(report.sections) ? report.sections : []),
  ];
  return {
    id: report.id,
    title: report.title || "",
    date: report.publishedDate || "",
    sum: pickSummary(report),
    kw: pickKeywords(report),
    points: pickPoints(report),
    src: pickSource(report),
    platform: pickFromList(sectionPool, PLATFORM_OPTS),
    brand: pickFromList(sectionPool, BRAND_OPTS),
    retail: pickFromList(sectionPool, RETAIL_OPTS),
    topic: "",
    entities: [],
    aiSummary: "",
    content: stripPagination(report.content),
    qa: normalizeQa(report.qaItems),
    aiInsight: report.aiInsight || "",
    documentId: report.documentId || "",
    joyspaceUrl: "",
  };
}

function isMain(metaUrl) {
  const entry = process.argv[1];
  if (!entry) return false;
  return metaUrl === pathToFileURL(entry).href;
}

if (isMain(import.meta.url)) {
  const data = await fetchReports();
  const minutes = filterMinutes(data.reports);
  // 取 5 条不同形态的样本：第一条空 outline、最后一条、华为案例、平台/品牌/即时零售各一
  const samples = [
    minutes[0],
    minutes.find((m) => m.outline && m.outline.length >= 3),
    minutes.find((m) => m.section === "苹果"),
    minutes.find((m) => m.section === "京东秒送"),
    minutes[minutes.length - 1],
  ].filter(Boolean);

  for (const m of samples) {
    const item = mapToBoardItem(m);
    console.log("\n--- mapped:", item.id, "---");
    console.log("  title:", item.title.slice(0, 50));
    console.log("  date:", item.date);
    console.log("  platform:", item.platform || "(none)");
    console.log("  brand:", item.brand || "(none)");
    console.log("  retail:", item.retail || "(none)");
    console.log("  src:", item.src);
    console.log("  kw:", item.kw);
    console.log("  points count:", item.points.length);
    console.log("  qa count:", item.qa.length);
    console.log("  content len:", item.content.length);
    console.log("  sum:", item.sum.slice(0, 60));
  }

  // 全量统计：哪些条目映射后 platform/brand/retail 全空
  const mapped = minutes.map(mapToBoardItem);
  const orphan = mapped.filter(
    (it) => !it.platform && !it.brand && !it.retail
  );
  console.log(`\nOrphan (no platform/brand/retail): ${orphan.length}/${mapped.length}`);
  if (orphan.length > 0) {
    console.log("First 3 orphan section sources:");
    for (const it of orphan.slice(0, 3)) {
      const src = minutes.find((m) => m.id === it.id);
      console.log(`  ${it.id}: section="${src?.section}" sections=${JSON.stringify(src?.sections)}`);
    }
  }
}
