export interface Env {
  OPENAI_API_KEY?: string;
  OPENAI_BASE_URL?: string;
  OPENAI_MODEL?: string;
  IMAGE_WORKER_TOKEN?: string;
  TASKS_KV: KVNamespace;
  IMAGE_TASKS: DurableObjectNamespace;
}

type ImageMode = "generate" | "edit";
type ImageSize = "1024x1024" | "1024x1536" | "1536x1024" | "auto";

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

function resolveBaseUrl(value?: string) {
  return value?.trim() || "";
}

function resolveModel(value?: string) {
  return value?.trim() || "";
}

function resolveImageEndpoint(baseUrl: string, mode: ImageMode) {
  const normalized = baseUrl.replace(/\/+$/, "");
  return normalized + (mode === "edit" ? "/images/edits" : "/images/generations");
}

function dataUrlToBlob(dataUrl: string) {
  const match = dataUrl.match(/^data:([^;,]+)?(?:;base64)?,(.*)$/);
  if (!match) {
    throw new Error("图片数据格式无效，无法解析上传内容");
  }

  const mimeType = match[1] || "application/octet-stream";
  const payload = match[2] || "";
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return new Blob([bytes], { type: mimeType });
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

export class ImageTasksDO {
  state: DurableObjectState;
  env: Env;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request) {
    if (request.method !== "POST") {
      return json({ error: "Method Not Allowed" }, { status: 405 });
    }

    let body: GenerateRequestBody & { taskId?: string };
    try {
      body = (await request.json()) as GenerateRequestBody & { taskId?: string };
    } catch {
      return json({ error: "请求体不是合法 JSON" }, { status: 400 });
    }

    const taskId = body.taskId?.trim();
    if (!taskId) {
      return json({ error: "缺少 taskId" }, { status: 400 });
    }

    const apiKey = this.env.OPENAI_API_KEY?.trim();
    const baseUrl = resolveBaseUrl(this.env.OPENAI_BASE_URL);
    const model = resolveModel(this.env.OPENAI_MODEL);
    if (!apiKey || !baseUrl || !model) {
      await this.env.TASKS_KV.put(
        `task:${taskId}`,
        JSON.stringify({
          status: "failed",
          updatedAt: Date.now(),
          error: "服务端缺少 OPENAI_API_KEY / OPENAI_BASE_URL / OPENAI_MODEL 配置",
        }),
        { expirationTtl: 3600 },
      );
      return json({ ok: false }, { status: 500 });
    }

    const images = (body.inputImages ?? []).filter(Boolean);
    const mode = body.mode ?? "generate";
    const prompt = body.prompt?.trim() ?? "";
    const size = body.size ?? "1024x1536";
    const taskKey = `task:${taskId}`;
    const now = Date.now();

    await this.env.TASKS_KV.put(
      taskKey,
      JSON.stringify({ status: "running", createdAt: now, updatedAt: now }),
      { expirationTtl: 3600 },
    );

    try {
      const upstream = await fetch(
        resolveImageEndpoint(baseUrl, mode),
        mode === "edit"
          ? (() => {
              const imageBlob = dataUrlToBlob(images[0]);
              const extension = imageBlob.type.split("/")[1] || "png";
              const formData = new FormData();
              formData.append("model", model);
              formData.append(
                "prompt",
                prompt || "请根据源图片进行编辑，保留主体并按要求调整",
              );
              if (size !== "auto") {
                formData.append("size", size);
              }
              formData.append("response_format", "b64_json");
              formData.append("image", imageBlob, `input-image.${extension}`);

              return {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${apiKey}`,
                },
                body: formData,
              } satisfies RequestInit;
            })()
          : {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`,
              },
              body: JSON.stringify({
                model,
                prompt,
                ...(size !== "auto" ? { size } : {}),
                response_format: "b64_json",
              }),
            },
      );

      const text = await upstream.text();
      if (!upstream.ok) {
        let detail = text.slice(0, 300);
        try {
          const payload = JSON.parse(text) as ImagesPayload;
          if (payload.error?.message) detail = payload.error.message;
        } catch {}
        await this.env.TASKS_KV.put(
          taskKey,
          JSON.stringify({
            status: "failed",
            createdAt: now,
            updatedAt: Date.now(),
            error: `HTTP ${upstream.status}: ${detail}`,
          }),
          { expirationTtl: 3600 },
        );
        return json({ ok: false }, { status: 502 });
      }

      let payload: ImagesPayload;
      try {
        payload = JSON.parse(text) as ImagesPayload;
      } catch {
        await this.env.TASKS_KV.put(
          taskKey,
          JSON.stringify({
            status: "failed",
            createdAt: now,
            updatedAt: Date.now(),
            error: "上游返回了无法解析的 JSON",
          }),
          { expirationTtl: 3600 },
        );
        return json({ ok: false }, { status: 502 });
      }

      const result = payload.data?.[0]?.b64_json;
      if (!result) {
        await this.env.TASKS_KV.put(
          taskKey,
          JSON.stringify({
            status: "failed",
            createdAt: now,
            updatedAt: Date.now(),
            error: "API 返回成功但未包含生成的图片",
          }),
          { expirationTtl: 3600 },
        );
        return json({ ok: false }, { status: 502 });
      }

      await this.env.TASKS_KV.put(
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

      return json({ ok: true });
    } catch (error) {
      await this.env.TASKS_KV.put(
        taskKey,
        JSON.stringify({
          status: "failed",
          createdAt: now,
          updatedAt: Date.now(),
          error: error instanceof Error ? error.message : String(error),
        }),
        { expirationTtl: 3600 },
      );
      return json({ ok: false }, { status: 500 });
    }
  }
}

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    if (url.pathname === "/task" && request.method === "POST") {
      const token = env.IMAGE_WORKER_TOKEN?.trim();
      const auth = request.headers.get("Authorization")?.trim();
      if (!token || auth !== `Bearer ${token}`) {
        return json({ error: "Unauthorized" }, { status: 401 });
      }
      const body = (await request.json()) as GenerateRequestBody & {
        taskId: string;
      };
      const id = env.IMAGE_TASKS.idFromName(body.taskId);
      const stub = env.IMAGE_TASKS.get(id);
      return stub.fetch("https://do/task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    }
    return json({ ok: true });
  },
};
