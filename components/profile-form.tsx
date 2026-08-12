'use client';

import { useRef, useState } from 'react';
import { useUser } from '@clerk/nextjs';
import { CalendarIcon, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import { ThemeSelector } from '@/components/theme-selector';
import { saveProfileDetails } from '@/app/profile/actions';
import { checkAvatarFile } from '@/lib/avatar';
import { PROFILE_VISIBILITIES, SKIN_TYPES, type ProfileVisibility } from '@/lib/profile';
import { cn } from '@/lib/utils';

export interface ProfileValues {
  username: string;
  skinType: string;
  birthday: string;
  visibility: string;
}

const SKIN_TYPE_LABELS: Record<string, string> = {
  oily: 'Oily',
  dry: 'Dry',
  combination: 'Combination',
  normal: 'Normal',
  sensitive: 'Sensitive',
};

const VISIBILITY_OPTIONS: { id: ProfileVisibility; label: string; description: string }[] = [
  { id: 'public', label: 'Public', description: 'Shown on trials and comments you publish' },
  { id: 'private', label: 'Private', description: 'Hidden from search and community pages' },
];

/** `birthday` is stored as `YYYY-MM-DD`; parse in local time to dodge UTC day-shift. */
function parseIsoDate(value: string): Date | undefined {
  if (!value) return undefined;
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return undefined;
  return new Date(year, month - 1, day);
}

function toIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * The §2 fields, on the profile screen. Sign-up collects the same fields
 * through `OnboardingStepper` instead — one flat form reads as a wall of
 * inputs on somebody's first screen, but is the right shape once there's
 * only ever one thing to change at a time.
 *
 * The avatar is Clerk's — `setProfileImage()` writes it and `user.imageUrl`
 * reads it, so Google accounts arrive with one already and nothing has to be
 * stored twice. It is a plain avatar: it never goes near the analysis pipeline
 * and has no framing or lighting requirement.
 */
export function ProfileForm({ initial }: { initial: ProfileValues }) {
  const { user } = useUser();
  const fileInput = useRef<HTMLInputElement>(null);

  const [username, setUsername] = useState(initial.username);
  const [skinType, setSkinType] = useState(initial.skinType);
  const [birthday, setBirthday] = useState(initial.birthday);
  const [visibility, setVisibility] = useState(initial.visibility);
  const [birthdayOpen, setBirthdayOpen] = useState(false);
  const [avatar, setAvatar] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

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

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    setBusy(true);
    setError(null);
    setSaved(false);

    // The picture first, because it is the failure the form can recover from
    // without losing anything the user typed.
    if (avatar && user) {
      try {
        await user.setProfileImage({ file: avatar });
      } catch (cause) {
        setError(`Your picture could not be uploaded — ${(cause as Error).message}`);
        setBusy(false);
        return;
      }
    }

    const result = await saveProfileDetails({ username, skinType, birthday, visibility });

    if (!result.ok) {
      setError(result.error);
      setBusy(false);
      return;
    }

    setAvatar(null);
    setSaved(true);
    setBusy(false);
    toast.success('Profile updated');
  }

  return (
    <form onSubmit={onSubmit} noValidate className="mt-8 flex flex-col gap-6">
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

        <div className="flex flex-col gap-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => fileInput.current?.click()}
          >
            {shownAvatar ? 'Change picture' : 'Add a picture'}
          </Button>
          <span className="text-xs text-muted-foreground">Optional</span>
        </div>

        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={(e) => pickAvatar(e.target.files?.[0] ?? null)}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="username">Username</Label>
        <Input
          id="username"
          name="username"
          autoComplete="username"
          required
          className="h-10"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label>Profile visibility</Label>
        <div className="grid grid-cols-2 gap-2">
          {VISIBILITY_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={visibility === option.id}
              onClick={() => setVisibility(option.id)}
              className={cn(
                'flex flex-col gap-0.5 rounded-lg border p-3 text-left transition-colors',
                'focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
                visibility === option.id
                  ? 'border-primary bg-primary/10'
                  : 'border-input hover:bg-slate-100/50',
              )}
            >
              <span className={cn('text-sm font-semibold', visibility === option.id && 'text-primary')}>
                {option.label}
              </span>
              <span className="text-xs text-muted-foreground">{option.description}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="skin-type">Skin type</Label>
        <Select value={skinType} onValueChange={(next: unknown) => setSkinType(next as string)}>
          <SelectTrigger id="skin-type" className="w-full">
            <span className={skinType ? undefined : 'text-muted-foreground'}>
              {skinType ? SKIN_TYPE_LABELS[skinType] : 'Pick one'}
            </span>
          </SelectTrigger>
          <SelectContent align="start" alignItemWithTrigger={false}>
            {SKIN_TYPES.map((type) => (
              <SelectItem key={type} value={type}>
                {SKIN_TYPE_LABELS[type]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="birthday">Birthday</Label>
        <Popover open={birthdayOpen} onOpenChange={setBirthdayOpen}>
          <PopoverTrigger
            render={
              <Button
                id="birthday"
                type="button"
                variant="outline"
                className="h-10 w-full justify-start font-normal"
              />
            }
          >
            <CalendarIcon className="size-4 text-muted-foreground" />
            {birthday ? (
              parseIsoDate(birthday)?.toLocaleDateString(undefined, {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })
            ) : (
              <span className="text-muted-foreground">Pick a date</span>
            )}
          </PopoverTrigger>
          <PopoverContent align="start" className="w-auto p-0">
            <Calendar
              mode="single"
              captionLayout="dropdown"
              selected={parseIsoDate(birthday)}
              defaultMonth={parseIsoDate(birthday) ?? new Date(2000, 0, 1)}
              startMonth={new Date(1920, 0, 1)}
              endMonth={new Date()}
              disabled={{ after: new Date() }}
              onSelect={(date) => {
                if (!date) return;
                setBirthday(toIsoDate(date));
                setBirthdayOpen(false);
              }}
            />
          </PopoverContent>
        </Popover>
      </div>

      <ThemeSelector />

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {saved && <p className="text-sm text-muted-foreground">Saved.</p>}

      <Button type="submit" size="lg" className="w-full" disabled={busy}>
        {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
        Save
      </Button>
    </form>
  );
}
