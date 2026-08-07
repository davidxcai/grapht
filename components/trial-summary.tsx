'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Pencil, Sparkles } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { generateSummary, saveUserReview } from '@/app/trials/actions';
import type { Trial } from '@/lib/trials';

/**
 * The Summary tab of a completed trial: the numbers' narrative, then the
 * user's own words (PRODUCT.md §6 — the numbers themselves live on Progress).
 *
 * The narrative is written by Gemini only when the owner asks, and the gate is
 * applied before the model sees anything (`lib/summary.ts`): a metric inside
 * its wobble is narrated as "no measurable change", never as a small win.
 * Regenerating is allowed — the window is closed, so the numbers it describes
 * cannot drift.
 */

export function TrialSummary({ trial, canEdit }: { trial: Trial; canEdit: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [writing, startWriting] = useTransition();

  const [editingReview, setEditingReview] = useState(false);
  const [reviewDraft, setReviewDraft] = useState('');
  const [savingReview, startSavingReview] = useTransition();

  const summary = trial.summary ?? null;
  const review = trial.userReview ?? null;

  const write = () => {
    setError(null);
    startWriting(async () => {
      const result = await generateSummary(trial.id);
      if (!result.ok) setError(result.error);
      else router.refresh();
    });
  };

  const saveReview = () => {
    setError(null);
    startSavingReview(async () => {
      const result = await saveUserReview(trial.id, reviewDraft);
      if (!result.ok) setError(result.error);
      else {
        setEditingReview(false);
        router.refresh();
      }
    });
  };

  return (
    <div className="space-y-8">
      {/* ---- the narrative ---- */}
      <section>
        <h3 className="text-sm font-medium">What the measurements say</h3>

        {summary ? (
          <>
            <div className="mt-3 space-y-3">
              {summary.text.split(/\n{2,}/).map((paragraph, i) => (
                <p key={i} className="text-sm leading-relaxed">
                  {paragraph}
                </p>
              ))}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Written by {summary.model || 'AI'} from the measurements alone.
            </p>
          </>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            {canEdit
              ? 'No summary written yet.'
              : 'No summary here — the numbers are all on the Progress tab.'}
          </p>
        )}

        {canEdit && (
          <Button className="mt-4" variant="outline" onClick={write} disabled={writing}>
            {writing ? <Loader2 className="animate-spin" aria-hidden /> : <Sparkles aria-hidden />}
            {writing ? 'Writing…' : summary ? 'Rewrite the summary' : 'Write the summary'}
          </Button>
        )}
      </section>

      {/* ---- the user's own words ---- */}
      <section className="border-t pt-6">
        <h3 className="text-sm font-medium">{canEdit ? 'Your words' : 'In their words'}</h3>

        {editingReview ? (
          <div className="mt-3 space-y-2">
            <textarea
              value={reviewDraft}
              onChange={(e) => setReviewDraft(e.target.value)}
              rows={6}
              maxLength={4000}
              placeholder="How it felt, what you'd tell someone considering it, anything the numbers can't say."
              aria-label="Your review"
              className="w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            />
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={saveReview} disabled={savingReview}>
                {savingReview && <Loader2 className="animate-spin" aria-hidden />}
                Save
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={savingReview}
                onClick={() => setEditingReview(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : review ? (
          <div className="mt-3 space-y-3">
            {review.split(/\n{2,}/).map((paragraph, i) => (
              <p key={i} className="text-sm leading-relaxed">
                {paragraph}
              </p>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            {canEdit ? 'Nothing written yet.' : 'They haven’t written anything.'}
          </p>
        )}

        {canEdit && !editingReview && (
          <Button
            variant="ghost"
            size="sm"
            className="mt-3 text-muted-foreground"
            onClick={() => {
              setReviewDraft(review ?? '');
              setEditingReview(true);
            }}
          >
            <Pencil aria-hidden />
            {review ? 'Edit' : 'Write something'}
          </Button>
        )}
      </section>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
