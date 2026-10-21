#!/bin/sh
# The microphone for wake.spec.ts: Chrome plays one of these files as its fake microphone, on a loop.
# Made on a Mac with its built-in voices (macOS `say`) and ffmpeg; run again to remake them. 16 kHz mono WAV.
set -eu
cd "$(dirname "$0")"
t=$(mktemp -d)
say -v "Samantha (English (US))" --file-format=WAVE --data-format=LEI16@16000 -o "$t/wake.wav" "Hello neighbour"
say -v "Samantha (English (US))" --file-format=WAVE --data-format=LEI16@16000 -o "$t/ask.wav" "What is my renovation status?"
say -v "Daniel (English (UK))" --file-format=WAVE --data-format=LEI16@16000 -o "$t/near.wav" \
  "Hello there. Say hello to the neighbours. Hey, connection. My neighbour said hello. Hello, nice to meet you."
# wake-then-ask: 1.5 s quiet, the wake phrase, 0.7 s, the question, 4 s quiet (the file loops)
ffmpeg -loglevel error -y -f lavfi -t 1.5 -i anullsrc=r=16000:cl=mono -i "$t/wake.wav" -f lavfi -t 0.7 -i anullsrc=r=16000:cl=mono \
  -i "$t/ask.wav" -f lavfi -t 4 -i anullsrc=r=16000:cl=mono -filter_complex "[0][1][2][3][4]concat=n=5:v=0:a=1" -ar 16000 -ac 1 wake-then-ask.wav
ffmpeg -loglevel error -y -i "$t/near.wav" -f lavfi -t 2 -i anullsrc=r=16000:cl=mono -filter_complex "[0][1]concat=n=2:v=0:a=1" -ar 16000 -ac 1 near-misses.wav
rm -rf "$t"
