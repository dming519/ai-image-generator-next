export type ImageSize = "1024x1024" | "1024x1536" | "1536x1024" | "auto";

export interface HistoryItem {
  id?: number;
  base64: string;
  prompt: string;
  model: string;
  size: ImageSize;
  timestamp: number;
}

export interface GenerateOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  prompt: string;
  size: ImageSize;
}
