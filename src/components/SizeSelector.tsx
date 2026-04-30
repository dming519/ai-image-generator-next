"use client";

import type { ImageSize } from "@/lib/types";

const SIZES: { label: string; value: ImageSize }[] = [
  { label: "1024×1024", value: "1024x1024" },
  { label: "1024×1536", value: "1024x1536" },
  { label: "1536×1024", value: "1536x1024" },
  { label: "Auto", value: "auto" },
];

export default function SizeSelector({
  value,
  onChange,
}: {
  value: ImageSize;
  onChange: (v: ImageSize) => void;
}) {
  return (
    <div className="size-row" role="radiogroup" aria-label="图片尺寸">
      {SIZES.map((s) => {
        const active = value === s.value;
        return (
          <button
            key={s.value}
            type="button"
            role="radio"
            aria-checked={active}
            className={"size-chip" + (active ? " is-active" : "")}
            onClick={() => onChange(s.value)}
          >
            {s.label}
          </button>
        );
      })}
    </div>
  );
}
