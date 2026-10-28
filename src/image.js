'use strict';

const path = require('path');
const { PNG } = require('pngjs');
const jpeg = require('jpeg-js');

/* Decode a PNG or JPEG buffer into { data: Uint8ClampedArray RGBA, width, height }.
 * The `ext` argument is the file extension including the dot (".png", ".jpg"). */
function decode(buffer, ext) {
  const e = (ext || '').toLowerCase();
  if (e === '.png') {
    const png = PNG.sync.read(buffer);
    return {
      data: new Uint8ClampedArray(png.data.buffer, png.data.byteOffset, png.data.length),
      width: png.width,
      height: png.height
    };
  }
  if (e === '.jpg' || e === '.jpeg') {
    const out = jpeg.decode(buffer, { useTArray: true });
    return {
      data: new Uint8ClampedArray(out.data.buffer, out.data.byteOffset, out.data.length),
      width: out.width,
      height: out.height
    };
  }
  throw new Error('unsupported image format: ' + (ext || '(none)') + ' — use .png, .jpg or .jpeg');
}

function encodePng(img) {
  const png = new PNG({ width: img.width, height: img.height });
  png.data = Buffer.from(img.data);
  return PNG.sync.write(png);
}

function encodeJpeg(img, quality) {
  return jpeg.encode(
    { data: Buffer.from(img.data), width: img.width, height: img.height },
    quality == null ? 92 : quality
  ).data;
}

function decodeFile(filePath) {
  const fs = require('fs');
  return decode(fs.readFileSync(filePath), path.extname(filePath));
}

module.exports = { decode, decodeFile, encodePng, encodeJpeg };
