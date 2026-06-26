// 打标规则引擎 + AI 摘要
// 流程：
//   1. 扫标题命中所有候选实体（"京东秒送" > "京东"，长 token 优先以免误匹配）
//   2. 命中 0 个 → AI 判 topic+entities（可能落"其他"）
//   3. 命中全在同一 topic → 直接归类，entities=去重命中
//   4. 命中跨多 topic → 看 creatorIntro 含哪个候选 → 归到那个；多个 creator 命中按出现顺序取第一个
//   5. creatorIntro 仍无法消歧 → AI 在候选 topic 里挑一个；若 AI 也"不确定" → 随机选一个
// aiSummary 始终调一次 AI 生成。
import { pathToFileURL } from "node:url";
import { chatCompletion, parseJsonLoose } from "./ai_client.mjs";

export const TOPIC_OPTS = ["电商平台", "品牌", "即时零售", "其他"];

// topic → 标准实体列表（也是侧栏候选）
export const TOPIC_ENTITIES = {
  电商平台: ["阿里", "拼多多", "抖音", "美团", "Temu", "快手", "京东"],
  品牌: ["苹果", "华为", "小米", "OPPO", "vivo", "荣耀", "联想"],
  即时零售: ["京东秒送", "京东到家", "美团闪购", "MT闪购", "饿了么", "抖音小时达", "淘宝闪购"],
  其他: [],
};

// 别名表：标题中可能出现的写法 → 标准实体
// 注意：别名顺序无关；扫描时按"长度降序"匹配以避免 "京东" 吃掉 "京东秒送"
const ALIASES = {
  // 电商平台
  阿里: ["阿里巴巴", "阿里", "淘宝", "天猫", "淘天", "Alibaba"],
  拼多多: ["拼多多", "PDD"],
  抖音: ["抖音", "字节跳动", "字节", "TikTok", "ByteDance"],
  美团: ["美团"],
  Temu: ["Temu", "TEMU"],
  快手: ["快手", "Kuaishou"],
  京东: ["京东", "JD", "JD.com"],
  // 品牌
  苹果: ["苹果", "Apple", "iPhone", "iPad", "Mac"],
  华为: ["华为", "Huawei", "鸿蒙", "昇腾"],
  小米: ["小米", "Xiaomi", "MIUI", "Redmi"],
  OPPO: ["OPPO", "oppo"],
  vivo: ["vivo", "VIVO", "Vivo"],
  荣耀: ["荣耀", "HONOR"],
  联想: ["联想", "Lenovo"],
  // 即时零售（长 token 必须能优先于 "京东"/"美团"/"抖音"）
  京东秒送: ["京东秒送"],
  京东到家: ["京东到家"],
  美团闪购: ["美团闪购", "美团 闪购"],
  MT闪购: ["MT闪购"],
  饿了么: ["饿了么"],
  抖音小时达: ["抖音小时达"],
  淘宝闪购: ["淘宝闪购"],
};

// 实体 → topic 反查
const ENTITY_TO_TOPIC = (() => {
  const map = {};
  for (const [topic, ents] of Object.entries(TOPIC_ENTITIES)) {
    for (const e of ents) map[e] = topic;
  }
  return map;
})();

// 所有 (alias, entity) 对，按 alias 长度降序，便于贪婪扫描
const ALIAS_PAIRS = (() => {
  const pairs = [];
  for (const [entity, aliases] of Object.entries(ALIASES)) {
    for (const alias of aliases) pairs.push({ alias, entity });
  }
  pairs.sort((a, b) => b.alias.length - a.alias.length);
  return pairs;
})();

// 即时零售"场景词"：标题里出现这些 → 把电商平台实体推升为即时零售实体
const INSTANT_RETAIL_SCENE_WORDS = ["外卖", "闪购", "即时零售", "即时配送", "到家", "秒送", "小时达"];

// 电商平台实体 → 即时零售对应实体（当场景词同现时升级）
const SCENE_PROMOTION = {
  美团: "美团闪购",
  京东: "京东秒送",
  抖音: "抖音小时达",
  阿里: "淘宝闪购",
};

