// Moteur PNG minimal (décodage/encodage 8 bits) — zéro dépendance.
import zlib from 'node:zlib';

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function readChunks(buf) {
  if (!buf.subarray(0, 8).equals(SIG)) throw new Error('not a PNG');
  const chunks = [];
  let off = 8;
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    chunks.push({ type, data: buf.subarray(off + 8, off + 8 + len) });
    off += 12 + len;
  }
  return chunks;
}

export function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Décode un PNG 8 bits (greyscale/RGB/palette/alpha) vers RGBA plat. */
export function decode(buf) {
  const chunks = readChunks(buf);
  const ihdr = chunks.find((c) => c.type === 'IHDR').data;
  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  const depth = ihdr[8];
  const colorType = ihdr[9];
  const interlace = ihdr[12];
  if (depth !== 8) throw new Error(`profondeur ${depth} non gérée`);
  if (interlace !== 0) throw new Error('entrelacement non géré');

  const plte = chunks.find((c) => c.type === 'PLTE')?.data;
  const trns = chunks.find((c) => c.type === 'tRNS')?.data;
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`colorType ${colorType} non géré`);

  const idat = zlib.inflateSync(
    Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.data))
  );

  const stride = width * channels;
  const raw = Buffer.alloc(height * stride);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const filter = idat[pos++];
    const line = idat.subarray(pos, pos + stride);
    pos += stride;
    const out = raw.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? raw.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? out[i - channels] : 0;
      const b = prev ? prev[i] : 0;
      const c = prev && i >= channels ? prev[i - channels] : 0;
      const x = line[i];
      out[i] =
        filter === 0 ? x
        : filter === 1 ? (x + a) & 0xff
        : filter === 2 ? (x + b) & 0xff
        : filter === 3 ? (x + ((a + b) >> 1)) & 0xff
        : (x + paeth(a, b, c)) & 0xff;
    }
  }

  // normalisation en RGBA
  const rgba = Buffer.alloc(width * height * 4, 255);
  for (let i = 0, n = width * height; i < n; i++) {
    const s = i * channels, d = i * 4;
    if (colorType === 6) { rgba[d] = raw[s]; rgba[d+1] = raw[s+1]; rgba[d+2] = raw[s+2]; rgba[d+3] = raw[s+3]; }
    else if (colorType === 2) { rgba[d] = raw[s]; rgba[d+1] = raw[s+1]; rgba[d+2] = raw[s+2]; }
    else if (colorType === 0) { rgba[d] = rgba[d+1] = rgba[d+2] = raw[s]; }
    else if (colorType === 4) { rgba[d] = rgba[d+1] = rgba[d+2] = raw[s]; rgba[d+3] = raw[s+1]; }
    else if (colorType === 3) {
      const p = raw[s] * 3;
      rgba[d] = plte[p]; rgba[d+1] = plte[p+1]; rgba[d+2] = plte[p+2];
      rgba[d+3] = trns && raw[s] < trns.length ? trns[raw[s]] : 255;
    }
  }
  return { width, height, rgba };
}

export function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

export function encode(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filtre None : compresse déjà très bien sur ces aplats
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    SIG,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * bbox de l'illustration seule. Le cercle de la bulle est un filet de 2-3 px : une
 * érosion morphologique le fait disparaître, alors que les traits épais et les aplats
 * de l'équipement survivent. On mesure la bbox sur le masque érodé puis on re-dilate.
 */
function bbox(width, height, rgba, { alpha = 8, radius = 4 } = {}) {
  // somme intégrale du masque « encre » -> érosion en O(1) par pixel.
  // Encre = opaque ET non blanc : le disque blanc de la bulle est donc ignoré,
  // seul le tracé de l'équipement compte.
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
      // fenêtre entièrement opaque => on est dans une zone épaisse, pas sur un filet
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


