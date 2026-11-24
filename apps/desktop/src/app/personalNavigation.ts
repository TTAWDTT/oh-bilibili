export const PERSONAL_NAV = {
  profile: { view: { kind: 'profile' }, label: '个人中心', icon: 'profileBadge' },
  history: { view: { kind: 'history' }, label: '历史', icon: 'historyClock' },
  favs: { view: { kind: 'favs' }, label: '收藏夹', icon: 'favoriteFolder' },
  watchLater: { view: { kind: 'watchLater' }, label: '稍后再看', icon: 'laterScreen' },
  following: { view: { kind: 'following' }, label: '关注', icon: 'followingPair' },
  liked: { view: { kind: 'liked' }, label: '赞过的视频', icon: 'likedThumb' },
  library: { view: { kind: 'library' }, label: '曲库', icon: 'libraryRecord' },
  downloads: { view: { kind: 'downloads' }, label: '已下载', icon: 'downloadTray' },
  settings: { view: { kind: 'settings' }, label: '设置', icon: 'settingsDial' },
} as const
