import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"

// POST: Record a habit completion for a specific date
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

        const { habit_id, completed_date } = await request.json()

        if (!habit_id || !completed_date) {
            return NextResponse.json(
                { success: false, error: { code: 'VALIDATION_ERROR', message: 'habit_id and completed_date are required' } },
                { status: 400 }
            )
        }

        // Verify the habit belongs to this user
        const { data: habit, error: habitError } = await supabase
            .from('tasks')
            .select('id, is_habit')
            .eq('id', habit_id)
            .eq('user_id', user.id)
            .single()

        if (habitError || !habit || !habit.is_habit) {
            return NextResponse.json(
                { success: false, error: { code: 'NOT_FOUND', message: 'Habit not found' } },
                { status: 404 }
            )
        }

        // Upsert completion (idempotent - calling twice for same date won't error)
        const { data: completion, error: insertError } = await supabase
            .from('habit_completions')
            .upsert(
                {
                    habit_id,
                    user_id: user.id,
                    completed_date,
                    updated_at: new Date().toISOString(),
                },
                { onConflict: 'habit_id,completed_date' }
            )
            .select()
            .single()

        if (insertError) {
            console.error('[habits/completions POST] Insert error:', insertError)
            return NextResponse.json(
                { success: false, error: { code: 'API_ERROR', message: insertError.message } },
                { status: 500 }
            )
        }

        return NextResponse.json({ success: true, completion })
    } catch (error) {
        console.error('[habits/completions POST] Unexpected error:', error)
        return NextResponse.json(
            { success: false, error: { code: 'API_ERROR', message: 'Internal server error' } },
            { status: 500 }
        )
    }
}

// GET: Get habit completions for a date range
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
        const from = searchParams.get('from')
        const to = searchParams.get('to')
        const habitId = searchParams.get('habit_id')

        let query = supabase
            .from('habit_completions')
            .select('*')
            .eq('user_id', user.id)

        if (habitId) {
            query = query.eq('habit_id', habitId)
        }
        if (from) {
            query = query.gte('completed_date', from)
        }
        if (to) {
            query = query.lte('completed_date', to)
        }

        query = query.order('completed_date', { ascending: false })

        const { data: completions, error: queryError } = await query

        if (queryError) {
            console.error('[habits/completions GET] Query error:', queryError)
            return NextResponse.json(
                { success: false, error: { code: 'API_ERROR', message: queryError.message } },
                { status: 500 }
            )
        }

        return NextResponse.json({ success: true, completions: completions || [] })
    } catch (error) {
        console.error('[habits/completions GET] Unexpected error:', error)
        return NextResponse.json(
            { success: false, error: { code: 'API_ERROR', message: 'Internal server error' } },
            { status: 500 }
        )
    }
}

// DELETE: Remove a habit completion for a specific date
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

        const { habit_id, completed_date } = await request.json()

        if (!habit_id || !completed_date) {
            return NextResponse.json(
                { success: false, error: { code: 'VALIDATION_ERROR', message: 'habit_id and completed_date are required' } },
                { status: 400 }
            )
        }

        const { error: deleteError } = await supabase
            .from('habit_completions')
            .delete()
            .eq('habit_id', habit_id)
            .eq('completed_date', completed_date)
            .eq('user_id', user.id)

        if (deleteError) {
            console.error('[habits/completions DELETE] Delete error:', deleteError)
            return NextResponse.json(
                { success: false, error: { code: 'API_ERROR', message: deleteError.message } },
                { status: 500 }
            )
        }

        return NextResponse.json({ success: true, message: 'Completion removed' })
    } catch (error) {
        console.error('[habits/completions DELETE] Unexpected error:', error)
        return NextResponse.json(
            { success: false, error: { code: 'API_ERROR', message: 'Internal server error' } },
            { status: 500 }
        )
    }
}
