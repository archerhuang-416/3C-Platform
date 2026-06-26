// v1.2 重打标引擎：A/B/C/D 四分支裁决 + 全程留痕
//
// 输入：minutes.json 中的 item（含 title/content/qa/src/...）
//      和源 report（可选，含 creatorIntro）
// 输出：{
//   final_primary,           // 主分类 canonical（"其他" 时为 "其他"）
//   final_dimension,         // 主分类所属板块
//   final_tags,              // 标签 canonical 数组（去主分类）
//   topic_tags,              // 主题标签数组（AI/补贴/UE…）
//   matched_rule,            // "A" | "B" | "C" | "D" | "cross-platform"
//   candidates,              // 标题命中的候选 canonical 数组
//   ai_used, ai_scores, ai_reason,
//   confidence,              // 0~1
//   review_status,           // "auto" | "pending_review"
// }
import { chatCompletion, parseJsonLoose } from "./ai_client.mjs";
import {
  CATEGORIES,
  CANONICAL_TO_DIMENSION,
  scanCanonicals,
  scanTopicTags,
  countCanonicalInBody,
  firstParagraph,
  normalize,
} from "./retag_rules.mjs";

// 阈值（与规则文档 §6 对齐）
const THRESHOLDS = {
  bodyHighFrequency: 3, // 分支 A：正文出现次数下限
  centerPass: 0.6, // 分支 C：最高中心度分自动定案下限
  centerLead: 0.2, // 分支 C：最高分 − 次高分领先差
};

// 跨平台关键词触发：标题/摘要明显是"宏观/跨平台/竞争格局"型 → 主分类落"其他"
const CROSS_PLATFORM_HINTS = [
  "中外竞争", "云厂商", "竞争格局", "宏观",
  "AI 原生应用", "AI原生应用",
  "产业链", "全行业",
];

function looksCrossPlatform(title, candidates) {
  // 候选 0 个：交给分支 D 判定，不在这里短路
  if (candidates.length === 0) return false;
  const dims = new Set(candidates.map((c) => CANONICAL_TO_DIMENSION[c]));
  // 必要条件：候选必须跨 ≥2 个板块
  if (dims.size < 2) return false;
  // 充分条件 1：候选数量 ≥ 3
  if (candidates.length >= 3) return true;
  // 充分条件 2：候选跨板块 + 标题含跨平台 hint
  const t = normalize(title);
  return CROSS_PLATFORM_HINTS.some((kw) => t.includes(kw));
}

function buildBody(item) {
  // 拼接正文：content + qa（如果 content 缺失，用 qa 拼）
  let body = item.content || "";
  if (Array.isArray(item.qa)) {
    for (const qa of item.qa) {
      if (qa?.q) body += "\n" + qa.q;
      if (qa?.a) body += "\n" + qa.a;
    }
  }
  return body;
}

// 分支 A：标题恰好命中 1 个 → 正文校验
function branchA({ title, candidate, body, expertIntro }) {
  const hasBody = (body || "").length >= 50;
  const count = countCanonicalInBody(candidate, body);
  const inFirstPara = firstParagraph(body, 300).includes(candidate);
  // 正文缺失：标题唯一命中即视为确认（兜底，避免空正文掉入分支 D）
  if (!hasBody) {
    return {
      confirmed: true,
      bodyCount: 0,
      inFirstPara: false,
      noBody: true,
    };
  }
  // 正文存在：高频(≥阈值) 或 首段出现 任一满足即确认
  const confirmed = count >= THRESHOLDS.bodyHighFrequency || inFirstPara;
  return {
    confirmed,
    bodyCount: count,
    inFirstPara,
    noBody: false,
  };
}

// 分支 B：标题命中 ≥2 个 → 用专家身份过一遍消歧
function branchB({ candidates, expertIntro }) {
  if (!expertIntro) return { decided: false };
  const hitsInIntro = scanCanonicals(expertIntro);
  const intersect = hitsInIntro.filter((c) => candidates.includes(c));
  if (intersect.length === 1) {
    return { decided: true, pick: intersect[0], reason: "expert-intro" };
  }
  return { decided: false, hits: intersect };
}

