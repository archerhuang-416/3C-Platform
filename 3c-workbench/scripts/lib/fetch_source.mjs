// 拉取源 API：http://120.53.242.129/api/reports
// 返回顶层 { generatedAt, sections, reports[] }

const SOURCE_URL = "http://120.53.242.129/api/reports";
const TIMEOUT_MS = 30_000;

export async function fetchReports(url = SOURCE_URL) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} from ${url}`);
    }
    const data = await res.json();
    if (!data || !Array.isArray(data.reports)) {
      throw new Error("Bad response: missing reports[]");
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

export function filterMinutes(reports) {
  return reports.filter((r) => r && r.category === "minutes");
}

import { pathToFileURL } from "node:url";

function isMain(metaUrl) {
  const entry = process.argv[1];
  if (!entry) return false;
  return metaUrl === pathToFileURL(entry).href;
}

if (isMain(import.meta.url)) {
  const data = await fetchReports();
  const minutes = filterMinutes(data.reports);
  console.log(`generatedAt: ${data.generatedAt}`);
  console.log(`total reports: ${data.reports.length}`);
  console.log(`minutes: ${minutes.length}`);
  console.log(`first minute id: ${minutes[0]?.id}`);
  console.log(`first minute title: ${minutes[0]?.title?.slice(0, 50)}`);
}
