#!/usr/bin/env bash
# Turn the hero video into the image sequences used by the scroll-driven landing hero.
#
#   npm run frames                         # uses assets/source/hero.mp4
#   npm run frames -- path/to/other.mp4    # any other source
#
# Output (committed; the source video is not):
#   apps/web/public/hero-frames/desktop/f_0001.webp ...  1280px wide
#   apps/web/public/hero-frames/mobile/f_0001.webp ...   720px tall 9:16 crop that follows the subject
#   apps/web/public/hero-frames/manifest.json            count, sizes, focal track, edge colours, placeholder, version
#
# Why the mobile set is a portrait crop and not a 720px-wide downscale: cover-cropping a 16:9 frame onto a
# portrait phone keeps only ~26% of its width, so a 720px-wide set leaves ~190 real pixels across the screen.
# A 406x720 crop at native resolution costs the same decode memory, fewer bytes, and is ~1.8x sharper.
#
# Needs ffmpeg (with libwebp for WebP output; otherwise falls back to JPEG) and node.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="${1:-$ROOT/assets/source/hero.mp4}"
OUT="$ROOT/apps/web/public/hero-frames"
DESKTOP_W=1280
MOBILE_H=720
TARGET_KB=60      # average desktop frame budget
START_Q=80        # WebP quality to start from; lowered in steps of 4 until the budget fits
MIN_Q=56
# Horizontal centre of the main subject (0..1 of the frame width) at a given source frame (0-based).
# Drives the baked mobile crop and the desktop cover-crop in the browser. Retune it if you swap the video.
export FOCAL='[[0,0.29],[114,0.29],[126,0.34],[134,0.47],[140,0.5],[239,0.5]]'

die() { echo "extract-frames: $*" >&2; exit 1; }

if ! command -v ffmpeg >/dev/null 2>&1 || ! command -v ffprobe >/dev/null 2>&1; then
  cat >&2 <<'EOF'
extract-frames: ffmpeg/ffprobe not found on PATH. Install it, then re-run:
  Windows : winget install Gyan.FFmpeg          (or: choco install ffmpeg)
  macOS   : brew install ffmpeg
  Debian  : sudo apt-get install ffmpeg
EOF
  exit 1
fi
command -v node >/dev/null 2>&1 || die "node not found on PATH"

if [ ! -f "$SRC" ]; then
  found="$(find "$ROOT/assets/source" -maxdepth 1 -type f \( -iname '*.mp4' -o -iname '*.mov' -o -iname '*.webm' \) 2>/dev/null | head -n 1 || true)"
  [ -n "$found" ] || die "source video not found: $SRC (put it at assets/source/hero.mp4)"
  SRC="$found"
fi
echo "source: $SRC"

FRAMES="$(ffprobe -v error -select_streams v:0 -count_packets -show_entries stream=nb_read_packets -of csv=p=0 "$SRC")"
FPS="$(ffprobe -v error -select_streams v:0 -show_entries stream=r_frame_rate -of csv=p=0 "$SRC")"
echo "frames: $FRAMES @ $FPS fps"

if ffmpeg -hide_banner -encoders 2>/dev/null | grep -q ' libwebp '; then
  EXT=webp
else
  EXT=jpg
  echo "ffmpeg has no libwebp encoder - falling back to JPEG (q~82)"
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# FOCAL as an ffmpeg expression of the frame number n (smoothstep between keyframes).
FOCAL_EXPR="$(node <<'NODE'
const k = JSON.parse(process.env.FOCAL);
let e = String(k[k.length - 1][1]);
for (let i = k.length - 2; i >= 0; i--) {
  const [n0, a] = k[i];
  const [n1, b] = k[i + 1];
  const s = `clip((n-${n0})/${Math.max(1, n1 - n0)},0,1)`;
  e = `if(lt(n,${n1}),${a}+(${(b - a).toFixed(4)})*${s}*${s}*(3-2*${s}),${e})`;
}
process.stdout.write(e);
NODE
)"
DESKTOP_VF="scale=${DESKTOP_W}:-2:flags=lanczos"
MOBILE_VF="scale=-2:${MOBILE_H}:flags=lanczos,crop=w=trunc(ih*9/32)*2:h=ih:x='clip((${FOCAL_EXPR})*iw-ow/2,0,iw-ow)':y=0"

# extract <filter> <dir> <quality>
extract() {
  local vf="$1" dir="$2" q="$3"
  rm -rf "$dir" && mkdir -p "$dir"
  # -an: drop audio, passthrough: exactly one image per source frame (no dup/drop), Lanczos scaling.
  if [ "$EXT" = webp ]; then
    ffmpeg -v error -y -i "$SRC" -an -fps_mode passthrough -vf "$vf" \
      -c:v libwebp -quality "$q" -q:v "$q" -compression_level 6 "$dir/f_%04d.webp"
  else
    ffmpeg -v error -y -i "$SRC" -an -fps_mode passthrough -vf "$vf" \
      -c:v mjpeg -q:v 4 -pix_fmt yuvj420p "$dir/f_%04d.jpg"
  fi
}