function hasInstantRetailScene(text) {
  if (!text) return false;
  return INSTANT_RETAIL_SCENE_WORDS.some((w) => text.includes(w));
}

// 在文本中扫所有候选实体的"命中实体列表"（去重，按首次出现顺序）
// 关键：长别名匹配后从扫描文本中"挖掉"那一段，防止 "淘宝闪购" 触发短别名 "淘宝"（属于阿里）
export function scanEntities(text) {
  if (!text) return [];
  let hay = String(text);
  const hit = new Map(); // entity → first index in original text
  const original = hay;
  for (const { alias, entity } of ALIAS_PAIRS) {
    const idx = hay.indexOf(alias);
    if (idx < 0) continue;
    if (!hit.has(entity)) {
      hit.set(entity, original.indexOf(alias)); // 用原始 index 排序
    }
    // 把所有命中位置替换成等长空格，避免后续短别名再误命中这一段
    hay = hay.split(alias).join(" ".repeat(alias.length));
  }
  return [...hit.entries()].sort((a, b) => a[1] - b[1]).map(([e]) => e);
}

function pickRandom(arr, seed) {
  // 用 seed（如 report.id）做确定性 hash，避免每次跑结果不同
  let h = 0;
  for (const ch of seed || "") h = (h * 31 + ch.charCodeAt(0)) | 0;
  const idx = Math.abs(h) % arr.length;
  return arr[idx];
}

// 用 AI 在候选 topic 中挑一个（输入更短，专门做消歧）
async function aiPickTopicFromCandidates(report, candidates) {
  const candidatesStr = candidates
    .map((c) => `${c.topic} → ${c.entities.join("/")}`)
    .join("\n");
  const user = [
    `【标题】${report.title || ""}`,
    report.summary ? `【摘要】${report.summary}` : "",
    report.creatorIntro ? `【专家身份】${report.creatorIntro.slice(0, 100)}` : "",
    "",
    "候选分类（互斥，三选一）：",
    candidatesStr,
    "",
    `请输出 JSON：{"topic":"...","entities":["..."],"confident":true|false}`,
    `confident=false 表示你也不确定到底属于哪一类。`,
  ].filter(Boolean).join("\n");

  const sys = `你是分类消歧助手。从给定的候选分类中挑选最准确的一个，仅输出严格 JSON。`;
  const { content } = await chatCompletion({
    system: sys,
    user,
    temperature: 0.1,
    maxTokens: 200,
    responseFormat: "json_object",
  });
  const parsed = parseJsonLoose(content);
  if (!parsed || typeof parsed !== "object") return null;
  const topic = String(parsed.topic || "").trim();
  const match = candidates.find((c) => c.topic === topic);
  if (!match) return null;
  return {
    topic,
    entities: match.entities,
    confident: parsed.confident !== false,
  };
}

// 用 AI 生成 ~150 字摘要（始终调用）
async function aiSummary(report) {
  const qa = Array.isArray(report.qaItems) ? report.qaItems.slice(0, 3) : [];
  const qaBlock = qa
    .map((it) => {
      const q = (it.question || "").trim();
      const a = (it.answer || "").trim().slice(0, 200);
      return q && a ? `Q: ${q}\nA: ${a}` : "";
    })
    .filter(Boolean)
    .join("\n");
  const user = [
    `【标题】${report.title || ""}`,
    report.summary ? `【摘要】${report.summary}` : "",
    qaBlock ? `【部分问答】\n${qaBlock}` : "",
    "",
    `请用 120~180 字陈述句总结这条纪要的核心信息（讨论了什么、关键观点、对行业的意义），不要分点，不要"本次纪要/本文"等元描述。仅输出纯文本摘要，无前缀。`,
  ].filter(Boolean).join("\n");

  const sys = `你是 3C 行业纪要摘要助手，仅输出一段陈述句中文摘要。`;
  const { content } = await chatCompletion({
    system: sys,
    user,
    temperature: 0.2,
    maxTokens: 400,
  });
  return content.trim().slice(0, 400);
}

