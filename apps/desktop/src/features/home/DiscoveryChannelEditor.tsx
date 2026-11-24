import { useState, type MouseEvent } from 'react'
import type { DiscoveryRegion } from '../../shared/lib/discoveryRegions'
import { Icon, type IconName } from '../../shared/ui/Icon'
import { Modal } from '../../shared/ui/Modal'
import { defaultDiscoveryTabs } from './discoveryTabs'
import './discovery-editor.css'

type EditorProps = {
  catalog: readonly DiscoveryRegion[]
  tabs: DiscoveryRegion[]
  onSave: (tabs: DiscoveryRegion[]) => void
  onOpenChange: (open: boolean) => void
}

export function DiscoveryChannelEditor({ open, ...props }: EditorProps & { open: boolean }) {
  return open ? <ChannelDialog {...props} /> : null
}

function ChannelDialog({ catalog, tabs, onSave, onOpenChange }: EditorProps) {
  const [draft, setDraft] = useState(tabs)
  const available = catalog.filter((region) => !draft.some((tab) => tab.rid === region.rid))
  function edit(event: MouseEvent<HTMLButtonElement>, next: DiscoveryRegion[], focusRegion: DiscoveryRegion) {
    setDraft(next)
    if (event.detail !== 0) return
    const button = event.currentTarget
    // 键盘操作可能移除当前按钮，或把它移动到首尾后禁用。
    requestAnimationFrame(() => {
      if (button.isConnected && !button.disabled) button.focus()
      else document.getElementById(`discovery-toggle-${focusRegion.rid}`)?.focus()
    })
  }

  function move(event: MouseEvent<HTMLButtonElement>, index: number, offset: number) {
    const next = [...draft]
    next.splice(index + offset, 0, ...next.splice(index, 1))
    edit(event, next, draft[index]!)
  }

  return (
    <Modal open title="编辑常用" description={null} onClose={() => onOpenChange(false)} width="max-w-[600px]">
      <div className="discovery-editor">
        <section>
          <div className="discovery-editor-heading">
            <h3 id="discovery-chosen-heading">常用分区</h3>
            <div className="discovery-editor-heading-actions">
              <button type="button" disabled={draft.length === 0} onClick={(event) => edit(event, [], draft[0]!)}>全部移除</button>
              <button type="button" onClick={() => setDraft(defaultDiscoveryTabs(catalog))}>恢复默认</button>
            </div>
          </div>
          {draft.length > 0 ? (
            <ol className="discovery-editor-chosen" aria-labelledby="discovery-chosen-heading">
              {draft.map((region, i) => (
                <li key={region.rid}>
                  <span>{region.name}</span>
                  <RegionAction label={`前移${region.name}`} icon="chevronLeft" disabled={i === 0} onClick={(event) => move(event, i, -1)} />
                  <RegionAction label={`后移${region.name}`} icon="chevronRight" disabled={i === draft.length - 1} onClick={(event) => move(event, i, 1)} />
                  <RegionAction label={`移除${region.name}`} icon="close" id={`discovery-toggle-${region.rid}`}
                    onClick={(event) => edit(event, draft.filter((tab) => tab.rid !== region.rid), draft[i + 1] ?? draft[i - 1] ?? region)} />
                </li>
              ))}
            </ol>
          ) : <p className="discovery-editor-empty">还没有常用分区</p>}
        </section>
        {available.length > 0 && (
          <section>
            <h3 id="discovery-available-heading">可添加的分区</h3>
            <div className="discovery-editor-available" role="group" aria-labelledby="discovery-available-heading">
              {available.map((region, i) => (
                <button type="button" key={region.rid} aria-label={`添加${region.name}`} id={`discovery-toggle-${region.rid}`}
                  onClick={(event) => edit(event, [...draft, region], available[i + 1] ?? available[i - 1] ?? region)}>
                  <Icon name="plus" size={13} />{region.name}
                </button>
              ))}
            </div>
          </section>
        )}
        <div className="discovery-editor-footer">
          <button type="button" onClick={() => onOpenChange(false)}>取消</button>
          <button type="button" className="discovery-editor-save" onClick={() => {
            onSave(draft)
            onOpenChange(false)
          }}>保存</button>
        </div>
      </div>
    </Modal>
  )
}

function RegionAction({ label, icon, id, disabled, onClick }: {
  label: string
  icon: IconName
  id?: string
  disabled?: boolean
  onClick: (event: MouseEvent<HTMLButtonElement>) => void
}) {
  return (
    <button type="button" id={id} aria-label={label} title={label} disabled={disabled} onClick={onClick}>
      <Icon name={icon} size={14} />
    </button>
  )
}
