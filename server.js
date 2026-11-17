const http = require('http');
const net = require('net');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawn } = require('child_process');
const PORT = process.env.PORT || 8080;
const UUID = process.env.XRAY_UUID;
const XRAY_PORT = 10000;
const DIR = '/tmp/xray';
const BIN = path.join(DIR, 'xray');
function download(url, dest) {
  return new Promise((resolve, reject) => {
    const go = (u) => https.get(u, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400) return go(res.headers.location);
      if (res.statusCode !== 200) return reject(new Error('dl ' + res.statusCode));
      const f = fs.createWriteStream(dest);
      res.pipe(f); f.on('finish', () => f.close(resolve));
    }).on('error', reject);
    go(url);
  });
}
async function ensureXray() {
  if (fs.existsSync(BIN)) return;
  fs.mkdirSync(DIR, { recursive: true });
  const zip = path.join(DIR, 'x.zip');
  await download('https://github.com/XTLS/Xray-core/releases/latest/download/Xray-linux-64.zip', zip);
  const AdmZip = require('adm-zip');
  new AdmZip(zip).extractAllTo(DIR, true);
  fs.chmodSync(BIN, 0o755);
}
function startXray() {
  const cfg = { inbounds: [{ listen: '127.0.0.1', port: XRAY_PORT, protocol: 'vless', settings: { clients: [{ id: UUID }], decryption: 'none' }, streamSettings: { network: 'ws', wsSettings: { path: '/vless' } } }], outbounds: [{ protocol: 'freedom' }] };
  fs.writeFileSync(path.join(DIR, 'config.json'), JSON.stringify(cfg));
  const p = spawn(BIN, ['run', '-c', path.join(DIR, 'config.json')], { stdio: 'inherit' });
  p.on('exit', (c) => { console.log('xray exit', c); setTimeout(startXray, 3000); });
}
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end('<html><head><title>Welcome</title></head><body><h1>It works</h1></body></html>');
});
server.on('upgrade', (req, socket, head) => {
  if (!req.url.startsWith('/vless')) { socket.destroy(); return; }
  const up = net.connect(XRAY_PORT, '127.0.0.1', () => {
    up.write(req.method + ' ' + req.url + ' HTTP/' + req.httpVersion + '\r\n' + Object.entries(req.headers).map(([k, v]) => k + ': ' + v).join('\r\n') + '\r\n\r\n');
    if (head && head.length) up.write(head);
    up.pipe(socket); socket.pipe(up);
  });
  up.on('error', () => socket.destroy());
  socket.on('error', () => up.destroy());
});
(async () => {
  try { await ensureXray(); startXray(); } catch (e) { console.error('xray setup failed', e); }
  server.listen(PORT, () => console.log('listening', PORT));
})();
