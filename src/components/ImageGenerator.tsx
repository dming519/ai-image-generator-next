"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { generateImage } from "@/lib/api";
import { dbAdd, dbAll, dbClear, dbDel } from "@/lib/db";
import type { AuthSession, HistoryItem, ImageMode, ImageSize } from "@/lib/types";
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
type WakeLockSentinelLike = { release: () => Promise<void> };

function fileToDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function useTheme() {
  const [dark, setDark] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("imggen_theme") === "dark";
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  }, [dark]);

  const toggle = useCallback(() => {
    setDark((prev) => {
      const next = !prev;
      localStorage.setItem("imggen_theme", next ? "dark" : "light");
      return next;
    });
  }, []);

  return { dark, toggle };
}

export default function ImageGenerator() {
  const [baseUrl, setBaseUrl] = usePersistentInput("imggen_f-base", "");
  const [model, setModel] = usePersistentInput("imggen_f-model", "");
  const [apiKey, setApiKey] = usePersistentInput("imggen_f-key", "");
  const [prompt, setPrompt] = usePersistentInput(
    "imggen_f-prompt",
    DEFAULT_PROMPT,
  );

  const { dark, toggle: toggleTheme } = useTheme();

  const [mode, setMode] = useState<ImageMode>("generate");
  const [size, setSize] = useState<ImageSize>("1024x1536");
  const [inputImages, setInputImages] = useState<string[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const [configMode, setConfigMode] = useState<"builtin" | "custom">("builtin");
  const [session, setSession] = useState<AuthSession | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [promptExpanded, setPromptExpanded] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null);

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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/auth/session", {
          method: "GET",
          credentials: "same-origin",
          cache: "no-store",
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const payload = (await response.json()) as AuthSession;
        if (!cancelled) {
          setSession(payload);
        }
      } catch {
        if (!cancelled) {
          setSession({ authenticated: false, user: null });
        }
      } finally {
        if (!cancelled) {
          setSessionLoading(false);
        }
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
    if (configMode === "builtin" && !session?.authenticated) {
      return setError("内置配置仅对已登录用户开放，请先使用 GitHub 或 Google 登录。");
    }
    if (!prompt.trim() && mode === "generate")
      return setError("请输入提示词");
    if (mode === "edit" && inputImages.length === 0)
      return setError("编辑模式必须上传至少一张源图片");

    setBusy(true);
    try {
      try {
        const maybeWakeLock = (
          navigator as Navigator & {
            wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinelLike> };
          }
        ).wakeLock;
        if (maybeWakeLock) {
          wakeLockRef.current = await maybeWakeLock.request("screen");
        }
      } catch {
        // 部分移动端不支持或不允许 Wake Lock，忽略即可
      }

      const result = await generateImage({
        baseUrl: configMode === "custom" ? baseUrl : "",
        apiKey: configMode === "custom" ? apiKey : "",
        model: configMode === "custom" ? model : "",
        prompt: prompt.trim(),
        size,
        mode,
        inputImages,
      });

      const item: HistoryItem = {
        base64: result.base64,
        prompt: prompt.trim(),
        model: result.model,
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
      if (wakeLockRef.current) {
        wakeLockRef.current.release().catch(() => undefined);
        wakeLockRef.current = null;
      }
      setBusy(false);
    }
  }, [apiKey, baseUrl, configMode, model, prompt, size, mode, inputImages, session]);

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

  const customConfigInvalid =
    configMode === "custom" &&
    (!baseUrl.trim() || !model.trim() || !apiKey.trim());
  const builtinLocked = configMode === "builtin" && !session?.authenticated;
  const editButtonDisabled =
    busy ||
    (mode === "edit" && inputImages.length === 0) ||
    customConfigInvalid ||
    sessionLoading ||
    builtinLocked;
  const usingDefaultBaseUrl = !baseUrl.trim();
  const usingDefaultModel = !model.trim();
  const hasApiKey = !!apiKey.trim();
  const usingProxy = configMode === "builtin";

  return (
    <main className="wrap">
      <button
        type="button"
        className="theme-toggle"
        onClick={toggleTheme}
        aria-label={dark ? "切换到浅色模式" : "切换到深色模式"}
        title={dark ? "切换到浅色模式" : "切换到深色模式"}
      >
        {dark ? "☀️" : "🌙"}
      </button>

      <h1>🎨 AI 图片生成器</h1>
      <p className="tagline">
        轻松生成或编辑图片，支持参考图与历史记录
      </p>

      <section className="panel">
        <label>配置方式</label>
        <div className="mode-tabs" role="tablist" aria-label="配置方式">
          <button
            type="button"
            role="tab"
            aria-selected={configMode === "builtin"}
            className={`mode-tab${configMode === "builtin" ? " is-active" : ""}`}
            onClick={() => setConfigMode("builtin")}
          >
            内置配置{session?.authenticated ? "" : "（需登录）"}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={configMode === "custom"}
            className={`mode-tab${configMode === "custom" ? " is-active" : ""}`}
            onClick={() => setConfigMode("custom")}
          >
            自定义配置
          </button>
        </div>

        {configMode === "custom" && (
          <div id="advanced-config" className="advanced-config">
            <div className="grid-2">
              <div>
                <label htmlFor="f-base">Base URL</label>
                <input
                  id="f-base"
                  type="text"
                  placeholder="例如：https://api.openai.com/v1"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="f-model">Model</label>
                <input
                  id="f-model"
                  type="text"
                  placeholder="例如：gpt-image-2"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                />
              </div>
            </div>

            <label htmlFor="f-key">API Key</label>
            <input
              id="f-key"
              type="password"
              placeholder="请输入 API Key（必填）"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </div>
        )}
        {configMode === "builtin" && (
          <div className="auth-card">
            {sessionLoading ? (
              <p className="config-notice">正在检查登录状态...</p>
            ) : session?.authenticated && session.user ? (
              <>
                <div className="auth-summary">
                  <div className="auth-user">
                    {session.user.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={session.user.image}
                        alt={session.user.name}
                        className="auth-avatar"
                      />
                    ) : (
                      <div className="auth-avatar auth-avatar-fallback">
                        {session.user.name.slice(0, 1).toUpperCase()}
                      </div>
                    )}
                    <div>
                      <p className="auth-name">{session.user.name}</p>
                      <p className="auth-meta">
                        {session.user.provider === "github" ? "GitHub" : "Google"}
                        {session.user.email ? ` · ${session.user.email}` : ""}
                      </p>
                    </div>
                  </div>
                  <a
                    className="btn-ghost auth-link"
                    href="/api/auth/logout?redirectTo=/"
                  >
                    退出登录
                  </a>
                </div>
                <p className="config-notice">
                  已登录，可以直接使用内置配置。生成和查询任务会自动携带登录会话。
                </p>
              </>
            ) : (
              <>
                <p className="config-notice">
                  内置配置依赖站点服务端能力，当前只对已登录用户开放。使用 GitHub 或
                  Google 登录后即可使用，登录有效期为 7 天。
                </p>
                <div className="auth-actions">
                  <a
                    className="btn-ghost auth-link"
                    href="/api/auth/login/github?redirectTo=/"
                  >
                    使用 GitHub 登录
                  </a>
                  <a
                    className="btn-ghost auth-link"
                    href="/api/auth/login/google?redirectTo=/"
                  >
                    使用 Google 登录
                  </a>
                </div>
              </>
            )}
          </div>
        )}
        {customConfigInvalid && (
          <p className="config-notice">请完整填写 Base URL、Model 和 API Key。</p>
        )}

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
        <div className={`prompt-wrap${promptExpanded ? " is-expanded" : ""}`}>
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
            type="button"
            className="prompt-expand"
            onClick={() => setPromptExpanded((v) => !v)}
            aria-label={promptExpanded ? "缩小输入框" : "放大输入框"}
          >
            {promptExpanded ? "⤡" : "⤢"}
          </button>
        </div>

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
        支持直连或免配置两种方式 · 历史记录仅保存在当前浏览器 · 可随时下载与复用提示词
        <a
          className="github-link"
          href="https://github.com/dming519/ai-image-generator-next"
          target="_blank"
          rel="noreferrer"
          aria-label="查看 GitHub 仓库"
          title="查看 GitHub 仓库"
        >
          <svg
            viewBox="0 0 24 24"
            width="18"
            height="18"
            aria-hidden="true"
            fill="currentColor"
          >
            <path d="M12 2C6.477 2 2 6.589 2 12.248c0 4.526 2.865 8.365 6.839 9.72.5.096.682-.221.682-.492 0-.243-.008-.888-.013-1.742-2.782.615-3.369-1.37-3.369-1.37-.455-1.184-1.11-1.499-1.11-1.499-.908-.637.069-.624.069-.624 1.004.072 1.532 1.053 1.532 1.053.892 1.568 2.341 1.115 2.91.852.091-.664.349-1.116.635-1.373-2.221-.259-4.556-1.14-4.556-5.073 0-1.121.39-2.038 1.029-2.756-.103-.26-.446-1.306.098-2.723 0 0 .84-.276 2.75 1.053A9.303 9.303 0 0 1 12 6.836c.85.004 1.706.118 2.504.347 1.909-1.329 2.748-1.053 2.748-1.053.546 1.417.203 2.463.1 2.723.64.718 1.028 1.635 1.028 2.756 0 3.943-2.339 4.811-4.566 5.066.359.318.678.946.678 1.906 0 1.376-.012 2.485-.012 2.822 0 .273.18.592.688.491C19.138 20.61 22 16.772 22 12.248 22 6.589 17.523 2 12 2Z" />
          </svg>
        </a>
      </footer>

      <Lightbox
        item={lightboxIdx !== null ? history[lightboxIdx] ?? null : null}
        onClose={() => setLightboxIdx(null)}
      />
    </main>
  );
}
