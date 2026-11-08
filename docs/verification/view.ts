const LABEL: Record<string, string> = {
  idle: '空闲',
  loading: '取流中',
  playing: '播放中',
  paused: '已暂停',
  ready: '已就绪',
  ended: '播完',
  faulted: '取流失败',
}
export const title = '播放器状态机'
export const state = (v: { phase: string }) => LABEL[v.phase] ?? v.phase
export const group = (v: { phase: string }) =>
  ['playing', 'paused', 'ready'].includes(v.phase) ? '持有音源' : '无音源'
export const colors: Record<string, string> = { '持有音源': 'teal', '无音源': 'tan' }
export const step = (action: string) => {
  const m: Record<string, string> = {
    YouPressPlay: '你按下播放',
    StreamArrives: '音源到了',
    StaleArrives: '旧的音源晚到，被丢弃',
    StreamFails: '取流失败',
    Tick: '播放推进',
    YouPause: '你按下暂停',
    YouResume: '你按下继续',
    YouStop: '你按下停止',
    TrackEnds: '这首播完',
    Done: '停在这里',
  }
  return m[action] ?? null
}
