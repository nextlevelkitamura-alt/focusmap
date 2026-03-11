import { NextResponse } from 'next/server'

export function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  }
}

export function apiSuccess(data: unknown, status = 200) {
  return NextResponse.json(
    { success: true, data },
    { status, headers: corsHeaders() },
  )
}

export function apiError(code: string, message: string, status = 400) {
  return NextResponse.json(
    { success: false, error: { code, message } },
    { status, headers: corsHeaders() },
  )
}

export function handleCors() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() })
}
