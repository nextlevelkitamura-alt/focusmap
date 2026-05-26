import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const agentDir = path.join(process.cwd(), 'scripts', 'focusmap-agent');

  try {
    await access(agentDir);
  } catch {
    return NextResponse.json({ error: 'focusmap-agent source is not bundled' }, { status: 404 });
  }

  const tar = spawn(
    'tar',
    ['--exclude=./node_modules', '--exclude=./dist', '-czf', '-', '-C', agentDir, '.'],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  tar.stderr.on('data', (chunk) => {
    console.error('[focusmap-agent.tar.gz]', String(chunk));
  });

  return new Response(Readable.toWeb(tar.stdout) as ReadableStream<Uint8Array>, {
    headers: {
      'Content-Type': 'application/gzip',
      'Content-Disposition': 'attachment; filename="focusmap-agent.tar.gz"',
      'Cache-Control': 'public, max-age=300',
    },
  });
}
