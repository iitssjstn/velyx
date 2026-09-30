#!/bin/sh
# Builds the Vidalune .deb for one architecture: packaging/deb/build.sh <amd64|arm64> [out-dir]
# Needs a built frontend and server (npm run build --workspace frontend && npm run build:release
# --workspace backend). The Node runtime and the server's packages for that architecture go into the
# package, so the system only needs FFmpeg.
set -eu
ARCH="${1:?usage: build.sh <amd64|arm64> [out-dir]}"
OUT="${2:-dist-deb}"
case "$ARCH" in
  amd64) NARCH=x64 ;;
  arm64) NARCH=arm64 ;;
  *) echo "unknown architecture: $ARCH" >&2; exit 1 ;;
esac

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
HERE="$ROOT/packaging/deb"
VERSION=$(node -p "require('$ROOT/package.json').version")
test -f "$ROOT/backend/dist/index.js" && test -f "$ROOT/frontend/dist/index.html" || { echo "build the frontend and server first" >&2; exit 1; }

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
PKG="$WORK/pkg"
APP="$PKG/opt/vidalune/app"
mkdir -p "$APP/backend" "$APP/frontend" "$PKG/opt/vidalune/node/bin" "$PKG/DEBIAN" "$PKG/etc/vidalune" "$PKG/lib/systemd/system" "$PKG/usr/bin"

# Node runtime (latest 22.x, checked against its published checksum).
NODE_VERSION="${NODE_VERSION:-$(curl -fsSL https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt | sed -n 's/.*node-\(v22[^-]*\)-linux-x64.tar.xz/\1/p')}"
TARBALL="node-$NODE_VERSION-linux-$NARCH.tar.xz"
curl -fsSL -o "$WORK/$TARBALL" "https://nodejs.org/dist/$NODE_VERSION/$TARBALL"
curl -fsSL "https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt" | grep " $TARBALL\$" | (cd "$WORK" && sha256sum -c -)
tar -xJf "$WORK/$TARBALL" -C "$WORK" "node-$NODE_VERSION-linux-$NARCH/bin/node"
install -m 0755 "$WORK/node-$NODE_VERSION-linux-$NARCH/bin/node" "$PKG/opt/vidalune/node/bin/node"

# The server and web interface, as in the Docker image.
cp "$ROOT/package.json" "$APP/"
cp "$ROOT/backend/package.json" "$APP/backend/"
cp -r "$ROOT/backend/dist" "$ROOT/backend/drizzle" "$APP/backend/"
cp -r "$ROOT/frontend/dist" "$APP/frontend/"

# The server's packages for the target architecture (native ones included).
DEPS="$WORK/deps"
mkdir -p "$DEPS/backend" "$DEPS/frontend" "$DEPS/cloud"
cp "$ROOT/package.json" "$ROOT/package-lock.json" "$DEPS/"
for w in backend frontend cloud; do cp "$ROOT/$w/package.json" "$DEPS/$w/"; done
(cd "$DEPS" && npm ci --omit=dev --workspace backend --ignore-scripts --no-audit --no-fund --cpu="$NARCH" --os=linux --libc=glibc > /dev/null)
cp -r "$DEPS/node_modules" "$APP/"
# better-sqlite3 ships a prebuilt library per platform; only this one's is kept.
find "$APP/node_modules/better-sqlite3/prebuilds" -name '*.node' ! -name "linux-$NARCH.node" -delete
for f in "$APP/node_modules/better-sqlite3/prebuilds/linux-$NARCH.node" "$APP"/node_modules/@node-rs/argon2-linux-*/*.node; do
  case "$ARCH:$(file -b "$f")" in
    amd64:*x86-64*|arm64:*aarch64*) ;;
    *) echo "wrong architecture: $f" >&2; exit 1 ;;
  esac
done

install -m 0644 "$HERE/vidalune.env" "$PKG/etc/vidalune/vidalune.env"
install -m 0644 "$HERE/vidalune.service" "$PKG/lib/systemd/system/vidalune.service"
install -m 0755 "$HERE/vidalune" "$PKG/usr/bin/vidalune"
install -m 0755 "$HERE/postinst" "$HERE/prerm" "$HERE/postrm" "$PKG/DEBIAN/"
echo /etc/vidalune/vidalune.env > "$PKG/DEBIAN/conffiles"
cat > "$PKG/DEBIAN/control" <<CONTROL
Package: vidalune
Version: $VERSION
Architecture: $ARCH
Maintainer: Vidalune <support@vidalune.com>
Installed-Size: $(du -sk "$PKG" | cut -f1)
Depends: ffmpeg, adduser, libc6 (>= 2.28), libstdc++6
Section: video
Priority: optional
Homepage: https://vidalune.com
Description: Vidalune media server
 Your media. Your server. A lightweight self-hosted media server for your
 movies and shows, with a web interface and apps. Runs as the systemd
 service "vidalune"; settings in /etc/vidalune/vidalune.env.
CONTROL

mkdir -p "$OUT"
dpkg-deb --root-owner-group -Zxz --build "$PKG" "$OUT/vidalune_${VERSION}_$ARCH.deb" > /dev/null
echo "$OUT/vidalune_${VERSION}_$ARCH.deb"
