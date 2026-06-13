import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AI Code Reviewer",
  description:
    "AI agent that reviews GitHub pull requests using code-aware retrieval and tool use.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      // Intentionally a dark-themed product. Declaring `color-scheme: dark`
      // (not just the `dark` class) tells the browser to render native
      // controls, scrollbars, and form widgets with dark-appropriate contrast,
      // which a bare class does not — addressing the WCAG contrast risk of an
      // undeclared scheme. (A light theme is a product decision, not a bug.)
      style={{ colorScheme: "dark" }}
      className={`${geistSans.variable} ${geistMono.variable} dark h-full antialiased`}
    >
      <body className="min-h-full bg-background text-foreground">{children}</body>
    </html>
  );
}
