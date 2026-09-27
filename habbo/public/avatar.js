// Generation procedurale des avatars en pixel art, style "hotel isometrique".
// Chaque partie du corps est dessinee pixel par pixel avec un contour plus sombre
// que sa couleur, puis le sprite est mis en cache.
//
// Les sprites sont dessines regardant vers la droite ; les directions vers la
// gauche sont obtenues par symetrie.

import { PALETTES, HAIR_STYLES } from './look.js';

export const SPRITE_W = 36;
export const SPRITE_H = 76;
/** Ligne ou se trouvent les pieds (debout) et les cuisses (assis). */
export const FOOT_Y = 74;
export const SEAT_Y = 58;
export const CENTER_X = 18;

const SHOES = '#2f2f35';
const WHITE = '#ffffff';
const PUPIL = '#1c1c22';

// Vue a utiliser pour chaque direction (0..7) et si elle est inversee.
const VIEWS = [
  ['back34', false], // 0 haut-droite
  ['side', false], //   1 droite
  ['front34', false], // 2 bas-droite
  ['front', false], //  3 bas
  ['front34', true], // 4 bas-gauche
  ['side', true], //    5 gauche
  ['back34', true], //  6 haut-gauche
  ['back', false], //   7 haut
];

const cache = new Map();

function tone(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const f = (c) => Math.max(0, Math.min(255, Math.round(c * (1 + amount))));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

function makeCanvas() {
  const c = document.createElement('canvas');
  c.width = SPRITE_W;
  c.height = SPRITE_H;
  return c;
}

/**
 * Dessine une partie : `rects` = [x, y, w, h, couleur?]. Le contour (4-voisins)
 * est trace autour de l'union des rectangles, avec une teinte sombre de `color`.
 */
function makePainter(ctx) {
  return function part(rects, color, outline = true) {
    if (outline) {
      const mask = new Set();
      for (const [x, y, w, h] of rects) {
        for (let i = x; i < x + w; i++) for (let j = y; j < y + h; j++) mask.add(j * SPRITE_W + i);
      }
      ctx.fillStyle = tone(color, -0.55);
      for (const k of mask) {
        const x = k % SPRITE_W;
        const y = (k - x) / SPRITE_W;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= SPRITE_W || ny >= SPRITE_H) continue;
          if (!mask.has(ny * SPRITE_W + nx)) ctx.fillRect(nx, ny, 1, 1);
        }
      }
    }
    for (const [x, y, w, h, c] of rects) {
      ctx.fillStyle = c ?? color;
      ctx.fillRect(x, y, w, h);
    }
  };
}

// ---------- Cheveux ----------

function hairRects(style, view) {
  const spikes = (dx) => [[9 + dx, 6, 3, 4], [13 + dx, 4, 3, 6], [17 + dx, 3, 3, 7], [21 + dx, 4, 3, 6], [25 + dx, 6, 2, 4]];
  switch (view) {
    case 'front':
      if (style === 'court' || style === 'long') {
        const r = [[8, 8, 20, 6], [9, 6, 18, 2], [8, 14, 3, 6], [25, 14, 3, 5], [11, 14, 5, 2], [16, 14, 4, 1], [20, 14, 5, 2]];
        if (style === 'long') r.push([6, 14, 4, 20], [26, 14, 4, 20]);
        return r;
      }
      if (style === 'herisse') return [[8, 10, 20, 5], [8, 15, 2, 4], [26, 15, 2, 4], ...spikes(0)];
      return [];
    case 'front34':
      if (style === 'court' || style === 'long') {
        const r = [[10, 8, 18, 6], [11, 6, 16, 2], [9, 12, 5, 6], [15, 14, 6, 2], [21, 14, 4, 1], [25, 14, 2, 3]];
        if (style === 'long') r.push([8, 12, 7, 22]);
        return r;
      }
      if (style === 'herisse') return [[10, 10, 18, 5], [9, 13, 4, 5], ...spikes(0)];
      return [];
    case 'side':
      if (style === 'court' || style === 'long') {
        const r = [[9, 8, 18, 6], [10, 6, 16, 2], [8, 12, 6, 10], [20, 14, 6, 2]];
        if (style === 'long') r.push([7, 12, 7, 22]);
        return r;
      }
      if (style === 'herisse') return [[9, 10, 18, 5], [8, 13, 6, 6], ...spikes(-1)];
      return [];
    case 'back34':
      if (style === 'chauve') return [];
      if (style === 'herisse') return [[10, 10, 17, 6], [9, 16, 15, 4], ...spikes(0)];
      return style === 'long'
        ? [[10, 6, 17, 4], [9, 10, 17, 18], [8, 14, 18, 20]]
        : [[10, 6, 17, 4], [9, 10, 17, 18], [10, 28, 14, 2]];
    case 'back':
      if (style === 'chauve') return [];
      if (style === 'herisse') return [[8, 10, 20, 8], [9, 18, 18, 4], ...spikes(0)];
      return style === 'long'
        ? [[9, 6, 18, 4], [8, 10, 20, 18], [7, 14, 22, 20]]
        : [[9, 6, 18, 4], [8, 10, 20, 16], [9, 26, 18, 3]];
    default:
      return [];
  }
}

