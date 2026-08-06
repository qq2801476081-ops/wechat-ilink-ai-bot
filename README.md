# Cloudflare iLink AI Bot

部署在 Cloudflare Workers 上的微信 1 对 1 AI 机器人。它通过腾讯 iLink Bot API 收取消息，使用 Cloudflare Workers AI、DeepSeek 或 OpenAI 生成回复，并使用 D1 保存加密凭证、配置和独立的用户对话上下文。

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/qq2801476081-ops/wechat-ilink-ai-bot)

> 当前 Deploy 按钮指向公开仓库 `qq2801476081-ops/wechat-ilink-ai-bot`。

## 功能

- 完全运行在用户自己的 Cloudflare 账号中，无需电脑或手机持续开机。
- `/setup` 网页向导完成 AI 配置和微信扫码登录。
- 每分钟通过 Cron Trigger 拉取消息。
- 按微信用户 ID 隔离最近 10 轮对话，不会串台。
- 默认使用 Cloudflare Workers AI，无需外部 API Key。
- 可切换 DeepSeek 或 OpenAI；Key 从环境变量读取，或在 D1 中通过 AES-256-GCM 加密保存。
- bot token、账号 ID、用户 ID、轮询游标和最近 context token 以加密 JSON 形式存入 D1。
- D1 表由 Worker 首次接收请求时自动创建。

## 发布到GitHub（开发者操作）

如果你是项目开发者，需要先将代码发布到 GitHub，朋友才能使用 Deploy 按钮：

