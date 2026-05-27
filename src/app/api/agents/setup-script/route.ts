import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { hashAgentToken } from '@/lib/agent-auth';
import { createClient } from '@/utils/supabase/server';
import { createServiceClient } from '@/utils/supabase/service';

/**
 * POST /api/agents/setup-script
 *
 * Body: { space_id: string, name?: string }
 *
 * macOS の `.command` 実行可能ファイル として install.sh ワンライナーを返す。
 * ユーザーがダウンロード → ダブルクリック → ターミナルが自動起動 + 自動セットアップ。
 *
 * ヘッダー:
 *   Content-Type: application/x-sh
 *   Content-Disposition: attachment; filename="Focusmap-Setup-<short>.command"
 *
 * セキュリティ:
 *   - agent_token は1度しか発行しない (DBに SHA-256 hash のみ保存)
 *   - .command ファイル中に token を含めるが、 ダウンロードはセッション認証済ユーザーに限定
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const spaceId: string | undefined = body.space_id;
  const tokenName: string =
    typeof body.name === 'string' && body.name.trim() ? body.name.trim() : 'Focusmap Lite';

  if (!spaceId) {
    return NextResponse.json({ error: 'space_id is required' }, { status: 400 });
  }

  // Owner / Admin チェック
  const { data: canEdit } = await supabase.rpc('can_edit_space', {
    p_space_id: spaceId,
    p_user_id: user.id,
  });
  if (!canEdit) {
    return NextResponse.json(
      { error: 'Only workspace owner/admin can issue agent tokens' },
      { status: 403 },
    );
  }

  // agent_token 発行 + DB保存 (hash)
  const rawToken = `fma_${randomBytes(32).toString('base64url')}`;
  const service = createServiceClient();
  const { error: insertError } = await service.from('agent_tokens').insert({
    user_id: user.id,
    space_id: spaceId,
    token_hash: hashAgentToken(rawToken),
    name: tokenName,
  });
  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  const origin = req.headers.get('origin') ?? 'https://focusmap-official.com';
  const installUrl = `${origin}/install.sh`;
  const tokenShort = rawToken.slice(4, 12);
  const generatedAt = new Date().toISOString();

  // .command ファイルの中身
  //   - shebang
  //   - 視覚的にわかりやすいログ
  //   - install.sh をワンライナーで実行
  //   - 完了後ターミナルを保持 (read で待機)
  const scriptContent = `#!/bin/bash
# ─────────────────────────────────────────────────────────────
# Focusmap Lite セットアップスクリプト
# ─────────────────────────────────────────────────────────────
# 発行: ${generatedAt}
# 発行先: ${user.email ?? user.id}
# Token (末尾): ...${tokenShort}
# ─────────────────────────────────────────────────────────────

clear

cat <<'BANNER'

  ███████╗ ██████╗  ██████╗██╗   ██╗███████╗███╗   ███╗ █████╗ ██████╗
  ██╔════╝██╔═══██╗██╔════╝██║   ██║██╔════╝████╗ ████║██╔══██╗██╔══██╗
  █████╗  ██║   ██║██║     ██║   ██║███████╗██╔████╔██║███████║██████╔╝
  ██╔══╝  ██║   ██║██║     ██║   ██║╚════██║██║╚██╔╝██║██╔══██║██╔═══╝
  ██║     ╚██████╔╝╚██████╗╚██████╔╝███████║██║ ╚═╝ ██║██║  ██║██║
  ╚═╝      ╚═════╝  ╚═════╝ ╚═════╝ ╚══════╝╚═╝     ╚═╝╚═╝  ╚═╝╚═╝

  ローカル自動化エージェントの セットアップを開始します

BANNER

echo "📡 インストールスクリプトを取得中..."
echo "    ${installUrl}"
echo ""

# install.sh をダウンロードして実行
if curl -sSL "${installUrl}" | sh -s -- "${rawToken}"; then
  echo ""
  echo "✅ セットアップが完了しました"
  echo ""
  echo "Web画面に戻ると 「セットアップ完了」 が自動で表示されます"
  echo ""
else
  echo ""
  echo "❌ セットアップ中にエラーが発生しました"
  echo ""
  echo "サポートに以下の情報を伝えてください:"
  echo "  - Token末尾: ${tokenShort}"
  echo "  - 発行時刻: ${generatedAt}"
  echo ""
fi

echo "このウィンドウを閉じても問題ありません (Cmd+W)"
echo ""
read -n 1 -s -r -p "何かキーを押すと閉じます..."
echo ""
`;

  return new NextResponse(scriptContent, {
    status: 200,
    headers: {
      'Content-Type': 'application/x-sh; charset=utf-8',
      'Content-Disposition': `attachment; filename="Focusmap-Setup-${tokenShort}.command"`,
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'X-Token-Short': tokenShort,
    },
  });
}
