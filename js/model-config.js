// Single place for everything model-related that can change.
// Values marked VERIFIED were read from the supplied files (see README, "What was verified").

export const MODEL_CONFIG = {
  // URLs are resolved relative to the page. These ordered chunks reconstruct the external data file.
  modelUrl: './models/cattle_breeds.onnx',
  externalDataUrls: [
    './models/cattle_breeds.onnx.data.0',
    './models/cattle_breeds.onnx.data.1',
  ],
  externalDataChunkBytes: [56165836, 56165836],
  externalDataPath: 'cattle_breeds.onnx.data',
  // VERIFIED: all 177 external initializers use location = "cattle_breeds.onnx.data".
  classesUrl: './models/classes.json',
  // Cache API bucket for the two large files. Change the suffix if the model is ever replaced
  // (sw.js removes unknown cattle-* caches; keep the name in sync with KEEP in sw.js).
  cacheName: 'cattle-model-v2',

  // VERIFIED from the .onnx graph.
  inputName: 'images',            // float32 [1, 3, 224, 224], fixed batch of 1
  outputName: 'logits',           // float32 [1, 50], raw logits (softmax is applied in the app)
  inputSize: 224,
  // From the re-exported model: its external-data references reach byte 112,331,672, so the file can't be smaller.
  // If you export the model again, set this to the number export_onnx.py prints (or use its --update-config).
  externalDataMinBytes: 112331672,

  // VERIFIED from train.py ('val' transforms): RGB, Resize((224,224)) with no crop,
  // /255, then ImageNet mean/std, channel-first.
  mean: [0.485, 0.456, 0.406],
  std: [0.229, 0.224, 0.225],
  // NOT matchable exactly: training did not apply EXIF rotation, browsers do by default.
  // 'from-image' = honour EXIF (what users expect to see); 'none' = closest to training.
  imageOrientation: 'from-image',
};

// ONNX Runtime Web is self-hosted so the app can start offline. See vendor/README.md.
export const RUNTIME_CONFIG = {
  entry: './vendor/ort.webgpu.min.mjs',   // bundle containing both the WebGPU and WASM providers
  wasmPaths: './vendor/',
  providers: ['webgpu', 'wasm'],          // tried in this order
  maxWasmThreads: 4,                      // only used when the page is cross-origin isolated
};

export const APP_SETTINGS = {
  // Application settings, not calibrated probabilities.
  // Below minConfidence (strictly) no breed name is shown at all.
  minConfidence: 0.40,
  // From minConfidence up to this value the breed is shown with a "moderate confidence" note.
  cautionConfidence: 0.60,
  topK: 3,
  maxFileBytes: 10 * 1024 * 1024,
  acceptedTypes: ['image/jpeg', 'image/png', 'image/webp'],
};
