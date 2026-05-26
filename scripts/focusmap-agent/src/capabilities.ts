import { access } from 'node:fs/promises';
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

export async function collectCapabilities(config: AgentConfig) {
  const [node, npx, gws, claude, codex, git] = await Promise.all([
    hasCommand('node'),
    hasCommand('npx'),
    hasCommand('gws'),
    hasCommand('claude'),
    hasCommand('codex'),
    hasCommand('git'),
  ]);
  const browserProfileReady = await hasPath(join(homedir(), '.focusmap', 'browser-profile'));
  const gwsAuthReady = await hasPath(join(homedir(), '.config', 'gws'));
  const authDirReady = await hasPath(join(homedir(), '.focusmap', 'auth'));

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
      gws_installed: gws,
      gws_authenticated: gwsAuthReady,
      google_workspace_mcp: gws || gwsAuthReady,
      playwright_installed: npx,
      browser_profile_ready: browserProfileReady,
      auth_dir_ready: authDirReady,
      terminal_permission: config.shell_enabled ? 'enabled' : 'disabled',
    },
  };
}
