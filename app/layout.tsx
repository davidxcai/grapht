import type { Metadata } from 'next';
import './globals.css';
import { Geist } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { currentUser } from "@clerk/nextjs/server";
import NextTopLoader from "nextjs-toploader";
import { cn } from "@/lib/utils";
import { SiteNav } from "@/components/site-nav";
import { SiteFooter } from "@/components/site-footer";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/lib/theme-provider";
import { clerkConfigured, getSession } from "@/lib/auth";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

export const metadata: Metadata = {
  title: 'Grapht',
  description: 'Run a real trial on your own skin, and find out what actually changed.',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  const user = session ? await currentUser() : null;

  const document = (
    <html lang="en" suppressHydrationWarning className={cn("font-sans", geist.variable)}>
      <body className="flex min-h-screen flex-col antialiased">
        {/* Navigation progress bar. The colour is the palette's --primary-300,
            which is defined once on :root and so reads the same in both themes. */}
        <NextTopLoader color="var(--primary-300)" height={3} showSpinner={false} shadow={false} />
        <ThemeProvider>
          <SiteNav signedIn={session !== null} avatar={user?.imageUrl} />
          <div className="w-full flex-1">
            <div className="page-width">{children}</div>
          </div>
          <SiteFooter />
          <Toaster />
        </ThemeProvider>
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
