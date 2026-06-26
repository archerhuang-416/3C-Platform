// v1.2 重打标规则：词典 + 扫描 + 正文校验
// 板块（dimension）四类：竞对平台 / 品牌 / 即时零售平台 / 其他
//   竞对平台：拼多多、阿里、字节   （抖音→字节、淘宝/天猫→阿里）
//   品牌：    苹果、华为、小米、OPPO、vivo、荣耀
//   即时零售：美团闪购、京东秒送、淘宝闪购   （"美团" 不在竞对平台单设，统一映射美团闪购）
//   其他：    跨平台 / 零命中兜底

export const DIMENSIONS = ["竞对平台", "品牌", "即时零售平台", "其他"];

// 每个 canonical 一个条目：标准名、所属板块、别名、关联实体（仅用于正文加分）
export const CATEGORIES = [
  // 竞对平台
  {
    canonical: "拼多多",
    dimension: "竞对平台",
    aliases: ["拼多多", "PDD", "多多", "Temu", "TEMU", "多多买菜"],
    entities: ["多多视频"],
  },
  {
    canonical: "阿里",
    dimension: "竞对平台",
    aliases: ["阿里巴巴", "阿里", "淘宝", "天猫", "1688", "阿里妈妈", "Alibaba", "淘天"],
    entities: ["阿里云", "飞猪", "菜鸟", "钉钉", "盒马"],
  },
  {
    canonical: "字节",
    dimension: "竞对平台",
    aliases: ["字节跳动", "字节", "抖音", "抖音电商", "抖店", "ByteDance", "TikTok"],
    entities: ["今日头条", "巨量引擎", "抖音商城"],
  },

  // 品牌
  {
    canonical: "苹果",
    dimension: "品牌",
    aliases: ["苹果", "Apple", "iPhone", "iPad", "Mac", "MacBook", "AirPods"],
    entities: ["A 系列芯片", "M 系列芯片", "iOS"],
  },
  {
    canonical: "华为",
    dimension: "品牌",
    aliases: ["华为", "Huawei"],
    entities: ["昇腾", "鸿蒙", "海思", "麒麟", "Mate", "Pura"],
  },
  {
    canonical: "小米",
    dimension: "品牌",
    aliases: ["小米", "Xiaomi", "MIUI", "Redmi", "红米"],
    entities: ["澎湃", "小米汽车"],
  },
  {
    canonical: "OPPO",
    dimension: "品牌",
    aliases: ["OPPO", "oppo", "Oppo", "一加", "OnePlus", "Reno"],
    entities: ["Find"],
  },
  {
    canonical: "vivo",
    dimension: "品牌",
    aliases: ["vivo", "VIVO", "Vivo", "iQOO", "iqoo"],
    entities: ["X 系列"],
  },
  {
    canonical: "荣耀",
    dimension: "品牌",
    aliases: ["荣耀", "HONOR", "Honor", "Magic"],
    entities: [],
  },

  // 即时零售平台
  {
    canonical: "美团闪购",
    // 注：美团一律映射本类（含外卖/大众点评等子业务）
    dimension: "即时零售平台",
    aliases: ["美团闪购", "美团", "Meituan", "美团即时零售", "美团外卖", "美团买菜", "美团优选", "大众点评"],
    entities: [],
  },
  {
    canonical: "京东秒送",
    dimension: "即时零售平台",
    aliases: ["京东秒送", "京东到家", "京东即时零售"],
    entities: [],
  },
  {
    canonical: "淘宝闪购",
    dimension: "即时零售平台",
    aliases: ["淘宝闪购", "淘宝即时零售", "饿了么"],
    entities: [],
  },
];

// 主题标签（不属于上面任何板块，但常出现）—— 仅用于"标签"，不作为主分类候选
export const TOPIC_TAGS = [
  "AI",
  "芯片",
  "补贴",
  "UE",
  "市场份额",
  "跨境",
  "供应链",
  "产能规划",
  "出海",
  "GMV",
  "监管",
  "广告",
  "直播",
  "物流",
  "履约",
  "用户增长",
];

