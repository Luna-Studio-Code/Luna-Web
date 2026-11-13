#!/usr/bin/env node
// fold-pc 서버: PC(윈도우 또는 맥)에서 실행한다.
//  - 폰용 페이지(/)와 PC용 화면 공유 페이지(/host)를 제공
//  - 두 페이지 사이의 WebRTC 연결 정보를 중계
//  - 폰에서 온 키보드·트랙패드 입력을 PC에 주입

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { WebSocketServer } = require('ws');
const { createInput } = require('./input');

const PORT = Number(process.env.PORT) || 4747;
const PUBLIC_DIR = path.join(__dirname, 'public');
const TOKEN_FILE = path.join(__dirname, '.token');

// 접속 토큰: 한 번 만들어 저장해 두므로 폰에 즐겨찾기한 주소가 계속 유효하다.
function loadToken() {
  if (process.env.FOLD_TOKEN) return process.env.FOLD_TOKEN;
  try {
    const saved = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
    if (/^[a-f0-9]{16,}$/.test(saved)) return saved;
  } catch {}
  const token = crypto.randomBytes(12).toString('hex');
  fs.writeFileSync(TOKEN_FILE, token + '\n', { mode: 0o600 });
  return token;
}

// 폰이 접속할 수 있는 이 PC의 주소들. 와이파이를 맨 앞에, 가상 어댑터는 맨 뒤에 둔다.
function lanAddresses() {
  const found = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family !== 'IPv4' || a.internal || a.address.startsWith('169.254.')) continue;
      let rank = 2;
      if (/wi-?fi|wlan|무선|^en0$/i.test(name)) rank = 0;
      else if (/ethernet|이더넷|^en\d+$|^eth\d+$/i.test(name)) rank = 1;
      if (/vethernet|virtual|vmware|vbox|wsl|docker|hyper-v|loopback|bluetooth/i.test(name)) rank = 3;
      found.push({ name, address: a.address, rank });
    }
  }
  return found.sort((a, b) => a.rank - b.rank);
}

const isLoopback = (req) => {
  const a = req.socket.remoteAddress || '';
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
};

// 화면 공유 역할은 이 PC에서 연 우리 페이지만 맡을 수 있다 (다른 웹사이트가 끼어들지 못하게).
const isLocalOrigin = (req) => {
  try {
    const { hostname, port } = new URL(req.headers.origin);
    return (hostname === 'localhost' || hostname === '127.0.0.1') && Number(port) === PORT;
  } catch {
    return false;
  }
};

const tokenMatches = (given) => {
  const a = Buffer.from(String(given || ''));
  const b = Buffer.from(TOKEN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

const TOKEN = loadToken();
const input = createInput();

const PAGES = {
  '/': 'client.html',
  '/host': 'host.html',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const file = PAGES[url.pathname];
  if (!file || req.method !== 'GET') {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end('Not found');
  }
  if (url.pathname === '/host' && !isLoopback(req)) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end('이 페이지는 PC 본체에서만 열 수 있습니다.');
  }
  fs.readFile(path.join(PUBLIC_DIR, file), (err, body) => {
    if (err) {
      res.writeHead(500);
      return res.end('error');
    }
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    });
    res.end(body);
  });
});

// ---- WebSocket ----
const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });
let host = null;    // PC 브라우저의 화면 공유 페이지
let client = null;  // 폰

const send = (ws, msg) => {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
};

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://x');
  const role = url.searchParams.get('role');
  const ok =
    url.pathname === '/ws' &&
    ((role === 'host' && isLoopback(req) && isLocalOrigin(req)) ||
      (role === 'client' && tokenMatches(url.searchParams.get('token'))));
  if (!ok) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    return socket.destroy();
  }
  wss.handleUpgrade(req, socket, head, (ws) => onConnect(ws, role));
});

function onConnect(ws, role) {
  if (role === 'host') {
    if (host) host.close(4000, 'replaced');
    host = ws;
    send(host, { t: 'client', on: Boolean(client) });
    send(client, { t: 'host', on: true });
  } else {
    if (client) client.close(4000, 'replaced');
    input.releaseAll();
    client = ws;
    const { width, height } = input.screenSize();
    send(client, { t: 'hello', screen: { w: width, h: height }, host: Boolean(host), input: input.native, platform: input.platform });
    send(host, { t: 'client', on: true });
    console.log('📱 폰이 연결되었습니다.');
  }

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'sig') {
      // WebRTC 연결 정보는 상대편에 그대로 전달
      send(role === 'host' ? client : host, { t: 'sig', data: msg.data });
    } else if (role === 'client') {
      input.handle(msg);
    }
  });

  ws.on('close', () => {
    if (role === 'host' && host === ws) {
      host = null;
      send(client, { t: 'host', on: false });
    } else if (role === 'client' && client === ws) {
      client = null;
      input.releaseAll();
      send(host, { t: 'client', on: false });
      console.log('📱 폰 연결이 끊겼습니다.');
    }
  });
  ws.on('error', () => {});
}

// 끊긴 연결 정리
setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 15000).unref();
wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
});

server.listen(PORT, '0.0.0.0', () => {
  const addrs = lanAddresses();
  const urlFor = (address) => `http://${address}:${PORT}/?t=${TOKEN}`;
  const phoneUrl = urlFor(addrs.length ? addrs[0].address : 'localhost');
  const hostUrl = `http://localhost:${PORT}/host`;
  console.log('\n  fold-pc 실행 중\n');
  console.log(`  1) 이 PC의 크롬/엣지에서 화면 공유 시작:  ${hostUrl}`);
  console.log(`  2) 폰(같은 와이파이)에서 열기:            ${phoneUrl}\n`);
  try {
    require('qrcode-terminal').generate(phoneUrl, { small: true });
  } catch {}
  if (addrs.length > 1) {
    console.log('  접속이 안 되면 아래 주소도 시도해 보세요:');
    for (const a of addrs.slice(1)) console.log(`    ${urlFor(a.address)}  (${a.name})`);
    console.log('');
  }
  if (!input.native) {
    console.log('  ⚠️  모의 입력 모드: 입력을 로그로만 출력하고 실제로 조작하지는 않습니다.\n');
  } else if (process.platform === 'win32') {
    console.log('  방화벽 창이 뜨면 "개인 네트워크"에서 허용을 눌러 주세요.\n');
  } else {
    console.log('  처음 실행하면 "손쉬운 사용" 권한을 요청합니다. 터미널에 권한을 준 뒤 다시 실행하세요.\n');
  }
  if (process.env.FOLD_NO_OPEN !== '1') {
    if (process.platform === 'win32') execFile('cmd', ['/c', 'start', '', hostUrl], () => {});
    else if (process.platform === 'darwin') execFile('open', [hostUrl], () => {});
  }
});

process.on('SIGINT', () => {
  input.releaseAll();
  process.exit(0);
});
