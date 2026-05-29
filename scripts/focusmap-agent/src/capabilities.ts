import { access, readdir, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir, platform, release } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AgentConfig } from './types.js';

const execFileAsync = promisify(execFile);

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
  const browserProfileReady = await hasPath(join(homedir(), '.focusmap', 'browser-profile'));
  const gwsAuthReady = await hasPath(join(homedir(), '.config', 'gws'));
  const authDirReady = await hasPath(join(homedir(), '.focusmap', 'auth'));
  const googleDriveDiscovery = await discoverGoogleDriveRoots();
  const googleDriveRoots = googleDriveDiscovery.roots;
  const cloudStorageRoot = join(homedir(), 'Library', 'CloudStorage');
  const cloudStorageStatus = await pathAccessStatus(cloudStorageRoot);
  const googleDriveStatuses = await Promise.all(googleDriveRoots.map(pathAccessStatus));
  const folderAccess = {
    home: await pathAccessStatus(homedir()),
    desktop: await pathAccessStatus(join(homedir(), 'Desktop')),
    documents: await pathAccessStatus(join(homedir(), 'Documents')),
    downloads: await pathAccessStatus(join(homedir(), 'Downloads')),
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
    executors: ['playwright', 'simple', 'browser', 'terminal'],
    available_secret_names: availableSecretNames,
    metadata: {
      app: 'focusmap-lite',
      agent: 'focusmap-agent',
      version: '0.2.0',
      platform: platform(),
      os_release: release(),
      node_installed: node,
      npx_installed: npx,
      git_installed: git,
      claude_installed: claude,
      codex_installed: codex,
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
