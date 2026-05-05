"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { generateImage } from "@/lib/api";
import { dbAdd, dbAll, dbClear, dbDel } from "@/lib/db";
import type { HistoryItem, ImageMode, ImageSize } from "@/lib/types";
import { usePersistentInput } from "@/hooks/usePersistentInput";
import HistoryGrid from "./HistoryGrid";
import Lightbox from "./Lightbox";
import SizeSelector from "./SizeSelector";
import Stage from "./Stage";

const DEFAULT_PROMPT = `为我生成图中角色的绘制 Q 版的，LINE 风格的半身像表情包，注意头饰要正确
彩色手绘风格，使用 4x6 布局，涵盖各种各样的常用聊天语句，或是一些有关的娱乐 meme
其他需求：不要原图复制。所有标注为手写简体中文。
生成的图片需为 2K 分辨率 16:9`;

const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 单张图片 8MB 上限

function fileToDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export default function ImageGenerator() {
  const [baseUrl, setBaseUrl] = usePersistentInput(
    "imggen_f-base",
    "https://anyrouter.top/v1",
  );
  const [model, setModel] = usePersistentInput(
    "imggen_f-model",
    "gpt-5.3-codex",
  );
  const [apiKey, setApiKey] = usePersistentInput("imggen_f-key", "");
  const [prompt, setPrompt] = usePersistentInput(
    "imggen_f-prompt",
    DEFAULT_PROMPT,
  );

  const [mode, setMode] = useState<ImageMode>("generate");
  const [size, setSize] = useState<ImageSize>("1024x1536");
  const [inputImages, setInputImages] = useState<string[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // 初始加载 IndexedDB
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const items = (await dbAll()) ?? [];
        if (cancelled) return;
        setHistory(items);
        if (items.length) setActiveIdx(items.length - 1);
      } catch (e) {
        console.warn("IndexedDB 读取失败:", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSelectFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || !files.length) return;
      setError(null);
      const accepted: string[] = [];
      for (const file of Array.from(files)) {
        if (!file.type.startsWith("image/")) {
          setError(`已忽略非图片文件：${file.name}`);
          continue;
        }
        if (file.size > MAX_IMAGE_BYTES) {
          setError(`图片过大（>8MB）已忽略：${file.name}`);
          continue;
        }
        try {
          accepted.push(await fileToDataURL(file));
        } catch (e) {
          console.warn("读取图片失败:", e);
        }
      }
      if (accepted.length) {
        setInputImages((prev) => [...prev, ...accepted]);
      }
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    [],
  );

  const handleRemoveImage = useCallback((idx: number) => {
    setInputImages((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const handleClearImages = useCallback(() => {
    setInputImages([]);
  }, []);

  const handleSwitchMode = useCallback((next: ImageMode) => {
    setMode(next);
    setError(null);
  }, []);

  const handleGenerate = useCallback(async () => {
    setError(null);
    if (!apiKey.trim()) return setError("请输入 API Key");
    if (!baseUrl.trim()) return setError("请输入 Base URL");
    if (!prompt.trim() && mode === "generate")
      return setError("请输入提示词");
    if (mode === "edit" && inputImages.length === 0)
      return setError("编辑模式必须上传至少一张源图片");

    setBusy(true);
    try {
      const base64 = await generateImage({
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim(),
        model: model.trim(),
        prompt: prompt.trim(),
        size,
        mode,
        inputImages,
      });

      const item: HistoryItem = {
        base64,
        prompt: prompt.trim(),
        model: model.trim() || "gpt-5.4",
        size,
        mode,
        timestamp: Date.now(),
      };

      try {
        const id = await dbAdd(item);
        item.id = id as number;
      } catch (e) {
        console.warn("IndexedDB 写入失败:", e);
      }

      setHistory((h) => {
        const next = [...h, item];
        setActiveIdx(next.length - 1);
        return next;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [apiKey, baseUrl, model, prompt, size, mode, inputImages]);

  const handleDelete = useCallback((idx: number) => {
    setHistory((h) => {
      const item = h[idx];
      if (!item) return h;
      if (item.id != null) {
        dbDel(item.id).catch((e) => console.warn(e));
      }
      const next = h.filter((_, i) => i !== idx);
      setActiveIdx((cur) => {
        if (cur === idx) {
          return next.length ? Math.min(idx, next.length - 1) : -1;
        }
        if (cur > idx) return cur - 1;
        return cur;
      });
      return next;
    });
  }, []);

  const handleClearAll = useCallback(async () => {
    if (!confirm("确定清空所有历史记录？此操作不可撤销。")) return;
    try {
      await dbClear();
    } catch (e) {
      console.warn(e);
    }
    setHistory([]);
    setActiveIdx(-1);
  }, []);

  const handleDownload = useCallback(() => {
    if (activeIdx < 0) return;
    const item = history[activeIdx];
    if (!item) return;
    const a = document.createElement("a");
    a.href = "data:image/png;base64," + item.base64;
    const date = new Date(item.timestamp).toISOString().slice(0, 10);
    a.download = `ai-image-${date}-${activeIdx + 1}.png`;
    a.click();
  }, [activeIdx, history]);

  const handleCopyPrompt = useCallback(async () => {
    if (activeIdx < 0) return;
    const item = history[activeIdx];
    if (!item) return;
    try {
      await navigator.clipboard.writeText(item.prompt);
    } catch (e) {
      console.warn("复制失败:", e);
    }
  }, [activeIdx, history]);

  const handleZoom = useCallback(() => {
    if (activeIdx >= 0) setLightboxIdx(activeIdx);
  }, [activeIdx]);

  const editButtonDisabled =
    busy || (mode === "edit" && inputImages.length === 0);

  return (
    <main className="wrap">
      <h1>🎨 AI 图片生成器</h1>
      <p className="tagline">
        基于 OpenAI Responses API，在浏览器中直接生成 / 编辑图片
      </p>

      <section className="panel">
        <div className="grid-2">
          <div>
            <label htmlFor="f-base">Base URL</label>
            <input
              id="f-base"
              type="text"
              placeholder="https://api.openai.com/v1"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="f-model">Model</label>
            <input
              id="f-model"
              type="text"
              placeholder="gpt-5.4"
              value={model}
              onChange={(e) => setModel(e.target.value)}
            />
          </div>
        </div>

        <label htmlFor="f-key">API Key</label>
        <input
          id="f-key"
          type="password"
          placeholder="sk-...（密钥仅在浏览器本地使用，不会上传）"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
        />

        <label>模式</label>
        <div className="mode-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "generate"}
            className={`mode-tab${mode === "generate" ? " is-active" : ""}`}
            onClick={() => handleSwitchMode("generate")}
          >
            ✨ 生成图片
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "edit"}
            className={`mode-tab${mode === "edit" ? " is-active" : ""}`}
            onClick={() => handleSwitchMode("edit")}
          >
            🖌️ 编辑图片
          </button>
        </div>

        <label>
          {mode === "edit" ? "源图片（必填）" : "参考图片（可选）"}
        </label>
        <div className="upload-row">
          <button
            type="button"
            className="btn-ghost"
            onClick={() => fileInputRef.current?.click()}
          >
            📁 选择图片
          </button>
          {inputImages.length > 0 && (
            <button
              type="button"
              className="btn-ghost"
              onClick={handleClearImages}
            >
              清空
            </button>
          )}
          <span className="upload-hint">
            支持多张，单张 ≤ 8MB；
            {mode === "edit"
              ? "编辑模式至少 1 张"
              : "可不上传，仅作为生成参考"}
          </span>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => handleSelectFiles(e.target.files)}
          />
        </div>

        {inputImages.length > 0 && (
          <div className="thumbs">
            {inputImages.map((src, i) => (
              <div className="thumb" key={i}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt={`输入图 ${i + 1}`} />
                <button
                  type="button"
                  className="thumb-del"
                  aria-label="移除"
                  onClick={() => handleRemoveImage(i)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        <label>图片尺寸</label>
        <SizeSelector value={size} onChange={setSize} />

        <label htmlFor="f-prompt">
          {mode === "edit" ? "编辑指令" : "提示词"}
        </label>
        <textarea
          id="f-prompt"
          placeholder={
            mode === "edit"
              ? "描述你希望对源图片做的调整，例如：把背景换成樱花林，并加上柔和暖色光"
              : "描述你想生成的图片..."
          }
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />

        <button
          className="btn-primary"
          type="button"
          onClick={handleGenerate}
          disabled={editButtonDisabled}
        >
          {mode === "edit" ? "🖌️ 开始编辑" : "✨ 生成图片"}
        </button>
      </section>

      <section className="panel">
        <Stage
          item={activeIdx >= 0 ? history[activeIdx] ?? null : null}
          busy={busy}
          error={error}
          onDownload={handleDownload}
          onCopyPrompt={handleCopyPrompt}
          onZoom={handleZoom}
        />
      </section>

      <section className="panel">
        <HistoryGrid
          history={history}
          activeIdx={activeIdx}
          onSelect={setActiveIdx}
          onDelete={handleDelete}
          onClearAll={handleClearAll}
        />
      </section>

      <footer>
        纯前端实现 · API 调用由浏览器直连，密钥不会经过第三方 · 历史图片存储在浏览器 IndexedDB 中
      </footer>

      <Lightbox
        item={lightboxIdx !== null ? history[lightboxIdx] ?? null : null}
        onClose={() => setLightboxIdx(null)}
      />
    </main>
  );
}
