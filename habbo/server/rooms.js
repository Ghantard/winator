// Definition des salles. Dans `layout`, "0" = sol, "x" = vide.
// Le mobilier est decrit par un type (rendu cote client) et son empreinte.

export const ROOM_DEFS = [
  {
    id: 'hall',
    name: 'Hall d\'accueil',
    door: { x: 0, y: 4 },
    layout: [
      'xxx000000000',
      'xx0000000000',
      '000000000000',
      '000000000000',
      '000000000000',
      '000000000000',
      '000000000000',
      '000000000000',
      '000000000000',
      'xx0000000000',
    ],
    furniture: [
      { type: 'rug', x: 4, y: 3, w: 4, h: 4, color: '#b84a4a' },
      { type: 'table', x: 5, y: 4, w: 2, h: 2, color: '#8a5a33' },
      { type: 'chair', x: 5, y: 3, dir: 4, color: '#3b6ea8' },
      { type: 'chair', x: 6, y: 3, dir: 4, color: '#3b6ea8' },
      { type: 'chair', x: 5, y: 6, dir: 0, color: '#3b6ea8' },
      { type: 'chair', x: 6, y: 6, dir: 0, color: '#3b6ea8' },
      { type: 'plant', x: 3, y: 0 },
      { type: 'plant', x: 11, y: 0 },
      { type: 'plant', x: 11, y: 9 },
      { type: 'sofa', x: 9, y: 0, w: 2, h: 1, dir: 4, color: '#6b4fa0' },
      { type: 'lamp', x: 0, y: 2 },
      { type: 'lamp', x: 0, y: 8 },
    ],
  },
  {
    id: 'cafe',
    name: 'Le Petit Cafe',
    door: { x: 0, y: 3 },
    layout: [
      '0000000000',
      '0000000000',
      '0000000000',
      '0000000000',
      '0000000000',
      '00000xxxxx',
      '00000xxxxx',
      '00000xxxxx',
    ],
    furniture: [
      { type: 'bar', x: 2, y: 0, w: 5, h: 1, color: '#5a3a22' },
      { type: 'plant', x: 9, y: 0 },
      { type: 'table', x: 7, y: 3, w: 1, h: 1, color: '#c9c9c9' },
      { type: 'chair', x: 8, y: 3, dir: 6, color: '#b84a4a' },
      { type: 'chair', x: 7, y: 2, dir: 4, color: '#b84a4a' },
      { type: 'table', x: 2, y: 6, w: 1, h: 1, color: '#c9c9c9' },
      { type: 'chair', x: 3, y: 6, dir: 6, color: '#b84a4a' },
      { type: 'chair', x: 1, y: 6, dir: 2, color: '#b84a4a' },
      { type: 'rug', x: 3, y: 2, w: 3, h: 2, color: '#d9a441' },
      { type: 'lamp', x: 4, y: 7 },
    ],
  },
];

// Types de mobilier qu'on ne peut pas traverser.
export const BLOCKING_TYPES = new Set(['table', 'plant', 'sofa', 'lamp', 'bar']);
// Types sur lesquels on s'assoit en s'arretant dessus.
export const SEAT_TYPES = new Set(['chair']);
