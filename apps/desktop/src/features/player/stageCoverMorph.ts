import { useCallback, useLayoutEffect, useRef } from 'react'
import type { RefObject } from 'react'
import type { Track } from '../../shared/lib/contract'

const ENTER_MS = 220
const EXIT_MS = 200
const FADE_MS = 140

type Rect = { left: number; top: number; width: number; height: number }
type Box = Rect & { radius: number; angle: number }

type StageSource = {
  key: string
  element: HTMLElement
  box: Box
  viewportWidth: number
  viewportHeight: number
}

type Flight = {
  key: string
  flyer: HTMLDivElement
  stage: HTMLElement
  targetImage: HTMLImageElement
  originImage: HTMLImageElement
  animation: Animation | null
  stageAnimation: Animation | null
}

let pendingSource: StageSource | null = null

/**
 * 播放条点开舞台时记下封面的实际位置。StageView 在挂载后的第一帧消费它，
 * 两个位置之间才会有真实的飞行起点。
 */
export function rememberStageOrigin(element: HTMLElement, track: Track): void {
  if (!track.cover) return
  const image = element.querySelector('img')
  if (!image || !usableImage(image) || !visible(element)) return
  const rect = element.getBoundingClientRect()
  pendingSource = {
    key: track.key,
    element,
    box: {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      radius: radiusOf(element),
      angle: 0,
    },
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
  }
}

function takeStageOrigin(key: string): StageSource | null {
  const source = pendingSource
  pendingSource = null
  if (!source || source.key !== key) return null
  if (!source.element.isConnected || !visible(source.element)) return null
  if (source.viewportWidth !== window.innerWidth || source.viewportHeight !== window.innerHeight) return null
  return source
}

function imageReady(image: HTMLImageElement): boolean {
  return image.complete && image.naturalWidth > 0
}

/** 兜底封面不是这张曲目的画面，跨窗口飞它只会像加载失败。 */
function usableImage(image: HTMLImageElement): boolean {
  return imageReady(image) && !image.hasAttribute('data-cover-fallback')
}

function visible(element: HTMLElement): boolean {
  if (!element.isConnected || element.getClientRects().length === 0) return false
  const style = getComputedStyle(element)
  return (
    style.display !== 'none' &&
    style.visibility !== 'hidden' &&
    Number(style.opacity) > 0.01
  )
}

function radiusOf(element: HTMLElement): number {
  const value = Number.parseFloat(getComputedStyle(element).borderTopLeftRadius)
  return Number.isFinite(value) ? value : 0
}

function angleOf(transform: string): number {
  if (!transform || transform === 'none') return 0
  const matrix = new DOMMatrixReadOnly(transform)
  return (Math.atan2(matrix.b, matrix.a) * 180) / Math.PI
}

function stageCoverBox(image: HTMLImageElement, vinyl: HTMLElement): Box {
  const rect = image.getBoundingClientRect()
  return {
    left: rect.left + rect.width / 2 - image.offsetWidth / 2,
    top: rect.top + rect.height / 2 - image.offsetHeight / 2,
    width: image.offsetWidth,
    height: image.offsetHeight,
    radius: Math.min(image.offsetWidth, image.offsetHeight) / 2,
    angle: angleOf(getComputedStyle(vinyl).transform),
  }
}

function readFlyer(flyer: HTMLElement): Box {
  const style = getComputedStyle(flyer)
  const rect = flyer.getBoundingClientRect()
  const width = Number.parseFloat(style.width) || rect.width
  const height = Number.parseFloat(style.height) || rect.height
  return {
    left: rect.left + rect.width / 2 - width / 2,
    top: rect.top + rect.height / 2 - height / 2,
    width,
    height,
    radius: Number.parseFloat(style.borderTopLeftRadius) || 0,
    angle: angleOf(style.transform),
  }
}

