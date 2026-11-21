import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'
import { fileURLToPath } from 'url'
import { normalizeDevProxyConfig } from './src/lib/devProxy'

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'))

function loadDevProxyConfig() {
  try {
    return normalizeDevProxyConfig(
      JSON.parse(readFileSync('./dev-proxy.config.json', 'utf-8')) as unknown,
    )
  } catch (error) {
    const err = error as NodeJS.ErrnoException
    if (err.code === 'ENOENT') return null
    throw error
  }
}

async function embedDefaultConfig(value: string) {
  const source = value.trim()
  if (!source) return source

  if (/^https?:\/\//i.test(source)) {
    const url = new URL(source)
    if (!url.pathname.toLowerCase().endsWith('.json')) return source

    const response = await fetch(source)
    if (!response.ok) throw new Error(`预置配置请求失败：HTTP ${response.status}`)
    return `embedded-config:${Buffer.from(await response.text()).toString('base64')}`
  }

  const fileUrl = source.startsWith('file://')
  const path = fileUrl ? fileURLToPath(source) : resolve(source)
  if (!existsSync(path)) {
    if (fileUrl || source.toLowerCase().endsWith('.json')) throw new Error(`预置配置文件不存在：${path}`)
    return source
  }
  return `embedded-config:${Buffer.from(readFileSync(path)).toString('base64')}`
}

export default defineConfig(async ({ command, mode }) => {
  // Vitest 也使用 serve，测试必须与本机 .env、开发代理及预置配置文件隔离。
  const isTest = mode === 'test'
  const envDir = isTest ? false : process.cwd()
  const env = loadEnv(mode, envDir, '')
  // 生产构建绝不能带本地开发代理锁：.env.local 被 Vite 一并读入，历史上两次
  // （1.13.32、1.13.74）因此把共享模型和本站账号池的请求推到 /api-proxy/*，导致 405 / 凭据被拒。
  if (command === 'build') {
    delete env.VITE_API_PROXY_LOCKED
    process.env.VITE_API_PROXY_LOCKED = ''
  }
  const defaultApiUrl = isTest ? '' : await embedDefaultConfig(process.env.VITE_DEFAULT_API_URL ?? env.VITE_DEFAULT_API_URL ?? '')
  if (defaultApiUrl.startsWith('embedded-config:')) process.env.VITE_DEFAULT_API_URL = defaultApiUrl
  const devProxyConfig = command === 'serve' && !isTest ? loadDevProxyConfig() : null
  const devProxyApiKey = command === 'serve' && !isTest
    ? loadEnv(mode, resolve('..'), 'PLAYGROUND_DEV_PROXY_API_KEY').PLAYGROUND_DEV_PROXY_API_KEY?.trim()
    : undefined

  return {
    envDir,
    plugins: [react(), {
      name: 'local-dev-proxy-guard',
      configureServer(server) {
        if (!devProxyConfig?.enabled || !devProxyApiKey) return
        server.middlewares.use((request, response, next) => {
          const path = request.url?.split('?')[0] ?? ''
          if (path !== devProxyConfig.prefix && !path.startsWith(`${devProxyConfig.prefix}/`)) return next()
          const origin = request.headers.origin
          if (origin && new URL(origin).host !== request.headers.host) {
            response.writeHead(403).end('Forbidden')
            return
          }
          if (request.headers.authorization !== 'Bearer local-proxy-placeholder') {
            response.writeHead(401).end('Unauthorized')
            return
          }
          next()
        })
      },
    }],
    base: './',
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
      __DEV_PROXY_CONFIG__: JSON.stringify(devProxyConfig),
    },
    server: {
      host: true,
      proxy:
        devProxyConfig?.enabled
          ? {
              [devProxyConfig.prefix]: {
                target: devProxyConfig.target,
                changeOrigin: devProxyConfig.changeOrigin,
                secure: devProxyConfig.secure,
                configure: (proxy) => {
                  if (devProxyApiKey) proxy.on('proxyReq', (request) => {
                    request.setHeader('Authorization', `Bearer ${devProxyApiKey}`)
                  })
                },
                rewrite: (path) =>
                  path.replace(
                    new RegExp(`^${devProxyConfig.prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
                    '',
                  ),
              },
            }
          : undefined,
    },
  }
})
