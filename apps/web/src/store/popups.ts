import { useEffect } from 'react';
import { create } from 'zustand';

/**
 * App-wide pop-ups (new announcement, new task) register here while they are on screen so that
 * a lower-priority one waits instead of stacking a second modal on top.
 */
interface PopupState {
  open: string[];
  setOpen: (id: string, open: boolean) => void;
}

export const usePopupStore = create<PopupState>((set) => ({
  open: [],
  setOpen: (id, open) => set((s) => ({ open: open ? (s.open.includes(id) ? s.open : [...s.open, id]) : s.open.filter((x) => x !== id) })),
}));

/** Registers pop-up `id` as showing while `showing` is true. */
export const useRegisterPopup = (id: string, showing: boolean) => {
  const setOpen = usePopupStore((s) => s.setOpen);
  useEffect(() => {
    setOpen(id, showing);
    return () => setOpen(id, false);
  }, [id, showing, setOpen]);
};

/** True while any pop-up other than `id` is showing. */
export const useOtherPopupOpen = (id: string) => usePopupStore((s) => s.open.some((x) => x !== id));
