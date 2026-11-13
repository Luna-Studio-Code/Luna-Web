// PC의 마우스·키보드를 실제로 움직이는 부분.
// 윈도우·macOS에서는 libnut(네이티브 모듈)을 쓰고, 그 외 환경이나 FOLD_MOCK=1 일 때는
// 받은 입력을 로그로만 찍는 모의(mock) 백엔드를 쓴다.

const { spawn } = require('child_process');

const PLATFORM = process.platform === 'darwin' ? 'mac' : 'win';

const MODIFIERS = {
  shift: 'shift', right_shift: 'shift',
  control: 'control', right_control: 'control',
  alt: 'alt', right_alt: 'alt',
  cmd: 'cmd', right_cmd: 'cmd',
};

const KEYS = new Set([
  ...'abcdefghijklmnopqrstuvwxyz0123456789',
  '`', '-', '=', '[', ']', '\\', ';', "'", ',', '.', '/',
  'escape', 'tab', 'caps_lock', 'backspace', 'delete', 'enter', 'space',
  'up', 'down', 'left', 'right', 'home', 'end', 'pageup', 'pagedown',
  ...Array.from({ length: 12 }, (_, i) => `f${i + 1}`),
  ...Object.keys(MODIFIERS),
]);

const BUTTONS = new Set(['left', 'right', 'middle']);

const NATIVE_PACKAGES = {
  win32: '@nut-tree-fork/libnut-win32',
  darwin: '@nut-tree-fork/libnut-darwin',
};

function loadNative() {
  const pkg = NATIVE_PACKAGES[process.platform];
  if (process.env.FOLD_MOCK === '1' || !pkg) return null;
  try {
    const nut = require(pkg);
    nut.setMouseDelay(0);
    nut.setKeyboardDelay(0);
    return nut;
  } catch (err) {
    console.warn('⚠️  입력 제어 모듈을 불러오지 못했습니다:', err.message);
    return null;
  }
}

function mockBackend() {
  const pos = { x: 400, y: 300 };
  const log = (...a) => console.log('[mock]', ...a);
  return {
    getScreenSize: () => ({ width: 1512, height: 982 }),
    getMousePos: () => ({ ...pos }),
    moveMouse: (x, y) => { pos.x = x; pos.y = y; log('move', x, y); },
    dragMouse: (x, y) => { pos.x = x; pos.y = y; log('drag', x, y); },
    mouseToggle: (dir, button) => log('button', button, dir),
    mouseClick: (button, double) => log('click', button, double ? 'double' : 'single'),
    scrollMouse: (x, y) => log('scroll', x, y),
    keyToggle: (key, dir, mods) => log('key', key, dir, (mods || []).join('+')),
  };
}

// 한/영 전환.
// 윈도우: 한/영 키(VK_HANGUL)는 libnut에 없어서, 상주하는 PowerShell 프로세스로 보낸다.
// macOS: 기본 입력 소스 전환 단축키인 control+space를 보낸다.
function createHangulToggle(nut, isNative) {
  if (!isNative) return () => console.log('[mock]', 'hangul');
  if (process.platform !== 'win32') {
    return () => {
      nut.keyToggle('space', 'down', ['control']);
      nut.keyToggle('space', 'up', ['control']);
    };
  }
  let ps = null;
  const script = [
    "$sig = '[DllImport(\"user32.dll\")] public static extern void keybd_event(byte vk, byte scan, uint flags, System.UIntPtr extra);'",
    '$kb = Add-Type -MemberDefinition $sig -Name Kb -Namespace FoldPc -PassThru',
    'while ($null -ne ($line = [Console]::In.ReadLine())) {',
    '  $kb::keybd_event(0x15, 0, 0, [System.UIntPtr]::Zero)',
    '  $kb::keybd_event(0x15, 0, 2, [System.UIntPtr]::Zero)',
    '}',
  ].join('\n');
  const start = () => {
    ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      stdio: ['pipe', 'ignore', 'ignore'],
      windowsHide: true,
    });
    ps.on('error', () => { ps = null; });
    ps.on('exit', () => { ps = null; });
    ps.stdin.on('error', () => {});
  };
  start(); // 미리 띄워 둬서 첫 입력이 느리지 않게 한다.
  return () => {
    if (!ps) start();
    if (ps) ps.stdin.write('t\n');
  };
}

