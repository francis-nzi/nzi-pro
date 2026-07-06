import type { Metadata } from "next";
import { Suspense } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "sonner";
import { AuthProvider } from "@/components/AuthContext";
import { AppSidebar } from "@/components/AppSidebar";
import { AuthBootstrap } from "@/components/AuthBootstrap";
import { SiteFooter } from "@/components/SiteFooter";
import { ThemeProvider } from "@/components/ThemeProvider";
import { ConfirmDialogProvider } from "@/components/ConfirmDialogProvider";
import { QueryProvider } from "@/components/QueryProvider";

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
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <AuthProvider>
          <QueryProvider>
          <ThemeProvider>
            <ConfirmDialogProvider>
              <Toaster position="top-right" richColors closeButton />
              <Suspense fallback={null}>
                <AuthBootstrap />
              </Suspense>
              <div className="flex min-h-screen">
                <AppSidebar />
                <div className="flex flex-1 flex-col overflow-x-hidden min-w-0">
                  <main className="flex-1">{children}</main>
                  <div className="print:hidden">
                    <SiteFooter />
                  </div>
                </div>
              </div>
            </ConfirmDialogProvider>
          </ThemeProvider>
          </QueryProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
