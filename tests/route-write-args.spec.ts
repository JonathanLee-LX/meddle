import { describe, expect, it } from 'vitest'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const args = require('../bin/lib/route-write-args')

describe('route write args (issue #149)', () => {
  it('treats --exclusions= as a clear and --exclusions=/a,/b as a replacement', () => {
    expect(args.parseRouteWriteArgs(['dev', 'api.example.com', '--exclusions='])).toMatchObject({
      exclusions: [],
      positional: ['dev', 'api.example.com'],
    })
    expect(args.parseRouteWriteArgs(['--exclusions=/a,/b', 'dev', 'host'])).toMatchObject({
      exclusions: ['/a', '/b'],
    })
    expect(args.parseRouteWriteArgs(['--exclusions=!/a,!/b'])).toMatchObject({ exclusions: ['/a', '/b'] })
    expect(args.parseRouteWriteArgs(['--exclusions=/a /b'])).toMatchObject({ exclusions: ['/a', '/b'] })
    expect(args.parseRouteWriteArgs(['dev', 'host', '--json'])).toMatchObject({ json: true, exclusions: undefined })
  })

  it('rejects syntax that used to succeed without clearing', () => {
    expect(() => args.parseRouteWriteArgs(['--exclusions'])).toThrow(/--exclusions=/)
    expect(() => args.parseRouteWriteArgs(['--exclusions='])).not.toThrow()
    expect(() => args.parseRouteWriteArgs(['--exclusions=/a,,/b'])).toThrow(/empty entry/)
    expect(() => args.parseRouteWriteArgs(['--exclusions=!'])).toThrow(/needs a path/)
    expect(() => args.parseRouteWriteArgs(['--exclusions=', '--exclusions=/a'])).toThrow(/more than once/)
    expect(() => args.parseRouteWriteArgs(['--nope'])).toThrow(/Unsupported option/)
    expect(() => args.parseRouteWriteArgs(['--exclusions='], { allowExclusions: false })).toThrow(/does not change exclusions/)
    expect(() => args.parsePatternArg('api.example.com !')).toThrow(/--exclusions=/)
    expect(() => args.resolveExclusions(['/a'], [])).toThrow(/not both/)
    expect(args.resolveExclusions([], [])).toEqual({ explicit: true, exclusions: [] })
    expect(args.resolveExclusions([], undefined)).toEqual({ explicit: false, exclusions: undefined })
    expect(args.resolveExclusions(['/health'], undefined)).toEqual({ explicit: true, exclusions: ['/health'] })
  })
})
