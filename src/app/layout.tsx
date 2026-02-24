import type { Metadata } from "next";
import "./globals.css";
import { Sidebar } from "@/components/Sidebar";

// Force all pages to render dynamically at runtime (never static at build time).
// Every page fetches live data from Supabase + Instantly — static prerendering
// would timeout waiting for API routes that only exist at runtime.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "AVA GTM Command Center",
  description: "Growth Machine Dashboard - AVA AI",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr">
      <body>
        <Sidebar />
        <main className="ml-56 min-h-screen">{children}</main>
      </body>
    </html>
  );
}
