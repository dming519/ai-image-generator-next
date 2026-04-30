import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI 图片生成器",
  description: "基于 OpenAI Responses API，在浏览器中直接生成图片",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