// alias 长度降序的扫描表（避免短别名先吃掉长别名段）
const ALIAS_PAIRS = (() => {
  const pairs = [];
  for (const cat of CATEGORIES) {
    for (const alias of cat.aliases) {
      pairs.push({ alias, canonical: cat.canonical });
    }
  }
  pairs.sort((a, b) => b.alias.length - a.alias.length);
  return pairs;
})();

const TOPIC_TAG_PAIRS = (() => {
  return TOPIC_TAGS.map((t) => ({ alias: t, tag: t })).sort(
    (a, b) => b.alias.length - a.alias.length
  );
})();

// canonical → 板块映射
export const CANONICAL_TO_DIMENSION = (() => {
  const m = {};
  for (const cat of CATEGORIES) m[cat.canonical] = cat.dimension;
  return m;
})();

// canonical → 关联实体
export const CANONICAL_TO_ENTITIES = (() => {
  const m = {};
  for (const cat of CATEGORIES) m[cat.canonical] = cat.entities;
  return m;
})();

// 归一化：全半角、繁简、英文大小写交给 indexOf 处理；这里只统一空白
export function normalize(text) {
  if (!text) return "";
  return String(text)
    .replace(/[　\s]+/g, " ")
    .trim();
}

// 在文本中扫描所有 canonical 命中，按首次出现顺序去重返回
// 算法：长别名优先，命中后从扫描串挖空，避免短别名误抢
export function scanCanonicals(text) {
  if (!text) return [];
  const original = normalize(text);
  let hay = original;
  const hits = new Map(); // canonical → first index in original
  for (const { alias, canonical } of ALIAS_PAIRS) {
    let idx = hay.indexOf(alias);
    if (idx < 0) continue;
    if (!hits.has(canonical)) {
      hits.set(canonical, original.indexOf(alias));
    }
    // 把所有该 alias 出现位置在 hay 中替换为等长空格
    while (idx >= 0) {
      hay = hay.slice(0, idx) + " ".repeat(alias.length) + hay.slice(idx + alias.length);
      idx = hay.indexOf(alias);
    }
  }
  return [...hits.entries()].sort((a, b) => a[1] - b[1]).map(([c]) => c);
}

// 在文本中扫描所有主题标签（同样长别名优先，去重）
export function scanTopicTags(text) {
  if (!text) return [];
  const original = normalize(text);
  let hay = original;
  const hits = new Map();
  for (const { alias, tag } of TOPIC_TAG_PAIRS) {
    let idx = hay.indexOf(alias);
    if (idx < 0) continue;
    if (!hits.has(tag)) hits.set(tag, original.indexOf(alias));
    while (idx >= 0) {
      hay = hay.slice(0, idx) + " ".repeat(alias.length) + hay.slice(idx + alias.length);
      idx = hay.indexOf(alias);
    }
  }
  return [...hits.entries()].sort((a, b) => a[1] - b[1]).map(([t]) => t);
}

// 计算 canonical 在正文中的"出现次数"（别名 + 关联实体合计）
// 用 escape-safe 包装，alias 内含 . 等会被字面化
function countOccurrences(haystack, needle) {
  if (!needle) return 0;
  let n = 0;
  let i = 0;
  while ((i = haystack.indexOf(needle, i)) !== -1) {
    n += 1;
    i += needle.length;
  }
  return n;
}

export function countCanonicalInBody(canonical, body) {
  if (!body) return 0;
  const cat = CATEGORIES.find((c) => c.canonical === canonical);
  if (!cat) return 0;
  const hay = normalize(body);
  let total = 0;
  for (const a of cat.aliases) total += countOccurrences(hay, a);
  for (const e of cat.entities) total += countOccurrences(hay, e);
  return total;
}

// 简单首段提取：用换行/标点切，取前 200 字
export function firstParagraph(text, limit = 200) {
  if (!text) return "";
  const norm = normalize(text);
  const firstChunk = norm.split(/(?:\n|。|！|？|\.|\!|\?)/)[0] || norm;
  return firstChunk.slice(0, limit);
}
