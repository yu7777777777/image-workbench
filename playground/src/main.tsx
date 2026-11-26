import 'core-js/actual/array/at'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'streamdown/styles.css'
import 'katex/dist/katex.min.css'
import './index.css'
import { installMobileViewportGuards } from './lib/viewport'
import { connectAccountPool, isPoolBuild, setSharedProfilesAuth } from './lib/accountPool'
import { getStoredAuthKey } from './lib/authKey'

installMobileViewportGuards()

// 非账号池构建（独立 playground）：共享模型列表用本站登录令牌鉴权，
// 否则普通用户（密钥不等于会话占位符）无法刷新到管理员发布的共享模型。
if (!isPoolBuild) {
  void getStoredAuthKey().then((key) => {
    if (key) setSharedProfilesAuth({ kind: 'bearer', token: key })
  })
}

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
const start = isPoolBuild ? connectAccountPool() : Promise.resolve()
void start.then(async () => {
  const { default: App } = await import('./App')
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
