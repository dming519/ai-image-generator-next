import { handleLogoutRequest } from "../../_lib/auth";

interface FunctionContext {
  request: Request;
}

export function onRequestGet(context: FunctionContext) {
  return handleLogoutRequest(context.request);
}
