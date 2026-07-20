import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
  XIcon,
} from 'lucide-react'
import { Toaster as Sonner, type ToasterProps } from 'sonner'

import { useTheme } from '@/components/theme-provider'
import { SYSTEM_TOAST_DURATION } from '@/components/ui/toast'

function Toaster({
  position = 'bottom-right',
  duration = SYSTEM_TOAST_DURATION,
  ...props
}: ToasterProps) {
  const { resolvedTheme } = useTheme()

  return (
    <Sonner
      theme={resolvedTheme}
      position={position}
      duration={duration}
      expand
      closeButton
      gap={10}
      visibleToasts={4}
      offset={16}
      mobileOffset={12}
      swipeDirections={['right']}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
        close: <XIcon className="size-3" />,
      }}
      toastOptions={{
        unstyled: true,
        closeButtonAriaLabel: '关闭通知',
        style: {
          '--system-toast-duration': `${SYSTEM_TOAST_DURATION}ms`,
        } as React.CSSProperties,
        classNames: {
          toast: 'system-toast',
          content: 'system-toast-content',
          title: 'system-toast-title',
          description: 'system-toast-description',
          icon: 'system-toast-icon',
          closeButton: 'system-toast-close',
          actionButton: 'system-toast-action',
          cancelButton: 'system-toast-cancel',
          success: 'system-toast-success',
          info: 'system-toast-info',
          warning: 'system-toast-warning',
          error: 'system-toast-error',
          loading: 'system-toast-loading',
          default: 'system-toast-default',
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
