const { app, BrowserWindow, Menu, ipcMain, shell, safeStorage, powerSaveBlocker } = require('electron');
const { spawn, execFile } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const APP_PORT = Number(process.env.FOCUSMAP_DESKTOP_PORT || 3001);
const APP_ORIGIN = process.env.FOCUSMAP_DESKTOP_URL || `http://127.0.0.1:${APP_PORT}`;
const DESKTOP_USER_DATA_DIR = path.join(os.homedir(), 'Library', 'Application Support', 'focusmap-desktop-shell');
const DESKTOP_HEALTH_TOKEN = process.env.FOCUSMAP_DESKTOP_HEALTH_TOKEN || randomUUID();
app.setPath('userData', DESKTOP_USER_DATA_DIR);

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
const AUTOMATION_SUPERVISOR_INTERVAL_MS = Math.max(
  15_000,
  Number(process.env.FOCUSMAP_DESKTOP_SUPERVISOR_INTERVAL_MS || DESKTOP_ENV.FOCUSMAP_DESKTOP_SUPERVISOR_INTERVAL_MS || 30_000) || 30_000,
);
const RUNNER_KICK_COOLDOWN_MS = 5 * 60_000;
const RUNNER_RECOVERY_COOLDOWN_MS = 15 * 60_000;
const WEB_AUTH_ORIGIN = (
  process.env.FOCUSMAP_WEB_AUTH_ORIGIN ||
  DESKTOP_ENV.FOCUSMAP_WEB_AUTH_ORIGIN ||
  process.env.NEXT_PUBLIC_APP_URL ||
  DESKTOP_ENV.NEXT_PUBLIC_APP_URL ||
  'https://focusmap-official.com'
).replace(/\/$/, '');
const RESOURCE_ROOT = app.isPackaged ? process.resourcesPath : REPO_ROOT;
const CONFIG_PATH = path.join(os.homedir(), '.focusmap', 'config.json');
const AUTH_SESSION_PATH = path.join(DESKTOP_USER_DATA_DIR, 'auth-session.json');
const CODEX_APP_BIN = '/Applications/Codex.app/Contents/Resources/codex';
const AGENT_CLI = app.isPackaged
  ? path.join(RESOURCE_ROOT, 'focusmap-agent', 'dist', 'cli.js')
  : path.join(REPO_ROOT, 'scripts', 'focusmap-agent', 'dist', 'cli.js');
const CODEX_SERVER_SCRIPT = app.isPackaged
  ? path.join(RESOURCE_ROOT, 'run-codex-app-server.sh')
  : path.join(REPO_ROOT, 'scripts', 'run-codex-app-server.sh');
const TASK_RUNNER_SCRIPT = path.join(REPO_ROOT, 'scripts', 'run-task-runner.sh');
const TASK_RUNNER_PAUSE_FILE = path.join(REPO_ROOT, 'scripts', 'task-runner.paused');
const APP_ICON_PATH = app.isPackaged
  ? path.join(process.resourcesPath, 'icon.icns')
  : path.join(__dirname, 'assets', 'icon.png');
const FALLBACK_APP_ICON_PATH = path.join(__dirname, 'assets', 'icon.png');
const GOOGLE_AUTH_HOSTS = new Set(['accounts.google.com', 'oauth2.googleapis.com']);
const CHILD_PATH = `${os.homedir()}/.npm-global/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH || ''}`;

