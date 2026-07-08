# 3C 计数服务 - 腾讯云部署指南

## 部署步骤

### 1. 上传文件到服务器

把 `counter-server/server.js` 上传到服务器任意目录，比如 `/opt/3c-counter/`：

```bash
mkdir -p /opt/3c-counter
# 用 scp 上传：
scp server.js root@你的服务器IP:/opt/3c-counter/
```

### 2. 启动服务

```bash
cd /opt/3c-counter
node server.js
```

服务将在 **3100 端口** 启动。

### 3. 后台常驻运行（推荐用 pm2）

```bash
npm install -g pm2
cd /opt/3c-counter
pm2 start server.js --name 3c-counter
pm2 save
pm2 startup  # 开机自启
```

### 4. 开放防火墙端口

腾讯云控制台 → 轻量应用服务器 → 防火墙 → 添加规则：
- 协议：TCP
- 端口：3100
- 来源：0.0.0.0/0

### 5. 配置 HTML

打开 `3C-AI工作台.html`，把 `COUNTER_API` 改为你的服务器地址：

```javascript
const COUNTER_API = 'http://你的服务器IP:3100';
```

### 6. 验证

浏览器访问：`http://你的服务器IP:3100/api/stats`

应返回：`{"pageTotal":0,"pageWeek":0,"courses":{}}`

## API 说明

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/stats` | GET | 获取所有统计数据 |
| `/api/pageview` | POST | 记录一次页面浏览 |
| `/api/course/:idx` | POST | 记录一次课程点击 |

## 数据存储

计数数据存储在 `counter_data.json` 文件中（与 server.js 同目录），自动创建，无需数据库。
