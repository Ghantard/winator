// Rendu isometrique sur Canvas 2D.
// Grille : x vers le bas-droite, y vers le bas-gauche. La case (x, y)
// occupe [x, x+1] x [y, y+1] ; iso(x, y) donne le coin haut du losange.

export const TILE_W = 64;
export const TILE_H = 32;
const WALL_H = 110;

// Directions indexees 0..7 (doit correspondre au serveur).
export const DIRS = [
  [0, -1], [1, -1], [1, 0], [1, 1],
  [0, 1], [-1, 1], [-1, 0], [-1, -1],
];

export function iso(x, y) {
  return { x: (x - y) * (TILE_W / 2), y: (x + y) * (TILE_H / 2) };
}

export function screenToTile(sx, sy) {
  const a = sx / (TILE_W / 2);
  const b = sy / (TILE_H / 2);
  return { x: Math.floor((a + b) / 2), y: Math.floor((b - a) / 2) };
}

/** Eclaircit (amount > 0) ou assombrit une couleur "#rrggbb" ou "rgb(r,g,b)". */
export function shade(color, amount) {
  let rgb;
  if (color.startsWith('#')) {
    const n = parseInt(color.slice(1), 16);
    rgb = [n >> 16, (n >> 8) & 255, n & 255];
  } else {
    rgb = color.match(/\d+/g).map(Number);
  }
  const [r, g, b] = rgb.map((c) => Math.max(0, Math.min(255, Math.round(c * (1 + amount)))));
  return `rgb(${r},${g},${b})`;
}

function poly(ctx, pts, fill, stroke) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

const up = (p, h) => ({ x: p.x, y: p.y - h });

/** Boite isometrique : empreinte (gx, gy, gw, gh) en cases, elevation z et hauteur en pixels. */
function box(ctx, gx, gy, gw, gh, z, height, color) {
  const a = iso(gx, gy), b = iso(gx + gw, gy), c = iso(gx + gw, gy + gh), d = iso(gx, gy + gh);
  const top = z + height;
  poly(ctx, [up(d, z), up(c, z), up(c, top), up(d, top)], shade(color, -0.15));
  poly(ctx, [up(b, z), up(c, z), up(c, top), up(b, top)], shade(color, -0.32));
  poly(ctx, [up(a, top), up(b, top), up(c, top), up(d, top)], color);
}

// ---------- Salle ----------

export function drawRoom(ctx, room, hover) {
  const floor = (x, y) => y >= 0 && y < room.height && x >= 0 && room.layout[y][x] === '0';

  // Murs : sur les bords arriere (voisin x-1 ou y-1 hors sol).
  for (let y = 0; y < room.height; y++) {
    for (let x = 0; x < room.width; x++) {
      if (!floor(x, y)) continue;
      const isDoor = room.door.x === x && room.door.y === y;
      if (!floor(x, y - 1)) {
        const p1 = iso(x, y), p2 = iso(x + 1, y);
        poly(ctx, [p1, p2, up(p2, WALL_H), up(p1, WALL_H)], '#b9c6d6', '#a3b1c2');
      }
      if (!floor(x - 1, y) && !isDoor) {
        const p1 = iso(x, y), p2 = iso(x, y + 1);
        poly(ctx, [p1, p2, up(p2, WALL_H), up(p1, WALL_H)], '#d5dfea', '#c0ccd9');
      }
    }
  }

  // Sol en damier.
  for (let y = 0; y < room.height; y++) {
    for (let x = 0; x < room.width; x++) {
      if (!floor(x, y)) continue;
      const isDoor = room.door.x === x && room.door.y === y;
      const color = isDoor ? '#6f5a3c' : (x + y) % 2 ? '#9aa86a' : '#a6b477';
      poly(ctx, [iso(x, y), iso(x + 1, y), iso(x + 1, y + 1), iso(x, y + 1)], color, 'rgba(0,0,0,.12)');
    }
  }

  // Tapis (au niveau du sol, sous tout le reste).
  for (const f of room.furniture) {
    if (f.type === 'rug') {
      const inset = 0.08;
      poly(ctx, [
        iso(f.x + inset, f.y + inset), iso(f.x + f.w - inset, f.y + inset),
        iso(f.x + f.w - inset, f.y + f.h - inset), iso(f.x + inset, f.y + f.h - inset),
      ], f.color, shade(f.color, -0.3));
    }
  }

  // Case survolee.
  if (hover && floor(hover.x, hover.y)) {
    const { x, y } = hover;
    ctx.save();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255,255,255,.85)';
    ctx.beginPath();
    const pts = [iso(x, y), iso(x + 1, y), iso(x + 1, y + 1), iso(x, y + 1)];
    ctx.moveTo(pts[0].x, pts[0].y);
    pts.slice(1).forEach((p) => ctx.lineTo(p.x, p.y));
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }
}

