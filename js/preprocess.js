import { MODEL_CONFIG } from './model-config.js';

/** Decode a File/Blob into an ImageBitmap (applies EXIF rotation per config). */
export async function decodeImage(file) {
  try {
    return await createImageBitmap(file, { imageOrientation: MODEL_CONFIG.imageOrientation });
  } catch {
    const err = new Error('decode');
    err.code = 'DECODE_FAILED';
    throw err;
  }
}

/**
 * Mirrors train.py 'val' pipeline: RGB -> Resize((224,224)) (squash, no crop) ->
 * ToTensor (/255) -> Normalize(mean, std) -> NCHW float32.
 * The full-size bitmap is closed as soon as it has been drawn into the 224x224 canvas.
 */
export function bitmapToTensorData(bitmap) {
  const size = MODEL_CONFIG.inputSize;
  const canvas = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(size, size)
    : Object.assign(document.createElement('canvas'), { width: size, height: size });
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, size, size);
  bitmap.close?.();

  const { data } = ctx.getImageData(0, 0, size, size); // RGBA, 0..255
  const plane = size * size;
  const out = new Float32Array(3 * plane);
  const { mean, std } = MODEL_CONFIG;
  for (let i = 0; i < plane; i++) {
    const p = i * 4;
    out[i] = (data[p] / 255 - mean[0]) / std[0];
    out[plane + i] = (data[p + 1] / 255 - mean[1]) / std[1];
    out[2 * plane + i] = (data[p + 2] / 255 - mean[2]) / std[2];
  }
  return out;
}

export function softmax(logits) {
  let max = -Infinity;
  for (const v of logits) if (v > max) max = v;
  const exps = Array.from(logits, (v) => Math.exp(v - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((v) => v / sum);
}

export function topK(probs, labels, k) {
  return probs
    .map((p, i) => ({ index: i, label: labels[i], probability: p }))
    .sort((a, b) => b.probability - a.probability)
    .slice(0, k);
}
