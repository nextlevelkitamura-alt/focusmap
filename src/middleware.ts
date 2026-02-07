import { type NextRequest, NextResponse } from 'next/server'
import { updateSession } from '@/utils/supabase/middleware'

export async function middleware(request: NextRequest) {
    // Skip middleware for API routes and static assets to avoid timeout
    if (
        request.nextUrl.pathname.startsWith('/api') ||
        request.nextUrl.pathname.startsWith('/_next') ||
        request.nextUrl.pathname.startsWith('/static') ||
        request.nextUrl.pathname.includes('.')
    ) {
        return NextResponse.next()
    }

    try {
        return await updateSession(request)
    } catch (error) {
        // If middleware fails, let the request pass through
        // Page-level auth will handle the check
        console.error('Middleware error:', error)
        return new Response(null, { status: 200 })
    }
}

export const config = {
    matcher: [
        // Skip API routes and static files
        '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
    ],
}
