import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GROWW Options Scanner",
  description:
    "Read-only and paper-trading Indian options opportunity scanner foundation.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
