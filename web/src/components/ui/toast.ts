import { toast as sonnerToast, type ExternalToast } from 'sonner'

const SYSTEM_TOAST_DURATION = 3000

type SystemToastOptions = Omit<ExternalToast, 'duration'>
type SystemToastMessage = React.ReactNode

function withSystemDefaults(options?: SystemToastOptions): ExternalToast {
  return {
    ...options,
    duration: SYSTEM_TOAST_DURATION,
  }
}

const toast = {
  success(message: SystemToastMessage, options?: SystemToastOptions) {
    return sonnerToast.success(message, withSystemDefaults(options))
  },
  info(message: SystemToastMessage, options?: SystemToastOptions) {
    return sonnerToast.info(message, withSystemDefaults(options))
  },
  warning(message: SystemToastMessage, options?: SystemToastOptions) {
    return sonnerToast.warning(message, withSystemDefaults(options))
  },
  error(message: SystemToastMessage, options?: SystemToastOptions) {
    return sonnerToast.error(message, withSystemDefaults(options))
  },
  dismiss: sonnerToast.dismiss,
}

export { SYSTEM_TOAST_DURATION, toast }
