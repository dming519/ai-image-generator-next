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

function dataUrlToBase64(dataUrl: string) {
  const idx = dataUrl.indexOf(",");
  return idx >= 0 ? dataUrl.slice(idx + 1) : dataUrl;
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
  const fetchInit: RequestInit = {
    method: "POST",
    headers: apiKey
      ? {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        }
      : {
          "Content-Type": "application/json",
        },
    body: JSON.stringify(
      apiKey
        ? {
            model,
            prompt:
              opts.mode === "edit"
                ? opts.prompt ||
                  "请根据源图片进行编辑，保留主体并按要求调整"
                : opts.prompt,
            ...(opts.size !== "auto" ? { size: opts.size } : {}),
            response_format: "b64_json",
            ...(opts.mode === "edit"
              ? { image: dataUrlToBase64(images[0]) }
              : {}),
          }
        : requestBody,
    ),
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