function createFlyer(image: HTMLImageElement, box: Box): HTMLDivElement {
  const flyer = document.createElement('div')
  flyer.setAttribute('data-stage-flyer', '')
  flyer.setAttribute('aria-hidden', 'true')
  flyer.style.cssText = [
    'position:fixed',
    'left:0',
    'top:0',
    'z-index:45',
    'pointer-events:none',
    'overflow:hidden',
    'will-change:transform,width,height,border-radius',
    'background:var(--panel)',
    `width:${box.width}px`,
    `height:${box.height}px`,
    `border-radius:${box.radius}px`,
    `transform:translate(${box.left}px, ${box.top}px) rotate(${box.angle}deg)`,
  ].join(';')

  const img = document.createElement('img')
  img.src = image.currentSrc || image.src
  img.alt = ''
  img.draggable = false
  img.decoding = 'async'
  img.referrerPolicy = 'no-referrer'
  img.style.cssText = 'display:block;width:100%;height:100%;object-fit:cover'
  flyer.appendChild(img)
  document.body.appendChild(flyer)
  return flyer
}

function animateFlyer(flyer: HTMLDivElement, from: Box, to: Box, duration: number): Animation {
  return flyer.animate(
    [
      {
        width: `${from.width}px`,
        height: `${from.height}px`,
        borderRadius: `${from.radius}px`,
        transform: `translate(${from.left}px, ${from.top}px) rotate(${from.angle}deg)`,
      },
      {
        width: `${to.width}px`,
        height: `${to.height}px`,
        borderRadius: `${to.radius}px`,
        transform: `translate(${to.left}px, ${to.top}px) rotate(${to.angle}deg)`,
      },
    ],
    { duration, easing: 'cubic-bezier(0.33, 1, 0.68, 1)', fill: 'both' },
  )
}

function animateStage(stage: HTMLElement, from: number, to: number, duration: number): Animation {
  return stage.animate([{ opacity: from }, { opacity: to }], {
    duration,
    easing: 'ease-out',
    fill: 'both',
  })
}

function settle(flight: Flight): void {
  flight.animation?.cancel()
  flight.stageAnimation?.cancel()
  flight.stage.style.opacity = ''
  flight.flyer.remove()
  if (flight.targetImage.isConnected) flight.targetImage.style.visibility = ''
  if (flight.originImage.isConnected) flight.originImage.style.visibility = ''
}

function findOrigin(key: string): HTMLElement | null {
  return (
    [...document.querySelectorAll<HTMLElement>('[data-stage-origin]')].find(
      (element) => element.dataset.stageOrigin === key,
    ) ?? null
  )
}

function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function fadeIn(stage: HTMLElement): Animation | null {
  if (reducedMotion()) return null
  return stage.animate([{ opacity: 0 }, { opacity: 1 }], {
    duration: FADE_MS,
    easing: 'ease-out',
  })
}

/**
 * 舞台封面与播放条小封面之间的共享元素过渡。
 *
 * 打开时先落位，再按当前曲目尝试把播放条封面飞到舞台封面；退出时从舞台上
 * 当前可见的封面飞回播放条。任何一端不可用、曲目变了或窗口变了，
 * 都直接落位。
 */
