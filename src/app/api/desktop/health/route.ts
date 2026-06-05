import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const expectedToken = process.env.FOCUSMAP_DESKTOP_HEALTH_TOKEN || '';
  const url = new URL(request.url);
  const providedToken = url.searchParams.get('desktop_token') || request.headers.get('x-focusmap-desktop-token') || '';

  return NextResponse.json({
    ok: true,
    app: 'focusmap',
    surface: 'desktop',
    desktop_managed: Boolean(expectedToken),
    desktop_token_ok: Boolean(expectedToken && providedToken === expectedToken),
    timestamp: new Date().toISOString(),
  });
}
