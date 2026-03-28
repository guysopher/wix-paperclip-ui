import type { Metadata } from "next";
import "@wix/design-system/styles.global.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agents Bay — Backoffice",
  description: "AI Company Control Plane",
  icons: {
    icon: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="ltr">{children}</body>
    </html>
  );
}
