"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { generateImage } from "@/lib/api";
import { dbAdd, dbAll, dbClear, dbDel } from "@/lib/db";
import type { AuthSession, HistoryItem, ImageMode, ImageSize } from "@/lib/types";
import { usePersistentInput } from "@/hooks/usePersistentInput";
import HistoryGrid from "./HistoryGrid";
import Lightbox from "./Lightbox";
import ParamHoverSelect from "./ParamHoverSelect";
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
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const savedDark = localStorage.getItem("imggen_theme") === "dark";
    setDark(savedDark);
    document.documentElement.setAttribute("data-theme", savedDark ? "dark" : "light");
  }, []);

  const toggle = useCallback(() => {
    setDark((prev) => {
      const next = !prev;
      localStorage.setItem("imggen_theme", next ? "dark" : "light");
      document.documentElement.setAttribute("data-theme", next ? "dark" : "light");
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
  const [authPopoverOpen, setAuthPopoverOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null);
  const authPopoverRef = useRef<HTMLDivElement | null>(null);

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
    if (!authPopoverOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (!authPopoverRef.current?.contains(target)) {
        setAuthPopoverOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setAuthPopoverOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [authPopoverOpen]);

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
  const authLabel = session?.authenticated
    ? `${session.user?.name || "已登录用户"} 账户菜单`
    : "打开登录菜单";
  const configOptions = [
    {
      value: "builtin",
      label: `内置配置${session?.authenticated ? "" : "（需登录）"}`,
    },
    { value: "custom", label: "自定义配置" },
  ];

  return (
    <main className="wrap">
      <div className="top-actions">
        <div className="auth-popover-wrap" ref={authPopoverRef}>
          <button
            type="button"
            className={`auth-toggle${authPopoverOpen ? " is-open" : ""}${session?.authenticated ? " is-authenticated" : " is-guest"}`}
            onClick={() => setAuthPopoverOpen((value) => !value)}
            aria-label={authLabel}
            aria-expanded={authPopoverOpen}
            aria-haspopup="dialog"
            title={session?.authenticated ? session.user?.name || "账户" : "登录"}
          >
            {session?.authenticated && session.user?.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={session.user.image}
                alt={session.user.name}
                className="auth-toggle-avatar"
              />
            ) : (
              <svg
                className="auth-toggle-icon"
                viewBox="0 0 24 24"
                aria-hidden="true"
                fill="none"
              >
                <path
                  d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M4.5 20a7.5 7.5 0 0 1 15 0"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
          </button>

          {authPopoverOpen && (
            <div className="auth-popover" role="dialog" aria-label="登录菜单">
              {sessionLoading ? (
                <p className="auth-popover-note">正在检查登录状态...</p>
              ) : session?.authenticated && session.user ? (
                <>
                  <div className="auth-popover-user">
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
                  <p className="auth-popover-note">
                    已登录，可直接使用内置配置。
                  </p>
                  <a
                    className="btn-ghost auth-link auth-popover-link"
                    href="/api/auth/logout?redirectTo=/"
                  >
                    退出登录
                  </a>
                </>
              ) : (
                <>
                  <p className="auth-popover-note">
                    登录后可使用内置配置，登录有效期为 7 天。
                  </p>
                  <a
                    className="btn-ghost auth-link auth-popover-link"
                    href="/api/auth/login/github?redirectTo=/"
                  >
                    使用 GitHub 登录
                  </a>
                  <a
                    className="btn-ghost auth-link auth-popover-link"
                    href="/api/auth/login/google?redirectTo=/"
                  >
                    使用 Google 登录
                  </a>
                </>
              )}
            </div>
          )}
        </div>

        <button
          type="button"
          className="theme-toggle"
          onClick={toggleTheme}
          aria-label={dark ? "切换到浅色模式" : "切换到深色模式"}
          title={dark ? "切换到浅色模式" : "切换到深色模式"}
        >
          {dark ? "☀️" : "🌙"}
        </button>
      </div>

      <header className="app-header">
        <h1>AI图像生成器</h1>
        <p className="tagline">
          轻松生成或编辑图片，支持参考图与历史记录
        </p>
      </header>

      <div className="workbench">
        <section className="panel control-panel">
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

        <label htmlFor="f-prompt">
          {mode === "edit" ? "编辑指令" : "提示词"}
        </label>
        <div className="prompt-wrap">
          <div
            className="prompt-media-tray"
            aria-label={mode === "edit" ? "源图片" : "参考图片"}
          >
            {inputImages.length === 0 ? (
              <button
                type="button"
                className="prompt-upload-tile"
                onClick={() => fileInputRef.current?.click()}
                aria-label={mode === "edit" ? "上传源图片" : "上传参考图片"}
                title={mode === "edit" ? "上传源图片" : "上传参考图片"}
              >
                +
              </button>
            ) : (
              <>
                {inputImages.map((src, i) => (
                  <div className="prompt-thumb" key={i}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={src} alt={`输入图 ${i + 1}`} />
                    <button
                      type="button"
                      className="prompt-thumb-del"
                      aria-label={`移除输入图 ${i + 1}`}
                      onClick={() => handleRemoveImage(i)}
                    >
                      ×
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="prompt-upload-tile is-compact"
                  onClick={() => fileInputRef.current?.click()}
                  aria-label={mode === "edit" ? "继续上传源图片" : "继续上传参考图片"}
                  title={mode === "edit" ? "继续上传源图片" : "继续上传参考图片"}
                >
                  +
                </button>
                {inputImages.length > 1 && (
                  <button
                    type="button"
                    className="prompt-clear-media"
                    onClick={handleClearImages}
                  >
                    清空
                  </button>
                )}
              </>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => handleSelectFiles(e.target.files)}
          />
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
        </div>

        <div className="param-controls" aria-label="生成参数">
          <SizeSelector value={size} onChange={setSize} />

          <ParamHoverSelect
            title="选择配置方式"
            value={configMode}
            options={configOptions}
            onChange={(next) =>
              setConfigMode(next as "builtin" | "custom")
            }
            className="config-picker"
            keepOpenOnSelect
          >
            {configMode === "custom" && (
              <div className="popover-config">
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
                    placeholder="gpt-image-2"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                  />
                </div>
                <div>
                  <label htmlFor="f-key">API Key</label>
                  <input
                    id="f-key"
                    type="password"
                    placeholder="请输入 API Key"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                  />
                </div>
                {customConfigInvalid && (
                  <p className="popover-config-note">
                    请完整填写 Base URL、Model 和 API Key。
                  </p>
                )}
              </div>
            )}
          </ParamHoverSelect>
        </div>

        {configMode === "builtin" && !session?.authenticated && (
          <p className="config-notice">
            内置配置需要先登录。请点击右上角账户图标，使用 GitHub 或 Google 登录。
          </p>
        )}

        <button
          className="btn-primary"
          type="button"
          onClick={handleGenerate}
          disabled={editButtonDisabled}
        >
          {mode === "edit" ? "🖌️ 开始编辑" : "✨ 生成图片"}
        </button>
        </section>

        <div className="results-column">
          <section className="panel preview-panel">
            <Stage
              item={activeIdx >= 0 ? history[activeIdx] ?? null : null}
              busy={busy}
              error={error}
              onDownload={handleDownload}
              onCopyPrompt={handleCopyPrompt}
              onZoom={handleZoom}
            />
          </section>

          <section className="panel history-panel">
            <HistoryGrid
              history={history}
              activeIdx={activeIdx}
              onSelect={setActiveIdx}
              onDelete={handleDelete}
              onClearAll={handleClearAll}
            />
          </section>
        </div>
      </div>

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
