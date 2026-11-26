import { startWorkbenchTabHeartbeat } from './lib/workbenchOwner'
import 'core-js/actual/array/at'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'streamdown/styles.css'
import 'katex/dist/katex.min.css'
import './index.css'
import { installMobileViewportGuards } from './lib/viewport'
import { connectAccountPool, isPoolBuild, poolFetch, setSharedProfilesAuth } from './lib/accountPool'
import { getStoredAuthKey } from './lib/authKey'

installMobileViewportGuards()

if (!isPoolBuild && 'serviceWorker' in navigator) {
  if (import.meta.env.PROD) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch((error) => {
        console.error('Service worker registration failed:', error)
      })
    })
  } else {
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      registrations.forEach((registration) => registration.unregister())
    })
  }
}

// 等待账号池会话握手拿到 owner 后再加载 store/App，确保 Zustand persist 读取当前用户的隔离存储键。
const start = isPoolBuild ? connectAccountPool() : getStoredAuthKey().then((key) => {
  if (!key) return
  setSharedProfilesAuth({ kind: 'bearer', token: key })
  window.fetch = poolFetch(window.fetch.bind(window), window.location.origin, () => key)
})
void start.then(async () => {
  startWorkbenchTabHeartbeat()
  const { default: App } = await import('./App')
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
