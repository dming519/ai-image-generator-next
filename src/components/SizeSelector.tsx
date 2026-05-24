"use client";

import type { ImageSize } from "@/lib/types";
import ParamHoverSelect from "./ParamHoverSelect";

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
    <ParamHoverSelect
      title="选择图片尺寸"
      value={value}
      options={SIZES}
      onChange={(next) => onChange(next as ImageSize)}
    />
  );
}
