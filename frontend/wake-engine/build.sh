#!/usr/bin/env bash
# Rebuilds the wake word's engine in frontend/public/wake from its sources (see README.md here). About 20 minutes and
# 2 GB of downloads the first time (emsdk, sherpa-onnx, onnxruntime's WebAssembly library, the model). Needs git, curl,
# cmake (3.x), make, python3 and gzip. Run from anywhere; WORK keeps the downloads between runs.
set -euo pipefail

SHERPA_TAG=v1.13.8            # k2-fsa/sherpa-onnx, commit 11afbd009a7f8c08f4bcf2fc1b265d0df4670fbf
EMSDK_VERSION=4.0.23          # the version sherpa-onnx's build-wasm-simd-kws.sh names as known to work
MODEL=sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01
MODEL_URL=https://github.com/k2-fsa/sherpa-onnx/releases/download/kws-models/$MODEL.tar.bz2

here=$(cd "$(dirname "$0")" && pwd)
out=$here/../public/wake
WORK=${WORK:-$here/.build}
mkdir -p "$WORK"
cd "$WORK"

[ -d emsdk ] || git clone --depth 1 https://github.com/emscripten-core/emsdk.git
(cd emsdk && ./emsdk install "$EMSDK_VERSION" && ./emsdk activate "$EMSDK_VERSION") >/dev/null
# shellcheck disable=SC1091
source emsdk/emsdk_env.sh >/dev/null 2>&1

[ -d sherpa-onnx ] || git clone --depth 1 --branch "$SHERPA_TAG" https://github.com/k2-fsa/sherpa-onnx.git
[ -d "$MODEL" ] || curl -sSL "$MODEL_URL" | tar xj

# The model goes into the build under the names the build expects: the int8 encoder and joiner, the fp32 decoder
# (the int8 decoder caught 2 fewer of 48 held-out voices).
assets=sherpa-onnx/wasm/kws/assets
cp "$MODEL/encoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx" "$assets/encoder-epoch-12-avg-2-chunk-16-left-64.onnx"
cp "$MODEL/decoder-epoch-12-avg-2-chunk-16-left-64.onnx" "$assets/decoder-epoch-12-avg-2-chunk-16-left-64.onnx"
cp "$MODEL/joiner-epoch-12-avg-2-chunk-16-left-64.int8.onnx" "$assets/joiner-epoch-12-avg-2-chunk-16-left-64.onnx"
cp "$MODEL/tokens.txt" "$assets/tokens.txt"

(cd sherpa-onnx && rm -rf build-wasm-simd-kws/install && ./build-wasm-simd-kws.sh) >"$WORK/build.log" 2>&1 \
  || { tail -30 "$WORK/build.log"; exit 1; }

built=sherpa-onnx/build-wasm-simd-kws/install/bin/wasm
cp "$built/sherpa-onnx-wasm-kws-main.js" "$built/sherpa-onnx-kws.js" "$out/"
gzip -9 -n -c "$built/sherpa-onnx-wasm-kws-main.wasm" >"$out/sherpa-onnx-wasm-kws-main.wasm.gz"
gzip -9 -n -c "$built/sherpa-onnx-wasm-kws-main.data" >"$out/sherpa-onnx-wasm-kws-main.data.gz"
shasum -a 256 "$built"/sherpa-onnx-wasm-kws-main.{wasm,data,js} "$built/sherpa-onnx-kws.js"
