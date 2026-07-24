import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { basename, dirname, isAbsolute, join } from 'node:path';
import type { AgentConfig } from '../types.js';
import { resolveSafePath } from './file-io.js';

const BUCKETS = new Set(['planning', 'active', 'paused', 'done', 'archive']);
const TARGETS: Record<string, Set<string>> = {
  planning: new Set(['active', 'archive']),
  active: new Set(['paused', 'done', 'archive']),
  paused: new Set(['active', 'archive']),
  done: new Set(['archive']),
  archive: new Set(),
};

type ProcessResult = { stdout: string; stderr: string; exitCode: number | null };
type Runner = (executable: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv }) => Promise<ProcessResult>;

function runProcess(executable: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv }): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { ...options, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('plan transition timed out'));
    }, 570_000);
    child.stdout.on('data', chunk => { stdout = (stdout + String(chunk)).slice(-80_000); });
    child.stderr.on('data', chunk => { stderr = (stderr + String(chunk)).slice(-80_000); });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', exitCode => { clearTimeout(timer); resolve({ stdout, stderr, exitCode }); });
  });
}

function requireSuccess(label: string, result: ProcessResult): void {
  if (result.exitCode !== 0) {
    const detail = (result.stderr || result.stdout).trim().slice(0, 2_000);
    throw new Error(`${label} failed${detail ? `: ${detail}` : ''}`);
  }
}

export type PlanTransitionInput = {
  plan_path: string;
  expected_bucket: string;
  target_bucket: string;
};

export async function executePlanTransition(
  input: PlanTransitionInput,
  config: AgentConfig,
  runner: Runner = runProcess,
) {
  const expected = input.expected_bucket?.trim();
  const target = input.target_bucket?.trim();
  if (!BUCKETS.has(expected) || !BUCKETS.has(target)) throw new Error('invalid plan bucket');
  if (!TARGETS[expected]?.has(target)) throw new Error(`transition is not allowed: ${expected} -> ${target}`);

  const privateRootResult = resolveSafePath(config.private_root || '');
  if (!privateRootResult.ok) throw new Error(`private_root is not allowed: ${privateRootResult.reason}`);
  const rawPath = input.plan_path?.trim();
  if (!rawPath) throw new Error('payload.plan_path is required');
  const candidate = isAbsolute(rawPath) ? rawPath : join(privateRootResult.real, rawPath);
  const safePlan = resolveSafePath(candidate);
  if (!safePlan.ok || !existsSync(safePlan.real)) throw new Error('plan_path does not exist or is not allowed');
  const planStat = await stat(safePlan.real);
  const sourceDir = planStat.isDirectory() ? safePlan.real : dirname(safePlan.real);
  const currentBucket = basename(dirname(sourceDir));
  if (currentBucket !== expected) {
    throw new Error(`plan bucket changed: expected=${expected} current=${currentBucket}`);
  }

  const opsCandidate = config.plan_ops_root || join(
    privateRootResult.real,
    'personal-os',
    'AIエージェント基盤',
    'skills',
    'plan-ops',
  );
  const safeOps = resolveSafePath(opsCandidate);
  if (!safeOps.ok) throw new Error(`plan_ops_root is not allowed: ${safeOps.reason}`);
  const bucketctl = join(safeOps.real, 'scripts', 'bucketctl.sh');
  const plansync = join(safeOps.real, 'scripts', 'plansync.py');
  if (!existsSync(bucketctl) || !existsSync(plansync)) throw new Error('plan-ops scripts are missing');

  const env = { ...process.env, PATH: config.path || process.env.PATH };
  const dryRun = await runner(bucketctl, ['move', sourceDir, '--to', target], { cwd: privateRootResult.real, env });
  requireSuccess('bucketctl dry-run', dryRun);
  const applied = await runner(bucketctl, ['move', sourceDir, '--to', target, '--commit'], { cwd: privateRootResult.real, env });
  requireSuccess('bucketctl commit', applied);

  const newDir = join(dirname(dirname(sourceDir)), target, basename(sourceDir));
  if (!existsSync(newDir)) throw new Error('plan transition readback failed');
  const areasRoot = join(privateRootResult.real, 'personal-os', 'my-brain', 'areas');
  const synced = await runner('python3', [
    plansync,
    'sync',
    '--all',
    '--root', areasRoot,
    '--repo-root', privateRootResult.real,
    '--apply',
  ], { cwd: privateRootResult.real, env });
  requireSuccess('plansync', synced);

  return {
    plan_path: newDir,
    previous_bucket: expected,
    bucket: target,
    committed: true,
    synced: true,
  };
}
