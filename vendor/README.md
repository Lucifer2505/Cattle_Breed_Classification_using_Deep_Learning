# vendor/: ONNX Runtime Web files

Not committed by default. They are added automatically by the GitHub Actions workflow
(`scripts/copy-runtime.sh`), or locally by running `sh scripts/copy-runtime.sh` once (needs npm).
Files needed: `ort.webgpu.min.mjs` and the `ort-wasm-simd-threaded*` `.wasm`/`.mjs` files.
The entry file name is set in `js/model-config.js` (`RUNTIME_CONFIG.entry`).
