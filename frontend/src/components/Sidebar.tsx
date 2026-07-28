import { useState, useEffect } from 'react' // React hooks
import { FileText, Settings, Sun, Moon, ChevronLeft, ChevronRight } from 'lucide-react' // 内置图标
import { Link, useLocation } from 'react-router-dom' // 路由导航
import * as Lucide from 'lucide-react' // 全部图标（动态加载插件 icon）
import { getManifests, daemonApi } from '@/lib/api' // API 封装
import type { Manifest } from '@/lib/types' // 类型定义

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible' // 折叠组件
import {
  SidebarGroup, SidebarGroupLabel, SidebarGroupContent,
  SidebarMenu, SidebarMenuItem, SidebarMenuButton,
  SidebarMenuSub, SidebarMenuSubItem, SidebarMenuSubButton,
} from '@/components/ui/sidebar' // shadcn sidebar 组件
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuTrigger, DropdownMenuSub, DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from '@/components/ui/dropdown-menu' // 设置下拉菜单

const THEME_KEY = 'hermes-theme'
const THEMES = [
  { id: 'light' as const, label: '浅色', icon: Sun },
  { id: 'dark' as const, label: '暗色', icon: Moon },
]

function getStoredTheme(): string { try { return localStorage.getItem(THEME_KEY) || 'light' } catch { return 'light' } }
function setStoredTheme(t: string) { try { localStorage.setItem(THEME_KEY, t) } catch { /* */ } }
function applyTheme(t: string) { document.documentElement.classList.remove('dark'); if (t === 'dark') document.documentElement.classList.add('dark') }

/** 侧栏树：group → menus → plugins */
interface SidebarGroup { group: string; menus: SidebarMenu[] }
interface SidebarMenu { name: string; plugins: Manifest[] }

function buildSidebarTree(manifests: Manifest[]): SidebarGroup[] {
  const map = new Map<string, Map<string, Manifest[]>>()
  for (const m of manifests) {
    const parts = (m.category || 'OTHER.Default').split('.')
    const group = parts[0]; const menu = parts[1] || 'Default'
    if (!map.has(group)) map.set(group, new Map())
    const menus = map.get(group)!
    if (!menus.has(menu)) menus.set(menu, [])
    menus.get(menu)!.push(m)
  }
  return [...map.entries()].map(([group, menus]) => ({
    group,
    menus: [...menus.entries()].map(([name, plugins]) => ({ name, plugins })),
  }))
}

