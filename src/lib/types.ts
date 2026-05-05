export type ImageSize = "1024x1024" | "1024x1536" | "1536x1024" | "auto";

export type ImageMode = "generate" | "edit";

export interface HistoryItem {
  id?: number;
  base64: string;
  prompt: string;
  model: string;
  size: ImageSize;
  mode?: ImageMode;
  timestamp: number;
}

export interface GenerateOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  prompt: string;
  size: ImageSize;
  mode: ImageMode;
  /**
   * data URL 形式的图片（如 `data:image/png;base64,xxx`）。
   * - generate 模式下可选，作为参考图。
   * - edit 模式下至少需要一张作为源图。
   */
  inputImages?: string[];
}
