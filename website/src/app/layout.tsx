import type { Metadata } from "next";
import { Fraunces, Manrope } from "next/font/google";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import "./globals.css";

const bodyFont = Manrope({
  subsets: ["latin"],
  variable: "--font-body",
});

const displayFont = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://netzero.international"),
  title: {
    default: "Net Zero International",
    template: "%s | Net Zero International",
  },
  description:
    "A future-proof marketing site for Net Zero International, designed for AI search, structured content, and dynamic data.",
  openGraph: {
    title: "Net Zero International",
    description:
      "A future-proof marketing site for Net Zero International, designed for AI search, structured content, and dynamic data.",
    url: "https://netzero.international",
    siteName: "Net Zero International",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${bodyFont.variable} ${displayFont.variable}`}>
        <SiteHeader />
        <main>{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
