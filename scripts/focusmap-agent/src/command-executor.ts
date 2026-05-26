import { spawn } from 'node:child_process';
import { platform } from 'node:os';
import type { AgentCommand, AgentConfig } from './types.js';
import { collectCapabilities } from './capabilities.js';
import { webOriginFromApiUrl } from './api-client.js';

const DANGEROUS_SHELL_PATTERN = /\b(rm\s+-rf|sudo\s+rm|mkfs|diskutil\s+erase|shutdown|reboot|:(){|dd\s+if=|chmod\s+-R\s+777)\b/i;

function payloadString(command: AgentCommand, key: string): string | null {
  const value = command.payload?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function runProcess(
  executable: string,
  args: string[],
  options: { shell?: boolean; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {},
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      shell: options.shell ?? false,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`command timed out after ${options.timeoutMs}ms`));
    }, options.timeoutMs ?? 120_000);

    child.stdout.on('data', chunk => {
      stdout += String(chunk);
      if (stdout.length > 80_000) stdout = stdout.slice(-80_000);
    });
    child.stderr.on('data', chunk => {
      stderr += String(chunk);
      if (stderr.length > 80_000) stderr = stderr.slice(-80_000);
    });
    child.on('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', code => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code });
    });
  });
}

export async function openUrl(url: string) {
  if (platform() === 'darwin') {
    return runProcess('/usr/bin/open', [url], { timeoutMs: 10_000 });
  }
  return runProcess('/usr/bin/env', ['xdg-open', url], { timeoutMs: 10_000 });
}

async function runShell(command: string, config: AgentConfig) {
  if (!config.shell_enabled) {
    throw new Error('shell execution is disabled. Set shell_enabled=true in ~/.focusmap/config.json to allow it.');
  }
  if (DANGEROUS_SHELL_PATTERN.test(command)) {
    throw new Error('blocked dangerous shell command');
  }
  return runProcess('/bin/zsh', ['-lc', command], {
    env: {
      ...process.env,
      PATH: config.path || process.env.PATH,
    },
    timeoutMs: 180_000,
  });
}

export async function executeCommand(command: AgentCommand, config: AgentConfig) {
  switch (command.type) {
    case 'open_url':
    case 'open_browser_auth': {
      const url = payloadString(command, 'url') || webOriginFromApiUrl(config.api_url);
      await openUrl(url);
      return { opened_url: url };
    }
    case 'open_google_auth': {
      const url = `${webOriginFromApiUrl(config.api_url)}/api/calendar/connect?next=/dashboard/settings/automation`;
      await openUrl(url);
      return { opened_url: url };
    }
    case 'open_gws_auth': {
      const shell = payloadString(command, 'command') || 'gws auth login';
      const result = await runShell(shell, config);
      return { command: shell, ...result };
    }
    case 'run_shell': {
      const shell = payloadString(command, 'command');
      if (!shell) throw new Error('payload.command is required');
      const result = await runShell(shell, config);
      return { command: shell, ...result };
    }
    case 'scan_capabilities':
      return await collectCapabilities(config);
    case 'restart_agent':
      return { message: 'restart requested; launchd will handle restart in packaged mode' };
    case 'pause_agent':
    case 'resume_agent':
    case 'upload_logs':
      return { message: `${command.type} is accepted but not implemented in this MVP` };
    default:
      throw new Error(`unsupported command: ${command.type}`);
  }
}
