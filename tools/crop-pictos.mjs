/**
 * Auto-crop des pictogrammes : détecte la bounding box des pixels non transparents
 * et réencode un PNG RGBA sans marge. Zéro dépendance (zlib natif de Node).
 *
 * usage : node tools/crop-pictos.mjs <srcDir> <outDir>
 */
import fs from 'node:fs';
import path from 'node:path';
import { decode, encode } from './png.mjs';

/**
 * Rend transparent le disque blanc de la bulle : remplissage par diffusion depuis les
 * bords sur les pixels quasi blancs. Les blancs *intérieurs* (corps de la chaudière,
 * ballon…) sont enclos par un trait bleu, donc préservés.
 */
function clearWhiteBackground(width, height, rgba, { level = 232 } = {}) {
  const nearWhite = (i) => {
    const p = i * 4;
    return rgba[p + 3] < 8 || (rgba[p] >= level && rgba[p + 1] >= level && rgba[p + 2] >= level);
  };
  const seen = new Uint8Array(width * height);
  const stack = [];
  for (let x = 0; x < width; x++) { stack.push(x, (height - 1) * width + x); }
  for (let y = 0; y < height; y++) { stack.push(y * width, y * width + width - 1); }

  while (stack.length) {
    const i = stack.pop();
    if (seen[i] || !nearWhite(i)) continue;
    seen[i] = 1;
    rgba[i * 4 + 3] = 0;
    const x = i % width, y = (i / width) | 0;
    if (x > 0) stack.push(i - 1);
    if (x < width - 1) stack.push(i + 1);
    if (y > 0) stack.push(i - width);
    if (y < height - 1) stack.push(i + width);
  }
}

/**
 * bbox de l'illustration seule. Le cercle de la bulle est un filet de 2-3 px : une
 * érosion morphologique le fait disparaître, alors que les traits épais et les aplats
 * de l'équipement survivent. On mesure la bbox sur le masque érodé puis on re-dilate.
 */
function bbox(width, height, rgba, { alpha = 8, radius = 4 } = {}) {
  // somme intégrale du masque « encre » -> érosion en O(1) par pixel
  const w1 = width + 1;
  const sum = new Int32Array(w1 * (height + 1));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 4;
      const white = rgba[p] > 244 && rgba[p + 1] > 244 && rgba[p + 2] > 244;
      const on = rgba[p + 3] > alpha && !white ? 1 : 0;
      sum[(y + 1) * w1 + x + 1] = on + sum[y * w1 + x + 1] + sum[(y + 1) * w1 + x] - sum[y * w1 + x];
    }
  }
  const area = (x0, y0, x1, y1) =>
    sum[y1 * w1 + x1] - sum[y0 * w1 + x1] - sum[y1 * w1 + x0] + sum[y0 * w1 + x0];

  let minX = width, minY = height, maxX = -1, maxY = -1;
  const full = Math.round(((2 * radius + 1) ** 2) * 0.75);
  for (let y = radius; y < height - radius; y++) {
    for (let x = radius; x < width - radius; x++) {
      // fenêtre majoritairement encrée => zone épaisse, pas un filet isolé
      if (area(x - radius, y - radius, x + radius + 1, y + radius + 1) >= full) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  const pad = radius + 2;
  return {
    minX: Math.max(0, minX - pad),
    minY: Math.max(0, minY - pad),
    maxX: Math.min(width - 1, maxX + pad),
    maxY: Math.min(height - 1, maxY + pad),
  };
}

function cropRGBA(width, rgba, box) {
  const w = box.maxX - box.minX + 1;
  const h = box.maxY - box.minY + 1;
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    const src = ((box.minY + y) * width + box.minX) * 4;
    rgba.copy(out, y * w * 4, src, src + w * 4);
  }
  return { width: w, height: h, rgba: out };
}

/** Downscale entier par box-filter (moyenne pondérée par alpha pour éviter les halos). */
function downscale(width, height, rgba, maxSide) {
  const factor = Math.ceil(Math.max(width, height) / maxSide);
  if (factor <= 1) return { width, height, rgba };
  const w = Math.max(1, Math.floor(width / factor));
  const h = Math.max(1, Math.floor(height / factor));
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let dy = 0; dy < factor; dy++) {
        const sy = y * factor + dy;
        if (sy >= height) break;
        for (let dx = 0; dx < factor; dx++) {
          const sx = x * factor + dx;
          if (sx >= width) break;
          const s = (sy * width + sx) * 4;
          const al = rgba[s + 3];
          r += rgba[s] * al; g += rgba[s + 1] * al; b += rgba[s + 2] * al;
          a += al; n++;
        }
      }
      const d = (y * w + x) * 4;
      if (a > 0) { out[d] = r / a; out[d + 1] = g / a; out[d + 2] = b / a; }
      out[d + 3] = Math.round(a / n);
    }
  }
  return { width: w, height: h, rgba: out };
}

const [, , srcDir, outDir, maxSideArg] = process.argv;
const maxSide = Number(maxSideArg) || 640;
fs.mkdirSync(outDir, { recursive: true });

for (const file of fs.readdirSync(srcDir).filter((f) => /^\d\d_.*\.png$/i.test(f)).sort()) {
  const img = decode(fs.readFileSync(path.join(srcDir, file)));
  clearWhiteBackground(img.width, img.height, img.rgba);
  const box = bbox(img.width, img.height, img.rgba);
  const cropped = cropRGBA(img.width, img.rgba, box);
  const small = downscale(cropped.width, cropped.height, cropped.rgba, maxSide);
  const out = path.join(outDir, file);
  fs.writeFileSync(out, encode(small.width, small.height, small.rgba));
  console.log(
    `${file}  ${img.width}x${img.height} -> crop ${cropped.width}x${cropped.height} -> ${small.width}x${small.height}  (${(fs.statSync(out).size / 1024).toFixed(0)} Ko)`
  );
}
