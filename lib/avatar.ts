/**
 * The one rule about a picked avatar, shared by `/welcome` and `/profile`.
 *
 * Both screens set the image on Clerk directly and both refuse the same two
 * files, so the limit and its wording live here rather than being restated —
 * a form that said "over 4MB" while accepting 5 would be a bug the user only
 * hits after uploading.
 */

/** 4MB. Clerk's own limit is 10MB; this is a small square on a navbar. */
export const MAX_AVATAR_BYTES = 4 * 1024 * 1024;

/** The reason to show, or `null` when the file is fine to use. */
export function checkAvatarFile(file: File): string | null {
  if (!file.type.startsWith('image/')) return 'Pick an image file.';
  if (file.size > MAX_AVATAR_BYTES) return 'That picture is over 4MB.';
  return null;
}
