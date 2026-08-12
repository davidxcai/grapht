'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useUser } from '@clerk/nextjs';
import { Check, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Stepper,
  StepperContent,
  StepperIndicator,
  StepperItem,
  StepperNav,
  StepperPanel,
  StepperSeparator,
  StepperTitle,
  StepperTrigger,
} from '@/src/components/reui/stepper';
import { saveProfileDetails } from '@/app/profile/actions';
import { checkAvatarFile } from '@/lib/avatar';
import { PROFILE_VISIBILITIES, SKIN_TYPES, type ProfileVisibility, type SkinType } from '@/lib/profile';
import { cn } from '@/lib/utils';

const TOTAL_STEPS = 4;
const STEP_TITLES = ['Name', 'Photo', 'Handle', 'Skin'];

const USERNAME_RE = /^[a-z0-9](?:[a-z0-9_-]{1,22}[a-z0-9])?$/i;

const SKIN_TYPE_OPTIONS: { id: SkinType; label: string; description: string }[] = [
  { id: 'oily', label: 'Oily', description: 'Shine by midday' },
  { id: 'dry', label: 'Dry', description: 'Tight, flaky patches' },
  { id: 'combination', label: 'Combination', description: 'Oily T-zone, dry cheeks' },
  { id: 'normal', label: 'Normal', description: 'Balanced, few concerns' },
  { id: 'sensitive', label: 'Sensitive', description: 'Reacts easily, redness or stinging' },
];

const VISIBILITY_OPTIONS: { id: ProfileVisibility; label: string; description: string }[] = [
  { id: 'public', label: 'Public', description: 'Shown on trials and comments you publish' },
  { id: 'private', label: 'Private', description: 'Hidden from search and community pages' },
];

function PressCard({
  selected,
  onClick,
  title,
  description,
  className,
}: {
  selected: boolean;
  onClick: () => void;
  title: string;
  description: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        'flex flex-col gap-0.5 rounded-xl border p-3 text-left transition-colors',
        'focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
        selected ? 'border-primary bg-primary/10' : 'border-input hover:bg-slate-100/50',
        className,
      )}
    >
      <span className={cn('text-sm font-semibold', selected && 'text-primary')}>{title}</span>
      <span className="text-xs text-muted-foreground">{description}</span>
    </button>
  );
}

/**
 * The last step of sign-up, split into digestible steps rather than one flat
 * form (docs/app-ui.md §2, §3 — no clinical framing, but also no wall of
 * inputs on somebody's first screen).
 *
 * Google gives a name through Clerk; it does not give a birthday — no OAuth
 * scope this app requests carries one — so that field always starts empty,
 * name-prefill or not.
 */
