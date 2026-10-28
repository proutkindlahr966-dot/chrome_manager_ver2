/** Thư mục bổ sung khi ổ chứa hồ sơ cũ hết chỗ. */
export const SUGGESTED_EXTRA_PROFILES_ROOT = 'F:\\CODE\\chrome_manager_new'

export function normalizeRootPath(value: string | null | undefined): string {
  return (value ?? '').trim().replace(/[/\\]+$/, '')
}

export function uniqueRootPaths(paths: Array<string | null | undefined>): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of paths) {
    const next = normalizeRootPath(raw)
    if (!next) continue
    const key = next.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(next)
  }
  return out
}

export function collectProfilesRoots(settings: {
  profilesRoot?: string | null
  additionalProfilesRoots?: string[] | null
  createProfilesRoot?: string | null
}): string[] {
  return uniqueRootPaths([
    settings.profilesRoot,
    ...(settings.additionalProfilesRoots ?? []),
    settings.createProfilesRoot
  ])
}

export function resolveCreateProfilesRoot(settings: {
  profilesRoot?: string | null
  additionalProfilesRoots?: string[] | null
  createProfilesRoot?: string | null
}): string {
  const roots = collectProfilesRoots(settings)
  const wanted = normalizeRootPath(settings.createProfilesRoot)
  if (wanted) {
    const match = roots.find((root) => root.toLowerCase() === wanted.toLowerCase())
    if (match) return match
  }
  return roots[0] ?? ''
}

export function matchProfilesRoot(dataDir: string, roots: string[]): string | null {
  const dir = normalizeRootPath(dataDir).toLowerCase()
  if (!dir) return null
  let best: string | null = null
  for (const root of roots) {
    const prefix = normalizeRootPath(root).toLowerCase()
    if (!prefix) continue
    if (dir === prefix || dir.startsWith(`${prefix}\\`) || dir.startsWith(`${prefix}/`)) {
      if (!best || root.length > best.length) best = root
    }
  }
  return best
}

export function storageDriveLabel(dataDir: string | null | undefined): string {
  const match = normalizeRootPath(dataDir).match(/^([A-Za-z]:)/)
  return match ? match[1].toUpperCase() : ''
}