// 分支 C：调 AI 做中心度打分
async function branchC({ title, body, candidates, expertIntro }) {
  const candidatesStr = candidates
    .map((c) => `- ${c}（板块=${CANONICAL_TO_DIMENSION[c]}）`)
    .join("\n");
  const bodyExcerpt = (body || "").slice(0, 2000);
  const user = [
    `【标题】${title || ""}`,
    expertIntro ? `【专家身份】${expertIntro.slice(0, 120)}` : "",
    `【正文节选（前 2000 字）】\n${bodyExcerpt}`,
    "",
    `候选类目（请逐一给出"中心度"打分，0~1 之间小数，含义=这篇报告主要在讲谁，而非有没有提到）：`,
    candidatesStr,
    "",
    `请输出严格 JSON：{"scores":{"<canonical>":<0~1>,...},"reason":"<一句话理由>"}`,
    `若多个候选接近，可分别打高分；分数应能反映"主次"。`,
  ].filter(Boolean).join("\n");

  const sys = `你是 3C 报告中心度打分助手，仅输出严格 JSON。打分时不被标题误导，重点看正文主体。`;
  const { content } = await chatCompletion({
    system: sys,
    user,
    temperature: 0.1,
    maxTokens: 400,
    responseFormat: "json_object",
  });
  const parsed = parseJsonLoose(content);
  if (!parsed || typeof parsed !== "object") {
    return { scores: {}, reason: "[AI 解析失败]" };
  }
  const rawScores = parsed.scores || {};
  const scores = {};
  for (const c of candidates) {
    const v = Number(rawScores[c]);
    scores[c] = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
  }
  return { scores, reason: String(parsed.reason || "").slice(0, 200) };
}

// 分支 D：标题零命中 → AI 按正文主题归类
async function branchD({ title, body, expertIntro }) {
  const sys = `你是 3C 报告分类助手。任务：根据正文主题，把报告归到这四个板块之一（互斥）：
- 竞对平台（拼多多/阿里/字节）
- 品牌（苹果/华为/小米/OPPO/vivo/荣耀）
- 即时零售平台（美团闪购/京东秒送/淘宝闪购）
- 其他（跨多领域、并列对比多个产品/平台、宏观行业分析、不属于上述任何具体类目）

归类原则（重要）：
1. 如果报告"并列对比"多个平台、品牌或产品（例如"豆包/千问/DeepSeek 用户分化"、"多家电商竞争格局"、"AI 产业 CAPEX 综述"），归到"其他"，**不**强行选一个。
2. 只有报告"主要在讲"某一个具体平台/品牌（中心度 ≥ 0.6），才归到对应类目；其他被提到的实体放在 tags 里。
3. 宁可归"其他"也不要硬塞。
4. 即时零售场景词："外卖/闪购/到家/秒送/小时达/即时零售"出现时优先考虑即时零售平台。

输出 canonical 必须严格是下面之一（或"其他"）：
拼多多、阿里、字节、苹果、华为、小米、OPPO、vivo、荣耀、美团闪购、京东秒送、淘宝闪购、其他

仅输出严格 JSON。`;
  const bodyExcerpt = (body || "").slice(0, 2000);
  const user = [
    `【标题】${title || ""}`,
    expertIntro ? `【专家身份】${expertIntro.slice(0, 120)}` : "",
    `【正文节选】\n${bodyExcerpt}`,
    "",
    `请输出严格 JSON：{"primary":"<canonical 或 其他>","tags":["<次要被涉及的 canonical>",...],"confidence":<0~1>,"reason":"<一句话理由>"}`,
  ].filter(Boolean).join("\n");
  const { content } = await chatCompletion({
    system: sys,
    user,
    temperature: 0.1,
    maxTokens: 400,
    responseFormat: "json_object",
  });
  const parsed = parseJsonLoose(content);
  if (!parsed) return { primary: "其他", tags: [], confidence: 0.3, reason: "[AI 解析失败]" };
  const allowed = ["其他", ...CATEGORIES.map((c) => c.canonical)];
  const primary = allowed.includes(parsed.primary) ? parsed.primary : "其他";
  const confidence = Number.isFinite(Number(parsed.confidence))
    ? Math.max(0, Math.min(1, Number(parsed.confidence)))
    : 0.5;
  const rawTags = Array.isArray(parsed.tags) ? parsed.tags : [];
  const tags = Array.from(
    new Set(
      rawTags
        .map((t) => String(t).trim())
        .filter((t) => allowed.includes(t) && t !== primary && t !== "其他")
    )
  ).slice(0, 5);
  return {
    primary,
    tags,
    confidence,
    reason: String(parsed.reason || "").slice(0, 200),
  };
}

