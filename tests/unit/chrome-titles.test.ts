import { describe, expect, it } from 'vitest'
import {
  normalizeTitleDomains,
  shouldUsePdfTitle,
  titlePermissions,
} from '../../extensions/chrome/src/title-rules'

describe('Chrome PDF tab title rules', () => {
  it('normalizes domain input and rejects paths, ports and unsupported schemes', () => {
    expect(normalizeTitleDomains('ARXIV.org, https://export.arxiv.org/\n*.arxiv.org')).toEqual([
      'arxiv.org',
      'export.arxiv.org',
    ])
    for (const value of [
      'https://arxiv.org/pdf/123',
      'arxiv.org:8080',
      'file:///tmp/a',
      'example.org?token=x',
      'a..b',
    ])
      expect(() => normalizeTitleDomains(value)).toThrow()
  })

  it('matches complete domain boundaries, with explicit opt-in for all websites', () => {
    const domains = ['arxiv.org']
    for (const url of ['https://arxiv.org/pdf/123', 'http://export.arxiv.org/pdf/123'])
      expect(shouldUsePdfTitle(url, 'domains', domains)).toBe(true)
    for (const url of [
      'https://arxiv.org.evil.test/a',
      'https://notarxiv.org/a',
      'file:///tmp/a.pdf',
      'not a URL',
    ])
      expect(shouldUsePdfTitle(url, 'domains', domains)).toBe(false)
    expect(shouldUsePdfTitle('https://arxiv.org/a', 'website', domains)).toBe(false)
    expect(shouldUsePdfTitle('https://example.org/a', 'all', domains)).toBe(true)
    expect(shouldUsePdfTitle('chrome://settings', 'all', domains)).toBe(false)
  })

  it('requests only the selected optional sites, or the explicitly chosen global scope', () => {
    expect(titlePermissions('website', ['arxiv.org'])).toEqual([])
    expect(titlePermissions('domains', ['arxiv.org'])).toEqual([
      'http://*.arxiv.org/*',
      'https://*.arxiv.org/*',
    ])
    expect(titlePermissions('all', [])).toEqual(['http://*/*', 'https://*/*'])
  })
})
