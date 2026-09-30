#!/bin/sh
# Builds the signed apt repository Vidalune is updated from (vidalune.com/apt): a flat repository
# with the .deb packages, their index and a Release file signed with the key in APT_SIGNING_KEY
# (an ASCII-armored private key). Usage: packaging/apt/build-repo.sh <dir-with-debs> <out-dir>
set -eu
DEBS="${1:?usage: build-repo.sh <dir-with-debs> <out-dir>}"
OUT="${2:?usage: build-repo.sh <dir-with-debs> <out-dir>}"
: "${APT_SIGNING_KEY:?APT_SIGNING_KEY is not set}"

mkdir -p "$OUT"
cp "$DEBS"/vidalune_*.deb "$OUT/"
export GNUPGHOME="$(mktemp -d)"
trap 'rm -rf "$GNUPGHOME"' EXIT
printf '%s\n' "$APT_SIGNING_KEY" | gpg --batch --quiet --import
KEY=$(gpg --batch --list-secret-keys --with-colons | awk -F: '/^fpr:/ { print $10; exit }')

cd "$OUT"
apt-ftparchive packages . > Packages
gzip -9 -k -f Packages
apt-ftparchive \
  -o APT::FTPArchive::Release::Origin=Vidalune \
  -o APT::FTPArchive::Release::Label=Vidalune \
  -o APT::FTPArchive::Release::Suite=stable \
  -o APT::FTPArchive::Release::Codename=stable \
  -o APT::FTPArchive::Release::Architectures="amd64 arm64" \
  -o APT::FTPArchive::Release::Description="Vidalune media server" \
  release . > Release
gpg --batch --yes --local-user "$KEY" --clearsign -o InRelease Release
gpg --batch --yes --local-user "$KEY" -abs -o Release.gpg Release
gpg --batch --export "$KEY" > vidalune.gpg
gpg --batch --armor --export "$KEY" > vidalune.asc

# The signature must check out with the public key alone, as apt will check it.
gpgv --keyring ./vidalune.gpg InRelease > /dev/null 2>&1 || { echo "InRelease does not verify" >&2; exit 1; }
ls -la
