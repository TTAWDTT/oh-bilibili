import { useState } from 'react'
import type { DiscoveryRegion } from '../../shared/lib/discoveryRegions'
import { AnchoredPanel, type Anchor } from '../../shared/ui/AnchoredPanel'
import { Icon } from '../../shared/ui/Icon'
import { DiscoveryChannelEditor } from './DiscoveryChannelEditor'

const DIRECTORY_WIDTH = 560

export function DiscoveryNavigation({ catalog, tabs, selected, onSelect, onSave }: {
  catalog: DiscoveryRegion[]
  tabs: DiscoveryRegion[]
  selected: DiscoveryRegion | undefined
  onSelect: (region?: DiscoveryRegion) => void
  onSave: (tabs: DiscoveryRegion[]) => void
}) {
  const [anchor, setAnchor] = useState<Anchor | null>(null)
  const [editing, setEditing] = useState(false)
  const shortcuts = tabs.slice(0, 6)
  if (selected && !shortcuts.some((region) => region.rid === selected.rid)) shortcuts.push(selected)
  const pinned = new Set(tabs.map((region) => region.rid))
  const others = catalog.filter((region) => !pinned.has(region.rid))

  function closeDirectory() {
    anchor?.trigger?.focus({ preventScroll: true })
    setAnchor(null)
  }

  function regionGrid(regions: DiscoveryRegion[]) {
    return <div className="discovery-directory-grid">
      {regions.map((region) => (
        <button key={region.rid} type="button" aria-pressed={region.rid === selected?.rid}
          onClick={() => { closeDirectory(); onSelect(region) }}>
          {region.name}
        </button>
      ))}
    </div>
  }

  return (
    <>
      <nav aria-label="发现分区" className="discovery-channels">
        <button type="button" className="discovery-directory-trigger" aria-haspopup="dialog" aria-expanded={!!anchor}
          onClick={(event) => {
            if (anchor) { setAnchor(null); return }
            const trigger = event.currentTarget
            const rect = trigger.getBoundingClientRect()
            setAnchor({ trigger, left: Math.max(8, Math.min(rect.left, window.innerWidth - DIRECTORY_WIDTH - 8)),
              top: rect.bottom + 6, anchorTop: rect.top })
          }}>
          全部分区<Icon name="chevronRight" size={12} />
        </button>
        <div className="discovery-shortcut-list">
          <button type="button" aria-pressed={!selected} onClick={() => onSelect()}>全部</button>
          {shortcuts.map((region) => (
            <button type="button" key={region.rid} aria-pressed={region.rid === selected?.rid}
              onClick={() => onSelect(region)}>
              {region.name}
            </button>
          ))}
        </div>
      </nav>
      <AnchoredPanel anchor={anchor} onClose={() => setAnchor(null)} label="全部分区" width={DIRECTORY_WIDTH}>
        <div className="discovery-directory">
          <div className="discovery-directory-head">
            <h2>{tabs.length ? '常用分区' : '全部分区'}</h2>
            <button type="button" onClick={() => { closeDirectory(); setEditing(true) }}>
              <Icon name="settings" size={14} />编辑常用
            </button>
          </div>
          {tabs.length > 0 && regionGrid(tabs)}
          {tabs.length > 0 && others.length > 0 && <h2>更多分区</h2>}
          {others.length > 0 && regionGrid(others)}
        </div>
      </AnchoredPanel>
      <DiscoveryChannelEditor catalog={catalog} tabs={tabs} open={editing} onOpenChange={setEditing} onSave={onSave} />
    </>
  )
}
