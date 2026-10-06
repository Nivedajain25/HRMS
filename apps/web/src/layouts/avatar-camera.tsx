import { useRef, useState } from 'react';
import { Camera, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { AuthUser } from '@stencil/types';
import { patch, upload } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/auth';

const MAX_MB = 5;

/** Opens a picker, uploads the image as an AVATAR file and sets it as my profile photo. */
export const useChangeAvatar = () => {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const setUser = useAuthStore((s) => s.setUser);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) return void toast.error('Choose an image (JPG, PNG or WebP).');
    if (file.size > MAX_MB * 1024 * 1024) return void toast.error(`The photo is larger than ${MAX_MB} MB.`);
    setBusy(true);
    try {
      const up = await upload<{ _id: string }>('/files', file, { context: 'AVATAR' });
      const res = await patch<AuthUser>('/auth/me/avatar', { fileId: up.data._id });
      setUser(res.data);
      toast.success('Profile photo updated');
    } catch (err) {
      toast.error((err as Error).message || 'Could not update your photo');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  const picker = (
    <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => void onFile(e.target.files?.[0])} aria-hidden tabIndex={-1} />
  );
  return { open: () => input.current?.click(), busy, picker };
};

/** Small camera badge on the header avatar: tap to change your profile photo. */
export const AvatarCameraBadge = ({ onClick, busy, className }: { onClick: () => void; busy: boolean; className?: string }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={busy}
    title="Change profile photo"
    aria-label="Change profile photo"
    className={cn(
      'flex h-5 w-5 items-center justify-center rounded-full bg-brand-600 text-white shadow-sm ring-2 ring-surface transition-transform hover:scale-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:opacity-70',
      className,
    )}
  >
    {busy ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <Camera className="h-3 w-3" aria-hidden />}
  </button>
);
