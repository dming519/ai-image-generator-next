# 部署指南

这份文档只讲一件事：怎么把这个项目完整部署起来。

当前项目不是只发一个前端页面就结束了，实际需要同时部署两部分：

1. `Cloudflare Pages`
2. `独立 Cloudflare Worker`

另外还要准备：

1. `KV`
2. `Durable Object`
3. `Secrets`
4. `正式域名`

如果你只发 Pages，不发 Worker，页面能打开，但生成图片会失败。

## 一、先理解项目结构

这个项目分成两块：

### 1. Pages

负责：

- 托管前端页面
- 提供 `/api/generate`
- 提供 `/api/generate/status`

对应目录：

- 根目录
- `functions/`

### 2. Worker

负责：

- 接收 Pages 分发过来的任务
- 调上游图片接口
- 把任务结果写回 KV

对应目录：

- `worker/`

## 二、部署前你要准备什么

先准备好这些信息：

### Cloudflare 账号

你需要一个已经开通 Pages 和 Workers 的 Cloudflare 账号。

### 上游图片接口配置

也就是 Worker 真正调用的图片服务配置：

- `OPENAI_API_KEY`
- `OPENAI_BASE_URL`
- `OPENAI_MODEL`

例如：

```text
OPENAI_API_KEY=你的上游 key
OPENAI_BASE_URL=https://ai.centos.hk/v1
OPENAI_MODEL=gpt-image-2
```

### 本地环境

建议：

- `Node.js 20+`
- `npm`
- 已安装或可直接使用 `npx wrangler`

## 三、第一次部署时的完整顺序

第一次部署建议严格按下面顺序来：

1. 创建 KV
2. 部署 Worker
3. 给 Worker 配 Secret
4. 创建 Pages 项目
5. 给 Pages 配 KV 和 Secret
6. 发布 Pages
7. 绑定正式域名
8. 联调验证

不要先跳到最后，不然很容易页面能打开，但生图链路不通。

## 四、创建 KV

这个项目需要一个 KV，用来保存任务状态和结果。

可以用命令行：

```bash
npx wrangler kv namespace create TASKS_KV
```

执行后会得到一个 KV Namespace ID。

把这个 ID 分别填到两个地方：

### 根目录 `wrangler.toml`

```toml
[[kv_namespaces]]
binding = "TASKS_KV"
id = "这里换成你的 KV ID"
```

### `worker/wrangler.toml`

```toml
[[kv_namespaces]]
binding = "TASKS_KV"
id = "这里换成你的 KV ID"
```

## 五、部署 Worker

先部署 Worker，因为 Pages 侧需要知道 Worker 地址。

进入 `worker/` 目录：

```bash
cd worker
```

直接部署：

```bash
npx wrangler deploy
```

部署成功后，你会拿到一个 Worker 地址，例如：

```text
https://ai-image-worker.xxxxx.workers.dev
```

这个地址后面要配置到 Pages 的 `IMAGE_WORKER_URL`。

## 六、给 Worker 配置 Secret

仍然在 `worker/` 目录下，依次执行：

```bash
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put OPENAI_BASE_URL
npx wrangler secret put OPENAI_MODEL
npx wrangler secret put IMAGE_WORKER_TOKEN
```

说明：

- `OPENAI_API_KEY`：上游接口的 key
- `OPENAI_BASE_URL`：上游接口地址，例如 `https://ai.centos.hk/v1`
- `OPENAI_MODEL`：例如 `gpt-image-2`
- `IMAGE_WORKER_TOKEN`：Pages 调 Worker 时用的内部鉴权 token，自定义一串随机字符串即可

注意：

- `IMAGE_WORKER_TOKEN` 要和 Pages 侧配置成完全一样

## 七、确认 Worker 配置文件

当前 `worker/wrangler.toml` 至少要有这些内容：

```toml
name = "ai-image-worker"
main = "src/index.ts"
compatibility_date = "2026-05-21"

[[kv_namespaces]]
binding = "TASKS_KV"
id = "你的 KV ID"

[durable_objects]
bindings = [
  { name = "IMAGE_TASKS", class_name = "ImageTasksDO" }
]

[[migrations]]
tag = "v1"
new_sqlite_classes = ["ImageTasksDO"]
```

这里的 `Durable Object` 不需要你单独去后台建，`wrangler deploy` 时会按配置创建。

## 八、创建 Pages 项目

回到项目根目录：

```bash
cd ..
```

第一次可以直接用 Cloudflare Dashboard 建 Pages 项目，也可以用命令行发。

如果你用 Dashboard，核心配置是：

- Project name: `ai-image-generator-next`
- Build command: `npm run build`
- Output directory: `out`

这个项目是静态导出，不是 SSR 项目。

## 九、给 Pages 配置 KV 和 Secret

Pages 侧也要能访问同一个 KV，还要知道 Worker 地址和鉴权 token。

### 1. 配置 KV

根目录 `wrangler.toml`：

```toml
name = "ai-image-generator-next"
pages_build_output_dir = "out"

[[kv_namespaces]]
binding = "TASKS_KV"
id = "你的 KV ID"
```

### 2. 在 Cloudflare Pages 后台配置 Secret

进入：

- `Workers & Pages`
- 选择你的 Pages 项目
- `Settings`
- `Variables and Secrets`

