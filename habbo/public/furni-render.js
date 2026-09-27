// Rendu des mobis en isometrique, style pixel avec contours sombres.
// Chaque mobi est dessine a partir de boites et de formes simples en
// coordonnees locales : (gx, gy) en cases depuis son coin, z en pixels.

import { FURNI, footprint } from './furni.js';

const TW = 32; // demi-largeur d'une case
const TH = 16; // demi-hauteur d'une case

function isoPt(x, y) {
  return { x: (x - y) * TW, y: (x + y) * TH };
}

function shade(hex, amount) {
  let rgb;
  if (hex.startsWith('#')) {
    const n = parseInt(hex.slice(1), 16);
    rgb = [n >> 16, (n >> 8) & 255, n & 255];
  } else {
    rgb = hex.match(/\d+/g).map(Number);
  }
  const [r, g, b] = rgb.map((c) => Math.max(0, Math.min(255, Math.round(amount >= 0 ? c + (255 - c) * amount : c * (1 + amount)))));
  return `rgb(${r},${g},${b})`;
}

/** Outils de dessin pour un mobi pose en (x, y, z). */
function kit(ctx, item, fx = true) {
  const P = (gx, gy, z = 0) => {
    const p = isoPt(item.x + gx, item.y + gy);
    return { x: p.x, y: p.y - item.z - z };
  };

  const poly = (pts, fill, stroke) => {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1;
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
  };

  /** Boite : empreinte (gx, gy, gw, gh), elevation z, hauteur h. */
  const box = (gx, gy, gw, gh, z, h, color, { outline = true, top = color } = {}) => {
    const line = outline ? shade(color, -0.55) : null;
    const a = P(gx, gy, z + h), b = P(gx + gw, gy, z + h), c = P(gx + gw, gy + gh, z + h), d = P(gx, gy + gh, z + h);
    if (h > 0) {
      poly([P(gx, gy + gh, z), P(gx + gw, gy + gh, z), c, d], shade(color, -0.12), line);
      poly([P(gx + gw, gy, z), P(gx + gw, gy + gh, z), c, b], shade(color, -0.3), line);
    }
    poly([a, b, c, d], top, line);
  };

  const ellipse = (gx, gy, z, rx, ry, fill, stroke) => {
    const c = P(gx, gy, z);
    ctx.beginPath();
    ctx.ellipse(c.x, c.y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  };

  const glow = (gx, gy, z, radius, color) => {
    if (!fx) return;
    const c = P(gx, gy, z);
    const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, radius);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = g;
    ctx.fillRect(c.x - radius, c.y - radius, radius * 2, radius * 2);
    ctx.restore();
  };

  return { P, poly, box, ellipse, glow };
}

// ---------- Aides directionnelles ----------

/** Rectangle du dossier (cote oppose a la direction du siege). */
function backRect(fp, dir, t, inset = 0.08) {
  const w = fp.w - inset * 2;
  const h = fp.h - inset * 2;
  switch (dir) {
    case 4: return [inset, inset, w, t];
    case 0: return [inset, fp.h - inset - t, w, t];
    case 2: return [inset, inset, t, h];
    default: return [fp.w - inset - t, inset, t, h];
  }
}

/** Accoudoirs (cotes perpendiculaires a la direction). */
function armRects(fp, dir, t, inset = 0.08) {
  if (dir === 4 || dir === 0) {
    return [[inset, inset, t, fp.h - inset * 2], [fp.w - inset - t, inset, t, fp.h - inset * 2]];
  }
  return [[inset, inset, fp.w - inset * 2, t], [inset, fp.h - inset - t, fp.w - inset * 2, t]];
}

/** Le dossier est cote camera : il doit etre dessine apres l'avatar assis. */
export function backInFront(item) {
  return item.dir === 0 || item.dir === 6;
}

/**
 * Face avant d'un mobi (visible seulement pour les directions 2 et 4).
 * `depth` = position du plan de la face, u0..u1 le long de la face.
 */
