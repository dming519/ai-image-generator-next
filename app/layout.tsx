import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI 图片生成器",
  description: "在线生成和编辑图片，支持参考图、历史记录和一键下载",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("imggen_theme");document.documentElement.setAttribute("data-theme",t==="dark"?"dark":"light")}catch(e){document.documentElement.setAttribute("data-theme","light")}})()`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
