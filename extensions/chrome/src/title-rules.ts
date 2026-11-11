export type TitleMode = 'website' | 'domains' | 'all'

export function normalizeTitleDomains(input: string): string[] {
  const domains = input
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((entry) => {
      const value = entry.replace(/^\*\./, '')
      let url: URL
      try {
        url = new URL(value.includes('://') ? value : `https://${value}`)
      } catch {
        throw new Error(`Invalid domain: ${entry}`)
      }
      const host = url.hostname.toLowerCase().replace(/\.$/, '')
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.port ||
        url.username ||
        url.password ||
        url.pathname !== '/' ||
        url.search ||
        url.hash ||
        host.length > 253 ||
        !/^[a-z0-9]+(?:[a-z0-9.-]*[a-z0-9])?$/.test(host) ||
        host.includes('..')
      )
        throw new Error(`Enter a domain without a path or port: ${entry}`)
      return host
    })
  if (domains.length > 100) throw new Error('Use at most 100 domains.')
  return [...new Set(domains)]
}

export function shouldUsePdfTitle(url: string, mode: TitleMode, domains: string[]): boolean {
  try {
    const parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol) || mode === 'website') return false
    const host = parsed.hostname.toLowerCase().replace(/\.$/, '')
    return (
      mode === 'all' || domains.some((domain) => host === domain || host.endsWith(`.${domain}`))
    )
  } catch {
    return false
  }
}

export function titlePermissions(mode: TitleMode, domains: string[]): string[] {
  if (mode === 'website') return []
  if (mode === 'all') return ['http://*/*', 'https://*/*']
  return domains.flatMap((domain) =>
    ['http:', 'https:'].map(
      (scheme) =>
        `${scheme}//${/^[\d.]+$/.test(domain) || domain === 'localhost' ? domain : `*.${domain}`}/*`,
    ),
  )
}
