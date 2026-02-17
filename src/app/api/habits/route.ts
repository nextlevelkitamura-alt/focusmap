import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"

// GET: Get all habit tasks with their completions and child tasks
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
        const from = searchParams.get('from') // completions date range start
        const to = searchParams.get('to')     // completions date range end

        // 1. Get all habit tasks
        const { data: habits, error: habitsError } = await supabase
            .from('tasks')
            .select('*')
            .eq('user_id', user.id)
            .eq('is_habit', true)
            .order('order_index', { ascending: true })

        if (habitsError) {
            console.error('[habits GET] Habits query error:', habitsError)
            return NextResponse.json(
                { success: false, error: { code: 'API_ERROR', message: habitsError.message } },
                { status: 500 }
            )
        }

        if (!habits || habits.length === 0) {
            return NextResponse.json({ success: true, habits: [] })
        }

        const habitIds = habits.map(h => h.id)

        // 2. Get child tasks for all habits
        const { data: childTasks, error: childError } = await supabase
            .from('tasks')
            .select('*')
            .in('parent_task_id', habitIds)
            .eq('user_id', user.id)
            .eq('is_habit', false)
            .order('order_index', { ascending: true })

        if (childError) {
            console.error('[habits GET] Child tasks query error:', childError)
        }

        // 3. Get completions for date range
        let completions: any[] = []
        if (from || to) {
            let query = supabase
                .from('habit_completions')
                .select('*')
                .eq('user_id', user.id)
                .in('habit_id', habitIds)

            if (from) query = query.gte('completed_date', from)
            if (to) query = query.lte('completed_date', to)

            const { data, error: compError } = await query
            if (compError) {
                console.error('[habits GET] Completions query error:', compError)
            }
            completions = data || []
        }

        // 4. Build response: each habit with its children and completions
        const childMap = new Map<string, any[]>()
        for (const child of (childTasks || [])) {
            const list = childMap.get(child.parent_task_id!) || []
            list.push(child)
            childMap.set(child.parent_task_id!, list)
        }

        const completionMap = new Map<string, any[]>()
        for (const comp of completions) {
            const list = completionMap.get(comp.habit_id) || []
            list.push(comp)
            completionMap.set(comp.habit_id, list)
        }

        const result = habits.map(habit => ({
            ...habit,
            child_tasks: childMap.get(habit.id) || [],
            completions: completionMap.get(habit.id) || [],
        }))

        return NextResponse.json({ success: true, habits: result })
    } catch (error) {
        console.error('[habits GET] Unexpected error:', error)
        return NextResponse.json(
            { success: false, error: { code: 'API_ERROR', message: 'Internal server error' } },
            { status: 500 }
        )
    }
}
