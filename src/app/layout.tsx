import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, DM_Sans } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { ServiceWorkerRegistration } from "@/components/service-worker-registration";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  weight: "600",
  subsets: ["latin"],
  display: "swap",
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#050505",
};

export const metadata: Metadata = {
  metadataBase: new URL("https://focusmap-official.com"),
  applicationName: "Focusmap",
  title: {
    default: "Focusmap",
    template: "%s | Focusmap",
  },
  description:
    "タスク、メモ、Google カレンダーの予定をひとつの画面で整理し、AIの提案を確認しながら日々の予定作成と調整を進めるためのWebアプリです。",
  manifest: "/site.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/focusmap-icon.svg", type: "image/svg+xml" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  openGraph: {
    title: "Focusmap",
    description:
      "タスク、メモ、Google カレンダーの予定をひとつの画面で整理し、AIの提案を確認しながら日々の予定作成と調整を進めるためのWebアプリです。",
    url: "https://focusmap-official.com",
    siteName: "Focusmap",
    images: [{ url: "/icon-512.png", width: 512, height: 512, alt: "Focusmap" }],
    locale: "ja_JP",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Focusmap",
    description:
      "タスク、メモ、Google カレンダーの予定をひとつの画面で整理し、AIの提案を確認しながら日々の予定作成と調整を進めるためのWebアプリです。",
    images: ["/icon-512.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" className="dark" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${dmSans.variable} antialiased`}
        suppressHydrationWarning
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          <ServiceWorkerRegistration />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
