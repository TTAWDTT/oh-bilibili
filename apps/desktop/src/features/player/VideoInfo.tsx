import { useEffect, useState } from 'react'
import * as ipc from '../../shared/lib/ipc'
import type { VideoMeta } from '../../shared/lib/contract'
import { Icon } from '../../shared/ui/Icon'

function formatCount(n: number): string {
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(1)}亿`
  if (n >= 10_000) return `${(n / 10_000).toFixed(1)}万`
  return String(n)
}

/**
 * 视频详情。B 站视频页右侧那栏：简介、发布时间、播放/弹幕/点赞/投币/收藏/分享。
 *
 * 全部来自 view 接口的 stat 与 desc 字段，不是估算。
 */
export function VideoInfo({ trackKey }: { trackKey: string }) {
  const [meta, setMeta] = useState<VideoMeta | null>(null)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    let cancelled = false
    setMeta(null)
    void ipc
      .videoMeta(trackKey)
      .then((m) => {
        if (!cancelled) setMeta(m)
      })
      .catch(() => setMeta(null))
    return () => {
      cancelled = true
    }
  }, [trackKey])

  if (!meta) return null

  const date = meta.pubdate ? new Date(meta.pubdate * 1000).toLocaleDateString('zh-CN') : ''

  return (
    <section className="mt-6 w-full max-w-[560px] rounded-[6px] border border-white/12 bg-black/30 p-4 text-left">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-white/55">
        <Stat icon="play" value={meta.views} label="播放" />
        <Stat icon="queue" value={meta.danmaku} label="弹幕" />
        <Stat icon="heart" value={meta.likes} label="点赞" />
        <Stat icon="coin" value={meta.coins} label="投币" />
        <Stat icon="bookmark" value={meta.favorites} label="收藏" />
        <Stat icon="copy" value={meta.shares} label="分享" />
        {date ? <span className="num text-white/40">{date}</span> : null}
      </div>

      {meta.desc ? (
        <>
          <p
            className={[
              'mt-3 whitespace-pre-wrap text-[12.5px] leading-relaxed text-white/70',
              expanded ? '' : 'line-clamp-2',
            ].join(' ')}
          >
            {meta.desc}
          </p>
          {meta.desc.length > 60 ? (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-1 text-[13px] text-white/45 hover:text-white"
            >
              {expanded ? '收起' : '展开简介'}
            </button>
          ) : null}
        </>
      ) : null}
    </section>
  )
}

function Stat({ icon, value, label }: { icon: 'play' | 'queue' | 'heart' | 'coin' | 'bookmark' | 'copy'; value: number; label: string }) {
  return (
    <span className="flex items-center gap-1" title={`${label} ${formatCount(value)}`}>
      <Icon name={icon} size={11} />
      <span className="num">{formatCount(value)}</span>
    </span>
  )
}
