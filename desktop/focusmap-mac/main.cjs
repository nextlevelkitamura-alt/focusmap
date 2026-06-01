const { app, BrowserWindow, Menu, ipcMain, shell } = require('electron');
const { spawn, execFile } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const APP_PORT = Number(process.env.FOCUSMAP_DESKTOP_PORT || 3001);
const APP_ORIGIN = process.env.FOCUSMAP_DESKTOP_URL || `http://127.0.0.1:${APP_PORT}`;
const REPO_ROOT = process.env.FOCUSMAP_REPO_DIR || path.resolve(__dirname, '..', '..');
const RESOURCE_ROOT = app.isPackaged ? process.resourcesPath : REPO_ROOT;
const CONFIG_PATH = path.join(os.homedir(), '.focusmap', 'config.json');
const CODEX_APP_BIN = '/Applications/Codex.app/Contents/Resources/codex';
const AGENT_CLI = app.isPackaged
  ? path.join(RESOURCE_ROOT, 'focusmap-agent', 'dist', 'cli.js')
  : path.join(REPO_ROOT, 'scripts', 'focusmap-agent', 'dist', 'cli.js');
const CODEX_SERVER_SCRIPT = app.isPackaged
  ? path.join(RESOURCE_ROOT, 'run-codex-app-server.sh')
  : path.join(REPO_ROOT, 'scripts', 'run-codex-app-server.sh');
const LOG_LIMIT = 160;

let mainWindow = null;
let statusWindow = null;
const managedProcesses = {
  next: null,
  agent: null,
  codex: null,
};
const processLogs = [];
const hasSingleInstance = app.requestSingleInstanceLock();

function focusWindow(win) {
  if (!win || win.isDestroyed()) return false;
  if (win.isMinimized()) win.restore();
  win.focus();
  return true;
}

function log(scope, message) {
  const line = `[${new Date().toLocaleTimeString('ja-JP', { hour12: false })}] ${scope}: ${message}`;
  processLogs.push(line);
  if (processLogs.length > LOG_LIMIT) processLogs.splice(0, processLogs.length - LOG_LIMIT);
  statusWindow?.webContents.send('focusmap-desktop:log', line);
}

function appendProcessLogs(scope, child) {
  child.stdout?.on('data', (chunk) => {
    for (const line of String(chunk).split(/\r?\n/).filter(Boolean)) log(scope, line);
  });
  child.stderr?.on('data', (chunk) => {
    for (const line of String(chunk).split(/\r?\n/).filter(Boolean)) log(scope, line);
  });
}

function isChildRunning(child) {
  return Boolean(child && child.exitCode === null && !child.killed);
}

function isMac() {
  return process.platform === 'darwin';
}

function commandExists(command) {
  return new Promise((resolve) => {
    execFile('/usr/bin/env', ['which', command], { timeout: 3000 }, (error) => {
      resolve(!error);
    });
  });
}

function launchctlHas(label) {
  if (!isMac()) return Promise.resolve(false);
  return new Promise((resolve) => {
    execFile('launchctl', ['list'], { timeout: 3000 }, (error, stdout) => {
      if (error) return resolve(false);
      resolve(stdout.includes(label));
    });
  });
}

function tcpReady(host, port, timeoutMs = 800) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const timer = setTimeout(() => finish(false), timeoutMs);
    function finish(ok) {
      clearTimeout(timer);
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    }
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

function httpReady(url, timeoutMs = 1000) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      res.resume();
      resolve(res.statusCode ? res.statusCode < 500 && res.statusCode !== 404 : true);
    });
    req.once('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.once('error', () => resolve(false));
  });
}

function healthUrl() {
  return `${APP_ORIGIN}/api/desktop/health`;
}

function isLocalAppOrigin() {
  return /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(APP_ORIGIN);
}

function preferredAgentApiUrl() {
  if (process.env.FOCUSMAP_DESKTOP_AGENT_API_URL) {
    return process.env.FOCUSMAP_DESKTOP_AGENT_API_URL.replace(/\/$/, '');
  }
  if (!app.isPackaged && isLocalAppOrigin()) return `${APP_ORIGIN}/api`;
  return null;
}

function prepareAgentConfigPath() {
  const overrideApiUrl = preferredAgentApiUrl();
  if (!overrideApiUrl) return CONFIG_PATH;

  const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  const runtimeConfig = {
    ...raw,
    api_url: overrideApiUrl,
    desktop_runtime_config: true,
    desktop_runtime_config_source: CONFIG_PATH,
    desktop_runtime_config_updated_at: new Date().toISOString(),
  };
  const configDir = path.join(os.homedir(), 'Library', 'Application Support', 'Focusmap');
  fs.mkdirSync(configDir, { recursive: true });
  const runtimePath = path.join(configDir, 'agent-config.json');
  fs.writeFileSync(runtimePath, JSON.stringify(runtimeConfig, null, 2));
  fs.chmodSync(runtimePath, 0o600);
  return runtimePath;
}

