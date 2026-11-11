import { describe, expect, it } from 'vitest'
import { productionCSP, validateArguments } from '../../src/main/security'

describe('native request validation', () => {
  it('checks handles and argument shapes at runtime', () => {
    for (const value of [null, {}, 42, '../paper.pdf', 'a'.repeat(33)])
      expect(() => validateArguments('read-document', [value])).toThrow()
    expect(() => validateArguments('reopen', ['a'.repeat(32)])).not.toThrow()
    expect(() => validateArguments('open-dropped', [[4]])).toThrow()
    expect(() => validateArguments('restart', ['true'])).toThrow()
    expect(() => validateArguments('print', ['extra'])).toThrow()
    expect(() => validateArguments('watch-documents', [[{ id: '../file.pdf' }]])).toThrow()
    expect(() =>
      validateArguments('watch-documents', [[{ id: 'a'.repeat(32), revision: {} }]]),
    ).toThrow()
    expect(() =>
      validateArguments('watch-documents', [Array(101).fill({ id: 'a'.repeat(32) })]),
    ).toThrow()
    expect(() =>
      validateArguments('watch-documents', [[{ id: 'a'.repeat(32), revision: '1:2:3' }]]),
    ).not.toThrow()
    expect(() => validateArguments('open-external', ['x'.repeat(8193)])).toThrow()
  })
  it('restricts production connections and workers to packaged assets', () => {
    expect(productionCSP).toContain("connect-src 'self';")
    expect(productionCSP).toContain("worker-src 'self';")
    expect(productionCSP).not.toMatch(
      /localhost|127\.0\.0\.1|ws:|'unsafe-eval'|worker-src[^;]*blob:/,
    )
  })
})
