import type { GenerateOptions } from "./types";

interface ResponseOutput {
  type: string;
  result?: string;
}

interface ResponsesPayload {
  output?: ResponseOutput[];
  error?: { message?: string };
}

export async function generateImage(opts: GenerateOptions): Promise<string> {
  const url = opts.baseUrl.replace(/\/+$/, "") + "/responses";
  const tool: { type: string; size?: string } = { type: "image_generation" };
  if (opts.size !== "auto") tool.size = opts.size;

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify({
      model: opts.model || "gpt-5.4",
      input: opts.prompt,
      tools: [tool],
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    let detail = text.slice(0, 300);
    try {
      const j = JSON.parse(text) as ResponsesPayload;
      if (j?.error?.message) detail = j.error.message;
    } catch {
      // 保留原始 text
    }
    throw new Error(`HTTP ${resp.status}: ${detail}`);
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
  return calls[0].result;
}