export function OnboardingStepper() {
  const { user, isLoaded } = useUser();
  const fileInput = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState(1);
  const [maxReached, setMaxReached] = useState(1);
  const [prefilled, setPrefilled] = useState(false);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [birthday, setBirthday] = useState('');

  const [avatar, setAvatar] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const [username, setUsername] = useState('');
  const [visibility, setVisibility] = useState<ProfileVisibility>('public');
  const [skinType, setSkinType] = useState<SkinType | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, startSaving] = useTransition();

  useEffect(() => {
    if (isLoaded && user && !prefilled) {
      setFirstName(user.firstName ?? '');
      setLastName(user.lastName ?? '');
      setPrefilled(true);
    }
  }, [isLoaded, user, prefilled]);

  const shownAvatar = preview ?? (user?.hasImage ? user.imageUrl : null);

  function pickAvatar(file: File | null) {
    setError(null);
    if (!file) return;

    const invalid = checkAvatarFile(file);
    if (invalid) {
      setError(invalid);
      return;
    }

    setAvatar(file);
    setPreview(URL.createObjectURL(file));
  }

  function stepValid(n: number): boolean {
    if (n === 1) {
      return (
        firstName.trim().length > 0 &&
        lastName.trim().length > 0 &&
        Boolean(birthday) &&
        new Date(birthday) <= new Date()
      );
    }
    if (n === 3) return USERNAME_RE.test(username.trim());
    if (n === 4) return Boolean(skinType);
    return true;
  }

  function goNext() {
    if (!stepValid(step)) return;
    setError(null);
    if (step < TOTAL_STEPS) {
      const next = step + 1;
      setStep(next);
      setMaxReached((m) => Math.max(m, next));
      return;
    }
    finish();
  }

  function goBack() {
    if (step > 1) setStep(step - 1);
  }

  function finish() {
    setError(null);
    if (!skinType) return;

    startSaving(async () => {
      if (avatar && user) {
        try {
          await user.setProfileImage({ file: avatar });
        } catch (cause) {
          setError(`Your picture could not be uploaded — ${(cause as Error).message}`);
          return;
        }
      }

      if (user && (firstName.trim() !== (user.firstName ?? '') || lastName.trim() !== (user.lastName ?? ''))) {
        try {
          await user.update({ firstName: firstName.trim(), lastName: lastName.trim() });
        } catch (cause) {
          setError(`Your name could not be saved — ${(cause as Error).message}`);
          return;
        }
      }

      const result = await saveProfileDetails({ username, skinType, birthday, visibility });
      if (!result.ok) {
        setError(result.error);
        return;
      }

      setDone(true);
    });
  }

  if (done) {
    return (
      <div className="py-8 text-center">
        <div className="mx-auto mb-5 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Check className="size-6" aria-hidden />
        </div>
        <h1 className="text-xl font-semibold tracking-tight">You&rsquo;re all set</h1>
        <p className="mt-1 text-sm text-muted-foreground">Start a trial whenever you&rsquo;re ready.</p>
        <Button
          size="lg"
          className="mt-7 w-full"
          onClick={() => {
            /** A full load, not `router.push` — the navbar reads the session
             *  and the profile on the server. */
            window.location.href = '/dashboard';
          }}
        >
          Done
        </Button>
      </div>
    );
  }

  const nextLabel =
    step === 2 && !avatar ? 'Skip for now' : step === TOTAL_STEPS ? 'Finish' : 'Next';

  return (
    <Stepper
      value={step}
      onValueChange={(n) => {
        if (n <= maxReached && n < step) setStep(n);
      }}
      indicators={{ completed: <Check className="size-3.5" aria-hidden /> }}
      className="space-y-8"
    >
      <StepperNav aria-label="Onboarding progress">
        {STEP_TITLES.map((title, i) => {
          const n = i + 1;
          return (
            <StepperItem key={title} step={n}>
              <StepperTrigger>
                <StepperIndicator>{n}</StepperIndicator>
                <StepperTitle>{title}</StepperTitle>
              </StepperTrigger>
              {i < STEP_TITLES.length - 1 && <StepperSeparator />}
            </StepperItem>
          );
        })}
      </StepperNav>

      <StepperPanel>
        <StepperContent value={1} className="space-y-5">
          <h1 className="text-xl font-semibold tracking-tight">Tell us about yourself</h1>

          <div className="flex gap-3">
            <div className="flex flex-1 flex-col gap-2">
              <Label htmlFor="first-name">First name</Label>
              <Input
                id="first-name"
                autoComplete="given-name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
              />
            </div>
            <div className="flex flex-1 flex-col gap-2">
              <Label htmlFor="last-name">Last name</Label>
              <Input
                id="last-name"
                autoComplete="family-name"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="birthday">Birthday</Label>
            <Input
              id="birthday"
              type="date"
              max={new Date().toISOString().slice(0, 10)}
              value={birthday}
              onChange={(e) => setBirthday(e.target.value)}
            />
          </div>

          <p className="text-xs text-muted-foreground">You can change this at anytime.</p>
        </StepperContent>

        <StepperContent value={2} className="space-y-5">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Add a picture</h1>
            <p className="mt-1 text-sm text-muted-foreground">Optional</p>
          </div>

          <div className="flex items-center gap-4">
            {shownAvatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={shownAvatar}
                alt=""
                className="size-16 rounded-full object-cover"
                width={64}
                height={64}
              />
            ) : (
              <div className="size-16 rounded-full border border-dashed" />
            )}

            <Button type="button" variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
              {shownAvatar ? 'Change picture' : 'Add a picture'}
            </Button>

            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(e) => pickAvatar(e.target.files?.[0] ?? null)}
            />
          </div>
        </StepperContent>

        <StepperContent value={3} className="space-y-5">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Pick a username</h1>
            <p className="mt-1 text-sm text-muted-foreground">This is how everyone will see you</p>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="username">Username</Label>
            <Input
              id="username"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">You can change this at anytime.</p>
          </div>

          <div className="flex flex-col gap-2">
            <Label>Profile visibility</Label>
            <div className="grid grid-cols-2 gap-2">
              {VISIBILITY_OPTIONS.map((option) => (
                <PressCard
                  key={option.id}
                  selected={visibility === option.id}
                  onClick={() => setVisibility(option.id)}
                  title={option.label}
                  description={option.description}
                />
              ))}
            </div>
          </div>
        </StepperContent>

        <StepperContent value={4} className="space-y-5">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">A little about your skin</h1>
            <p className="mt-1 text-sm text-muted-foreground">Used to frame your results</p>
          </div>

          <div className="flex flex-col gap-2">
            <Label>Skin type</Label>
            <div className="grid grid-cols-2 gap-2">
              {SKIN_TYPE_OPTIONS.map((option) => (
                <PressCard
                  key={option.id}
                  selected={skinType === option.id}
                  onClick={() => setSkinType(option.id)}
                  title={option.label}
                  description={option.description}
                  className={option.id === 'sensitive' ? 'col-span-2' : undefined}
                />
              ))}
            </div>
          </div>
        </StepperContent>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="mt-7 flex gap-3">
          {step > 1 && (
            <Button type="button" variant="outline" onClick={goBack} disabled={busy}>
              Back
            </Button>
          )}
          <Button type="button" className="flex-1" onClick={goNext} disabled={!stepValid(step) || busy}>
            {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {nextLabel}
          </Button>
        </div>
      </StepperPanel>
    </Stepper>
  );
}
