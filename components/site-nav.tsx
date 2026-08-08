'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, X } from 'lucide-react';

import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type NavLink = { href: string; label: string };

/** `/` is the published trials themselves; the daily surface lives at /dashboard. */
const SIGNED_OUT: NavLink[] = [
  { href: '/', label: 'Home' },
  { href: '/login', label: 'Login' },
  { href: '/signup', label: 'Sign up' },
];

const SIGNED_IN: NavLink[] = [
  { href: '/', label: 'Home' },
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/profile', label: 'Profile' },
];

export function SiteNav({ signedIn = false }: { signedIn?: boolean }) {
  const links = signedIn ? SIGNED_IN : SIGNED_OUT;
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => setOpen(false), [pathname]);

  /**
   * `sm:hidden` takes the menu *and* its close button away at 40rem, so an open
   * menu that survives the breakpoint leaves the scroll lock below with nothing
   * left on screen to release it. Match the breakpoint the class uses.
   */
  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 40rem)');
    const sync = () => desktop.matches && setOpen(false);
    sync();
    desktop.addEventListener('change', sync);
    return () => desktop.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);

    /**
     * Locking the page behind the overlay must not move what is under it. The
     * gap is whatever width the scrollbar was occupying — zero on the touch
     * devices this menu is for, non-zero on a narrowed desktop window, and
     * replacing it with padding keeps the layout still either way.
     */
    const { body } = document;
    const gap = window.innerWidth - document.documentElement.clientWidth;
    const previous = { overflow: body.style.overflow, paddingRight: body.style.paddingRight };
    body.style.overflow = 'hidden';
    if (gap > 0) body.style.paddingRight = `${gap}px`;

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      body.style.overflow = previous.overflow;
      body.style.paddingRight = previous.paddingRight;
    };
  }, [open]);

  const isActive = (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href));

  return (
    <>
      <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur">
        <div className="page-width flex h-14 items-center justify-between gap-4 px-5">
          <Link
            href="/"
            className="rounded-sm text-base font-semibold tracking-tight outline-none focus-visible:ring-3 focus-visible:ring-ring/50 flex-shrink-0"
          >
            Grapht
          </Link>

          {/*
            Styled with `buttonVariants` rather than composed into `Button`: a
            nav item is a link, and Base UI's button primitive puts
            `role="button"` on whatever it renders once `nativeButton` is false.
          */}
          <nav className="hidden items-center gap-1 sm:flex ml-auto">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                aria-current={isActive(link.href) ? 'page' : undefined}
                className={cn(
                  buttonVariants({ variant: 'ghost', size: 'sm' }),
                  'text-muted-foreground',
                  isActive(link.href) && 'bg-muted text-foreground',
                )}
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <Button
            variant="ghost"
            size="icon"
            className="sm:hidden flex-shrink-0"
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            aria-controls="site-nav-menu"
            onClick={() => setOpen((v) => !v)}
            nativeButton={true}
          >
            {open ? <X className="size-5" aria-hidden /> : <Menu className="size-5" aria-hidden />}
          </Button>
        </div>
      </header>

      {/*
        Fixed, so it is out of flow and opening it cannot reflow the page. It
        stays mounted and animates opacity rather than mounting on open, which is
        what makes both directions of the transition smooth.
      */}
      <div
        id="site-nav-menu"
        inert={!open}
        className={cn(
          'fixed inset-x-0 top-14 bottom-0 z-40 bg-background/95 backdrop-blur transition-opacity duration-200 ease-out sm:hidden',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      >
        <div className="flex w-full flex-col px-5 py-2">
          <nav className="flex w-full flex-col">
            {links.map((link, i) => (
              <Link
                key={link.href}
                href={link.href}
                aria-current={isActive(link.href) ? 'page' : undefined}
                onClick={() => setOpen(false)}
                className={cn(
                  'rounded-lg px-2 py-3 text-lg font-medium transition-all duration-300 ease-out outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                  isActive(link.href) ? 'text-foreground' : 'text-muted-foreground',
                  open ? 'translate-y-0 opacity-100' : '-translate-y-2 opacity-0',
                )}
                style={{ transitionDelay: open ? `${100 + i * 40}ms` : '0ms' }}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
      </div>
    </>
  );
}
