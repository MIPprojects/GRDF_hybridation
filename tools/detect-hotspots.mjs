/**
 * Détecte les 7 bulles-callout dans l'illustration de la ville et sort leurs centres
 * en pourcentages, prêts à coller dans data/solutions.json.
 *
 * Méthode : les bulles sont de grands disques blancs cerclés d'un filet bleu. On
 * isole les pixels « bleu de filet », on étiquette les composantes connexes, et on
 * garde celles dont la boîte englobante est grande et à peu près carrée (l'anneau).
 *
 * usage : node tools/detect-hotspots.mjs <ville.png>
 */
import fs from 'node:fs';
import { decode } from './png.mjs';

const src = process.argv[2];
const { width, height, rgba } = decode(fs.readFileSync(src));
console.log(`image ${width}x${height}`);

// Sous-échantillonnage : 1 pixel sur STEP, largement suffisant pour des cercles de ~350 px
const STEP = 2;
const W = Math.floor(width / STEP);
const H = Math.floor(height / STEP);

// Filet des bulles : bleu franc, moyennement sombre.
const isOutline = (r, g, b, a) =>
  a > 128 && b > 110 && b - r > 55 && b - g > 25 && r < 140 && g < 170;

const mask = new Uint8Array(W * H);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const p = ((y * STEP) * width + x * STEP) * 4;
    if (isOutline(rgba[p], rgba[p + 1], rgba[p + 2], rgba[p + 3])) mask[y * W + x] = 1;
  }
}

// composantes connexes (8-voisinage), itératif
const label = new Int32Array(W * H).fill(-1);
const comps = [];
const stack = [];
for (let i = 0; i < mask.length; i++) {
  if (!mask[i] || label[i] >= 0) continue;
  const id = comps.length;
  const c = { id, n: 0, minX: W, minY: H, maxX: -1, maxY: -1 };
  stack.push(i);
  label[i] = id;
  while (stack.length) {
    const j = stack.pop();
    const x = j % W, y = (j / W) | 0;
    c.n++;
    if (x < c.minX) c.minX = x;
    if (x > c.maxX) c.maxX = x;
    if (y < c.minY) c.minY = y;
    if (y > c.maxY) c.maxY = y;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const k = ny * W + nx;
        if (mask[k] && label[k] < 0) { label[k] = id; stack.push(k); }
      }
    }
  }
  comps.push(c);
}

// pixels par composante (2e passe, moins gourmand que de tout stocker au 1er tour)
const pixels = new Map();
for (let i = 0; i < label.length; i++) {
  const id = label[i];
  if (id < 0) continue;
  if (!pixels.has(id)) pixels.set(id, []);
  pixels.get(id).push([i % W, (i / W) | 0]);
}

/** Ajustement de cercle par moindres carrés algébriques (Kåsa). */
function fitCircle(pts) {
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0, sz = 0;
  const n = pts.length;
  for (const [x, y] of pts) {
    const z = x * x + y * y;
    sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
    sxz += x * z; syz += y * z; sz += z;
  }
  const a = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]];
  const b = [sxz, syz, sz];
  // pivot de Gauss 3x3
  for (let i = 0; i < 3; i++) {
    let p = i;
    for (let k = i + 1; k < 3; k++) if (Math.abs(a[k][i]) > Math.abs(a[p][i])) p = k;
    [a[i], a[p]] = [a[p], a[i]]; [b[i], b[p]] = [b[p], b[i]];
    if (Math.abs(a[i][i]) < 1e-9) return null;
    for (let k = i + 1; k < 3; k++) {
      const f = a[k][i] / a[i][i];
      for (let j = i; j < 3; j++) a[k][j] -= f * a[i][j];
      b[k] -= f * b[i];
    }
  }
  const s = [0, 0, 0];
  for (let i = 2; i >= 0; i--) {
    let v = b[i];
    for (let j = i + 1; j < 3; j++) v -= a[i][j] * s[j];
    s[i] = v / a[i][i];
  }
  const cx = s[0] / 2, cy = s[1] / 2;
  const r = Math.sqrt(Math.max(0, s[2] + cx * cx + cy * cy));
  return { cx, cy, r };
}

/** Deux passes : ajustement grossier, rejet des points hors anneau, ré-ajustement. */
function fitRing(pts) {
  let f = fitCircle(pts);
  if (!f) return null;
  for (let pass = 0; pass < 3; pass++) {
    const keep = pts.filter(([x, y]) => {
      const d = Math.hypot(x - f.cx, y - f.cy);
      return Math.abs(d - f.r) < f.r * 0.12;
    });
    if (keep.length < 40) return null;
    const next = fitCircle(keep);
    if (!next) return null;
    f = { ...next, inliers: keep.length, total: pts.length };
  }
  return f;
}

const minSide = 300 / STEP; // les bulles font ~620 px de Ø dans l'original 8000x4500
const rings = comps
  .map((c) => ({ ...c, w: c.maxX - c.minX + 1, h: c.maxY - c.minY + 1 }))
  .filter((c) => c.w > minSide && c.h > minSide)
  .map((c) => {
    const f = fitRing(pixels.get(c.id));
    return f && { ...c, ...f, ratio: f.inliers / f.total };
  })
  .filter(Boolean)
  // un vrai anneau : la majorité des pixels tombent sur le cercle ajusté
  .filter((c) => c.ratio > 0.55 && c.r * STEP > 180 && c.r * STEP < 450)
  .sort((a, b) => a.cy - b.cy);

console.log(`\n${comps.length} composantes -> ${rings.length} bulles retenues :\n`);
console.log('  "hotspot": { "x": …, "y": …, "r": … }   (% de la largeur/hauteur du visuel)\n');
for (const c of rings) {
  const cx = (c.cx * STEP / width) * 100;
  const cy = (c.cy * STEP / height) * 100;
  const r = (c.r * STEP / width) * 100;
  console.log(
    `  { "x": ${cx.toFixed(2)}, "y": ${cy.toFixed(2)}, "r": ${r.toFixed(2)} }` +
    `   // anneau ${(c.ratio * 100).toFixed(0)} %, Ø ${Math.round(c.r * 2 * STEP)} px`
  );
}
