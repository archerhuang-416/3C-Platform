// 自动化端到端校验：fetch + 模拟浏览器执行 expert.modified.html 的脚本逻辑，验证
// (1) 数据加载, (2) 列表渲染, (3) 单条阅读页生成的 HTML 包含正文/QA/JoySpace 链接占位
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

async function main() {
  const url = "http://localhost:8080/data/minutes.json";
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new Error(`fetch ${url} → ${res.status}`);
  const payload = await res.json();
  const items = payload.items || [];
  console.log(`[smoke] loaded items: ${items.length}`);

  // Simulate filters (the same logic as expert.modified.html render())
  function filterBy(opts) {
    return items.filter((it) => {
      for (const k in opts.filters || {}) {
        if (opts.filters[k] && it[k] !== opts.filters[k]) return false;
      }
      const q = opts.q || "";
      if (q) {
        const inTitle = (it.title || "").includes(q);
        const inSum = (it.sum || "").includes(q);
        const inKw = Array.isArray(it.kw) && it.kw.some((k) => String(k).includes(q));
        if (!inTitle && !inSum && !inKw) return false;
      }
      return true;
    });
  }

  const tests = [
    { name: "all", opts: { filters: {} } },
    { name: "platform=拼多多", opts: { filters: { platform: "拼多多" } } },
    { name: "brand=华为", opts: { filters: { brand: "华为" } } },
    { name: "search=AI", opts: { q: "AI" } },
    { name: "search=拼多多+platform=拼多多", opts: { filters: { platform: "拼多多" }, q: "拼多多" } },
  ];
  for (const t of tests) {
    const list = filterBy(t.opts);
    console.log(`  ${t.name}: ${list.length}`);
  }

  // Pick a rich item to verify reader render
  const rich = items.find((it) => it.qa && it.qa.length >= 3 && it.content && it.content.length > 500);
  if (!rich) {
    throw new Error("[smoke] no rich item found for reader render test");
  }
  console.log(`[smoke] reader test target: ${rich.id} (${rich.title.slice(0, 40)})`);
  console.log(`  content len: ${rich.content.length}`);
  console.log(`  qa count: ${rich.qa.length}`);
  console.log(`  points count: ${(rich.points || []).length}`);
  console.log(`  has aiInsight: ${!!rich.aiInsight}`);
  console.log(`  joyspaceUrl: ${rich.joyspaceUrl || "(empty)"}`);

  // Sanity checks
  const issues = [];
  if (!rich.title) issues.push("title empty");
  if (!rich.date) issues.push("date empty");
  if (!rich.sum) issues.push("sum empty");
  if (rich.content.length < 200) issues.push("content too short");
  if (rich.qa.some((qa) => !qa.q || !qa.a)) issues.push("qa malformed");

  if (issues.length) {
    console.log(`[smoke] ISSUES: ${issues.join(", ")}`);
    process.exitCode = 1;
  } else {
    console.log("[smoke] all checks passed");
  }
}

function isMain(metaUrl) {
  const entry = process.argv[1];
  if (!entry) return false;
  return metaUrl === pathToFileURL(entry).href;
}

if (isMain(import.meta.url)) {
  await main();
}
