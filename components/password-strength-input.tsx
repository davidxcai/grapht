'use client';

import { useEffect, useId, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { MIN_ZXCVBN_STRENGTH, scorePassword, type ZxcvbnResult } from '@/lib/password-strength';

const SCORE_LABEL = ['Very weak', 'Weak', 'Fair', 'Good', 'Strong'] as const;
const SCORE_COLOR = [
  'bg-red-500',
  'bg-orange-500',
  'bg-amber-500',
  'bg-green-500',
  'bg-emerald-500',
];

type PasswordStrengthInputProps = {
  id?: string;
  name?: string;
  autoComplete?: string;
  required?: boolean;
  className?: string;
  value: string;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  'aria-invalid'?: boolean;
  /** Fed to zxcvbn so it can penalize a password built from the user's own email etc. */
  userInputs?: (string | number)[];
};

/**
 * A REUI-styled show/hide input with a live strength meter, scored by the
 * same zxcvbn engine and threshold (`MIN_ZXCVBN_STRENGTH`) Clerk itself
 * checks on submit — see `lib/password-strength.ts`. Deliberately not a
 * checklist of character-class rules: this Clerk instance doesn't require
 * uppercase/number/symbol, so a checklist claiming it does would tell the
 * user the wrong thing to fix.
 */
export function PasswordStrengthInput({
  value,
  onChange,
  userInputs,
  className,
  ...props
}: PasswordStrengthInputProps) {
  const descriptionId = useId();
  const [visible, setVisible] = useState(false);
  const [result, setResult] = useState<ZxcvbnResult | null>(null);
  /** The scorer is a lazily-imported chunk, so it can fail to load. */
  const [unscorable, setUnscorable] = useState(false);

  useEffect(() => {
    if (!value) {
      setResult(null);
      setUnscorable(false);
      return;
    }
    let cancelled = false;
    scorePassword(value, userInputs).then(
      (res) => {
        if (cancelled) return;
        setResult(res);
        setUnscorable(false);
      },
      (cause: unknown) => {
        // Not silent, and not reported as weakness: an unscored password is a
        // meter that failed, and calling it "Very weak" would tell the user to
        // fix a password that may be fine. Clerk still scores it on submit.
        console.error('password strength unavailable', cause);
        if (cancelled) return;
        setResult(null);
        setUnscorable(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [value, userInputs]);

  const score = result?.score ?? 0;
  const meetsMinimum = Boolean(result) && score >= MIN_ZXCVBN_STRENGTH;
  const hint = result?.feedback.warning || result?.feedback.suggestions[0];

  return (
    <>
      <div className="relative">
        <Input
          type={visible ? 'text' : 'password'}
          className={cn('pe-9', className)}
          value={value}
          onChange={onChange}
          aria-describedby={value ? descriptionId : undefined}
          {...props}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
          className="absolute inset-y-0 end-0 flex h-full w-9 items-center justify-center text-muted-foreground/80 outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {visible ? (
            <EyeOff className="size-3.5" aria-hidden />
          ) : (
            <Eye className="size-3.5" aria-hidden />
          )}
        </button>
      </div>

      {value && (
        <div id={descriptionId} className="flex flex-col gap-1.5">
          <div
            role="progressbar"
            aria-label="Password strength"
            aria-valuemin={0}
            aria-valuemax={4}
            aria-valuenow={score}
            className="flex gap-1"
          >
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className={cn(
                  'h-1 flex-1 rounded-full transition-colors duration-300',
                  i < score ? SCORE_COLOR[score] : 'bg-border',
                )}
              />
            ))}
          </div>

          <div className="flex items-center justify-between text-xs">
            <span
              className={cn(
                'font-medium',
                meetsMinimum ? 'text-foreground' : 'text-muted-foreground',
              )}
            >
              {unscorable ? 'Strength unavailable' : SCORE_LABEL[score]}
            </span>
            {!meetsMinimum && !unscorable && (
              <span className="text-muted-foreground">Needs to be stronger</span>
            )}
          </div>

          {unscorable ? (
            <p className="text-xs text-muted-foreground">
              The strength meter could not load, so this password is unrated here — it is
              still checked when you submit.
            </p>
          ) : (
            hint && <p className="text-xs text-muted-foreground">{hint}</p>
          )}
        </div>
      )}
    </>
  );
}
