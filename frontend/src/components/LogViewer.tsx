import { useState, useEffect, useCallback, useRef } from 'react' // React hooks
import { RotateCcw, WrapText } from 'lucide-react' // 图标
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select' // shadcn 日期下拉
import type { LogsResponse } from '@/lib/types' // 类型

/** loguru 7 个等级 */
const ALL_LEVELS = ['TRACE', 'DEBUG', 'INFO', 'SUCCESS', 'WARNING', 'ERROR', 'CRITICAL'] as const

/** 行数选项 */
const LINE_COUNTS = [50, 100, 200, 500] as const

/** 等级 → Tailwind 文字颜色 */
const LEVEL_COLORS: Record<string, string> = {
  ERROR: 'text-(--log-error)',   // 红
  CRITICAL: 'text-(--log-error)',
  WARNING: 'text-(--log-warning)', // 琥珀
  DEBUG: 'text-(--log-debug)',  // 灰
  TRACE: 'text-(--log-debug)',
}

/** 从 loguru 格式行提取等级（如 "| INFO  |" → "INFO"） */
function extractLevel(line: string): string | null {
  const m = line.match(/\|\s*(\w+)\s*\|/) // 匹配第二个 | 间的单词
  return m ? m[1].toUpperCase() : null // 转大写
}

/** 获取今天日期 YYYY-MM-DD */
function todayStr(): string { return new Date().toISOString().slice(0, 10) }

/**
 * 日志查看器（抄 Hermes 方案：无虚拟滚动、无搜索、tail 后端）
 * @param api daemonApi 实例（含 getLogDates / getLogs）
 */