export function useStageCoverMorph({
  open,
  track,
  stageRef,
  vinylRef,
  onExit,
}: {
  open: boolean
  track: Track | null
  stageRef: RefObject<HTMLDivElement | null>
  vinylRef: RefObject<HTMLDivElement | null>
  onExit: () => void
}): { requestClose: () => void; closeNow: () => void } {
  const flightRef = useRef<Flight | null>(null)
  const fadeRef = useRef<Animation | null>(null)
  const closingRef = useRef(false)
  const openRef = useRef(false)
  const trackKeyRef = useRef<string | null>(null)

  useLayoutEffect(() => {
    trackKeyRef.current = track?.key ?? null
  }, [track?.key])

  useLayoutEffect(() => {
    if (!open) {
      const flight = flightRef.current
      if (flight) {
        flightRef.current = null
        settle(flight)
      }
      fadeRef.current?.cancel()
      fadeRef.current = null
      closingRef.current = false
      openRef.current = false
      return
    }
    if (openRef.current) return
    openRef.current = true

    const stage = stageRef.current
    const vinyl = vinylRef.current
    if (!stage || !vinyl || !track) return
    const source = takeStageOrigin(track.key)
    const originImage = source?.element.querySelector('img') ?? null
    const targetImage = vinyl.querySelector('img')
    if (
      reducedMotion() ||
      !source ||
      !originImage ||
      !usableImage(originImage) ||
      !targetImage ||
      !usableImage(targetImage) ||
      !visible(source.element)
    ) {
      fadeRef.current = fadeIn(stage)
      return
    }
    const target = stageCoverBox(targetImage, vinyl)
    if (target.width <= 0) {
      fadeRef.current = fadeIn(stage)
      return
    }

    const flyer = createFlyer(targetImage, source.box)
    originImage.style.visibility = 'hidden'
    targetImage.style.visibility = 'hidden'
    const flight: Flight = {
      key: track.key,
      flyer,
      stage,
      targetImage,
      originImage,
      animation: null,
      stageAnimation: null,
    }
    flight.animation = animateFlyer(flyer, source.box, target, ENTER_MS)
    flight.stageAnimation = animateStage(stage, 0, 1, ENTER_MS)
    flightRef.current = flight
    flight.animation.onfinish = () => {
      if (flightRef.current !== flight) return
      flightRef.current = null
      settle(flight)
    }
  }, [open, track, stageRef, vinylRef])

  // 过渡中切歌：旧封面的飞图不能留在新曲目上，直接落到新目标。
  useLayoutEffect(() => {
    const flight = flightRef.current
    if (!flight) return
    if (track && track.key === flight.key) return
    flightRef.current = null
    settle(flight)
    if (closingRef.current) {
      closingRef.current = false
      onExit()
    }
  }, [track, onExit])

  // 窗口尺寸变了，起终点已经不在原位，按直接落位处理。
  useLayoutEffect(() => {
    const onResize = (): void => {
      const flight = flightRef.current
      if (!flight) return
      flightRef.current = null
      settle(flight)
      if (closingRef.current) {
        closingRef.current = false
        onExit()
      }
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [onExit])

  const requestClose = useCallback(() => {
    if (closingRef.current) return
    closingRef.current = true
    const stage = stageRef.current
    const vinyl = vinylRef.current
    const key = trackKeyRef.current
    const current = flightRef.current
    const targetImage = vinyl?.querySelector('img') ?? null
    const origin = key ? findOrigin(key) : null
    const originImage = origin?.querySelector('img') ?? null

    if (
      reducedMotion() ||
      !stage ||
      !vinyl ||
      !key ||
      !targetImage ||
      !usableImage(targetImage) ||
      !origin ||
      !originImage ||
      !usableImage(originImage) ||
      !visible(origin) ||
      (current !== null && current.key !== key)
    ) {
      if (current) {
        flightRef.current = null
        settle(current)
      }
      closingRef.current = false
      onExit()
      return
    }

    const stageFrom = Number.parseFloat(getComputedStyle(stage).opacity)
    fadeRef.current?.cancel()
    fadeRef.current = null
    const target = stageCoverBox(targetImage, vinyl)
    let flight: Flight
    let from: Box

    if (current) {
      from = readFlyer(current.flyer)
      current.animation?.cancel()
      current.stageAnimation?.cancel()
      stage.style.opacity = ''
      flight = current
    } else {
      from = target
      flight = {
        key,
        flyer: createFlyer(targetImage, target),
        stage,
        targetImage,
        originImage,
        animation: null,
        stageAnimation: null,
      }
      flightRef.current = flight
    }

    flight.targetImage = targetImage
    flight.originImage = originImage
    targetImage.style.visibility = 'hidden'
    originImage.style.visibility = 'hidden'
    const originRect = origin.getBoundingClientRect()
    flight.animation = animateFlyer(
      flight.flyer,
      from,
      {
        left: originRect.left,
        top: originRect.top,
        width: originRect.width,
        height: originRect.height,
        radius: radiusOf(origin),
        angle: 0,
      },
      EXIT_MS,
    )
    flight.stageAnimation = animateStage(stage, Number.isFinite(stageFrom) ? stageFrom : 1, 0, EXIT_MS)
    flight.animation.onfinish = () => {
      if (flightRef.current !== flight) return
      flightRef.current = null
      settle(flight)
      closingRef.current = false
      onExit()
    }
  }, [onExit, stageRef, vinylRef])

  const closeNow = useCallback(() => {
    closingRef.current = false
    const flight = flightRef.current
    if (flight) {
      flightRef.current = null
      settle(flight)
    }
    onExit()
  }, [onExit])

  return { requestClose, closeNow }
}
