/**
 * API 请求封装
 * @description 所有后端 API 调用的统一入口（对应 Vue 项目中的 axios instance）
 *
 * 开发模式：Vite dev server 代理 /api → http://127.0.0.1:9877
 * 用户模式：FastAPI 直接 serve 前端，同源请求 /api
 *
 * 两种模式下 URL 都是 "/api/xxx"，无需写完整域名
 */
import type { Manifest, DaemonStatus, ActionResult, LogDatesResponse, LogsResponse, LogsParams, SkillItem, SkillActionRequest } from "./types" // 类型导入（仅编译期，不增加运行时体积）

const BASE_URL = "/api" // API 前缀（对应 SpringBoot 的 server.servlet.context-path）

/**
 * 基础 fetch 封装
 * @param url API 路径（如 "/manifests"，自动拼上 /api 前缀）
 * @param options fetch 额外选项（method, body, headers 等）
 * @returns 解析后的 JSON 数据，失败返回 { success: false, output: 错误信息 }
 */
export async function fetchApi(url: string, options: RequestInit = {}) {
  try {
    const response = await fetch(`${BASE_URL}${url}`, {
      ...options,
      headers: {
        "Content-Type": "application/json", // 默认 JSON 格式
        ...options.headers,                 // 允许调用方覆盖
      },
    })
    return await response.json() // 解析 JSON body
  } catch (error) {
    // 网络错误（后端未启动等）→ 返回错误对象而不是抛异常
    const message = error instanceof Error ? error.message : "请求失败"
    return { success: false, output: message }
  }
}

/**
 * 健康检查（验证后端是否连通）
 * @returns { status: "ok" } 或错误对象
 */
export async function getHealth() { return fetchApi("/health") }// GET /api/health

/**
 * 获取所有插件 manifest 列表
 * 控制中心侧栏启动时调用一次
 * @returns Manifest[] 数组
 */
export async function getManifests(): Promise<Manifest[]> { return fetchApi("/manifests") } // GET /api/manifests

/**
 * 按插件名获取 daemon API 操作对象
 * 所有方法通过 name 拼路由，保持"按插件名"一致的调用方式
 * @param name 插件名（如 "1_chat_monitor"）
 * @returns daemon 操作方法集合
 */
export function daemonApi(name: string) {
  return {
    /** 查询运行状态 + 安装状态 */
    getStatus: (): Promise<DaemonStatus> => fetchApi(`/daemon/${name}/status`),

    /** 启动（自动安装 plist + bootstrap） */
    start: (): Promise<ActionResult> => fetchApi(`/daemon/${name}/start`),

    /** 停止（bootout + rm plist，彻底移除） */
    stop: (): Promise<ActionResult> => fetchApi(`/daemon/${name}/stop`),

    /** 重启（停 + 启） */
    restart: (): Promise<ActionResult> => fetchApi(`/daemon/${name}/restart`),

    /** 可用日志日期列表 */
    getLogDates: (): Promise<LogDatesResponse> => fetchApi(`/daemon/${name}/log_dates`),

    /** tail 日志（最后 N 行，可选等级过滤） */
    getLogs: (params: LogsParams): Promise<LogsResponse> => {
      const qs = new URLSearchParams() // 构建查询字符串
      qs.set('date', params.date) // 日期必填
      if (params.levels) qs.set('levels', params.levels) // 等级（可选）
      if (params.lines) qs.set('lines', String(params.lines)) // 行数（可选）
      return fetchApi(`/daemon/${name}/logs?${qs.toString()}`) // GET /api/daemon/{name}/logs?date=...&levels=...&lines=...
    },

    /** 获取 Skills 列表（步骤 4-5） */
    getSkills: (): Promise<SkillItem[]> => fetchApi(`/daemon/${name}/skills`), // GET /api/daemon/{name}/skills

    /** 对单个 Skill 执行 enable/update/disable（步骤 4-5） */
    skillsAction: (path: string, action: SkillActionRequest['action']): Promise<{ success: boolean; error?: string }> =>
      fetchApi(`/daemon/${name}/skills/action`, {
        method: 'POST', // POST
        body: JSON.stringify({ path, action }), // 请求体
      }),
  }
}