// 用 AI 兜底分类（当标题 0 命中时使用）：让模型自由判定 topic + entities
async function aiClassifyFallback(report) {
  const sys = `你是 3C 行业纪要分类助手。
topic 必须是这四个之一（互斥）：
- 品牌：标题或主体明确围绕某 3C 品牌（苹果/华为/小米/OPPO/vivo/荣耀/联想）
- 即时零售：明确讨论即时零售/外卖/闪购业务
- 电商平台：讨论某电商平台的战略、GMV、用户增长、监管、竞争
- 其他：不属于上述任何一类（如纯宏观、跨多领域、AI 应用生态分析不绑定具体平台）

entities 是该 topic 下的实体标签数组（最多 3 个），仅从下列对应列表里挑（topic=其他 时为空数组）：
- 品牌 → ["苹果","华为","小米","OPPO","vivo","荣耀","联想"]
- 即时零售 → ["京东秒送","京东到家","美团闪购","MT闪购","饿了么","抖音小时达","淘宝闪购"]
- 电商平台 → ["阿里","拼多多","抖音","美团","Temu","快手","京东"]

仅输出严格 JSON。`;
  const qa = Array.isArray(report.qaItems) ? report.qaItems.slice(0, 2) : [];
  const qaBlock = qa
    .map((it) => `Q: ${(it.question || "").trim()}\nA: ${(it.answer || "").trim().slice(0, 180)}`)
    .filter(Boolean)
    .join("\n");
  const user = [
    `【标题】${report.title || ""}`,
    report.summary ? `【摘要】${report.summary}` : "",
    qaBlock ? `【部分问答】\n${qaBlock}` : "",
    "",
    `请输出 JSON：{"topic":"...","entities":["..."]}`,
  ].filter(Boolean).join("\n");

  const { content } = await chatCompletion({
    system: sys,
    user,
    temperature: 0.1,
    maxTokens: 200,
    responseFormat: "json_object",
  });
  const parsed = parseJsonLoose(content);
  if (!parsed) return { topic: "其他", entities: [] };
  let topic = String(parsed.topic || "").trim();
  if (!TOPIC_OPTS.includes(topic)) topic = "其他";
  const allowed = TOPIC_ENTITIES[topic] || [];
  const ents = Array.isArray(parsed.entities) ? parsed.entities : [];
  const cleaned = Array.from(new Set(ents.map((e) => String(e).trim()).filter((e) => allowed.includes(e)))).slice(0, 3);
  return { topic, entities: cleaned };
}

export async function classifyAndSummarize(report) {
  const title = report.title || "";
  let hits = scanEntities(title);

  // 场景词升级：标题含外卖/闪购/到家等 → 把命中的电商平台名升级为对应即时零售实体
  // （即使标题里已经有"饿了么"这类即时零售实体，也升级共现的电商平台名，确保全在即时零售）
  if (hasInstantRetailScene(title)) {
    hits = hits.map((h) => SCENE_PROMOTION[h] || h);
    // 去重（升级后可能产生重复，比如 "美团" 和已有的 "美团闪购"）
    hits = Array.from(new Set(hits));
  }

  let topic = "";
  let entities = [];
  let decisionPath = "";

  if (hits.length === 0) {
    // Step 6：标题完全没命中，AI 自由判定
    const ai = await aiClassifyFallback(report);
    topic = ai.topic;
    entities = ai.entities;
    decisionPath = "ai-fallback";
  } else {
    // 按 hit 归集 topic
    const topicsHit = new Set(hits.map((h) => ENTITY_TO_TOPIC[h]));
    if (topicsHit.size === 1) {
      // Step 2：单一 topic，直接归类
      topic = [...topicsHit][0];
      entities = hits.filter((h) => ENTITY_TO_TOPIC[h] === topic).slice(0, 3);
      decisionPath = "single-topic";
    } else {
      // Step 3：跨多 topic，先看 creatorIntro
      const intro = report.creatorIntro || "";
      const introHits = scanEntities(intro);
      const introHitsInTitle = introHits.filter((e) => hits.includes(e));
      if (introHitsInTitle.length > 0) {
        const chosenEntity = introHitsInTitle[0];
        topic = ENTITY_TO_TOPIC[chosenEntity];
        entities = hits.filter((h) => ENTITY_TO_TOPIC[h] === topic).slice(0, 3);
        decisionPath = "creator-intro";
      } else {
        // Step 4：让 AI 在候选 topic 中挑（候选只包含命中过的 topic + 对应命中实体）
        const candidates = [...topicsHit].map((t) => ({
          topic: t,
          entities: hits.filter((h) => ENTITY_TO_TOPIC[h] === t).slice(0, 3),
        }));
        const aiPick = await aiPickTopicFromCandidates(report, candidates);
        if (aiPick && aiPick.confident) {
          topic = aiPick.topic;
          entities = aiPick.entities;
          decisionPath = "ai-disambig";
        } else {
          // Step 5：AI 也"不确定"，候选里确定性随机
          const rnd = pickRandom(candidates, report.id);
          topic = rnd.topic;
          entities = rnd.entities;
          decisionPath = "random";
        }
      }
    }
  }

  // 始终生成 AI 摘要
  let summary = "";
  try {
    summary = await aiSummary(report);
  } catch (err) {
    // 摘要失败不阻断分类
    summary = "";
  }

  return {
    topic,
    entities,
    aiSummary: summary,
    _decisionPath: decisionPath,
    _hits: hits,
  };
}

