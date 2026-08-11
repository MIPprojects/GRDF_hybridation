/**
 * Prépare l'illustration de fond pour le web : downscale x2 (8000x4500 -> 4000x2250)
 * plus une variante allégée pour le premier rendu. Avec --debug, dessine les anneaux
 * détectés pour vérifier le calage des zones cliquables.
 *
 * usage : node tools/prepare-background.mjs <ville.png> <outDir> [--debug hotspots.json]
 */
import fs from 'node:fs';
import path from 'node:path';
import { decode, encode } from './png.mjs';

function downscale(width, height, rgba, factor) {
  if (factor <= 1) return { width, height, rgba };
  const w = Math.floor(width / factor);
  const h = Math.floor(height / factor);
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

const [, , src, outDir, ...flags] = process.argv;
fs.mkdirSync(outDir, { recursive: true });
const img = decode(fs.readFileSync(src));
console.log(`source ${img.width}x${img.height}`);

for (const [name, factor] of [['ville.png', 2], ['ville-lowres.png', 8]]) {
  const s = downscale(img.width, img.height, img.rgba, factor);
  const file = path.join(outDir, name);
  fs.writeFileSync(file, encode(s.width, s.height, s.rgba));
  console.log(`  ${name}  ${s.width}x${s.height}  ${(fs.statSync(file).size / 1024).toFixed(0)} Ko`);
}

const debugIdx = flags.indexOf('--debug');
if (debugIdx >= 0) {
  const spots = JSON.parse(fs.readFileSync(flags[debugIdx + 1], 'utf8'));
  const s = downscale(img.width, img.height, img.rgba, 4);
  for (const sp of spots) {
    const cx = (sp.x / 100) * s.width;
    const cy = (sp.y / 100) * s.height;
    const r = (sp.r / 100) * s.width;
    for (let t = 0; t < 4000; t++) {
      const ang = (t / 4000) * Math.PI * 2;
      for (let k = -3; k <= 3; k++) {
        const x = Math.round(cx + Math.cos(ang) * (r + k));
        const y = Math.round(cy + Math.sin(ang) * (r + k));
        if (x < 0 || y < 0 || x >= s.width || y >= s.height) continue;
        const p = (y * s.width + x) * 4;
        s.rgba[p] = 255; s.rgba[p + 1] = 0; s.rgba[p + 2] = 128; s.rgba[p + 3] = 255;
      }
    }
    for (let dy = -6; dy <= 6; dy++) {
      for (let dx = -6; dx <= 6; dx++) {
        const x = Math.round(cx + dx), y = Math.round(cy + dy);
        if (x < 0 || y < 0 || x >= s.width || y >= s.height) continue;
        const p = (y * s.width + x) * 4;
        s.rgba[p] = 255; s.rgba[p + 1] = 0; s.rgba[p + 2] = 128; s.rgba[p + 3] = 255;
      }
    }
  }
  const file = path.join(outDir, '_debug-hotspots.png');
  fs.writeFileSync(file, encode(s.width, s.height, s.rgba));
  console.log(`  _debug-hotspots.png  ${s.width}x${s.height}`);
}
