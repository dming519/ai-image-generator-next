import type { GenerateOptions } from "./types";
import {
  DEFAULT_PROXY_PATH,
  resolveBaseUrl,
  resolveModel,
} from "./config";

interface ResponseOutput {
  type: string;
  result?: string;
}

interface ResponsesPayload {
  output?: ResponseOutput[];
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

type InputContent =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string };

interface InputMessage {
  role: "user";
  content: InputContent[];
}

export async function generateImage(
  opts: GenerateOptions,
): Promise<{ base64: string; model: string }> {
  const baseUrl = resolveBaseUrl(opts.baseUrl);
  const model = resolveModel(opts.model);
  const apiKey = opts.apiKey?.trim();

  const tool: { type: string; size?: string } = { type: "image_generation" };
  if (opts.size !== "auto") tool.size = opts.size;

  const images = (opts.inputImages ?? []).filter(Boolean);

  if (opts.mode === "edit" && images.length === 0) {
    throw new Error("编辑模式需要至少上传一张源图片");
  }

  let input: string | InputMessage[];

  if (images.length === 0) {
    // 纯文本生成
    input = opts.prompt;
  } else {
    // 带参考图/源图：使用消息数组形式
    const promptText =
      opts.mode === "edit"
        ? opts.prompt ||
          "请根据上述源图片进行编辑，保留主体的同时根据后续要求作出调整"
        : opts.prompt;

    const content: InputContent[] = [{ type: "input_text", text: promptText }];
    for (const img of images) {
      content.push({ type: "input_image", image_url: img });
    }
    input = [{ role: "user", content }];
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
            input,
            tools: [tool],
          }
        : requestBody,
    ),
  },
  );

  if (!resp.ok) {
    const text = await resp.text();
    let detail = text.slice(0, 300);
    try {
      const j = JSON.parse(text) as ResponsesPayload | ProxyPayload;
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

  const data = (await resp.json()) as ResponsesPayload;
  const calls = (data.output ?? []).filter(
    (o) => o.type === "image_generation_call",
  );
  if (!calls.length || !calls[0].result) {
    throw new Error(
      "API 返回成功但未包含生成的图片。响应: " +
        JSON.stringify(data).slice(0, 500),
    );
  }
  return {
    base64: calls[0].result,
    model,
  };
}
