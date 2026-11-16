import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import App from './app/App'
import { CrashNote } from './app/CrashNote'
import './styles.css'

const host = document.getElementById('root')
if (!host) {
  throw new Error('缺少 #root 挂载点')
}

createRoot(host).render(
  <StrictMode>
    <CrashNote>
      <App />
    </CrashNote>
    <BootSplash />
  </StrictMode>,
)

function BootSplash() {
  useEffect(() => {
    const splash = document.getElementById('boot-splash')
    if (!splash) return
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        const fade = splash.animate([{ opacity: 1 }, { opacity: 0 }], {
          duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 160,
          fill: 'forwards',
        })
        fade.onfinish = () => splash.remove()
      })
    })
    return () => cancelAnimationFrame(frame)
  }, [])
  return null
}
