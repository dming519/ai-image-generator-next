import type { GenerateOptions } from "./types";
import {
  DEFAULT_PROXY_PATH,
  resolveBaseUrl,
  resolveModel,
} from "./config";

interface ImagesPayload {
  data?: Array<{ b64_json?: string }>;
  error?: { message?: string };
}

interface ProxyPayload {
  base64?: string;
  model?: string;
  error?: string;
}

interface AsyncTaskCreatePayload {
  taskId?: string;
  status?: string;
  error?: string;
}

interface AsyncTaskStatusPayload {
  status?: "pending" | "running" | "succeeded" | "failed";
  base64?: string;
  model?: string;
  error?: string;
}

function hasTaskId(
  payload: ProxyPayload | AsyncTaskCreatePayload,
): payload is AsyncTaskCreatePayload & { taskId: string } {
  return typeof (payload as AsyncTaskCreatePayload).taskId === "string";
}
const RETRYABLE_FETCH_ERRORS = ["Failed to fetch", "NetworkError"];

function resolveImageEndpoint(baseUrl: string, mode: GenerateOptions["mode"]) {
  const normalized = baseUrl.replace(/\/+$/, "");
  return (
    normalized +
    (mode === "edit" ? "/images/edits" : "/images/generations")
  );
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

export async function generateImage(
  opts: GenerateOptions,
): Promise<{ base64: string; model: string }> {
  const baseUrl = resolveBaseUrl(opts.baseUrl);
  const model = resolveModel(opts.model);
  const apiKey = opts.apiKey?.trim();

  if (apiKey && !baseUrl) {
    throw new Error("前端直连时，请先填写 Base URL");
  }
  if (apiKey && !model) {
    throw new Error("前端直连时，请先填写 Model");
  }

  const images = (opts.inputImages ?? []).filter(Boolean);

  if (opts.mode === "edit" && images.length === 0) {
    throw new Error("编辑模式需要至少上传一张源图片");
  }

  const requestBody = {
    prompt: opts.prompt,
    size: opts.size,
    mode: opts.mode,
    inputImages: images,
  };

  const fetchUrl = apiKey
    ? resolveImageEndpoint(baseUrl, opts.mode)
    : DEFAULT_PROXY_PATH;
  const fetchInit: RequestInit = apiKey
    ? opts.mode === "edit"
      ? (() => {
          const imageBlob = dataUrlToBlob(images[0]);
          const extension = imageBlob.type.split("/")[1] || "png";
          const formData = new FormData();
          formData.append("model", model);
          formData.append(
            "prompt",
            opts.prompt || "请根据源图片进行编辑，保留主体并按要求调整",
          );
          if (opts.size !== "auto") {
            formData.append("size", opts.size);
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
            prompt: opts.prompt,
            ...(opts.size !== "auto" ? { size: opts.size } : {}),
            response_format: "b64_json",
          }),
        }
    : {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      };
  let resp: Response;
  try {
    resp = await fetch(fetchUrl, fetchInit);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!RETRYABLE_FETCH_ERRORS.some((k) => msg.includes(k))) {
      throw err;
    }
    await new Promise((r) => setTimeout(r, 1200));
    try {
      resp = await fetch(fetchUrl, fetchInit);
    } catch {
      throw new Error("网络连接中断，请保持页面常亮后重试");
    }
  }

  if (!resp.ok) {
    const text = await resp.text();
    let detail = text.slice(0, 300);
    try {
      const j = JSON.parse(text) as ImagesPayload | ProxyPayload;
      if ("error" in j && typeof j.error === "string") detail = j.error;
      else if (
        "error" in j &&
        typeof j.error === "object" &&
        j.error?.message
      ) {
        detail = j.error.message;
      }
    } catch {
      // 保留原始 text
    }
    throw new Error(`HTTP ${resp.status}: ${detail}`);
  }

  if (!apiKey) {
    const created = (await resp.json()) as AsyncTaskCreatePayload | ProxyPayload;
    if ("base64" in created && created.base64) {
      return {
        base64: created.base64,
        model: created.model || "unknown",
      };
    }
    if (!hasTaskId(created)) {
      throw new Error(created.error || "创建任务失败");
    }

    const deadline = Date.now() + 8 * 60 * 1000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2000));
      const statusResp = await fetch(
        `${DEFAULT_PROXY_PATH}/status?taskId=${encodeURIComponent(created.taskId)}`,
        { method: "GET" },
      );
      if (!statusResp.ok) {
        const t = await statusResp.text();
        throw new Error(`查询任务失败: HTTP ${statusResp.status}: ${t.slice(0, 160)}`);
      }
      const statusData = (await statusResp.json()) as AsyncTaskStatusPayload;
      if (statusData.status === "succeeded" && statusData.base64) {
        return {
          base64: statusData.base64,
          model: statusData.model || "unknown",
        };
      }
      if (statusData.status === "failed") {
        throw new Error(statusData.error || "任务执行失败");
      }
    }
    throw new Error("任务超时，请重试");
  }

  const data = (await resp.json()) as ImagesPayload;
  const b64 = data.data?.[0]?.b64_json;
  if (!b64) {
    throw new Error(
      "API 返回成功但未包含生成的图片。响应: " +
        JSON.stringify(data).slice(0, 500),
    );
  }
  return {
    base64: b64,
    model,
  };
}
