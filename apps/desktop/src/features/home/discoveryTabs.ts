import { useEffect, useMemo, useState } from 'react'
import type { DiscoveryRegion } from '../../shared/lib/discoveryRegions'

const STORAGE_KEY = 'bili.discovery.tabs'
const DEFAULT_REGION_IDS = [1005, 1008, 1003, 1004, 1010, 1012]

export function discoveryTabKey(tab: DiscoveryRegion): string {
  return `region:${tab.rid}`
}

export function defaultDiscoveryTabs(catalog: readonly DiscoveryRegion[]) {
  return DEFAULT_REGION_IDS.flatMap((rid) => catalog.find((region) => region.rid === rid) ?? [])
}

export function useDiscoveryTabs(catalog: readonly DiscoveryRegion[]) {
  const [saved, setSaved] = useState(readRegionIds)
  const tabs = useMemo(() => {
    if (saved === null) return defaultDiscoveryTabs(catalog)
    return saved.flatMap((rid) => catalog.find((region) => region.rid === rid) ?? [])
  }, [catalog, saved])

  useEffect(() => {
    try {
      if (saved === null) localStorage.removeItem(STORAGE_KEY)
      else localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 2, regionIds: saved }))
    } catch {
      // 存储不可用时仍可调整本次打开的分区。
    }
  }, [saved])

  function saveTabs(next: DiscoveryRegion[]) {
    const defaults = defaultDiscoveryTabs(catalog)
    const isDefault = next.length === defaults.length && next.every((tab, i) => tab.rid === defaults[i]?.rid)
    setSaved(isDefault ? null : next.map((tab) => tab.rid))
  }

  return { tabs, saveTabs }
}

function readRegionIds(): number[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return null
    const value: unknown = JSON.parse(raw)
    if (Array.isArray(value)) {
      const ids = new Set<number>()
      for (const item of value) {
        if (item?.kind === 'region' && isRegionId(item.rid)) ids.add(item.rid)
      }
      return [...ids]
    }
    if (value && typeof value === 'object' && 'version' in value && value.version === 2
      && 'regionIds' in value && Array.isArray(value.regionIds) && value.regionIds.every(isRegionId)) {
      return [...new Set(value.regionIds)]
    }
    return null
  } catch {
    return null
  }
}

function isRegionId(id: unknown): id is number {
  return typeof id === 'number' && Number.isInteger(id) && id > 0
}
