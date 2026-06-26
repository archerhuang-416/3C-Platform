// 把改造后的 expert HTML 写入 web/index.html，并把它 base64 注回 wrapper HTML 的 BOARDS
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");

const TEMPLATE = path.join(HERE, "..", "templates", "expert.modified.html");
const WEB_INDEX = path.join(ROOT, "web", "index.html");
const MINUTES_JSON = path.join(ROOT, "web", "data", "minutes.json");

const WRAPPER_SOURCE = "C:/Users/huangsirui.archer/Claude/Projects/3C-AI工作台/3C-AI工作台-精简版-离线版.html";
const WRAPPER_OUT = path.join(ROOT, "web", "3C-AI工作台-精简版-在线版.html");

const DATA_MARKER_BEGIN = "<!-- __MINUTES_DATA_BEGIN__ -->";
const DATA_MARKER_END = "<!-- __MINUTES_DATA_END__ -->";

async function readIfExists(p) {
  try { return await fs.readFile(p, "utf-8"); } catch { return null; }
}

// 内联 minutes.json 到 inner html 里，方便 iframe srcdoc 上下文也能直接拿到数据
// 放到 <head> 内，避免 mount() 重写 <body>.innerHTML 时被抹掉
function inlineMinutes(innerHtml, minutesJson) {
  // 清掉模板里可能残留的旧 inline 块
  const stripped = innerHtml.replace(
    new RegExp(`${DATA_MARKER_BEGIN}[\\s\\S]*?${DATA_MARKER_END}`),
    "",
  );
  if (!minutesJson) return stripped;
  // JSON 直接放进 <script type="application/json">；只需要把 </ 转义防止破坏脚本块
  const safe = minutesJson.replace(/<\/script/gi, "<\\/script");
  const block = `${DATA_MARKER_BEGIN}<script id="__minutes-data" type="application/json">${safe}</script>${DATA_MARKER_END}`;
  // 插到 </head> 前；找不到 </head> 时回退到 </body> 前
  if (stripped.includes("</head>")) {
    return stripped.replace("</head>", `${block}\n</head>`);
  }
  if (stripped.includes("</body>")) {
    return stripped.replace("</body>", `${block}\n</body>`);
  }
  return stripped + block;
}

async function main() {
  const raw = await fs.readFile(TEMPLATE, "utf-8");
  const minutes = await readIfExists(MINUTES_JSON);
  if (!minutes) {
    console.warn(`[repack] minutes data not found at ${MINUTES_JSON} — wrapper will be empty until you run sync_minutes`);
  }
  const inner = inlineMinutes(raw, minutes);

  // (1) 写 standalone web/index.html
  await fs.mkdir(path.dirname(WEB_INDEX), { recursive: true });
  await fs.writeFile(WEB_INDEX, inner, "utf-8");
  console.log(`[repack] wrote ${WEB_INDEX} (${inner.length} bytes)`);

  // (2) 把 inner base64 注回 wrapper（保留多板块视图）
  const wrapperExists = await fs
    .access(WRAPPER_SOURCE)
    .then(() => true)
    .catch(() => false);
  if (!wrapperExists) {
    console.log(`[repack] wrapper source not found, skip wrapper rebuild: ${WRAPPER_SOURCE}`);
    return;
  }

  const wrapper = await fs.readFile(WRAPPER_SOURCE, "utf-8");
  const newB64 = Buffer.from(inner, "utf-8").toString("base64");
  const replaced = wrapper.replace(
    /("expert":\s*")([^"]+)(")/,
    (_, p1, _old, p3) => p1 + newB64 + p3
  );
  if (replaced === wrapper) {
    throw new Error("Failed to locate expert: \"...\" in wrapper");
  }
  await fs.writeFile(WRAPPER_OUT, replaced, "utf-8");
  console.log(`[repack] wrote ${WRAPPER_OUT} (${replaced.length} bytes)`);
}

function isMain(metaUrl) {
  const entry = process.argv[1];
  if (!entry) return false;
  return metaUrl === pathToFileURL(entry).href;
}

if (isMain(import.meta.url)) {
  await main();
}
