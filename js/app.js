// Entry point. Everything lives inside init(), so nothing here is reachable from the global scope.
import { MODEL_CONFIG, APP_SETTINGS } from './model-config.js';
import { t, setLang, getLang, breedName } from './i18n.js';
import { decodeImage, softmax, topK } from './preprocess.js';
import * as engine from './inference.js';
import { createFeedback } from './feedback.js';

function init() {
  const $ = (id) => document.getElementById(id);
  const el = Object.fromEntries([
    'tabUpload', 'tabCamera', 'paneUpload', 'paneCamera', 'dropzone', 'fileInput', 'preview', 'previewImg', 'removeBtn', 'inputError',
    'classifyBtn', 'video', 'cameraBox', 'cameraMsg', 'cameraStart', 'capture', 'cameraStop', 'resultEmpty', 'resultBody',
    'resultError', 'resultErrorText', 'resultSuccess', 'bestLabel', 'bestPct', 'bestBar', 'bestMeter', 'cautionMsg', 'others',
    'resultHint', 'againBtn', 'debugInfo', 'srStatus', 'langBtn', 'modelStatus', 'modelStatusText', 'modelProgress', 'modelRetry',
    'modelDownload', 'modelCancel', 'modelRemove', 'modelNote', 'netBadge', 'feedbackFab', 'feedbackDialog', 'introBody', 'dropHint',
    'themeBtn',
  ].map((id) => [id, $(id)]));

  const state = { file: null, previewUrl: null, stream: null, labels: [], busy: false, lastResult: null, lastError: null, model: null, abort: null, cameraKey: null };
  const pct = (p) => Math.round(p * 100);
  const MB = (n) => (n / 1e6).toFixed(0);
  const NEED_MB = () => MB(MODEL_CONFIG.externalDataMinBytes);
  let feedback = null;

  /* ---------- text ---------- */
  function applyText() {
    document.querySelectorAll('[data-i18n]').forEach((n) => { n.textContent = t(n.dataset.i18n); });
    document.querySelectorAll('[data-i18n-aria]').forEach((n) => n.setAttribute('aria-label', t(n.dataset.i18nAria)));
    el.introBody.textContent = t('introBody', { n: state.labels.length || '' });
    el.dropHint.textContent = t('dropHint', { mb: APP_SETTINGS.maxFileBytes / 1048576 });
    el.langBtn.textContent = t('langSwitch');
    el.langBtn.setAttribute('aria-label', t('langSwitchLabel'));
    el.langBtn.lang = getLang() === 'en' ? 'hi' : 'en';
    const forestTheme = document.documentElement.dataset.theme === 'forest';
    el.themeBtn.querySelector('[data-theme-icon="forest"]').hidden = forestTheme;
    el.themeBtn.querySelector('[data-theme-icon="light"]').hidden = !forestTheme;
    const themeLabel = t(forestTheme ? 'themeSwitchToLight' : 'themeSwitchToForest');
    el.themeBtn.setAttribute('aria-label', themeLabel);
    el.themeBtn.title = themeLabel;
    el.themeBtn.setAttribute('aria-pressed', String(forestTheme));
    el.previewImg.alt = t('previewAlt');
    el.classifyBtn.textContent = state.busy ? t('classifying') : t('classify');
    if (!state.stream) el.cameraMsg.textContent = state.cameraKey ? t(state.cameraKey) : '';
    if (state.lastError) showError(state.lastError.key, state.lastError.vars);
    if (state.lastResult) renderResult(state.lastResult, false);
    feedback?.relabel();
    renderModel();
  }

  /* ---------- input ---------- */
  function showError(key, vars) { state.lastError = { key, vars }; el.inputError.textContent = t(key, vars); el.inputError.hidden = false; }
  function clearError() { state.lastError = null; el.inputError.hidden = true; }

  function validate(file) {
    if (!APP_SETTINGS.acceptedTypes.includes(file.type)) return ['errType', {}];
    if (file.size > APP_SETTINGS.maxFileBytes) return ['errSize', { size: (file.size / 1048576).toFixed(1), mb: APP_SETTINGS.maxFileBytes / 1048576 }];
    return null;
  }
  async function setFile(file) {
    clearError();
    const problem = validate(file);
    if (problem) return showError(...problem);
    try { (await decodeImage(file)).close?.(); } catch { return showError('errDecode'); }   // confirm it really decodes
    clearPreview();
    state.file = file; state.previewUrl = URL.createObjectURL(file);
    el.previewImg.src = state.previewUrl; el.preview.hidden = false;
    el.paneUpload.hidden = true; el.paneCamera.hidden = true; el.classifyBtn.disabled = false;
    hideResult();
  }
  function clearPreview() {
    if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
    state.previewUrl = null; state.file = null; el.previewImg.removeAttribute('src');
  }
  function resetInput() {
    clearPreview(); clearError(); stopCamera(); hideResult();
    el.fileInput.value = ''; el.preview.hidden = true; el.classifyBtn.disabled = true;
    selectTab(el.tabCamera.getAttribute('aria-selected') === 'true' ? 'camera' : 'upload');
  }
  el.fileInput.addEventListener('change', (e) => { const f = e.target.files[0]; if (f) setFile(f); });
  ['dragenter', 'dragover'].forEach((ev) => el.dropzone.addEventListener(ev, (e) => { e.preventDefault(); el.dropzone.classList.add('cbi-is-over'); }));
  ['dragleave', 'drop'].forEach((ev) => el.dropzone.addEventListener(ev, (e) => { e.preventDefault(); el.dropzone.classList.remove('cbi-is-over'); }));
  el.dropzone.addEventListener('drop', (e) => { const f = e.dataTransfer.files[0]; if (f) setFile(f); });
  el.removeBtn.addEventListener('click', resetInput);
  el.againBtn.addEventListener('click', resetInput);

  /* ---------- tabs (arrow keys per the ARIA tabs pattern) ---------- */
  function selectTab(which) {
    const cam = which === 'camera';
    el.tabUpload.setAttribute('aria-selected', String(!cam)); el.tabUpload.tabIndex = cam ? -1 : 0;
    el.tabCamera.setAttribute('aria-selected', String(cam)); el.tabCamera.tabIndex = cam ? 0 : -1;
    el.paneUpload.hidden = cam || !el.preview.hidden;
    el.paneCamera.hidden = !cam || !el.preview.hidden;
    if (!cam) stopCamera();
  }
  el.tabUpload.addEventListener('click', () => selectTab('upload'));
  el.tabCamera.addEventListener('click', () => selectTab('camera'));
  [el.tabUpload, el.tabCamera].forEach((tab) => tab.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const next = tab === el.tabUpload ? el.tabCamera : el.tabUpload;
    selectTab(next === el.tabCamera ? 'camera' : 'upload'); next.focus();
  }));

  /* ---------- camera ---------- */
  async function startCamera() {
    clearError();
    if (!navigator.mediaDevices?.getUserMedia) { state.cameraKey = 'cameraUnavailable'; el.cameraMsg.textContent = t(state.cameraKey); return; }
    try {
      state.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      el.video.srcObject = state.stream; await el.video.play();
      el.cameraBox.classList.add('cbi-is-live'); state.cameraKey = null;
      el.cameraStart.hidden = true; el.capture.hidden = false; el.cameraStop.hidden = false;
    } catch (err) {
      state.cameraKey = err.name === 'NotFoundError' ? 'cameraUnavailable' : 'cameraDenied';
      el.cameraMsg.textContent = t(state.cameraKey);
    }
  }
  function stopCamera() {
    state.stream?.getTracks().forEach((tr) => tr.stop());
    state.stream = null; el.video.srcObject = null;
    el.cameraBox.classList.remove('cbi-is-live');
    el.cameraStart.hidden = false; el.capture.hidden = true; el.cameraStop.hidden = true;
  }
  el.cameraStart.addEventListener('click', startCamera);
  el.cameraStop.addEventListener('click', stopCamera);
  el.capture.addEventListener('click', () => {
    const c = document.createElement('canvas');
    c.width = el.video.videoWidth; c.height = el.video.videoHeight;
    c.getContext('2d').drawImage(el.video, 0, 0);
    c.toBlob((blob) => {
      c.width = c.height = 0;                          // release the full-size capture buffer
      if (!blob) return showError('errDecode');
      stopCamera(); setFile(new File([blob], 'camera.jpg', { type: 'image/jpeg' }));
    }, 'image/jpeg', 0.92);
  });

  /* ---------- model panel ---------- */
  function errorMessage(err) {
    const d = err.detail || {};
    switch (err.code) {
      case 'RUNTIME_MISSING': return t('eRuntime');
      case 'MODEL_MISSING': return t('eModelMissing');
      case 'DATA_MISSING': return t('eDataMissing');
      case 'DATA_INCOMPLETE': return t('eDataIncomplete', { got: d.got.toLocaleString('en-US'), need: (d.need ?? d.minBytes ?? MODEL_CONFIG.externalDataMinBytes).toLocaleString('en-US') });
      case 'DATA_CHUNK_INVALID': return t('eDataChunk', { part: d.index + 1, got: d.got.toLocaleString('en-US'), need: d.need.toLocaleString('en-US') });
      case 'QUOTA': return t('eQuota', { need: NEED_MB() });
      case 'SESSION_FAILED': return t('eSession');
      case 'OFFLINE': return t('eOffline');
      case 'NETWORK': return t('eNetwork');
      default: return t('eInference');
    }
  }
  let lastPaint = 0;
  function renderModel(announce = false) {
    const m = state.model;
    el.modelStatus.hidden = !m;
    if (!m) return;
    const p = m.phase;
    el.modelStatus.classList.toggle('cbi-is-error', p === 'error');
    el.modelDownload.hidden = p !== 'missing';
    el.modelRetry.hidden = p !== 'error';
    el.modelCancel.hidden = p !== 'downloading';
    el.modelRemove.hidden = !(p === 'cached' || p === 'ready');
    el.modelProgress.hidden = !(p === 'downloading' && m.total);
    let text = '', note = '';
    if (p === 'checking') text = t('mChecking');
    else if (p === 'missing') { text = t(m.evicted ? 'mEvicted' : 'mMissing', { need: NEED_MB() }); note = t(m.noCache ? 'mNoteNoCache' : 'mRestartNote'); }
    else if (p === 'downloading') {
      el.modelProgress.value = m.total ? (m.done / m.total) * 100 : 0;
      text = t('mDownloading', { done: MB(m.done), total: MB(m.total || MODEL_CONFIG.externalDataMinBytes) }); note = t('mRestartNote');
    } else if (p === 'starting') text = t('mStarting');
    else if (p === 'cached') { text = t('mCached'); note = t('mNote'); }
    else if (p === 'ready') {
      text = t('mReadyOffline', { backend: t(m.backend === 'webgpu' ? 'mReadyWebgpu' : 'mReadyWasm') });
      note = engine.storeFailed() ? t('mNoteNoStore') : t('mNote');
      if (engine.storeFailed()) el.modelRemove.hidden = true;
    } else if (p === 'error') text = errorMessage(m.err);
    el.modelStatusText.textContent = text;
    el.modelNote.textContent = note; el.modelNote.hidden = !note;
    if (announce && p !== 'downloading') el.srStatus.textContent = text;       // phase changes only, never per-chunk progress
  }
  const hooks = {
    onProgress: (done, total) => {
      const now = performance.now();
      if (now - lastPaint < 150 && done < total) return;
      lastPaint = now; state.model = { phase: 'downloading', done, total }; renderModel();
    },
    onStatus: (phase) => { if (phase === 'starting') { state.model = { phase }; renderModel(true); } },
  };
  async function refreshModelState() {
    const s = await engine.getCacheStatus();
    if (engine.isReady()) state.model = { phase: 'ready', backend: engine.getBackend() };
    else if (s.model && s.data) state.model = { phase: 'cached' };
    else state.model = { phase: 'missing', evicted: engine.wasStored(), noCache: !s.supported };
    renderModel(true);
  }
  async function prepare() {
    if (state.abort) return;
    state.abort = new AbortController();
    const s = await engine.getCacheStatus();
    state.model = { phase: s.model && s.data ? 'starting' : 'downloading', done: 0, total: 0 }; renderModel();
    try {
      await engine.prepareModel({ ...hooks, signal: state.abort.signal });
      state.model = { phase: 'ready', backend: engine.getBackend() };
    } catch (err) {
      if (err.code === 'ABORTED') { state.abort = null; await refreshModelState(); return; }
      console.error(err); state.model = { phase: 'error', err }; throw err;
    } finally { state.abort = null; renderModel(true); }
  }
  el.modelDownload.addEventListener('click', () => prepare().catch(() => {}));
  el.modelRetry.addEventListener('click', () => prepare().catch(() => {}));
  el.modelCancel.addEventListener('click', () => state.abort?.abort());
  el.modelRemove.addEventListener('click', async () => { await engine.removeModel(); state.model = null; await refreshModelState(); });
  const updateNet = () => { el.netBadge.hidden = navigator.onLine !== false; };
  window.addEventListener('online', updateNet); window.addEventListener('offline', updateNet);

  /* ---------- result + confidence gate ---------- */
  function hideResult() { state.lastResult = null; el.resultBody.hidden = true; el.resultEmpty.hidden = false; }

  /** The gate: strictly below the minimum confidence, no breed name is shown anywhere. */
  const passesGate = (best) => best.probability >= APP_SETTINGS.minConfidence;

  function renderResult(top, announce = true) {
    const best = top[0];
    const ok = passesGate(best);
    el.resultEmpty.hidden = true; el.resultBody.hidden = false;
    el.resultError.hidden = ok; el.resultSuccess.hidden = !ok;
    if (!ok) {
      el.resultErrorText.textContent = t('errIndistinct');
      el.resultHint.textContent = t('hintClearer');
      el.bestLabel.textContent = ''; el.others.replaceChildren(); el.cautionMsg.hidden = true;
      if (announce) el.srStatus.textContent = t('errIndistinct');
      return;
    }
    const bestName = breedName(best.label);
    el.bestLabel.textContent = bestName;
    el.bestPct.textContent = `${pct(best.probability)}%`;
    el.bestBar.style.width = `${pct(best.probability)}%`;
    const moderate = best.probability < APP_SETTINGS.cautionConfidence;
    el.bestMeter.classList.toggle('cbi-is-low', moderate);
    el.cautionMsg.hidden = !moderate;
    el.cautionMsg.textContent = t('cautionModerate', { pct: pct(best.probability) });
    el.others.replaceChildren(...top.slice(1).map((r) => {
      const li = document.createElement('li');
      li.append(Object.assign(document.createElement('span'), { textContent: breedName(r.label) }),
                Object.assign(document.createElement('span'), { textContent: `${pct(r.probability)}%` }));
      return li;
    }));
    el.resultHint.textContent = t('thresholdNote', { thr: pct(APP_SETTINGS.minConfidence) });
    if (announce) el.srStatus.textContent = t('announceResult', { label: bestName, pct: pct(best.probability) });
  }

  const DEBUG = new URLSearchParams(location.search).has('debug');          // add ?debug to the URL for timings
  function showTimings() {
    if (!DEBUG) return;
    const f = (v) => (v == null ? '–' : `${Math.round(v)} ms`); const tm = engine.timings;
    el.debugInfo.textContent = `${engine.getBackend()} · files ${f(tm.files)} · session ${f(tm.session)} · preprocess ${f(tm.preprocess)} · inference ${f(tm.run)}`
      + (performance.memory ? ` · JS heap ${(performance.memory.usedJSHeapSize / 1048576).toFixed(0)} MB` : '');
    el.debugInfo.hidden = false;
  }

  el.classifyBtn.addEventListener('click', async () => {
    if (!state.file || state.busy) return;
    clearError(); state.busy = true; el.classifyBtn.disabled = true; el.classifyBtn.textContent = t('classifying');
    try {
      const bitmap = await decodeImage(state.file);
      if (!engine.isReady()) { await prepare(); if (!engine.isReady()) return; }   // lazy: runtime + model load on first use
      const logits = await engine.classify(bitmap, state.labels, hooks);
      if (logits.length !== state.labels.length) throw new Error(`Model returned ${logits.length} scores for ${state.labels.length} labels`);
      state.lastResult = topK(softmax(logits), state.labels, APP_SETTINGS.topK);
      state.model = { phase: 'ready', backend: engine.getBackend() }; renderModel();
      renderResult(state.lastResult); showTimings();
    } catch (err) {
      console.error(err);
      if (err.code === 'ABORTED') { /* user cancelled */ }
      else if (err.code === 'DECODE_FAILED') showError('errDecode');
      else if (err.code === 'INFERENCE_FAILED' || !err.code) showError('eInference');
      // other model errors are already shown, with a retry button, in the model panel
    } finally { state.busy = false; el.classifyBtn.disabled = !state.file; el.classifyBtn.textContent = t('classify'); }
  });

  /* ---------- language + startup ---------- */
  el.langBtn.addEventListener('click', () => { setLang(getLang() === 'en' ? 'hi' : 'en'); applyText(); });
  el.themeBtn.addEventListener('click', () => {
    const theme = document.documentElement.dataset.theme === 'forest' ? 'light' : 'forest';
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('cbi-theme', theme); } catch { /* storage can be unavailable */ }
    document.querySelector('meta[name="theme-color"]').content = theme === 'forest' ? '#0b1110' : '#3f6b3c';
    applyText();
  });

  (async function start() {
    setLang(getLang());
    let savedTheme = 'light';
    try {
      const storedTheme = localStorage.getItem('cbi-theme');
      savedTheme = storedTheme === 'forest' || storedTheme === 'outdoor' ? 'forest' : 'light';
    } catch { /* storage can be unavailable */ }
    document.documentElement.dataset.theme = savedTheme;
    document.querySelector('meta[name="theme-color"]').content = savedTheme === 'forest' ? '#0b1110' : '#3f6b3c';
    feedback = createFeedback({ fab: el.feedbackFab, dialog: el.feedbackDialog });
    applyText(); updateNet();
    try {
      const res = await fetch(MODEL_CONFIG.classesUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = await res.json();
      state.labels = Array.isArray(raw) ? raw.map(String) : Object.keys(raw);    // order = model output order; never re-sorted
    } catch (err) { console.error('classes.json failed to load', err); }
    applyText();
    state.model = { phase: 'checking' }; renderModel();
    refreshModelState();
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('Service worker not registered', e));
  })();
}

init();
