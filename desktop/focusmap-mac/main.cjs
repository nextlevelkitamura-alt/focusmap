const { app, BrowserWindow, Menu, ipcMain, shell, safeStorage, powerSaveBlocker, clipboard, nativeImage, session, dialog } = require('electron');
const { spawn, execFile } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { codexRepoListSql } = require('./codex-repos.cjs');

const APP_PORT = Number(process.env.FOCUSMAP_DESKTOP_PORT || 3001);
const LOCAL_APP_ORIGIN = `http://127.0.0.1:${APP_PORT}`;
const PRODUCTION_APP_ORIGIN = 'https://focusmap-official.com';
const FALLBACK_SUPABASE_URL = 'https://whsjsscgmkkkzgcwxjko.supabase.co';
const FALLBACK_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indoc2pzc2NnbWtra3pnY3d4amtvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg3MzgzNTcsImV4cCI6MjA4NDMxNDM1N30.qMVqh1DPzYFhJx29NtWghqfLGM68JHd3O51nxxWsWPA';
const DESKTOP_USER_DATA_DIR = path.join(os.homedir(), 'Library', 'Application Support', 'focusmap-desktop-shell');
const DESKTOP_BROWSER_PARTITION = 'persist:focusmap-desktop';
const DESKTOP_HEALTH_TOKEN = process.env.FOCUSMAP_DESKTOP_HEALTH_TOKEN || randomUUID();
const SUPABASE_AUTH_COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;
const SUPABASE_AUTH_COOKIE_CHUNK_SIZE = 3180;
const DESKTOP_AUTH_REFRESH_MARGIN_SECONDS = 10 * 60;
const REMOTE_UI_CACHE_CLEAR_TIMEOUT_MS = 2_500;
app.setName('Focusmap');
app.setAboutPanelOptions({ applicationName: 'Focusmap' });
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
    path.join(repoRoot, '.env.monitoring.local'),
    path.join(os.homedir(), '.focusmap', 'desktop.env'),
  ].reduce((merged, filePath) => ({ ...merged, ...parseEnvFile(filePath) }), {});
}

function envFlagEnabled(value) {
  if (typeof value !== 'string') return false;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

const REPO_ROOT = resolveRepoRoot();
const DESKTOP_ENV = loadDesktopEnv(REPO_ROOT);
const EXPLICIT_APP_ORIGIN = (
  process.env.FOCUSMAP_DESKTOP_URL ||
  DESKTOP_ENV.FOCUSMAP_DESKTOP_URL ||
  ''
).trim();
const DESKTOP_UI_MODE = (
  process.env.FOCUSMAP_DESKTOP_UI_MODE ||
  DESKTOP_ENV.FOCUSMAP_DESKTOP_UI_MODE ||
  ''
).trim().toLowerCase();
const APP_ORIGIN = normalizeOriginValue(
  EXPLICIT_APP_ORIGIN ||
  (DESKTOP_UI_MODE === 'remote' || (app.isPackaged && DESKTOP_UI_MODE !== 'local')
    ? PRODUCTION_APP_ORIGIN
    : LOCAL_APP_ORIGIN)
);
const LEGACY_TASK_RUNNER_ENABLED = envFlagEnabled(
  process.env.FOCUSMAP_DESKTOP_ENABLE_LEGACY_TASK_RUNNER ||
  DESKTOP_ENV.FOCUSMAP_DESKTOP_ENABLE_LEGACY_TASK_RUNNER,
);
const AUTOMATION_SUPERVISOR_INTERVAL_MS = Math.max(
  15_000,
  Number(process.env.FOCUSMAP_DESKTOP_SUPERVISOR_INTERVAL_MS || DESKTOP_ENV.FOCUSMAP_DESKTOP_SUPERVISOR_INTERVAL_MS || 30_000) || 30_000,
);
const RUNNER_KICK_COOLDOWN_MS = 5 * 60_000;
const RUNNER_RECOVERY_COOLDOWN_MS = 15 * 60_000;
const WEB_AUTH_ORIGIN = normalizeOriginValue(
  process.env.FOCUSMAP_WEB_AUTH_ORIGIN ||
  DESKTOP_ENV.FOCUSMAP_WEB_AUTH_ORIGIN ||
  process.env.NEXT_PUBLIC_APP_URL ||
  DESKTOP_ENV.NEXT_PUBLIC_APP_URL ||
  (!isLocalOriginValue(APP_ORIGIN) ? APP_ORIGIN : PRODUCTION_APP_ORIGIN)
);
const RESOURCE_ROOT = app.isPackaged ? process.resourcesPath : REPO_ROOT;
const CONFIG_PATH = path.join(os.homedir(), '.focusmap', 'config.json');
const AUTH_SESSION_PATH = path.join(DESKTOP_USER_DATA_DIR, 'auth-session.json');
const CODEX_APP_BIN = '/Applications/Codex.app/Contents/Resources/codex';
const CODEX_DOWNLOAD_URL = (
  process.env.FOCUSMAP_CODEX_DOWNLOAD_URL ||
  DESKTOP_ENV.FOCUSMAP_CODEX_DOWNLOAD_URL ||
  'https://openai.com/codex/'
).trim();
const CODEX_THREAD_IMPORT_API_PATH = '/api/agents/codex-monitor/import-thread';
const AGENT_CLI = app.isPackaged
  ? path.join(RESOURCE_ROOT, 'focusmap-agent', 'dist', 'cli.js')
  : path.join(REPO_ROOT, 'scripts', 'focusmap-agent', 'dist', 'cli.js');
const CODEX_SERVER_SCRIPT = app.isPackaged
  ? path.join(RESOURCE_ROOT, 'run-codex-app-server.sh')
  : path.join(REPO_ROOT, 'scripts', 'run-codex-app-server.sh');
const TASK_RUNNER_SCRIPT = path.join(REPO_ROOT, 'scripts', 'run-task-runner.sh');
const TASK_RUNNER_PAUSE_FILE = path.join(REPO_ROOT, 'scripts', 'task-runner.paused');
const APP_ICON_PATH = app.isPackaged
  ? path.join(process.resourcesPath, 'icon.png')
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
const PENDING_DESKTOP_AUTH_TTL_MS = 5 * 60 * 1000;
const pendingDesktopAuthNonces = new Map();
let lastExternalAuthUrl = '';
let lastExternalAuthAt = 0;
let dashboardLoadAttemptedAt = 0;
let remoteUiCacheClearPromise = null;
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

function timeoutAfter(ms, value) {
  return new Promise((resolve) => {
    setTimeout(() => resolve(value), ms);
  });
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

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function agentProcessPattern() {
  return `${escapeRegex(AGENT_CLI)}.*\\bstart\\b`;
}

function execFileText(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: 5000, windowsHide: true, ...options }, (error, stdout, stderr) => {
      if (error) {
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve(stdout);
    });
  });
}

async function commandPath(command) {
  try {
    const output = await execFileText('/usr/bin/env', ['which', command], {
      timeout: 3000,
      env: { ...process.env, PATH: CHILD_PATH },
    });
    return String(output).trim().split(/\r?\n/)[0] || null;
  } catch {
    return null;
  }
}

async function commandSupports(command, args, options = {}) {
  try {
    await execFileText(command, args, {
      timeout: 3000,
      env: { ...process.env, PATH: CHILD_PATH },
      ...options,
    });
    return true;
  } catch {
    return false;
  }
}

