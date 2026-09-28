import type { MockRule } from '@/types'

/** Traffic → Mock one-click create opens the in-page editor (modules/02-mock). */
export const MOCK_OPEN_CREATE_EVENT = 'mock-config:open-create'

export interface MockOpenCreateDetail {
  initialData?: Partial<MockRule>
}
