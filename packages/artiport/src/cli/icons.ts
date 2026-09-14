import { deflateSync } from 'node:zlib';

// Default app icons drawn procedurally (a stack of cards on the theme color), so no image tooling is needed.

export interface IconFile {
  name: string;
  data: Buffer;
}

export function generateIcons(themeColor: string): IconFile[] {
  return [
    { name: 'icon-192.png', data: renderIcon(192, themeColor, false) },
    { name: 'icon-512.png', data: renderIcon(512, themeColor, false) },
    { name: 'maskable-512.png', data: renderIcon(512, themeColor, true) },
    { name: 'apple-touch-icon.png', data: renderIcon(180, themeColor, true) },
  ];
}

type Rgb = [number, number, number];

interface Shape {
  cx: number;
  cy: number;
  w: number;
  h: number;
  r: number;
  color: Rgb;
  alpha: number;
}

const SAMPLES = 3;

export function renderIcon(size: number, themeColor: string, fullBleed: boolean): Buffer {
  const accent = parseHex(themeColor);
  const dark: Rgb = accent.map((c) => Math.round(c * 0.62)) as Rgb;
  const white: Rgb = [255, 255, 255];
  const scale = fullBleed ? 0.8 : 1; // maskable icons keep the glyph inside the safe zone
  const card = (cy: number, w: number, h: number, alpha: number): Shape => ({
    cx: 0.5,
    cy: 0.5 + (cy - 0.5) * scale,
    w: w * scale,
    h: h * scale,
    r: 0.055 * scale,
    color: white,
    alpha,
  });
  const cards = [card(0.36, 0.44, 0.3, 0.38), card(0.45, 0.52, 0.33, 0.62), card(0.56, 0.6, 0.36, 1)];
  const background = fullBleed ? null : { cx: 0.5, cy: 0.5, w: 1, h: 1, r: 0.225 };

  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const u = (x + (sx + 0.5) / SAMPLES) / size;
          const v = (y + (sy + 0.5) / SAMPLES) / size;
          if (background && !inside(u, v, background)) continue;
          const t = Math.min(1, Math.max(0, (u + v) / 2));
          let color: Rgb = [lerp(accent[0], dark[0], t), lerp(accent[1], dark[1], t), lerp(accent[2], dark[2], t)];
          for (const shape of cards) {
            if (inside(u, v, shape)) color = mix(color, shape.color, shape.alpha);
          }
          r += color[0];
          g += color[1];
          b += color[2];
          a += 1;
        }
      }
      const total = SAMPLES * SAMPLES;
      const offset = (y * size + x) * 4;
      if (a > 0) {
        pixels[offset] = Math.round(r / a);
        pixels[offset + 1] = Math.round(g / a);
        pixels[offset + 2] = Math.round(b / a);
      }
      pixels[offset + 3] = Math.round((a / total) * 255);
    }
  }
  return encodePng(size, size, pixels);
}

function inside(u: number, v: number, shape: { cx: number; cy: number; w: number; h: number; r: number }): boolean {
  const dx = Math.max(Math.abs(u - shape.cx) - (shape.w / 2 - shape.r), 0);
  const dy = Math.max(Math.abs(v - shape.cy) - (shape.h / 2 - shape.r), 0);
  return dx * dx + dy * dy <= shape.r * shape.r;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function mix(base: Rgb, top: Rgb, alpha: number): Rgb {
  return [lerp(base[0], top[0], alpha), lerp(base[1], top[1], alpha), lerp(base[2], top[2], alpha)];
}

function parseHex(hex: string): Rgb {
  const value = /^#([0-9a-f]{6})$/i.exec(hex)?.[1] ?? '4c6ef5';
  return [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16)) as Rgb;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(width: number, height: number, rgba: Buffer): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const start = y * (width * 4 + 1);
    rows[start] = 0; // no filter
    rgba.copy(rows, start + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
