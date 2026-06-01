import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    ok: true,
    app: 'focusmap',
    surface: 'desktop',
    timestamp: new Date().toISOString(),
  });
}
