import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { SpaceProjectSwitcher } from './space-project-switcher'
import type { Project, Space } from '@/types/database'
import type { ReactNode } from 'react'

vi.mock('@/components/ui/popover', () => ({
  Popover: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

const spaces = [
  {
    id: 'space-private',
    title: 'Private',
    user_id: 'user-1',
    color: null,
    created_at: '2026-06-01T00:00:00.000Z',
    updated_at: '2026-06-01T00:00:00.000Z',
  },
  {
    id: 'space-work',
    title: '仕事',
    user_id: 'user-1',
    color: null,
    created_at: '2026-06-01T00:00:00.000Z',
    updated_at: '2026-06-01T00:00:00.000Z',
  },
] as Space[]

const projects = [
  {
    id: 'project-work',
    title: '仕事プロジェクト',
    user_id: 'user-1',
    space_id: 'space-work',
    status: 'active',
    color_theme: '#ef4444',
    created_at: '2026-06-01T00:00:00.000Z',
    updated_at: '2026-06-01T00:00:00.000Z',
  },
] as Project[]

describe('SpaceProjectSwitcher', () => {
  test('プロジェクト選択ではスペース選択を変更しない', () => {
    const onSelectSpace = vi.fn()
    const onSelectProject = vi.fn()

    render(
      <SpaceProjectSwitcher
        spaces={spaces}
        projects={projects}
        selectedSpaceId={null}
        selectedProjectId={null}
        onSelectSpace={onSelectSpace}
        onSelectProject={onSelectProject}
        showAllProjectsOption
      />,
    )

    const projectButton = screen.getByText('仕事プロジェクト').closest('button')
    expect(projectButton).not.toBeNull()

    fireEvent.click(projectButton!)

    expect(onSelectProject).toHaveBeenCalledWith('project-work')
    expect(onSelectSpace).not.toHaveBeenCalled()
  })
})