async function codexCliStatus() {
  const [pathCommand, appInstalled] = await Promise.all([
    commandPath('codex'),
    Promise.resolve(fs.existsSync(CODEX_APP_BIN)),
  ]);
  const resolvedPath = appInstalled ? CODEX_APP_BIN : pathCommand;
  const available = Boolean(resolvedPath);
  const [version, appServerCommandSupported, appCommandSupported] = resolvedPath
    ? await Promise.all([
        execFileText(resolvedPath, ['--version'], {
          timeout: 3000,
          env: { ...process.env, PATH: CHILD_PATH },
        }).then((value) => String(value).trim().split(/\r?\n/)[0] || null).catch(() => null),
        commandSupports(resolvedPath, ['app-server', '--help']),
        commandSupports(resolvedPath, ['app', '--help']),
      ])
    : [null, false, false];
  const updateRequired = available && !appServerCommandSupported;

  return {
    available,
    appInstalled,
    commandAvailable: Boolean(pathCommand),
    commandPath: pathCommand,
    resolvedPath,
    resolvedSource: appInstalled ? 'codex_app_bundle' : pathCommand ? 'path' : null,
    version,
    appServerCommandSupported,
    appCommandSupported,
    updateRequired,
    updateHint: updateRequired
      ? 'Codex CLIが古く app-server に対応していません。Codex Desktop/CLIをアップデートしてください。'
      : null,
  };
}

function readTaskRunnerPauseStatus() {
  const available = fs.existsSync(TASK_RUNNER_SCRIPT);
  const base = {
    enabled: LEGACY_TASK_RUNNER_ENABLED,
    available,
    pauseFile: TASK_RUNNER_PAUSE_FILE,
    scriptPath: TASK_RUNNER_SCRIPT,
    lastKickAt: lastTaskRunnerKickAt,
    lastKickMessage: lastTaskRunnerKickMessage,
  };

  if (!LEGACY_TASK_RUNNER_ENABLED) {
    return {
      ...base,
      ready: false,
      paused: false,
      mode: 'legacy-debug',
      connectionRequired: false,
      disabledReason: 'Codex監視はfocusmap-agentが通常担当します。旧task-runnerは互換/デバッグ時だけ起動します。',
    };
  }

  if (!fs.existsSync(TASK_RUNNER_PAUSE_FILE)) {
    return {
      ...base,
      ready: available,
      paused: false,
      mode: 'legacy-debug',
      connectionRequired: false,
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
    ...base,
    ready: false,
    paused: true,
    mode: 'legacy-debug',
    connectionRequired: false,
    pausedAt,
    pauseReason: reason,
  };
}

function clearTaskRunnerPauseFile() {
  if (!fs.existsSync(TASK_RUNNER_PAUSE_FILE)) return false;
  fs.rmSync(TASK_RUNNER_PAUSE_FILE, { force: true });
  log('runner', `removed pause file ${TASK_RUNNER_PAUSE_FILE}`);
  return true;
}

function kickTaskRunnerOnce(reason) {
  if (!LEGACY_TASK_RUNNER_ENABLED) {
    if (isChildRunning(managedProcesses.runner)) {
      const stopped = stopManagedProcess('runner', '旧task-runner');
      return serviceResult(
        stopped.ok,
        stopped.ok
          ? 'Codex監視はfocusmap-agent一本にしたため、旧task-runnerを停止しました。'
          : stopped.message,
      );
    }
    const message = '旧task-runnerは通常起動しません。Codex監視はfocusmap-agentが担当します。';
    lastTaskRunnerKickAt = new Date().toISOString();
    lastTaskRunnerKickMessage = message;
    return serviceResult(true, message);
  }

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
    let req = null;
    try {
      const client = String(url).startsWith('https:') ? https : http;
      req = client.get(url, { timeout: timeoutMs, headers }, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode || 0,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      });
    } catch {
      resolve({ statusCode: 0, body: '' });
      return;
    }
    req.once('timeout', () => {
      req.destroy();
      resolve({ statusCode: 0, body: '' });
    });
    req.once('error', () => resolve({ statusCode: 0, body: '' }));
  });
}

