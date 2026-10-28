'use strict';

/* Gemini visible-watermark engine.
 *
 * Model:
 *     watermarked = alpha * logo + (1 - alpha) * original
 *     original    = (watermarked - alpha * logo) / (1 - alpha)
 * with logo = 255 (the visible Gemini watermark is white) and
 * alpha = captured_channel / 255 for the watermark captured over black.
 *
 * Geometry:
 *   profile V1 "legacy"  : logo 48 @ margin 32  (small) / logo 96 @ margin 64  (large)
 *   profile V2 "current" : logo 36..48 @ margin ~192*scale (small) / logo 96 @ margin 192 (large)
 *   "large" means both image dimensions are > 1024.
 *
 * This file only does maths. It never touches the network.
 */

const { getAlpha } = require('./alpha');

const CAPTURES = {
  V2: { small: 'bg_b_36', large: 'bg_b_96' },
  V1: { small: 'bg_48', large: 'bg_96' }
};

const LOGO_VALUE = 255.0;
const MAX_ALPHA = 0.99;

function isLarge(w, h) {
  return w > 1024 && h > 1024;
}

function v2SmallConfig(w, h) {
  const longSide = Math.max(w, h);
  const shortSide = Math.min(w, h);
  let src;
  if (longSide > 1100) {
    const doubled = 2 * longSide;
    src = 2752;
    [2816, 2848].forEach(function (cand) {
      if (Math.abs(doubled - cand) < Math.abs(doubled - src)) src = cand;
    });
  } else if (shortSide >= 566) src = 2752;
  else if (shortSide >= 550) src = 2816;
  else src = 2848;

  const scale = longSide / src;
  const margin = Math.round(192 * scale);
  const ideal = Math.round(96 * scale);
  return {
    marginRight: margin,
    marginBottom: margin,
    logoSize: ideal <= 40 ? 36 : ideal
  };
}

function autoConfig(w, h, profile) {
  const large = isLarge(w, h);
  if (profile === 'V1') {
    return large
      ? { marginRight: 64, marginBottom: 64, logoSize: 96 }
      : { marginRight: 32, marginBottom: 32, logoSize: 48 };
  }
  if (large) return { marginRight: 192, marginBottom: 192, logoSize: 96 };
  return v2SmallConfig(w, h);
}

/* Which stored capture to use for a given profile / size. The V2 small
 * template is canonical at 36 px; anything else V2-small is interpolated from
 * the 96 px capture. */
function captureFor(profile, large, logoSize) {
  const set = CAPTURES[profile];
  if (large) return set.large;
  if (profile === 'V2' && logoSize !== 36) return set.large;
  return set.small;
}

function boxFromConfig(w, h, cfg, logoSize) {
  const size = logoSize || cfg.logoSize;
  return {
    x: w - cfg.marginRight - size,
    y: h - cfg.marginBottom - size,
    size: size
  };
}

function removeRegion(data, w, h, box, alpha, strength, threshold) {
  const size = box.size;
  const x0 = Math.max(0, box.x);
  const y0 = Math.max(0, box.y);
  const x1 = Math.min(w, box.x + size);
  const y1 = Math.min(h, box.y + size);
  for (let y = y0; y < y1; y++) {
    const j = y - box.y;
    for (let x = x0; x < x1; x++) {
      const i = x - box.x;
      let a = alpha[j * size + i] * strength;
      if (a < threshold) continue;
      if (a > MAX_ALPHA) a = MAX_ALPHA;
      const om = 1 - a;
      const p = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        const v = (data[p + c] - a * LOGO_VALUE) / om;
        data[p + c] = v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
      }
    }
  }
}

function luma(data, w, x0, y0, rw, rh) {
  const out = new Float32Array(rw * rh);
  for (let y = 0; y < rh; y++) {
    const row = (y0 + y) * w;
    for (let x = 0; x < rw; x++) {
      const p = (row + x0 + x) * 4;
      out[y * rw + x] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
    }
  }
  return out;
}

