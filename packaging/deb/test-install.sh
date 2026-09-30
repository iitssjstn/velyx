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
# Updates come through apt (when the package was built with the signing key).
if [ -n "${EXPECT_APT_SOURCE:-}" ]; then
  test -s /usr/share/keyrings/vidalune.gpg
  grep -q '^URIs: https://vidalune.com/apt/' /etc/apt/sources.list.d/vidalune.sources
fi
# The signed repository (packaging/apt/build-repo.sh) is accepted by apt with the package's key.
if [ -n "${REPO_DIR:-}" ]; then
  $NODE -e "const fs=require('fs'),p=require('path');require('http').createServer((q,r)=>{const f=p.join('$REPO_DIR',p.basename(q.url));fs.existsSync(f)?fs.createReadStream(f).pipe(r):(r.statusCode=404,r.end())}).listen(8089)" &
  REPO_PID=$!
  sleep 1
  sed 's#https://vidalune.com/apt/#http://127.0.0.1:8089/#' /etc/apt/sources.list.d/vidalune.sources > /etc/apt/sources.list.d/vidalune.sources.tmp
  mv /etc/apt/sources.list.d/vidalune.sources.tmp /etc/apt/sources.list.d/vidalune.sources
  apt-get update -qq -o APT::Update::Error-Mode=any
  apt-cache policy vidalune | grep -q '127.0.0.1:8089'
  kill "$REPO_PID"
fi
test "$(stat -c %U /var/lib/vidalune)" = vidalune
test "$(stat -c %G:%a /etc/vidalune/vidalune.env)" = vidalune:640

start() {
  setpriv --reuid=vidalune --regid=vidalune --init-groups -- env NODE_ENV=production HOST=127.0.0.1 PORT=3000 DATA_DIR=/var/lib/vidalune MEDIA_ROOTS=/ VIDALUNE_PACKAGE=deb FRONTEND_DIR=/opt/vidalune/app/frontend/dist \
    "$NODE" /opt/vidalune/app/backend/dist/index.js > /tmp/vidalune.log 2>&1 &
  PID=$!
  $NODE -e "const t=Date.now();(async function w(){try{const r=await fetch('http://127.0.0.1:3000/health');if(r.ok)return;}catch{} if(Date.now()-t>60000){console.error('no health');process.exit(1)} setTimeout(w,500)})()" || { cat /tmp/vidalune.log; exit 1; }
}

start
$NODE -e "fetch('http://127.0.0.1:3000/api/setup',{method:'POST',headers:{'content-type':'application/json',origin:'http://127.0.0.1:3000'},body:JSON.stringify({username:'admin',password:'correct-horse-battery'})}).then(async r=>{if(!r.ok){console.error(r.status,await r.text());process.exit(1)} require('fs').writeFileSync('/tmp/cookie', r.headers.get('set-cookie').split(';')[0])})"

# A media folder the service may not read (inside a private home folder): adding it names the
# command that gives access; after running that command it can be added.
mkdir -p /home/jan/Films
chmod 0700 /home/jan
add_library() {
  $NODE -e "fetch('http://127.0.0.1:3000/api/libraries',{method:'POST',headers:{'content-type':'application/json',origin:'http://127.0.0.1:3000',cookie:require('fs').readFileSync('/tmp/cookie','utf8')},body:JSON.stringify({name:'Films',type:'movies',path:'/home/jan/Films'})}).then(async r=>{const b=await r.json();console.log(r.status);if(r.status===400)require('fs').writeFileSync('/tmp/fix',b.error.split(': ').slice(1).join(': '))})"
}
test "$(add_library)" = 400
cat /tmp/fix
sh -c "$(sed 's/sudo //g' /tmp/fix)"
test "$(add_library)" = 200
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
test ! -e /etc/apt/sources.list.d/vidalune.sources
test -f /etc/vidalune/vidalune.env
test -f /var/lib/vidalune/velyx.db
apt-get purge -y -qq vidalune > /dev/null
test ! -e /etc/vidalune
test -f /var/lib/vidalune/velyx.db
echo "deb install test passed"
