# 部署检查清单

这份清单给你做两件事：

1. 部署前照着核对
2. 出问题时快速排查

## 一、最短部署清单

按顺序打勾即可。

### 1. Cloudflare 资源

- [ ] 已创建 `TASKS_KV`
- [ ] 已把同一个 KV ID 写入根目录 `wrangler.toml`
- [ ] 已把同一个 KV ID 写入 `worker/wrangler.toml`

### 2. Worker

- [ ] 已进入 `worker/` 目录
- [ ] 已执行 `npx wrangler deploy`
- [ ] 已记录 Worker 地址
- [ ] 已配置 `OPENAI_API_KEY`
- [ ] 已配置 `OPENAI_BASE_URL`
- [ ] 已配置 `OPENAI_MODEL`
- [ ] 已配置 `IMAGE_WORKER_TOKEN`

### 3. Pages

- [ ] 已创建 Pages 项目
- [ ] 已在 Pages 后台配置 `IMAGE_WORKER_URL`
- [ ] 已在 Pages 后台配置 `IMAGE_WORKER_TOKEN`
- [ ] `IMAGE_WORKER_URL` 填的是 Worker 实际地址
- [ ] `IMAGE_WORKER_TOKEN` 与 Worker 侧完全一致

### 4. 发布

- [ ] 已执行 `npm install`
- [ ] 已执行 `npm run build`
- [ ] 已执行 `npx wrangler@4.93.0 pages deploy out --project-name ai-image-generator-next`

### 5. 正式域名

- [ ] 已在 Pages 后台绑定正式域名
- [ ] 正式域名可正常打开首页

## 二、部署成功的判断标准

满足下面几条，基本就算部署成功了。

- [ ] 打开首页返回 `200`
- [ ] 打开 `/api/generate/status?taskId=test` 返回 `404`
- [ ] 页面可以正常提交生成任务
- [ ] 页面会轮询状态接口
- [ ] 最终能拿到生成图片结果

## 三、常见问题速查

### 页面能打开，但点击生成直接失败

检查这些：

- [ ] Pages 配了 `IMAGE_WORKER_URL`
- [ ] Pages 配了 `IMAGE_WORKER_TOKEN`
- [ ] Worker 已经成功部署
- [ ] Worker 配了 `OPENAI_API_KEY`
- [ ] Worker 配了 `OPENAI_BASE_URL`
- [ ] Worker 配了 `OPENAI_MODEL`

### 一直轮询，没有结果

检查这些：

- [ ] Pages 和 Worker 绑定的是同一个 `TASKS_KV`
- [ ] Worker 能正常访问上游接口
- [ ] `IMAGE_WORKER_TOKEN` 两边一致
- [ ] 上游接口实际已经返回结果

### 提示 `401 Unauthorized`

检查这些：

- [ ] Worker 的 `IMAGE_WORKER_TOKEN` 是否和 Pages 一致

### 提示 `服务端未配置 TASKS_KV`

检查这些：

- [ ] 根目录 `wrangler.toml` 有 `TASKS_KV`
- [ ] `worker/wrangler.toml` 有 `TASKS_KV`
- [ ] 绑定名拼写就是 `TASKS_KV`

### 发布时报 `fetch failed`

检查这些：

- [ ] 不要优先怀疑项目代码
- [ ] 先改用 `npx wrangler@4.93.0 pages deploy out --project-name ai-image-generator-next`
- [ ] 再检查本地网络和 Cloudflare 登录状态

## 四、你以后最常用的几个命令

根目录：

```bash
npm install
npm run build
npx wrangler@4.93.0 pages deploy out --project-name ai-image-generator-next
```

Worker 目录：

```bash
cd worker
npx wrangler deploy
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put OPENAI_BASE_URL
npx wrangler secret put OPENAI_MODEL
npx wrangler secret put IMAGE_WORKER_TOKEN
```

## 五、相关文档

- 详细部署说明：[DEPLOY.md](F:\VSCodeProjects\ai-image-generator-next\DEPLOY.md)
- 项目说明：[README.md](F:\VSCodeProjects\ai-image-generator-next\README.md)
