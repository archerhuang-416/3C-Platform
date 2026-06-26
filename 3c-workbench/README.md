# 3C 专家纪要 - 自动同步工作台

每天从 `http://120.53.242.129/api/reports` 拉数据 → 增量上传 JoySpace → 本地 HTML 直接渲染正文。

## 开箱即用

```bat
:: 双击或在终端跑
run.bat               :: 同步 + 上传新增（增量，最常用）
run.bat --no-upload   :: 只拉数据不上传
run.bat --limit 3     :: 试水：只处理前 3 条
run.bat --reupload    :: 强制全量重传（格式变更后用）
run.bat --serve       :: 启本地预览（http://localhost:8080/）
```

> 首次跑前确保已登录 HiOffice 桌面（用于 JoySpace 鉴权），或在环境变量里设了 `ME_TOKEN` / `SSO_TOKEN`。

## 目录

```
3c-workbench/
├── run.bat                              # 一键入口
├── HANDOFF.md                           # 接续文档（项目状态/卡点/方案）
├── web/
│   ├── index.html                       # 独立站，可直接部署到 GitHub Pages 等
│   ├── 3C-AI工作台-精简版-在线版.html      # 多板块 wrapper（base64 注回）
│   └── data/minutes.json                # 156 条数据，~7.3MB
└── scripts/
    ├── sync_minutes.mjs                 # 主同步脚本
    ├── serve.mjs                        # 本地静态服务器
    ├── smoke_test.mjs                   # 端到端校验
    ├── lib/
    │   ├── fetch_source.mjs             # 拉源 API
    │   ├── map_to_board.mjs             # 字段映射
    │   ├── render_markdown.mjs          # 渲染 .md
    │   ├── upload_joyspace.mjs          # JoySpace 上传（库 + CLI）
    │   ├── joyspace-api-client.mjs      # JoySpace API 客户端（来自 skill-83052）
    │   └── repack_html.mjs              # 把改造后 HTML base64 注回 wrapper
    ├── templates/                       # expert 板块原始/改造版
    └── .cache/                          # .md 临时落盘 + full-backfill.log
```

## 常用命令

```bash
cd "d:/huangsirui.archer/Desktop/3C 报告库/3c-workbench"

# 拉数据 + 增量上传 JoySpace（只上传 joyspaceUrl 为空的条目）
node scripts/sync_minutes.mjs --upload

# 拉数据但不上传
node scripts/sync_minutes.mjs

# 只处理前 3 条（试水）
node scripts/sync_minutes.mjs --upload --limit 3

# 强制全量重传（每条都重新创建一份 JoySpace 文档，旧的不删）
node scripts/sync_minutes.mjs --reupload

# 干跑不写盘
node scripts/sync_minutes.mjs --dry-run

# 启本地预览
node scripts/serve.mjs        # http://localhost:8080/

# 端到端校验
node scripts/smoke_test.mjs

# 单独上传某个 .md
node scripts/lib/upload_joyspace.mjs scripts/.cache/<id>.md

# 改了 expert.modified.html 后重新生成 web/index.html 和 wrapper
node scripts/lib/repack_html.mjs
```

## 增量同步逻辑

`sync_minutes.mjs` 每次跑：

1. 拉源 API，得到 `remoteMinutes`
2. 读 `web/data/minutes.json`，得到 `localMinutes`
3. 删除：远程没了的本地条目
4. 待处理 =
   - 默认：新条目（仅 `--upload` 时含「已有但 `joyspaceUrl` 为空」）
   - `--reupload`：所有条目都重传一份新 JoySpace 文档（旧文档不动，需手动清理）
5. 渲染 .md 到 `scripts/.cache/<id>.md`
6. `--upload`：调 JoySpace API 创建文档 → 把 url 写回 `item.joyspaceUrl`
7. 排序 + 写盘 `web/data/minutes.json`

## 输出格式约定（2026-06-25 调整）

每次同步生成的 markdown 与前端阅读页都按这套规则输出，**自动应用，无需手动调整**：

- 不输出 / 不显示：AI 解读、核心要点、纪要正文（`content` 字段——它与 QA 重复）
- 专家问答：每个问题标 `### Q1：...` `### Q2：...`，相邻问答之间多空一段
- 标题用 H1，分组小节用 H2，问题用 H3
- 字体：JoySpace 端使用文档默认字体；前端阅读页用站点统一字体（PingFang SC / 微软雅黑）

如要再调整这套规则，改两个文件：

- `scripts/lib/render_markdown.mjs`：JoySpace 上传用的 markdown
- `scripts/templates/expert.modified.html` 中的 `openReader(...)` 函数：前端阅读页

改完跑 `node scripts/lib/repack_html.mjs` 重打包前端，必要时跑 `run.bat --reupload` 重传。

## JoySpace 鉴权

`joyspace-api-client.mjs` 自动按以下顺序解析 token：

1. 环境变量 `ME_TOKEN` / `SSO_TOKEN`
2. `~/.joyclaw/openclaw.json` 中的 `models.providers.jdcloud.headers.Cookie`
3. `JMECHAT_token` + `JMECHAT_DEVICE_ID`（tokenGrant 模式）
4. HiOffice 本地端口轮询 8988-9006（legacy 模式，需 HiOffice 桌面在跑）

正常用户什么都不用配，第 4 步会自动起作用。

## 部署

`web/index.html` 是完整独立站（fetch `./data/minutes.json`），可以直接：

- GitHub Pages：把 `web/` 设为站点根
- Vercel / Cloudflare Pages：把 `web/` 设为 publish 目录
- 京东内部静态托管：同理

每次源数据更新只需重跑 `run.bat` 然后部署。

## 当前状态

- ✅ 156 条数据全部入库 + 全部上传 JoySpace（`joyspaceUrl` 100% 覆盖）
- ✅ 本地 HTML 渲染正文 / QA / AI 解读 / JoySpace 跳转按钮
- ✅ search 命中 kw / facets 多维筛选

下一次新增数据跑 `run.bat` 即增量补齐。
