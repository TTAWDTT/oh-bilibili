/** shaka-player 的全局对象。只声明用到的那几个方法，避免引入完整类型包。 */
export type ShakaVariant = { height: number; bandwidth: number | null; active?: boolean }

export type ShakaPlayer = {
  load: (url: string) => Promise<void>
  destroy: () => Promise<void>
  getVariantTracks: () => ShakaVariant[]
  selectVariantTrack: (track: ShakaVariant, clearBuffer: boolean) => void
  addEventListener: (type: string, handler: (event: { detail?: unknown }) => void) => void
}

export type ShakaGlobal = {
  Player: new (video: HTMLVideoElement) => ShakaPlayer
  polyfill?: { installAll?: () => void }
}