function httpRequestWithBody(url, options = {}) {
  return new Promise((resolve) => {
    let req = null;
    let resolved = false;
    const method = options.method || 'GET';
    const timeoutMs = options.timeoutMs || 1000;
    const headers = { ...(options.headers || {}) };
    const body = options.body == null ? null : Buffer.from(String(options.body));
    if (body && !Object.keys(headers).some((key) => key.toLowerCase() === 'content-length')) {
      headers['content-length'] = String(body.byteLength);
    }

    function finish(response) {
      if (resolved) return;
      resolved = true;
      resolve(response);
    }

    try {
      const client = String(url).startsWith('https:') ? https : http;
      req = client.request(url, { method, timeout: timeoutMs, headers }, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          finish({
            statusCode: res.statusCode || 0,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      });
    } catch {
      finish({ statusCode: 0, body: '' });
      return;
    }
    req.once('timeout', () => {
      req.destroy();
      finish({ statusCode: 0, body: '' });
    });
    req.once('error', () => finish({ statusCode: 0, body: '' }));
    if (body) req.write(body);
    req.end();
  });
}

function healthUrl() {
  const url = new URL('/api/desktop/health', APP_ORIGIN);
  if (isLocalAppOrigin()) url.searchParams.set('desktop_token', DESKTOP_HEALTH_TOKEN);
  return url.toString();
}

function normalizeOriginValue(value) {
  try {
    const url = new URL(value);
    return url.origin;
  } catch {
    return String(value || '').replace(/\/$/, '');
  }
}

function isLocalOriginValue(value) {
  return /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(value);
}

function isLocalAppOrigin() {
  return isLocalOriginValue(APP_ORIGIN);
}

function desktopBrowserSession() {
  return session.fromPartition(DESKTOP_BROWSER_PARTITION);
}

function supabaseUrl() {
  return process.env.NEXT_PUBLIC_SUPABASE_URL || DESKTOP_ENV.NEXT_PUBLIC_SUPABASE_URL || FALLBACK_SUPABASE_URL;
}

function supabaseAnonKey() {
  return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || DESKTOP_ENV.NEXT_PUBLIC_SUPABASE_ANON_KEY || FALLBACK_SUPABASE_ANON_KEY;
}

function supabaseAuthStorageKey() {
  try {
    const url = new URL(supabaseUrl());
    return `sb-${url.hostname.split('.')[0]}-auth-token`;
  } catch {
    return null;
  }
}

function base64UrlEncode(value) {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function isSupabaseAuthCookieName(name, storageKey) {
  if (!storageKey) return false;
  if (name === storageKey || name === `${storageKey}-user` || name === `${storageKey}-code-verifier`) return true;
  const match = name.match(/^(.*)[.](0|[1-9][0-9]*)$/);
  return Boolean(match && match[1] === storageKey);
}

function createCookieChunks(key, value, chunkSize = SUPABASE_AUTH_COOKIE_CHUNK_SIZE) {
  const encodedValue = encodeURIComponent(value);
  if (encodedValue.length <= chunkSize) return [{ name: key, value }];

  const chunks = [];
  let remainder = encodedValue;
  while (remainder.length > 0) {
    let encodedHead = remainder.slice(0, chunkSize);
    const lastEscape = encodedHead.lastIndexOf('%');
    if (lastEscape > chunkSize - 3) encodedHead = encodedHead.slice(0, lastEscape);

    let head = '';
    while (encodedHead.length > 0) {
      try {
        head = decodeURIComponent(encodedHead);
        break;
      } catch (error) {
        if (error instanceof URIError && encodedHead.at(-3) === '%' && encodedHead.length > 3) {
          encodedHead = encodedHead.slice(0, encodedHead.length - 3);
          continue;
        }
        throw error;
      }
    }
    chunks.push(head);
    remainder = remainder.slice(encodedHead.length);
  }
  return chunks.map((valuePart, index) => ({ name: `${key}.${index}`, value: valuePart }));
}

function normalizeSupabaseSessionPayload(payload) {
  const source = payload?.session && typeof payload.session === 'object' ? payload.session : payload;
  if (!source || typeof source !== 'object') return null;
  const accessToken = source.access_token || source.accessToken;
  const refreshToken = source.refresh_token || source.refreshToken;
  if (typeof accessToken !== 'string' || accessToken.length < 10) return null;
  if (typeof refreshToken !== 'string' || refreshToken.length < 10) return null;
  const expiresIn = typeof source.expires_in === 'number' ? source.expires_in : null;
  const expiresAt = typeof source.expires_at === 'number'
    ? source.expires_at
    : typeof source.expiresAt === 'number'
      ? source.expiresAt
      : expiresIn
        ? Math.floor(Date.now() / 1000) + expiresIn
        : null;

  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: typeof source.token_type === 'string' ? source.token_type : 'bearer',
    expires_in: expiresIn,
    expires_at: expiresAt,
    user: source.user && typeof source.user === 'object' ? source.user : undefined,
  };
}

async function clearSupabaseAuthCookies(origin = APP_ORIGIN) {
  const storageKey = supabaseAuthStorageKey();
  if (!storageKey) return;
  const url = `${origin}/`;
  const webSession = desktopBrowserSession();
  const cookies = await webSession.cookies.get({ url });
  await Promise.all(
    cookies
      .filter((cookie) => isSupabaseAuthCookieName(cookie.name, storageKey))
      .map((cookie) => webSession.cookies.remove(url, cookie.name).catch(() => undefined)),
  );
}

async function seedSupabaseAuthCookies(sessionPayload, origin = APP_ORIGIN) {
  const storageKey = supabaseAuthStorageKey();
  const normalized = normalizeSupabaseSessionPayload(sessionPayload);
  if (!storageKey || !normalized) return false;

  const url = `${origin}/`;
  const encoded = `base64-${base64UrlEncode(JSON.stringify(normalized))}`;
  const chunks = createCookieChunks(storageKey, encoded);
  const expirationDate = Math.floor(Date.now() / 1000) + SUPABASE_AUTH_COOKIE_MAX_AGE_SECONDS;
  const secure = origin.startsWith('https:');
  const webSession = desktopBrowserSession();

  await clearSupabaseAuthCookies(origin);
  await Promise.all(chunks.map((chunk) => webSession.cookies.set({
    url,
    name: chunk.name,
    value: chunk.value,
    path: '/',
    secure,
    httpOnly: false,
    sameSite: 'lax',
    expirationDate,
  })));
  return true;
}

async function fetchJsonWithTimeout(url, init = {}, timeoutMs = 8000) {
  if (typeof fetch !== 'function') throw new Error('fetch is not available in this Electron runtime');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const payload = await response.json().catch(() => null);
    return { response, payload };
  } finally {
    clearTimeout(timeout);
  }
}

async function refreshDesktopAuthSession(savedSession) {
  const normalized = normalizeSupabaseSessionPayload(savedSession);
  if (!normalized?.refresh_token) return { ok: false, reason: 'missing-refresh-token', clear: true };

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (normalized.expires_at && normalized.expires_at - nowSeconds > DESKTOP_AUTH_REFRESH_MARGIN_SECONDS) {
    return { ok: true, session: normalized, refreshed: false };
  }

  const url = new URL('/auth/v1/token', supabaseUrl());
  url.searchParams.set('grant_type', 'refresh_token');
  const { response, payload } = await fetchJsonWithTimeout(url.toString(), {
    method: 'POST',
    headers: {
      apikey: supabaseAnonKey(),
      Authorization: `Bearer ${supabaseAnonKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ refresh_token: normalized.refresh_token }),
  });

  if (!response.ok) {
    const code = typeof payload?.code === 'string' ? payload.code : '';
    const message = typeof payload?.msg === 'string'
      ? payload.msg
      : typeof payload?.message === 'string'
        ? payload.message
        : `Supabase refresh failed (${response.status})`;
    return {
      ok: false,
      reason: message,
      clear: response.status === 400 || response.status === 401 || code.includes('refresh'),
    };
  }

  const sessionPayload = normalizeSupabaseSessionPayload(payload);
  if (!sessionPayload) return { ok: false, reason: 'invalid-refresh-response', clear: false };
  return { ok: true, session: sessionPayload, refreshed: true };
}

async function ensureDesktopAuthCookies(reason, origin = APP_ORIGIN) {
  const loaded = loadDesktopAuthSession();
  if (!loaded.ok || !loaded.session) return { ok: true, status: 'missing' };

  try {
    const refreshed = await refreshDesktopAuthSession(loaded.session);
    if (!refreshed.ok) {
      log('auth', `desktop session restore skipped (${reason}): ${refreshed.reason || 'unknown error'}`);
      if (refreshed.clear) {
        clearDesktopAuthSession();
        await clearSupabaseAuthCookies(origin);
      }
      return { ok: false, status: 'failed', reason: refreshed.reason };
    }

    if (refreshed.refreshed) saveDesktopAuthSession(null, refreshed.session);
    await seedSupabaseAuthCookies(refreshed.session, origin);
    log('auth', `seeded Supabase auth cookies from desktop session (${reason}, refreshed=${refreshed.refreshed ? 'yes' : 'no'})`);
    return { ok: true, status: refreshed.refreshed ? 'refreshed' : 'seeded' };
  } catch (error) {
    log('auth', `desktop session restore failed (${reason}): ${error instanceof Error ? error.message : String(error)}`);
    return { ok: false, status: 'failed', reason: error instanceof Error ? error.message : String(error) };
  }
}

async function ensureFreshRemoteUiCache(origin = APP_ORIGIN, reason = 'dashboard-load') {
  if (isLocalOriginValue(origin)) return;
  if (remoteUiCacheClearPromise) return remoteUiCacheClearPromise;

  remoteUiCacheClearPromise = (async () => {
    try {
      const webSession = desktopBrowserSession();
      // Keep the packaged shell on deployed Next assets without touching auth cookies or localStorage.
      const result = await Promise.race([
        (async () => {
          await webSession.clearCache();
          await webSession.clearStorageData({
            origin,
            storages: ['serviceworkers', 'cachestorage'],
          });
          return 'cleared';
        })(),
        timeoutAfter(REMOTE_UI_CACHE_CLEAR_TIMEOUT_MS, 'timeout'),
      ]);
      if (result === 'timeout') {
        log('app', `remote Web UI cache clear timed out (${reason}); continuing startup: ${origin}`);
        return;
      }
      log('app', `cleared remote Web UI cache (${reason}): ${origin}`);
    } catch (error) {
      log('app', `failed to clear remote Web UI cache (${reason}): ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      remoteUiCacheClearPromise = null;
    }
  })();

  return remoteUiCacheClearPromise;
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
  return appUrlFromPath('/dashboard', origin);
}

