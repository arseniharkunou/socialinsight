import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Social Insight",
  description: "Discover customer pain points from public web conversations.",
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
