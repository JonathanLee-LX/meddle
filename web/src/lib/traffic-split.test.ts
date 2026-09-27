import { afterEach, describe, expect, it } from 'vitest'
import {
  TRAFFIC_SPLIT_DEFAULT_PCT,
  TRAFFIC_SPLIT_MAX_PCT,
  TRAFFIC_SPLIT_MIN_PCT,
  TRAFFIC_SPLIT_STORAGE_KEY,
  clampTrafficSplitPct,
  loadTrafficSplitPct,
  pctFromPointer,
  saveTrafficSplitPct,
} from './traffic-split'

afterEach(() => {
  localStorage.removeItem(TRAFFIC_SPLIT_STORAGE_KEY)
})

describe('traffic-split width memory', () => {
  it('defaults to ~60% and clamps to [35, 75]', () => {
    expect(TRAFFIC_SPLIT_DEFAULT_PCT).toBe(60)
    expect(clampTrafficSplitPct(10)).toBe(TRAFFIC_SPLIT_MIN_PCT)
    expect(clampTrafficSplitPct(99)).toBe(TRAFFIC_SPLIT_MAX_PCT)
    expect(clampTrafficSplitPct(55.4)).toBe(55)
    expect(clampTrafficSplitPct(Number.NaN)).toBe(TRAFFIC_SPLIT_DEFAULT_PCT)
  })

  it('persists and restores width via localStorage', () => {
    expect(loadTrafficSplitPct()).toBe(TRAFFIC_SPLIT_DEFAULT_PCT)
    expect(saveTrafficSplitPct(48)).toBe(48)
    expect(localStorage.getItem(TRAFFIC_SPLIT_STORAGE_KEY)).toBe('48')
    expect(loadTrafficSplitPct()).toBe(48)
  })

  it('maps pointer x to percentage inside the container', () => {
    expect(pctFromPointer(600, 0, 1000)).toBe(60)
    expect(pctFromPointer(100, 0, 1000)).toBe(TRAFFIC_SPLIT_MIN_PCT)
    expect(pctFromPointer(900, 0, 1000)).toBe(TRAFFIC_SPLIT_MAX_PCT)
  })
})