function frontFace(k, item, fp, depth, u0, u1, z0, z1) {
  if (item.dir === 4) return [k.P(u0, depth, z0), k.P(u1, depth, z0), k.P(u1, depth, z1), k.P(u0, depth, z1)];
  if (item.dir === 2) return [k.P(depth, u0, z0), k.P(depth, u1, z0), k.P(depth, u1, z1), k.P(depth, u0, z1)];
  return null;
}

function faceLength(fp, dir) {
  return dir === 2 ? fp.h : fp.w;
}

function faceDepth(fp, dir, inset = 0) {
  return (dir === 2 ? fp.w : fp.h) - inset;
}

// ---------- Mobis ----------

function legs(k, x0, y0, x1, y1, z, color, t = 0.07) {
  for (const [lx, ly] of [[x0, y0], [x1 - t, y0], [x0, y1 - t], [x1 - t, y1 - t]]) k.box(lx, ly, t, t, 0, z, color);
}

const DRAWERS = {
  chair(k, item, fp, def, layer) {
    const c = def.color;
    if (layer !== 'front') {
      legs(k, 0.2, 0.2, 0.8, 0.8, 9, shade(c, -0.25));
      k.box(0.18, 0.18, 0.64, 0.64, 9, 3, c);
    }
    if ((layer === 'front') === backInFront(item)) {
      const [bx, by, bw, bh] = backRect(fp, item.dir, 0.09, 0.18);
      k.box(bx, by, bw, bh, 12, 20, shade(c, 0.08));
    }
  },

  armchair(k, item, fp, def, layer) {
    const c = def.color;
    if (layer !== 'front') {
      k.box(0.1, 0.1, fp.w - 0.2, fp.h - 0.2, 0, 10, shade(c, -0.1));
      k.box(0.14, 0.14, fp.w - 0.28, fp.h - 0.28, 10, 4, c);
    }
    if ((layer === 'front') === backInFront(item)) {
      const [bx, by, bw, bh] = backRect(fp, item.dir, 0.22, 0.1);
      k.box(bx, by, bw, bh, 10, 20, shade(c, 0.05));
    }
    // Accoudoirs : celui cote camera passe devant l'avatar.
    armRects(fp, item.dir, 0.16, 0.1).forEach(([ax, ay, aw, ah], i) => {
      if ((layer === 'front') === (i === 1)) k.box(ax, ay, aw, ah, 10, 9, shade(c, 0.1));
    });
  },

  stool(k, item, fp, def, layer) {
    if (layer === 'front') return;
    k.box(0.3, 0.3, 0.4, 0.4, 0, 2, '#555a66');
    k.box(0.46, 0.46, 0.08, 0.08, 2, 12, '#8a90a0');
    k.box(0.24, 0.24, 0.52, 0.52, 14, 6, def.color);
  },

  bench(k, item, fp, def, layer) {
    const wood = def.color;
    if (layer !== 'front') {
      legs(k, 0.12, 0.12, fp.w - 0.12, fp.h - 0.12, 8, '#3a3a40', 0.08);
      k.box(0.1, 0.1, fp.w - 0.2, fp.h - 0.2, 8, 4, wood);
    }
    if ((layer === 'front') === backInFront(item)) {
      const [bx, by, bw, bh] = backRect(fp, item.dir, 0.08, 0.1);
      k.box(bx, by, bw, bh, 12, 5, wood);
      k.box(bx, by, bw, bh, 20, 5, wood);
    }
  },

  table(k, item, fp, def, layer) {
    if (layer === 'front') return;
    const h = def.height;
    if (item.type === 'table_low') {
      legs(k, 0.12, 0.12, fp.w - 0.12, fp.h - 0.12, h - 3, '#9aa0ac', 0.06);
      k.ctx.save();
      k.ctx.globalAlpha = 0.7;
      k.box(0.05, 0.05, fp.w - 0.1, fp.h - 0.1, h - 3, 3, def.color);
      k.ctx.restore();
      return;
    }
    legs(k, 0.12, 0.12, fp.w - 0.12, fp.h - 0.12, h - 4, shade(def.color, -0.25), 0.1);
    k.box(0.04, 0.04, fp.w - 0.08, fp.h - 0.08, h - 4, 4, def.color, { top: shade(def.color, 0.12) });
  },

  bar(k, item, fp, def, layer) {
    if (layer === 'front') return;
    k.box(0.05, 0.12, fp.w - 0.1, fp.h - 0.24, 0, def.height - 3, def.color);
    k.box(0, 0.05, fp.w, fp.h - 0.1, def.height - 3, 3, '#d8c3a0');
  },

  plant(k, item) {
    k.box(0.3, 0.3, 0.4, 0.4, 0, 16, '#b5653b');
    const dark = '#1f5a2a';
    for (const [ox, oy, z, r] of [[0.5, 0.5, 28, 13], [0.35, 0.6, 22, 10], [0.65, 0.4, 22, 10], [0.5, 0.5, 38, 9]]) {
      k.ellipse(ox, oy, z, r, r * 0.9, '#2f7a3a', dark);
    }
    k.ellipse(0.45, 0.45, 32, 5, 4, '#4aa35a');
  },

  palm(k, item, fp, def, layer, now) {
    k.box(0.3, 0.3, 0.4, 0.4, 0, 14, '#c9a56b');
    for (let i = 0; i < 5; i++) k.box(0.44, 0.44, 0.12, 0.12, 14 + i * 9, 9, i % 2 ? '#7a5230' : '#8a6038');
    const top = k.P(0.5, 0.5, 60);
    const sway = Math.sin(now / 900) * 2;
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      k.ctx.beginPath();
      k.ctx.ellipse(top.x + Math.cos(a) * 14 + sway, top.y + Math.sin(a) * 6 + 4, 16, 5, a, 0, Math.PI * 2);
      k.ctx.fillStyle = i % 2 ? '#2f8a3a' : '#3fa24a';
      k.ctx.fill();
      k.ctx.strokeStyle = '#1f5a2a';
      k.ctx.stroke();
    }
    k.ellipse(0.5, 0.5, 58, 4, 3, '#6b4a2a');
  },

  rug(k, item, fp, def) {
    const c = def.color;
    const q = (i) => [k.P(i, i), k.P(fp.w - i, i), k.P(fp.w - i, fp.h - i), k.P(i, fp.h - i)];
    k.poly(q(0.04), c, shade(c, -0.5));
    k.poly(q(0.16), null, shade(c, 0.35));
    k.poly(q(0.24), shade(c, 0.08), null);
  },

  aquarium(k, item, fp, def, layer, now) {
    k.box(0.05, 0.1, fp.w - 0.1, fp.h - 0.2, 0, 12, '#3a2c22');
    const long = item.dir === 2 ? 'y' : 'x';
    // Poissons derriere la vitre.
    const len = long === 'x' ? fp.w : fp.h;
    k.box(0.05, 0.1, fp.w - 0.1, fp.h - 0.2, 12, 0, '#1e5a7a', { outline: false });
    for (let i = 0; i < 3; i++) {
      const t = ((now / (2600 + i * 700)) + i * 0.37) % 2;
      const u = 0.2 + (t < 1 ? t : 2 - t) * (len - 0.4);
      k.ellipse(long === 'x' ? u : 0.5, long === 'x' ? 0.5 : u, 18 + i * 4, 4, 2.5, ['#f08a2a', '#f0d23a', '#e04a6a'][i]);
    }
    k.ctx.save();
    k.ctx.globalAlpha = 0.45;
    k.box(0.05, 0.1, fp.w - 0.1, fp.h - 0.2, 12, 22, def.color, { top: '#bfe8f8' });
    k.ctx.restore();
    const bubbleZ = 14 + ((now / 40) % 20);
    k.ellipse(long === 'x' ? 0.3 : 0.5, long === 'x' ? 0.5 : 0.3, bubbleZ, 1.5, 1.5, 'rgba(255,255,255,.8)');
  },

  fridge(k, item, fp, def) {
    const c = def.color;
    k.box(0.12, 0.12, 0.76, 0.76, 0, def.height, c);
    const d = faceDepth(fp, item.dir, 0.12) + 0.001;
    if (item.state === 1) {
      const inside = frontFace(k, item, fp, d, 0.18, 0.82, 4, def.height - 4);
      if (inside) {
        k.poly(inside, '#fff6c8', '#8a8a70');
        for (const z of [14, 26, 36]) k.poly(frontFace(k, item, fp, d, 0.2, 0.8, z, z + 1), '#c9c2a0');
        k.poly(frontFace(k, item, fp, d, 0.28, 0.36, 15, 24), '#3f9a4b');
        k.poly(frontFace(k, item, fp, d, 0.5, 0.58, 27, 34), '#c43b3b');
      }
    } else {
      const line = frontFace(k, item, fp, d, 0.12, 0.88, 30, 31);
      if (line) k.poly(line, shade(c, -0.4));
      const handle = frontFace(k, item, fp, d, 0.74, 0.8, 33, 42);
      if (handle) k.poly(handle, '#8a8f99');
      const handle2 = frontFace(k, item, fp, d, 0.74, 0.8, 18, 27);
      if (handle2) k.poly(handle2, '#8a8f99');
    }
  },

  tv(k, item, fp, def, layer, now) {
    k.box(0.1, 0.15, 0.8, 0.7, 0, 10, '#6e4a2c');
    k.box(0.16, 0.22, 0.68, 0.56, 10, 20, def.color);
    const d = faceDepth(fp, item.dir, 0.22) + 0.001;
    const screen = frontFace(k, item, fp, d, 0.22, 0.78, 13, 27);
    if (!screen) return;
    if (item.state === 1) {
      const hue = Math.floor(now / 12) % 360;
      k.poly(screen, `hsl(${hue},55%,55%)`, '#111');
      const bar = frontFace(k, item, fp, d, 0.22, 0.78, 13 + ((now / 30) % 14), 14 + ((now / 30) % 14));
      k.poly(bar, 'rgba(255,255,255,.5)');
      k.glow(0.5, 0.9, 20, 30, 'rgba(120,180,255,.25)');
    } else {
      k.poly(screen, '#1c2a30', '#111');
    }
  },

  fireplace(k, item, fp, def, layer, now) {
    const c = def.color;
    k.box(0.05, 0.1, fp.w - 0.1, fp.h - 0.2, 0, def.height - 4, c);
    k.box(0, 0.05, fp.w, fp.h - 0.1, def.height - 4, 4, '#d8c3a0');
    const d = faceDepth(fp, item.dir, 0.1) + 0.001;
    const len = faceLength(fp, item.dir);
    const hole = frontFace(k, item, fp, d, 0.35, len - 0.35, 2, 24);
    if (!hole) return;
    k.poly(hole, '#1a1210', shade(c, -0.6));
    if (item.state === 1) {
      for (let i = 0; i < 5; i++) {
        const u = 0.45 + i * ((len - 0.9) / 4);
        const hgt = 10 + Math.sin(now / 90 + i * 1.7) * 4;
        k.poly([...frontFace(k, item, fp, d, u - 0.1, u + 0.1, 3, 3).slice(0, 2), frontFace(k, item, fp, d, u, u, 3 + hgt, 3 + hgt)[0]],
          i % 2 ? '#f0a02a' : '#f06a2a');
      }
      k.glow(len / 2, fp.h, 10, 45, 'rgba(255,140,40,.35)');
    }
  },

  trophy(k, item, fp, def) {
    k.box(0.32, 0.32, 0.36, 0.36, 0, 6, '#3a2c22');
    k.box(0.44, 0.44, 0.12, 0.12, 6, 5, def.color);
    k.box(0.36, 0.36, 0.28, 0.28, 11, 10, def.color, { top: shade(def.color, 0.3) });
    k.ellipse(0.5, 0.5, 21, 7, 3.5, shade(def.color, -0.3), shade(def.color, -0.55));
  },

  lamp_floor(k, item, fp, def) {
    const on = item.state === 1;
    k.box(0.32, 0.32, 0.36, 0.36, 0, 4, '#44464e');
    k.box(0.46, 0.46, 0.08, 0.08, 4, 50, '#6a6d78');
    k.box(0.26, 0.26, 0.48, 0.48, 54, 16, on ? '#fff0b0' : def.color, { top: on ? '#fffbe0' : shade(def.color, 0.2) });
    if (on) k.glow(0.5, 0.5, 60, 70, 'rgba(255,220,130,.35)');
  },

  lava_lamp(k, item, fp, def, layer, now) {
    const on = item.state === 1;
    k.box(0.35, 0.35, 0.3, 0.3, 0, 6, '#8a8f99');
    k.ctx.save();
    k.ctx.globalAlpha = 0.85;
    k.box(0.38, 0.38, 0.24, 0.24, 6, 18, on ? '#ffd6a0' : '#b8a898');
    k.ctx.restore();
    if (on) {
      for (let i = 0; i < 3; i++) {
        const z = 8 + ((now / (60 + i * 25) + i * 6) % 14);
        k.ellipse(0.5, 0.5, z, 3, 3, def.color);
      }
      k.glow(0.5, 0.5, 14, 40, 'rgba(255,120,60,.3)');
    }
    k.box(0.36, 0.36, 0.28, 0.28, 24, 4, '#8a8f99');
  },

  disco_ball(k, item, fp, def, layer, now) {
    const on = item.state === 1;
    k.box(0.32, 0.32, 0.36, 0.36, 0, 4, '#2e2e34');
    k.box(0.47, 0.47, 0.06, 0.06, 4, 64, '#6a6d78');
    const c = k.P(0.5, 0.5, 78);
    const ctx = k.ctx;
    ctx.beginPath();
    ctx.arc(c.x, c.y, 12, 0, Math.PI * 2);
    ctx.fillStyle = '#b8c0cc';
    ctx.fill();
    ctx.strokeStyle = '#4a4e58';
    ctx.stroke();
    const spin = on ? now / 300 : 0;
    ctx.save();
    ctx.beginPath();
    ctx.arc(c.x, c.y, 11.5, 0, Math.PI * 2);
    ctx.clip();
    for (let i = -3; i <= 3; i++) {
      for (let j = -3; j <= 3; j++) {
        const lit = (i * 7 + j * 3 + Math.floor(spin * 3)) % 5 === 0;
        ctx.fillStyle = lit ? '#ffffff' : (i + j) % 2 ? '#9aa2b0' : '#d8dee8';
        ctx.fillRect(c.x + i * 4 + ((spin * 4) % 4) - 2, c.y + j * 4 - 2, 3, 3);
      }
    }
    ctx.restore();
    if (on) {
      // Taches de lumiere colorees autour.
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 10; i++) {
        const a = spin + i * 0.63;
        const r = 30 + (i % 3) * 18;
        const p = k.P(0.5, 0.5, 0);
        ctx.fillStyle = `hsla(${(i * 47 + now / 10) % 360},90%,60%,.35)`;
        ctx.beginPath();
        ctx.ellipse(p.x + Math.cos(a) * r * 1.6, p.y + Math.sin(a) * r * 0.8, 6, 3, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      k.glow(0.5, 0.5, 78, 40, 'rgba(255,255,255,.25)');
    }
  },

  dice(k, item, fp, def, layer, now) {
    const rolling = item.state === 0;
    const face = rolling ? 1 + (Math.floor(now / 80) % 6) : item.state;
    const jump = rolling ? Math.abs(Math.sin(now / 70)) * 5 : 0;
    k.box(0.33, 0.33, 0.34, 0.34, jump, 11, def.color);
    const PIPS = {
      1: [[0.5, 0.5]], 2: [[0.3, 0.3], [0.7, 0.7]], 3: [[0.3, 0.3], [0.5, 0.5], [0.7, 0.7]],
      4: [[0.3, 0.3], [0.7, 0.3], [0.3, 0.7], [0.7, 0.7]], 5: [[0.3, 0.3], [0.7, 0.3], [0.5, 0.5], [0.3, 0.7], [0.7, 0.7]],
      6: [[0.3, 0.25], [0.7, 0.25], [0.3, 0.5], [0.7, 0.5], [0.3, 0.75], [0.7, 0.75]],
    };
    for (const [u, v] of PIPS[face] ?? PIPS[1]) {
      k.ellipse(0.33 + u * 0.34, 0.33 + v * 0.34, jump + 11, 1.6, 1, face === 1 ? '#c43b3b' : '#1c1c22');
    }
  },

  bottle(k, item, fp, def, layer, now) {
    const angle = item.state === -1 ? now / 60 : (item.state * Math.PI) / 4;
    const c = k.P(0.5, 0.5, 3);
    const ctx = k.ctx;
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.scale(1, 0.5);
    ctx.rotate(angle);
    ctx.fillStyle = def.color;
    ctx.strokeStyle = '#1f4a26';
    ctx.beginPath();
    ctx.roundRect(-14, -5, 18, 10, 4);
    ctx.fill();
    ctx.stroke();
    ctx.fillRect(4, -2.5, 9, 5);
    ctx.strokeRect(4, -2.5, 9, 5);
    ctx.fillStyle = 'rgba(255,255,255,.4)';
    ctx.fillRect(-11, -3, 10, 2);
    ctx.restore();
  },

  teleport(k, item, fp, def, layer, now) {
    const c = def.color;
    const active = item.state === 1;
    const H = def.height;
    const t = 0.1;
    // Parois : fond et cotes (derriere l'avatar), montants avant et toit (devant).
    const sidesBack = { 4: [[0, 0, 1, t]], 0: [[0, 1 - t, 1, t]], 2: [[0, 0, t, 1]], 6: [[1 - t, 0, t, 1]] }[item.dir];
    const perp = item.dir === 4 || item.dir === 0
      ? [[0, 0, t, 1], [1 - t, 0, t, 1]]
      : [[0, 0, 1, t], [0, 1 - t, 1, t]];
    if (layer !== 'front') {
      k.box(0, 0, 1, 1, 0, 3, shade(c, -0.2));
      if (active) k.glow(0.5, 0.5, 30, 45, 'rgba(160,220,255,.6)');
      for (const r of sidesBack) k.box(...r, 3, H - 3, c);
      k.box(...perp[0], 3, H - 3, c);
    } else {
      k.box(...perp[1], 3, H - 3, c);
      k.box(0, 0, 1, 1, H, 5, shade(c, 0.1));
      const light = k.P(0.5, 0.5, H + 5);
      k.ctx.fillStyle = active ? '#aef0ff' : '#5a6070';
      k.ctx.beginPath();
      k.ctx.arc(light.x, light.y - 2, 3, 0, Math.PI * 2);
      k.ctx.fill();
    }
  },

  gate(k, item, fp, def) {
    const open = item.state === 1;
    const alongX = item.dir === 4;
    const post = (u) => (alongX ? k.box(u, 0.44, 0.12, 0.12, 0, def.height, '#6a6d78') : k.box(0.44, u, 0.12, 0.12, 0, def.height, '#6a6d78'));
    post(0);
    if (open) {
      for (const z of [8, 18]) (alongX ? k.box(0.02, 0.1, 0.08, 0.36, z, 3, def.color) : k.box(0.1, 0.02, 0.36, 0.08, z, 3, def.color));
    } else {
      for (const z of [8, 18]) (alongX ? k.box(0.1, 0.46, 0.8, 0.08, z, 3, def.color) : k.box(0.46, 0.1, 0.08, 0.8, z, 3, def.color));
    }
    post(0.88);
  },

  block(k, item, fp, def) {
    k.box(0, 0, fp.w, fp.h, 0, def.height, def.color, { top: shade(def.color, 0.1) });
  },
};

