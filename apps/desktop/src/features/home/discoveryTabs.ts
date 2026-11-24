import { useMemo, useState } from 'react'
import type { DiscoveryRegion } from '../../shared/lib/discoveryRegions'

export type DiscoveryTab =
  | { kind: 'region'; rid: number; label: string }
  | { kind: 'keyword'; keyword: string; label: string }

const STORAGE_KEY = 'bili.discovery.tabs'

export function discoveryTabKey(tab: DiscoveryTab): string {
  return tab.kind === 'region' ? `region:${tab.rid}` : `keyword:${tab.keyword}`
}

export function defaultDiscoveryTabs(catalog: readonly DiscoveryRegion[]): DiscoveryTab[] {
  return catalog.map(({ rid, name }) => ({ kind: 'region', rid, label: name }))
}

function readSavedTabs(): DiscoveryTab[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return null
    const rows: unknown = JSON.parse(raw)
    if (!Array.isArray(rows)) return null
    const tabs: DiscoveryTab[] = []
    const seen = new Set<string>()
    for (const row of rows) {
      if (!row || typeof row.label !== 'string' || !row.label.trim()) continue
      const label = row.label.trim()
      let tab: DiscoveryTab
      if (row.kind === 'region' && Number.isInteger(row.rid) && row.rid > 0) {
        tab = { kind: 'region', rid: row.rid, label }
      } else if (row.kind === 'keyword' && typeof row.keyword === 'string' && row.keyword.trim()) {
        tab = { kind: 'keyword', keyword: row.keyword.trim(), label }
      } else {
        continue
      }
      const key = discoveryTabKey(tab)
      if (!seen.has(key)) tabs.push(tab)
      seen.add(key)
    }
    return tabs
  } catch {
    return null
  }
}

export function useDiscoveryTabs(catalog: readonly DiscoveryRegion[]) {
  const [saved, setSaved] = useState(readSavedTabs)
  const tabs = useMemo(() => saved
    ? saved.filter((tab) => tab.kind === 'keyword' || catalog.some((region) => region.rid === tab.rid))
    : defaultDiscoveryTabs(catalog), [catalog, saved])

  function saveTabs(next: DiscoveryTab[]) {
    const isDefault = next.length === catalog.length && next.every((tab, index) =>
      tab.kind === 'region' && tab.rid === catalog[index]?.rid && tab.label === catalog[index]?.name)
    setSaved(isDefault ? null : next)
    try {
      if (isDefault) localStorage.removeItem(STORAGE_KEY)
      else localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch {
      // 存储不可用时，本次打开的分区栏仍可编辑。
    }
  }

  return { tabs, saveTabs }
}
