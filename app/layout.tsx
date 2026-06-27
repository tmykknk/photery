import type { Metadata } from "next";
import { Cormorant_Garamond, Courier_Prime } from "next/font/google";
import "@fontsource-variable/google-sans-flex";
import "./globals.css";

const courierPrime = Courier_Prime({
  subsets: ["latin"],
  variable: "--font-courier-prime",
  display: "swap",
  weight: ["400", "700"],
});

const cormorant = Cormorant_Garamond({
  subsets: ["latin"],
  variable: "--font-cormorant",
  display: "swap",
  weight: ["500", "600"],
});

export const metadata: Metadata = {
  title: "Photery",
  description:
    "A private Google Drive photo gallery with a calm masonry layout.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ja"
      className={`${courierPrime.variable} ${cormorant.variable} h-full
        antialiased`}
    >
      <body className="flex min-h-full flex-col" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
