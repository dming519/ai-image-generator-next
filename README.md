# AI 图片生成器 (Next.js)

基于 OpenAI Responses API 的纯前端 AI 图片生成器，使用 Next.js 15 App Router + TypeScript 重构，可直接部署到 Cloudflare Pages。

## 技术栈

- **Next.js 15** (App Router) + **React 19** + **TypeScript**
- 通过 `output: "export"` 静态导出，无服务端依赖
- **IndexedDB** 持久化历史图片，**localStorage** 记忆配置
- 浏览器直连 OpenAI 兼容 `/responses` 端点，密钥不经过任何第三方

## 项目结构

```
ai-image-generator-next/
├── app/
│   ├── layout.tsx          # 根布局
│   ├── page.tsx            # 入口页
│   └── globals.css         # 全局样式
├── src/
│   ├── components/
│   │   ├── ImageGenerator.tsx  # 主容器组件
│   │   ├── SizeSelector.tsx    # 尺寸选择器
│   │   ├── Stage.tsx           # 当前结果展示
│   │   ├── HistoryGrid.tsx     # 历史网格
│   │   └── Lightbox.tsx        # 大图预览
│   ├── hooks/
│   │   └── usePersistentInput.ts  # localStorage 双向绑定
│   └── lib/
│       ├── types.ts        # 类型定义
│       ├── db.ts           # IndexedDB 封装
│       └── api.ts          # OpenAI Responses API
├── next.config.mjs
├── tsconfig.json
├── wrangler.toml
└── package.json
```

## 本地开发

```bash
pnpm install      # 或 npm i / yarn
pnpm dev          # http://localhost:3000
```

如果你希望本地联调 Cloudflare Pages Functions，而不是前端直连上游接口：

```bash
pnpm build
npx wrangler pages dev out
```

## 构建静态产物

```bash
pnpm build        # 产物输出到 out/
```

## 部署到 Cloudflare Pages

### 方式 A：CLI（Wrangler）

```bash
# 一次性登录
npx wrangler login

# 构建并部署
pnpm deploy
# 等价于：next build && wrangler pages deploy out
```

### 方式 B：Git 集成（推荐生产）

把仓库推到 GitHub/GitLab，在 Cloudflare Dashboard：

1. **Workers & Pages → Create → Pages → Connect to Git**
2. 选择仓库，配置：
   - **Framework preset**: `Next.js (Static HTML Export)`
   - **Build command**: `npm run build`
   - **Build output directory**: `out`
   - **Node version** (环境变量): `NODE_VERSION = 20`
3. 点击部署，后续 `git push` 自动构建上线。

## Cloudflare Secret 配置

如果你不想在浏览器里填写 `API Key`，可以把密钥配置到 Cloudflare Pages / Functions：

- Secret 名称：`OPENAI_API_KEY`
- 可选变量：`OPENAI_BASE_URL`
- 可选变量：`OPENAI_MODEL`

前端高级配置里的 `API Key` 留空时，会请求 `/api/generate`，由 Cloudflare Functions 从上述 Secret / Variables 读取配置并转发到上游接口。

## 关于路由模式

当前使用 **Static Export**，因为应用本身是纯客户端：

- 浏览器直接调用 OpenAI API
- 数据存放在 IndexedDB / localStorage
- 不需要 Next.js Server / Route Handlers

如果未来需要服务端能力（例如把 API Key 放到服务端转发、加 KV 存储），改用 `@cloudflare/next-on-pages` 适配器即可：

```bash
pnpm add -D @cloudflare/next-on-pages
# 删除 next.config.mjs 中的 output: "export"
# 给页面/路由声明 export const runtime = "edge"
npx @cloudflare/next-on-pages
npx wrangler pages deploy .vercel/output/static
```

## CORS 提示

部分中转网关默认未开放浏览器跨域。若控制台出现 CORS 报错，可：

- 改用允许跨域的中转 / 官方 `https://api.openai.com/v1`
- 或自建一个 Cloudflare Worker / Pages Functions 做反代（这种情况下推荐切到 `next-on-pages` 模式）

## License

MIT