export default function LogViewer({ api }: { api: ReturnType<typeof import('@/lib/api').daemonApi> }) {
  // ── 状态 ──
  const [dates, setDates] = useState<string[]>([]) // 可用日期列表
  const [date, setDateRaw] = useState<string>(() => { try { return localStorage.getItem('log-date') || todayStr() } catch { return todayStr() } }) // 当前日期（持久化）
  const [levels, setLevels] = useState<Set<string>>(() => new Set(ALL_LEVELS)) // 选中的等级（默认全选）
  const [lineCount, setLineCount] = useState<number>(100) // 返回行数
  const [lines, setLines] = useState<string[]>([]) // 日志行
  const [totalLines, setTotalLines] = useState(0) // 文件总行数
  const [loading, setLoading] = useState(false) // 加载中
  const [error, setError] = useState<string | null>(null) // 错误信息
  const [wrap, setWrap] = useState(false) // 是否换行（默认不换行 = 横向滚动）
  const scrollRef = useRef<HTMLDivElement>(null) // 滚动容器
  const userScrolledUp = useRef(false) // 用户是否手动上翻

  /** 日期 setter（同步 localStorage） */
  function setDate(d: string) { setDateRaw(d); try { localStorage.setItem('log-date', d) } catch { /* */ } }

  /** ALL 是否亮起（7 个等级全选） */
  const allSelected = levels.size === ALL_LEVELS.length // 7 个全亮 = ALL 亮

  /** 等级按钮的激活态（ALL 亮时所有等级也亮；非 ALL 时看 Set） */
  const isLevelActive = useCallback((lv: string) => levels.has(lv), [levels]) // 单个等级是否亮

  // ── 加载日期列表 ──
  useEffect(() => { api.getLogDates().then(r => { if (r?.dates) setDates(r.dates) }).catch(() => { }) }, [api]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── 拉日志 ──
  const fetchLogs = useCallback(async () => {
    if (levels.size === 0) { setLines([]); return } // 空 Set = 清空显示，不发请求
    setLoading(true); setError(null) // 开始
    try {
      const res: LogsResponse = await api.getLogs({ // tail 接口
        date,                                                         // YYYY-MM-DD
        levels: [...levels].join(','),                                // 逗号拼接选中的等级
        lines: lineCount,                                             // 50/100/200/500
      })
      setLines(res.lines) // 写入
      setTotalLines(res.total_lines) // 总行数
    } catch (e) { setError(String(e)) }
    finally { setLoading(false) }
  }, [api, date, levels, lineCount])

  // ── 参数变化 → 重新拉 ──
  useEffect(() => { fetchLogs() }, [fetchLogs])

  // ── 自动刷新（5 秒，固化不可关） ──
  useEffect(() => {
    const timer = setInterval(fetchLogs, 5000) // 5 秒轮询
    return () => clearInterval(timer) // 清理
  }, [fetchLogs])

  // ── 新数据到达 → 滚底（除非用户手动上翻） ──
  useEffect(() => {
    if (userScrolledUp.current) return
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [lines])

  /** 监听手动滚动：离开底部 50px = 暂停自动滚底 */
  function handleScroll() {
    const el = scrollRef.current; if (!el) return
    userScrolledUp.current = el.scrollTop + el.clientHeight < el.scrollHeight - 50
  }

  /** 切换单个等级（选中↔取消），并自动同步 ALL 状态 */
  function toggleLevel(lv: string) {
    setLevels(prev => {
      const next = new Set(prev) // 复制
      next.has(lv) ? next.delete(lv) : next.add(lv) // toggle
      return next // ALL 通过 allSelected 自动计算
    })
  }

  /** ALL 按钮：亮 → 全暗（清空）；暗 → 全亮（全选） */
  function toggleAll() {
    setLevels(prev => prev.size === ALL_LEVELS.length ? new Set() : new Set(ALL_LEVELS)) // 全暗 ↔ 全亮
  }

  // ── 渲染 ──
  return (
    <div className="flex flex-col gap-3 h-full min-h-0">
      {/* ═══ 控制栏 ═══ */}
      <div role="toolbar" className="flex flex-wrap items-center gap-3 shrink-0 text-sm">

        {/* ① 日期下拉（shadcn Select） */}
        <Select value={date} onValueChange={(v) => setDate(v ?? todayStr())}> {/* shadcn Select 组件（v 可能为 null，兜底今天） */}
          <SelectTrigger className="w-[140px] h-8 text-xs"> {/* 触发按钮 */}
            <SelectValue /> {/* 显示当前值 */}
          </SelectTrigger>
          <SelectContent> {/* 下拉列表 */}
            {dates.map(d => ( // 动态日期
              <SelectItem key={d} value={d} className="text-xs">{d}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* ② 等级多选按钮 + ALL */}
        <div className="flex items-center gap-1 flex-wrap">
          {/* ALL 主开关：自动同步（7 个全选时亮），点击全选/全不选 */}
          <button type="button" onClick={toggleAll} // ALL 按钮
            className={`px-2 py-1 rounded text-xs font-medium border transition-colors
              ${allSelected                                               // ALL 亮 ↔ 全选
                ? 'bg-(--primary) text-(--primary-foreground) border-(--primary)'
                : 'text-(--muted-foreground) border-(--border) hover:border-(--primary)'
              }`}
          >ALL</button>

          {/* 7 个等级按钮 */}
          {ALL_LEVELS.map(lv => { // 遍历 TRACE/DEBUG/INFO/SUCCESS/WARNING/ERROR/CRITICAL
            const active = isLevelActive(lv) // 是否选中
            return (
              <button key={lv} type="button" onClick={() => toggleLevel(lv)} // toggle
                className={`px-2 py-1 rounded text-xs font-medium border transition-colors
                  ${active                                                 // 选中态
                    ? 'bg-(--primary) text-(--primary-foreground) border-(--primary)'
                    : 'text-(--muted-foreground) border-(--border) hover:border-(--primary)'
                  }`}
              >{lv}</button>
            )
          })}
        </div>

        {/* ③ 行数切换 */}
        <div className="flex items-center gap-0.5">
          {LINE_COUNTS.map(n => ( // [50] [100] [200] [500]
            <button key={n} type="button" onClick={() => setLineCount(n)}
              className={`px-2 py-1 rounded text-xs font-medium transition-colors
                ${lineCount === n ? 'bg-(--primary) text-(--primary-foreground)' : 'text-(--muted-foreground) hover:bg-(--secondary)'}`}
            >{n}</button>
          ))}
        </div>

        {/* ④ 手动刷新按钮 */}
        <button type="button" onClick={fetchLogs} disabled={loading}
          className="p-1.5 rounded hover:bg-(--secondary) disabled:opacity-50" title="刷新"
        >
          <RotateCcw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>

        {/* ⑤ 换行切换 */}
        <button type="button" onClick={() => setWrap(w => !w)} // toggle 换行
          className={`p-1.5 rounded transition-colors ${wrap ? 'bg-(--primary) text-(--primary-foreground)' : 'hover:bg-(--secondary) text-(--muted-foreground)'}`}
          title={wrap ? '关闭换行' : '开启换行'}
        >
          <WrapText className="w-4 h-4" />
        </button>

        {/* 行数统计 */}
        <span className="text-xs text-(--muted-foreground) ml-auto">
          {levels.size === 0 ? '暂无日志' : `${lines.length} / ${totalLines.toLocaleString()}`}
        </span>
      </div>

      {/* ═══ 错误横幅 ═══ */}
      {error && (
        <div className="shrink-0 bg-(--status-danger-bg) border border-(--border) rounded px-3 py-2 text-sm text-(--status-danger-text)">
          {error}
        </div>
      )}

      {/* ═══ 日志内容区 ═══ */}
      {/* wrap=false → whitespace-nowrap + 隐藏滚动条横向滚；wrap=true → 正常换行 */}
      <div ref={scrollRef} onScroll={handleScroll}
        className={`flex-1 min-h-0 overflow-auto rounded border border-(--border) bg-(--muted)/30 p-3 font-mono text-xs leading-5
          ${wrap ? '' : 'whitespace-nowrap [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden'}`}
      >
        {/* 空 Set = 全不选 → 占位 */}
        {levels.size === 0 && (
          <div className="text-(--muted-foreground) text-center py-8">暂无日志</div>
        )}
        {/* 有选中但无结果 */}
        {levels.size > 0 && lines.length === 0 && !loading && (
          <div className="text-(--muted-foreground) text-center py-8">暂无日志</div>
        )}
        {/* 日志行渲染 */}
        {lines.map((line, i) => {
          const lv = extractLevel(line) // 提取等级
          const color = (lv && LEVEL_COLORS[lv]) || '' // 等级着色
          return <div key={i} className={color}>{line}</div>
        })}
      </div>
    </div>
  )
}
