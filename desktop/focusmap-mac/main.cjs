const { app, BrowserWindow, Menu, ipcMain, shell } = require('electron');
const { spawn, execFile } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const APP_PORT = Number(process.env.FOCUSMAP_DESKTOP_PORT || 3001);
const APP_ORIGIN = process.env.FOCUSMAP_DESKTOP_URL || `http://127.0.0.1:${APP_PORT}`;
function resolveRepoRoot() {
  if (process.env.FOCUSMAP_REPO_DIR) return process.env.FOCUSMAP_REPO_DIR;
  const candidates = [
    process.cwd(),
    path.resolve(__dirname, '..', '..'),
    path.join(os.homedir(), 'Private', 'focusmap'),
    path.join(os.homedir(), 'focusmap'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'package.json')) && fs.existsSync(path.join(candidate, 'src'))) {
      return candidate;
    }
  }
  return path.resolve(__dirname, '..', '..');
}

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const env = {};
  for (const rawLine of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    let value = rawValue.trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function loadDesktopEnv(repoRoot) {
  return [
    path.join(repoRoot, '.env'),
    path.join(repoRoot, '.env.local'),
    path.join(os.homedir(), '.focusmap', 'desktop.env'),
  ].reduce((merged, filePath) => ({ ...merged, ...parseEnvFile(filePath) }), {});
}

const REPO_ROOT = resolveRepoRoot();
const DESKTOP_ENV = loadDesktopEnv(REPO_ROOT);
const WEB_AUTH_ORIGIN = (
  process.env.FOCUSMAP_WEB_AUTH_ORIGIN ||
  DESKTOP_ENV.FOCUSMAP_WEB_AUTH_ORIGIN ||
  process.env.NEXT_PUBLIC_APP_URL ||
  DESKTOP_ENV.NEXT_PUBLIC_APP_URL ||
  'https://focusmap-official.com'
).replace(/\/$/, '');
const RESOURCE_ROOT = app.isPackaged ? process.resourcesPath : REPO_ROOT;
const CONFIG_PATH = path.join(os.homedir(), '.focusmap', 'config.json');
const CODEX_APP_BIN = '/Applications/Codex.app/Contents/Resources/codex';
const AGENT_CLI = app.isPackaged
  ? path.join(RESOURCE_ROOT, 'focusmap-agent', 'dist', 'cli.js')
  : path.join(REPO_ROOT, 'scripts', 'focusmap-agent', 'dist', 'cli.js');
const CODEX_SERVER_SCRIPT = app.isPackaged
  ? path.join(RESOURCE_ROOT, 'run-codex-app-server.sh')
  : path.join(REPO_ROOT, 'scripts', 'run-codex-app-server.sh');
const APP_ICON_PATH = app.isPackaged
  ? path.join(process.resourcesPath, 'icon.icns')
  : path.join(__dirname, 'assets', 'icon.png');
const FALLBACK_APP_ICON_PATH = path.join(__dirname, 'assets', 'icon.png');
const LOG_LIMIT = 160;
const GOOGLE_AUTH_HOSTS = new Set(['accounts.google.com', 'oauth2.googleapis.com']);
const CHILD_PATH = `${os.homedir()}/.npm-global/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH || ''}`;

let mainWindow = null;
let statusWindow = null;
const managedProcesses = {
  next: null,
  agent: null,
  codex: null,
};
const processLogs = [];
const hasSingleInstance = app.requestSingleInstanceLock();
let lastExternalAuthUrl = '';
let lastExternalAuthAt = 0;
let dashboardLoadAttemptedAt = 0;

function focusWindow(win) {
  if (!win || win.isDestroyed()) return false;
  if (win.isMinimized()) win.restore();
  win.focus();
  return true;
}

function appIconPath() {
  if (fs.existsSync(APP_ICON_PATH)) return APP_ICON_PATH;
  return FALLBACK_APP_ICON_PATH;
}

function setDockIcon() {
  if (app.dock && fs.existsSync(appIconPath())) app.dock.setIcon(appIconPath());
}

function log(scope, message) {
  const line = `[${new Date().toLocaleTimeString('ja-JP', { hour12: false })}] ${scope}: ${message}`;
  processLogs.push(line);
  if (processLogs.length > LOG_LIMIT) processLogs.splice(0, processLogs.length - LOG_LIMIT);
  statusWindow?.webContents.send('focusmap-desktop:log', line);

  try {
    const logDir = path.join(os.homedir(), '.focusmap', 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(path.join(logDir, 'desktop-app.log'), `${line}\n`);
  } catch {
    // Keep UI startup independent from filesystem logging.
  }
}

function appendProcessLogs(scope, child) {
  child.stdout?.on('data', (chunk) => {
    for (const line of String(chunk).split(/\r?\n/).filter(Boolean)) log(scope, line);
  });
  child.stderr?.on('data', (chunk) => {
    for (const line of String(chunk).split(/\r?\n/).filter(Boolean)) log(scope, line);
  });
}

function attachProcessLifecycle(scope, child, processKey) {
  appendProcessLogs(scope, child);
  child.once('error', (error) => {
    log(scope, `spawn failed: ${error.message}`);
    if (managedProcesses[processKey] === child) managedProcesses[processKey] = null;
  });
  child.once('exit', (code, signal) => {
    log(scope, `stopped code=${code ?? 'null'} signal=${signal ?? 'null'}`);
    if (managedProcesses[processKey] === child) managedProcesses[processKey] = null;
  });
}

function packagedNodeCommand() {
  return {
    command: process.execPath,
    env: { ELECTRON_RUN_AS_NODE: '1' },
  };
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

function isSameOrigin(urlString, origin) {
  try {
    return new URL(urlString).origin === origin;
  } catch {
    return false;
  }
}

function appOriginUrl() {
  try {
    return new URL(APP_ORIGIN);
  } catch {
    return null;
  }
}

function appOriginHost() {
  const url = appOriginUrl();
  return url?.hostname || '127.0.0.1';
}

function dashboardUrl(origin = APP_ORIGIN) {
  return `${origin}/dashboard?desktop=1&source=mac`;
}

function isLoadingScreenUrl(urlString) {
  try {
    const url = new URL(urlString);
    return url.protocol === 'file:' && url.pathname.endsWith('/loading.html');
  } catch {
    return false;
  }
}

function normalizeHttpOrigin(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

function allowedDesktopAuthOrigins() {
  return new Set([APP_ORIGIN, WEB_AUTH_ORIGIN].map(normalizeHttpOrigin).filter(Boolean));
}

function resolveDesktopAuthOrigin(value) {
  const origin = normalizeHttpOrigin(value || WEB_AUTH_ORIGIN);
  if (!origin) throw new Error('認証セッション取得先URLが不正です');
  if (!allowedDesktopAuthOrigins().has(origin)) {
    throw new Error(`許可されていない認証セッション取得先です: ${origin}`);
  }
  return origin;
}

function isGoogleAuthUrl(urlString) {
  try {
    const url = new URL(urlString);
    return GOOGLE_AUTH_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

function isSupabaseAuthUrl(urlString) {
  try {
    const url = new URL(urlString);
    return url.hostname.endsWith('.supabase.co') && url.pathname.startsWith('/auth/v1/');
  } catch {
    return false;
  }
}

function isCalendarConnectUrl(urlString) {
  try {
    const url = new URL(urlString);
    return isSameOrigin(urlString, APP_ORIGIN) && url.pathname === '/api/calendar/connect';
  } catch {
    return false;
  }
}

function withDesktopOAuth(urlString) {
  const url = new URL(urlString);
  url.searchParams.set('desktop_oauth', '1');
  return url.toString();
}

function hasGoogleOAuthConfig() {
  return Boolean(
    (process.env.GOOGLE_CLIENT_ID || DESKTOP_ENV.GOOGLE_CLIENT_ID) &&
    (process.env.GOOGLE_CLIENT_SECRET || DESKTOP_ENV.GOOGLE_CLIENT_SECRET)
  );
}

function toWebAuthCalendarConnectUrl(urlString) {
  const sourceUrl = new URL(urlString);
  const targetUrl = new URL('/api/calendar/connect', WEB_AUTH_ORIGIN);
  for (const [key, value] of sourceUrl.searchParams.entries()) {
    if (key !== 'desktop_oauth') targetUrl.searchParams.append(key, value);
  }
  if (!targetUrl.searchParams.has('next')) targetUrl.searchParams.set('next', '/dashboard');
  return targetUrl.toString();
}

function openAuthExternally(url) {
  const now = Date.now();
  if (url === lastExternalAuthUrl && now - lastExternalAuthAt < 5000) return;
  lastExternalAuthUrl = url;
  lastExternalAuthAt = now;
  shell.openExternal(url);
}

function isNavigationAbortError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('ERR_ABORTED') || message.includes('(-3)');
}

async function loadFileAllowingAbort(win, filePath, options) {
  try {
    await win.loadFile(filePath, options);
  } catch (error) {
    if (!isNavigationAbortError(error)) throw error;
  }
}

async function loadUrlAllowingRedirect(win, url) {
  try {
    await win.loadURL(url);
  } catch (error) {
    if (!isNavigationAbortError(error)) throw error;
    log('app', `navigation redirected or replaced: ${url}`);
  }
}

function loadDashboardSoon(reason) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const currentUrl = mainWindow.webContents.getURL();
  if (isSameOrigin(currentUrl, APP_ORIGIN) && !isLoadingScreenUrl(currentUrl)) return;

  const now = Date.now();
  if (now - dashboardLoadAttemptedAt < 1500) return;
  dashboardLoadAttemptedAt = now;

  void loadUrlAllowingRedirect(mainWindow, dashboardUrl()).catch((error) => {
    log('app', `dashboard load failed (${reason}): ${error.message}`);
  });
}

async function loadDashboardWhenReady(reason) {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  if (isLocalAppOrigin() && await tcpReady(appOriginHost(), APP_PORT, 250)) {
    // If the local server is already accepting connections, show the dashboard
    // immediately and let the health check finish in the background.
    loadDashboardSoon(`${reason}:tcp-ready`);
  }

  const origin = await ensureFocusmapApp();
  if (mainWindow && !mainWindow.isDestroyed()) {
    const currentUrl = mainWindow.webContents.getURL();
    if (!isSameOrigin(currentUrl, origin) || isLoadingScreenUrl(currentUrl)) {
      await loadUrlAllowingRedirect(mainWindow, dashboardUrl(origin));
    }
  }
}

function focusAndRetryMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  focusWindow(mainWindow);
  const currentUrl = mainWindow.webContents.getURL();
  if (isLoadingScreenUrl(currentUrl)) {
    void loadDashboardWhenReady('focus-retry').catch((error) => {
      log('app', error instanceof Error ? error.message : String(error));
    });
  }
  return true;
}

function keepMainWindowOnLocalLogin() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const currentUrl = mainWindow.webContents.getURL();
  if (isSameOrigin(currentUrl, APP_ORIGIN)) return;
  mainWindow.loadURL(`${APP_ORIGIN}/login?desktop=1&source=mac`).catch((error) => {
    if (!isNavigationAbortError(error)) log('auth', `failed to return to local login: ${error.message}`);
  });
}

function handleMainNavigation(event, url) {
  if (isCalendarConnectUrl(url)) {
    const nextUrl = new URL(url);
    if (nextUrl.searchParams.get('desktop_oauth') !== '1') {
      event.preventDefault();
      if (hasGoogleOAuthConfig()) {
        mainWindow?.loadURL(withDesktopOAuth(url)).catch((error) => {
          if (!isNavigationAbortError(error)) log('calendar', `failed to start desktop OAuth: ${error.message}`);
        });
      } else {
        shell.openExternal(toWebAuthCalendarConnectUrl(url));
      }
      return true;
    }
  }

  if (isGoogleAuthUrl(url)) {
    event.preventDefault();
    openAuthExternally(url);
    keepMainWindowOnLocalLogin();
    return true;
  }

  return false;
}

function handleAuthNavigationFallback(url, isMainFrame = true) {
  if (!isMainFrame) return false;
  if (!isGoogleAuthUrl(url) && !isSupabaseAuthUrl(url)) return false;
  openAuthExternally(url);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.stop();
    keepMainWindowOnLocalLogin();
  }
  return true;
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
  const nodeRuntime = packagedNodeCommand();
  const command = isPackagedStandalone ? nodeRuntime.command : devNextBin;
  const args = isPackagedStandalone ? [standaloneServer] : ['dev', '-p', String(APP_PORT)];
  const cwd = isPackagedStandalone ? path.dirname(standaloneServer) : REPO_ROOT;

  if (!isPackagedStandalone && !fs.existsSync(devNextBin)) {
    throw new Error(`Next.js 実行ファイルが見つかりません: ${devNextBin}`);
  }

  const child = spawn(command, args, {
    cwd,
    env: {
      ...DESKTOP_ENV,
      ...process.env,
      ...(isPackagedStandalone ? nodeRuntime.env : {}),
      PATH: CHILD_PATH,
      HOSTNAME: '127.0.0.1',
      PORT: String(APP_PORT),
      NEXTAUTH_URL: process.env.NEXTAUTH_URL || DESKTOP_ENV.NEXTAUTH_URL || APP_ORIGIN,
      NODE_ENV: isPackagedStandalone ? 'production' : process.env.NODE_ENV || 'development',
      NODE_OPTIONS: process.env.NODE_OPTIONS || '--max-http-header-size=65536',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  managedProcesses.next = child;
  attachProcessLifecycle('next', child, 'next');
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

  const nodeRuntime = packagedNodeCommand();
  const env = {
    ...DESKTOP_ENV,
    ...process.env,
    ...(app.isPackaged ? nodeRuntime.env : {}),
  };
  delete env.ANTHROPIC_API_KEY;
  delete env.CLAUDECODE;
  env.PATH = CHILD_PATH;

  const agentConfigPath = prepareAgentConfigPath();
  const child = spawn(app.isPackaged ? nodeRuntime.command : 'node', [AGENT_CLI, 'start', '--config', agentConfigPath], {
    cwd: REPO_ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  managedProcesses.agent = child;
  attachProcessLifecycle('agent', child, 'agent');
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
  env.PATH = CHILD_PATH;

  const child = spawn(CODEX_SERVER_SCRIPT, [], {
    cwd: REPO_ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  managedProcesses.codex = child;
  attachProcessLifecycle('codex', child, 'codex');
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
    webAuthOrigin: WEB_AUTH_ORIGIN,
    configPath: CONFIG_PATH,
    configReady,
    googleOAuthReady: hasGoogleOAuthConfig(),
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

async function consumeExternalAuthSession(_event, nonce, originInput) {
  if (typeof nonce !== 'string' || !nonce || nonce.length > 128) {
    return { ok: false, status: 400, payload: { error: 'nonce is required' } };
  }
  if (typeof fetch !== 'function') {
    return { ok: false, status: 500, payload: { error: 'fetch is not available in this Electron runtime' } };
  }

  try {
    const origin = resolveDesktopAuthOrigin(originInput);
    const url = new URL('/api/auth/desktop-session', origin);
    url.searchParams.set('nonce', nonce);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(url.toString(), {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => null);
      return { ok: response.ok, status: response.status, payload };
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, status: 500, payload: { error: message } };
  }
}

async function createMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    focusAndRetryMainWindow();
    return;
  }

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 680,
    show: true,
    title: 'Focusmap',
    icon: appIconPath(),
    backgroundColor: '#050505',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  void loadFileAllowingAbort(mainWindow, path.join(__dirname, 'loading.html')).catch((error) => {
    log('app', `failed to load loading screen: ${error.message}`);
  });
  mainWindow.webContents.on('will-navigate', handleMainNavigation);
  mainWindow.webContents.on('will-redirect', (event, url, isInPlace, isMainFrame) => {
    if (handleMainNavigation(event, url)) return;
    if (handleAuthNavigationFallback(url, isMainFrame)) event.preventDefault();
  });
  mainWindow.webContents.on('did-start-navigation', (_event, url, isInPlace, isMainFrame) => {
    handleAuthNavigationFallback(url, isMainFrame);
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isGoogleAuthUrl(url) || isSupabaseAuthUrl(url)) {
      openAuthExternally(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  try {
    await loadDashboardWhenReady('create-main-window');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log('app', message);
    if (mainWindow && !mainWindow.isDestroyed()) {
      await loadFileAllowingAbort(mainWindow, path.join(__dirname, 'loading.html'), {
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
    icon: appIconPath(),
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
  if (focusAndRetryMainWindow() || focusWindow(statusWindow)) return;
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
ipcMain.handle('focusmap-desktop:getWebAuthOrigin', () => WEB_AUTH_ORIGIN);
ipcMain.handle('focusmap-desktop:consumeAuthSession', consumeExternalAuthSession);

app.on('before-quit', () => {
  for (const name of Object.keys(managedProcesses)) {
    if (isChildRunning(managedProcesses[name])) managedProcesses[name].kill('SIGTERM');
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (focusAndRetryMainWindow()) return;
  createMainWindow();
});

app.whenReady().then(async () => {
  if (app.dock) {
    setDockIcon();
    app.dock.show();
  }
  buildMenu();
  try {
    await createMainWindow();
  } catch (error) {
    log('app', error instanceof Error ? error.message : String(error));
  }
});
