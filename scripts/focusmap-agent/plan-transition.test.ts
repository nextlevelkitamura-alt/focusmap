import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { mkdtemp } from 'node:fs/promises'
import { afterEach, describe, expect, test } from 'vitest'
import { executePlanTransition } from './src/executors/plan-transition'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('typed plan_transition', () => {
  test('dry-run→commit→plansyncの順に実行し、移動先をreadbackする', async () => {
    const root = await mkdtemp(join(homedir(), '.focusmap-plan-transition-test-'))
    roots.push(root)
    const source = join(root, 'personal-os', 'my-brain', 'areas', 'test', 'plans', 'planning', 'plan-a')
    const target = join(root, 'personal-os', 'my-brain', 'areas', 'test', 'plans', 'active', 'plan-a')
    const ops = join(root, 'personal-os', 'AIエージェント基盤', 'skills', 'plan-ops')
    await mkdir(source, { recursive: true })
    await mkdir(join(ops, 'scripts'), { recursive: true })
    await writeFile(join(source, 'plan.md'), '# Plan A\n')
    await writeFile(join(ops, 'scripts', 'bucketctl.sh'), '#!/bin/sh\n')
    await writeFile(join(ops, 'scripts', 'plansync.py'), '')
    const calls: string[][] = []
    const runner = async (executable: string, args: string[]) => {
      calls.push([executable, ...args])
      if (args.includes('--commit')) {
        await mkdir(join(target, '..'), { recursive: true })
        await rename(source, target)
      }
      return { stdout: '', stderr: '', exitCode: 0 }
    }

    const result = await executePlanTransition({
      plan_path: 'personal-os/my-brain/areas/test/plans/planning/plan-a/plan.md',
      expected_bucket: 'planning',
      target_bucket: 'active',
    }, {
      hostname: 'test',
      agent_token: 'test',
      private_root: root,
      plan_ops_root: ops,
    }, runner)

    expect(result).toMatchObject({ bucket: 'active', previous_bucket: 'planning', committed: true, synced: true })
    expect(calls).toHaveLength(3)
    expect(calls[0]).not.toContain('--commit')
    expect(calls[1]).toContain('--commit')
    expect(calls[2]).toContain('--apply')
  })

  test('画面で見たbucketから変わっていたら実行しない', async () => {
    const root = await mkdtemp(join(homedir(), '.focusmap-plan-transition-test-'))
    roots.push(root)
    const source = join(root, 'personal-os', 'my-brain', 'areas', 'test', 'plans', 'active', 'plan-a')
    await mkdir(source, { recursive: true })
    await writeFile(join(source, 'plan.md'), '# Plan A\n')
    await expect(executePlanTransition({
      plan_path: source,
      expected_bucket: 'planning',
      target_bucket: 'active',
    }, { hostname: 'test', agent_token: 'test', private_root: root }, async () => {
      throw new Error('must not execute')
    })).rejects.toThrow('plan bucket changed')
  })
})
