import { useState } from 'react'
import type { DiscoveryRegion } from '../../shared/lib/discoveryRegions'
import { Icon } from '../../shared/ui/Icon'
import { Modal } from '../../shared/ui/Modal'
import { defaultDiscoveryTabs, discoveryTabKey, type DiscoveryTab } from './discoveryTabs'
import './discovery-editor.css'

type EditorProps = {
  catalog: readonly DiscoveryRegion[]
  tabs: DiscoveryTab[]
  onSave: (tabs: DiscoveryTab[]) => void
}

export function DiscoveryChannelEditor(props: EditorProps) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className="discovery-edit-trigger" aria-label="编辑分区" title="编辑分区" onClick={() => setOpen(true)}>
        <Icon name="settings" size={16} /><span>编辑分区</span>
      </button>
      {open && <ChannelDialog {...props} onClose={() => setOpen(false)} />}
    </>
  )
}

function ChannelDialog({ catalog, tabs, onSave, onClose }: EditorProps & { onClose: () => void }) {
  const [draft, setDraft] = useState(tabs)
  const [index, setIndex] = useState(0)
  const [keyword, setKeyword] = useState('')
  const [error, setError] = useState('')
  const active = draft[index]
  const available = catalog.filter((region) => !draft.some((tab) => tab.kind === 'region' && tab.rid === region.rid))

  function add(tab: DiscoveryTab) {
    setDraft([...draft, tab])
    setIndex(draft.length)
    setError('')
  }

  function update(tab: DiscoveryTab) {
    setDraft(draft.map((entry, position) => position === index ? tab : entry))
    setError('')
  }

  function move(offset: number) {
    const next = [...draft]
    const [tab] = next.splice(index, 1)
    next.splice(index + offset, 0, tab!)
    setDraft(next)
    setIndex(index + offset)
  }

  function addKeyword() {
    const term = keyword.trim()
    if (!term) return
    const existing = draft.findIndex((tab) => tab.kind === 'keyword' && tab.keyword.trim() === term)
    if (existing >= 0) {
      setIndex(existing)
      setError('这个关键词已经添加过了')
      return
    }
    add({ kind: 'keyword', keyword: term, label: term })
    setKeyword('')
  }

  function save() {
    const next = draft.map((tab) => tab.kind === 'region'
      ? { ...tab, label: tab.label.trim() }
      : { ...tab, label: tab.label.trim(), keyword: tab.keyword.trim() })
    const issue = findInvalidTab(next)
    if (issue) {
      setIndex(issue.index)
      setError(issue.message)
      return
    }
    onSave(next)
    onClose()
  }

  return (
    <Modal open title="编辑分区" description={null} onClose={onClose} width="max-w-[560px]">
      <div className="discovery-editor">
        <section>
          <div className="discovery-editor-heading">
            <h3 id="discovery-chosen-heading">我的分区</h3>
            <div className="discovery-editor-heading-actions">
              <button type="button" disabled={draft.length === 0} onClick={() => {
                setDraft([])
                setIndex(0)
                setError('')
              }}>全部移除</button>
              <button type="button" onClick={() => {
                setDraft(defaultDiscoveryTabs(catalog))
                setIndex(0)
                setKeyword('')
                setError('')
              }}>恢复默认</button>
            </div>
          </div>
          <div className="discovery-editor-chips" role="group" aria-labelledby="discovery-chosen-heading">
            <span className="discovery-fixed-tab" title="固定显示">全部</span>
            {draft.map((tab, i) => (
              <button type="button" key={tab.kind === 'region' ? discoveryTabKey(tab) : `keyword-row:${i}`}
                title={tab.label} aria-pressed={i === index}
                onClick={() => { setIndex(i); setError('') }}>
                {tab.label || '未命名'}
              </button>
            ))}
          </div>
          {active && (
            <div className="discovery-edit-fields">
              <div className="discovery-name-row">
                <label>显示名称<input value={active.label} onChange={(event) => update({ ...active, label: event.target.value })} /></label>
                <div className="discovery-edit-actions">
                  <button type="button" aria-label="向前移动" title="向前移动" disabled={index === 0} onClick={() => move(-1)}><Icon name="chevronLeft" size={16} /></button>
                  <button type="button" aria-label="向后移动" title="向后移动" disabled={index === draft.length - 1} onClick={() => move(1)}><Icon name="chevronRight" size={16} /></button>
                  <button type="button" onClick={() => {
                    setDraft(draft.filter((_, i) => i !== index))
                    setIndex(Math.max(0, Math.min(index, draft.length - 2)))
                    setError('')
                  }}>移除</button>
                </div>
              </div>
              {active.kind === 'keyword' && (
                <label>搜索关键词<input value={active.keyword} onChange={(event) => update({ ...active, keyword: event.target.value })} /></label>
              )}
            </div>
          )}
        </section>
        {available.length > 0 && (
          <section>
            <h3>可添加的分区</h3>
            <div className="discovery-editor-chips">
              {available.map((region) => (
                <button type="button" key={region.rid} aria-label={`添加${region.name}`} onClick={() => add({ kind: 'region', rid: region.rid, label: region.name })}>
                  <Icon name="plus" size={12} />{region.name}
                </button>
              ))}
            </div>
          </section>
        )}
        <form onSubmit={(event) => { event.preventDefault(); addKeyword() }}>
          <label htmlFor="discovery-keyword">自定义兴趣</label>
          <div className="discovery-keyword-row">
            <input id="discovery-keyword" placeholder="输入感兴趣的关键词" value={keyword} onChange={(event) => setKeyword(event.target.value)} />
            <button type="submit" disabled={!keyword.trim()}>添加</button>
          </div>
        </form>
        {error && <p role="alert" className="discovery-editor-error">{error}</p>}
        <div className="discovery-editor-footer">
          <button type="button" onClick={onClose}>取消</button>
          <button type="button" className="discovery-editor-save" onClick={save}>保存</button>
        </div>
      </div>
    </Modal>
  )
}

function findInvalidTab(tabs: DiscoveryTab[]) {
  const labels = new Set(['全部'])
  const keywords = new Set<string>()
  for (const [index, tab] of tabs.entries()) {
    if (!tab.label) return { index, message: '请填写显示名称' }
    if (labels.has(tab.label)) return { index, message: '这个名称已经在分区栏里了' }
    labels.add(tab.label)
    if (tab.kind === 'region') continue
    if (!tab.keyword) return { index, message: '请填写搜索关键词' }
    if (keywords.has(tab.keyword)) return { index, message: '这个关键词已经添加过了' }
    keywords.add(tab.keyword)
  }
  return null
}
