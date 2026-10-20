# Verification checklist
PASS = actually run in this workspace. PENDING = needs real cattle photos, other devices, or additional platform checks.

## Confidence gate and result display
- [PASS] 39.61% -> red 2px-bordered panel with the exact text; no breed name anywhere in the result area or the screen-reader announcement.
- [PASS] 40.33% and 99.4% -> green panel with the breed name (plain text, no link); 40-60% adds a moderate-confidence note.
- [PASS] Hindi mode shows a Hindi version of the message. (If you need the English text in Hindi mode too, change `errIndistinct` in `js/i18n.js`.)
- [PENDING] Real score distribution: does 40% suit your photos? Tune `minConfidence` with real images.

## Themes and breed labels
- [PASS] Hindi display names are presentation-only; original `classes.json` labels and model output order remain unchanged.
- [PASS] Light and forest high-contrast themes are user-selectable with an icon-only button and the choice is saved locally.
- [PENDING] Review the forest theme on a real phone in bright sunlight and review Hindi strings with a native speaker.

## Removal and isolation
- [PASS] No directory, grid, `#breed-…` anchors or scroll-offset rules remain in the DOM or CSS.
- [PASS] Every class in the DOM and CSS starts with `cbi-`; every CSS rule is namespaced; the app scripts add no globals (compared with a plain page on the same origin).

## Feedback
- [PASS] Button 126x52 px; dialog becomes a bottom sheet on phones; payload contains the message plus device mode, display mode, viewport, screen, orientation, language, user agent; nothing else leaves the device.
- [PASS] Honeypot sends nothing; empty/offline/cooldown/server-error cases show messages and keep the typed text; placeholder key disables sending.
- [PENDING] A real submission to Web3Forms with your key; domain restriction/captcha settings in their dashboard.

## Deploy readiness
- [PASS] The two ordered weight chunks match the configured sizes and total the ONNX minimum; the pre-deploy check validates each.
- [PASS] Served from a sub-path (`/cattle-pwa/`): app, service worker (scope), offline reload, model download/cache all work.
- [PASS] `check-deploy.mjs` fails when vendor files or the weights are missing, and says why.
- [PENDING] The GitHub Actions workflow itself, `copy-runtime.sh` with the pinned runtime version, and the Hugging Face (or other) CORS download.

## Carried over from earlier phases (re-run on this build)
- [PASS] Offline shell, model download/stream into cache, cached restart and offline classify, eviction message, simulated quota error, network failure and retry, cancel, service-worker update clearing old caches.
- [PASS] Preprocessing matches a numpy/PIL reference exactly at 224x224; downscaling differs by a mean of about 1.6/255.
- [PASS] Real ONNX Runtime Web loaded the current chunks as `externalData`, created a WASM session, and ran one synthetic image: 50 finite logits; softmax sum was 1.0000000000000002.
- [PENDING] WebGPU support/fallback for this graph, real latency/memory (`?debug`), offline WASM-file caching, and end-to-end results on known cattle photos.
- [PENDING] Label order against the real weights: classify a known Gir photo; expect `Gir` (index 5).
- [PENDING] Real devices: camera, install-to-home-screen, other browsers, real quota/eviction, screen reader, Hindi review.
