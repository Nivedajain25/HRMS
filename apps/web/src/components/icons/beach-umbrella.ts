import { createLucideIcon } from 'lucide-react';

/** Beach umbrella over a lounger (holidays). Custom icon drawn on lucide's 24px grid, stroke-based like the rest. */
export const BeachUmbrella = createLucideIcon('BeachUmbrella', [
  ['path', { d: 'M2.5 11A9.5 9.5 0 0 1 19.8 6.3', key: 'canopy' }],
  ['path', { d: 'M2.5 11c1.9-1.8 3.9-2.1 5.7-1.3c1.5-1.9 3.7-2.4 5.7-1.4c1.6-1.5 3.8-2.2 5.9-2', key: 'scallops' }],
  ['path', { d: 'M8.2 9.7C7.5 6.8 8.3 4.2 10.3 2.8', key: 'rib-left' }],
  ['path', { d: 'M13.9 8.3C13.3 5.9 12.1 4 10.6 2.7', key: 'rib-right' }],
  ['path', { d: 'M10.8 8.6 13.4 18', key: 'pole' }],
  ['path', { d: 'M3 18h17', key: 'seat' }],
  ['path', { d: 'm16.2 18 3.6-5.8', key: 'backrest' }],
  ['path', { d: 'M5 18l-1.5 3', key: 'leg-left' }],
  ['path', { d: 'M18 18l1.5 3', key: 'leg-right' }],
]);
