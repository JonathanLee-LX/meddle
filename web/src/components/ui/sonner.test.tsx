import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const sonnerMocks = vi.hoisted(() => ({
  toaster: vi.fn(),
  success: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  dismiss: vi.fn(),
}))

vi.mock('sonner', () => ({
  Toaster: (props: unknown) => {
    sonnerMocks.toaster(props)
    return null
  },
  toast: {
    success: sonnerMocks.success,
    info: sonnerMocks.info,
    warning: sonnerMocks.warning,
    error: sonnerMocks.error,
    dismiss: sonnerMocks.dismiss,
  },
}))

vi.mock('@/components/theme-provider', () => ({
  useTheme: () => ({ resolvedTheme: 'light' }),
}))

import { Toaster } from './sonner'
import { SYSTEM_TOAST_DURATION, toast } from './toast'

describe('system toast', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses the shared position, duration, and visual contract', () => {
    render(<Toaster />)

    expect(sonnerMocks.toaster).toHaveBeenCalledWith(
      expect.objectContaining({
        position: 'bottom-right',
        duration: SYSTEM_TOAST_DURATION,
        expand: true,
        closeButton: true,
        visibleToasts: 4,
        toastOptions: expect.objectContaining({
          unstyled: true,
          classNames: expect.objectContaining({
            toast: 'system-toast',
            success: 'system-toast-success',
            info: 'system-toast-info',
            warning: 'system-toast-warning',
            error: 'system-toast-error',
          }),
        }),
      }),
    )
  })

  it.each([
    ['success', sonnerMocks.success],
    ['info', sonnerMocks.info],
    ['warning', sonnerMocks.warning],
    ['error', sonnerMocks.error],
  ] as const)('applies the shared timeout to %s notifications', (type, method) => {
    toast[type](`${type} message`)

    expect(method).toHaveBeenCalledWith(`${type} message`, {
      duration: SYSTEM_TOAST_DURATION,
    })
  })
})
