import { createLucideIcon } from 'lucide-react';

/** Clock with a person in front (leave types / time off). Custom icon on lucide's 24px grid. */
export const ClockUser = createLucideIcon('ClockUser', [
  // Clock face, open at the bottom-right where the person stands.
  ['path', { d: 'M15.6 4.8A8.5 8.5 0 1 0 7.6 19.1', key: 'face' }],
  ['path', { d: 'M10 6v4.5l-2.3 2.3', key: 'hands' }],
  ['circle', { cx: '16.5', cy: '10.8', r: '3', key: 'head' }],
  ['path', { d: 'M11 21.5v-1.3a5.5 5.5 0 0 1 11 0v1.3z', key: 'body' }],
]);
