import { StrictMode } from 'react'
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
  </StrictMode>,
)