添加下面两个 Secret：

- `IMAGE_WORKER_URL`
- `IMAGE_WORKER_TOKEN`

示例：

```text
IMAGE_WORKER_URL=https://ai-image-worker.xxxxx.workers.dev
IMAGE_WORKER_TOKEN=你自己设置的随机字符串
```

注意：

- `IMAGE_WORKER_URL` 不要带尾部 `/`
- `IMAGE_WORKER_TOKEN` 必须和 Worker 侧一致

## 十、发布 Pages

在项目根目录执行：

```bash
npm install
npm run build
```

如果构建成功，再发布：

```bash
npx wrangler pages deploy out --project-name ai-image-generator-next
```

如果你本地 `wrangler` 老版本不稳定，建议直接用：

```bash
npx wrangler@4.93.0 pages deploy out --project-name ai-image-generator-next
```

这个项目之前就出现过旧版 `wrangler` 调 Cloudflare API 时 `fetch failed` 的情况，新版更稳。

## 十一、绑定正式域名

如果你已经有正式域名，例如：

- `https://image.easyauto.app`

可以在 Pages 后台绑定：

1. 打开 Pages 项目
2. 进入 `Custom domains`
3. 添加你的域名
4. 按 Cloudflare 提示完成 DNS 解析

绑定完成后，正式域名会指向最新 Pages 部署。

## 十二、怎么验证是否部署成功

按下面顺序检查。

### 1. 页面能否打开

访问：

```text
https://你的正式域名
```

或者 Pages 默认地址：

```text
https://xxx.pages.dev
```

如果首页打不开，先别测接口，先把 Pages 配通。

### 2. 状态接口是否存在

打开：

```text
https://你的域名/api/generate/status?taskId=test
```

正常情况下会返回：

```json
{"error":"任务不存在或已过期"}
```

这说明 Pages Functions 路由已经工作了。

### 3. 真正发起一次图片生成

在页面中使用 `内置配置` 模式，输入提示词，点击生成。

正常链路应该是：

1. `POST /api/generate` 返回 `202`
2. 前端开始轮询 `/api/generate/status`
3. Worker 调用上游生成图片
4. KV 中状态变成 `succeeded`
5. 页面拿到图片并显示

## 十三、最常见的报错

### 1. 页面能打开，但生成失败

优先检查：

- Pages 是否配置了 `IMAGE_WORKER_URL`
- Pages 是否配置了 `IMAGE_WORKER_TOKEN`
- Worker 是否真的已经部署
- Worker 的 `OPENAI_API_KEY / OPENAI_BASE_URL / OPENAI_MODEL` 是否已配置

### 2. 一直轮询没结果

优先检查：

- Worker 有没有成功写回 KV
- Pages 和 Worker 用的是不是同一个 `TASKS_KV`
- `IMAGE_WORKER_TOKEN` 两边是否一致
- 上游图片接口是否真的返回了结果

### 3. `401 Unauthorized`

通常是：

- Pages 调 Worker 时带的 `IMAGE_WORKER_TOKEN` 和 Worker Secret 不一致

### 4. `服务端未配置 TASKS_KV`

通常是：

- `wrangler.toml` 没绑 KV
- 绑定名不是 `TASKS_KV`

### 5. `fetch failed`

如果是 `wrangler pages deploy` 时报这个错，通常不是项目代码问题，而是本地 `wrangler` / 网络问题。

可以直接改用：

```bash
npx wrangler@4.93.0 pages deploy out --project-name ai-image-generator-next
```

## 十四、最省事的部署清单

如果你只想照着做，不看原理，按这个最短流程走：

1. 创建 KV：`TASKS_KV`
2. 把 KV ID 写到根目录和 `worker/wrangler.toml`
3. 进入 `worker/`
4. 执行 `npx wrangler deploy`
5. 执行：
   - `npx wrangler secret put OPENAI_API_KEY`
   - `npx wrangler secret put OPENAI_BASE_URL`
   - `npx wrangler secret put OPENAI_MODEL`
   - `npx wrangler secret put IMAGE_WORKER_TOKEN`
6. 记下 Worker 地址
7. 回到根目录
8. 在 Pages 后台配置：
   - `IMAGE_WORKER_URL`
   - `IMAGE_WORKER_TOKEN`
9. 执行：
   - `npm install`
   - `npm run build`
   - `npx wrangler@4.93.0 pages deploy out --project-name ai-image-generator-next`
10. 在 Pages 后台绑定正式域名
11. 打开网页实测一次生成

## 十五、当前项目里的关键文件

- Pages 配置：[wrangler.toml](F:\VSCodeProjects\ai-image-generator-next\wrangler.toml)
- Worker 配置：[worker/wrangler.toml](F:\VSCodeProjects\ai-image-generator-next\worker\wrangler.toml)
- Pages 创建任务接口：[functions/api/generate.ts](F:\VSCodeProjects\ai-image-generator-next\functions\api\generate.ts)
- Pages 状态查询接口：[functions/api/generate/status.ts](F:\VSCodeProjects\ai-image-generator-next\functions\api\generate\status.ts)
- Worker 执行逻辑：[worker/src/index.ts](F:\VSCodeProjects\ai-image-generator-next\worker\src\index.ts)