let mainWindow = null;
const managedProcesses = {
  next: null,
  agent: null,
  codex: null,
  runner: null,
};
const hasSingleInstance = app.requestSingleInstanceLock();
let lastExternalAuthUrl = '';
let lastExternalAuthAt = 0;
let dashboardLoadAttemptedAt = 0;
let automationSupervisorEnabled = false;
let automationSupervisorTimer = null;
let automationEnsurePromise = null;
let isQuitting = false;
let keepAwakeBlockerId = null;
let lastTaskRunnerKickAt = null;
let lastTaskRunnerKickMessage = null;
let lastRunnerRecoveryAttemptAt = 0;

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
  if (!app.dock) return;
  const candidates = [...new Set([appIconPath(), FALLBACK_APP_ICON_PATH])];
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    try {
      app.dock.setIcon(candidate);
      return;
    } catch (error) {
      log('app', `Dock icon load failed: ${candidate}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

function log(scope, message) {
  const line = `[${new Date().toLocaleTimeString('ja-JP', { hour12: false })}] ${scope}: ${message}`;

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
    if (!isQuitting && automationSupervisorEnabled && (processKey === 'agent' || processKey === 'codex')) {
      scheduleAutomationEnsure(`${processKey}-exit`, 2_000);
    }
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

function serviceResult(ok, message, extra = {}) {
  return { ok, message, ...extra };
}

function stopManagedProcess(processKey, label) {
  const child = managedProcesses[processKey];
  if (!isChildRunning(child)) {
    managedProcesses[processKey] = null;
    return serviceResult(true, `${label}はこのMacアプリからは起動していません`);
  }

  try {
    child.kill('SIGTERM');
    managedProcesses[processKey] = null;
    log(processKey, `${label}を停止しました`);
    return serviceResult(true, `${label}を停止しました`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(processKey, `${label}停止失敗: ${message}`);
    return serviceResult(false, `${label}停止失敗: ${message}`);
  }
}

function desktopAutoConnectEnabled() {
  const raw = process.env.FOCUSMAP_DESKTOP_AUTO_CONNECT || DESKTOP_ENV.FOCUSMAP_DESKTOP_AUTO_CONNECT;
  return raw !== '0' && raw !== 'false';
}

function ensureKeepAwake() {
  if (keepAwakeBlockerId !== null && powerSaveBlocker.isStarted(keepAwakeBlockerId)) return;
  try {
    keepAwakeBlockerId = powerSaveBlocker.start('prevent-app-suspension');
    log('power', `started prevent-app-suspension blocker id=${keepAwakeBlockerId}`);
  } catch (error) {
    log('power', `powerSaveBlocker start failed: ${error instanceof Error ? error.message : String(error)}`);
    keepAwakeBlockerId = null;
  }
}

function stopKeepAwake() {
  if (keepAwakeBlockerId === null) return;
  try {
    if (powerSaveBlocker.isStarted(keepAwakeBlockerId)) powerSaveBlocker.stop(keepAwakeBlockerId);
    log('power', `stopped prevent-app-suspension blocker id=${keepAwakeBlockerId}`);
  } catch (error) {
    log('power', `powerSaveBlocker stop failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    keepAwakeBlockerId = null;
  }
}

function keepAwakeStatus() {
  return {
    active: keepAwakeBlockerId !== null && powerSaveBlocker.isStarted(keepAwakeBlockerId),
    id: keepAwakeBlockerId,
    type: 'prevent-app-suspension',
  };
}

function processRunning(pattern) {
  return new Promise((resolve) => {
    execFile('/usr/bin/pgrep', ['-f', pattern], { timeout: 3000 }, (error, stdout) => {
      resolve(!error && stdout.trim().length > 0);
    });
  });
}

function commandExists(command) {
  return new Promise((resolve) => {
    execFile('/usr/bin/env', ['which', command], { timeout: 3000 }, (error) => {
      resolve(!error);
    });
  });
}

function readTaskRunnerPauseStatus() {
  if (!fs.existsSync(TASK_RUNNER_PAUSE_FILE)) {
    return {
      ready: fs.existsSync(TASK_RUNNER_SCRIPT),
      available: fs.existsSync(TASK_RUNNER_SCRIPT),
      paused: false,
      pauseFile: TASK_RUNNER_PAUSE_FILE,
      scriptPath: TASK_RUNNER_SCRIPT,
      lastKickAt: lastTaskRunnerKickAt,
      lastKickMessage: lastTaskRunnerKickMessage,
    };
  }

  let raw = '';
  try {
    raw = fs.readFileSync(TASK_RUNNER_PAUSE_FILE, 'utf8');
  } catch {
    raw = '';
  }
  const reason = raw.split(/\r?\n/).find((line) => line.startsWith('Reason:'))?.replace(/^Reason:\s*/, '') || null;
  const pausedAt = raw.split(/\r?\n/).find((line) => line.startsWith('Paused at'))?.replace(/^Paused at\s*/, '') || null;
  return {
    ready: false,
    available: fs.existsSync(TASK_RUNNER_SCRIPT),
    paused: true,
    pauseFile: TASK_RUNNER_PAUSE_FILE,
    scriptPath: TASK_RUNNER_SCRIPT,
    pausedAt,
    pauseReason: reason,
    lastKickAt: lastTaskRunnerKickAt,
    lastKickMessage: lastTaskRunnerKickMessage,
  };
}

