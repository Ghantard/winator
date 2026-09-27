// Apparence des avatars. Partage entre le client et le serveur (pas d'acces au DOM ici).

export const PALETTES = {
  skin: ['#f6d3b3', '#eab690', '#c98d60', '#8f5b3c', '#5e3b27'],
  hair: ['#2b1b12', '#6b3e1f', '#b8742f', '#f0d27a', '#b83a2a', '#8a8a92', '#3a5ab8', '#d9589a'],
  shirt: ['#3b82c4', '#c43b52', '#2f9e5b', '#e6b33a', '#8b5cc4', '#e0703a', '#2e3440', '#ececec'],
  pants: ['#2b3448', '#3a5f9a', '#6b5238', '#1f1f22', '#7a7a80', '#7a2f3a'],
};

export const HAIR_STYLES = [
  { id: 'court', label: 'Court' },
  { id: 'long', label: 'Long' },
  { id: 'herisse', label: 'Herisse' },
  { id: 'chauve', label: 'Chauve' },
];

export const DEFAULT_LOOK = { skin: 0, hairStyle: 0, hair: 1, shirt: 0, pants: 0 };

const LIMITS = {
  skin: PALETTES.skin.length,
  hairStyle: HAIR_STYLES.length,
  hair: PALETTES.hair.length,
  shirt: PALETTES.shirt.length,
  pants: PALETTES.pants.length,
};

/** Retourne une apparence valide : chaque champ invalide est remplace par sa valeur par defaut. */
export function sanitizeLook(look) {
  const clean = { ...DEFAULT_LOOK };
  if (!look || typeof look !== 'object') return clean;
  for (const [key, max] of Object.entries(LIMITS)) {
    const v = look[key];
    if (Number.isInteger(v) && v >= 0 && v < max) clean[key] = v;
  }
  return clean;
}

export function randomLook() {
  const look = {};
  for (const [key, max] of Object.entries(LIMITS)) look[key] = Math.floor(Math.random() * max);
  return look;
}
