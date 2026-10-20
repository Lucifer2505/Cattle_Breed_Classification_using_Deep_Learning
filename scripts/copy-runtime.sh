#!/usr/bin/env sh
# Copies ONNX Runtime Web into vendor/. Needs npm. Fails loudly if an expected file is missing.
# Override the version with:  ORT_VERSION=1.xx.x sh scripts/copy-runtime.sh
set -e
ORT_VERSION="${ORT_VERSION:-1.22.0}"     # pinned; not verified in the environment this project was written in
tmp=$(mktemp -d)
( cd "$tmp" && npm init -y >/dev/null && npm install --no-audit --no-fund "onnxruntime-web@$ORT_VERSION" )
dist="$tmp/node_modules/onnxruntime-web/dist"
[ -f "$dist/ort.webgpu.min.mjs" ] || { echo "ERROR: ort.webgpu.min.mjs not found in onnxruntime-web@$ORT_VERSION" >&2; exit 1; }
mkdir -p vendor
cp "$dist"/ort.webgpu.min.mjs vendor/
cp "$dist"/ort-wasm-simd-threaded*.wasm vendor/
cp "$dist"/ort-wasm-simd-threaded*.mjs vendor/ 2>/dev/null || true
ls vendor/*.wasm >/dev/null 2>&1 || { echo "ERROR: no .wasm files copied" >&2; exit 1; }
echo "Installed onnxruntime-web $ORT_VERSION:"; ls -la vendor
rm -rf "$tmp"
