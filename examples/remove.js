#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { decode, encodePng } = require('../src/image');
const { remove } = require('../src');

const [, , input, output] = process.argv;

if (!input || !output) {
  console.error('usage: node examples/remove.js <input.png|jpg> <output.png>');
  process.exit(1);
}

const img = decode(fs.readFileSync(input), path.extname(input));
const result = remove(img);
fs.writeFileSync(output, encodePng(result));

console.log(
  JSON.stringify(
    {
      profile: result.detection.profile,
      box: result.detection.box,
      score: Number(result.detection.score.toFixed(4))
    },
    null,
    2
  )
);