avg_kb() { node -e '
  const fs = require("fs"), path = require("path"), d = process.argv[1];
  const s = fs.readdirSync(d).map((f) => fs.statSync(path.join(d, f)).size);
  console.log(Math.round(s.reduce((a, b) => a + b, 0) / s.length / 1024));' "$1"; }

Q=$START_Q
while :; do
  echo "desktop ${DESKTOP_W}px, quality $Q ..."
  extract "$DESKTOP_VF" "$OUT/desktop" "$Q"
  KB="$(avg_kb "$OUT/desktop")"
  echo "  average ${KB}KB/frame"
  if [ "$EXT" != webp ] || [ "$KB" -le "$TARGET_KB" ] || [ "$Q" -le "$MIN_Q" ]; then break; fi
  Q=$((Q - 4))
done
echo "mobile 9:16 crop, ${MOBILE_H}px tall, quality $Q ..."
extract "$MOBILE_VF" "$OUT/mobile" "$Q"
echo "  average $(avg_kb "$OUT/mobile")KB/frame"

COUNT="$(find "$OUT/desktop" -name "f_*.$EXT" | wc -l | tr -d ' ')"
[ "$COUNT" -gt 1 ] || die "extraction produced $COUNT frames"
[ "$COUNT" = "$(find "$OUT/mobile" -name "f_*.$EXT" | wc -l | tr -d ' ')" ] || die "desktop/mobile frame counts differ"

# 64x36 raw RGB of the first and last frame -> average border colour (used for the seamless hand-off),
# plus a tiny frame-1 placeholder that is inlined into the page for an instant first paint.
LAST=$((COUNT - 1))
ffmpeg -v error -y -i "$SRC" -vf "select=eq(n\,0),scale=64:36" -frames:v 1 -f rawvideo -pix_fmt rgb24 "$TMP/first.rgb"
ffmpeg -v error -y -i "$SRC" -vf "select=eq(n\,$LAST),scale=64:36" -frames:v 1 -f rawvideo -pix_fmt rgb24 "$TMP/last.rgb"
if [ "$EXT" = webp ]; then
  ffmpeg -v error -y -i "$SRC" -vf "select=eq(n\,0),scale=32:-2:flags=area" -frames:v 1 -c:v libwebp -quality 40 -q:v 40 "$TMP/ph.webp"
  PH="$TMP/ph.webp"; PH_MIME=image/webp
else
  ffmpeg -v error -y -i "$SRC" -vf "select=eq(n\,0),scale=32:-2:flags=area" -frames:v 1 -q:v 6 "$TMP/ph.jpg"
  PH="$TMP/ph.jpg"; PH_MIME=image/jpeg
fi

node - "$SRC" "$OUT" "$EXT" "$COUNT" "$FPS" "$TMP" "$PH" "$PH_MIME" "$Q" <<'NODE'
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const [src, out, ext, count, fps, tmp, ph, phMime, quality] = process.argv.slice(2);

/** Average colour of the outer 3px ring of a 64x36 rgb24 image. */
function edge(file) {
  const buf = fs.readFileSync(file);
  const W = 64, H = 36, R = 3;
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (x >= R && x < W - R && y >= R && y < H - R) continue;
      const i = (y * W + x) * 3;
      r += buf[i]; g += buf[i + 1]; b += buf[i + 2]; n++;
    }
  const hex = (v) => Math.round(v / n).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/** WebP/JPEG dimensions without extra deps, read from the first file's header. */
function dims(dir) {
  const f = path.join(dir, `f_0001.${ext}`);
  const b = fs.readFileSync(f);
  if (ext === 'webp') {
    const chunk = b.toString('ascii', 12, 16);
    if (chunk === 'VP8 ') return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
    if (chunk === 'VP8L') {
      const bits = b.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (chunk === 'VP8X') return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
  } else {
    for (let i = 2; i < b.length; ) {
      const marker = b[i + 1];
      const len = b.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xc2) return { width: b.readUInt16BE(i + 7), height: b.readUInt16BE(i + 5) };
      i += 2 + len;
    }
  }
  throw new Error(`cannot read dimensions of ${f}`);
}

function totalKb(dir) {
  return Math.round(fs.readdirSync(dir).reduce((a, f) => a + fs.statSync(path.join(dir, f)).size, 0) / 1024);
}

const [num, den = '1'] = fps.split('/');
const manifest = {
  // Content hash of the source: appended as ?v= so frames can be cached as immutable.
  version: crypto.createHash('sha1').update(fs.readFileSync(src)).digest('hex').slice(0, 10),
  frameCount: Number(count),
  fps: Math.round((Number(num) / Number(den)) * 1000) / 1000,
  ext,
  quality: Number(quality),
  sets: {
    desktop: { ...dims(path.join(out, 'desktop')), totalKb: totalKb(path.join(out, 'desktop')) },
    mobile: { ...dims(path.join(out, 'mobile')), totalKb: totalKb(path.join(out, 'mobile')) },
  },
  // [frame, x]: subject centre for the desktop cover-crop (the mobile set has it baked in).
  focal: JSON.parse(process.env.FOCAL),
  edge: { first: edge(path.join(tmp, 'first.rgb')), last: edge(path.join(tmp, 'last.rgb')) },
  placeholder: `data:${phMime};base64,${fs.readFileSync(ph).toString('base64')}`,
};
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`manifest: ${manifest.frameCount} frames, desktop ${manifest.sets.desktop.width}x${manifest.sets.desktop.height} ` +
  `(${manifest.sets.desktop.totalKb}KB), mobile ${manifest.sets.mobile.width}x${manifest.sets.mobile.height} ` +
  `(${manifest.sets.mobile.totalKb}KB), edges ${manifest.edge.first} -> ${manifest.edge.last}, v=${manifest.version}`);
NODE
