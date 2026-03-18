export type ResourceType = 
  | 'all'
  | 'fetch'
  | 'doc'
  | 'css'
  | 'js'
  | 'font'
  | 'img'
  | 'media'
  | 'manifest'
  | 'websocket'
  | 'wasm'
  | 'other'

export interface ProxyRecord {
  id?: number
  method: string
  source: string
  target: string
  time: string
  mock?: boolean
  protocol?: string // 'h2' | 'h1.1'
  statusCode?: number
  duration?: number // milliseconds
  /** 来自「插件测试」的请求，会在日志页显示「插件测试」标识 */
  _fromPluginTest?: boolean
}

export interface RecordDetail {
  requestHeaders: Record<string, string>
  requestBody: string
  responseHeaders: Record<string, string>
  responseBody: string
  statusCode: number
  statusMessage: string
  inspection?: RequestInspection
}

export interface RuleItem {
  enabled: boolean
  rule: string
  target: string
}

export interface MockRule {
  id: number
  name: string
  urlPattern: string
  method: string
  statusCode: number
  delay: number // milliseconds, 0 = no delay
  bodyType: 'inline' | 'file' // inline: 自定义内容, file: 本地文件路径
  headers: Record<string, string>
  body: string // bodyType=inline 时为响应内容, bodyType=file 时为文件路径
  enabled: boolean
}

export interface Plugin {
  id: string
  name: string
  version: string
  hooks: string[]
  permissions: string[]
  priority: number
  state: 'running' | 'stopped' | 'error' | 'disabled' | 'ready' | 'registered'
  stats: Record<string, unknown> | null
}

export interface RuleFile {
  name: string
  enabled: boolean
  ruleCount: number
}

// ===== Request Inspection: 请求生命周期追踪 =====

export interface InspectionStage {
  name: string           // 插件/模块名称
  type: 'builtin' | 'custom' | 'system'  // 类型
  hook: string           // hook 名称
  status: 'ok' | 'error' | 'skipped' | 'short-circuited'  // 状态
  duration: number       // 执行时间 (ms)
  target?: string        // 处理后的 target
  shortCircuited?: boolean  // 是否短路（提前返回）
  // 变化内容
  changes?: {
    target?: string       // target 变化
    targetBefore?: string
    targetAfter?: string
    requestHeaders?: Record<string, string>  // 请求头变化
    requestHeadersBefore?: Record<string, string>
    requestHeadersAfter?: Record<string, string>
    responseHeaders?: Record<string, string> // 响应头变化
    responseHeadersBefore?: Record<string, string>
    responseHeadersAfter?: Record<string, string>
    responseStatusCode?: number   // 响应状态码变化
    responseStatusCodeBefore?: number
    responseStatusCodeAfter?: number
    responseBody?: string  // 响应体变化（仅适用于 short-circuit）
    responseBodyBefore?: string
    responseBodyAfter?: string
  }
  error?: string         // 错误信息
}

export interface RequestInspection {
  url: string
  method: string
  stages: InspectionStage[]
  totalDuration: number
}
