import { create } from 'zustand';

/**
 * Coordinates the app-wide pop-ups shown after sign-in (permissions, announcements, new tasks) so only one sheet
 * is on screen at a time: two native modals at once misbehave, especially on iOS. Announcements wait until the
 * permission check has finished (`permissionsSettled`) and the permissions sheet is closed. New-task pop-ups
 * wait until no announcement is pending; an announcement arriving while a task sheet is open (`taskOpen`) waits.
 */
export const useOverlayStore = create<{
  permissionsOpen: boolean;
  permissionsSettled: boolean;
  taskOpen: boolean;
  setPermissionsOpen: (open: boolean) => void;
  setPermissionsSettled: (settled: boolean) => void;
  setTaskOpen: (open: boolean) => void;
}>((set) => ({
  permissionsOpen: false,
  permissionsSettled: false,
  taskOpen: false,
  setPermissionsOpen: (permissionsOpen) => set({ permissionsOpen }),
  setPermissionsSettled: (permissionsSettled) => set({ permissionsSettled }),
  setTaskOpen: (taskOpen) => set({ taskOpen }),
}));
