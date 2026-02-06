import { NextRequest, NextResponse } from 'next/server';

/**
 * 通知権限の状態を確認
 * GET /api/notifications/permission
 */
export async function GET(request: NextRequest) {
  const isSupported = typeof Notification !== 'undefined';
  const permission = isSupported ? Notification.permission : 'unsupported';

  return NextResponse.json({
    success: true,
    permission,
    supported: isSupported,
  });
}
