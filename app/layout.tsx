import type { Metadata } from 'next';
import './globals.css';
import { Geist } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { cn } from "@/lib/utils";
import { SiteNav } from "@/components/site-nav";
import { clerkConfigured, getSession } from "@/lib/auth";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

export const metadata: Metadata = {
  title: 'Grapht',
  description: 'Run a real trial on your own skin, and find out what actually changed.',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();

  const document = (
    <html lang="en" className={cn("dark", "font-sans", geist.variable)}>
      <body className="antialiased">
        <SiteNav signedIn={session !== null} />
        {children}
      </body>
    </html>
  );

  /**
   * `ClerkProvider` throws without a publishable key, which would take down the
   * fixture-only demo path along with it. Skipping it leaves the auth screens
   * to render their own "not configured" notice.
   */
  return clerkConfigured ? <ClerkProvider>{document}</ClerkProvider> : document;
}
