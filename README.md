# gemini-watermark-remover

Remove the **visible** Gemini watermark — the white sparkle in the bottom-right corner — from an image, locally, by reversing the alpha blend that put it there.

No upload, no account, no network calls. Pure JavaScript, runs in Node.

## What it does

Gemini composites a white logo over the bottom-right corner of the image:

```
watermarked = alpha * 255 + (1 - alpha) * original
```

If you know `alpha` and where the logo sits, you can invert it:

```
original = (watermarked - alpha * 255) / (1 - alpha)
```

This package ships the two alpha captures Gemini uses, predicts the box from the
image dimensions, fine-aligns it, and runs the inverse blend on that box only.
Pixels outside the box are never touched.

## What it does not do

- **SynthID** — the invisible watermark is not touched. It is not in the pixels this code edits.
- **C2PA / EXIF / XMP** — metadata is not touched.
- **Other watermarks** — only the two Gemini layouts below are supported. Stock-photo
  overlays, text watermarks, CapCut/Filmora marks and other vendors' marks are out of scope.
- **Guaranteed detection** — the score is a correlation, not a certainty. Check
  `detection.score` and `detection.box` before trusting a result on an unknown image.

## Install

```bash
npm install
```

## CLI

```bash
node examples/remove.js input.png output.png
```

It prints the profile, the box it used, and the alignment score:

```json
{
  "profile": "V2",
  "box": { "x": 917, "y": 661, "size": 36 },
  "score": 0.9821
}
```

## API

```js
const fs = require('fs');
const { decode, remove, encodePng } = require('gemini-watermark-remover');

const img = decode(fs.readFileSync('input.png'), '.png');
const out = remove(img);

fs.writeFileSync('output.png', encodePng(out));
console.log(out.detection);
```

`remove(img, opts)` returns `{ data, width, height, detection }` and never mutates the input.

| option | default | meaning |
|---|---|---|
| `radius` | `12` | how far the box may slide while aligning, in pixels |
| `strength` | `1` | alpha multiplier, `0..1`; lower is gentler |
| `threshold` | `0.02` | skip pixels whose alpha is below this |

## Geometry

| profile | image | logo | margin |
|---|---|---|---|
| V1 legacy | small | 48 px | 32 px |
| V1 legacy | large (both sides > 1024) | 96 px | 64 px |
| V2 current | small | 36–48 px | ≈192 × scale |
| V2 current | large (both sides > 1024) | 96 px | 192 px |

`detect()` evaluates both profiles and keeps the one with the higher correlation.

## Test

```bash
npm test
```

The test does not need a real Gemini image. It builds a deterministic base image,
applies the watermark with the same alpha and geometry, removes it, and compares
the result to the base. If the blend and the geometry agree, the error is only rounding.

```
PASS  V2 small  1024x768  profile=V2  score=1.0000  mae=0.4xx
PASS  V2 large  1400x1100 profile=V2  score=1.0000  mae=0.4xx
PASS  V1 small  800x600   profile=V1  score=1.0000  mae=0.4xx
```

## Web version

A browser version that runs entirely in the tab, with no install, is at
https://watermarkremoverhub.com/

## Credits

The four alpha captures in `assets/` come from
[GeminiWatermarkTool](https://github.com/allenk/GeminiWatermarkTool) by AllenK (Kwyshell),
MIT License. The reverse-blend model and the geometry constants follow the same
upstream implementation.

## License

MIT. See `LICENSE`.
