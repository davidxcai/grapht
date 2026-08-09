'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, X } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { postComment, removeComment } from '@/app/community/actions';
import type { TrialComment } from '@/lib/community';

/**
 * The comment section of a public trial. Flat and chronological — no votes and
 * no threads, because discussion is context here, not a scoreboard.
 *
 * The list arrives from the server; this component only writes. A signed-out
 * reader sees the conversation and a sign-in nudge instead of a box.
 */

function when(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function TrialComments({
  trialId,
  comments,
  canComment,
  signedIn,
  isOwner,
}: {
  trialId: string;
  comments: TrialComment[];
  /** False when the owner switched comments off. */
  canComment: boolean;
  signedIn: boolean;
  isOwner: boolean;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const post = () => {
    if (!draft.trim()) return;
    setError(null);
    startTransition(async () => {
      const result = await postComment(trialId, draft);
      if (!result.ok) setError(result.error);
      else {
        setDraft('');
        toast.success('Comment posted');
        router.refresh();
      }
    });
  };

  const remove = (commentId: string) => {
    setError(null);
    startTransition(async () => {
      const result = await removeComment(trialId, commentId);
      if (!result.ok) setError(result.error);
      else {
        toast.success('Comment deleted');
        router.refresh();
      }
    });
  };

  return (
    <section className="mt-10 border-t pt-8">
      <h2 className="text-sm font-medium">
        {comments.length === 0
          ? 'Comments'
          : `Comments (${comments.length})`}
      </h2>

      {comments.length > 0 && (
        <ul className="mt-4 space-y-4">
          {comments.map((comment) => (
            <li key={comment.id} className="group">
              <div className="flex gap-3">
                {comment.avatar ? (
                  <img
                    src={comment.avatar}
                    alt={comment.handle || 'user'}
                    className="size-6 flex-shrink-0 rounded-full"
                  />
                ) : (
                  <div className="size-6 flex-shrink-0 rounded-full bg-muted" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-medium">
                      {comment.handle ? `@${comment.handle}` : 'someone'}
                    </span>
                    <span className="text-xs text-muted-foreground">{when(comment.createdAt)}</span>
                    {(comment.mine || isOwner) && (
                      <button
                        type="button"
                        aria-label="Delete comment"
                        disabled={pending}
                        onClick={() => remove(comment.id)}
                        className="text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
                      >
                        <X className="size-3.5" aria-hidden />
                      </button>
                    )}
                  </div>
                  <p className="mt-0.5 whitespace-pre-line text-sm text-muted-foreground">
                    {comment.body}
                  </p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {!canComment ? (
        comments.length === 0 && (
          <p className="mt-3 text-sm text-muted-foreground">Comments are off for this trial.</p>
        )
      ) : signedIn ? (
        <div className="mt-5 space-y-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={2}
            maxLength={1000}
            placeholder="Say something useful — a question, your own experience with the product…"
            aria-label="Your comment"
            className="w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          />
          <Button size="sm" onClick={post} disabled={pending || !draft.trim()}>
            {pending && <Loader2 className="animate-spin" aria-hidden />}
            Post
          </Button>
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">Log in to join the conversation.</p>
      )}

      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
