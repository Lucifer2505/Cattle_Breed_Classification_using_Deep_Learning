// Floating feedback button + modal dialog, sent straight from the browser to Web3Forms.
// No photos, predictions or personal data are collected: only what the user types plus basic device info.
import { FEEDBACK_CONFIG, isConfigured } from './feedback-config.js';
import { t, getLang } from './i18n.js';

const COOLDOWN_KEY = 'cbi.feedbackLastSent';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Device facts attached to every message. Contains no photo, prediction or identifier. */
export function collectMeta() {
  const w = window.innerWidth;
  const size = w < 600 ? 'mobile' : w < 1024 ? 'tablet' : 'desktop';
  const touch = matchMedia('(pointer: coarse)').matches ? 'touch' : 'pointer';
  const installed = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  return {
    device_mode: `${size} (${touch})`,
    display_mode: installed ? 'installed app' : 'browser tab',
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    screen: `${screen.width}x${screen.height}`,
    pixel_ratio: String(window.devicePixelRatio || 1),
    orientation: screen.orientation?.type || (window.innerWidth > window.innerHeight ? 'landscape' : 'portrait'),
    user_agent: navigator.userAgent,
    app_language: getLang(),
    online: String(navigator.onLine),
    page: location.origin + location.pathname,
    sent_at: new Date().toISOString(),
  };
}

export function createFeedback({ fab, dialog }) {
  const q = (name) => dialog.querySelector(`[data-fb="${name}"]`);
  const form = q('form'), type = q('type'), message = q('message'), email = q('email'), trap = q('botcheck');
  const send = q('send'), status = q('status'), counter = q('counter'), done = q('done'), closeBtns = dialog.querySelectorAll('[data-fb="close"]');
  let openedAt = 0; let sending = false;

  const lastSent = () => Number(sessionStorage.getItem(COOLDOWN_KEY) || 0);
  const setStatus = (key, vars, kind = 'error') => {
    status.hidden = !key; status.textContent = key ? t(key, vars) : '';
    status.dataset.kind = kind; status.dataset.key = key || '';
  };

  function refresh() {
    const offline = navigator.onLine === false;
    send.disabled = sending || offline || !isConfigured();
    if (!isConfigured()) setStatus('fbErrConfig');
    else if (offline) setStatus('fbErrOffline');
    else if (status.dataset.key === 'fbErrOffline' || status.dataset.key === 'fbErrConfig') setStatus(null);
    counter.textContent = `${message.value.length} / ${FEEDBACK_CONFIG.maxMessageChars}`;
  }

  function open() {
    done.hidden = true; form.hidden = false;
    setStatus(null); openedAt = Date.now();
    document.documentElement.classList.add('cbi-scroll-lock');
    if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
    refresh(); message.focus();
  }
  function close() {
    if (dialog.open) { if (typeof dialog.close === 'function') dialog.close(); else dialog.removeAttribute('open'); }
  }
  dialog.addEventListener('close', () => document.documentElement.classList.remove('cbi-scroll-lock'));
  dialog.addEventListener('click', (e) => { if (e.target === dialog) close(); });   // tap on the backdrop
  fab.addEventListener('click', open);
  closeBtns.forEach((b) => b.addEventListener('click', close));
  message.addEventListener('input', refresh);
  window.addEventListener('online', refresh); window.addEventListener('offline', refresh);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (sending) return;
    const text = message.value.trim();
    if (text.length < 5) { setStatus('fbErrEmpty'); message.focus(); return; }
    if (!email.checkValidity()) { setStatus('fbErrEmail'); email.focus(); return; }
    if (!isConfigured()) { setStatus('fbErrConfig'); return; }
    if (navigator.onLine === false) { setStatus('fbErrOffline'); return; }
    if (Date.now() - lastSent() < FEEDBACK_CONFIG.cooldownMs) { setStatus('fbErrCooldown'); return; }

    sending = true; refresh(); send.textContent = t('fbSending'); setStatus(null);
    try {
      if (trap.checked) { showDone(); return; }                         // bots fill the hidden box: pretend success, send nothing
      const wait = FEEDBACK_CONFIG.minFillMs - (Date.now() - openedAt);  // never reject a fast human, just wait
      if (wait > 0) await sleep(wait);

      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), FEEDBACK_CONFIG.timeoutMs);
      let res;
      try {
        res = await fetch(FEEDBACK_CONFIG.endpoint, {
          method: 'POST', signal: ctrl.signal,
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            access_key: FEEDBACK_CONFIG.accessKey,
            subject: FEEDBACK_CONFIG.subject,
            from_name: FEEDBACK_CONFIG.fromName,
            botcheck: '',
            category: type.value,
            message: text.slice(0, FEEDBACK_CONFIG.maxMessageChars),
            ...(email.value.trim() ? { email: email.value.trim() } : {}),
            ...collectMeta(),
          }),
        });
      } finally { clearTimeout(timer); }
      const data = await res.json().catch(() => null);
      if (res.ok && data?.success) { sessionStorage.setItem(COOLDOWN_KEY, String(Date.now())); showDone(); }
      else setStatus('fbErrServer');
    } catch (err) {
      console.warn('Feedback not sent', err);
      setStatus(navigator.onLine === false ? 'fbErrOffline' : 'fbErrNetwork');
    } finally { sending = false; send.textContent = t('fbSend'); refresh(); }
  });

  function showDone() { form.reset(); form.hidden = true; done.hidden = false; setStatus(null); done.querySelector('button')?.focus(); }

  return { relabel: refresh, open, close };
}
