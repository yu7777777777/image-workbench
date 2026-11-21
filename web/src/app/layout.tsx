import type { Metadata, Viewport } from "next";
import { Toaster } from "sonner";
import "./globals.css";
import { ThemeScript } from "@/components/theme-script";
import { TopNav } from "@/components/top-nav";
import { PersistentImageWorkspace } from "@/components/persistent-image-workspace";

export const metadata: Metadata = {
  title: "AI 创作平台",
  description: "AI 图像创作与多模型画廊工作台",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f0ebe3" },
    { media: "(prefers-color-scheme: dark)", color: "#12110f" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body
        className="antialiased"
        style={{
          fontFamily:
            '"SF Pro Display","SF Pro Text","PingFang SC","Microsoft YaHei","Helvetica Neue",sans-serif',
        }}
      >
        <Toaster position="top-center" richColors offset={48} />
        <main className="app-shell min-h-screen overflow-x-hidden bg-[radial-gradient(circle_at_top_left,_rgba(255,255,255,0.92),_rgba(245,239,231,0.96)_42%,_rgba(240,235,227,0.99)_100%)] text-stone-900 transition-colors duration-300 dark:bg-[radial-gradient(circle_at_top_left,_rgba(55,48,43,0.72),_rgba(28,25,23,0.98)_40%,_rgba(12,10,9,1)_100%)] dark:text-stone-100">
          <div className="app-shell-inner flex min-h-screen w-full flex-col pt-[env(safe-area-inset-top)] sm:pt-0">
            <div className="app-nav-wrap mx-auto w-full max-w-[1440px] px-4 pt-0 sm:px-6 sm:pt-2 lg:px-8">
              <TopNav />
            </div>
            <PersistentImageWorkspace />
            <div className="app-content mx-auto w-full max-w-[1440px] px-4 pb-2 sm:px-6 lg:px-8">
              {children}
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}