function clearTaskRunnerPauseFile() {
  if (!fs.existsSync(TASK_RUNNER_PAUSE_FILE)) return false;
  fs.rmSync(TASK_RUNNER_PAUSE_FILE, { force: true });
  log('runner', `removed pause file ${TASK_RUNNER_PAUSE_FILE}`);
  return true;
}

function kickTaskRunnerOnce(reason) {
  if (isChildRunning(managedProcesses.runner)) {
    const message = `task-runnerは実行中です (${reason})`;
    lastTaskRunnerKickAt = new Date().toISOString();
    lastTaskRunnerKickMessage = message;
    return serviceResult(true, message);
  }

  if (!fs.existsSync(TASK_RUNNER_SCRIPT)) {
    const message = `task-runner起動スクリプトがありません: ${TASK_RUNNER_SCRIPT}`;
    lastTaskRunnerKickAt = new Date().toISOString();
    lastTaskRunnerKickMessage = message;
    return serviceResult(false, message);
  }

  const env = {
    ...DESKTOP_ENV,
    ...process.env,
    PATH: CHILD_PATH,
  };
  delete env.ANTHROPIC_API_KEY;
  delete env.CLAUDECODE;

  try {
    const child = spawn('/bin/bash', [TASK_RUNNER_SCRIPT], {
      cwd: REPO_ROOT,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    managedProcesses.runner = child;
    attachProcessLifecycle('runner', child, 'runner');
    lastTaskRunnerKickAt = new Date().toISOString();
    lastTaskRunnerKickMessage = `task-runnerを起動しました (${reason})`;
    log('runner', lastTaskRunnerKickMessage);
    return serviceResult(true, lastTaskRunnerKickMessage);
  } catch (error) {
    const message = `task-runner起動失敗: ${error instanceof Error ? error.message : String(error)}`;
    lastTaskRunnerKickAt = new Date().toISOString();
    lastTaskRunnerKickMessage = message;
    log('runner', message);
    return serviceResult(false, message);
  }
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

function httpRequest(url, timeoutMs = 1000, headers = {}) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs, headers }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode || 0,
          body: Buffer.concat(chunks).toString('utf8'),
        });
      });
    });
    req.once('timeout', () => {
      req.destroy();
      resolve({ statusCode: 0, body: '' });
    });
    req.once('error', () => resolve({ statusCode: 0, body: '' }));
  });
}

