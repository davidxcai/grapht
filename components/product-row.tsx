import Link from 'next/link';

import { Thumbnail } from '@/components/thumbnail';

/**
 * One product, at list-row scale: a small thumbnail and a name, nothing
 * else. Shared by every place that lists a routine's or a trial's products
 * as a plain row — `RoutineSummary`, the Details tab's frozen baseline
 * snapshot (`TrialProducts`), and `TrialCard` — so the row reads the same
 * everywhere instead of drifting the way `Thumbnail`'s own callers once did
 * (see CLAUDE.md).
 *
 * Pass `href` to make the row a link to `/products/[id]`; leave it null for
 * a row that's already nested inside another link (`RoutineCard`, `TrialCard`
 * both wrap themselves in one) — a nested `<a>` is invalid HTML, so those
 * callers keep the row static instead.
 */
export function ProductRow({
  name,
  image = null,
  href = null,
  className,
}: {
  name: string;
  image?: string | null;
  href?: string | null;
  className?: string;
}) {
  const content = (
    <>
      <Thumbnail src={image} size={40} className="size-10 shrink-0 rounded" />
      <p className="truncate text-sm text-muted-foreground">{name}</p>
    </>
  );

  if (href) {
    return (
      <Link href={href} className={`flex min-w-0 items-center gap-2 hover:underline ${className ?? ''}`}>
        {content}
      </Link>
    );
  }

  return <div className={`flex min-w-0 items-center gap-2 ${className ?? ''}`}>{content}</div>;
}
