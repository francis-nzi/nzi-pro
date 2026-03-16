import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { MainNav } from "@/components/MainNav";
import { AuthBootstrap } from "@/components/AuthBootstrap";
import { ThemeProvider } from "@/components/ThemeProvider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "NZI Pro - Carbon Reporting Platform",
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
          <AuthBootstrap />
          <MainNav />
          <main className="flex-1">{children}</main>
          <footer className="border-t bg-background">
            <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 px-6 py-4 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between">
              <div>Copyright Net Zero International</div>
              <div className="flex flex-wrap gap-4">
                <Link href="/support/legal#standard-terms" className="hover:text-foreground">Terms</Link>
                <Link href="/support/legal#portal-terms" className="hover:text-foreground">Portal Terms</Link>
                <Link href="/support/legal#privacy-policy" className="hover:text-foreground">Privacy</Link>
                <Link href="/support/legal#cookie-notice" className="hover:text-foreground">Cookies</Link>
              </div>
            </div>
          </footer>
        </ThemeProvider>
      </body>
    </html>
  );
}
