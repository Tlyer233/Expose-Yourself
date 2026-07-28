import { useCallback, useEffect, useState } from 'react' // React hooks
import { Bot } from 'lucide-react' // 图标
import type { SkillItem } from '@/lib/types' // Skill 类型
import { daemonApi } from '@/lib/api' // API

/**
 * Hermes Skills 管理面板
 * @description 读取当前插件 manifest.skills，支持启用/更新/禁用
 * @param pluginKey 插件 name（如 1_chat_monitor）
 */
export default function HermesSkills({ pluginKey }: { pluginKey: string }) {
  const [skills, setSkills] = useState<SkillItem[]>([]) // skill 列表
  const [loading, setLoading] = useState(true) // 首屏加载
  const [busy, setBusy] = useState<Record<string, boolean>>({}) // 单条 busy: path→true
  const [error, setError] = useState('') // 错误提示

  /** 拉取当前插件 skills 状态 */
  const refresh = useCallback(async () => {
    if (!pluginKey) return // 无 key 不请求
    setError('') // 清空错误
    try {
      const data = await daemonApi(pluginKey).getSkills() // GET /daemon/:name/skills
      setSkills(Array.isArray(data) ? data : []) // 写入列表
    } catch {
      setError('加载失败') // 网络异常
      setSkills([]) // 失败清空
    } finally {
      setLoading(false) // 结束首屏 loading
    }
  }, [pluginKey])

  useEffect(() => {
    setLoading(true) // 切换插件重 loading
    setSkills([]) // 清空旧数据
    void refresh() // 拉取
  }, [refresh])

  /** 对单个 skill 执行 enable/update/disable */
  async function runAction(skillPath: string, action: 'enable' | 'update' | 'disable') {
    setBusy(prev => ({ ...prev, [skillPath]: true })) // 按钮 loading
    setError('') // 清空错误
    try {
      const res = await daemonApi(pluginKey).skillsAction(skillPath, action) // POST action
      if (res?.error) { // 后端业务错误
        setError(res.error) // 展示
        return
      }
      await refresh() // 成功刷新列表
    } catch {
      setError('操作失败') // 网络异常
    } finally {
      setBusy(prev => ({ ...prev, [skillPath]: false })) // 结束 loading
    }
  }

  if (loading) {
    return (
      <div className="h-full min-h-0 p-4 text-sm text-(--muted-foreground)">
        加载 Skills...
      </div>
    )
  }

  return (
    <div className="h-full min-h-0 p-4 overflow-auto">
      {/* 标题 */}
      <div className="text-sm font-medium mb-1">Hermes Skills</div>
      <div className="text-xs text-(--muted-foreground) mb-4">
        将插件 Skill 安装到 ~/.hermes/skills，供 Hermes Agent 调用。
      </div>

      {/* 错误横幅 */}
      {error ? (
        <div className="mb-3 text-xs bg-(--status-danger-bg) border border-(--border) rounded-lg px-3 py-2 text-(--status-danger-text)">
          {error}
        </div>
      ) : null}

      {/* 空状态 */}
      {skills.length === 0 ? (
        <div className="text-sm text-(--muted-foreground)">此插件暂无 Skill</div>
      ) : (
        <div className="space-y-3">
          {skills.map(s => {
            const isBusy = busy[s.path] // 当前行 busy
            return (
              <div
                key={s.path}
                className="flex items-center gap-3 p-3 rounded-lg border border-(--border) bg-(--card)"
              >
                {/* 图标 */}
                <Bot className="w-5 h-5 text-(--primary) shrink-0" />

                {/* 名称与路径 */}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{s.name}</div>
                  <div className="text-xs text-(--muted-foreground) truncate">{s.path}</div>
                  {!s.exists_in_plugin ? (
                    <div className="text-xs text-(--destructive) mt-0.5">源文件夹不存在</div>
                  ) : null}
                  {s.enabled ? (
                    <div className="text-xs text-(--status-success-text) mt-0.5">
                      已启用 · ~/.hermes/skills/{s.name}
                    </div>
                  ) : (
                    <div className="text-xs text-(--muted-foreground) mt-0.5">未启用</div>
                  )}
                </div>

                {/* 操作按钮 */}
                <div className="flex items-center gap-1.5 shrink-0">
                  {s.enabled ? (
                    <>
                      <button type="button" disabled={isBusy || !s.exists_in_plugin}
                        onClick={() => runAction(s.path, 'update')}
                        className="px-2.5 py-1 text-xs rounded bg-(--primary)/10 text-(--primary) hover:brightness-90 disabled:opacity-50"
                      >
                        {isBusy ? '...' : '更新'}
                      </button>
                      <button type="button" disabled={isBusy}
                        onClick={() => runAction(s.path, 'disable')}
                        className="px-2.5 py-1 text-xs rounded bg-(--status-danger-bg) text-(--status-danger-text) hover:brightness-90 disabled:opacity-50"
                      >
                        {isBusy ? '...' : '禁用'}
                      </button>
                    </>
                  ) : (
                    <button type="button" disabled={isBusy || !s.exists_in_plugin}
                      onClick={() => runAction(s.path, 'enable')}
                      className="px-3 py-1 text-xs rounded bg-(--status-success-bg) text-(--status-success-text) hover:brightness-90 disabled:opacity-50"
                    >
                      {isBusy ? '...' : '启用'}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
