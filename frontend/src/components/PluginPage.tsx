import { useState, useEffect, useCallback, useRef } from 'react' // React hooks
import { ScrollText, Wrench, Bot, Repeat } from 'lucide-react' // Tab 图标
import { getManifests, daemonApi } from '@/lib/api' // API
import type { Manifest, DaemonStatus } from '@/lib/types' // 类型
import LogViewer from '@/components/LogViewer' // 日志查看器（步骤 4-2-2）
import HermesSkills from '@/components/HermesSkills' // HERMES Skills 管理面板（步骤 4-5）

/**
 * 通用插件详情页
 * @description 顶栏启停控制 + Tab 栏（日志/服务配置/HERMES），Tab 内容后续步骤填充
 * @param pluginKey 插件 name（如 1_chat_monitor）
 */
export default function PluginPage({ pluginKey }: { pluginKey: string }) {
    // ★ 所有 hooks 必须在 early return 之前（React #310 铁律）──
    const [plugin, setPlugin] = useState<Manifest | null>(null) // 当前插件 manifest
    const [status, setStatus] = useState<DaemonStatus>({ service: '', status: 'stopped', installed: false, output: '' }) // 运行状态
    const [tab, setTab] = useState('logs') // 当前 Tab
    const [loading, setLoading] = useState<Record<string, boolean>>({}) // 按钮 loading 状态
    const iframeRef = useRef<HTMLIFrameElement>(null) // 服务配置 iframe ref（主题注入用）

    // ── 切换插件时重置状态 ────────────────────────────
    useEffect(() => {
        setPlugin(null) // 清空旧数据
        setTab('logs') // 重置到日志 Tab
        getManifests().then(list => {
            const manifests = Array.isArray(list) ? list : [] // 兜底
            setPlugin(manifests.find(p => p.name === pluginKey) || null) // 按 name 匹配
        })
    }, [pluginKey])

    // ── 刷新状态 + 3 秒轮询 ──────────────────────────
    const refreshStatus = useCallback(async () => {
        if (!pluginKey) return
        try {
            const s = await daemonApi(pluginKey).getStatus()
            setStatus(s)
        } catch {
            setStatus({ service: pluginKey, status: 'stopped', installed: false, output: '' })
        }
    }, [pluginKey])

    useEffect(() => {
        refreshStatus()
        const timer = setInterval(refreshStatus, 3000) // 3 秒轮询
        return () => clearInterval(timer)
    }, [refreshStatus])

    // ── 插件 iframe 主题注入：onLoad 时注入监听脚本 + MutationObserver 广播主题变化 ──
    /** iframe 加载完成后注入主题监听脚本（插件零改动） */
    function onIframeLoad() {
        const doc = iframeRef.current?.contentDocument // 获取 iframe 文档
        if (!doc) return // 不可达则跳过
        const script = doc.createElement('script') // 创建内联脚本
        script.textContent = `
          window.addEventListener('message', function(e) {
            if (e.data?.type === 'hermes-theme') {
              document.documentElement.classList.toggle('dark', e.data.theme === 'dark')
            }
          })
        ` // 监听壳子 postMessage 切换 html.dark class
        doc.head.appendChild(script) // 注入到 iframe head
        // 注入后立即发送当前壳子主题（解决首次加载不触发 MutationObserver 的问题）
        const isDark = document.documentElement.classList.contains('dark') // 读壳子当前状态
        iframeRef.current?.contentWindow?.postMessage( // 立即发送
            { type: 'hermes-theme', theme: isDark ? 'dark' : 'light' }, '*' // 同源安全
        )
    }

    /** MutationObserver 感知壳子 html.dark → postMessage 广播给 iframe */
    useEffect(() => {
        const sendTheme = () => { // 发送当前主题给 iframe
            const isDark = document.documentElement.classList.contains('dark') // 读当前状态
            iframeRef.current?.contentWindow?.postMessage( // 广播
                { type: 'hermes-theme', theme: isDark ? 'dark' : 'light' }, '*' // 同源无安全风险
            )
        }
        const observer = new MutationObserver(sendTheme) // 监听 class 属性变化
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] }) // 只 watch class
        return () => observer.disconnect() // 组件卸载时断开
    }, [])

    // ★ early return 在所有 hooks 之后 ──────────────────
    if (!plugin) {
        return <div className="p-8 text-sm text-(--muted-foreground)">加载中...</div>
    }

    const api = daemonApi(plugin.name) // 当前插件 API
    const running = status.status === 'running' // 是否运行中
    const hasUi = Boolean(plugin.ui) // 有 ui → 显示服务配置 Tab
    const hasSkills = Boolean(plugin.skills?.length) // 有 skills → 显示 HERMES Tab

    /** 启停切换 */
    async function toggleService() {
        setLoading(p => ({ ...p, service: true }))
        try {
            if (running) await api.stop()
            else await api.start()
        } finally {
            setLoading(p => ({ ...p, service: false }))
            await refreshStatus()
        }
    }

    /** 重启 */
    async function restart() {
        setLoading(p => ({ ...p, restart: true }))
        try {
            await api.restart()
        } finally {
            setLoading(p => ({ ...p, restart: false }))
            await refreshStatus()
        }
    }

    return (
        /* min-w-0 w-full：整页宽度锁在父级可见区内 */
        <div className="flex h-full min-h-0 min-w-0 w-full flex-col overflow-hidden">
            {/* ═══ 顶栏：服务控制 + Tab（同一行） ═══ */}
            <div className="w-full min-w-0 shrink-0 border-b border-(--border)">
                {/* grid：左 auto 右 minmax(0,1fr)，比 flex 更稳，右侧一定能完整横向滚 */}
                <div className="grid w-full min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-3 px-3 py-2">
                    {/* 左侧：插件名 + 启停 + 重启（宽度随内容，不参与压缩） */}
                    <div className="flex min-w-0 items-center gap-3">
                        {/* 插件名 + 状态 */}
                        <div className="flex min-w-0 items-center gap-3">
                            <h1 className="truncate text-base font-semibold">
                                {plugin.displayName || plugin.name}
                            </h1>
                            <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${running ? 'bg-(--status-success-bg) text-(--status-success-text)' : 'bg-(--status-danger-bg) text-(--status-danger-text)'
                                }`}>
                                {running ? '运行中' : '已停止'}
                            </span>
                        </div>

                        {/* 启停开关 + 重启 */}
                        <div className="flex shrink-0 items-center gap-3">
                            <button
                                type="button"
                                onClick={toggleService}
                                disabled={loading.service}
                                className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${running ? 'bg-(--status-success)' : 'bg-(--status-off)'
                                    }`}
                                title={running ? '停止服务' : '启动服务'}
                            >
                                <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${running ? 'translate-x-6' : 'translate-x-1'
                                    }`} />
                            </button>
                            <span className="w-12 text-sm text-(--muted-foreground)">
                                {running ? '已开启' : '已关闭'}
                            </span>

                            <div className="h-6 w-px bg-(--border)" />

                            <button
                                type="button"
                                onClick={restart}
                                disabled={loading.restart}
                                className="flex items-center gap-1.5 rounded-lg bg-(--warning-bg) px-3 py-1.5 text-sm text-(--warning-text) hover:brightness-90 disabled:opacity-50">
                                <Repeat className="h-4 w-4" />
                                更新服务
                            </button>
                        </div>

                        {/* 分隔线 */}
                        <div className="h-6 w-px shrink-0 bg-(--border)" />
                    </div>

                    {/* 右侧 Tab：minmax(0,1fr) 锁定可见宽；隐藏滚动条仍可触控板/Shift+滚轮横滚 */}
                    <nav className="min-w-0 overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
                        {/* w-max：按钮真实宽度横排，溢出由 nav 滚动 */}
                        <div className="flex w-max items-center gap-1">
                            <button
                                type="button"
                                onClick={() => setTab('logs')}
                                className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors shrink-0 ${tab === 'logs' ? 'bg-(--primary) text-(--primary-foreground)' : 'text-(--muted-foreground) hover:bg-(--secondary)'
                                    }`}>
                                <ScrollText className="w-4 h-4" />
                                <span>日志</span>
                            </button>

                            {hasUi && (
                                <button
                                    type="button"
                                    onClick={() => setTab('config')}
                                    className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors shrink-0 ${tab === 'config' ? 'bg-(--primary) text-(--primary-foreground)' : 'text-(--muted-foreground) hover:bg-(--secondary)'
                                        }`}>
                                    <Wrench className="w-4 h-4" />
                                    <span>服务配置</span>
                                </button>
                            )}

                            {hasSkills && (
                                <button
                                    type="button"
                                    onClick={() => setTab('hermes')}
                                    className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors shrink-0 ${tab === 'hermes' ? 'bg-(--primary) text-(--primary-foreground)' : 'text-(--muted-foreground) hover:bg-(--secondary)'
                                        }`}>
                                    <Bot className="w-4 h-4" />
                                    <span>HERMES</span>
                                </button>
                            )}
                        </div>
                    </nav>
                </div>
            </div>

            {/* ═══ 内容区（后续步骤填充） ═══ */}
            <div className="flex-1 min-h-0 overflow-hidden">
                {tab === 'logs' && (
                    <div className="h-full min-h-0 p-3 flex flex-col">
                        <LogViewer key={plugin.name} api={api} /> {/* key 保证切插件重挂 */}
                    </div>
                )}
                {tab === 'config' && (
                    <iframe
                        ref={iframeRef} // 主题注入 ref
                        src={`/plugins/${plugin.name}/${plugin.ui?.entry || 'index.html'}`} // 加载插件自己的前端
                        className="w-full h-full border-0" // 填满内容区
                        title={plugin.displayName || plugin.name} // 无障碍
                        onLoad={onIframeLoad} // 注入主题监听脚本
                    />
                )}
                {tab === 'hermes' && (
                    <HermesSkills pluginKey={plugin.name} />
                )}
            </div>
        </div >
    )
}