// 主入口
export async function retagReport({ item, expertIntro = "" }) {
  const title = item.title || "";
  const body = buildBody(item);
  const intro = expertIntro || item.src || "";

  // Step 0：归一化（scanCanonicals 内部已归一）
  // Step 1：标题出候选
  let candidates = scanCanonicals(title);
  // 主题标签：从标题+摘要扫
  const topicTags = scanTopicTags(`${title}\n${item.sum || ""}`);

  // 跨平台贯穿规则
  if (looksCrossPlatform(title, candidates)) {
    return finalize({
      item,
      final_primary: "其他",
      final_dimension: "其他",
      final_tags: candidates.slice(0, 5),
      topic_tags: topicTags,
      matched_rule: "cross-platform",
      candidates,
      ai_used: false,
      ai_scores: {},
      ai_reason: "跨平台/宏观分析，主分类落'其他'板块",
      confidence: 0.85,
      review_status: "auto",
    });
  }

  // 分支 A：恰好命中 1 个
  if (candidates.length === 1) {
    const pick = candidates[0];
    const a = branchA({ title, candidate: pick, body, expertIntro: intro });
    if (a.confirmed) {
      return finalize({
        item,
        final_primary: pick,
        final_dimension: CANONICAL_TO_DIMENSION[pick],
        final_tags: [],
        topic_tags: topicTags,
        matched_rule: "A",
        candidates,
        ai_used: false,
        ai_scores: {},
        ai_reason: `正文出现 ${a.bodyCount} 次${a.inFirstPara ? "，首段含此关键词" : ""}`,
        confidence: a.bodyCount >= THRESHOLDS.bodyHighFrequency ? 0.9 : 0.75,
        review_status: "auto",
      });
    }
    // 正文矛盾 → 转 C，需要把仅有 1 个候选扩展（用正文里其他命中的 canonical 一起做中心度）
    const bodyHits = scanCanonicals(body).filter((c) => c !== pick);
    candidates = [pick, ...bodyHits].slice(0, 5);
  }

  // 分支 B：命中 ≥2 → 专家身份消歧
  if (candidates.length >= 2) {
    const b = branchB({ candidates, expertIntro: intro });
    if (b.decided) {
      return finalize({
        item,
        final_primary: b.pick,
        final_dimension: CANONICAL_TO_DIMENSION[b.pick],
        final_tags: candidates.filter((c) => c !== b.pick),
        topic_tags: topicTags,
        matched_rule: "B",
        candidates,
        ai_used: false,
        ai_scores: {},
        ai_reason: `专家身份指向 ${b.pick}`,
        confidence: 0.85,
        review_status: "auto",
      });
    }
    // 转分支 C
    const c = await branchC({ title, body, candidates, expertIntro: intro });
    const ranked = candidates
      .map((cn) => [cn, c.scores[cn] ?? 0])
      .sort((a, b) => b[1] - a[1]);
    const top = ranked[0];
    const second = ranked[1] || [null, 0];
    const lead = top[1] - second[1];
    if (top[1] >= THRESHOLDS.centerPass && lead >= THRESHOLDS.centerLead) {
      return finalize({
        item,
        final_primary: top[0],
        final_dimension: CANONICAL_TO_DIMENSION[top[0]],
        final_tags: candidates.filter((cn) => cn !== top[0]),
        topic_tags: topicTags,
        matched_rule: "C",
        candidates,
        ai_used: true,
        ai_scores: c.scores,
        ai_reason: c.reason,
        confidence: Number(top[1].toFixed(2)),
        review_status: "auto",
      });
    }
    // 低置信 → 进人工复核队列
    return finalize({
      item,
      final_primary: top[0] || candidates[0],
      final_dimension: CANONICAL_TO_DIMENSION[top[0] || candidates[0]],
      final_tags: candidates.filter((cn) => cn !== (top[0] || candidates[0])),
      topic_tags: topicTags,
      matched_rule: "C",
      candidates,
      ai_used: true,
      ai_scores: c.scores,
      ai_reason: c.reason + `（最高分=${top[1].toFixed(2)} 领先差=${lead.toFixed(2)}，低置信）`,
      confidence: Number((top[1] || 0).toFixed(2)),
      review_status: "pending_review",
    });
  }

  // 分支 D：候选 0 个
  const d = await branchD({ title, body, expertIntro: intro });
  const dim = d.primary === "其他" ? "其他" : CANONICAL_TO_DIMENSION[d.primary] || "其他";
  return finalize({
    item,
    final_primary: d.primary,
    final_dimension: dim,
    final_tags: d.tags || [],
    topic_tags: topicTags,
    matched_rule: "D",
    candidates: [],
    ai_used: true,
    ai_scores: {},
    ai_reason: d.reason,
    confidence: d.confidence,
    review_status: d.confidence < THRESHOLDS.centerPass ? "pending_review" : "auto",
  });
}

function finalize(payload) {
  // 去掉与主分类重复的标签
  const tags = (payload.final_tags || []).filter(
    (t) => t && t !== payload.final_primary
  );
  return { ...payload, final_tags: tags };
}
