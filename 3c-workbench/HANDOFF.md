# 3C 专家纪要自动化 - 项目接续文档

> 把这个文件读给新的 Claude 对话即可无缝接续工作。
> 路径：`D:/huangsirui.archer/Desktop/3C 报告库/3c-workbench/HANDOFF.md`

---

## 项目目标

把 `3C-AI工作台-精简版-离线版.html` 的「专家纪要」板块做活：

1. 每天从 `http://120.53.242.129/api/reports`（公开 JSON API，156 条 minutes）拉数据
2. 每条新增 → 上传到 JoySpace 文件夹 `https://joyspace.jd.com/h/personal/documents/7Euv0xaI6zwXq8Xe0MwH`（仅当备份）
3. 本地 HTML 直接渲染正文，每条带「在 JoySpace 中打开」按钮
4. 长期目标：可部署外网（GitHub Pages / Vercel / Cloudflare Pages 等）

---

## 当前进度（2026-06-25 更新）

✅ **全部跑通，已交付**

- 156/156 条数据入库，已全量上传 JoySpace（`joyspaceUrl` 100% 覆盖）
- 本地 HTML 渲染干净版正文，运行在 http://localhost:8080/
- 一键脚本 `run.bat` + 完整 `README.md` 已就位
- 工作流约定（去 AI 解读/核心要点/纪要正文 + QA 改 H3 编号）已固化进代码

---

## 用户偏好

- 脚本语言：**Node.js**（已确认，理由：与 web 同栈、未来部署 serverless 方便）
- JoySpace 文档组织：**每条纪要 = 一个独立文档**
- 正文阅读体验：**本站直接渲染正文，JoySpace 仅当备份**
- **输出格式（重要约定，2026-06-25 起每次同步自动应用）**：
  - **不输出**：AI 解读（aiInsight）、核心要点（points）、纪要正文（content 字段——它就是把 qa 平铺写一遍，会和结构化 QA 重复显示）
  - **专家问答**：每个问题用 `### Q1：...` `### Q2：...` 三级标题，相邻 QA 之间多空一段
  - **JoySpace markdown**：纯 markdown，**禁止**用 `<div style="font-family:...">` 包裹——JoySpace markdown parser 会把 div 内的 markdown 当原始 HTML 不解析，导致正文整块丢（第一次试过踩雷了）
  - 字体：JoySpace 用文档默认字体；前端阅读页用站点统一 PingFang / 微软雅黑

---

## 工作目录结构

主目录：`D:/huangsirui.archer/Desktop/3C 报告库/3c-workbench/`

```
3c-workbench/
├── run.bat                                # 一键入口（双击/终端跑）
├── README.md                              # 用户文档
├── HANDOFF.md                             # 本文件
├── web/
│   ├── index.html                         # 改造后独立站，可直接部署
│   ├── 3C-AI工作台-精简版-在线版.html       # 多板块版 wrapper（base64 注回）
│   └── data/minutes.json                  # 156 条数据，~7.3MB
└── scripts/
    ├── sync_minutes.mjs                   # 主同步脚本
    ├── serve.mjs                          # 本地静态服务器
    ├── smoke_test.mjs                     # 端到端校验
    ├── lib/
    │   ├── fetch_source.mjs               # 拉源 API
    │   ├── map_to_board.mjs               # 字段映射（platform/brand/retail）
    │   ├── render_markdown.mjs            # 渲染 .md（已应用格式约定）
    │   ├── upload_joyspace.mjs            # JoySpace 上传（库 + CLI）
    │   ├── joyspace-api-client.mjs        # JoySpace API 客户端（来自 skill-83052）
    │   └── repack_html.mjs                # 把改造后 HTML base64 注回 wrapper
    ├── templates/
    │   ├── expert.original.html           # 原始 expert 板块（备份）
    │   └── expert.modified.html           # 改造后 expert 板块（已应用格式约定）
    └── .cache/                            # 156 条 .md + 上传日志
```

参考资料路径：

- 原始 wrapper HTML：`C:/Users/huangsirui.archer/Claude/Projects/3C-AI工作台/3C-AI工作台-精简版-离线版.html`
- 旧版上传 skill（已不再用）：`C:/Users/huangsirui.archer/.claude/skills/markdown-to-joyspace/scripts/import_markdown_doc.js`
- **JoySpace API 客户端来源**：`D:/huangsirui.archer/Downloads/skill-83052-vlatest/scripts/joyspace-api-client.mjs`（已复制到本项目 `scripts/lib/`）

---

## 命令速查

```bash
cd "d:/huangsirui.archer/Desktop/3C 报告库/3c-workbench"

# 一键（最常用）：拉数据 + 增量上传新条目到 JoySpace
run.bat
# 或： node scripts/sync_minutes.mjs --upload

# 试水：只处理前 3 条
node scripts/sync_minutes.mjs --upload --limit 3

# 不上传，只更新本地 minutes.json
node scripts/sync_minutes.mjs

# 干跑不写盘
node scripts/sync_minutes.mjs --dry-run

# 强制全量重传（每条都重新创建 JoySpace 文档；旧的不删，需手动清理）
# 适用于：格式约定调整后批量覆盖
node scripts/sync_minutes.mjs --reupload

# 启本地预览
node scripts/serve.mjs        # http://localhost:8080/

# 端到端校验
node scripts/smoke_test.mjs

# 单独上传某个 .md
node scripts/lib/upload_joyspace.mjs scripts/.cache/<id>.md

# 改了 expert.modified.html 后重新生成 web/index.html 和 wrapper
node scripts/lib/repack_html.mjs

# 单独测某个 lib
node scripts/lib/fetch_source.mjs
node scripts/lib/map_to_board.mjs
node scripts/lib/render_markdown.mjs
```

