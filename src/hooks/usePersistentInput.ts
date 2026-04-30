"use client";

import { useEffect, useRef, useState } from "react";

export function usePersistentInput(key: string, initial: string) {
  const [value, setValue] = useState(initial);
  const hydrated = useRef(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(key);
      if (saved !== null) setValue(saved);
    } catch {
      // localStorage 可能在隐私模式下不可用
    }
    hydrated.current = true;
  }, [key]);

  useEffect(() => {
    if (!hydrated.current) return;
    try {
      localStorage.setItem(key, value);
    } catch {
      // 忽略写入失败
    }
  }, [key, value]);

  return [value, setValue] as const;
}
