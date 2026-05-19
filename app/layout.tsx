import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Operations Shifts",
  description: "Employee shift request and scheduling management",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full bg-[#f8f9fb] text-gray-900 antialiased font-sans">
        {children}
      </body>
    </html>
  );
}
