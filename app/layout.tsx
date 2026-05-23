import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI图像生成器",
  description: "在线生成和编辑图片，支持参考图、历史记录和一键下载",
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