---

## 工作流：每次同步发生了什么

`sync_minutes.mjs` 每次跑：

1. 拉源 API → `remoteMinutes`
2. 读 `web/data/minutes.json` → `localMinutes`
3. **删除**：远程没了的本地条目
4. **待处理**：
   - 默认：新条目 + 已有但 `joyspaceUrl` 为空的条目（仅 `--upload` 时）
   - `--reupload`：所有条目都重传一份（旧 JoySpace 文档不删）
5. `render_markdown.mjs` 渲染 `.md` 到 `scripts/.cache/<id>.md`（**已应用格式约定**：去 AI 解读/核心要点/纪要正文，QA 用 H3 + 编号）
6. `--upload`：调 JoySpace API 创建文档 → 把 url 写回 `item.joyspaceUrl`
7. 排序 + 写盘 `web/data/minutes.json`

前端阅读页（`expert.modified.html` → `web/index.html`）的 `openReader()` 函数也已应用同一套格式约定（去 AI 解读/核心要点/纪要正文，QA 用 H3 + Q1/Q2/Q3 编号）。

---

## 关键修复历史

### 1. JoySpace 上传修复（2026-06-25 早）

**根因**：旧 importer `import_markdown_doc.js` 第 483 行 `if (import.meta.url === \`file://${process.argv[1]}\`)` 在 Windows 永不匹配（`import.meta.url` 三斜杠 `process.argv[1]` 无前缀），导致 main() 不执行、子进程无报错地退出。

**方案**：复制 `skill-83052-vlatest/scripts/joyspace-api-client.mjs` 到 `scripts/lib/`，重写 `upload_joyspace.mjs` 直接 import API client（不再 spawn）。同进程缓存 auth/cookie/location，156 条 0 失败。

### 2. 输出格式重塑（2026-06-25 晚）

**用户反馈**：JoySpace 上传文档格式很乱、含不需要的 AI 解读和核心要点；前端阅读页 QA 显示两次（content 与 qa 重复）。

**踩坑**：第一次试图用 `<div style="font-family:京东朗正体">` 包整个 markdown 设字体，结果 JoySpace markdown parser 把 div 当原始 HTML，正文整块丢失。

**最终方案**：纯 markdown 输出，QA 改 `### Q1：...` H3 标题，QA 之间用 `\n\n\n\n` 多空一段，丢弃 aiInsight/points/content。前端阅读页 `openReader()` 同步精简。156 条用 `--reupload` 全量重传，0 失败。

---

## 数据 schema 速查

### 源 API minute 关键字段

| 字段 | 覆盖率 | 说明 |
|---|---|---|
| `id` | 100% | 稳定去重 key |
| `title`, `summary`, `publishedDate` | 100% | 基本信息 |
| `section`（单值）| 100% | 主分类 |
| `sections[]`（多值）| 100% | 多重分类 |
| `tags[]` | 100% | 关键词 |
| `outline[]` | 99% | 大纲（核心要点）— **不再使用** |
| `qaItems[]` | 99% | 问答（最有价值的结构化内容） |
| `content` | 100% | 正文（与 qa 重复，**不再使用**） |
| `aiInsight` | 89% | AI 解读 — **不再使用** |
| `creatorIntro` | 97% | 专家身份 |
| `documentId` | 97% | 内部 ID（不一定有） |

### HTML schema（`minutes.json` items[] 字段）

```js
{
  id, title, date, sum,           // 基本信息
  kw: [...],                       // 关键词数组
  points: [...],                   // 核心要点（保留字段但不再展示）
  src,                             // 来源（专家身份）
  platform, brand, retail,         // 三层分类标签（侧栏 facets）
  content,                         // 正文（保留字段但不再展示）
  qa: [{q, a}, ...],              // 专家问答 — 唯一展示的内容主体
  aiInsight,                       // AI 解读（保留字段但不再展示）
  documentId,                      // 源 API 的 documentId
  joyspaceUrl                     // 上传后回填
}
```

> 字段保留是为了将来可能恢复某些视图，前端 / markdown 模板里只是不再渲染。

### facets

| 维度 | 选项 |
|---|---|
| platform | 京东 / 天猫 / 阿里 / 拼多多 / 抖音 / Temu / 快手 / 美团 |
| brand | 苹果 / 华为 / 小米 / OPPO / vivo / 荣耀 / 联想 |
| retail | 京东到家 / 美团闪购 / 饿了么 / 抖音小时达 / MT闪购 / 京东秒送 / 淘宝闪购 |

---

## 后续可选事项（按需）

- [ ] 旧 156 条 JoySpace 文档清理（重传后旧文档没自动删，用户手动清理或加个 batch-delete 脚本）
- [ ] 部署外网（GitHub Pages / Vercel / Cloudflare Pages，把 `web/` 设为站点根即可）
- [ ] 定时任务（Windows 任务计划程序 / cron 跑 `run.bat`，每天自动同步增量）
- [ ] 字体统一（如确实想要"京东朗正体"，需调研 JoySpace 文档级别样式 API，目前在 markdown 层面无法做）

---

## 给新对话的开场提示词

```
请先读这个文件了解项目当前状态：
D:/huangsirui.archer/Desktop/3C 报告库/3c-workbench/HANDOFF.md

然后根据我下一个具体需求继续工作。
```
