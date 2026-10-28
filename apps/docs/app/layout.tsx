import { RootProvider } from "fumadocs-ui/provider/next";
import { Geist, Geist_Mono } from "next/font/google";
import type { Metadata, Viewport } from "next";
import { SiteFooter } from "@/components/site-footer";
import brand from "@/lib/brand.json";
import { appName, appTagline } from "@/lib/shared";
import "./global.css";

const geistSans = Geist({ subsets: ["latin"], variable: "--font-geist-sans" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

export const metadata: Metadata = {
  applicationName: appName,
  metadataBase: process.env.SITE_URL ? new URL(process.env.SITE_URL) : undefined,
  title: { default: appName, template: `%s - ${appName}` },
  description: appTagline,
  openGraph: { type: "website", siteName: appName },
  twitter: { card: "summary_large_image" },
  icons: {
    other: {
      rel: "mask-icon",
      url: "/brand/mask-icon.svg",
      color: brand.colors.brand.hex,
    },
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: brand.colors.paper.hex },
    { media: "(prefers-color-scheme: dark)", color: brand.colors.ink.hex },
  ],
};

export default function Layout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} font-sans`}
      suppressHydrationWarning
    >
      <body className="flex min-h-[100dvh] flex-col">
        <RootProvider>
          {children}
          <SiteFooter />
        </RootProvider>
      </body>
    </html>
  );
}
