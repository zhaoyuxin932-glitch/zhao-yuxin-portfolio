# Portfolio Preview

一个速度优先的私密作品集：把图片放进 `portfolio-images/`，启动后输入密码即可查看全屏逐页页面。

## 使用

```bash
cp .env.example .env
pnpm install
pnpm dev
```

如果当前 shell 没有系统 Node，可以先执行：

```bash
export PATH="/Users/yuxinzhao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/Users/yuxinzhao/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin:$PATH"
```

首次启动会自动生成密码，并写入 `data/current-password.txt`。本地查看密码：

```bash
pnpm password:show
```

打开 `http://localhost:3000`，输入密码进入。

## Render 部署

Render Web Service 设置：

```text
Build Command: pnpm install --frozen-lockfile
Start Command: pnpm start
```

环境变量：

```env
NODE_ENV=production
PASSWORD_ROTATION_DAYS=10
SITE_EXPIRES_AFTER_DAYS=60
EMAIL_ENABLED=false
SESSION_SECRET=生成一个随机长字符串
```

Render 上的当前密码会出现在服务日志里，也可以在 Shell 里运行：

```bash
pnpm password:show
```

## 放图片

把作品图直接放进 `portfolio-images/`。支持：

- `.jpg`
- `.jpeg`
- `.png`
- `.webp`
- `.gif`
- `.avif`

`1.jpeg` 会固定作为第一张，其他图片按自然顺序排列。

## 自动换密码和失效

默认：

- 每 10 天自动换一次密码
- 换密码后，旧登录会自动失效
- 网站 60 天后失效
- 未登录时无法直接访问图片文件
- 图片响应禁止浏览器缓存

可以在 `.env` 里改：

```env
PASSWORD_ROTATION_DAYS=10
SITE_EXPIRES_AFTER_DAYS=60
```

## 邮件

默认使用本地密码文件，不自动发邮件。密码会写入：

```text
data/current-password.txt
```

如果以后想开启邮件，把 `.env` 里的 `EMAIL_ENABLED` 改成 `true`，并填好 SMTP 配置。

Outlook 常见配置：

```env
EMAIL_ENABLED=true
SMTP_HOST=smtp.office365.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=你的邮箱
SMTP_PASS=你的邮箱应用密码
EMAIL_FROM=你的邮箱
EMAIL_TO=接收密码的邮箱
```

如果没有配置邮件，服务器会把密码打印到终端，并写入本地 `data/current-password.txt`。
