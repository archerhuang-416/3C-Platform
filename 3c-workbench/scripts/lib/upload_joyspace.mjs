// 把本地 .md 上传成 JoySpace 文档（默认放到给定文件夹），返回 url。
// 直接 import joyspace-api-client（Windows 兼容），不再 spawn 子进程。
//
// 用法（CLI）：
//   node upload_joyspace.mjs <md-path> [folder-url]
// 用法（库）：
//   import { uploadToJoyspace } from "./upload_joyspace.mjs";
//   const url = await uploadToJoyspace("/path/foo.md", "https://joyspace.jd.com/h/personal/documents/XXXX");

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  createJoySpaceApiContext,
  extractPageIdFromUrl,
  fetchPageBasic,
  requestJoySpaceJson,
} from "./joyspace-api-client.mjs";

const DEFAULT_FOLDER_URL =
  "https://joyspace.jd.com/h/personal/documents/7Euv0xaI6zwXq8Xe0MwH";

// ========== Markdown 工具 ==========

function extractTitleFromMarkdown(markdown, filePath) {
  const heading = markdown.match(/^\s*#\s+(.+?)\s*$/m)?.[1]?.trim();
  if (heading) return heading;
  const stem = path.basename(
    filePath || "untitled.md",
    path.extname(filePath || "untitled.md")
  );
  return stem || "untitled";
}

// ========== JoySpace 调用层 ==========

function normalizeLocationFromBasicInfo(basicInfo) {
  const teamId = (basicInfo?.team_id || "").trim();
  const folderId = (basicInfo?.folder_id || "").trim();
  return {
    teamId: teamId.startsWith("$") || !teamId ? "root" : teamId,
    folderId: folderId || undefined,
  };
}

async function resolveTargetLocation({ folderUrl, cookieHeader, teamHeaderId }) {
  if (!folderUrl) {
    return { teamId: "root", folderId: undefined, source: "private-space-root" };
  }

  // 文件夹 URL（h/personal/documents/<id>）也包含 id；用同一个正则提取
  let folderId = "";
  const m = folderUrl.match(/\/(?:documents|folders?)\/([A-Za-z0-9_-]+)/);
  if (m?.[1]) {
    folderId = m[1];
  }

  let pageId = "";
  try {
    pageId = extractPageIdFromUrl(folderUrl);
  } catch {
    // 文件夹 URL 不是 page URL，没问题；走 folder_id 直接当 location
  }

  if (pageId) {
    const basic = await fetchPageBasic({ pageId, cookieHeader, teamHeaderId });
    const normalized = normalizeLocationFromBasicInfo(basic || {});
    return { ...normalized, source: folderUrl };
  }

  // 文件夹 URL → 直接以 folderId 为 location，teamId=root（个人空间）
  if (folderId) {
    return { teamId: "root", folderId, source: folderUrl };
  }

  return { teamId: "root", folderId: undefined, source: folderUrl };
}

function buildCreatePagePayload({ title, markdown, teamId, folderId }) {
  const payload = {
    title,
    page_type: 13,
    teamId,
    content: [{ value: markdown }],
    contentType: "markdown",
  };
  if (folderId) payload.folderId = folderId;
  return payload;
}

async function createJoySpacePage({
  markdown,
  title,
  location,
  cookieHeader,
  teamHeaderId,
}) {
  const payload = buildCreatePagePayload({
    title,
    markdown,
    teamId: location.teamId,
    folderId: location.folderId,
  });
  return requestJoySpaceJson({
    method: "POST",
    url: "/v1/pages",
    cookieHeader,
    teamHeaderId,
    body: payload,
  });
}

// ========== 上下文缓存 ==========
// 同一进程多次上传只解析一次 auth/cookie/location

let _ctxPromise = null;
async function getContext(folderUrl) {
  if (_ctxPromise) return _ctxPromise;
  _ctxPromise = (async () => {
    const ctx = await createJoySpaceApiContext();
    const location = await resolveTargetLocation({
      folderUrl,
      cookieHeader: ctx.cookieHeader,
      teamHeaderId: ctx.teamHeaderId,
    });
    return { ctx, location };
  })();
  return _ctxPromise;
}

// ========== 对外 API ==========

export async function uploadToJoyspace(mdPath, folderUrl = DEFAULT_FOLDER_URL) {
  const markdown = await fs.readFile(mdPath, "utf-8");
  const title = extractTitleFromMarkdown(markdown, mdPath);
  const { ctx, location } = await getContext(folderUrl);

  const created = await createJoySpacePage({
    markdown,
    title,
    location,
    cookieHeader: ctx.cookieHeader,
    teamHeaderId: ctx.teamHeaderId,
  });

  if (!created?.id) {
    throw new Error(
      "createJoySpacePage returned no id: " + JSON.stringify(created).slice(0, 200)
    );
  }
  const url = created.link || `https://joyspace.jd.com/pages/${created.id}`;
  return url;
}

// ========== CLI ==========

function isMain(metaUrl) {
  const entry = process.argv[1];
  if (!entry) return false;
  return metaUrl === pathToFileURL(entry).href;
}

if (isMain(import.meta.url)) {
  const file = process.argv[2];
  const folder = process.argv[3] || DEFAULT_FOLDER_URL;
  if (!file) {
    console.error("Usage: node upload_joyspace.mjs <md-path> [folder-url]");
    process.exit(2);
  }
  try {
    const url = await uploadToJoyspace(file, folder);
    console.log(JSON.stringify({ url }));
  } catch (err) {
    console.error("upload failed:", err?.message || err);
    process.exit(1);
  }
}
