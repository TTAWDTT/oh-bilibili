import type { IconName } from '../ui/Icon'

export type HotChannel = 'ranking' | 'popular' | 'precious' | 'weekly'

/** 左栏和窄窗频道选择器共用这一组名称与顺序。 */
export const HOT_CHANNELS: { view: HotChannel; label: string; icon: IconName }[] = [
  { view: 'ranking', label: '排行榜', icon: 'rank' },
  { view: 'popular', label: '综合热门', icon: 'flame' },
  { view: 'precious', label: '入站必刷', icon: 'gift' },
  { view: 'weekly', label: '每周必看', icon: 'calendar' },
]