function healthUrl() {
  const url = new URL('/api/desktop/health', APP_ORIGIN);
  if (isLocalAppOrigin()) url.searchParams.set('desktop_token', DESKTOP_HEALTH_TOKEN);
  return url.toString();
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
  if (DESKTOP_ENV.FOCUSMAP_DESKTOP_AGENT_API_URL) {
    return DESKTOP_ENV.FOCUSMAP_DESKTOP_AGENT_API_URL.replace(/\/$/, '');
  }
  if (isLocalAppOrigin() && (
    !app.isPackaged ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    DESKTOP_ENV.SUPABASE_SERVICE_ROLE_KEY
  )) {
    return `${APP_ORIGIN}/api`;
  }
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

async function desktopHealthReady(timeoutMs = 1200) {
  const response = await httpRequest(healthUrl(), timeoutMs, {
    'x-focusmap-desktop-token': DESKTOP_HEALTH_TOKEN,
  });
  if (response.statusCode >= 500 || response.statusCode === 404 || response.statusCode === 0) return false;
  if (!isLocalAppOrigin() || process.env.FOCUSMAP_DESKTOP_URL) return true;

  try {
    const payload = JSON.parse(response.body);
    if (payload?.app !== 'focusmap') return false;
    if (!app.isPackaged) return true;
    return payload.desktop_token_ok === true;
  } catch {
    return false;
  }
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
      FOCUSMAP_DESKTOP_HEALTH_TOKEN: DESKTOP_HEALTH_TOKEN,
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
  if (await desktopHealthReady(1200)) return APP_ORIGIN;
  if (isLocalAppOrigin() && await tcpReady(appOriginHost(), APP_PORT, 250)) {
    throw new Error(`${APP_ORIGIN} は応答していますが、このFocusmap Macアプリが起動したWebではありません。3001番を使っている古いNext/別プロジェクトを終了してから、Focusmapを開き直してください。`);
  }
  startNextServer();
  const start = Date.now();
  let ready = false;
  while (Date.now() - start < 60_000) {
    if (await desktopHealthReady(1200)) {
      ready = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 800));
  }
  if (!ready) throw new Error(`Focusmap を ${APP_ORIGIN} で起動できませんでした`);
  return APP_ORIGIN;
}

function normalizeDesktopAuthSession(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const accessToken = payload.access_token;
  const refreshToken = payload.refresh_token;
  if (typeof accessToken !== 'string' || accessToken.length < 20) return null;
  if (typeof refreshToken !== 'string' || refreshToken.length < 20) return null;
  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_at: typeof payload.expires_at === 'number' ? payload.expires_at : null,
    user_id: typeof payload.user_id === 'string' ? payload.user_id : null,
    saved_at: new Date().toISOString(),
  };
}

function encodeDesktopAuthSession(sessionPayload) {
  const serialized = JSON.stringify({ version: 1, session: sessionPayload });
  if (safeStorage.isEncryptionAvailable()) {
    return {
      encryption: 'safeStorage',
      data: safeStorage.encryptString(serialized).toString('base64'),
    };
  }
  return {
    encryption: 'plain',
    data: serialized,
  };
}

function decodeDesktopAuthSession(filePayload) {
  if (!filePayload || typeof filePayload !== 'object') return null;
  if (filePayload.encryption === 'safeStorage' && typeof filePayload.data === 'string') {
    const decoded = safeStorage.decryptString(Buffer.from(filePayload.data, 'base64'));
    return JSON.parse(decoded).session;
  }
  if (filePayload.encryption === 'plain' && typeof filePayload.data === 'string') {
    return JSON.parse(filePayload.data).session;
  }
  return null;
}

function saveDesktopAuthSession(_event, payload) {
  const sessionPayload = normalizeDesktopAuthSession(payload);
  if (!sessionPayload) return { ok: false, error: '保存できるログインセッションがありません' };
  try {
    fs.mkdirSync(DESKTOP_USER_DATA_DIR, { recursive: true });
    fs.writeFileSync(AUTH_SESSION_PATH, JSON.stringify(encodeDesktopAuthSession(sessionPayload), null, 2));
    fs.chmodSync(AUTH_SESSION_PATH, 0o600);
    log('auth', 'saved desktop auth session locally');
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log('auth', `failed to save desktop auth session: ${message}`);
    return { ok: false, error: message };
  }
}

function loadDesktopAuthSession() {
  try {
    if (!fs.existsSync(AUTH_SESSION_PATH)) return { ok: true, session: null };
    const filePayload = JSON.parse(fs.readFileSync(AUTH_SESSION_PATH, 'utf8'));
    const sessionPayload = normalizeDesktopAuthSession(decodeDesktopAuthSession(filePayload));
    if (!sessionPayload) return { ok: true, session: null };
    return { ok: true, session: sessionPayload };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log('auth', `failed to load desktop auth session: ${message}`);
    return { ok: false, error: message, session: null };
  }
}