const DRAWER_FOR = {
  chair_wood: 'chair', chair_blue: 'chair', armchair_red: 'armchair', armchair_black: 'armchair',
  sofa_purple: 'armchair', sofa_green: 'armchair', stool: 'stool', bench: 'bench',
  table_square: 'table', table_big: 'table', table_low: 'table', bar_counter: 'bar',
  plant: 'plant', palm: 'palm', rug_red: 'rug', rug_blue: 'rug', rug_gold: 'rug',
  aquarium: 'aquarium', fridge: 'fridge', tv: 'tv', fireplace: 'fireplace', trophy: 'trophy',
  lamp_floor: 'lamp_floor', lava_lamp: 'lava_lamp', disco_ball: 'disco_ball',
  dice: 'dice', bottle: 'bottle', teleport: 'teleport', gate: 'gate',
  block_white: 'block', block_red: 'block', block_blue: 'block', block_green: 'block',
  block_yellow: 'block', block_black: 'block', tile_half: 'block',
};

/** Les mobis plats (tapis) sont dessines avec le sol, sous tout le reste. */
export function isFlat(item) {
  return FURNI[item.type]?.height === 0;
}

/** Vrai si le mobi a des elements a dessiner devant l'avatar qui l'occupe. */
export function hasFrontLayer(item) {
  const kind = DRAWER_FOR[item.type];
  if (kind === 'teleport' || kind === 'armchair') return true;
  return (kind === 'chair' || kind === 'bench') && backInFront(item);
}

