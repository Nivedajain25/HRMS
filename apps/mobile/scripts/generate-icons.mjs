// Generates the app icon, adaptive icon, splash and notification PNGs from the
// Stencil logomark (indigo rounded square with three white strokes — see
// apps/web/public/favicon.svg) with a tiny dependency-free PNG encoder.
//
//   node apps/mobile/scripts/generate-icons.mjs
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'images');
const BRAND = [0x4f, 0x46, 0xe5];
const WHITE = [255, 255, 255];

/* ------------------------------ PNG encoder ------------------------------ */

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
const encodePng = (size, rgba) => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};

/* -------------------------------- Shapes -------------------------------- */

/** Signed distance to a rounded rectangle centered at (cx, cy). */
const roundedRect = (cx, cy, hw, hh, r) => (x, y) => {
  const qx = Math.abs(x - cx) - (hw - r);
  const qy = Math.abs(y - cy) - (hh - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};
/** Signed distance to a horizontal round-capped stroke from x1 to x2 at y. */
const stroke = (x1, x2, y0, width) => (x, y) => {
  const px = Math.min(Math.max(x, x1), x2);
  return Math.hypot(x - px, y - y0) - width / 2;
};

/**
 * Logomark in favicon units (64×64 viewBox): strokes at y 22/32/42,
 * x 20→44, 20→36, 20→44, width 5; rounded square radius 16.
 */
const strokesAt = (ox, oy, unit) => [
  stroke(ox + 20 * unit, ox + 44 * unit, oy + 22 * unit, 5 * unit),
  stroke(ox + 20 * unit, ox + 36 * unit, oy + 32 * unit, 5 * unit),
  stroke(ox + 20 * unit, ox + 44 * unit, oy + 42 * unit, 5 * unit),
];

/** Renders layers ([sdf, rgb]) back to front with 4×4 supersampling. */
const render = (size, layers, background = null) => {
  const out = Buffer.alloc(size * size * 4);
  const S = 4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const px = x + (sx + 0.5) / S;
          const py = y + (sy + 0.5) / S;
          let color = background;
          for (const [sdf, rgb] of layers) if (sdf(px, py) <= 0) color = rgb;
          if (color) {
            r += color[0];
            g += color[1];
            b += color[2];
            a += 1;
          }
        }
      }
      const i = (y * size + x) * 4;
      if (a) {
        out[i] = Math.round(r / a);
        out[i + 1] = Math.round(g / a);
        out[i + 2] = Math.round(b / a);
      }
      out[i + 3] = Math.round((a / (S * S)) * 255);
    }
  }
  return out;
};

const write = (name, size, layers, background) => {
  writeFileSync(join(OUT, name), encodePng(size, render(size, layers, background)));
  console.log(`wrote ${name} (${size}×${size})`);
};

mkdirSync(OUT, { recursive: true });

// App icon: full-bleed indigo (the OS applies its own mask), white strokes.
{
  const size = 1024;
  const unit = size / 64;
  write(
    'icon.png',
    size,
    strokesAt(0, 0, unit).map((s) => [s, WHITE]),
    BRAND,
  );
}

// Adaptive icon foreground / monochrome: strokes only, inside the 66 % safe zone.
{
  const size = 1024;
  const unit = (size * (66 / 108)) / 64;
  const offset = (size - 64 * unit) / 2;
  const layers = strokesAt(offset, offset, unit).map((s) => [s, WHITE]);
  write('adaptive-icon.png', size, layers, null);
  write('adaptive-icon-monochrome.png', size, layers, null);
}

// Splash + favicon: the complete logomark (rounded indigo square + strokes) on transparent.
for (const [name, size] of [
  ['splash-icon.png', 512],
  ['favicon.png', 48],
]) {
  const unit = size / 64;
  write(
    name,
    size,
    [[roundedRect(size / 2, size / 2, size / 2, size / 2, 16 * unit), BRAND], ...strokesAt(0, 0, unit).map((s) => [s, WHITE])],
    null,
  );
}

// Android notification icon: white silhouette on transparent (tinted by the OS).
{
  const size = 96;
  const unit = size / 64;
  write(
    'notification-icon.png',
    size,
    strokesAt(0, 0, unit).map((s) => [s, WHITE]),
    null,
  );
}
