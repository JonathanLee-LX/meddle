import '@testing-library/jest-dom'

// jsdom 不提供 ResizeObserver（Radix ScrollArea 等组件依赖），测试环境统一 polyfill
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
if (typeof globalThis.ResizeObserver === 'undefined') {
  ;(globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver = ResizeObserverStub
}
