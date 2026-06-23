import { access, readdir, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir, platform, release } from 'node:os';
import { basename, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import WebSocket from 'ws';
import type { AgentConfig } from './types.js';

const execFileAsync = promisify(execFile);
const DEFAULT_REPO_SCAN_PATHS = ['~/dev', '~/Documents', '~/Projects', '~/Workspace', '~/Private', '~/Code'];
const REPO_SCAN_SKIP_DIRS = new Set([
  'node_modules',
  '.next',
  'dist',
  'build',
  '.cache',
  '.turbo',
  'venv',
  '.venv',
  '__pycache__',
  '.git',
  'target',
  '.vscode',
  '.idea',
  'Pods',
  '.gradle',
]);
const REPO_SCAN_MAX_DEPTH = 4;
const REPO_SCAN_MAX_REPOS = 200;
const REPO_SCAN_CACHE_TTL_MS = 5 * 60_000;

interface RepoDiscovery {
  availableRepoKeys: string[];
  repoPaths: Record<string, string>;
  scannedRoots: string[];
  foundCount: number;
  truncated: boolean;
}

let repoDiscoveryCache: { expiresAt: number; discovery: RepoDiscovery } | null = null;

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function hasCommand(command: string): Promise<boolean> {
  try {
    await execFileAsync('/usr/bin/env', ['which', command], { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

async function hasPath(path: string): Promise<boolean> {
  try {
    await access(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function hasExecutablePath(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function expandHome(path: string): string {
  if (path === '~') return homedir();
  if (path.startsWith('~/')) return join(homedir(), path.slice(2));
  return path;
}

async function isGitRepoDir(path: string): Promise<boolean> {
  try {
    await access(join(path, '.git'), constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function addRepoAvailability(repoPath: string, keys: Set<string>, paths: Record<string, string>) {
  const absolutePath = repoPath.trim();
  const displayName = basename(absolutePath).trim();
  if (absolutePath) {
    keys.add(absolutePath);
    paths[absolutePath] = absolutePath;
  }
  if (displayName) {
    keys.add(displayName);
    paths[displayName] = absolutePath;
  }
}

async function discoverGitRepos(inputPaths = DEFAULT_REPO_SCAN_PATHS): Promise<RepoDiscovery> {
  const availableRepoKeys = new Set<string>();
  const repoPaths: Record<string, string> = {};
  const foundRepoPaths = new Set<string>();
  const scannedRoots = inputPaths.map(expandHome);
  let truncated = false;

  async function walk(dirPath: string, depth: number): Promise<void> {
    if (foundRepoPaths.size >= REPO_SCAN_MAX_REPOS) {
      truncated = true;
      return;
    }
    if (await isGitRepoDir(dirPath)) {
      addRepoAvailability(dirPath, availableRepoKeys, repoPaths);
      foundRepoPaths.add(dirPath);
      return;
    }
    if (depth >= REPO_SCAN_MAX_DEPTH) return;

    let entries: Array<{ isDirectory(): boolean; name: string }>;
    try {
      entries = await readdir(dirPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('.')) continue;
      if (REPO_SCAN_SKIP_DIRS.has(entry.name)) continue;
      await walk(join(dirPath, entry.name), depth + 1);
      if (truncated) return;
    }
  }

  for (const root of scannedRoots) {
    await walk(root, 0);
    if (truncated) break;
  }

  return {
    availableRepoKeys: [...availableRepoKeys],
    repoPaths,
    scannedRoots,
    foundCount: foundRepoPaths.size,
    truncated,
  };
}

async function discoverGitReposCached(): Promise<RepoDiscovery> {
  const now = Date.now();
  if (repoDiscoveryCache && repoDiscoveryCache.expiresAt > now) return repoDiscoveryCache.discovery;
  const discovery = await discoverGitRepos();
  repoDiscoveryCache = { expiresAt: now + REPO_SCAN_CACHE_TTL_MS, discovery };
  return discovery;
}

async function isCodexAppServerReady(): Promise<boolean> {
  return new Promise((resolve) => {
    const ws = new WebSocket('ws://127.0.0.1:7878');
    let settled = false;
    const timer = setTimeout(() => finish(false), 800);
    function finish(ready: boolean) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ws.off('open', handleOpen);
      ws.off('error', handleError);
      ws.on('error', () => undefined);
      if (ws.readyState === WebSocket.OPEN) ws.close();
      if (ws.readyState === WebSocket.CONNECTING) ws.terminate();
      resolve(ready);
    }
    function handleOpen() {
      finish(true);
    }
    function handleError() {
      finish(false);
    }
    ws.once('open', handleOpen);
    ws.once('error', handleError);
  });
}

async function pathAccessStatus(path: string): Promise<'ok' | 'denied' | 'missing'> {
  try {
    const info = await stat(path);
    if (info.isDirectory()) {
      await readdir(path);
    } else {
      await access(path, constants.R_OK);
    }
    return 'ok';
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return 'missing';
    return 'denied';
  }
}

interface GoogleDriveDiscovery {
  roots: string[];
  inaccessibleRoots: string[];
}

function looksLikeGoogleDriveHomeRoot(name: string): boolean {
  return name === 'Google Drive' ||
    name === 'My Drive' ||
    name.includes('My Drive') ||
    name.includes('マイドライブ');
}

async function discoverGoogleDriveRoots(): Promise<GoogleDriveDiscovery> {
  const cloudStorage = join(homedir(), 'Library', 'CloudStorage');
  const roots = new Set<string>();
  const inaccessibleRoots = new Set<string>();

  try {
    const homeItems = await readdir(homedir(), { withFileTypes: true });
    for (const item of homeItems) {
      if (!looksLikeGoogleDriveHomeRoot(item.name)) continue;
      const candidate = join(homedir(), item.name);
      const status = await pathAccessStatus(candidate);
      if (status === 'ok') roots.add(candidate);
      if (status === 'denied') inaccessibleRoots.add(candidate);
    }
  } catch {
    // HOME自体が読めない場合はfolder_access.home側で表現する
  }

  try {
    const items = await readdir(cloudStorage, { withFileTypes: true });
    for (const item of items.filter(entry => entry.isDirectory() && entry.name.startsWith('GoogleDrive-'))) {
      const accountRoot = join(cloudStorage, item.name);
      const accountStatus = await pathAccessStatus(accountRoot);
      if (accountStatus === 'ok') roots.add(accountRoot);
      if (accountStatus === 'denied') inaccessibleRoots.add(accountRoot);

      if (accountStatus !== 'ok') continue;
      const children = await readdir(accountRoot, { withFileTypes: true }).catch(() => []);
      for (const child of children) {
        if (!looksLikeGoogleDriveHomeRoot(child.name) && !child.name.includes('共有ドライブ')) continue;
        const childPath = join(accountRoot, child.name);
        const childStatus = await pathAccessStatus(childPath);
        if (childStatus === 'ok') roots.add(childPath);
        if (childStatus === 'denied') inaccessibleRoots.add(childPath);
      }
    }
  } catch {
    // CloudStorageがない環境では旧Google Driveパスだけ確認する
  }

  for (const candidate of [join(homedir(), 'Google Drive'), join(homedir(), 'My Drive')]) {
    const status = await pathAccessStatus(candidate);
    if (status === 'ok') roots.add(candidate);
    if (status === 'denied') inaccessibleRoots.add(candidate);
  }
  return { roots: [...roots], inaccessibleRoots: [...inaccessibleRoots] };
}

export async function collectCapabilities(config: AgentConfig) {
  const [node, npx, gws, claude, codex, git, opencode, aider] = await Promise.all([
    hasCommand('node'),
    hasCommand('npx'),
    hasCommand('gws'),
    hasCommand('claude'),
    hasCommand('codex'),
    hasCommand('git'),
    hasCommand('opencode'),
    hasCommand('aider'),
  ]);
  const codexAppInstalled = await hasExecutablePath('/Applications/Codex.app/Contents/Resources/codex');
  const codexAppServerReady = codex || codexAppInstalled ? await isCodexAppServerReady() : false;
  const executors = ['playwright', 'simple', 'browser', 'terminal'];
  if (codex || codexAppInstalled) executors.push('codex_app');
  const browserProfileReady = await hasPath(join(homedir(), '.focusmap', 'browser-profile'));
  const gwsAuthReady = await hasPath(join(homedir(), '.config', 'gws'));
  const authDirReady = await hasPath(join(homedir(), '.focusmap', 'auth'));
  const googleDriveDiscovery = await withTimeout(
    discoverGoogleDriveRoots(),
    8_000,
    { roots: [], inaccessibleRoots: ['google_drive_discovery_timeout'] },
  );
  const repoDiscoveryFallback = repoDiscoveryCache?.discovery ?? {
    availableRepoKeys: [],
    repoPaths: {},
    scannedRoots: DEFAULT_REPO_SCAN_PATHS.map(expandHome),
    foundCount: 0,
    truncated: true,
  };
  const repoDiscovery = await withTimeout(
    discoverGitReposCached(),
    8_000,
    repoDiscoveryFallback,
  );
  const googleDriveRoots = googleDriveDiscovery.roots;
  const cloudStorageRoot = join(homedir(), 'Library', 'CloudStorage');
  const cloudStorageStatus = await withTimeout(pathAccessStatus(cloudStorageRoot), 2_000, 'denied' as const);
  const googleDriveStatuses = await Promise.all(
    googleDriveRoots.map(root => withTimeout(pathAccessStatus(root), 2_000, 'denied' as const)),
  );
  const folderAccess = {
    home: await withTimeout(pathAccessStatus(homedir()), 2_000, 'denied' as const),
    desktop: await withTimeout(pathAccessStatus(join(homedir(), 'Desktop')), 2_000, 'denied' as const),
    documents: await withTimeout(pathAccessStatus(join(homedir(), 'Documents')), 2_000, 'denied' as const),
    downloads: await withTimeout(pathAccessStatus(join(homedir(), 'Downloads')), 2_000, 'denied' as const),
    cloud_storage: cloudStorageStatus,
    google_drive: googleDriveStatuses.length > 0
      ? googleDriveStatuses.includes('denied') ? 'denied' : 'ok'
      : 'missing',
  };
  googleDriveStatuses.forEach((status, index) => {
    Object.assign(folderAccess, { [`google_drive_${index + 1}`]: status });
  });

  const availableSecretNames = [
    config.gemini_api_key ? 'GOOGLE_GENERATIVE_AI_API_KEY' : '',
    config.deepseek_api_key ? 'DEEPSEEK_API_KEY' : '',
    gws || gwsAuthReady ? 'GOOGLE_WORKSPACE_MCP' : '',
    gwsAuthReady ? 'GWS_AUTH' : '',
  ].filter(Boolean);

  return {
    executors,
    available_repo_keys: repoDiscovery.availableRepoKeys,
    available_secret_names: availableSecretNames,
    repo_paths: repoDiscovery.repoPaths,
    metadata: {
      app: 'focusmap-lite',
      agent: 'focusmap-agent',
      version: '0.2.1',
      platform: platform(),
      os_release: release(),
      node_installed: node,
      npx_installed: npx,
      git_installed: git,
      claude_installed: claude,
      codex_installed: codex,
      codex_app_installed: codexAppInstalled,
      codex_app_server_ready: codexAppServerReady,
      codex_thread_monitor: true,
      codex_orphan_thread_import: true,
      codex_thread_import_api_path: '/api/agents/codex-monitor/import-thread',
      codex_thread_import_scopes_api_path: '/api/agents/codex-monitor/import-scopes',
      repo_availability_source: 'focusmap-agent-heartbeat',
      repo_scan_paths: repoDiscovery.scannedRoots,
      repo_scan_found_count: repoDiscovery.foundCount,
      repo_scan_limit: REPO_SCAN_MAX_REPOS,
      repo_scan_truncated: repoDiscovery.truncated,
      repo_scan_cache_ttl_ms: REPO_SCAN_CACHE_TTL_MS,
      opencode_installed: opencode,
      aider_installed: aider,
      gws_installed: gws,
      gws_authenticated: gwsAuthReady,
      google_workspace_mcp: gws || gwsAuthReady,
      coding_harnesses: [
        opencode ? 'opencode' : '',
        codex ? 'codex' : '',
        claude ? 'claude' : '',
        aider ? 'aider' : '',
      ].filter(Boolean),
      cloud_storage_roots: cloudStorageStatus === 'missing' ? [] : [cloudStorageRoot],
      google_drive_roots: googleDriveRoots,
      inaccessible_google_drive_roots: googleDriveDiscovery.inaccessibleRoots,
      folder_access: folderAccess,
      playwright_installed: npx,
      browser_profile_ready: browserProfileReady,
      auth_dir_ready: authDirReady,
      terminal_permission: config.shell_enabled ? 'enabled' : 'disabled',
    },
  };
}
