import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

/**
 * アカウント削除API
 * 注意: ユーザーの全データを削除してからアカウントを削除する
 */
export async function POST() {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json(
      { error: { message: 'Unauthorized' } },
      { status: 401 }
    )
  }

  try {
    // 1. ユーザーの全データを削除（CASCADEで自動削除されるテーブルもあれば手動削除が必要なものも）
    // tasks
    await supabase.from('tasks').delete().eq('user_id', user.id)
    // projects
    await supabase.from('projects').delete().eq('user_id', user.id)
    // user_calendars (トークン含む)
    await supabase.from('user_calendars').delete().eq('user_id', user.id)
    // notification_settings
    await supabase.from('notification_settings').delete().eq('user_id', user.id)
    // habits
    await supabase.from('habits').delete().eq('user_id', user.id)
    // spaces
    await supabase.from('spaces').delete().eq('user_id', user.id)

    // 2. Supabase Auth からユーザーを削除
    // 注意: admin APIが必要なため、RLSで保護された状態では自己削除が制限される場合がある
    // Supabase の設定で「Allow users to delete their own account」を有効にする必要がある
    const { error: deleteError } = await supabase.auth.admin.deleteUser(user.id)

    if (deleteError) {
      // admin権限がない場合のフォールバック: クライアント側でサインアウト
      console.error('Admin delete failed, signing out:', deleteError)
      await supabase.auth.signOut()
      return NextResponse.json({
        success: true,
        message: 'データを削除しました。アカウント削除は管理者にお問い合わせください。'
      })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Delete account error:', error)
    return NextResponse.json(
      { error: { message: 'アカウント削除に失敗しました' } },
      { status: 500 }
    )
  }
}
