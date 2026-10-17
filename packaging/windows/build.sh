#!/bin/sh
# Builds the Vidalune installer for Windows (64-bit): packaging/windows/build.sh [out-dir]
# Runs on Linux. Needs a built frontend and server (npm run build --workspace frontend && npm run
# build:release --workspace backend), Mono's C# compiler (mcs) and NSIS (makensis). Node, the
# server's packages and FFmpeg for Windows go into the installer, so the PC needs nothing else.
set -eu
OUT="${1:-dist-windows}"
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
HERE="$ROOT/packaging/windows"
VERSION=$(node -p "require('$ROOT/package.json').version")
test -f "$ROOT/backend/dist/index.js" && test -f "$ROOT/frontend/dist/index.html" || { echo "build the frontend and server first" >&2; exit 1; }
command -v mcs > /dev/null && command -v makensis > /dev/null || { echo "needs mcs (mono-mcs) and makensis (nsis)" >&2; exit 1; }

# FFmpeg for Windows: a fixed release build (GPL), checked against its checksum.
FFMPEG_VERSION=7.1.1
FFMPEG_ZIP="ffmpeg-$FFMPEG_VERSION-essentials_build.zip"
FFMPEG_SHA256=04861d3339c5ebe38b56c19a15cf2c0cc97f5de4fa8910e4d47e5e6404e4a2d4

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
STAGE="$WORK/stage"
APP="$STAGE/app"
mkdir -p "$APP/backend" "$APP/frontend" "$STAGE/node" "$STAGE/ffmpeg"

# Node runtime (latest 22.x, checked against its published checksum).
NODE_VERSION="${NODE_VERSION:-$(curl -fsSL https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt | sed -n 's/.*node-\(v22[^-]*\)-win-x64.zip/\1/p')}"
NODE_ZIP="node-$NODE_VERSION-win-x64.zip"
curl -fsSL -o "$WORK/$NODE_ZIP" "https://nodejs.org/dist/$NODE_VERSION/$NODE_ZIP"
curl -fsSL "https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt" | grep " $NODE_ZIP\$" | (cd "$WORK" && sha256sum -c -)
unzip -q -j "$WORK/$NODE_ZIP" "node-$NODE_VERSION-win-x64/node.exe" "node-$NODE_VERSION-win-x64/LICENSE" -d "$STAGE/node"

curl -fsSL -o "$WORK/$FFMPEG_ZIP" "https://github.com/GyanD/codexffmpeg/releases/download/$FFMPEG_VERSION/$FFMPEG_ZIP"
echo "$FFMPEG_SHA256  $WORK/$FFMPEG_ZIP" | sha256sum -c -
unzip -q -j "$WORK/$FFMPEG_ZIP" "ffmpeg-$FFMPEG_VERSION-essentials_build/bin/ffmpeg.exe" "ffmpeg-$FFMPEG_VERSION-essentials_build/bin/ffprobe.exe" "ffmpeg-$FFMPEG_VERSION-essentials_build/LICENSE" -d "$STAGE/ffmpeg"
printf 'FFmpeg %s (essentials build by Gyan Doshi, https://www.gyan.dev/ffmpeg/builds/), licensed under the GPL (see LICENSE).\r\nSource code: https://github.com/FFmpeg/FFmpeg/tree/n%s\r\n' "$FFMPEG_VERSION" "$FFMPEG_VERSION" > "$STAGE/ffmpeg/README.txt"

# The server and web interface, as in the Docker image and the .deb.
cp "$ROOT/package.json" "$APP/"
cp "$ROOT/backend/package.json" "$APP/backend/"
cp -r "$ROOT/backend/dist" "$ROOT/backend/drizzle" "$APP/backend/"
cp -r "$ROOT/frontend/dist" "$APP/frontend/"

# The server's packages for Windows (native ones included).
DEPS="$WORK/deps"
mkdir -p "$DEPS/backend" "$DEPS/frontend" "$DEPS/cloud"
cp "$ROOT/package.json" "$ROOT/package-lock.json" "$DEPS/"
for w in backend frontend cloud; do cp "$ROOT/$w/package.json" "$DEPS/$w/"; done
(cd "$DEPS" && npm ci --omit=dev --workspace backend --ignore-scripts --no-audit --no-fund --cpu=x64 --os=win32 > /dev/null)
cp -r "$DEPS/node_modules" "$APP/"
# better-sqlite3 ships a prebuilt library per platform; only the Windows one is kept.
find "$APP/node_modules/better-sqlite3/prebuilds" -name '*.node' ! -name 'win32-x64.node' -delete
for f in "$APP/node_modules/better-sqlite3/prebuilds/win32-x64.node" "$APP"/node_modules/@node-rs/argon2-win32-x64-msvc/*.node "$STAGE/node/node.exe" "$STAGE/ffmpeg/ffmpeg.exe"; do
  case "$(file -b "$f")" in
    *PE32+*x86-64*) ;;
    *) echo "not a 64-bit Windows file: $f" >&2; exit 1 ;;
  esac
done

# The tray program, with the grey icon for "stopped" inside it. Compiled against the reference
# assemblies of .NET Framework 4.6.2 (every supported Windows 10 and 11 has it), not Mono's own
# libraries: those have methods Windows does not, which would only fail once it runs there.
API=/usr/lib/mono/4.6.2-api
test -f "$API/mscorlib.dll" || { echo "needs the .NET Framework reference assemblies ($API, in mono-devel)" >&2; exit 1; }
mcs -nologo -nostdlib -target:winexe -platform:x64 -langversion:7 -optimize+ \
  -r:"$API/mscorlib.dll" -r:"$API/System.dll" -r:"$API/System.Drawing.dll" -r:"$API/System.Windows.Forms.dll" \
  -win32icon:"$HERE/vidalune.ico" -resource:"$HERE/vidalune-stopped.ico",stopped.ico \
  -out:"$STAGE/VidaluneTray.exe" "$HERE/tray/VidaluneTray.cs"

cp "$HERE/vidalune.ico" "$STAGE/"
cp "$HERE/vidalune.env" "$STAGE/"
sed 's/$/\r/' "$ROOT/LICENSE" > "$STAGE/LICENSE.txt"

# makensis needs a UTF-8 locale for the non-ASCII file names some packages have.
mkdir -p "$OUT"
EXE="$(cd "$OUT" && pwd)/vidalune-$VERSION-setup.exe"
LC_ALL=C.UTF-8 makensis -V2 -WX -INPUTCHARSET UTF8 -DVERSION="$VERSION" -DSTAGE="$STAGE" -DOUTFILE="$EXE" "$HERE/installer.nsi"
echo "$EXE"
