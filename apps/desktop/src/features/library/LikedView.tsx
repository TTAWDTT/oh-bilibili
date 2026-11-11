import { useAppStore } from '../../app/appStore'
import { EmptyState } from '../../shared/ui/EmptyState'
import { Icon } from '../../shared/ui/Icon'
import { PageTitle } from '../../shared/ui/PageTitle'
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
    <div className="flex h-full flex-col">
      <div className="bili-canvas flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-8 pt-6 md:px-8">
        <PageTitle
          action={
            tracks.length > 0 ? (
              <button
                type="button"
                onClick={() => void playContext(keys, 0)}
                className="bili-press flex h-8 items-center gap-2 rounded-[4px] bg-[var(--accent)] px-4 text-[14px] font-medium text-white hover:opacity-90"
              >
                <Icon name="play" size={13} />
                播放全部
              </button>
            ) : null
          }
        >
          喜欢
        </PageTitle>
        {tracks.length === 0 ? (
          <div className="pt-6">
            <EmptyState
              mascot="heart"
              icon="heart"
              title="一个红心都没点，下次一定？"
              action={{ label: '去发现', onClick: () => navigate({ kind: 'home' }) }}
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
