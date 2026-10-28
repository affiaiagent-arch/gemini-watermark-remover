'use strict';

const engine = require('./engine');
const { decode, decodeFile, encodePng, encodeJpeg } = require('./image');

/* Detect the visible Gemini watermark. Returns the winning profile, the box,
 * the alignment score, and the alpha map used. */
function detect(img, opts) {
  opts = opts || {};
  return engine.detect(img.data, img.width, img.height, opts.radius || 12);
}

/* Remove the visible Gemini watermark. Returns a new image plus the detection
 * details. The input is never mutated.
 *
 * opts.radius     search radius in pixels (default 12)
 * opts.strength   alpha multiplier, 0..1 (default 1)
 * opts.threshold  skip pixels whose alpha is below this (default 0.02)
 */
function remove(img, opts) {
  opts = opts || {};
  const detection = detect(img, opts);
  const data = Uint8ClampedArray.from(img.data);
  engine.removeRegion(
    data,
    img.width,
    img.height,
    detection.box,
    detection.alpha,
    opts.strength == null ? 1 : opts.strength,
    opts.threshold == null ? 0.02 : opts.threshold
  );
  return {
    data: data,
    width: img.width,
    height: img.height,
    detection: detection
  };
}

module.exports = {
  detect,
  remove,
  decode,
  decodeFile,
  encodePng,
  encodeJpeg
};
