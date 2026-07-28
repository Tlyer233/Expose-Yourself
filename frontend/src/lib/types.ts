/**
 * 前端类型定义（全局共享类型）
 * 对应 Vue 项目中的 src/types/xxx.ts
 */

// ── 插件路由 Manifest ────────────────────────────────

/** daemon 启动配置（manifest.daemon 字段） */
export interface DaemonConfig {
  service_name: string // launchctl Label（如 run_chat）
  plist_src: string // plist 源文件名（如 com.hermes.chat_monitor.plist）
  plist_dest: string // plist 安装目标路径（如 ~/Library/LaunchAgents/...）
  sudo: boolean // 是否需要 sudo 权限（系统级 = true）
}

/** 日志配置（manifest.logs 字段） */
export interface LogsConfig {
  dir: string // 日志目录名（如 "log"）
}

/** UI 配置（manifest.ui 字段，有则显示「服务配置」Tab） */
export interface UiConfig {
  entry: string // iframe 入口文件名（如 "index.html"）
}

/**
 * 插件快照 Manifest
 * 对应 CONTORL_CENTER 后端 GET /api/manifests 返回的数组元素
 * 注意：不含 _dir 字段（已被后端过滤）
 */
export interface Manifest {
  name: string // 唯一 ID（必须与目录名一致）
  category?: string // 侧栏分类（点分隔，如 "BASIC.Daemon"），未设置默认 "OTHER.Default"
  displayName: string // 侧栏显示名（如 "Chat 消息同步"）
  icon: string // lucide 图标名（kebab-case，如 message-circle）
  route: string // 控制中心前端路由（如 /chat）
  daemon: DaemonConfig // daemon 启动配置
  logs: LogsConfig // 日志配置
  ui?: UiConfig // 可选：业务配置 UI
  skills?: string[] // 可选：Hermes Skill 相对路径列表
}

// ── Daemon 状态 ─────────────────────────────────────

/**
 * Daemon 运行状态 + 安装状态
 * 对应后端 GET /api/daemon/{name}/status 返回值
 */
export interface DaemonStatus {
  service: string // 插件名
  status: "running" | "stopped" // 运行状态
  installed: boolean // 是否已安装（plist 在标准目录 = 开机自启）
  output: string // launchctl 原始输出（调试用）
}

// ── API 通用返回 ────────────────────────────────────

/** 后端操作类 API 的通用返回格式（start/stop/restart） */
export interface ActionResult {
  action: string // 操作名（start/stop/restart）
  success: boolean // 命令是否以 exit 0 退出
  output: string // stdout 或 stderr
}

// ── 日志 API ─────────────────────────────────────────

/** 日志日期列表响应 */
export interface LogDatesResponse { dates: string[] }

/** 日志内容响应（tail 模式） */
export interface LogsResponse {
  lines: string[]       // 日志行数组
  total_lines: number   // 文件总行数
  log_path: string      // 日志文件完整路径
}

/** 获取日志的查询参数 */
export interface LogsParams {
  date: string          // YYYY-MM-DD
  levels?: string       // 逗号分隔的等级，如 "ERROR,WARNING"，空=全选
  lines?: number        // 返回行数（默认 100）
}

// ── Skills API ────────────────────────────────────────

/** 单个 Skill 状态（对应 GET /daemon/{name}/skills 返回） */
export interface SkillItem {
  path: string             // manifest 相对路径（如 skills/chat-query）
  name: string             // skill 文件夹名
  src: string              // 源绝对路径
  dst: string              // 目标 ~/.hermes/skills/<name>
  enabled: boolean         // 是否已启用
  exists_in_plugin: boolean // 插件内目录是否存在
}

/** skillAction 请求体 */
export interface SkillActionRequest {
  path: string             // manifest 中的相对路径
  action: 'enable' | 'update' | 'disable'
}
