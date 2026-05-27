/**
 * ファイルI/O executor
 *
 * Claude Code 級の操作のため、 task 実行中に AI が直接ファイル読み書きできる。
 *
 * 安全策:
 * - HOME ディレクトリ内 (or 明示的に許可された prefix) に制限
 * - シンボリックリンクを介した escape を防ぐ (realpath 比較)
 * - 大容量ファイルは 5MB上限で truncate
 * - 危険な拡張子の自動実行はしない (.command / .app 等の生成は許可、 実行はしない)
 */

import { readFile, writeFile, readdir, stat, unlink, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve, dirname, relative } from 'node:path';
import { realpathSync, existsSync } from 'node:fs';

const ALLOWED_ROOTS = [homedir(), '/tmp'];
const MAX_READ_BYTES = 5 * 1024 * 1024; // 5MB
const MAX_WRITE_BYTES = 5 * 1024 * 1024;

function isPathSafe(targetPath: string): { ok: true; real: string } | { ok: false; reason: string } {
  let absolute: string;
  try {
    absolute = resolve(targetPath);
  } catch (e) {
    return { ok: false, reason: `path resolve failed: ${String(e)}` };
  }
  let real = absolute;
  try {
    if (existsSync(absolute)) {
      real = realpathSync(absolute);
    }
  } catch {
    real = absolute;
  }
  const allowed = ALLOWED_ROOTS.some((root) => {
    const rel = relative(root, real);
    return rel === '' || (!rel.startsWith('..') && !rel.startsWith('/'));
  });
  if (!allowed) {
    return {
      ok: false,
      reason: `path is outside allowed roots (${ALLOWED_ROOTS.join(', ')}): ${real}`,
    };
  }
  return { ok: true, real };
}

export interface FileReadResult {
  path: string;
  content: string;
  bytes: number;
  truncated: boolean;
  encoding: 'utf8';
}

export async function fileRead(rawPath: string): Promise<FileReadResult> {
  const safety = isPathSafe(rawPath);
  if (!safety.ok) throw new Error(safety.reason);
  const buf = await readFile(safety.real);
  const truncated = buf.byteLength > MAX_READ_BYTES;
  const sliced = truncated ? buf.subarray(0, MAX_READ_BYTES) : buf;
  return {
    path: safety.real,
    content: sliced.toString('utf8'),
    bytes: buf.byteLength,
    truncated,
    encoding: 'utf8',
  };
}

export interface FileWriteResult {
  path: string;
  bytes_written: number;
  created: boolean;
}

export async function fileWrite(
  rawPath: string,
  content: string,
  options: { mode?: 'overwrite' | 'append'; mkdirs?: boolean } = {},
): Promise<FileWriteResult> {
  const safety = isPathSafe(rawPath);
  if (!safety.ok) throw new Error(safety.reason);
  const bytes = Buffer.byteLength(content, 'utf8');
  if (bytes > MAX_WRITE_BYTES) {
    throw new Error(`write size ${bytes}B exceeds max ${MAX_WRITE_BYTES}B`);
  }

  const created = !existsSync(safety.real);
  if (options.mkdirs) {
    await mkdir(dirname(safety.real), { recursive: true, mode: 0o755 });
  }
  await writeFile(safety.real, content, {
    encoding: 'utf8',
    flag: options.mode === 'append' ? 'a' : 'w',
    mode: 0o644,
  });
  return { path: safety.real, bytes_written: bytes, created };
}

export interface FileListEntry {
  name: string;
  is_dir: boolean;
  size: number;
  modified_at: string;
}

export async function fileList(rawPath: string): Promise<{ path: string; entries: FileListEntry[] }> {
  const safety = isPathSafe(rawPath);
  if (!safety.ok) throw new Error(safety.reason);
  const items = await readdir(safety.real, { withFileTypes: true });
  const entries: FileListEntry[] = [];
  for (const item of items) {
    const child = resolve(safety.real, item.name);
    try {
      const st = await stat(child);
      entries.push({
        name: item.name,
        is_dir: item.isDirectory(),
        size: st.size,
        modified_at: st.mtime.toISOString(),
      });
    } catch {
      // 取得失敗時はスキップ
    }
  }
  return { path: safety.real, entries };
}

export async function fileDelete(rawPath: string): Promise<{ path: string; deleted: boolean }> {
  const safety = isPathSafe(rawPath);
  if (!safety.ok) throw new Error(safety.reason);
  if (!existsSync(safety.real)) {
    return { path: safety.real, deleted: false };
  }
  await unlink(safety.real);
  return { path: safety.real, deleted: true };
}
