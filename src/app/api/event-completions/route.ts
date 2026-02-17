import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"

/**
 * GET: 今日のイベント完了状態を取得
 * Query: ?date=YYYY-MM-DD (default: today)
 */
export async function GET(request: NextRequest) {
    try {
        const supabase = await createClient()
        const { data: { user }, error: authError } = await supabase.auth.getUser()

        if (authError || !user) {
            return NextResponse.json(
                { success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } },
                { status: 401 }
            )
        }

        const { searchParams } = new URL(request.url)
        const date = searchParams.get('date') || new Date().toISOString().split('T')[0]

        const { data: completions, error } = await supabase
            .from('event_completions')
            .select('*')
            .eq('user_id', user.id)
            .eq('completed_date', date)

        if (error) {
            console.error('[event-completions GET] Error:', error)
            return NextResponse.json(
                { success: false, error: { code: 'QUERY_ERROR', message: error.message } },
                { status: 500 }
            )
        }

        return NextResponse.json({ success: true, completions: completions || [] })
    } catch (error: any) {
        console.error('[event-completions GET] Error:', error)
        return NextResponse.json(
            { success: false, error: { code: 'API_ERROR', message: error.message } },
            { status: 500 }
        )
    }
}

/**
 * POST: イベントを完了としてマーク
 * Body: { google_event_id, calendar_id, completed_date? }
 */
export async function POST(request: NextRequest) {
    try {
        const supabase = await createClient()
        const { data: { user }, error: authError } = await supabase.auth.getUser()

        if (authError || !user) {
            return NextResponse.json(
                { success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } },
                { status: 401 }
            )
        }

        const body = await request.json()
        const { google_event_id, calendar_id } = body
        const completed_date = body.completed_date || new Date().toISOString().split('T')[0]

        if (!google_event_id || !calendar_id) {
            return NextResponse.json(
                { success: false, error: { code: 'BAD_REQUEST', message: 'google_event_id and calendar_id are required' } },
                { status: 400 }
            )
        }

        const { data, error } = await supabase
            .from('event_completions')
            .upsert({
                user_id: user.id,
                google_event_id,
                calendar_id,
                completed_date,
            }, {
                onConflict: 'user_id,google_event_id,completed_date'
            })
            .select()
            .single()

        if (error) {
            console.error('[event-completions POST] Error:', error)
            return NextResponse.json(
                { success: false, error: { code: 'INSERT_ERROR', message: error.message } },
                { status: 500 }
            )
        }

        return NextResponse.json({ success: true, completion: data })
    } catch (error: any) {
        console.error('[event-completions POST] Error:', error)
        return NextResponse.json(
            { success: false, error: { code: 'API_ERROR', message: error.message } },
            { status: 500 }
        )
    }
}

/**
 * DELETE: イベントの完了を取り消し
 * Body: { google_event_id, completed_date? }
 */
export async function DELETE(request: NextRequest) {
    try {
        const supabase = await createClient()
        const { data: { user }, error: authError } = await supabase.auth.getUser()

        if (authError || !user) {
            return NextResponse.json(
                { success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } },
                { status: 401 }
            )
        }

        const body = await request.json()
        const { google_event_id } = body
        const completed_date = body.completed_date || new Date().toISOString().split('T')[0]

        if (!google_event_id) {
            return NextResponse.json(
                { success: false, error: { code: 'BAD_REQUEST', message: 'google_event_id is required' } },
                { status: 400 }
            )
        }

        const { error } = await supabase
            .from('event_completions')
            .delete()
            .eq('user_id', user.id)
            .eq('google_event_id', google_event_id)
            .eq('completed_date', completed_date)

        if (error) {
            console.error('[event-completions DELETE] Error:', error)
            return NextResponse.json(
                { success: false, error: { code: 'DELETE_ERROR', message: error.message } },
                { status: 500 }
            )
        }

        return NextResponse.json({ success: true })
    } catch (error: any) {
        console.error('[event-completions DELETE] Error:', error)
        return NextResponse.json(
            { success: false, error: { code: 'API_ERROR', message: error.message } },
            { status: 500 }
        )
    }
}
