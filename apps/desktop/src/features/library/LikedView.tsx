import { useAppStore } from '../../app/appStore'
import { EmptyState } from '../../shared/ui/EmptyState'
import { Icon } from '../../shared/ui/Icon'
import { PageHeader } from '../../shared/ui/PageHeader'
import { usePlayerStore } from '../player/playerStore'
import { useReactionStore } from '../reactions/reactionStore'
import { TrackList } from '../tracks/TrackList'

export function LikedView() {
  const tracks = useReactionStore((state) => state.likedTracks)
  const navigate = useAppStore((state) => state.navigate)
  const playContext = usePlayerStore((state) => state.playContext)
  const snapshot = usePlayerStore((state) => state.snapshot)
  const keys = tracks.map((track) => track.key)
  const activeKey = snapshot?.track?.key ?? null
  const playing = snapshot?.phase === 'playing'

  return (
    <div className="flex h-full max-w-[1040px] flex-col px-8 pb-8 pt-8">
      <PageHeader
        eyebrow="喜欢"
        title="红心"
        subtitle="红心先落本机，登录后统一同步到 B 站账号；这里显示本机已知的喜欢。"
        actions={
          tracks.length > 0 ? (
            <button
              type="button"
              onClick={() => void playContext(keys, 0)}
              className="t press flex items-center gap-2 rounded-full bg-white px-4 py-2 text-[12px] font-medium text-black hover:bg-white/88"
            >
              <Icon name="play" size={13} />
              播放全部
            </button>
          ) : null
        }
      />

      <div className="mt-6 flex min-h-0 flex-1 flex-col overflow-y-auto">
        {tracks.length === 0 ? (
          <div className="flex flex-1 items-center justify-center">
            <EmptyState
              icon="heart"
              title="还没有喜欢的歌"
              detail="在任意歌曲上点一下红心，它会出现在这里。"
              action={{ label: '去搜索', onClick: () => navigate({ kind: 'search' }) }}
            />
          </div>
        ) : (
          <TrackList
            tracks={tracks}
            activeKey={activeKey}
            playing={playing}
            onPlay={(index) => void playContext(keys, index)}
          />
        )}
      </div>
    </div>
  )
}
