import {
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  resolveBaseUrl,
  resolveModel,
} from "../../src/lib/config";
import type { ImageMode, ImageSize } from "../../src/lib/types";

interface GenerateRequestBody {
  baseUrl?: string;
  model?: string;
  prompt?: string;
  size?: ImageSize;
  mode?: ImageMode;
  inputImages?: string[];
}

interface ResponseOutput {
  type: string;
  result?: string;
}

interface ResponsesPayload {
  output?: ResponseOutput[];
  error?: { message?: string };
}

type InputContent =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string };

interface InputMessage {
  role: "user";
  content: InputContent[];
}

interface FunctionContext {
  request: Request;
  env: {
    OPENAI_API_KEY?: string;
    OPENAI_BASE_URL?: string;
    OPENAI_MODEL?: string;
  };
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
  const baseUrl = resolveBaseUrl(body.baseUrl || context.env.OPENAI_BASE_URL);
  const model = resolveModel(body.model || context.env.OPENAI_MODEL);

  if (!prompt && mode === "generate") {
    return json({ error: "请输入提示词" }, { status: 400 });
  }

  if (mode === "edit" && images.length === 0) {
    return json({ error: "编辑模式必须上传至少一张源图片" }, { status: 400 });
  }

  let input: string | InputMessage[];

  if (images.length === 0) {
    input = prompt;
  } else {
    const promptText =
      mode === "edit"
        ? prompt || "请根据上述源图片进行编辑，保留主体的同时根据后续要求作出调整"
        : prompt;

    const content: InputContent[] = [{ type: "input_text", text: promptText }];
    for (const image of images) {
      content.push({ type: "input_image", image_url: image });
    }
    input = [{ role: "user", content }];
  }

  const tool: { type: string; size?: string } = { type: "image_generation" };
  if (size !== "auto") tool.size = size;

  const upstream = await fetch(baseUrl.replace(/\/+$/, "") + "/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input,
      tools: [tool],
    }),
  });

  const text = await upstream.text();
  if (!upstream.ok) {
    let detail = text.slice(0, 300);
    try {
      const payload = JSON.parse(text) as ResponsesPayload;
      if (payload.error?.message) detail = payload.error.message;
    } catch {
      // keep raw text
    }
    return json({ error: `HTTP ${upstream.status}: ${detail}` }, { status: 502 });
  }

  let payload: ResponsesPayload;
  try {
    payload = JSON.parse(text) as ResponsesPayload;
  } catch {
    return json({ error: "上游返回了无法解析的 JSON" }, { status: 502 });
  }

  const result = (payload.output ?? []).find(
    (item) => item.type === "image_generation_call" && item.result,
  )?.result;

  if (!result) {
    return json(
      {
        error:
          "API 返回成功但未包含生成的图片。响应: " +
          text.slice(0, 500),
      },
      { status: 502 },
    );
  }

  return json({
    base64: result,
    model,
    baseUrl,
  });
}
