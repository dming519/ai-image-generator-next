"use client";

import { useState } from "react";
import type { HistoryItem } from "@/lib/types";

interface StageProps {
  item: HistoryItem | null;
  busy: boolean;
  error: string | null;
  onDownload: () => void;
  onCopyPrompt: () => Promise<void> | void;
  onZoom: () => void;
}

export default function Stage({
  item,
  busy,
  error,
  onDownload,
  onCopyPrompt,
  onZoom,
}: StageProps) {
  const [copied, setCopied] = useState(false);

  if (busy) {
    return (
      <div className="stage">
        <div className="spinner" />
        <div className="loading-hint">正在生成图片，请稍候...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="stage">
        <div className="icon-large">⚠️</div>
        <div className="alert">{error}</div>
      </div>
    );
  }

  if (!item) {
    return (
      <div className="stage">
        <div className="icon-large">🖼️</div>
        <div className="icon-hint">图片将显示在这里</div>
      </div>
    );
  }

  const short =
    item.prompt.length > 60 ? item.prompt.slice(0, 60) + "…" : item.prompt;

  const handleCopy = async () => {
    await onCopyPrompt();
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="stage">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={"data:image/png;base64," + item.base64}
        alt="Generated"
        title="点击查看大图"
        onClick={onZoom}
      />
      <div className="stage-caption">{short}</div>
      <div className="stage-actions">
        <button className="btn-ghost" type="button" onClick={onDownload}>
          💾 下载
        </button>
        <button className="btn-ghost" type="button" onClick={handleCopy}>
          {copied ? "✅ 已复制" : "📋 复制提示词"}
        </button>
        <button className="btn-ghost" type="button" onClick={onZoom}>
          🔍 大图
        </button>
      </div>
    </div>
  );
}
