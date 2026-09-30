#!/bin/sh
# Installs, runs, upgrades, removes and purges a Vidalune .deb on a clean Debian/Ubuntu system (as
# root, e.g. in a container without systemd): packaging/deb/test-install.sh <file.deb>
set -eu
DEB=$(realpath "${1:?usage: test-install.sh <file.deb>}")
export DEBIAN_FRONTEND=noninteractive
NODE=/opt/vidalune/node/bin/node

apt-get update -qq
apt-get install -y -qq "$DEB" > /dev/null
id vidalune
test "$(stat -c %U /var/lib/vidalune)" = vidalune
test "$(stat -c %G:%a /etc/vidalune/vidalune.env)" = vidalune:640

start() {
  setpriv --reuid=vidalune --regid=vidalune --init-groups -- env NODE_ENV=production HOST=127.0.0.1 PORT=3000 DATA_DIR=/var/lib/vidalune MEDIA_ROOTS=/srv FRONTEND_DIR=/opt/vidalune/app/frontend/dist \
    "$NODE" /opt/vidalune/app/backend/dist/index.js > /tmp/vidalune.log 2>&1 &
  PID=$!
  $NODE -e "const t=Date.now();(async function w(){try{const r=await fetch('http://127.0.0.1:3000/health');if(r.ok)return;}catch{} if(Date.now()-t>60000){console.error('no health');process.exit(1)} setTimeout(w,500)})()" || { cat /tmp/vidalune.log; exit 1; }
}

start
$NODE -e "fetch('http://127.0.0.1:3000/api/setup',{method:'POST',headers:{'content-type':'application/json',origin:'http://127.0.0.1:3000'},body:JSON.stringify({username:'admin',password:'correct-horse-battery'})}).then(async r=>{if(!r.ok){console.error(r.status,await r.text());process.exit(1)}})"
$NODE -e "fetch('http://127.0.0.1:3000/').then(async r=>{const t=await r.text();if(!r.ok||!t.includes('<div id=\"root\"')){console.error('no web interface');process.exit(1)}})"
kill "$PID"; wait "$PID" || true

# The maintenance CLI runs as the service user with its settings.
vidalune backup
test -n "$(ls /var/lib/vidalune/backups)"

# Reinstalling (as an upgrade does) keeps the settings and the data.
echo "#changed" >> /etc/vidalune/vidalune.env
dpkg -i "$DEB" > /dev/null
grep -q '^#changed' /etc/vidalune/vidalune.env
test -f /var/lib/vidalune/velyx.db
start
$NODE -e "fetch('http://127.0.0.1:3000/api/server/info').then(r=>r.json()).then(s=>{if(s.setupRequired!==false){console.error('data lost',s);process.exit(1)}})"
kill "$PID"; wait "$PID" || true

apt-get remove -y -qq vidalune > /dev/null
test ! -e /opt/vidalune/app
test -f /etc/vidalune/vidalune.env
test -f /var/lib/vidalune/velyx.db
apt-get purge -y -qq vidalune > /dev/null
test ! -e /etc/vidalune
test -f /var/lib/vidalune/velyx.db
echo "deb install test passed"
