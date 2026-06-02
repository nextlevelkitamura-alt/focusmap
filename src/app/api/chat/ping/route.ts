import { NextResponse } from 'next/server';
import { generateText } from 'ai';
import { deepseek } from '@ai-sdk/deepseek';
import { google } from '@ai-sdk/google';
import { createClient } from '@/utils/supabase/server';

/**
 * GET /api/chat/ping
 *
 * 固定AIモデルの接続先を返し、軽量プロンプトで応答時間を計測する。
 * 「使用感確認」のための接続テスト用エンドポイント。
 *
 * Returns: {
 *   provider: 'deepseek' | 'gemini',
 *   model: string,
 *   ok: boolean,
 *   latency_ms: number,
 *   response_preview: string,
 *   error?: string
 * }
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const hasDeepSeek = Boolean(process.env.DEEPSEEK_API_KEY);
  const provider = hasDeepSeek ? 'deepseek' : 'gemini';
  const modelId = hasDeepSeek
    ? process.env.DEEPSEEK_AUTOMATION_MODEL ?? process.env.DEEPSEEK_MODEL ?? 'deepseek-v4-pro'
    : 'gemini-3.1-flash-lite';

  const model = hasDeepSeek ? deepseek(modelId) : google(modelId);

  const start = Date.now();
  try {
    const result = await generateText({
      model,
      prompt: 'これは接続テストです。 "OK" と短く返してください。',
      maxOutputTokens: 32,
      temperature: 0,
    });
    const latency = Date.now() - start;
    return NextResponse.json({
      provider,
      model: modelId,
      ok: true,
      latency_ms: latency,
      response_preview: (result.text ?? '').slice(0, 100),
    });
  } catch (e) {
    return NextResponse.json(
      {
        provider,
        model: modelId,
        ok: false,
        latency_ms: Date.now() - start,
        error: e instanceof Error ? e.message : String(e),
      },
      { status: 500 },
    );
  }
}
