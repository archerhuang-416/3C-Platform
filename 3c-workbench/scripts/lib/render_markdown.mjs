// 把一条已映射的 board item 渲染成 markdown，供 JoySpace 上传使用。
//
// 工作流约定（用户偏好，2026-06-25 起）：
//   - 不输出 AI 解读、不输出核心要点、不输出"纪要正文"（content 与 qa 重复）
//   - 专家问答用 Q1/Q2/Q3... 编号，每个问答之间空一行
//   - 字体由 JoySpace 端统一处理（在 markdown 里包 HTML 会让正文不被解析）
import { pathToFileURL } from "node:url";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchReports, filterMinutes } from "./fetch_source.mjs";
import { mapToBoardItem } from "./map_to_board.mjs";

function escapeForMd(text) {
  if (!text) return "";
  return String(text);
}

function renderTagBlock(item) {
  // 新维度优先：topic + entities；若 AI 还没打标，回退到旧三维
  if (item.topic) {
    const parts = [item.topic];
    if (Array.isArray(item.entities) && item.entities.length > 0) {
      parts.push(item.entities.join("、"));
    }
    return `**分类**：${parts.join(" / ")}\n\n`;
  }
  const tags = [item.platform, item.brand, item.retail].filter(Boolean);
  if (tags.length === 0) return "";
  return `**分类**：${tags.join(" · ")}\n\n`;
}

function renderKwBlock(kw) {
  if (!kw || kw.length === 0) return "";
  return `**关键词**：${kw.map((k) => `\`${k}\``).join(" ")}\n\n`;
}

function renderQa(qa) {
  if (!qa || qa.length === 0) return "";
  // 每个问题用 H3 标题；问答之间额外多空一段（JoySpace 默认段距偏小）
  const blocks = qa
    .map(
      (item, i) =>
        `### Q${i + 1}：${escapeForMd(item.q)}\n\n${escapeForMd(item.a)}`
    )
    .join("\n\n\n\n");
  return `## 专家问答\n\n${blocks}\n`;
}

function renderMeta(item) {
  const lines = [];
  if (item.date) lines.push(`- 发布日期：${item.date}`);
  if (item.src) lines.push(`- 来源：${item.src}`);
  if (item.id) lines.push(`- 报告 ID：\`${item.id}\``);
  return lines.join("\n");
}

export function renderMarkdown(item) {
  const parts = [];
  parts.push(`# ${escapeForMd(item.title)}\n`);
  const meta = renderMeta(item);
  if (meta) parts.push(`${meta}\n`);
  parts.push(renderTagBlock(item));
  parts.push(renderKwBlock(item.kw));
  // AI 摘要优先于源 summary：更准、更短
  const summary = item.aiSummary || item.sum;
  if (summary) parts.push(`> ${escapeForMd(summary)}\n\n`);
  parts.push(renderQa(item.qa));
  return parts.filter(Boolean).join("\n").replace(/\n{3,}/g, "\n\n");
}

function isMain(metaUrl) {
  const entry = process.argv[1];
  if (!entry) return false;
  return metaUrl === pathToFileURL(entry).href;
}

if (isMain(import.meta.url)) {
  const data = await fetchReports();
  const minutes = filterMinutes(data.reports);
  const sample =
    minutes.find(
      (m) =>
        Array.isArray(m.qaItems) &&
        m.qaItems.length >= 3 &&
        Array.isArray(m.outline) &&
        m.outline.length >= 3
    ) || minutes[0];
  const item = mapToBoardItem(sample);
  const md = renderMarkdown(item);

  const here = path.dirname(fileURLToPath(import.meta.url));
  const cacheDir = path.resolve(here, "..", ".cache");
  await fs.mkdir(cacheDir, { recursive: true });
  const outPath = path.join(cacheDir, `${item.id}.sample.md`);
  await fs.writeFile(outPath, md, "utf-8");

  console.log(`sample id: ${item.id}`);
  console.log(`md length: ${md.length}`);
  console.log(`written to: ${outPath}`);
  console.log("\n--- first 800 chars ---");
  console.log(md.slice(0, 800));
}
