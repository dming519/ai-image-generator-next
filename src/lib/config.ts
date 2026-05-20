export const DEFAULT_PROXY_PATH = "/api/generate";

export function resolveBaseUrl(value?: string) {
  return value?.trim() || "";
}

export function resolveModel(value?: string) {
  return value?.trim() || "";
}
