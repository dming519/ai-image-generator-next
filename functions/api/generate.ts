import {
  resolveBaseUrl,
  resolveModel,
} from "../../src/lib/config";
import type { ImageMode, ImageSize } from "../../src/lib/types";

interface GenerateRequestBody {
  prompt?: string;
  size?: ImageSize;
  mode?: ImageMode;
  inputImages?: string[];
}

interface ImagesPayload {
  data?: Array<{ b64_json?: string }>;
  error?: { message?: string };
}

interface FunctionContext {
  request: Request;
  env: {
    OPENAI_API_KEY?: string;
    OPENAI_BASE_URL?: string;
    OPENAI_MODEL?: string;
    TASKS_KV?: {
      get: (key: string) => Promise<string | null>;
      put: (
        key: string,
        value: string,
        options?: { expirationTtl?: number },
      ) => Promise<void>;
    };
  };
  waitUntil?: (promise: Promise<unknown>) => void;
}

function resolveImageEndpoint(baseUrl: string, mode: ImageMode) {
  const normalized = baseUrl.replace(/\/+$/, "");
  return (
    normalized +
    (mode === "edit" ? "/images/edits" : "/images/generations")
  );
}

function dataUrlToBase64(dataUrl: string) {
  const idx = dataUrl.indexOf(",");
  return idx >= 0 ? dataUrl.slice(idx + 1) : dataUrl;
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
  let body: GenerateRequestBody;

  try {
    body = (await context.request.json()) as GenerateRequestBody;
  } catch {
    return json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }

  const apiKey = context.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return json(
      { error: "Cloudflare 未配置 OPENAI_API_KEY" },
      { status: 500 },
    );
  }

  const images = (body.inputImages ?? []).filter(Boolean);
  const mode = body.mode ?? "generate";
  const prompt = body.prompt?.trim() ?? "";
  const size = body.size ?? "1024x1536";
  const baseUrl = resolveBaseUrl(context.env.OPENAI_BASE_URL);
  const model = resolveModel(context.env.OPENAI_MODEL);
  const kv = context.env.TASKS_KV;

  if (!baseUrl) {
    return json({ error: "服务端未配置 OPENAI_BASE_URL" }, { status: 500 });
  }
  if (!model) {
    return json({ error: "服务端未配置 OPENAI_MODEL" }, { status: 500 });
  }
  if (!kv) {
    return json({ error: "服务端未配置 TASKS_KV" }, { status: 500 });
  }

  if (!prompt && mode === "generate") {
    return json({ error: "请输入提示词" }, { status: 400 });
  }

  if (mode === "edit" && images.length === 0) {
    return json({ error: "编辑模式必须上传至少一张源图片" }, { status: 400 });
  }

  const taskId = crypto.randomUUID();
  const taskKey = `task:${taskId}`;
  const now = Date.now();

  await kv.put(
    taskKey,
    JSON.stringify({
      status: "pending",
      createdAt: now,
      updatedAt: now,
    }),
    { expirationTtl: 3600 },
  );

  const runTask = async () => {
    await kv.put(
      taskKey,
      JSON.stringify({
        status: "running",
        createdAt: now,
        updatedAt: Date.now(),
      }),
      { expirationTtl: 3600 },
    );

    const upstream = await fetch(resolveImageEndpoint(baseUrl, mode), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        prompt:
          mode === "edit"
            ? prompt || "请根据源图片进行编辑，保留主体并按要求调整"
            : prompt,
        ...(size !== "auto" ? { size } : {}),
        response_format: "b64_json",
        ...(mode === "edit" ? { image: dataUrlToBase64(images[0]) } : {}),
      }),
    });

    const text = await upstream.text();
    if (!upstream.ok) {
      let detail = text.slice(0, 300);
      try {
        const payload = JSON.parse(text) as ImagesPayload;
        if (payload.error?.message) detail = payload.error.message;
      } catch {
        // keep raw text
      }
      await kv.put(
        taskKey,
        JSON.stringify({
          status: "failed",
          createdAt: now,
          updatedAt: Date.now(),
          error: `HTTP ${upstream.status}: ${detail}`,
        }),
        { expirationTtl: 3600 },
      );
      return;
    }

    let payload: ImagesPayload;
    try {
      payload = JSON.parse(text) as ImagesPayload;
    } catch {
      await kv.put(
        taskKey,
        JSON.stringify({
          status: "failed",
          createdAt: now,
          updatedAt: Date.now(),
          error: "上游返回了无法解析的 JSON",
        }),
        { expirationTtl: 3600 },
      );
      return;
    }

    const result = payload.data?.[0]?.b64_json;
    if (!result) {
      await kv.put(
        taskKey,
        JSON.stringify({
          status: "failed",
          createdAt: now,
          updatedAt: Date.now(),
          error: "API 返回成功但未包含生成的图片",
        }),
        { expirationTtl: 3600 },
      );
      return;
    }

    await kv.put(
      taskKey,
      JSON.stringify({
        status: "succeeded",
        createdAt: now,
        updatedAt: Date.now(),
        model,
        base64: result,
      }),
      { expirationTtl: 3600 },
    );
  };

  if (context.waitUntil) {
    context.waitUntil(runTask());
  } else {
    runTask().catch(() => undefined);
  }

  return json({ taskId, status: "pending" }, { status: 202 });
}