/**
 * Dessine un mobi.
 * @param {'base'|'front'|'all'} layer 'front' = parties qui passent devant un avatar assis/debout dedans
 * @param {{fx?: boolean}} [opts] fx=false desactive les halos (utile pour tester un clic)
 */
export function drawItem(ctx, item, now, layer = 'all', { fx = true } = {}) {
  const def = FURNI[item.type];
  const kind = DRAWER_FOR[item.type];
  if (!def || !kind) return;
  const k = kit(ctx, item, fx);
  k.ctx = ctx;
  const fp = footprint(def, item.dir);
  if (layer === 'all' && hasFrontLayer(item)) {
    DRAWERS[kind](k, item, fp, def, 'base', now);
    DRAWERS[kind](k, item, fp, def, 'front', now);
    return;
  }
  if (layer === 'front' && !hasFrontLayer(item)) return;
  DRAWERS[kind](k, item, fp, def, layer === 'front' ? 'front' : 'base', now);
}

/** Profondeur de tri : coin le plus proche de la camera. */
export function itemDepth(item) {
  const fp = footprint(FURNI[item.type], item.dir);
  return item.x + fp.w - 1 + item.y + fp.h - 1;
}

/** Miniature d'un mobi (size x size pixels CSS) pour le catalogue et l'inventaire. */
export function drawThumbnail(canvas, type, size, dir) {
  const def = FURNI[type];
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  canvas.width = Math.round(size * dpr);
  canvas.height = Math.round(size * dpr);
  const d = dir ?? def.rotations[0];
  const fp = footprint(def, d);
  const spanW = (fp.w + fp.h) * TW;
  const spanH = (fp.w + fp.h) * TH + def.height + 24;
  const s = Math.min(1.3, (size - 8) / spanW, (size - 8) / spanH);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);
  ctx.translate(size / 2, size / 2);
  ctx.scale(s, s);
  // Centre de l'empreinte au milieu, decale vers le bas selon la hauteur.
  const mid = isoPt(fp.w / 2, fp.h / 2);
  ctx.translate(-mid.x, -mid.y + (def.height + 10) / 2);
  const state = def.use === 'toggle' ? 1 : def.use === 'dice' ? 6 : 0;
  drawItem(ctx, { type, x: 0, y: 0, z: 0, dir: d, state }, 0);
}
