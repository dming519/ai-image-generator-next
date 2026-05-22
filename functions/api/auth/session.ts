import { handleSessionRequest } from "../../_lib/auth";

interface FunctionContext {
  request: Request;
  env: {
    AUTH_SECRET?: string;
  };
}

export function onRequestGet(context: FunctionContext) {
  return handleSessionRequest(context.request, context.env);
}
