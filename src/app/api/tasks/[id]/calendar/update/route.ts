import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/utils/supabase/server'
import { GoogleCalendarService } from '@/lib/google-calendar'
import { z } from 'zod'

const updateTaskSchema = z.object({
  calendar_type: z.string().optional().nullable(),
  scheduled_start_time: z.string().optional().nullable(),
})

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createServerClient()
    const body = await request.json()

    // Validate input
    const validatedData = updateTaskSchema.parse(body)

    // Get current user
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get the task
    const { data: task, error: taskError } = await supabase
      .from('tasks')
      .select('*')
      .eq('id', params.id)
      .eq('user_id', user.id)
      .single()

    if (taskError || !task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    // Check if the task should be displayed in calendar
    const shouldDisplayInCalendar = validatedData.calendar_type &&
      validatedData.calendar_type !== '登録なし' &&
      task.estimated_time &&
      task.estimated_time < 300 && // 5 hours
      task.scheduled_at

    if (!shouldDisplayInCalendar) {
      // Remove calendar event if it exists
      if (task.calendar_event_id) {
        const googleService = new GoogleCalendarService(user.id)
        await googleService.deleteEvent(task.calendar_event_id)

        // Update task to remove calendar reference
        await supabase
          .from('tasks')
          .update({
            calendar_event_id: null,
            calendar_type: validatedData.calendar_type || null,
            scheduled_start_time: validatedData.scheduled_start_time || null,
          })
          .eq('id', params.id)
      }

      return NextResponse.json({
        message: 'Calendar event removed (conditions not met)',
        shouldDisplay: false,
      })
    }

    // Calculate start and end time
    const startDate = new Date(task.scheduled_at)
    if (validatedData.scheduled_start_time) {
      const [hours, minutes] = validatedData.scheduled_start_time.split(':').map(Number)
      startDate.setHours(hours, minutes)
    }

    const endDate = new Date(startDate.getTime() + (task.estimated_time || 0) * 60 * 1000)

    // Get Google Calendar ID based on calendar_type
    const { data: calendars } = await supabase
      .from('user_calendars')
      .select('google_calendar_id')
      .eq('user_id', user.id)
      .eq('selected', true)

    if (!calendars || calendars.length === 0) {
      return NextResponse.json({ error: 'No calendars available' }, { status: 400 })
    }

    const googleCalendarId = calendars[0].google_calendar_id

    // Create or update Google Calendar event
    const googleService = new GoogleCalendarService(user.id)
    let calendarEventId = task.calendar_event_id

    if (calendarEventId) {
      // Update existing event
      await googleService.updateEvent(calendarEventId, {
        summary: task.title,
        description: `Task ID: ${task.id}\n${task.title}`,
        start: startDate,
        end: endDate,
        color: validatedData.calendar_type === 'Personal' ? '11' : // Blue
               validatedData.calendar_type === 'Work' ? '2' : // Green
               '5', // Purple
      })
    } else {
      // Create new event
      const event = await googleService.createEvent({
        summary: task.title,
        description: `Task ID: ${task.id}\n${task.title}`,
        start: startDate,
        end: endDate,
        calendarId: googleCalendarId,
        color: validatedData.calendar_type === 'Personal' ? '11' : // Blue
               validatedData.calendar_type === 'Work' ? '2' : // Green
               '5', // Purple
      })
      calendarEventId = event.id
    }

    // Update task with calendar reference
    const { error: updateError } = await supabase
      .from('tasks')
      .update({
        calendar_type: validatedData.calendar_type,
        scheduled_start_time: validatedData.scheduled_start_time,
        calendar_event_id: calendarEventId,
      })
      .eq('id', params.id)

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    return NextResponse.json({
      message: 'Calendar event updated successfully',
      shouldDisplay: true,
      calendarEventId,
    })

  } catch (error) {
    console.error('Calendar update error:', error)
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid input', details: error.errors }, { status: 400 })
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createServerClient()

    // Get current user
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get the task
    const { data: task, error: taskError } = await supabase
      .from('tasks')
      .select('*')
      .eq('id', params.id)
      .eq('user_id', user.id)
      .single()

    if (taskError || !task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    // Delete Google Calendar event if it exists
    if (task.calendar_event_id) {
      const googleService = new GoogleCalendarService(user.id)
      await googleService.deleteEvent(task.calendar_event_id)
    }

    // Update task to remove calendar reference
    const { error: updateError } = await supabase
      .from('tasks')
      .update({
        calendar_type: null,
        scheduled_start_time: null,
        calendar_event_id: null,
      })
      .eq('id', params.id)

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    return NextResponse.json({
      message: 'Calendar event removed successfully',
    })

  } catch (error) {
    console.error('Calendar delete error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}