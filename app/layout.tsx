import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "ro-reddit",
  description: "Read-only reader for the top daily posts of a fixed subreddit list.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <div className="inner">
            <Link href="/" style={{ textDecoration: "none", fontWeight: 600 }}>
              ro-reddit
            </Link>
            <span className="muted"> · read-only, top of the last 24 hours</span>
          </div>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
