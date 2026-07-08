# 3C 统计计数服务 - 部署指南

## 前置条件

- 一个 Cloudflare 账号（免费即可）
- 安装 Node.js（你已有 v24）

## 部署步骤

### 1. 安装 Wrangler CLI

```bash
npm install -g wrangler
```

### 2. 登录 Cloudflare

```bash
wrangler login
```
浏览器会打开，授权即可。

### 3. 创建 KV Namespace

```bash
cd 3c-workbench/cloudflare-counter
wrangler kv namespace create COUNTER
```

输出类似：
```
{ binding = "COUNTER", id = "xxxxxxxxxxxxxxxxxxxx" }
```

**把这个 id 填入 `wrangler.toml` 中的 `id = "你的KV_NAMESPACE_ID"` 处。**

### 4. 部署 Worker

```bash
wrangler deploy
```

部署成功后会输出 Worker URL，类似：
```
https://3c-counter.your-subdomain.workers.dev
```

### 5. 配置前端

打开 `3C-AI工作台.html`，找到：
```javascript
const COUNTER_API = '';
```

填入你的 Worker URL：
```javascript
const COUNTER_API = 'https://3c-counter.your-subdomain.workers.dev';
```

### 6. 重新上传 HTML 到 OSS

HTML 修改后重新上传到你分享用的 OSS bucket 即可。

## 验证

1. 打开页面 → 顶栏"累计浏览"和"本周"数字应该从 0 开始递增
2. 点击课程的"回放"或"课件" → 该课程"人已学"数字 +1
3. 刷新页面 → 数据持久保留

## 费用

Cloudflare Workers 免费套餐包含：
- 每天 10 万次请求
- KV 读 10 万次/天，写 1000 次/天

对于内部使用完全够用。

## 文件说明

| 文件 | 说明 |
|------|------|
| `worker.js` | Worker 代码，处理计数逻辑 |
| `wrangler.toml` | 部署配置，需填入 KV namespace ID |
