// 生成 PWA 图标（纯 Node，无需依赖）。运行：node scripts/gen-icons.mjs
// 画一个蓝底 + 白色药片（胶囊）造型，输出 192/512 两个 PNG 到 public/icons/
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..', 'public', 'icons');
mkdirSync(outDir, { recursive: true });

// --- CRC32 ---
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function makePng(size) {
  const bg = [11, 108, 240]; // #0b6cf0
  const fg = [255, 255, 255];
  const cx = size / 2;
  const cy = size / 2;
  // 胶囊：水平方向长一点的圆角条
  const capW = size * 0.52;
  const capH = size * 0.26;
  const r = capH / 2;
  const left = cx - capW / 2;
  const right = cx + capW / 2;
  const top = cy - capH / 2;
  const bottom = cy + capH / 2;

  const raw = Buffer.alloc((size * 3 + 1) * size);
  let p = 0;
  for (let y = 0; y < size; y++) {
    raw[p++] = 0; // filter type 0
    for (let x = 0; x < size; x++) {
      let col = bg;
      // 判断是否在圆角胶囊内
      if (y >= top && y <= bottom) {
        if (x >= left + r && x <= right - r) {
          col = fg;
        } else if (x >= left && x < left + r) {
          if ((x - (left + r)) ** 2 + (y - cy) ** 2 <= r * r) col = fg;
        } else if (x > right - r && x <= right) {
          if ((x - (right - r)) ** 2 + (y - cy) ** 2 <= r * r) col = fg;
        }
      }
      // 胶囊中间一条分割线（蓝色），让它更像药片
      if (col === fg && Math.abs(x - cx) < Math.max(1, size * 0.006)) col = bg;
      raw[p++] = col[0];
      raw[p++] = col[1];
      raw[p++] = col[2];
    }
  }

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const idat = deflateSync(raw);
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const size of [192, 512]) {
  const png = makePng(size);
  writeFileSync(join(outDir, `icon-${size}.png`), png);
  console.log(`wrote icon-${size}.png (${png.length} bytes)`);
}
