import type { Metadata } from "next";
import "@wix/design-system/styles.global.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Wix AI Business Manager",
  description: "AI business manager for Wix companies",
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