export default function Sidebar() {
  const location = useLocation()
  const [tree, setTree] = useState<SidebarGroup[]>([])
  const [statuses, setStatuses] = useState<Record<string, boolean>>({})
  const [theme, setTheme] = useState<string>(getStoredTheme)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => { applyTheme(theme) }, [theme])
  function handleThemeChange(t: string) { setTheme(t); setStoredTheme(t); applyTheme(t) }

  useEffect(() => { getManifests().then(list => setTree(buildSidebarTree(Array.isArray(list) ? list : []))) }, [])

  useEffect(() => {
    async function fetchAll() {
      const allPlugins = tree.flatMap(g => g.menus.flatMap(m => m.plugins))
      const results = await Promise.all(allPlugins.map(async p => {
        try { const s = await daemonApi(p.name).getStatus(); return [p.route, s.status === 'running'] as const }
        catch { return [p.route, false] as const }
      }))
      setStatuses(Object.fromEntries(results))
    }
    if (tree.length === 0) return
    fetchAll(); const interval = setInterval(fetchAll, 3000); return () => clearInterval(interval)
  }, [tree])

  function getIcon(iconName: string) {
    const key = iconName.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('')
    const Component = (Lucide as unknown as Record<string, React.ComponentType<{ className?: string }>>)[key]
    return Component || FileText
  }

  /** 展开态：按 NavMain 模式渲染分组 → 折叠菜单 → 插件子项 */
  function renderGroupedNav() {
    return tree.map(grp => (
      <SidebarGroup key={grp.group}>
        <SidebarGroupLabel>{grp.group}</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            {grp.menus.map(menu => (
              <Collapsible key={menu.name} defaultOpen className="group/collapsible">
                <SidebarMenuItem>
                  {/* render 合并为单一 button，避免 CollapsibleTrigger+MenuButton 嵌套 button */}
                  <SidebarMenuButton render={<CollapsibleTrigger />} tooltip={menu.name}>
                    <span>{menu.name}</span>
                    <ChevronRight className="ml-auto size-4 transition-transform duration-200 group-data-[panel-open]/collapsible:rotate-90" />
                  </SidebarMenuButton>
                  <CollapsibleContent>
                    <SidebarMenuSub>
                      {menu.plugins.map(item => {
                        const Icon = getIcon(item.icon || 'file') // 插件图标
                        const running = statuses[item.route] === true // 运行状态
                        const isActive = location.pathname.startsWith(item.route) // 是否当前路由
                        return (
                          <SidebarMenuSubItem key={item.name}>
                            {/* render=Link：单一 <a>，避免 Link 包 SubButton 造成 a>a */}
                            <SidebarMenuSubButton render={<Link to={item.route} />} isActive={isActive}>
                              <span className="relative shrink-0">
                                <Icon className="size-4" />
                                <span className={`absolute -top-0.5 -right-0.5 size-2 rounded-full border-2 border-(--sidebar) ${running ? 'bg-(--status-success)' : 'bg-(--status-danger)'}`} />
                              </span>
                              <span>{item.displayName}</span>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        )
                      })}
                    </SidebarMenuSub>
                  </CollapsibleContent>
                </SidebarMenuItem>
              </Collapsible>
            ))}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    ))
  }

  // ── 折叠态 ────────────────────────────────
  if (collapsed) {
    return (
      <aside className="w-14 bg-(--sidebar) text-(--sidebar-foreground) h-screen sticky top-0 p-2 flex flex-col items-center gap-2">
        <button onClick={() => setCollapsed(false)} className="p-1 rounded hover:bg-(--sidebar-accent) mt-1">
          <ChevronRight className="w-4 h-4" />
        </button>
        <nav className="flex-1 space-y-2 overflow-auto">
          {tree.flatMap(g => g.menus.flatMap(m => m.plugins)).map(item => {
            const Icon = getIcon(item.icon || 'file')
            const running = statuses[item.route] === true
            const isActive = location.pathname.startsWith(item.route)
            return (
              <Link key={item.route} to={item.route}
                className={`flex items-center justify-center w-10 h-10 rounded-lg hover:bg-(--sidebar-accent) ${isActive ? 'bg-(--sidebar-accent) text-(--sidebar-accent-foreground)' : 'text-(--sidebar-foreground)/70'
                  }`}
                title={item.displayName}
              >
                <span className="relative shrink-0">
                  <Icon className="w-5 h-5" />
                  <span className={`absolute -top-0.5 -right-0.5 size-2 rounded-full border border-(--sidebar) ${running ? 'bg-(--status-success)' : 'bg-(--status-danger)'}`} />
                </span>
              </Link>
            )
          })}
        </nav>
      </aside>
    )
  }

  // ── 展开态 ────────────────────────────────
  return (
    <>
      <aside className="w-64 bg-(--sidebar) text-(--sidebar-foreground) h-screen sticky top-0 p-4 flex flex-col">
        <div className="flex items-center justify-between mb-8">
          <div className="text-xl font-bold">Expose Yourself</div>
          <button onClick={() => setCollapsed(true)} className="p-1 rounded hover:bg-(--sidebar-accent)">
            <ChevronLeft className="w-4 h-4" />
          </button>
        </div>

        <nav className="flex-1 overflow-auto">
          {renderGroupedNav()}
        </nav>

        <div className="border-t border-(--sidebar-border) pt-2">
          <DropdownMenu open={settingsOpen} onOpenChange={setSettingsOpen}>
            <DropdownMenuTrigger className="flex w-full items-center gap-3 px-3 py-2 rounded-lg text-sm text-(--sidebar-foreground)/70 hover:bg-(--sidebar-accent) hover:text-(--sidebar-accent-foreground) transition-colors">
              <Settings className="w-4 h-4" />
              <span>设置</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="right" align="end">
              <DropdownMenuSub>
                <DropdownMenuSubTrigger><span>主题</span></DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {THEMES.map(t => {
                    const IconComp = t.icon
                    return (
                      <DropdownMenuItem key={t.id} onClick={() => handleThemeChange(t.id)}>
                        <IconComp className="size-4" />
                        <span>{t.label}</span>
                        {theme === t.id && <span className="ml-auto">✓</span>}
                      </DropdownMenuItem>
                    )
                  })}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>
    </>
  )
}