function createInput() {
  const native = loadNative();
  const nut = native || mockBackend();
  const toggleHangul = createHangulToggle(nut, Boolean(native));

  let pos = null;          // 우리가 추적하는 커서 위치
  let lastMoveAt = 0;
  const heldButtons = new Set();
  const heldKeys = new Set();

  const screenSize = () => nut.getScreenSize();

  function syncPos() {
    // 사용자가 맥의 실제 마우스를 움직였을 수 있으므로, 잠깐 쉬었다면 위치를 다시 읽는다.
    const now = Date.now();
    if (!pos || now - lastMoveAt > 700) pos = nut.getMousePos();
    lastMoveAt = now;
  }

  function place(x, y) {
    const { width, height } = screenSize();
    pos.x = Math.min(width - 1, Math.max(0, x));
    pos.y = Math.min(height - 1, Math.max(0, y));
    const rx = Math.round(pos.x);
    const ry = Math.round(pos.y);
    if (heldButtons.size) nut.dragMouse(rx, ry);
    else nut.moveMouse(rx, ry);
  }

  const activeMods = () => {
    const mods = new Set();
    for (const k of heldKeys) if (MODIFIERS[k]) mods.add(MODIFIERS[k]);
    return [...mods];
  };

  const num = (v, limit) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return 0;
    return Math.min(limit, Math.max(-limit, n));
  };

  const handlers = {
    // 상대 이동 (트랙패드)
    m(msg) {
      syncPos();
      place(pos.x + num(msg.dx, 2000), pos.y + num(msg.dy, 2000));
    },
    // 절대 이동 (화면을 직접 터치) — x, y는 0~1
    abs(msg) {
      const { width, height } = screenSize();
      syncPos();
      place(num(msg.x, 1) * width, num(msg.y, 1) * height);
    },
    btn(msg) {
      const b = BUTTONS.has(msg.b) ? msg.b : 'left';
      if (msg.d) {
        if (heldButtons.has(b)) return;
        heldButtons.add(b);
        nut.mouseToggle('down', b);
      } else {
        if (!heldButtons.has(b)) return;
        heldButtons.delete(b);
        nut.mouseToggle('up', b);
      }
    },
    click(msg) {
      const b = BUTTONS.has(msg.b) ? msg.b : 'left';
      // 더블클릭의 두 번째 탭. 윈도우는 연달아 온 클릭 두 번을 스스로 더블클릭으로 묶으므로
      // 한 번만 보내고, macOS는 더블클릭임을 명시해야 한다.
      nut.mouseClick(b, Boolean(msg.double) && PLATFORM === 'mac');
    },
    scroll(msg) {
      // 손가락이 움직인 방향으로 내용이 따라오는 '자연스러운 스크롤'.
      // 윈도우의 휠 단위(한 칸 = 120)는 픽셀보다 훨씬 커서 배율을 준다.
      const k = PLATFORM === 'win' ? 3 : 1;
      const dx = Math.round(num(msg.dx, 400) * k * (PLATFORM === 'win' ? -1 : 1)) || 0;
      const dy = Math.round(num(msg.dy, 400) * k);
      if (dx || dy) nut.scrollMouse(dx, dy);
    },
    hangul() {
      toggleHangul();
    },
    key(msg) {
      const k = String(msg.k);
      if (!KEYS.has(k)) return;
      if (msg.d) {
        heldKeys.add(k);
        nut.keyToggle(k, 'down', MODIFIERS[k] ? [] : activeMods());
      } else {
        if (!heldKeys.has(k)) return;
        heldKeys.delete(k);
        nut.keyToggle(k, 'up', MODIFIERS[k] ? [] : activeMods());
      }
    },
  };

  return {
    native: Boolean(native),
    platform: PLATFORM,
    screenSize,
    handle(msg) {
      const fn = handlers[msg && msg.t];
      if (!fn) return false;
      try {
        fn(msg);
      } catch (err) {
        console.warn('입력 처리 오류:', err.message);
      }
      return true;
    },
    // 폰 연결이 끊기면 눌린 채로 남은 키·버튼을 모두 뗀다.
    releaseAll() {
      for (const k of [...heldKeys]) handlers.key({ k, d: 0 });
      for (const b of [...heldButtons]) handlers.btn({ b, d: 0 });
    },
  };
}

module.exports = { createInput };
