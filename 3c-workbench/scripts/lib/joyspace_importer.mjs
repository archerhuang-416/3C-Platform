import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_JOYSPACE_API_BASE = "https://apijoyspace.jd.com";
const DEFAULT_COLOR_GATEWAY_BASE = "https://api.m.jd.com";
const DEFAULT_TENANT_CODE = "CN.JD.GROUP";
const DEFAULT_APP_ID = "JDME_DESKTOP";
const DEFAULT_HIOFFICE_PORTS = Object.freeze(
  Array.from({ length: 10 }, (_, index) => 8988 + index * 2),
);

const TENANT_CONFIG = Object.freeze({
  "CN.JD.GROUP": { teamHeaderId: "00046419", ddAppId: "ee" },
  "TH.JD.GROUP": { teamHeaderId: "00046420", ddAppId: "th.ee" },
  "ID.JD.GROUP": { teamHeaderId: "00046421", ddAppId: "id.ee" },
  "SF.JD.GROUP": { teamHeaderId: "00046422", ddAppId: "sf.ee" },
});

function requireTenantConfig(tenantCode) {
  const config = TENANT_CONFIG[tenantCode];
  if (!config) {
    throw new Error(
      `Unsupported tenantCode "${tenantCode}". Expected one of ${Object.keys(TENANT_CONFIG).join(", ")}`,
    );
  }
  return config;
}

function extractCookieValue(cookie, name) {
  if (!cookie) {
    return "";
  }
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = cookie.match(new RegExp(`${escapedName}=([^;]+)`));
  return match?.[1]?.trim() || "";
}

export function readTokensFromConfigText(configText) {
  if (!configText?.trim()) {
    return { meToken: "", ssoToken: "" };
  }

  try {
    const parsed = JSON.parse(configText);
    const cookie =
      parsed?.models?.providers?.jdcloud?.headers?.Cookie ||
      parsed?.models?.providers?.jdcloud?.headers?.cookie ||
      "";
    return {
      meToken: extractCookieValue(cookie, "me_token"),
      ssoToken: extractCookieValue(cookie, "sso.jd.com"),
    };
  } catch {
    return { meToken: "", ssoToken: "" };
  }
}

export function buildCookieHeader({ meToken = "", ssoToken = "" }) {
  const cookies = [];
  if (meToken) {
    cookies.push(`me_token=${meToken}`);
  }
  if (ssoToken) {
    cookies.push(`sso.jd.com=${ssoToken}`);
  }
  return cookies.join("; ");
}

