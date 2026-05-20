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

  const resp = await fetch(
    apiKey ? resolveImageEndpoint(baseUrl, opts.mode) : DEFAULT_PROXY_PATH,
    {
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
  },
  );

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
    const data = (await resp.json()) as ProxyPayload;
    if (!data.base64) {
      throw new Error("代理接口返回成功但缺少图片数据");
    }
    return {
      base64: data.base64,
      model: data.model || model,
    };
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
