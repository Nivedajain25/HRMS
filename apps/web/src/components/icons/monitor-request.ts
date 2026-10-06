import { createLucideIcon } from 'lucide-react';

/** Monitor showing a person, an approval tick and a request line (leave requests). Custom icon on lucide's 24px grid. */
export const MonitorRequest = createLucideIcon('MonitorRequest', [
  ['rect', { x: '2', y: '2.5', width: '20', height: '15', rx: '2', key: 'screen' }],
  ['path', { d: 'M12 17.5V21', key: 'neck' }],
  ['path', { d: 'M8 21h8', key: 'base' }],
  ['circle', { cx: '8', cy: '6.8', r: '1.6', key: 'head' }],
  ['path', { d: 'M5.2 11.5a2.8 2.8 0 0 1 5.6 0', key: 'shoulders' }],
  ['path', { d: 'm13.5 8 2 2 3.5-3.5', key: 'tick' }],
  ['path', { d: 'M6 14.2h12', key: 'request' }],
]);
