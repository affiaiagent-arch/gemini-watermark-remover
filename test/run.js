'use strict';

/* End-to-end test without needing a real Gemini image:
 *   1. make a deterministic base image,
 *   2. apply the watermark with the same alpha/geometry the remover assumes,
 *   3. remove it,
 *   4. compare the result to the base.
 * If the reverse blend and the geometry agree, the error is only rounding. */

const assert = require('assert');
const { remove } = require('../src');
const engine = require('../src/engine');
const { getAlpha } = require('../src/alpha');

function makeBase(w, h) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4;
      data[p] = Math.round((x * 255) / w);
      data[p + 1] = Math.round((y * 255) / h);
      data[p + 2] = (x ^ y) & 255;
      data[p + 3] = 255;
    }
  }
  return { data, width: w, height: h };
}

function applyWatermark(img, profile) {
  const cfg = engine.autoConfig(img.width, img.height, profile);
  const box = engine.boxFromConfig(img.width, img.height, cfg, cfg.logoSize);
  const large = engine.isLarge(img.width, img.height);
  const alpha = getAlpha(engine.captureFor(profile, large, cfg.logoSize), cfg.logoSize);
  const data = Uint8ClampedArray.from(img.data);

  for (let j = 0; j < box.size; j++) {
    for (let i = 0; i < box.size; i++) {
      const a = alpha[j * box.size + i];
      const p = ((box.y + j) * img.width + (box.x + i)) * 4;
      for (let c = 0; c < 3; c++) {
        const v = a * 255 + (1 - a) * data[p + c];
        data[p + c] = Math.round(Math.min(255, Math.max(0, v)));
      }
    }
  }
  return { data, width: img.width, height: img.height, box };
}

function meanAbsDiff(a, b) {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < a.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      sum += Math.abs(a[i + c] - b[i + c]);
      n++;
    }
  }
  return sum / n;
}

const cases = [
  { profile: 'V2', w: 1024, h: 768, label: 'V2 small' },
  { profile: 'V2', w: 1400, h: 1100, label: 'V2 large' },
  { profile: 'V1', w: 800, h: 600, label: 'V1 small' }
];

let failed = 0;

for (const c of cases) {
  const base = makeBase(c.w, c.h);
  const marked = applyWatermark(base, c.profile);
  const out = remove(marked);
  const mae = meanAbsDiff(out.data, base.data);
  const boxOk =
    Math.abs(out.detection.box.x - marked.box.x) <= 1 &&
    Math.abs(out.detection.box.y - marked.box.y) <= 1;

  const ok = mae < 2 && boxOk;
  if (!ok) failed++;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${c.label}  ${c.w}x${c.h}  ` +
      `profile=${out.detection.profile}  score=${out.detection.score.toFixed(4)}  ` +
      `box=${JSON.stringify(out.detection.box)}  mae=${mae.toFixed(3)}`
  );
}

if (failed) {
  console.error(`\n${failed} case(s) failed`);
  process.exit(1);
}
console.log('\nall cases passed');
