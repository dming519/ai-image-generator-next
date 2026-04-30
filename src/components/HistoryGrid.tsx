"use client";

import type { HistoryItem } from "@/lib/types";

interface HistoryGridProps {
  history: HistoryItem[];
  activeIdx: number;
  onSelect: (idx: number) => void;
  onDelete: (idx: number) => void;
  onClearAll: () => void;
}

const TIME_FMT: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
};

export default function HistoryGrid({
  history,
  activeIdx,
  onSelect,
  onDelete,
  onClearAll,
}: HistoryGridProps) {
  return (
    <>
      <div className="history-bar">
        <h2>
          📚 历史记录
          <span className="history-badge">{history.length} 张</span>
        </h2>
        <button className="btn-danger" type="button" onClick={onClearAll}>
          🗑️ 清空
        </button>
      </div>
      <div className="history-grid">
        {history.length === 0 ? (
          <div className="empty">还没有生成过图片</div>
        ) : (
          history
            .map((item, idx) => ({ item, idx }))
            .reverse()
            .map(({ item, idx }) => {
              const time = new Date(item.timestamp).toLocaleString(
                "zh-CN",
                TIME_FMT,
              );
              const alt = item.prompt.slice(0, 20);
              return (
                <div
                  key={item.id ?? `mem-${idx}-${item.timestamp}`}
                  className={"tile" + (idx === activeIdx ? " is-active" : "")}
                  onClick={() => onSelect(idx)}
                >
                  <span className="tile-no">#{idx + 1}</span>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={"data:image/png;base64," + item.base64}
                    alt={alt}
                    loading="lazy"
                  />
                  <div className="tile-foot">
                    <span>{time}</span>
                    <button
                      className="tile-del"
                      type="button"
                      title="删除"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(idx);
                      }}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              );
            })
        )}
      </div>
    </>
  );
}