1. 在 [GitHub](https://github.com) 创建新仓库，命名为 `wechat-ilink-ai-bot`，设置为**公开（Public）**。
2. 将本地代码推送到仓库：

   ```bash
   git init
   git add .
   git commit -m "init"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/wechat-ilink-ai-bot.git
   git push -u origin main
   ```

3. 修改 `README.md` 中的 Deploy 按钮链接，将 `YOUR_USERNAME/YOUR_REPO` 替换为你的真实仓库地址。
4. 提交并推送修改：

   ```bash
   git add README.md
   git commit -m "update deploy button"
   git push
   ```

> **注意：** 仓库必须是公开的，否则 Cloudflare Deploy 按钮无法读取代码。

## 五步部署

### 1. 注册 Cloudflare 账号

访问 [Cloudflare](https://dash.cloudflare.com/sign-up) 注册免费账号，并进入 Workers & Pages 控制台。

### 2. 部署 Worker 项目

将本项目上传到公开 GitHub 仓库，替换本 README 中 Deploy 按钮的仓库地址，然后点击按钮。

也可以手动部署：

```bash
npm install
npx wrangler login
```

`wrangler.toml` 完整示例：

```toml
name = "wechat-ilink-ai-bot"
main = "src/index.ts"
compatibility_date = "2026-08-06"

[triggers]
crons = ["* * * * *"]

[ai]
binding = "AI"

[[d1_databases]]
binding = "DB"
database_name = "wechat-bot-db"
database_id = "YOUR_DB_ID_HERE"
```

### 3. 创建 D1 数据库

```bash
npx wrangler d1 create wechat-bot-db
```

命令会返回 `database_id`。将 [wrangler.toml](./wrangler.toml) 中的 `YOUR_DB_ID_HERE` 替换为该 ID。

不需要执行 SQL migration；访问 Worker 时会自动创建 `bot_state`、`conversations`、`config` 和 `login_qr` 表。

### 3.5 绑定 Workers AI（如使用默认 AI 模型）

如果使用 Cloudflare Workers AI（默认），需要在 Dashboard 中绑定 AI 服务：

1. 打开 [Cloudflare Dashboard](https://dash.cloudflare.com) → Workers & Pages。
2. 进入你的 Worker → Settings → Bindings。
3. 点击“Add”→ 选择“Workers AI”。
4. 变量名填写 `AI`，保存。

或通过 `wrangler.toml` 添加：

```toml
[ai]
binding = "AI"
```

> TOML 中 Workers AI 是单个绑定对象，正确语法是 `[ai]`，不是 `[[ai]]`。本项目根目录的 `wrangler.toml` 已包含该配置。

### 4. 设置加密密钥并部署

生成并设置一个恰好 32 字节的随机 UTF-8 字符串：

```bash
# 生成 32 字节随机密钥（Linux/macOS/WSL）
openssl rand -base64 24

# 或手动输入一个 32 字符的字符串
npx wrangler secret put BOT_STATE_ENC_KEY

# 部署 Worker
npx wrangler deploy
```

如需通过环境变量使用外部 AI，可再设置：

```bash
npx wrangler secret put DEEPSEEK_API_KEY
npx wrangler secret put OPENAI_API_KEY
```

环境变量中的 Key 优先于 `/setup` 中加密保存的 Key。

### 5. 打开 Setup 并扫码

访问：

```text
https://你的-worker域名/setup
```

1. 选择 AI 提供商和模型并保存。
2. 点击“获取登录二维码”。
3. 使用专用微信小号扫码并在手机端确认。
4. 登录成功后，让希望绑定的好友给 Bot 发送一条容易辨认的消息。
5. 等待约 1 分钟，在 `/setup` 的“选择对话好友”中刷新并选择该好友。

绑定后只有选中的好友会触发 AI 回复；其他好友只会出现在候选列表中，不会调用 AI，也不会保存为对话记录。

## 部署后验证

部署完成后，按以下步骤确认 Bot 正常运行：

1. **确认 Worker 在线**：访问 `https://你的-worker域名/health`，应返回 JSON 状态。
2. **确认 Cron 触发**：Cloudflare Dashboard → Workers → 你的 Bot → Logs，应看到每分钟有 Cron 请求。
3. **确认 Setup 页面**：访问 `/setup`，应能正常显示配置向导。
4. **扫码登录后**：让目标好友发一条消息，等待约 1 分钟，在 `/setup` 选择该候选好友。
5. **确认回复**：让已选择的好友再发一条消息，1 分钟内应收到 AI 回复；其他好友不应收到回复。

你的 Worker 域名会在部署完成后显示，也可以在 Dashboard → Workers → 你的 Bot 页面查看。

## Setup 页面截图指引

部署后可按以下两个状态截图，用于自己的部署文档：

1. **等待登录页**：打开 `/setup`，点击“获取登录二维码”，截图应同时包含模型配置、二维码和“等待扫码”状态。
2. **登录成功页**：手机确认后等待页面显示“登录成功，机器人已经上线”，截图应包含成功状态和二维码区域。

页面每 3 秒查询一次扫码状态。二维码过期后请重新获取。

## 本地开发

要求 Node.js 20 或更高版本。

```bash
npm install
copy .dev.vars.example .dev.vars
npm run dev
```

打开 `http://localhost:8787/setup`。

`.dev.vars` 中的 `BOT_STATE_ENC_KEY` 必须是恰好 32 字节。首次本地请求会在 Wrangler 的本地 D1 中自动初始化表。

> **警告：** `.dev.vars` 文件包含敏感密钥，已自动在 `.gitignore` 中排除，请勿手动移除。

验证命令：

```bash
npm run build
npm test
npm audit
```

测试使用本地 Miniflare D1 和受控 iLink/AI Mock，不会登录真实微信，也不会消耗线上 AI 额度。

## 动态配置

| 配置 | 默认值 | 说明 |
| --- | --- | --- |
| `ai_provider` | `workers-ai` | `workers-ai`、`deepseek` 或 `openai` |
| `ai_model` | `@cf/meta/llama-3.1-8b-instruct-fp8` | 传给所选 AI 服务的模型名 |
| `deepseek_api_key` | 无 | 加密存储，读取接口只返回“是否已配置” |
| `openai_api_key` | 无 | 加密存储，读取接口只返回“是否已配置” |

### Workers AI 推荐模型

- `@cf/meta/llama-3.1-8b-instruct-fp8`（默认，中文较好）
- `@cf/meta/llama-3.3-70b-instruct-fp8-fast`（更强，但消耗更多额度）
- `@cf/qwen/qwen1.5-14b-chat-awq`（中文特化）

## HTTP 路由

| 方法 | 路由 | 用途 |
| --- | --- | --- |
| GET | `/` | Bot 在线状态和最近轮询时间 |
| GET | `/setup` | 配置向导 |
| GET | `/api/login/qr` | 获取登录二维码 |
| GET | `/api/login/status?key=...` | 查询扫码状态 |
| GET | `/api/config` | 获取脱敏配置 |
| POST | `/api/config` | 保存 `{ "key": "...", "value": "..." }` |
| GET | `/api/chat-binding` | 获取脱敏候选好友列表和当前选择 |
| POST | `/api/chat-binding` | 选择候选好友，或用 `candidateId: null` 取消绑定 |
| GET | `/health` | JSON 健康状态 |

## 重要说明

- 每个部署实例对应一个独立微信 Bot，所有 Workers、D1 和 AI 额度均来自部署者自己的 Cloudflare 账号，与项目开发者无关。
- 建议使用专用微信小号作为 Bot。不要同时在其他设备登录该账号。
- 默认 Workers AI 不需要外部 API Key。选择 DeepSeek 或 OpenAI 时，部署者自行申请 Key 并承担对应费用。
- iLink 回复必须使用收到消息时附带的 `context_token`，因此本项目只回复用户消息，不提供主动群发能力。
- iLink 不提供完整好友通讯录读取接口。目标好友需要先发一条消息，随后才能在 `/setup` 的候选列表中选择。
- 未选择目标好友时 Bot 不回复任何会话；选择后只回复该好友。
- 超过 24 小时未聊天后如会话失效，请返回 `/setup` 重新扫码。
- 免费额度和模型可用性以 Cloudflare、DeepSeek、OpenAI 的当前官方政策为准。

### 24小时保活机制

Bot 通过 Cron Trigger 每分钟轮询消息。如果超过 24 小时没有用户发消息，iLink 的 `context_token` 会过期，Bot 将无法回复。此时需要重新访问 `/setup` 扫码登录。建议每天与 Bot 互动一次，或接受偶尔需要重新登录的事实。

## 项目结构

```text
wechat-ilink-ai-bot/
├── src/
│   ├── index.ts
│   ├── db.ts
│   ├── crypto.ts
│   ├── ilink.ts
│   ├── ai.ts
│   ├── config.ts
│   ├── setup.html.ts
│   └── types.ts
├── test/
├── wrangler.toml
├── package.json
├── tsconfig.json
└── README.md
```

## 参考项目与许可边界

- [Cloudflare-WeChat-Notifier](https://github.com/krapnikkk/Cloudflare-WeChat-Notifier)（MIT）：参考 Cloudflare Workers、Hono、D1、AES-GCM、二维码登录和定时任务架构。
- [wx-robot-ilink](https://github.com/co-pine/wx-robot-ilink)：仅核对公开的 iLink 字段、类型、请求头、二维码状态和消息格式；由于仓库未声明许可证，本项目不直接复制其源代码。

本项目实现不会在日志或 HTTP 响应中输出 API Key 或 bot token。

## 故障排查

### Q: 扫码后页面一直显示“等待扫码”

A: 二维码 5 分钟过期，请刷新页面重新获取。确保使用微信小号扫码，并在手机端点击“确认登录”。

### Q: Bot 登录成功但不回复消息

A: 检查 Cloudflare Dashboard → Workers → 你的 Bot → Logs，确认 Cron 是否触发。也可能是 AI 模型配置错误，尝试切换为 Workers AI。

### Q: 如何查看 Bot 运行日志

A: 执行 `npx wrangler tail` 实时查看日志。

### Q: 超过 24 小时没聊天，Bot 不回复了

A: iLink `context_token` 已过期，返回 `/setup` 重新扫码登录。

### Q: 如何更新 Bot 代码

A: 修改代码后重新执行 `npx wrangler deploy`。如果是 Fork 的仓库，从上游同步后重新部署。

## 微信小号注册提示

iLink Bot 需要一个**独立的微信账号**（不能是你日常使用的微信）。建议：

- 使用备用手机号注册新微信。
- 注册后完成基础设置（头像、昵称），避免被判定为异常账号。
- 不要在新手机上登录该账号（Bot 运行时会占用登录状态）。
- 如果提示需要好友辅助验证，请提前准备好辅助账号。
