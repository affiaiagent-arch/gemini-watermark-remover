'use strict';

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const ASSET_DIR = path.join(__dirname, '..', 'assets');
const cache = new Map();

/* Read one of the alpha captures and turn it into a single-channel float map.
 * The capture is the watermark photographed over black, so alpha is the
 * brightest channel divided by 255. */
function loadGray(key) {
  const png = PNG.sync.read(fs.readFileSync(path.join(ASSET_DIR, key + '.png')));
  const gray = new Float32Array(png.width * png.height);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    gray[i] = Math.max(png.data[p], png.data[p + 1], png.data[p + 2]) / 255;
  }
  return { gray, width: png.width, height: png.height };
}

/* Bilinear resize. The browser uses canvas high-quality smoothing; bilinear is
 * close enough and keeps this package dependency-free beyond the codecs. */
function resizeGray(src, srcW, srcH, dstSize) {
  if (srcW === dstSize && srcH === dstSize) return src;
  const out = new Float32Array(dstSize * dstSize);
  const sx = srcW / dstSize;
  const sy = srcH / dstSize;
  for (let y = 0; y < dstSize; y++) {
    const fy = Math.min(srcH - 1, (y + 0.5) * sy - 0.5);
    const y0 = Math.floor(fy);
    const y1 = Math.min(srcH - 1, y0 + 1);
    const wy = fy - y0;
    for (let x = 0; x < dstSize; x++) {
      const fx = Math.min(srcW - 1, (x + 0.5) * sx - 0.5);
      const x0 = Math.floor(fx);
      const x1 = Math.min(srcW - 1, x0 + 1);
      const wx = fx - x0;
      const a = src[y0 * srcW + x0];
      const b = src[y0 * srcW + x1];
      const c = src[y1 * srcW + x0];
      const d = src[y1 * srcW + x1];
      out[y * dstSize + x] =
        a * (1 - wx) * (1 - wy) +
        b * wx * (1 - wy) +
        c * (1 - wx) * wy +
        d * wx * wy;
    }
  }
  return out;
}

function getAlpha(key, size) {
  const cacheKey = key + '@' + size;
  if (cache.has(cacheKey)) return cache.get(cacheKey);
  const { gray, width, height } = loadGray(key);
  const out = resizeGray(gray, width, height, size);
  cache.set(cacheKey, out);
  return out;
}

module.exports = { getAlpha };
