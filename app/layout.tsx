import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Creovanta — Your Voice. Your AI.",
  description: "Create natural AI speech with a voice you own or have permission to use.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
