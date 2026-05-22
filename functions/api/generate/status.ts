import { requireSession } from "../../_lib/auth";

interface FunctionContext {
  request: Request;
  env: {
    TASKS_KV?: {
      get: (key: string) => Promise<string | null>;
    };
    AUTH_SECRET?: string;
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

export async function onRequestGet(context: FunctionContext) {
  const session = await requireSession(context.request, context.env);
  if (!session) {
    return json({ error: "内置模式需要先登录" }, { status: 401 });
  }

  const kv = context.env.TASKS_KV;
  if (!kv) {
    return json({ error: "服务端未配置 TASKS_KV" }, { status: 500 });
  }

  const url = new URL(context.request.url);
  const taskId = url.searchParams.get("taskId")?.trim();
  if (!taskId) {
    return json({ error: "缺少 taskId" }, { status: 400 });
  }

  const task = await kv.get(`task:${taskId}`);
  if (!task) {
    return json({ error: "任务不存在或已过期" }, { status: 404 });
  }

  return json(JSON.parse(task));
}