// ---------- Corps ----------

function drawBody(ctx, look, view, { frame, sitting, talking, blinking }) {
  const part = makePainter(ctx);
  const skin = PALETTES.skin[look.skin];
  const hair = PALETTES.hair[look.hair];
  const shirt = PALETTES.shirt[look.shirt];
  const pants = PALETTES.pants[look.pants];
  const style = HAIR_STYLES[look.hairStyle].id;
  const skinDark = tone(skin, -0.12);
  const shirtDark = tone(shirt, -0.18);
  const pantsDark = tone(pants, -0.2);

  const frontal = view === 'front' || view === 'back';
  const stride = [0, 3, 0, -3][frame];
  const lift = [0, 2, 0, 2][frame];
  const swing = [0, -1, 0, 1][frame];

  // Jambes et chaussures.
  if (frontal) {
    const liftL = frame === 1 ? lift : 0;
    const liftR = frame === 3 ? lift : 0;
    if (sitting) {
      part([[11, 52, 6, 8], [19, 52, 6, 8]], pants);
      part([[10, 60, 7, 4], [19, 60, 7, 4]], SHOES);
    } else {
      part([[11, 52, 6, 18 - liftL], [19, 52, 6, 18 - liftR], [23, 52, 2, 18 - liftR, pantsDark]], pants);
      part([[10, 70 - liftL, 7, 4]], SHOES);
      part([[19, 70 - liftR, 7, 4]], SHOES);
    }
  } else if (view === 'side') {
    if (sitting) {
      part([[14, 52, 11, 6], [20, 56, 5, 6]], pants);
      part([[20, 62, 8, 3]], SHOES);
    } else {
      part([[14 - stride, 52, 7, 18, pantsDark]], pants);
      part([[14 - stride, 70, 9, 4]], SHOES);
      part([[14 + stride, 52, 7, 18]], pants);
      part([[14 + stride, 70 - (stride ? 1 : 0), 9, 4]], SHOES);
    }
  } else {
    // Vues de trois-quarts : jambe eloignee (a droite) puis jambe proche.
    if (sitting) {
      part([[12, 52, 12, 6], [19, 52, 6, 10]], pants);
      part([[19, 62, 8, 3]], SHOES);
    } else {
      part([[18 - stride, 52, 6, 18, pantsDark]], pants);
      part([[18 - stride, 70, 8, 4]], SHOES);
      part([[12 + stride, 52, 6, 18]], pants);
      part([[12 + stride, 70 - (stride ? 1 : 0), 8, 4]], SHOES);
    }
  }

  // Bras eloigne (derriere le torse) pour les vues de profil et 3/4.
  if (view === 'front34' || view === 'back34') {
    part([[24, 33, 3, 8]], shirtDark);
    part([[24, 41 - swing, 3, 9]], skinDark);
  }

  // Cou et torse.
  part([[15, 27, 6, 6]], skin);
  if (frontal) {
    const armY = (side) => (frame === 0 || frame === 2 ? 0 : side * (frame === 1 ? 1 : -1));
    part([[6, 33 + armY(1), 4, 8]], shirt);
    part([[6, 41 + armY(1), 4, 9]], skin);
    part([[26, 33 + armY(-1), 4, 8]], shirt);
    part([[26, 41 + armY(-1), 4, 9]], skin);
    part([[10, 32, 16, 21], [23, 32, 3, 21, shirtDark]], shirt);
    if (view === 'front') {
      ctx.fillStyle = skin;
      ctx.fillRect(16, 32, 4, 2);
    }
  } else if (view === 'side') {
    part([[13, 32, 10, 21], [20, 32, 3, 21, shirtDark]], shirt);
    part([[16 + swing * 2, 33, 4, 8]], shirt);
    part([[16 + swing * 3, 41, 4, 9]], skin);
  } else {
    part([[11, 32, 14, 21], [22, 32, 3, 21, shirtDark]], shirt);
    part([[9 + swing, 33, 4, 8]], shirt);
    part([[9 + swing * 2, 41, 4, 9]], skin);
  }

  // Tete.
  if (view === 'front' || view === 'back') {
    part([[9, 10, 18, 20], [8, 12, 20, 16], [7, 18, 1, 4], [28, 18, 1, 4], [25, 14, 2, 12, skinDark]], skin);
  } else if (view === 'front34') {
    part([[10, 10, 18, 20], [9, 12, 20, 16], [29, 21, 1, 2]], skin);
    ctx.fillStyle = skinDark;
    ctx.fillRect(10, 18, 2, 4);
  } else if (view === 'side') {
    part([[9, 10, 18, 20], [8, 12, 20, 16], [28, 21, 1, 2]], skin);
    ctx.fillStyle = skinDark;
    ctx.fillRect(14, 18, 2, 4);
  } else {
    part([[10, 10, 18, 20], [9, 12, 20, 16]], skin);
    ctx.fillStyle = skinDark;
    ctx.fillRect(22, 18, 2, 4);
  }

  // Visage.
  const mouth = (x, w) => {
    if (talking) {
      ctx.fillStyle = '#6e2626';
      ctx.fillRect(x, 25, w, 2);
    } else {
      ctx.fillStyle = tone(skin, -0.35);
      ctx.fillRect(x, 25, w, 1);
    }
  };
  const eye = (x, w, pupilX, pupilW) => {
    if (blinking) {
      ctx.fillStyle = PUPIL;
      ctx.fillRect(x, 21, w, 1);
      return;
    }
    ctx.fillStyle = WHITE;
    ctx.fillRect(x, 19, w, 3);
    ctx.fillStyle = PUPIL;
    ctx.fillRect(pupilX, 20, pupilW, 2);
  };
  if (view === 'front') {
    eye(12, 3, 13, 2);
    eye(21, 3, 21, 2);
    ctx.fillStyle = tone(skin, -0.15);
    ctx.fillRect(17, 22, 2, 1);
    mouth(16, 4);
  } else if (view === 'front34') {
    eye(18, 3, 19, 2);
    eye(24, 2, 25, 1);
    mouth(21, 4);
  } else if (view === 'side') {
    eye(22, 2, 23, 1);
    mouth(24, 3);
  }

  // Cheveux.
  const hr = hairRects(style, view);
  if (hr.length) part(hr, hair);
}

/**
 * Sprite pour une apparence, une direction et un etat donnes.
 * @param {object} look  apparence (voir look.js)
 * @param {number} dir   direction 0..7
 * @param {{frame?:number, sitting?:boolean, talking?:boolean, blinking?:boolean}} state
 */
export function getAvatarSprite(look, dir, state = {}) {
  const s = {
    frame: state.sitting ? 0 : (state.frame ?? 0) % 4,
    sitting: !!state.sitting,
    talking: !!state.talking,
    blinking: !!state.blinking,
  };
  const key = `${look.skin}.${look.hairStyle}.${look.hair}.${look.shirt}.${look.pants}|${dir}|${s.frame}${+s.sitting}${+s.talking}${+s.blinking}`;
  let sprite = cache.get(key);
  if (sprite) return sprite;

  const [view, mirror] = VIEWS[dir] ?? VIEWS[3];
  const base = makeCanvas();
  drawBody(base.getContext('2d'), look, view, s);

  if (mirror) {
    sprite = makeCanvas();
    const ctx = sprite.getContext('2d');
    ctx.translate(SPRITE_W, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(base, 0, 0);
  } else {
    sprite = base;
  }
  if (cache.size > 2000) cache.clear();
  cache.set(key, sprite);
  return sprite;
}