async function waitForHttp(url, timeoutMs = 60_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await httpReady(url, 1200)) return true;
    await new Promise((resolve) => setTimeout(resolve, 800));
  }
  return false;
}

function startNextServer() {
  if (process.env.FOCUSMAP_DESKTOP_URL) return null;
  if (isChildRunning(managedProcesses.next)) return managedProcesses.next;

  const devNextBin = path.join(REPO_ROOT, 'node_modules', '.bin', 'next');
  const standaloneServer = path.join(process.resourcesPath || '', 'next-standalone', 'server.js');
  const isPackagedStandalone = app.isPackaged && fs.existsSync(standaloneServer);
  const command = isPackagedStandalone ? 'node' : devNextBin;
  const args = isPackagedStandalone ? [standaloneServer] : ['dev', '-p', String(APP_PORT)];
  const cwd = isPackagedStandalone ? path.dirname(standaloneServer) : REPO_ROOT;

  if (!isPackagedStandalone && !fs.existsSync(devNextBin)) {
    throw new Error(`Next.js 実行ファイルが見つかりません: ${devNextBin}`);
  }

  const child = spawn(command, args, {
    cwd,
    env: {
      ...process.env,
      HOSTNAME: '127.0.0.1',
      PORT: String(APP_PORT),
      NODE_ENV: isPackagedStandalone ? 'production' : process.env.NODE_ENV || 'development',
      NODE_OPTIONS: process.env.NODE_OPTIONS || '--max-http-header-size=65536',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  managedProcesses.next = child;
  appendProcessLogs('next', child);
  child.once('exit', (code, signal) => {
    log('next', `stopped code=${code ?? 'null'} signal=${signal ?? 'null'}`);
    if (managedProcesses.next === child) managedProcesses.next = null;
  });
  log('next', `starting ${isPackagedStandalone ? 'standalone' : 'dev'} server on ${APP_ORIGIN}`);
  return child;
}

async function ensureFocusmapApp() {
  if (await httpReady(healthUrl(), 1200)) return APP_ORIGIN;
  startNextServer();
  const ready = await waitForHttp(healthUrl(), 60_000);
  if (!ready) throw new Error(`Focusmap を ${APP_ORIGIN} で起動できませんでした`);
  return APP_ORIGIN;
}

async function startAgent() {
  if (isChildRunning(managedProcesses.agent)) return { ok: true, message: 'agentは起動済みです' };
  if (!fs.existsSync(CONFIG_PATH)) {
    return {
      ok: false,
      message: `設定ファイルがありません: ${CONFIG_PATH}`,
    };
  }
  if (!fs.existsSync(AGENT_CLI)) {
    return {
      ok: false,
      message: `agentのビルドがありません: ${AGENT_CLI}。先に scripts/focusmap-agent で npm run build を実行してください。`,
    };
  }

  const agentApiUrl = preferredAgentApiUrl();
  if (agentApiUrl?.startsWith(APP_ORIGIN)) await ensureFocusmapApp();

  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  delete env.CLAUDECODE;
  env.PATH = `${os.homedir()}/.npm-global/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${env.PATH || ''}`;

  const agentConfigPath = prepareAgentConfigPath();
  const child = spawn('node', [AGENT_CLI, 'start', '--config', agentConfigPath], {
    cwd: REPO_ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  managedProcesses.agent = child;
  appendProcessLogs('agent', child);
  child.once('exit', (code, signal) => {
    log('agent', `stopped code=${code ?? 'null'} signal=${signal ?? 'null'}`);
    if (managedProcesses.agent === child) managedProcesses.agent = null;
  });
  log('agent', `starting focusmap-agent with ${agentConfigPath}`);
  return { ok: true, message: 'agentを起動しました' };
}

function stopManagedProcess(name) {
  const child = managedProcesses[name];
  if (!isChildRunning(child)) return { ok: true, message: `${name}はこのMacアプリからは起動していません` };
  child.kill('SIGTERM');
  managedProcesses[name] = null;
  log(name, 'stop requested');
  return { ok: true, message: `${name}を停止しました` };
}

async function startCodexServer() {
  if (await tcpReady('127.0.0.1', 7878)) {
    return { ok: true, message: 'Codex app-serverは起動済みです' };
  }
  if (!fs.existsSync(CODEX_SERVER_SCRIPT)) {
    return { ok: false, message: `Codex app-server起動スクリプトがありません: ${CODEX_SERVER_SCRIPT}` };
  }
  if (!fs.existsSync(CODEX_APP_BIN) && !(await commandExists('codex'))) {
    return { ok: false, message: 'Codex.app または codex CLI が見つかりません' };
  }

  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  delete env.CLAUDECODE;
  env.PATH = `${os.homedir()}/.npm-global/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${env.PATH || ''}`;

  const child = spawn(CODEX_SERVER_SCRIPT, [], {
    cwd: REPO_ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  managedProcesses.codex = child;
  appendProcessLogs('codex', child);
  child.once('exit', (code, signal) => {
    log('codex', `stopped code=${code ?? 'null'} signal=${signal ?? 'null'}`);
    if (managedProcesses.codex === child) managedProcesses.codex = null;
  });
  log('codex', 'starting codex app-server on ws://127.0.0.1:7878');
  return { ok: true, message: 'Codex app-serverを起動しました' };
}

async function collectStatus() {
  const [appReady, codexCli, codexServerReady, agentLaunchd, codexLaunchd] = await Promise.all([
    httpReady(healthUrl(), 700),
    commandExists('codex'),
    tcpReady('127.0.0.1', 7878),
    launchctlHas('com.focusmap-official.agent'),
    launchctlHas('com.focusmap-official.codex-app-server'),
  ]);
  const configReady = fs.existsSync(CONFIG_PATH);
  const codexAppInstalled = fs.existsSync(CODEX_APP_BIN);
  return {
    appOrigin: APP_ORIGIN,
    agentApiUrl: preferredAgentApiUrl(),
    repoRoot: REPO_ROOT,
    configPath: CONFIG_PATH,
    configReady,
    nextReady: appReady,
    nextManaged: isChildRunning(managedProcesses.next),
    agentManaged: isChildRunning(managedProcesses.agent),
    agentLaunchd,
    codexAppInstalled,
    codexCliInstalled: codexCli,
    codexServerReady,
    codexManaged: isChildRunning(managedProcesses.codex),
    codexLaunchd,
    logs: processLogs.slice(-80),
  };
}

async function createMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    focusWindow(mainWindow);
    return;
  }

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 680,
    show: true,
    title: 'Focusmap',
    backgroundColor: '#050505',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'loading.html'));
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  try {
    const origin = await ensureFocusmapApp();
    if (mainWindow && !mainWindow.isDestroyed()) {
      await mainWindow.loadURL(`${origin}/dashboard?desktop=1&source=mac`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log('app', message);
    if (mainWindow && !mainWindow.isDestroyed()) {
      await mainWindow.loadFile(path.join(__dirname, 'loading.html'), {
        query: { error: message },
      });
    }
    createStatusWindow();
  }
}

function createStatusWindow() {
  if (statusWindow && !statusWindow.isDestroyed()) {
    statusWindow.focus();
    return;
  }
  statusWindow = new BrowserWindow({
    width: 520,
    height: 620,
    title: 'Focusmap 接続状態',
    resizable: true,
    backgroundColor: '#0a0a0a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  statusWindow.loadFile(path.join(__dirname, 'status.html'));
  statusWindow.on('closed', () => {
    statusWindow = null;
  });
}

function buildMenu() {
  const template = [
    {
      label: 'Focusmap',
      submenu: [
        { label: '接続状態を開く', click: createStatusWindow },
        {
          label: 'Focusmapを開く',
          click: () => {
            if (mainWindow) mainWindow.focus();
            else createMainWindow();
          },
        },
        { type: 'separator' },
        { label: 'Agentを起動', click: () => startAgent().then((result) => log('agent', result.message)) },
        { label: 'Codex app-serverを起動', click: () => startCodexServer().then((result) => log('codex', result.message)) },
        { type: 'separator' },
        { label: 'Focusmap Webをブラウザで開く', click: () => shell.openExternal(`${APP_ORIGIN}/dashboard`) },
        { type: 'separator' },
        { role: 'quit', label: '終了' },
      ],
    },
    { role: 'editMenu', label: '編集' },
    { role: 'viewMenu', label: '表示' },
    { role: 'windowMenu', label: 'ウィンドウ' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

if (!hasSingleInstance) {
  app.quit();
}

app.on('second-instance', () => {
  if (focusWindow(mainWindow) || focusWindow(statusWindow)) return;
  createMainWindow().catch((error) => {
    log('app', error instanceof Error ? error.message : String(error));
    createStatusWindow();
  });
});

ipcMain.handle('focusmap-desktop:getStatus', collectStatus);
ipcMain.handle('focusmap-desktop:startAgent', startAgent);
ipcMain.handle('focusmap-desktop:stopAgent', () => stopManagedProcess('agent'));
ipcMain.handle('focusmap-desktop:startCodexServer', startCodexServer);
ipcMain.handle('focusmap-desktop:stopCodexServer', () => stopManagedProcess('codex'));
ipcMain.handle('focusmap-desktop:openMain', () => {
  createMainWindow();
  return true;
});
ipcMain.handle('focusmap-desktop:openExternal', (_event, url) => shell.openExternal(url));

app.on('before-quit', () => {
  for (const name of Object.keys(managedProcesses)) {
    if (isChildRunning(managedProcesses[name])) managedProcesses[name].kill('SIGTERM');
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  createMainWindow();
});

app.whenReady().then(async () => {
  if (app.dock) app.dock.show();
  buildMenu();
  try {
    await createMainWindow();
  } catch (error) {
    log('app', error instanceof Error ? error.message : String(error));
  }
});
