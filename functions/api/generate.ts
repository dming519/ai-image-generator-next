import type { ImageMode, ImageSize } from "../../src/lib/types";
import { requireSession } from "../_lib/auth";

interface GenerateRequestBody {
  prompt?: string;
  size?: ImageSize;
  mode?: ImageMode;
  inputImages?: string[];
}

interface FunctionContext {
  request: Request;
  env: {
    TASKS_KV?: {
      put: (
        key: string,
        value: string,
        options?: { expirationTtl?: number },
      ) => Promise<void>;
    };
    IMAGE_WORKER_URL?: string;
    IMAGE_WORKER_TOKEN?: string;
    AUTH_SECRET?: string;
  };
  waitUntil?: (promise: Promise<unknown>) => void;
}

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...init?.headers,
    },
  });
}

export async function onRequestPost(context: FunctionContext) {
  const session = await requireSession(context.request, context.env);
  if (!session) {
    return json({ error: "内置模式需要先登录" }, { status: 401 });
  }

  let body: GenerateRequestBody;

  try {
    body = (await context.request.json()) as GenerateRequestBody;
  } catch {
    return json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }

  const kv = context.env.TASKS_KV;
  const workerUrl = context.env.IMAGE_WORKER_URL?.trim();
  const workerToken = context.env.IMAGE_WORKER_TOKEN?.trim();
  if (!kv) {
    return json({ error: "服务端未配置 TASKS_KV" }, { status: 500 });
  }
  if (!workerUrl) {
    return json({ error: "服务端未配置 IMAGE_WORKER_URL" }, { status: 500 });
  }
  if (!workerToken) {
    return json({ error: "服务端未配置 IMAGE_WORKER_TOKEN" }, { status: 500 });
  }

  const images = (body.inputImages ?? []).filter(Boolean);
  const mode = body.mode ?? "generate";
  const prompt = body.prompt?.trim() ?? "";

  if (!prompt && mode === "generate") {
    return json({ error: "请输入提示词" }, { status: 400 });
  }

  if (mode === "edit" && images.length === 0) {
    return json({ error: "编辑模式必须上传至少一张源图片" }, { status: 400 });
  }

  const taskId = crypto.randomUUID();
  const now = Date.now();
  await kv.put(
    `task:${taskId}`,
    JSON.stringify({
      status: "pending",
      createdAt: now,
      updatedAt: now,
    }),
    { expirationTtl: 3600 },
  );

  const dispatch = fetch(`${workerUrl.replace(/\/+$/, "")}/task`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${workerToken}`,
    },
    body: JSON.stringify({
      taskId,
      prompt,
      size: body.size,
      mode,
      inputImages: images,
    }),
  }).catch(async (error) => {
    await kv.put(
      `task:${taskId}`,
      JSON.stringify({
        status: "failed",
        createdAt: now,
        updatedAt: Date.now(),
        error: error instanceof Error ? error.message : String(error),
      }),
      { expirationTtl: 3600 },
    );
  });

  if (context.waitUntil) {
    context.waitUntil(dispatch);
  }

  return json({ taskId, status: "pending" }, { status: 202 });
}
