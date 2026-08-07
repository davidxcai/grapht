'use client';

import { useRef, useState } from 'react';
import { useUser } from '@clerk/nextjs';
import { CalendarIcon, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import { saveProfileDetails } from '@/app/profile/actions';
import { SKIN_TYPES } from '@/lib/profile';

export interface ProfileValues {
  username: string;
  skinType: string;
  birthday: string;
}

const SKIN_TYPE_LABELS: Record<string, string> = {
  oily: 'Oily',
  dry: 'Dry',
  combination: 'Combination',
  normal: 'Normal',
  sensitive: 'Sensitive',
};

/** 4MB. Clerk's own limit is 10MB; this is a small square on a navbar. */
const MAX_AVATAR_BYTES = 4 * 1024 * 1024;

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
 * The §2 fields, on both the last step of sign-up and the profile screen.
 *
 * The avatar is Clerk's — `setProfileImage()` writes it and `user.imageUrl`
 * reads it, so Google accounts arrive with one already and nothing has to be
 * stored twice. It is a plain avatar: it never goes near the analysis pipeline
 * and has no framing or lighting requirement.
 */
export function ProfileForm({
  initial,
  mode,
}: {
  initial?: ProfileValues;
  mode: 'welcome' | 'profile';
}) {
  const { user } = useUser();
  const fileInput = useRef<HTMLInputElement>(null);

  const [username, setUsername] = useState(initial?.username ?? '');
  const [skinType, setSkinType] = useState(initial?.skinType ?? '');
  const [birthday, setBirthday] = useState(initial?.birthday ?? '');
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

    if (!file.type.startsWith('image/')) {
      setError('Pick an image file.');
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      setError('That picture is over 4MB.');
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

    const result = await saveProfileDetails({ username, skinType, birthday });

    if (!result.ok) {
      setError(result.error);
      setBusy(false);
      return;
    }

    if (mode === 'welcome') {
      /** A full load, not `router.push` — the navbar reads the session and the
       *  profile on the server. */
      window.location.href = '/dashboard';
      return;
    }

    setAvatar(null);
    setSaved(true);
    setBusy(false);
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

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {saved && <p className="text-sm text-muted-foreground">Saved.</p>}

      <Button type="submit" size="lg" className="w-full" disabled={busy}>
        {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
        {mode === 'welcome' ? 'Finish' : 'Save'}
      </Button>
    </form>
  );
}