function normalizeInAppPath(value, fallback = '/dashboard') {
  const candidate = typeof value === 'string' && value.trim() ? value.trim() : fallback;
  try {
    const parsed = new URL(candidate, APP_ORIGIN);
    const appOrigin = new URL(APP_ORIGIN).origin;
    const webAuthOrigin = new URL(WEB_AUTH_ORIGIN).origin;
    if (parsed.origin !== appOrigin && parsed.origin !== webAuthOrigin) return fallback;
    return `${parsed.pathname || '/dashboard'}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}

function appUrlFromPath(pathValue, origin = APP_ORIGIN, extraParams = {}) {
  const url = new URL(normalizeInAppPath(pathValue), origin);
  url.searchParams.set('desktop', '1');
  url.searchParams.set('source', 'mac');
  for (const [key, value] of Object.entries(extraParams)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  return url.toString();
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

function allowedDesktopIpcOrigins() {
  return allowedDesktopAuthOrigins();
}

const LOADING_SCREEN_IPC_CHANNELS = new Set([
  'focusmap-desktop:retryDashboard',
  'focusmap-desktop:openDashboardExternal',
]);

function senderFrameUrl(event) {
  return event.senderFrame?.url || event.sender?.getURL?.() || '';
}

function isTrustedLoadingScreenUrl(urlString) {
  try {
    const url = new URL(urlString);
    return url.protocol === 'file:' && decodeURIComponent(url.pathname).endsWith('/desktop/focusmap-mac/loading.html');
  } catch {
    return false;
  }
}

function assertAllowedIpcSender(event, channel) {
  const frameUrl = senderFrameUrl(event);
  if (LOADING_SCREEN_IPC_CHANNELS.has(channel) && isTrustedLoadingScreenUrl(frameUrl)) return;

  const origin = normalizeHttpOrigin(frameUrl);
  if (origin && allowedDesktopIpcOrigins().has(origin)) return;
  const message = `blocked IPC ${channel} from ${origin || frameUrl || 'unknown origin'}`;
  log('ipc', message);
  throw new Error('このFocusmap画面からはMac連携を実行できません');
}

function handleDesktopIpc(channel, handler) {
  ipcMain.handle(channel, async (event, ...args) => {
    assertAllowedIpcSender(event, channel);
    return handler(event, ...args);
  });
}

function isAllowedAppNavigationUrl(urlString) {
  const origin = normalizeHttpOrigin(urlString);
  return Boolean(origin && allowedDesktopAuthOrigins().has(origin));
}

function canOpenExternalUrl(urlString) {
  try {
    const protocol = new URL(urlString).protocol;
    return ['http:', 'https:', 'mailto:', 'focusmap:', 'codex:'].includes(protocol);
  } catch {
    return false;
  }
}

function openExternalSafely(urlString) {
  if (typeof urlString !== 'string' || !canOpenExternalUrl(urlString)) {
    throw new Error('外部URLが不正です');
  }
  rememberDesktopAuthNonceFromUrl(urlString);
  return shell.openExternal(urlString);
}

async function chooseFolderFromBridge() {
  const options = {
    title: 'リポフォルダを選択',
    message: 'Codexチャットを取り込むリポフォルダを選択',
    buttonLabel: '選択',
    properties: ['openDirectory', 'dontAddToRecent'],
  };
  const owner = mainWindow && !mainWindow.isDestroyed()
    ? mainWindow
    : BrowserWindow.getFocusedWindow();
  const result = owner
    ? await dialog.showOpenDialog(owner, options)
    : await dialog.showOpenDialog(options);
  if (result.canceled || !result.filePaths?.[0]) {
    return { ok: false, canceled: true };
  }
  return { ok: true, path: result.filePaths[0].replace(/\/+$/, '') };
}

async function openPathFromBridge(_event, targetPath) {
  const normalizedPath = normalizeLocalPath(targetPath);
  if (!normalizedPath || !path.isAbsolute(normalizedPath)) {
    return { ok: false, error: 'invalid_path' };
  }
  if (!fs.existsSync(normalizedPath)) {
    return { ok: false, error: 'path_not_found' };
  }
  const errorMessage = await shell.openPath(normalizedPath);
  return errorMessage ? { ok: false, error: errorMessage } : { ok: true };
}

async function codexStateDbPath() {
  const candidates = [
    path.join(os.homedir(), '.codex', 'sqlite', 'state_5.sqlite'),
    path.join(os.homedir(), '.codex', 'state_5.sqlite'),
  ].filter(candidate => fs.existsSync(candidate));

  const scored = await Promise.all(candidates.map(async candidate => ({
    candidate,
    score: await codexStateDbFreshnessScore(candidate),
  })));
  return scored.sort((a, b) => b.score - a.score)[0]?.candidate || null;
}

async function codexStateDbFreshnessScore(dbPath) {
  const latestThreadUpdatedAt = await latestCodexThreadUpdatedAtMs(dbPath);
  if (latestThreadUpdatedAt > 0) return latestThreadUpdatedAt;
  try {
    return fs.statSync(dbPath).mtimeMs;
  } catch {
    return 0;
  }
}

async function latestCodexThreadUpdatedAtMs(dbPath) {
  try {
    const stdout = await execFileText('/usr/bin/sqlite3', [
      dbPath,
      "SELECT COALESCE(MAX(updated_at_ms), MAX(updated_at) * 1000, 0) FROM threads;",
    ], { timeout: 2500 });
    const value = Number(String(stdout).trim());
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

function normalizeLocalPath(value) {
  return typeof value === 'string' ? value.trim().replace(/\/+$/, '') : '';
}

async function listCodexReposFromBridge() {
  const dbPath = await codexStateDbPath();
  if (!dbPath) return { ok: false, repos: [], error: 'Codex state DB が見つかりません' };

  const sql = codexRepoListSql();

  try {
    const stdout = await execFileText('/usr/bin/sqlite3', ['-json', dbPath, sql], { timeout: 5000 });
    const rows = JSON.parse(String(stdout || '[]'));
    const repos = [];
    const seen = new Set();
    for (const row of Array.isArray(rows) ? rows : []) {
      const absolutePath = normalizeLocalPath(row.absolute_path);
      if (!absolutePath || !path.isAbsolute(absolutePath)) continue;
      let resolved = '';
      try {
        resolved = fs.realpathSync(absolutePath);
        if (!fs.statSync(resolved).isDirectory()) continue;
      } catch {
        continue;
      }
      const gitRoot = await resolveGitRoot(resolved);
      // Codex can group chats by a plain cwd folder such as ~/Private.
      // Keep non-git folders selectable instead of dropping them from the AI history filter.
      const repoPath = normalizeLocalPath(gitRoot) || normalizeLocalPath(resolved);
      if (!repoPath || seen.has(repoPath)) continue;
      seen.add(repoPath);
      const updatedMs = Number(row.updated_at_ms);
      repos.push({
        id: `codex:${repoPath}`,
        hostname: 'Codex',
        absolute_path: repoPath,
        display_name: path.basename(repoPath) || repoPath,
        last_git_commit_at: null,
        last_seen_at: Number.isFinite(updatedMs) && updatedMs > 0 ? new Date(updatedMs).toISOString() : new Date().toISOString(),
        source: 'codex',
        thread_count: Number(row.thread_count) || 0,
        total_thread_count: Number(row.total_thread_count) || Number(row.thread_count) || 0,
      });
    }
    return { ok: true, repos };
  } catch (error) {
    return {
      ok: false,
      repos: [],
      error: error instanceof Error ? error.message : 'Codex repo list failed',
    };
  }
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
  targetUrl.searchParams.set('desktop_oauth', '1');
  if (!targetUrl.searchParams.has('next')) targetUrl.searchParams.set('next', '/dashboard');
  return targetUrl.toString();
}

function openAuthExternally(url) {
  const now = Date.now();
  if (url === lastExternalAuthUrl && now - lastExternalAuthAt < 5000) return;
  lastExternalAuthUrl = url;
  lastExternalAuthAt = now;
  rememberDesktopAuthNonceFromUrl(url);
  shell.openExternal(url);
}

function pruneDesktopAuthNonces() {
  const now = Date.now();
  for (const [nonce, expiresAt] of pendingDesktopAuthNonces.entries()) {
    if (expiresAt <= now) pendingDesktopAuthNonces.delete(nonce);
  }
}

function rememberDesktopAuthNonceFromUrl(urlString) {
  try {
    const url = new URL(urlString);
    if (url.pathname !== '/auth/native-start' || url.searchParams.get('desktop') !== '1') return;
    const nonce = url.searchParams.get('nonce');
    if (!nonce || nonce.length > 128) return;
    pruneDesktopAuthNonces();
    pendingDesktopAuthNonces.set(nonce, Date.now() + PENDING_DESKTOP_AUTH_TTL_MS);
  } catch {
    // Ignore non-URL strings passed to shell.openExternal.
  }
}

function consumePendingDesktopAuthNonce(nonce) {
  pruneDesktopAuthNonces();
  if (!pendingDesktopAuthNonces.has(nonce)) return false;
  pendingDesktopAuthNonces.delete(nonce);
  return true;
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

function loadingScreenQuery(extra = {}) {
  return {
    mode: isLocalAppOrigin() ? 'local' : 'remote',
    origin: APP_ORIGIN,
    dashboard: dashboardUrl(),
    ...Object.fromEntries(Object.entries(extra).filter(([, value]) => value !== undefined && value !== null)),
  };
}

async function loadStartupScreen(extra = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  await loadFileAllowingAbort(mainWindow, path.join(__dirname, 'loading.html'), {
    query: loadingScreenQuery(extra),
  });
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

  log('app', `loading dashboard (${reason}): ${dashboardUrl()}`);
  void (async () => {
    await ensureDesktopAuthCookies(reason, APP_ORIGIN);
    await ensureFreshRemoteUiCache(APP_ORIGIN, reason);
    if (!mainWindow || mainWindow.isDestroyed()) return;
    await loadUrlAllowingRedirect(mainWindow, dashboardUrl());
  })().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    log('app', `dashboard load failed (${reason}): ${message}`);
    void loadStartupScreen({ error: message, reason }).catch(() => undefined);
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
      log('app', `loading dashboard (${reason}): ${dashboardUrl(origin)}`);
      await ensureDesktopAuthCookies(reason, origin);
      await ensureFreshRemoteUiCache(origin, reason);
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

  if (!isAllowedAppNavigationUrl(url)) {
    event.preventDefault();
    if (canOpenExternalUrl(url)) {
      shell.openExternal(url).catch((error) => {
        log('app', `failed to open external navigation ${url}: ${error instanceof Error ? error.message : String(error)}`);
      });
    }
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
  if (!isLocalAppOrigin()) {
    return `${APP_ORIGIN}/api`;
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
  if (!isLocalAppOrigin() || EXPLICIT_APP_ORIGIN) return true;

  try {
    const payload = JSON.parse(response.body);
    if (payload?.app !== 'focusmap') return false;
    if (!app.isPackaged) return true;
    return payload.desktop_token_ok === true;
  } catch {
    return false;
  }
}

async function codexThreadImportApiStatus(appReady, timeoutMs = 1200) {
  const url = new URL(CODEX_THREAD_IMPORT_API_PATH, APP_ORIGIN).toString();
  const mode = isLocalAppOrigin() ? 'local' : 'remote';
  if (!appReady && isLocalAppOrigin()) {
    return {
      ready: false,
      checked: false,
      statusCode: 0,
      url,
      path: CODEX_THREAD_IMPORT_API_PATH,
      mode,
      reason: 'app_not_ready',
      message: 'FocusmapローカルWebの起動後に確認します。',
    };
  }

  const response = await httpRequestWithBody(url, {
    method: 'POST',
    timeoutMs,
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: '{}',
  });
  const statusCode = response.statusCode || 0;
  if (statusCode === 401 || statusCode === 400 || statusCode === 403 || statusCode === 409 || (statusCode >= 200 && statusCode < 300)) {
    return {
      ready: true,
      checked: true,
      statusCode,
      url,
      path: CODEX_THREAD_IMPORT_API_PATH,
      mode,
      reason: null,
      message: 'Codex.app起点threadの取り込みAPIを確認済みです。',
    };
  }
  if (statusCode === 404) {
    return {
      ready: false,
      checked: true,
      statusCode,
      url,
      path: CODEX_THREAD_IMPORT_API_PATH,
      mode,
      reason: 'not_deployed',
      message: 'このWeb/APIにはCodex.app起点thread取り込みAPIがまだ入っていません。',
    };
  }
  if (statusCode >= 500) {
    return {
      ready: false,
      checked: true,
      statusCode,
      url,
      path: CODEX_THREAD_IMPORT_API_PATH,
      mode,
      reason: 'server_error',
      message: 'Codex.app起点thread取り込みAPIはありますが、サーバー側でエラーです。',
    };
  }
  return {
    ready: false,
    checked: statusCode !== 0,
    statusCode,
    url,
    path: CODEX_THREAD_IMPORT_API_PATH,
    mode,
    reason: statusCode === 0 ? 'unreachable' : 'unexpected_status',
    message: statusCode === 0
      ? 'Codex.app起点thread取り込みAPIに到達できません。'
      : `Codex.app起点thread取り込みAPIの応答が想定外です (${statusCode})。`,
  };
}

function startNextServer() {
  if (!isLocalAppOrigin() || EXPLICIT_APP_ORIGIN) return null;
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
  if (!isLocalAppOrigin()) return APP_ORIGIN;
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
  const source = payload?.session && typeof payload.session === 'object' ? payload.session : payload;
  if (!source || typeof source !== 'object') return null;
  const accessToken = source.access_token || source.accessToken;
  const refreshToken = source.refresh_token || source.refreshToken;
  if (typeof accessToken !== 'string' || accessToken.length < 10) return null;
  if (typeof refreshToken !== 'string' || refreshToken.length < 10) return null;
  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_at: typeof source.expires_at === 'number'
      ? source.expires_at
      : typeof source.expiresAt === 'number'
        ? source.expiresAt
        : null,
    user_id: typeof source.user_id === 'string'
      ? source.user_id
      : typeof source.userId === 'string'
        ? source.userId
        : typeof source.user?.id === 'string'
          ? source.user.id
          : null,
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
    void clearSupabaseAuthCookies(APP_ORIGIN).catch(() => undefined);
    log('auth', 'cleared desktop auth session');
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log('auth', `failed to clear desktop auth session: ${message}`);
    return { ok: false, error: message };
  }
}

function decodeDesktopDeepLinkPayload(value) {
  if (typeof value !== 'string' || value.length > 20000) return null;
  try {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function loadLoginForDesktopSessionRestore(reason) {
  const loginUrl = `${APP_ORIGIN}/login?desktop=1&source=mac&auth=${encodeURIComponent(reason)}`;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.loadURL(loginUrl).catch((error) => {
      if (!isNavigationAbortError(error)) log('auth', `failed to load login for session restore: ${error.message}`);
    });
    focusWindow(mainWindow);
    return;
  }
  createMainWindow().then(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.loadURL(loginUrl).catch((error) => {
      if (!isNavigationAbortError(error)) log('auth', `failed to load login for session restore: ${error.message}`);
    });
  }).catch((error) => {
    log('auth', `failed to create window for session restore: ${error instanceof Error ? error.message : String(error)}`);
  });
}

function handleFocusmapDeepLink(urlString) {
  try {
    const url = new URL(urlString);
    if (url.protocol !== 'focusmap:') return false;

    if (url.hostname === 'calendar-connected') {
      const nextPath = normalizeInAppPath(url.searchParams.get('next') || '/dashboard');
      void loadCalendarConnectedUrl(nextPath);
      return true;
    }

    if (url.hostname !== 'auth-complete') return false;
    if (url.searchParams.get('desktop') !== '1') return false;

    const nonce = url.searchParams.get('nonce');
    if (!nonce || !consumePendingDesktopAuthNonce(nonce)) {
      log('auth', 'ignored desktop auth deep link without a matching pending nonce');
      return true;
    }

    const payload = decodeDesktopDeepLinkPayload(url.searchParams.get('payload'));
    if (!payload || payload.nonce !== nonce) {
      log('auth', 'ignored desktop auth deep link with invalid payload');
      return true;
    }

    const saved = saveDesktopAuthSession(null, payload);
    if (!saved.ok) {
      log('auth', `failed to save desktop auth deep link session: ${saved.error || 'unknown error'}`);
      loadLoginForDesktopSessionRestore('deeplink-save-failed');
      return true;
    }

    void (async () => {
      await ensureDesktopAuthCookies('deeplink', APP_ORIGIN);
      await loadDashboardWhenReady('auth-deeplink');
    })().catch((error) => {
      log('auth', `failed to restore desktop auth from deep link: ${error instanceof Error ? error.message : String(error)}`);
      loadLoginForDesktopSessionRestore('deeplink');
    });
    return true;
  } catch (error) {
    log('auth', `failed to handle focusmap deep link: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

async function loadCalendarConnectedUrl(nextPath) {
  try {
    if (!mainWindow || mainWindow.isDestroyed()) {
      await createMainWindow();
    }
    const origin = await ensureFocusmapApp();
    await ensureDesktopAuthCookies('calendar-connected', origin);
    await ensureFreshRemoteUiCache(origin, 'calendar-connected');
    if (!mainWindow || mainWindow.isDestroyed()) return;
    await loadUrlAllowingRedirect(mainWindow, appUrlFromPath(nextPath, origin, { calendar_connected: 'true' }));
    focusWindow(mainWindow);
  } catch (error) {
    log('calendar', `failed to return after calendar OAuth: ${error instanceof Error ? error.message : String(error)}`);
    loadDashboardSoon('calendar-connected-fallback');
  }
}

function normalizeClipboardText(value) {
  if (typeof value !== 'string') return '';
  if (value.length > 500_000) throw new Error('クリップボードへ渡す文字列が大きすぎます');
  return value.replace(/\r\n?/g, '\n');
}

function normalizeCodexPrompt(value) {
  return normalizeClipboardText(value).replace(/[ \t]+\n/g, '\n').trim();
}

function expandHome(input) {
  if (input === '~') return os.homedir();
  if (input.startsWith('~/')) return path.join(os.homedir(), input.slice(2));
  return input;
}

async function resolveGitRoot(repoPath) {
  try {
    const stdout = await execFileText('/usr/bin/git', ['-C', repoPath, 'rev-parse', '--show-toplevel']);
    return fs.realpathSync(String(stdout).trim());
  } catch {
    return null;
  }
}

async function resolveCodexRepoPath(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const expanded = expandHome(value.trim());
  if (!path.isAbsolute(expanded)) throw new Error('repoPath must be an absolute path');

  let resolved = '';
  try {
    resolved = fs.realpathSync(expanded);
  } catch {
    throw new Error('repoPath does not exist');
  }

  const stat = fs.statSync(resolved);
  if (!stat.isDirectory()) throw new Error('repoPath must be a directory');

  const gitRoot = await resolveGitRoot(resolved);
  if (!gitRoot) throw new Error('repoPath must be a git repository');
  if (gitRoot !== resolved) throw new Error('repoPath must point to the git repository root');
  return resolved;
}

function resolveCodexUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  if (value.length > 4000) throw new Error('codex URL is too long');
  const url = new URL(value.trim());
  if (url.protocol !== 'codex:') throw new Error('codex URL must use the codex:// scheme');
  return url.toString();
}

function resolveOriginUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  if (value.length > 4000) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

function resolveClipboardImageUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  if (value.length > 8000) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:' && url.protocol !== 'data:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

async function clipboardImageFromUrl(value) {
  const imageUrl = resolveClipboardImageUrl(value);
  if (!imageUrl) return null;

  try {
    if (imageUrl.startsWith('data:image/')) {
      const image = nativeImage.createFromDataURL(imageUrl);
      return image.isEmpty() ? null : image;
    }

    const response = await fetch(imageUrl);
    if (!response.ok) return null;
    const contentType = response.headers.get('content-type') || '';
    if (contentType && !contentType.toLowerCase().startsWith('image/')) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > 12 * 1024 * 1024) return null;
    const image = nativeImage.createFromBuffer(buffer);
    return image.isEmpty() ? null : image;
  } catch (error) {
    log('codex', `clipboard image copy skipped: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function buildCodexChatUrl(repoPath, originUrl) {
  const url = new URL('codex://');
  if (repoPath) url.searchParams.set('path', repoPath);
  if (originUrl) url.searchParams.set('originUrl', originUrl);
  return url.toString();
}

async function activateCodexApp() {
  try {
    await execFileText('/usr/bin/osascript', [
      '-e',
      'tell application id "com.openai.codex" to reopen',
      '-e',
      'tell application id "com.openai.codex" to activate',
    ]);
    return true;
  } catch (error) {
    log('codex', `Codex.app activation failed: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

async function copyTextFromBridge(_event, value) {
  const text = normalizeClipboardText(value);
  if (!text) return { ok: false, copied: false, error: 'コピーする文字列がありません' };
  clipboard.writeText(text);
  const copied = clipboard.readText() === text;
  return copied
    ? { ok: true, copied: true }
    : { ok: false, copied: false, error: 'クリップボードへコピーできませんでした' };
}

async function copyCodexImageFromBridge(_event, payload) {
  const input = payload && typeof payload === 'object' ? payload : {};
  const clipboardImage = await clipboardImageFromUrl(input.imageUrl ?? input.clipboardImageUrl ?? input.clipboard_image_url);
  if (!clipboardImage) {
    return { ok: false, copiedImageToClipboard: false, error: '画像を読み込めませんでした' };
  }
  clipboard.writeImage(clipboardImage);
  const copiedImageToClipboard = !clipboard.readImage().isEmpty();
  return copiedImageToClipboard
    ? { ok: true, copiedImageToClipboard: true }
    : { ok: false, copiedImageToClipboard: false, error: '画像をクリップボードへコピーできませんでした' };
}

async function launchCodexFromBridge(_event, payload) {
  const input = payload && typeof payload === 'object' ? payload : {};
  const prompt = normalizeCodexPrompt(input.prompt);
  const repoPath = await resolveCodexRepoPath(input.repoPath ?? input.repo_path);
  const codexUrl = resolveCodexUrl(input.codexUrl ?? input.codex_url ?? input.threadUrl ?? input.thread_url);
  const originUrl = resolveOriginUrl(input.originUrl ?? input.origin_url);
  const clipboardImage = await clipboardImageFromUrl(input.clipboardImageUrl ?? input.clipboard_image_url);
  let copiedToClipboard = false;
  let copiedImageToClipboard = false;

  if (prompt) {
    if (clipboardImage) {
      clipboard.write({ text: prompt, image: clipboardImage });
      copiedToClipboard = clipboard.readText() === prompt;
      copiedImageToClipboard = !clipboard.readImage().isEmpty();
    } else {
      clipboard.writeText(prompt);
      copiedToClipboard = clipboard.readText() === prompt;
    }
  } else if (clipboardImage) {
    clipboard.writeImage(clipboardImage);
    copiedImageToClipboard = !clipboard.readImage().isEmpty();
  }

  const targetUrl = codexUrl || buildCodexChatUrl(repoPath, originUrl);
  await shell.openExternal(targetUrl);
  const activated = await activateCodexApp();

  return {
    ok: true,
    mode: 'electron-bridge',
    url: targetUrl,
    repoPath,
    copiedToClipboard,
    copiedImageToClipboard,
    activated,
  };
}

async function startAgent() {
  if (isChildRunning(managedProcesses.agent)) return { ok: true, message: 'agentは起動済みです' };
  const externalAgentRunning = await processRunning(agentProcessPattern()).catch(() => false);
  if (externalAgentRunning) {
    return { ok: true, message: '既存のfocusmap-agentを利用します', external: true };
  }
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
  if (isLocalAppOrigin() && agentApiUrl?.startsWith(APP_ORIGIN)) await ensureFocusmapApp();

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
  const codex = await codexCliStatus();

  if (!codex.appInstalled) {
    return startCodexDesktopInstaller(codex);
  }

  if (await tcpReady('127.0.0.1', 7878)) {
    return { ok: true, message: 'Codex app-serverは起動済みです' };
  }
  if (!codex.available) {
    return { ok: false, message: 'Codex.app または codex CLI が見つかりません' };
  }
  if (!codex.appServerCommandSupported) {
    return serviceResult(
      false,
      'Codex CLIが古く app-server に対応していません。Codex Desktop/CLIをアップデートしてから再接続してください。',
      {
        code: 'codex_cli_update_required',
        installUrl: CODEX_DOWNLOAD_URL,
        commandPath: codex.resolvedPath,
        version: codex.version,
      },
    );
  }
  if (!fs.existsSync(CODEX_SERVER_SCRIPT)) {
    return { ok: false, message: `Codex app-server起動スクリプトがありません: ${CODEX_SERVER_SCRIPT}` };
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

async function startCodexDesktopInstaller(codex) {
  const base = {
    code: 'codex_desktop_missing',
    installUrl: CODEX_DOWNLOAD_URL,
    installStarted: true,
  };

  if (codex.updateRequired) {
    try {
      await shell.openExternal(CODEX_DOWNLOAD_URL);
      log('codex', `Codex CLI update required; opened download page ${CODEX_DOWNLOAD_URL}`);
      return serviceResult(
        false,
        'Codex CLIが古く、Codex Desktopインストーラーを起動できません。公式ページを開いたのでCodex Desktop/CLIをアップデートしてください。',
        {
          ...base,
          code: 'codex_cli_update_required',
          installerMode: 'download_page',
          commandPath: codex.resolvedPath,
          version: codex.version,
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return serviceResult(
        false,
        `Codex CLIが古く、ダウンロードページも開けませんでした: ${message}`,
        {
          ...base,
          code: 'codex_cli_update_required',
          installStarted: false,
          installerMode: 'download_page',
          commandPath: codex.resolvedPath,
          version: codex.version,
        },
      );
    }
  }

  if (codex.commandAvailable && codex.appCommandSupported) {
    const env = { ...process.env, PATH: CHILD_PATH };
    delete env.ANTHROPIC_API_KEY;
    delete env.CLAUDECODE;

    try {
      const child = spawn('/usr/bin/env', ['codex', 'app'], {
        cwd: REPO_ROOT,
        env,
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
      log('codex', 'Codex Desktop is missing; launched `codex app` installer');
      return serviceResult(
        false,
        'Codex Desktopが未導入のため、インストーラーを開きました。インストールとログイン後にもう一度「接続/復旧」を押してください。',
        { ...base, installerMode: 'codex_app_command' },
      );
    } catch (error) {
      log('codex', `codex app installer failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  try {
    await shell.openExternal(CODEX_DOWNLOAD_URL);
    log('codex', `Codex Desktop is missing; opened download page ${CODEX_DOWNLOAD_URL}`);
    return serviceResult(
      false,
      'Codex Desktopが未導入のため、公式ダウンロードページを開きました。インストールとログイン後にもう一度「接続/復旧」を押してください。',
      { ...base, installerMode: 'download_page' },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log('codex', `Codex download page open failed: ${message}`);
    return serviceResult(
      false,
      `Codex Desktopが未導入で、ダウンロードページも開けませんでした: ${message}`,
      { ...base, installStarted: false, installerMode: 'download_page' },
    );
  }
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
    results.agent = await startAgent();
    log('agent', results.agent.message);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    results.agent = serviceResult(false, message);
    log('agent', message);
  }

  try {
    await ensureFocusmapApp();
    results.app = serviceResult(
      true,
      isLocalAppOrigin()
        ? 'FocusmapローカルWebは起動済みです'
        : 'Focusmap本番Webを表示しています',
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    results.app = serviceResult(false, message);
  }

  try {
    results.codex = await startCodexServer();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    results.codex = serviceResult(false, message);
  }

  if (options.recoverLegacyTaskRunner === true) {
    try {
      results.runner = maybeRecoverTaskRunner(reason);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.runner = serviceResult(false, message);
    }
  }

  const status = await getAutomationStatus();
  const ok = Boolean(results.app?.ok && results.agent?.ok && results.codex?.ok);
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
    automationEnsurePromise = ensureAutomationServices(reason)
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
  const anyAgentProcessPattern = 'focusmap-agent.*dist/cli\\.js.*start|scripts/focusmap-agent/dist/cli\\.js.*start';
  const [appReady, codexReady, codex, externalAgentRunning, anyExternalAgentRunning] = await Promise.all([
    desktopHealthReady(800).catch(() => false),
    tcpReady('127.0.0.1', 7878, 500),
    codexCliStatus(),
    processRunning(agentProcessPattern()).catch(() => false),
    processRunning(anyAgentProcessPattern).catch(() => false),
  ]);
  const codexThreadImportApi = await codexThreadImportApiStatus(appReady, 1200).catch((error) => ({
    ready: false,
    checked: false,
    statusCode: 0,
    url: new URL(CODEX_THREAD_IMPORT_API_PATH, APP_ORIGIN).toString(),
    path: CODEX_THREAD_IMPORT_API_PATH,
    mode: isLocalAppOrigin() ? 'local' : 'remote',
    reason: 'check_failed',
    message: error instanceof Error ? error.message : String(error),
  }));
  const agentManaged = isChildRunning(managedProcesses.agent);
  const codexManaged = isChildRunning(managedProcesses.codex);
  const agentReady = agentManaged || externalAgentRunning;
  const runner = readTaskRunnerPauseStatus();
  runner.ready = runner.enabled ? runner.available && !runner.paused : false;
  runner.managed = isChildRunning(managedProcesses.runner);

  return {
    ok: true,
    available: true,
    connected: Boolean(appReady && agentReady && codex.appInstalled && codexReady && !codex.updateRequired),
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
      mode: isLocalAppOrigin() ? 'local' : 'remote',
      origin: APP_ORIGIN,
      port: APP_PORT,
    },
    agent: {
      ready: agentReady,
      managed: agentManaged,
      external: externalAgentRunning,
      externalStale: Boolean(anyExternalAgentRunning && !agentManaged && !externalAgentRunning),
      configured: fs.existsSync(CONFIG_PATH),
      available: fs.existsSync(AGENT_CLI),
      configPath: CONFIG_PATH,
      cliPath: AGENT_CLI,
      apiUrl: preferredAgentApiUrl() || 'config',
    },
    codex: {
      ready: Boolean(codex.appInstalled && codexReady && !codex.updateRequired),
      managed: codexManaged,
      available: codex.available,
      appInstalled: codex.appInstalled,
      commandAvailable: codex.commandAvailable,
      commandPath: codex.commandPath,
      resolvedPath: codex.resolvedPath,
      resolvedSource: codex.resolvedSource,
      version: codex.version,
      appServerCommandSupported: codex.appServerCommandSupported,
      appCommandSupported: codex.appCommandSupported,
      updateRequired: codex.updateRequired,
      updateHint: codex.updateHint,
      appServerReady: codexReady,
      installUrl: CODEX_DOWNLOAD_URL,
      installActionAvailable: true,
      scriptAvailable: fs.existsSync(CODEX_SERVER_SCRIPT),
      scriptPath: CODEX_SERVER_SCRIPT,
      port: 7878,
      threadImportApi: codexThreadImportApi,
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
  return ensureAutomationServices('manual-connect');
}

async function retryDashboardFromLoadingScreen() {
  await loadStartupScreen({ reason: 'manual-retry' }).catch(() => undefined);
  await loadDashboardWhenReady('manual-retry');
  return { ok: true };
}

async function openDashboardExternalFromLoadingScreen() {
  await shell.openExternal(dashboardUrl(APP_ORIGIN));
  return { ok: true, url: dashboardUrl(APP_ORIGIN) };
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
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: process.platform === 'darwin' ? { x: 12, y: 14 } : undefined,
    vibrancy: process.platform === 'darwin' ? 'under-window' : undefined,
    visualEffectState: process.platform === 'darwin' ? 'active' : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      partition: DESKTOP_BROWSER_PARTITION,
    },
  });
  try {
    await loadStartupScreen({ reason: 'create-main-window' });
  } catch (error) {
    log('app', `failed to load loading screen: ${error instanceof Error ? error.message : String(error)}`);
  }
  mainWindow.webContents.on('will-navigate', handleMainNavigation);
  mainWindow.webContents.on('will-redirect', (event, url, isInPlace, isMainFrame) => {
    if (handleMainNavigation(event, url)) return;
    if (handleAuthNavigationFallback(url, isMainFrame)) event.preventDefault();
  });
  mainWindow.webContents.on('did-start-navigation', (_event, url, isInPlace, isMainFrame) => {
    handleAuthNavigationFallback(url, isMainFrame);
  });
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame || isNavigationAbortError(`${errorDescription} (${errorCode})`)) return;
    if (!validatedURL || !isSameOrigin(validatedURL, APP_ORIGIN)) return;
    const message = `${errorDescription || '読み込みに失敗しました'} (${errorCode}) loading '${validatedURL}'`;
    log('app', message);
    void loadStartupScreen({ error: message, reason: 'did-fail-load' }).catch(() => undefined);
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isGoogleAuthUrl(url) || isSupabaseAuthUrl(url)) {
      openAuthExternally(url);
      return { action: 'deny' };
    }
    if (isAllowedAppNavigationUrl(url)) return { action: 'allow' };
    if (canOpenExternalUrl(url)) {
      shell.openExternal(url).catch((error) => {
        log('app', `failed to open external window ${url}: ${error instanceof Error ? error.message : String(error)}`);
      });
    }
    return { action: 'deny' };
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
      await loadStartupScreen({ error: message, reason: 'create-main-window' });
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

app.setAsDefaultProtocolClient('focusmap');

app.on('open-url', (event, url) => {
  event.preventDefault();
  handleFocusmapDeepLink(url);
});

app.on('second-instance', (_event, commandLine) => {
  for (const arg of commandLine) {
    if (handleFocusmapDeepLink(arg)) return;
  }
  if (focusAndRetryMainWindow()) return;
  createMainWindow().catch((error) => {
    log('app', error instanceof Error ? error.message : String(error));
  });
});

handleDesktopIpc('focusmap-desktop:openMain', () => {
  createMainWindow();
  return true;
});
handleDesktopIpc('focusmap-desktop:openExternal', (_event, url) => openExternalSafely(url));
handleDesktopIpc('focusmap-desktop:getWebAuthOrigin', () => WEB_AUTH_ORIGIN);
handleDesktopIpc('focusmap-desktop:consumeAuthSession', consumeExternalAuthSession);
handleDesktopIpc('focusmap-desktop:saveAuthSession', saveDesktopAuthSession);
handleDesktopIpc('focusmap-desktop:loadAuthSession', loadDesktopAuthSession);
handleDesktopIpc('focusmap-desktop:clearAuthSession', clearDesktopAuthSession);
handleDesktopIpc('focusmap-desktop:retryDashboard', retryDashboardFromLoadingScreen);
handleDesktopIpc('focusmap-desktop:openDashboardExternal', openDashboardExternalFromLoadingScreen);
handleDesktopIpc('focusmap-desktop:getAutomationStatus', getAutomationStatus);
handleDesktopIpc('focusmap-desktop:connectAutomation', connectAutomation);
handleDesktopIpc('focusmap-desktop:disconnectAutomation', disconnectAutomation);
handleDesktopIpc('focusmap-desktop:chooseFolder', chooseFolderFromBridge);
handleDesktopIpc('focusmap-desktop:openPath', openPathFromBridge);
handleDesktopIpc('focusmap-desktop:listCodexRepos', listCodexReposFromBridge);
handleDesktopIpc('focusmap-desktop:copyText', copyTextFromBridge);
handleDesktopIpc('focusmap-desktop:copyCodexImage', copyCodexImageFromBridge);
handleDesktopIpc('focusmap-desktop:launchCodex', launchCodexFromBridge);

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
  if (desktopAutoConnectEnabled()) startAutomationSupervisor('app-ready');
  try {
    await createMainWindow();
  } catch (error) {
    log('app', error instanceof Error ? error.message : String(error));
  }
});
