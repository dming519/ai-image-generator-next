"use client";

import { useCallback, useEffect, useState } from "react";
import { generateImage } from "@/lib/api";
import { dbAdd, dbAll, dbClear, dbDel } from "@/lib/db";
import type { HistoryItem, ImageSize } from "@/lib/types";
import { usePersistentInput } from "@/hooks/usePersistentInput";
import HistoryGrid from "./HistoryGrid";
import Lightbox from "./Lightbox";
import SizeSelector from "./SizeSelector";
import Stage from "./Stage";

const DEFAULT_PROMPT =
  "为我生成一张治愈风格的插画，主体是一只在窗台上看雨的橘猫，水彩质感，柔和暖色调";

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

  const [size, setSize] = useState<ImageSize>("1024x1536");
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);

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

  const handleGenerate = useCallback(async () => {
    setError(null);
    if (!apiKey.trim()) return setError("请输入 API Key");
    if (!baseUrl.trim()) return setError("请输入 Base URL");
    if (!prompt.trim()) return setError("请输入提示词");

    setBusy(true);
    try {
      const base64 = await generateImage({
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim(),
        model: model.trim(),
        prompt: prompt.trim(),
        size,
      });

      const item: HistoryItem = {
        base64,
        prompt: prompt.trim(),
        model: model.trim() || "gpt-5.4",
        size,
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
  }, [apiKey, baseUrl, model, prompt, size]);

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

  return (
    <main className="wrap">
      <h1>🎨 AI 图片生成器</h1>
      <p className="tagline">
        基于 OpenAI Responses API，在浏览器中直接生成图片
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

        <label>图片尺寸</label>
        <SizeSelector value={size} onChange={setSize} />

        <label htmlFor="f-prompt">提示词</label>
        <textarea
          id="f-prompt"
          placeholder="描述你想生成的图片..."
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />

        <button
          className="btn-primary"
          type="button"
          onClick={handleGenerate}
          disabled={busy}
        >
          ✨ 生成图片
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
