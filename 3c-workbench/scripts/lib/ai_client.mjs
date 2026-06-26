// LLM gateway client — OpenAI-compatible Chat Completions protocol
// Reads config from .env (LLM_GATEWAY_URL / LLM_API_KEY / LLM_MODEL)
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = join(__dirname, "..", "..", ".env");

let CONFIG_LOADED = false;
function loadEnv() {
  if (CONFIG_LOADED) return;
  CONFIG_LOADED = true;
  if (!existsSync(ENV_PATH)) return;
  const raw = readFileSync(ENV_PATH, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

export function getLlmConfig() {
  loadEnv();
  const url = process.env.LLM_GATEWAY_URL;
  const apiKey = process.env.LLM_API_KEY;
  const model = process.env.LLM_MODEL || "DeepSeek-V4-Flash";
  if (!url || !apiKey) {
    throw new Error(
      `LLM 配置缺失：请在 .env 中设置 LLM_GATEWAY_URL / LLM_API_KEY（参考 .env.example）`
    );
  }
  return { url, apiKey, model };
}

const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_RETRIES = 2;

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function chatCompletion({
  system,
  user,
  temperature = 0.2,
  maxTokens = 800,
  responseFormat = null, // 设 "json_object" 强制 JSON
  timeoutMs = DEFAULT_TIMEOUT_MS,
  retries = DEFAULT_RETRIES,
} = {}) {
  const { url, apiKey, model } = getLlmConfig();

  const messages = [];
  if (system) messages.push({ role: "system", content: system });
  messages.push({ role: "user", content: user });

  const payload = {
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
    stream: false,
  };
  if (responseFormat === "json_object") {
    payload.response_format = { type: "json_object" };
  }

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
      }
      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content;
      if (typeof content !== "string") {
        throw new Error(`响应缺少 choices[0].message.content: ${JSON.stringify(data).slice(0, 300)}`);
      }
      return {
        content,
        usage: data.usage || {},
        raw: data,
      };
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      if (attempt < retries) {
        const wait = 1000 * (attempt + 1);
        await sleep(wait);
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

// 严格 JSON 解析：去掉 ```json 围栏，截取首个 { ... }
export function parseJsonLoose(text) {
  if (!text || typeof text !== "string") return null;
  let t = text.trim();
  t = t.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  const slice = t.slice(start, end + 1);
  try {
    return JSON.parse(slice);
  } catch {
    return null;
  }
}

function isMain(metaUrl) {
  const entry = process.argv[1];
  if (!entry) return false;
  return metaUrl === pathToFileURL(entry).href;
}

if (isMain(import.meta.url)) {
  const cfg = getLlmConfig();
  console.log(`Using model: ${cfg.model}  url: ${cfg.url}`);
  const r = await chatCompletion({
    system: "你是一个 helpful assistant。",
    user: "用最多 10 个汉字回答：北京到上海多远",
    maxTokens: 100,
  });
  console.log("---reply---");
  console.log(r.content);
  console.log("---usage---", r.usage);
}
