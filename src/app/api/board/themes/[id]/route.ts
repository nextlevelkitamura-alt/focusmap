import { NextRequest, NextResponse } from 'next/server';
import { getThemeById, updateTheme } from '@/lib/turso/themes';
import { createClient } from '@/utils/supabase/server';

type ThemePatchBody = {
  name?: unknown;
  purpose?: unknown;
};

function text(value: unknown, maxLength: number) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

// Dailyのテーマ鉛筆専用。ThemeはTursoの運用データが正本で、plan_refsはここでは変更しない。
// plan本文はrepo Markdown正本のため、このAPIからは絶対に編集しない。
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const { id } = await params;
  if (!id) return NextResponse.json({ success: false, error: 'INVALID_THEME_ID' }, { status: 400 });

  let body: ThemePatchBody;
  try {
    body = (await request.json()) as ThemePatchBody;
  } catch {
    return NextResponse.json({ success: false, error: 'INVALID_JSON' }, { status: 400 });
  }

  const name = text(body.name, 160);
  if (!name) return NextResponse.json({ success: false, error: 'THEME_NAME_REQUIRED' }, { status: 400 });

  try {
    const updated = await updateTheme({
      id,
      name,
      purpose: text(body.purpose, 1_000) || null,
    });
    if (!updated) return NextResponse.json({ success: false, error: 'THEME_NOT_FOUND' }, { status: 404 });
    const theme = await getThemeById(id);
    return NextResponse.json({ success: true, theme });
  } catch {
    return NextResponse.json({ success: false, error: 'THEME_UPDATE_FAILED' }, { status: 500 });
  }
}
