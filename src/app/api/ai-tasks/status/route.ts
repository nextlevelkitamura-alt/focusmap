import { NextResponse } from 'next/server'
import { execSync } from 'child_process'

// GET /api/ai-tasks/status — task-runner / claude の稼働状態確認
export async function GET() {
  const status = {
    claudeInstalled: false,
    taskRunnerInstalled: false,
    nodeInstalled: false,
  }

  try {
    execSync('which claude', { stdio: 'ignore' })
    status.claudeInstalled = true
  } catch { /* not found */ }

  try {
    const result = execSync('launchctl list 2>/dev/null | grep focusmap', { encoding: 'utf-8' })
    status.taskRunnerInstalled = result.includes('com.focusmap.task-runner')
  } catch { /* not loaded */ }

  try {
    execSync('which node', { stdio: 'ignore' })
    status.nodeInstalled = true
  } catch { /* not found */ }

  return NextResponse.json(status)
}
