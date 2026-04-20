import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { MainNav } from "@/components/MainNav";
import { AuthBootstrap } from "@/components/AuthBootstrap";
import { SiteFooter } from "@/components/SiteFooter";
import { ThemeProvider } from "@/components/ThemeProvider";
import { ConfirmDialogProvider } from "@/components/ConfirmDialogProvider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "NZ Insights Pro - Carbon Reporting Platform",
  description: "Professional carbon footprint reporting and net zero planning",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} flex min-h-screen flex-col antialiased`}>
        <ThemeProvider>
          <ConfirmDialogProvider>
            <AuthBootstrap />
            <MainNav />
            <main className="flex-1">{children}</main>
            <SiteFooter />
          </ConfirmDialogProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