export function extractTitleFromMarkdown(markdown, filePath) {
  const heading = markdown.match(/^\s*#\s+(.+?)\s*$/m)?.[1]?.trim();
  if (heading) {
    return heading;
  }

  const stem = path.basename(filePath || "untitled.md", path.extname(filePath || "untitled.md"));
  return stem || "untitled";
}

export function normalizeLocationFromBasicInfo({ team_id, folder_id }) {
  const normalizedTeamId =
    typeof team_id === "string" && team_id.trim().startsWith("$") ? "root" : team_id?.trim();
  const normalizedFolderId = folder_id?.trim() || undefined;

  return {
    teamId: normalizedTeamId || "root",
    folderId: normalizedFolderId,
  };
}

export function buildCreatePagePayload({ title, markdown, teamId, folderId }) {
  const payload = {
    title,
    page_type: 13,
    teamId,
    content: [{ value: markdown }],
    contentType: "markdown",
  };

  if (folderId) {
    payload.folderId = folderId;
  }

  return payload;
}

async function readConfigTokens(configPath) {
  try {
    const text = await fs.readFile(configPath, "utf8");
    return readTokensFromConfigText(text);
  } catch {
    return { meToken: "", ssoToken: "" };
  }
}

async function callColorGateway(functionId, body) {
  const url = `${DEFAULT_COLOR_GATEWAY_BASE}?functionId=${encodeURIComponent(functionId)}&appid=${DEFAULT_APP_ID}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      functionId,
      body,
      appid: DEFAULT_APP_ID,
    }),
  });

  if (!response.ok) {
    throw new Error(`${functionId} HTTP ${response.status} ${response.statusText}`);
  }

  return response.json();
}

async function exchangeMeTokenFromStartupToken({ startupToken, tenantCode, deviceId }) {
  const { ddAppId } = requireTenantConfig(tenantCode);
  const response = await callColorGateway("desk.agent.auth.tokenGrant", {
    tenantCode,
    deviceUuid: deviceId,
    jdmeAppId: ddAppId,
    token: startupToken,
    appCode: process.platform === "darwin" ? "hio_plugin_joydesk_Mac" : "hio_plugin_joydesk",
  });

  if (response?.code !== 0 || !response?.data?.accessToken) {
    throw new Error(response?.msg || "desk.agent.auth.tokenGrant failed");
  }

  return response.data.accessToken.trim();
}

async function getLegacyEncryptPayload(ddAppId) {
  const timestamp = Math.floor(Date.now() / 1000);
  const response = await callColorGateway("desk.agent.auth.encrypt", {
    content: JSON.stringify({
      method: "query",
      param: "appToken",
      timestamp: String(timestamp),
      from: process.platform === "darwin" ? "hio_plugin_joydesk_Mac" : "hio_plugin_joydesk",
      to: "HiOfficeClient",
    }),
    jdmeAppId: ddAppId,
  });

  if (response?.code !== 0 || !response?.data?.aesKey || !response?.data?.content) {
    throw new Error(response?.msg || "desk.agent.auth.encrypt failed");
  }

  return {
    aesKey: response.data.aesKey,
    content: response.data.content,
  };
}

async function queryHiOfficeAppToken({ aesKey, content }) {
  const from = encodeURIComponent(
    process.platform === "darwin" ? "hio_plugin_joydesk_Mac" : "hio_plugin_joydesk",
  );

  let lastError = null;
  for (const port of DEFAULT_HIOFFICE_PORTS) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/hioffice?from=${from}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-AES-Key": aesKey,
        },
        body: content,
      });
      if (!response.ok) {
        throw new Error(`HiOffice ${port}: HTTP ${response.status}`);
      }
      const xAesKey = response.headers.get("X-AES-Key");
      if (!xAesKey) {
        throw new Error(`HiOffice ${port}: missing X-AES-Key`);
      }
      return {
        appToken: await response.text(),
        xAesKey,
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("HiOffice ports unavailable");
}

async function exchangeLegacyWebToken({ appToken, xAesKey, tenantCode, deviceId }) {
  const { ddAppId } = requireTenantConfig(tenantCode);
  const response = await callColorGateway("desk.agent.auth.getWebToken", {
    token: appToken,
    tenantCode,
    deviceUuid: deviceId,
    aesKey: xAesKey,
    jdmeAppId: ddAppId,
  });

  if (response?.code !== 0 || !response?.data?.accessToken) {
    throw new Error(response?.msg || "desk.agent.auth.getWebToken failed");
  }

  return response.data.accessToken.trim();
}

async function exchangeMeTokenViaHiOffice({ tenantCode, deviceId }) {
  const { ddAppId } = requireTenantConfig(tenantCode);
  const encrypt = await getLegacyEncryptPayload(ddAppId);
  const hiOffice = await queryHiOfficeAppToken(encrypt);
  return exchangeLegacyWebToken({
    appToken: hiOffice.appToken,
    xAesKey: hiOffice.xAesKey,
    tenantCode,
    deviceId,
  });
}

async function resolveAuth(options) {
  const envMeToken = process.env.ME_TOKEN || process.env.me_token || "";
  const envSsoToken = process.env.SSO_TOKEN || process.env.sso_token || "";
  if (envMeToken || envSsoToken) {
    return {
      mode: "env",
      meToken: envMeToken,
      ssoToken: envSsoToken,
    };
  }

  const configTokens = await readConfigTokens(
    options.configPath || path.join(process.env.HOME || "", ".joyclaw", "openclaw.json"),
  );
  if (configTokens.meToken || configTokens.ssoToken) {
    return {
      mode: "config",
      ...configTokens,
    };
  }

  if (options.startupToken) {
    const meToken = await exchangeMeTokenFromStartupToken({
      startupToken: options.startupToken,
      tenantCode: options.tenantCode,
      deviceId: options.deviceId,
    });
    return {
      mode: "tokenGrant",
      meToken,
      ssoToken: "",
    };
  }

  if (options.deviceId) {
    const meToken = await exchangeMeTokenViaHiOffice({
      tenantCode: options.tenantCode,
      deviceId: options.deviceId,
    });
    return {
      mode: "legacy",
      meToken,
      ssoToken: "",
    };
  }

  throw new Error(
    "Unable to resolve JoyMe auth. Provide ME_TOKEN/SSO_TOKEN, configure ~/.joyclaw/openclaw.json cookies, or pass JMECHAT_token with deviceId/tenantCode.",
  );
}

async function requestJoySpaceJson({ method, url, cookieHeader, teamHeaderId, body }) {
  const response = await fetch(`${DEFAULT_JOYSPACE_API_BASE}${url}`, {
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Cookie: cookieHeader,
      "x-team-id": teamHeaderId,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    throw new Error(`${url} HTTP ${response.status} ${response.statusText}`);
  }

  const json = await response.json();
  if (json?.status === "success" || json?.status === "0" || json?.status === 0) {
    return json.data;
  }
  if (json?.errorCode && json.errorCode !== "0") {
    throw new Error(json.errorMsg || json.errMsg || `${url} failed`);
  }
  return json.data ?? json;
}

function extractPageIdFromUrl(pageUrl) {
  const match = pageUrl.match(
    /joyspace\.jd\.com\/(?:pages|doc|sheets?|table|ppt|board|mind|meeting)\/([A-Za-z0-9_-]+)/i,
  );
  if (!match?.[1]) {
    throw new Error(`Unable to extract JoySpace page id from URL: ${pageUrl}`);
  }
  return match[1];
}

async function resolveTargetLocation({ pageUrl, cookieHeader, teamHeaderId }) {
  if (!pageUrl) {
    return {
      teamId: "root",
      folderId: undefined,
      source: "private-space-root",
    };
  }

  const pageId = extractPageIdFromUrl(pageUrl);
  const basicInfo = await requestJoySpaceJson({
    method: "GET",
    url: `/v3/pages/${pageId}/basic?sendRecent=0`,
    cookieHeader,
    teamHeaderId,
  });

  const normalized = normalizeLocationFromBasicInfo(basicInfo || {});
  return {
    ...normalized,
    source: pageUrl,
  };
}

async function createJoySpacePage({ markdown, title, location, cookieHeader, teamHeaderId }) {
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

async function verifyJoySpacePage({ pageId, cookieHeader, teamHeaderId }) {
  return requestJoySpaceJson({
    method: "POST",
    url: "/v1/pages/content",
    cookieHeader,
    teamHeaderId,
    body: { pageId },
  });
}

function parseArgs(argv) {
  const options = {
    filePath: "",
    title: "",
    pageUrl: "",
    teamId: "",
    folderId: "",
    tenantCode:
      process.env.JMECHAT_TENANT_CODE ||
      process.env.JMECHAT_tenantCode ||
      DEFAULT_TENANT_CODE,
    deviceId:
      process.env.JMECHAT_DEVICE_ID || process.env.JMECHAT_deviceId || "noDeviceId",
    startupToken: process.env.JMECHAT_token || "",
    configPath: path.join(process.env.HOME || "", ".joyclaw", "openclaw.json"),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];
    switch (current) {
      case "--file":
        options.filePath = next || "";
        index += 1;
        break;
      case "--title":
        options.title = next || "";
        index += 1;
        break;
      case "--page-url":
        options.pageUrl = next || "";
        index += 1;
        break;
      case "--tenant-code":
        options.tenantCode = next || options.tenantCode;
        index += 1;
        break;
      case "--device-id":
        options.deviceId = next || options.deviceId;
        index += 1;
        break;
      case "--startup-token":
        options.startupToken = next || options.startupToken;
        index += 1;
        break;
      case "--config":
        options.configPath = next || options.configPath;
        index += 1;
        break;
      default:
        break;
    }
  }

  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.filePath) {
    throw new Error("--file is required");
  }

  const markdown = await fs.readFile(options.filePath, "utf8");
  const title = options.title || extractTitleFromMarkdown(markdown, options.filePath);
  const auth = await resolveAuth(options);
  const { teamHeaderId } = requireTenantConfig(options.tenantCode);
  const cookieHeader = buildCookieHeader(auth);
  const location = await resolveTargetLocation({
    pageUrl: options.pageUrl,
    cookieHeader,
    teamHeaderId,
  });

  const created = await createJoySpacePage({
    markdown,
    title,
    location,
    cookieHeader,
    teamHeaderId,
  });
  const verified = await verifyJoySpacePage({
    pageId: created.id,
    cookieHeader,
    teamHeaderId,
  });

  console.log(
    JSON.stringify(
      {
        authMode: auth.mode,
        pageId: created.id,
        title: created.title || title,
        link: created.link || `https://joyspace.jd.com/pages/${created.id}`,
        teamId: created.team_id || location.teamId,
        folderId: created.folder_id || location.folderId || "",
        locationSource: location.source,
        verified: Array.isArray(verified?.content) && verified.content.length > 0,
      },
      null,
      2,
    ),
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

export { resolveAuth };
