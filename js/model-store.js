// Stores the large model files in the Cache API (never localStorage). Only complete downloads
// are ever written, so an interrupted download leaves nothing behind and restarts from zero.
import { MODEL_CONFIG } from './model-config.js';
import { ModelError } from './errors.js';

const FLAG = 'cattle.modelStoredAt';   // tiny "we stored it once" marker, used only to tell "evicted" from "never downloaded"
const abs = (u) => new URL(u, document.baseURI).href;
export const cacheSupported = () => 'caches' in self;
const open = () => caches.open(MODEL_CONFIG.cacheName);

export function wasStored() { try { return !!localStorage.getItem(FLAG); } catch { return false; } }
const setFlag = (on) => { try { on ? localStorage.setItem(FLAG, String(Date.now())) : localStorage.removeItem(FLAG); } catch { /* ignore */ } };

export async function getCacheStatus() {
  if (!cacheSupported()) return { supported: false, model: false, data: false };
  try {
    if (!(await caches.has(MODEL_CONFIG.cacheName))) return { supported: true, model: false, data: false };   // don't create an empty bucket
    const c = await open();
    const m = await c.match(abs(MODEL_CONFIG.modelUrl));
    const parts = await Promise.all(MODEL_CONFIG.externalDataUrls.map((url) => c.match(abs(url))));
    const sizes = await Promise.all(parts.map((part) => part ? part.blob().then((blob) => blob.size) : 0));
    const bytes = sizes.reduce((sum, size) => sum + size, 0);
    return {
      supported: true,
      model: !!m,
      data: parts.every(Boolean) && sizes.every((size, index) => size === MODEL_CONFIG.externalDataChunkBytes[index]),
      dataBytes: bytes,
    };
  } catch { return { supported: false, model: false, data: false }; }
}

/** Returns a Blob from the cache, or null if absent. */
export async function readCached(url) {
  if (!cacheSupported()) return null;
  const r = await (await open()).match(abs(url));
  return r ? r.blob() : null;
}

export async function removeCached() {
  setFlag(false);
  if (cacheSupported()) await caches.delete(MODEL_CONFIG.cacheName);
}

export async function storageEstimate() {
  try { const e = await navigator.storage.estimate(); return { usage: e.usage ?? 0, quota: e.quota ?? 0 }; } catch { return null; }
}
/** Asks the browser to treat storage as persistent. The browser may refuse; the result is not a guarantee. */
export async function requestPersistence() {
  try { return (await navigator.storage?.persist?.()) ?? null; } catch { return null; }
}

async function openResponse(url, code, signal) {
  let res;
  try { res = await fetch(url, { cache: 'no-store', signal }); }
  catch (e) {
    if (e?.name === 'AbortError') throw new ModelError('ABORTED');
    throw new ModelError(navigator.onLine === false ? 'OFFLINE' : 'NETWORK', { file: code, cause: String(e) });
  }
  if (res.status === 404) throw new ModelError(`${code}_MISSING`, { url });
  if (!res.ok) throw new ModelError('NETWORK', { file: code, status: res.status });
  // Dev servers with an SPA fallback answer unknown paths with index.html and status 200.
  if ((res.headers.get('content-type') || '').includes('text/html')) throw new ModelError(`${code}_MISSING`, { url, html: true });
  return res;
}

const netError = (e, code, signal) => signal?.aborted || e?.name === 'AbortError'
  ? new ModelError('ABORTED')
  : new ModelError(navigator.onLine === false ? 'OFFLINE' : 'NETWORK', { file: code, interrupted: true, cause: String(e) });

/** Fallback when the Cache API is unavailable: hold the download in memory. */
async function downloadToMemory(res, code, { minBytes, total, onProgress, signal }) {
  const chunks = []; let got = 0;
  try {
    const reader = res.body.getReader();
    for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); got += value.length; onProgress?.(got, total); }
  } catch (e) { throw netError(e, code, signal); }
  if (got < minBytes) throw new ModelError(`${code}_INCOMPLETE`, { got, minBytes });
  return new Blob(chunks);
}

/**
 * Downloads `url` and stores it in the Cache API, streaming the body straight into the cache so the
 * file is never held in JavaScript memory while downloading. If the stream fails, nothing is stored.
 * Returns a Blob. Codes: OFFLINE, NETWORK, <CODE>_MISSING, <CODE>_INCOMPLETE, QUOTA, ABORTED.
 */
export async function downloadToCache(url, code, { minBytes = 0, expectedTotal = 0, onProgress, signal } = {}) {
  const full = abs(url);
  const res = await openResponse(full, code, signal);
  const total = Number(res.headers.get('content-length')) || expectedTotal;
  if (!cacheSupported()) return downloadToMemory(res, code, { minBytes, total, onProgress, signal });

  const reader = res.body.getReader();
  let got = 0, srcErr = null;
  const body = new ReadableStream({
    async pull(ctrl) {
      try {
        const { done, value } = await reader.read();
        if (done) return ctrl.close();
        got += value.length; onProgress?.(got, total); ctrl.enqueue(value);
      } catch (e) { srcErr = e; ctrl.error(e); }
    },
    cancel(reason) { return reader.cancel(reason); },
  });

  const cache = await open();
  try {
    await cache.put(full, new Response(body, { headers: { 'content-type': 'application/octet-stream' } }));
  } catch (e) {
    try { await cache.delete(full); } catch { /* ignore */ }
    reader.cancel().catch(() => {});
    if (srcErr || signal?.aborted) throw netError(srcErr ?? e, code, signal);
    if (e?.name === 'QuotaExceededError') throw new ModelError('QUOTA', { file: code });
    // Unknown storage failure (e.g. a browser that rejects stream bodies): download again into memory, don't store.
    console.warn('Model could not be stored for offline use', e);
    downloadToCache.storeFailed = true;
    return downloadToMemory(await openResponse(full, code, signal), code, { minBytes, total, onProgress, signal });
  }
  if (got < minBytes) {
    try { await cache.delete(full); } catch { /* ignore */ }
    throw new ModelError(`${code}_INCOMPLETE`, { got, minBytes });
  }
  return (await cache.match(full)).blob();
}

export function markStored() { setFlag(true); }
