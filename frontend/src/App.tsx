import { useEffect, useState } from 'react' // hooks
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom' // 路由
import { Toaster } from 'sonner' // Toast 通知
import { SidebarProvider } from '@/components/ui/sidebar' // SidebarMenuButton 等组件需要的 Context
import { getManifests } from '@/lib/api' // API
import type { Manifest } from '@/lib/types' // 类型
import Sidebar from '@/components/Sidebar' // 侧栏
import PluginPage from '@/components/PluginPage' // 插件详情页

/**
 * 控制中心根组件
 * @description 侧栏 + 动态路由（根据 manifest 自动生成 Route，无需手动添加）
 */
export default function App() {
  const [plugins, setPlugins] = useState<Manifest[] | null>(null) // 插件列表（null=加载中）

  useEffect(() => {
    getManifests().then(list => setPlugins(Array.isArray(list) ? list : []))
  }, [])

  const defaultRoute = plugins?.find(p => p.route)?.route || '/'

  return (
    <BrowserRouter>
      <SidebarProvider>
        <Toaster position="top-center" richColors duration={3000} />
        {/* min-w-0 + w-full：作为 SidebarProvider 的 flex 子项时不被内容撑破，main 宽度=可见区 */}
        <div className="flex min-w-0 w-full overflow-hidden">
          <Sidebar />
          {/* min-w-0：flex-1 子项可收缩，PluginPage 顶栏才能独立横向滚动 */}
          <main className="flex-1 overflow-hidden min-w-0 h-screen">
            {plugins === null ? (
              <div className="p-8 text-sm text-(--muted-foreground)">加载插件列表...</div>
            ) : (
              <Routes>
                {/* 根路径 → 重定向到第一个有 route 的插件 */}
                <Route path="/" element={<Navigate to={defaultRoute} replace />} />
                {/* 动态 Route：每个插件一条路由（PluginPage 步骤 4-1 实现） */}
                {plugins.map(p => {
                  const path = p.route?.startsWith('/') ? p.route : `/${p.route || p.name}`
                  return (
                    <Route
                      key={p.name}
                      path={path}
                      element={<PluginPage pluginKey={p.name} />}
                    />
                  )
                })}
              </Routes>
            )}
          </main>
        </div>
      </SidebarProvider>
    </BrowserRouter>
  )
}