// ---------- Mobilier ----------

export function furnitureDepth(f) {
  return f.x + f.w - 1 + f.y + f.h - 1;
}

export function drawFurniture(ctx, f) {
  const { x, y } = f;
  switch (f.type) {
    case 'table':
      box(ctx, x + 0.15, y + 0.15, f.w - 0.3, f.h - 0.3, 0, 20, shade(f.color, -0.2));
      box(ctx, x + 0.05, y + 0.05, f.w - 0.1, f.h - 0.1, 20, 5, f.color);
      break;
    case 'chair':
      box(ctx, x + 0.22, y + 0.22, 0.56, 0.56, 0, 12, f.color);
      if (!chairBackInFront(f)) drawChairBack(ctx, f);
      break;
    case 'sofa': {
      box(ctx, x + 0.05, y + 0.1, f.w - 0.1, f.h - 0.2, 0, 16, f.color);
      box(ctx, x + 0.05, y + 0.1, f.w - 0.1, 0.22, 16, 18, shade(f.color, 0.12));
      break;
    }
    case 'bar':
      box(ctx, x + 0.05, y + 0.2, f.w - 0.1, f.h - 0.4, 0, 34, f.color);
      box(ctx, x, y + 0.15, f.w, f.h - 0.3, 34, 4, '#d8c3a0');
      break;
    case 'plant': {
      box(ctx, x + 0.3, y + 0.3, 0.4, 0.4, 0, 18, '#b5653b');
      const c = iso(x + 0.5, y + 0.5);
      ctx.fillStyle = '#2f7a3a';
      for (const [ox, oy, r] of [[0, -40, 16], [-10, -30, 12], [10, -30, 12], [0, -54, 11]]) {
        ctx.beginPath();
        ctx.arc(c.x + ox, c.y + oy, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#3f9a4b';
      ctx.beginPath();
      ctx.arc(c.x - 4, c.y - 46, 8, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'lamp': {
      box(ctx, x + 0.35, y + 0.35, 0.3, 0.3, 0, 4, '#444');
      box(ctx, x + 0.46, y + 0.46, 0.08, 0.08, 4, 56, '#666');
      box(ctx, x + 0.25, y + 0.25, 0.5, 0.5, 58, 18, '#f3d98b');
      break;
    }
    default:
      break;
  }
}

/** Le dossier est cote camera quand la chaise regarde vers le fond : il doit passer devant l'avatar. */
export function chairBackInFront(f) {
  const [dx, dy] = DIRS[f.dir];
  return dx < 0 || dy < 0;
}

export function drawChairBack(ctx, f) {
  const [dx, dy] = DIRS[f.dir];
  const bx = f.x + 0.22 + (dx < 0 ? 0.46 : 0);
  const by = f.y + 0.22 + (dy < 0 ? 0.46 : 0);
  box(ctx, bx, by, dx !== 0 ? 0.1 : 0.56, dy !== 0 ? 0.1 : 0.56, 12, 22, shade(f.color, 0.1));
}

// ---------- Avatars ----------

export function drawAvatar(ctx, p, pos, now, walking) {
  const c = iso(pos.x + 0.5, pos.y + 0.5);
  const [dx, dy] = DIRS[p.dir] ?? DIRS[4];
  const facingCamera = dx + dy > 0 || (dx + dy === 0 && dy > 0);
  const side = Math.sign(dx - dy); // -1 gauche, 1 droite a l'ecran
  const bob = walking ? Math.abs(Math.sin(now / 90)) * 2 : 0;
  const sitDrop = p.sitting ? 12 : 0;
  const baseY = c.y - bob + (p.sitting ? -12 : 0);

  // Ombre.
  ctx.fillStyle = 'rgba(0,0,0,.25)';
  ctx.beginPath();
  ctx.ellipse(c.x, c.y, 14, 6, 0, 0, Math.PI * 2);
  ctx.fill();

  // Jambes.
  const stride = walking ? Math.sin(now / 90) * 3 : 0;
  ctx.fillStyle = '#2b3448';
  const legH = 18 - sitDrop / 2;
  ctx.fillRect(c.x - 7 + stride, baseY - legH, 6, legH);
  ctx.fillRect(c.x + 1 - stride, baseY - legH, 6, legH);

  // Corps.
  const bodyTop = baseY - legH - 22;
  ctx.fillStyle = p.color;
  roundRect(ctx, c.x - 10, bodyTop, 20, 24, 5);
  ctx.fill();
  ctx.fillStyle = shade(p.color, -0.25);
  ctx.fillRect(c.x - 13, bodyTop + 3, 4, 15);
  ctx.fillRect(c.x + 9, bodyTop + 3, 4, 15);

  // Tete.
  const hx = c.x + side * 1.5;
  const hy = bodyTop - 11;
  ctx.fillStyle = '#f1c9a5';
  ctx.beginPath();
  ctx.arc(hx, hy, 11, 0, Math.PI * 2);
  ctx.fill();

  // Cheveux.
  ctx.fillStyle = '#4a2f1d';
  ctx.beginPath();
  if (facingCamera) {
    ctx.arc(hx, hy - 2, 11, Math.PI * 1.05, Math.PI * 1.95);
  } else {
    ctx.arc(hx, hy, 11.5, Math.PI * 0.85, Math.PI * 2.15);
  }
  ctx.fill();

  // Yeux.
  if (facingCamera) {
    ctx.fillStyle = '#1b1b1b';
    const ex = hx + side * 3;
    ctx.fillRect(ex - 4, hy, 2, 3);
    ctx.fillRect(ex + 2, hy, 2, 3);
  }

  return { x: c.x, y: hy - 14 };
}

export function drawNameTag(ctx, name, x, y, highlight) {
  ctx.font = '600 11px system-ui, sans-serif';
  const w = ctx.measureText(name).width + 10;
  ctx.fillStyle = highlight ? 'rgba(47,125,79,.9)' : 'rgba(0,0,0,.55)';
  roundRect(ctx, x - w / 2, y - 16, w, 15, 4);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(name, x, y - 8.5);
}

export function drawBubble(ctx, name, text, x, y, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = '13px system-ui, sans-serif';
  const lines = wrap(ctx, `${name} : ${text}`, 200);
  const lh = 16;
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 16;
  const h = lines.length * lh + 10;
  const bx = x - w / 2;
  const by = y - h - 10;
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#1b1b1b';
  ctx.lineWidth = 1.5;
  roundRect(ctx, bx, by, w, h, 8);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x - 6, by + h);
  ctx.lineTo(x, by + h + 8);
  ctx.lineTo(x + 6, by + h);
  ctx.fill();
  ctx.fillStyle = '#1b1b1b';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  lines.forEach((l, i) => ctx.fillText(l, bx + 8, by + 6 + i * lh));
  ctx.restore();
}

function wrap(ctx, text, maxW) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxW && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