function boxBlur(src, w, h, r) {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const n = 2 * r + 1;
  let i, x, y, sum, row, add, sub;
  function cl(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }
  for (y = 0; y < h; y++) {
    row = y * w;
    sum = 0;
    for (i = -r; i <= r; i++) sum += src[row + cl(i, 0, w - 1)];
    for (x = 0; x < w; x++) {
      tmp[row + x] = sum / n;
      add = cl(x + r + 1, 0, w - 1);
      sub = cl(x - r, 0, w - 1);
      sum += src[row + add] - src[row + sub];
    }
  }
  for (x = 0; x < w; x++) {
    sum = 0;
    for (i = -r; i <= r; i++) sum += tmp[cl(i, 0, h - 1) * w + x];
    for (y = 0; y < h; y++) {
      out[y * w + x] = sum / n;
      add = cl(y + r + 1, 0, h - 1);
      sub = cl(y - r, 0, h - 1);
      sum += tmp[add * w + x] - tmp[sub * w + x];
    }
  }
  return out;
}

/* Slide the watermark box a few pixels around and keep the offset whose
 * "brightness above local background" pattern correlates best with the
 * watermark alpha. */
function alignSearch(data, w, h, box, alpha, radius) {
  const size = box.size;
  const pad = Math.max(size, 24);
  const x0 = Math.max(0, box.x - radius - pad);
  const y0 = Math.max(0, box.y - radius - pad);
  const x1 = Math.min(w, box.x + size + radius + pad);
  const y1 = Math.min(h, box.y + size + radius + pad);
  const rw = x1 - x0;
  const rh = y1 - y0;
  if (rw < size || rh < size) return { box: box, score: -1 };

  const lum = luma(data, w, x0, y0, rw, rh);
  const bg = boxBlur(lum, rw, rh, Math.max(3, Math.round(size / 2)));

  const best = { score: -2, dx: 0, dy: 0 };
  const n = size * size;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const bx = box.x + dx - x0;
      const by = box.y + dy - y0;
      if (bx < 0 || by < 0 || bx + size > rw || by + size > rh) continue;
      let sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
      for (let j = 0; j < size; j++) {
        const r1 = (by + j) * rw + bx;
        const r2 = j * size;
        for (let i = 0; i < size; i++) {
          const a = alpha[r2 + i];
          const b = lum[r1 + i] - bg[r1 + i];
          sa += a;
          sb += b;
          saa += a * a;
          sbb += b * b;
          sab += a * b;
        }
      }
      const va = saa - (sa * sa) / n;
      const vb = sbb - (sb * sb) / n;
      if (va <= 1e-6 || vb <= 1e-6) continue;
      const score = (sab - (sa * sb) / n) / Math.sqrt(va * vb);
      if (score > best.score) {
        best.score = score;
        best.dx = dx;
        best.dy = dy;
      }
    }
  }
  return {
    box: { x: box.x + best.dx, y: box.y + best.dy, size: size },
    score: best.score
  };
}

/* Evaluate one profile end to end: predict geometry, then fine-align. */
function evaluate(data, w, h, profile, radius) {
  const cfg = autoConfig(w, h, profile);
  const box = boxFromConfig(w, h, cfg, cfg.logoSize);
  const large = isLarge(w, h);
  const alpha = getAlpha(captureFor(profile, large, cfg.logoSize), cfg.logoSize);
  const res = alignSearch(data, w, h, box, alpha, radius);
  return {
    profile: profile,
    cfg: cfg,
    alpha: alpha,
    logoSize: cfg.logoSize,
    box: res.box,
    score: res.score
  };
}

/* Try both profiles, return the better-aligned one. */
function detect(data, w, h, radius) {
  radius = radius || 12;
  const v2 = evaluate(data, w, h, 'V2', radius);
  const v1 = evaluate(data, w, h, 'V1', radius);
  const win = v2.score >= v1.score ? v2 : v1;
  win.both = { V2: v2, V1: v1 };
  return win;
}

module.exports = {
  autoConfig,
  captureFor,
  boxFromConfig,
  removeRegion,
  alignSearch,
  evaluate,
  detect,
  isLarge,
  LOGO_VALUE
};
