import { create } from 'zustand';

/**
 * Coordinates the app-wide pop-ups shown after sign-in (permissions, announcements, new tasks) so only one sheet
 * is on screen at a time: two native modals at once misbehave, especially on iOS. Announcements wait until the
 * permission check has finished (`permissionsSettled`) and the permissions sheet is closed. New-task pop-ups
 * wait until no announcement is pending; an announcement arriving while a task sheet is open (`taskOpen`) waits.
 * The "update available" sheet comes last; announcements and tasks arriving while it is open (`updateOpen`) wait.
 */
export const useOverlayStore = create<{
  permissionsOpen: boolean;
  permissionsSettled: boolean;
  taskOpen: boolean;
  updateOpen: boolean;
  setPermissionsOpen: (open: boolean) => void;
  setPermissionsSettled: (settled: boolean) => void;
  setTaskOpen: (open: boolean) => void;
  setUpdateOpen: (open: boolean) => void;
}>((set) => ({
  permissionsOpen: false,
  permissionsSettled: false,
  taskOpen: false,
  updateOpen: false,
  setPermissionsOpen: (permissionsOpen) => set({ permissionsOpen }),
  setPermissionsSettled: (permissionsSettled) => set({ permissionsSettled }),
  setTaskOpen: (taskOpen) => set({ taskOpen }),
  setUpdateOpen: (updateOpen) => set({ updateOpen }),
}));