function isMain(metaUrl) {
  const entry = process.argv[1];
  if (!entry) return false;
  return metaUrl === pathToFileURL(entry).href;
}

if (isMain(import.meta.url)) {
  const { fetchReports, filterMinutes } = await import("./fetch_source.mjs");
  const data = await fetchReports();
  const minutes = filterMinutes(data.reports);

  // 离线测试 scanEntities（不调 AI）
  if (process.argv.includes("--scan-only")) {
    console.log("=== scanEntities 全量预扫 ===");
    const stats = { 0: 0, 1: 0, 2: 0, 3: 0, "4+": 0 };
    const samples = { multi: [], zero: [] };
    for (const m of minutes) {
      const hits = scanEntities(m.title || "");
      const topics = new Set(hits.map((h) => ENTITY_TO_TOPIC[h]));
      const bucket = hits.length >= 4 ? "4+" : hits.length;
      stats[bucket]++;
      if (topics.size >= 2 && samples.multi.length < 8) {
        samples.multi.push({ id: m.id, title: m.title, hits, topics: [...topics] });
      }
      if (hits.length === 0 && samples.zero.length < 5) {
        samples.zero.push({ id: m.id, title: m.title });
      }
    }
    console.log("命中数分布：", stats);
    console.log("\n=== 跨 topic 样本（需要 creator/AI 消歧）===");
    for (const s of samples.multi) {
      console.log(`  [${s.topics.join("+")}] ${s.title.slice(0, 60)}`);
      console.log(`    hits=${JSON.stringify(s.hits)}`);
    }
    console.log("\n=== 标题 0 命中样本（走 AI 兜底）===");
    for (const s of samples.zero) {
      console.log(`  ${s.title.slice(0, 70)}`);
    }
    process.exit(0);
  }

  // 在线测试：用 5 个不同场景的样本跑完整流程
  const samples = [
    minutes.find((m) => /华为|昇腾/.test(m.title)),                       // 单 topic（品牌）
    minutes.find((m) => /美团.*闪购|外卖.*亏损/.test(m.title)),             // 跨 topic（即时零售+电商）
    minutes.find((m) => /AI/.test(m.title) && !/华为|苹果|小米/.test(m.title)), // 可能 0 命中
    minutes.find((m) => /淘宝|阿里/.test(m.title)),                         // 单 topic（电商）
    minutes.find((m) => /拼多多/.test(m.title)),
  ].filter(Boolean).slice(0, 5);

  for (const m of samples) {
    console.log(`\n=== ${m.id} | ${(m.title || "").slice(0, 55)} ===`);
    try {
      const r = await classifyAndSummarize(m);
      console.log(`  decision: ${r._decisionPath} | hits=${JSON.stringify(r._hits)}`);
      console.log(`  topic: ${r.topic}  entities: ${JSON.stringify(r.entities)}`);
      console.log(`  aiSummary: ${r.aiSummary.slice(0, 120)}...`);
    } catch (err) {
      console.error(`  ✗ failed: ${err.message}`);
    }
  }
}
