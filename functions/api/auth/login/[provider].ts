import { handleLoginRequest } from "../../../_lib/auth";
import type { AuthProvider } from "../../../../src/lib/types";

interface FunctionContext {
  request: Request;
  env: {
    AUTH_SECRET?: string;
    AUTH_GITHUB_ID?: string;
    AUTH_GITHUB_SECRET?: string;
    AUTH_GOOGLE_ID?: string;
    AUTH_GOOGLE_SECRET?: string;
  };
  params?: {
    provider?: string;
  };
}

function isProvider(value: string | undefined): value is AuthProvider {
  return value === "github" || value === "google";
}

export function onRequestGet(context: FunctionContext) {
  const provider = context.params?.provider;
  if (!isProvider(provider)) {
    return new Response("Not Found", { status: 404 });
  }
  return handleLoginRequest(context.request, context.env, provider);
}
