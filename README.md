# AI图像生成器

一个基于 `Next.js 15` 的图片生成 / 编辑工具，支持两种使用方式：

- `内置配置`：前端调用 Cloudflare Pages Functions，后端再分发到独立 Worker 执行长耗时任务
- `自定义配置`：浏览器直接请求用户填写的图片接口

当前项目已经不是单纯的静态前端页面，而是由前端页面、Pages Functions、KV、独立 Worker 和 Durable Object 共同组成。

## 先看这里

使用说明：

- [README.md](F:\VSCodeProjects\ai-image-generator-next\README.md)

部署说明：

- [DEPLOY.md](F:\VSCodeProjects\ai-image-generator-next\DEPLOY.md)

部署检查清单：

- [DEPLOY-CHECKLIST.md](F:\VSCodeProjects\ai-image-generator-next\DEPLOY-CHECKLIST.md)

## 功能说明

- `生成图片`
  - 输入提示词生成图片
  - 可选上传多张参考图
- `编辑图片`
  - 至少上传 1 张源图
  - 输入编辑指令后生成新图
- `配置方式`
  - `内置配置`
  - `自定义配置`
- `历史记录`
  - 结果保存在当前浏览器的 IndexedDB 中
- `结果操作`
  - 支持预览、放大、下载、复制提示词

## 配置方式

### 内置配置

适合直接使用站点预设配置的场景。

请求链路：

1. 浏览器请求 `POST /api/generate`
2. Cloudflare Pages Function 创建任务并写入 KV
3. Pages Function 调用独立 Worker 的 `/task`
4. Worker 通过 Durable Object 执行实际图片生成
5. Worker 把任务状态和结果写回 KV
6. 浏览器每 `2` 秒轮询一次 `GET /api/generate/status?taskId=...`
7. 拿到结果后在页面展示，并写入本地历史记录

这套异步任务机制主要是为了解决移动端浏览器长时间等待时连接被系统中断的问题。

### 自定义配置

适合自行填写兼容接口的场景。

必填项：

- `Base URL`
- `Model`
- `API Key`

请求规则：

- 选择 `生成图片` 时，请求 `POST {baseUrl}/images/generations`
- 选择 `编辑图片` 时，请求 `POST {baseUrl}/images/edits`

在这个模式下，请求由浏览器直接发往你填写的上游地址。

## 当前实现架构

### 前端

- `Next.js 15`
- `React 19`
- `TypeScript`
- `App Router`
- 静态导出 `output: "export"`

### Cloudflare 部分

- `Cloudflare Pages`
- `Cloudflare Pages Functions`
- `Cloudflare KV`
- 独立 `Cloudflare Worker`
- `Durable Object`

### 浏览器本地存储

- `localStorage`
  - 保存用户填写的 `Base URL`、`Model`、`API Key`、提示词
- `IndexedDB`
  - 保存历史图片结果和相关信息

## 目录结构

```text
ai-image-generator-next/
├── app/
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx
├── functions/
│   └── api/
│       ├── generate.ts
│       └── generate/
│           └── status.ts
├── src/
│   ├── components/
│   ├── hooks/
│   └── lib/
├── worker/
│   ├── src/
│   │   └── index.ts
│   └── wrangler.toml
├── next.config.mjs
├── package.json
├── wrangler.toml
└── README.md
```

## 本地开发

安装依赖：

```bash
npm install
```

启动开发环境：

```bash
npm run dev
```

构建静态站点：

```bash
npm run build
```

本地预览 Pages 输出：

```bash
npm run preview
```

## 发布

详细部署步骤见：

- [DEPLOY.md](F:\VSCodeProjects\ai-image-generator-next\DEPLOY.md)
- [DEPLOY-CHECKLIST.md](F:\VSCodeProjects\ai-image-generator-next\DEPLOY-CHECKLIST.md)

## 关键行为说明

### 轮询策略

- 轮询间隔：`2` 秒
- 超时时间：`8` 分钟

### 图片上传限制

- 支持多图上传
- 单张图片大小限制：`8MB`

### 编辑模式

- 必须上传至少 1 张图片
- 当前实际提交给上游编辑接口的是第一张图片

### 历史记录

- 仅保存在当前浏览器
- 清空浏览器站点数据后会一起消失

## 已知限制

- `自定义配置` 依赖上游兼容图片生成 / 编辑接口
- `编辑图片` 当前只使用第一张图作为真正的编辑输入
- 返回结果使用 `base64`，图片较大时响应体也会变大
- Pages 和独立 Worker 是分离部署，发布时需要分别维护配置

## 相关文件

- 页面主逻辑：[src/components/ImageGenerator.tsx](F:\VSCodeProjects\ai-image-generator-next\src\components\ImageGenerator.tsx)
- 前端请求封装：[src/lib/api.ts](F:\VSCodeProjects\ai-image-generator-next\src\lib\api.ts)
- Pages 创建任务接口：[functions/api/generate.ts](F:\VSCodeProjects\ai-image-generator-next\functions\api\generate.ts)
- Pages 查询状态接口：[functions/api/generate/status.ts](F:\VSCodeProjects\ai-image-generator-next\functions\api\generate\status.ts)
- Worker 任务执行逻辑：[worker/src/index.ts](F:\VSCodeProjects\ai-image-generator-next\worker\src\index.ts)

## License

MIT
