export const DEFAULT_BASE_URL = "https://anyrouter.top/v1";
export const DEFAULT_MODEL = "gpt-5.3-codex";
export const DEFAULT_PROXY_PATH = "/api/generate";

export function resolveBaseUrl(value?: string) {
  return value?.trim() || DEFAULT_BASE_URL;
}

export function resolveModel(value?: string) {
  return value?.trim() || DEFAULT_MODEL;
}