function clearDesktopAuthSession() {
  try {
    fs.rmSync(AUTH_SESSION_PATH, { force: true });
    log('auth', 'cleared desktop auth session');
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log('auth', `failed to clear desktop auth session: ${message}`);
    return { ok: false, error: message };
  }
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

function maybeRecoverTaskRunner(reason) {
  const pause = readTaskRunnerPauseStatus();
  if (!pause.paused) {
    if (lastTaskRunnerKickAt) {
      const lastKickMs = Date.parse(lastTaskRunnerKickAt);
      if (Number.isFinite(lastKickMs) && Date.now() - lastKickMs < RUNNER_KICK_COOLDOWN_MS) {
        return serviceResult(true, 'task-runnerは直近で起動確認済みです。');
      }
    }
    return kickTaskRunnerOnce(reason);
  }

  const now = Date.now();
  if (now - lastRunnerRecoveryAttemptAt < RUNNER_RECOVERY_COOLDOWN_MS) {
    return serviceResult(true, 'task-runnerはpause中です。直近で復旧を試したため、再試行を抑制しています。');
  }

  lastRunnerRecoveryAttemptAt = now;
  try {
    clearTaskRunnerPauseFile();
  } catch (error) {
    return serviceResult(false, `task-runner pause解除に失敗: ${error instanceof Error ? error.message : String(error)}`);
  }
  return kickTaskRunnerOnce(`${reason}:recover-paused-runner`);
}

async function ensureAutomationServices(reason, options = {}) {
  const results = {};
  ensureKeepAwake();

  try {
    await ensureFocusmapApp();
    results.app = serviceResult(true, 'FocusmapローカルWebは起動済みです');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    results.app = serviceResult(false, message);
  }

  try {
    results.agent = await startAgent();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    results.agent = serviceResult(false, message);
  }

  try {
    results.codex = await startCodexServer();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    results.codex = serviceResult(false, message);
  }

  if (options.recoverRunner !== false) {
    try {
      results.runner = maybeRecoverTaskRunner(reason);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.runner = serviceResult(false, message);
    }
  }

  const status = await getAutomationStatus();
  const ok = Boolean(results.app?.ok && results.agent?.ok && results.codex?.ok && results.runner?.ok !== false);
  const failed = Object.values(results).filter((result) => result && result.ok === false);
  return {
    ok,
    message: ok
      ? 'Mac連携を開始しました'
      : `Mac連携の開始に失敗した項目があります: ${failed.map((result) => result.message).join(' / ')}`,
    results,
    status,
  };
}

function scheduleAutomationEnsure(reason, delayMs = 0) {
  if (!automationSupervisorEnabled || isQuitting) return;
  if (automationEnsurePromise) return;
  const run = () => {
    if (!automationSupervisorEnabled || isQuitting || automationEnsurePromise) return;
    automationEnsurePromise = ensureAutomationServices(reason, { recoverRunner: true })
      .catch((error) => {
        log('supervisor', error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        automationEnsurePromise = null;
      });
  };
  if (delayMs > 0) setTimeout(run, delayMs);
  else run();
}

function startAutomationSupervisor(reason) {
  automationSupervisorEnabled = true;
  ensureKeepAwake();
  if (!automationSupervisorTimer) {
    automationSupervisorTimer = setInterval(() => {
      scheduleAutomationEnsure('interval');
    }, AUTOMATION_SUPERVISOR_INTERVAL_MS);
  }
  scheduleAutomationEnsure(reason);
}

function stopAutomationSupervisor() {
  automationSupervisorEnabled = false;
  if (automationSupervisorTimer) {
    clearInterval(automationSupervisorTimer);
    automationSupervisorTimer = null;
  }
  stopKeepAwake();
}

async function getAutomationStatus() {
  const [appReady, codexReady, codexCommandAvailable, externalAgentRunning] = await Promise.all([
    desktopHealthReady(800).catch(() => false),
    tcpReady('127.0.0.1', 7878, 500),
    commandExists('codex'),
    processRunning('focusmap-agent.*dist/cli\\.js.*start|scripts/focusmap-agent/dist/cli\\.js.*start').catch(() => false),
  ]);
  const agentManaged = isChildRunning(managedProcesses.agent);
  const codexManaged = isChildRunning(managedProcesses.codex);
  const agentReady = agentManaged || externalAgentRunning;
  const runner = readTaskRunnerPauseStatus();
  runner.ready = runner.available && !runner.paused;
  runner.managed = isChildRunning(managedProcesses.runner);

  return {
    ok: true,
    available: true,
    connected: Boolean(appReady && agentReady && codexReady && !runner.paused),
    timestamp: new Date().toISOString(),
    supervisor: {
      enabled: automationSupervisorEnabled,
      intervalMs: AUTOMATION_SUPERVISOR_INTERVAL_MS,
      autoConnectEnabled: desktopAutoConnectEnabled(),
    },
    keepAwake: keepAwakeStatus(),
    app: {
      ready: appReady,
      managed: isChildRunning(managedProcesses.next),
      origin: APP_ORIGIN,
      port: APP_PORT,
    },
    agent: {
      ready: agentReady,
      managed: agentManaged,
      external: externalAgentRunning,
      configured: fs.existsSync(CONFIG_PATH),
      available: fs.existsSync(AGENT_CLI),
      configPath: CONFIG_PATH,
      cliPath: AGENT_CLI,
      apiUrl: preferredAgentApiUrl() || 'config',
    },
    codex: {
      ready: codexReady,
      managed: codexManaged,
      available: fs.existsSync(CODEX_APP_BIN) || codexCommandAvailable,
      scriptAvailable: fs.existsSync(CODEX_SERVER_SCRIPT),
      scriptPath: CODEX_SERVER_SCRIPT,
      port: 7878,
    },
    runner,
    paths: {
      repoRoot: REPO_ROOT,
      logPath: path.join(os.homedir(), '.focusmap', 'logs', 'desktop-app.log'),
    },
  };
}

async function connectAutomation() {
  startAutomationSupervisor('manual-connect');
  return ensureAutomationServices('manual-connect', { recoverRunner: true });
}

async function disconnectAutomation() {
  stopAutomationSupervisor();
  const results = {
    agent: stopManagedProcess('agent', 'focusmap-agent'),
    codex: stopManagedProcess('codex', 'Codex app-server'),
    runner: stopManagedProcess('runner', 'task-runner'),
  };
  await new Promise((resolve) => setTimeout(resolve, 250));
  const status = await getAutomationStatus();
  return {
    ok: Object.values(results).every((result) => result.ok),
    message: 'このMacアプリが起動したAgent/Codex接続を停止しました',
    results,
    status,
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
      partition: 'persist:focusmap-desktop',
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
      focusWindow(mainWindow);
    }
    return;
  }
}

function buildMenu() {
  const template = [
    {
      label: 'Focusmap',
      submenu: [
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
  if (focusAndRetryMainWindow()) return;
  createMainWindow().catch((error) => {
    log('app', error instanceof Error ? error.message : String(error));
  });
});

ipcMain.handle('focusmap-desktop:openMain', () => {
  createMainWindow();
  return true;
});
ipcMain.handle('focusmap-desktop:openExternal', (_event, url) => shell.openExternal(url));
ipcMain.handle('focusmap-desktop:getWebAuthOrigin', () => WEB_AUTH_ORIGIN);
ipcMain.handle('focusmap-desktop:consumeAuthSession', consumeExternalAuthSession);
ipcMain.handle('focusmap-desktop:saveAuthSession', saveDesktopAuthSession);
ipcMain.handle('focusmap-desktop:loadAuthSession', loadDesktopAuthSession);
ipcMain.handle('focusmap-desktop:clearAuthSession', clearDesktopAuthSession);
ipcMain.handle('focusmap-desktop:getAutomationStatus', getAutomationStatus);
ipcMain.handle('focusmap-desktop:connectAutomation', connectAutomation);
ipcMain.handle('focusmap-desktop:disconnectAutomation', disconnectAutomation);

app.on('before-quit', () => {
  isQuitting = true;
  stopAutomationSupervisor();
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
    if (desktopAutoConnectEnabled()) startAutomationSupervisor('app-ready');
  } catch (error) {
    log('app', error instanceof Error ? error.message : String(error));
  }
});
