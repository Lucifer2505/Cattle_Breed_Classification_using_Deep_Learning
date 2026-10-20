import { MODEL_CONFIG, RUNTIME_CONFIG } from './model-config.js';
import { bitmapToTensorData } from './preprocess.js';
import { ModelError } from './errors.js';
import * as store from './model-store.js';

export { ModelError };

let ort = null;          // runtime module, loaded lazily
let session = null;      // reused across classifications
let backend = null;      // 'webgpu' | 'wasm'
let pending = null;      // in-flight prepare, so concurrent callers share one load

/** Milliseconds for the last load/classify. Shown only with ?debug in the URL. */
export const timings = {};

export const getBackend = () => backend;
export const isReady = () => session !== null;
export const getCacheStatus = store.getCacheStatus;
export const wasStored = store.wasStored;
export const storeFailed = () => !!store.downloadToCache.storeFailed;

async function loadRuntime() {
  if (ort) return ort;
  // Resolve against the page, not this file: config paths are written relative to index.html.
  try { ort = await import(/* @vite-ignore */ new URL(RUNTIME_CONFIG.entry, document.baseURI).href); }
  catch (e) { throw new ModelError('RUNTIME_MISSING', { cause: String(e) }); }
  ort.env.wasm.wasmPaths = new URL(RUNTIME_CONFIG.wasmPaths, document.baseURI).href;
  // Multi-threaded WASM needs SharedArrayBuffer, i.e. cross-origin isolation.
  ort.env.wasm.numThreads = self.crossOriginIsolated
    ? Math.min(RUNTIME_CONFIG.maxWasmThreads, navigator.hardwareConcurrency || 1) : 1;
  return ort;
}

/** Cache first; download (and store) only when absent or too small. */
async function getFile(url, code, opts) {
  let blob = null;
  try { blob = await store.readCached(url); } catch { /* treat as missing */ }
  if (blob && blob.size >= (opts.minBytes || 1)) return new Uint8Array(await blob.arrayBuffer());
  blob = await store.downloadToCache(url, code, opts);
  return new Uint8Array(await blob.arrayBuffer());
}

async function checkRoomFor(bytes) {
  const est = await store.storageEstimate();
  if (est && est.quota && est.quota - est.usage < bytes * 1.05) throw new ModelError('QUOTA', { quota: est.quota, usage: est.usage });
}

async function loadFiles({ onProgress, onStatus, signal }) {
  const status = await store.getCacheStatus();
  if (!status.data) await checkRoomFor(Math.max(0, MODEL_CONFIG.externalDataMinBytes - status.dataBytes));
  onStatus?.(status.model && status.data ? 'starting' : 'downloading');
  const model = await getFile(MODEL_CONFIG.modelUrl, 'MODEL', { signal });
  const parts = [];
  let loaded = 0;
  for (const [index, url] of MODEL_CONFIG.externalDataUrls.entries()) {
    const part = await getFile(url, 'DATA', {
      signal,
      minBytes: MODEL_CONFIG.externalDataChunkBytes[index],
      expectedTotal: MODEL_CONFIG.externalDataChunkBytes[index],
      onProgress: (done) => onProgress?.(loaded + done, MODEL_CONFIG.externalDataMinBytes),
    });
    if (part.byteLength !== MODEL_CONFIG.externalDataChunkBytes[index]) {
      throw new ModelError('DATA_CHUNK_INVALID', {
        index,
        got: part.byteLength,
        need: MODEL_CONFIG.externalDataChunkBytes[index],
      });
    }
    parts.push(part);
    loaded += part.byteLength;
    onProgress?.(loaded, MODEL_CONFIG.externalDataMinBytes);
  }
  if (loaded < MODEL_CONFIG.externalDataMinBytes) {
    throw new ModelError('DATA_INCOMPLETE', { got: loaded, need: MODEL_CONFIG.externalDataMinBytes });
  }
  const data = new Uint8Array(loaded);
  let offset = 0;
  for (const part of parts) { data.set(part, offset); offset += part.byteLength; }
  if (!status.data) { await store.requestPersistence(); store.markStored(); }
  return { model, data };
}

async function createSession(provider, { model, data }, onStatus) {
  onStatus?.('starting');
  try {
    return await ort.InferenceSession.create(model, {
      executionProviders: [provider],
      graphOptimizationLevel: 'all',
      // `path` must equal the `location` string stored inside the .onnx (verified).
      externalData: [{ path: MODEL_CONFIG.externalDataPath, data }],
    });
  } catch (e) { throw new ModelError('SESSION_FAILED', { provider, cause: String(e) }); }
}

const webgpuUsable = async () => { try { return !!navigator.gpu && !!(await navigator.gpu.requestAdapter()); } catch { return false; } };

/** Idempotent. Loads runtime + model (from cache when stored), WebGPU first, WASM fallback. */
export function prepareModel({ onProgress, onStatus, signal, forceProvider } = {}) {
  if (session) return Promise.resolve(backend);
  if (pending) return pending;
  pending = (async () => {
    await loadRuntime();
    const order = forceProvider ? [forceProvider] : RUNTIME_CONFIG.providers;
    let lastErr;
    const tFiles = performance.now();
    let files = await loadFiles({ onProgress, onStatus, signal });   // read/downloaded once, reused across providers
    timings.files = performance.now() - tFiles;
    for (const provider of order) {
      if (provider === 'webgpu' && !(await webgpuUsable())) continue;
      try {
        const tSess = performance.now();
        session = await createSession(provider, files, onStatus); backend = provider; files = null;
        timings.session = performance.now() - tSess;
        return backend;
      }
      catch (e) {
        lastErr = e;
        if (!(e instanceof ModelError) || e.code !== 'SESSION_FAILED') throw e;   // file problems aren't fixed by switching provider
        console.warn(`${provider} session failed, trying next`, e.detail);
      }
    }
    throw lastErr ?? new ModelError('NO_PROVIDER');
  })().finally(() => { pending = null; });
  return pending;
}

/** Frees the session and deletes stored model files. */
export async function removeModel() {
  try { await session?.release?.(); } catch { /* ignore */ }
  session = null; backend = null;
  await store.removeCached();
}

async function runOnce(tensorData) {
  const input = new ort.Tensor('float32', tensorData, [1, 3, MODEL_CONFIG.inputSize, MODEL_CONFIG.inputSize]);
  try {
    const out = await session.run({ [MODEL_CONFIG.inputName]: input });
    const t = out[MODEL_CONFIG.outputName];
    const logits = Float32Array.from(await t.getData());
    t.dispose?.();
    return logits;
  } finally { input.dispose?.(); }
}

export async function classify(bitmap, labels, hooks = {}) {
  const t0 = performance.now();
  const tensorData = bitmapToTensorData(bitmap);   // closes the full-size bitmap
  timings.preprocess = performance.now() - t0;
  await prepareModel(hooks);
  try { const t1 = performance.now(); const out = await runOnce(tensorData); timings.run = performance.now() - t1; return out; }
  catch (e) {
    if (backend !== 'webgpu') throw new ModelError('INFERENCE_FAILED', { cause: String(e) });
    // WebGPU can fail at run time (driver/op issues): rebuild on WASM (files now come from the cache) and retry once.
    console.warn('WebGPU run failed, falling back to WASM', e);
    try { await session.release?.(); } catch { /* ignore */ }
    session = null; backend = null;
    await prepareModel({ ...hooks, forceProvider: 'wasm' });
    try { return await runOnce(tensorData); }
    catch (e2) { throw new ModelError('INFERENCE_FAILED', { cause: String(e2) }); }
  }
}
