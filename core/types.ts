// Core type definitions for the plugin system

export interface Logger {
    debug(...args: any[]): void;
    log(...args: any[]): void;
    error(...args: any[]): void;
    warn(...args: any[]): void;
    info(...args: any[]): void;
}

// Hook names for plugin lifecycle
export type HookName = 'onRequestStart' | 'onAfterRequest' | 'onBeforeProxy' | 'onBeforeResponse' | 'onAfterResponse' | 'onError' | 'upstream';

export interface PluginManifest {
    id: string;
    name?: string;
    version: string;
    apiVersion: string;
    permissions: string[];
    hooks: string[];
    priority?: number;
    type?: string;
}

export interface Plugin {
    manifest: PluginManifest;
    setup(context: PluginContext): void | Promise<void>;
    start?(): void | Promise<void>;
    stop?(): void | Promise<void>;
    dispose?(): void | Promise<void>;
    onRequestStart?(context: HookContext): void | Promise<void>;
    onAfterRequest?(context: RequestSentContext): void | Promise<void>;
    onBeforeProxy?(context: HookContext): void | Promise<void>;
    onBeforeResponse?(context: ResponseContext): void | Promise<void>;
    onAfterResponse?(context: ResponseContext): void | Promise<void>;
    onError?(context: ErrorContext): void | Promise<void>;
    [hookName: string]: any;
}

// Plugin Context APIs

export interface PluginConfigAPI {
    get<T = unknown>(key: string, fallback?: T): T;
    set<T = unknown>(key: string, value: T): void;
}

export interface PluginStoreAPI {
    get<T = unknown>(key: string): T | undefined;
    set<T = unknown>(key: string, value: T): void;
    delete(key: string): void;
    clear(): void;
}

export interface PluginEventBusAPI {
    emit(topic: string, payload: unknown): void;
    on(topic: string, handler: (payload: unknown) => void): () => void;
    off(topic: string, handler?: (payload: unknown) => void): void;
}

export interface PluginContext {
    manifest: PluginManifest;
    log: Logger;
    config: PluginConfigAPI;
    store: PluginStoreAPI;
    eventBus: PluginEventBusAPI;
    [key: string]: any;
}

export type PluginState = 'registered' | 'ready' | 'running' | 'stopped' | 'disposed' | 'disabled' | 'unknown';

export interface Request {
    method?: string;
    url?: string;
    headers?: Record<string, string | string[]>;
    body?: any;
}

export interface Response {
    statusCode: number;
    headers: Record<string, string | string[]>;
    body: string | Buffer;
}

export interface HookContext {
    request: Request;
    target: string;
    meta: Record<string, any>;
    shortCircuited: boolean;
    shortCircuitResponse: Response | null;
    log: Logger;  // 插件日志接口
    setTarget(nextTarget: string): void;
    respond(response: Response): void;
}

export interface ResponseContext {
    request: Request;
    target: string;
    meta: Record<string, any>;
    response: Response;
    log: Logger;  // 插件日志接口
}

// Context for onAfterRequest: request has been sent, waiting for response
export interface RequestSentContext {
    request: Request;
    target: string;
    meta: Record<string, any>;
    log: Logger;  // 插件日志接口
    requestSentAt?: number;  // 请求发送时间戳（可选）
}

export interface ErrorContext {
    request: Request;
    target: string;
    meta: Record<string, any>;
    phase: HookName;
    error: Error;
    log: Logger;
}

export interface PipelineDecision {
    target: string;
    observedTarget: string;
    shortCircuited: boolean;
    response: Response | null;
    meta: Record<string, any>;
}

export interface PipelineResult {
    shortCircuited: boolean;
    response: Response;
    target: string;
    meta: Record<string, any>;
}

export type PluginMode = 'off' | 'shadow' | 'on';

export interface PipelineOptions {
    pluginManager: any;
    dispatcher: any;
    logger?: Logger;
    mode?: string;
}

export interface Pipeline {
    mode: PluginMode;
    setMode(mode: PluginMode): void;
    evaluateRequest(request: Request, initialTarget: string): Promise<PipelineDecision>;
    execute(input: PipelineExecuteInput): Promise<PipelineResult>;
    pluginManager: any;
}

export interface PipelineExecuteInput {
    request?: Request;
    initialTarget?: string;
    executeUpstream(target: string, meta: Record<string, any>): Promise<any>;
}

export interface HookDispatchResult {
    pluginId: string;
    status: 'ok' | 'error' | 'timeout' | 'skipped-disabled';
    duration: number;
    error?: string;
    contextBefore?: HookDispatchSnapshot;
    contextAfter?: HookDispatchSnapshot;
}

export interface HookDispatchSnapshot {
    target?: string;
    shortCircuited?: boolean;
    requestHeaders?: Record<string, string>;
    response?: {
        statusCode: number;
        headers: Record<string, string>;
        body: string;
    } | null;
    shortCircuitResponse?: {
        statusCode: number;
        headers: Record<string, string>;
        body: string;
    } | null;
}

export interface PluginStats {
    total: number;
    ok: number;
    error: number;
    timeout: number;
    lastHook: string | null;
    lastDuration: number | null;
    lastError: string | null;
}

export interface PluginManagerOptions {
    logger?: Logger;
    manifestValidator?: (manifest: PluginManifest) => void;
}

export interface HookDispatcherOptions {
    logger?: Logger;
    defaultTimeoutMs?: number;
}

export interface HookDispatchOptions {
    timeoutMs?: number;
}

export interface ShadowCompareEntry {
    baseTarget: string;
    observedTarget: string;
    source: string;
    method: string;
}

export interface ShadowDiffItem {
    baseTarget: string;
    observedTarget: string;
    count: number;
    lastSeenAt: number;
    latestSource: string;
}

export interface ShadowSample {
    source: string;
    method: string;
    baseTarget: string;
    observedTarget: string;
    ts: number;
}

export interface ShadowCompareStats {
    total: number;
    diff: number;
    same: number;
    diffRate: number;
    uniqueDiffPairs: number;
    topDiffs: ShadowDiffItem[];
    samples: ShadowSample[];
    lastUpdatedAt: number | null;
}

export interface ShadowCompareTrackerOptions {
    maxSamples?: number;
    maxTopDiffs?: number;
}

export interface ReadinessResult {
    ready: boolean;
    reason: string;
    total: number;
    minSamples: number;
    diffRate: number;
    maxDiffRate: number;
}

export interface ReadinessOptions {
    minSamples?: number;
    maxDiffRate?: number;
}

export interface ReadinessAdviceInput {
    mode?: string;
    readiness?: ReadinessResult;
    allowlist?: string[];
    onModeGate?: any;
}

export interface ReadinessAdvice {
    level: string;
    suggestedMode: string;
    message: string;
    nextSteps: string[];
}

export interface OnModeGateOptions {
    mode?: string;
    allowlist?: Set<string>;
}

export interface OnModeGateStats {
    checked: number;
    applied: number;
    skippedByAllowlist: number;
    skippedByMode: number;
    invalidSource: number;
}

export interface OnModeGate {
    shouldApply(source: string): boolean;
    getStats(): OnModeGateStats;
    reset(): void;
    setMode(mode: PluginMode): void;
}

export interface MockGateOptions {
    enabled: boolean;
    mode: string;
    source: string;
    rule: any;
    shouldApplyOn(source: string): boolean;
}

export interface PipelineGateOptions {
    requestPipeline: Pipeline;
    onModeGate: OnModeGate;
    enableBuiltinMockPlugin: boolean;
}

export interface PipelineGate {
    shouldApplyPipelineOnForSource(source: string): boolean;
    canUsePipelineExecuteForSource(source: string): boolean;
    shouldUsePluginMockForRequest(source: string, rule: any): boolean;
}

export interface RouteDecisionOptions {
    source: string;
    method: string;
    headers: Record<string, string | string[]>;
    reqBody: any;
    legacyTarget: string;
    requestPipeline: Pipeline;
    canUsePipelineExecuteForSource(source: string): boolean;
    observeShadowDecision?(method: string, source: string, target: string, observedTarget: string): void;
    fallbackResolve(): any;
}

export interface RouteDecisionResult {
    target: string;
    shortCircuited: boolean;
    response: Response | null;
    meta?: Record<string, any>;  // 包含 _inspectionStages 等信息
}

export interface PluginHealthInput {
    pluginStats?: Record<string, PluginStats>;
    pluginStates?: Record<string, PluginState>;
    plugins?: PluginManifest[];
}

export interface PluginHealthItem {
    id: string;
    name?: string;
    version: string;
    state: PluginState;
    health: 'healthy' | 'degraded' | 'disabled' | 'inactive';
    errorRate: number;
    stats: PluginStats | null;
}

export interface PluginHealthCounts {
    healthy: number;
    degraded: number;
    disabled: number;
    inactive: number;
}

export interface PluginHealth {
    overall: 'healthy' | 'degraded';
    total: number;
    counts: PluginHealthCounts;
    plugins: PluginHealthItem[];
}

export interface RefactorConfig {
    pluginMode: PluginMode;
    shadowWarnMinSamples: number;
    shadowWarnDiffRate: number;
    pluginOnHosts: Set<string>;
    enableBuiltinRouter: boolean;
    enableBuiltinLogger: boolean;
    enableBuiltinMock: boolean;
}

export interface RefactorConfigDeps {
    normalizeMode(mode: string): PluginMode;
    parseHostAllowlist(text: string): Set<string>;
}

export interface RefactorStatusInput {
    runtime?: any;
    mode?: string;
    allowlist?: string[];
    readiness?: ReadinessResult | null;
    advice?: ReadinessAdvice | null;
    shadowStats?: ShadowCompareStats | null;
    onModeGate?: OnModeGateStats | null;
    plugins?: PluginManifest[];
    loggerSummary?: any;
}

export interface RefactorStatus {
    generatedAt: number;
    runtime: any;
    mode: string;
    allowlist: string[];
    readiness: ReadinessResult | null;
    advice: ReadinessAdvice | null;
    shadow: ShadowCompareStats | null;
    onModeGate: OnModeGateStats | null;
    plugins: PluginManifest[];
    loggerSummary: any;
}

export interface BootstrapPluginsOptions {
    pluginManager: any;
    plugins?: Plugin[];
    contextFactory?(manifest: PluginManifest): PluginContext;
}

export interface RouterPluginOptions {
    getRuleMap(): Record<string, string>;
    getExcludeMap?(): Record<string, string[]>;
    getRouteRules?(): Array<{ pattern: string; target: string; exclusions: string[] }>;
}

export interface LoggerPluginOptions {
    maxEntries?: number;
}

export interface MockPluginOptions {
    findMatch(url: string, method?: string): MockRule | null;
}

export interface MockRule {
    id?: string | number;
    name?: string;
    bodyType?: string;
    delay?: number;
    statusCode?: number;
    headers?: Record<string, string>;
    body?: string;
}

export interface LoggerEntry {
    type: 'response' | 'error';
    method?: string;
    url?: string;
    statusCode?: number;
    duration?: number;
    ts: number;
    phase?: string;
    message?: string;
    // 路由匹配信息
    matchedRule?: string;
    matchedTarget?: string;
    // Mock 规则信息
    mockRuleId?: number;
    mockRuleName?: string;
    // 命中类型
    hitType?: 'route' | 'mock' | 'direct';
}

export interface LoggerSummary {
    totalResponses: number;
    totalErrors: number;
    byMethod: Record<string, number>;
    byStatusBucket: {
        '2xx': number;
        '3xx': number;
        '4xx': number;
        '5xx': number;
        other: number;
    };
    avgDuration: number;
    minDuration: number | null;
    maxDuration: number | null;
}

// ===== Request Inspection: 请求生命周期追踪 =====

export interface InspectionStage {
    name: string;           // 插件/模块名称
    type: 'builtin' | 'custom' | 'system';  // 类型
    hook: string;           // hook 名称
    status: 'ok' | 'error' | 'skipped' | 'short-circuited';  // 状态
    duration: number;       // 执行时间 (ms)
    target?: string;        // 处理后的 target
    shortCircuited?: boolean;  // 是否短路（提前返回）
    // 变化内容
    changes?: {
        target?: string;       // target 变化
        targetBefore?: string;
        targetAfter?: string;
        requestHeaders?: Record<string, string>;  // 请求头变化
        requestHeadersBefore?: Record<string, string>;
        requestHeadersAfter?: Record<string, string>;
        responseHeaders?: Record<string, string>; // 响应头变化
        responseHeadersBefore?: Record<string, string>;
        responseHeadersAfter?: Record<string, string>;
        responseStatusCode?: number;   // 响应状态码变化
        responseStatusCodeBefore?: number;
        responseStatusCodeAfter?: number;
        responseBody?: string;  // 响应体变化（仅适用于 short-circuit）
        responseBodyBefore?: string;
        responseBodyAfter?: string;
    };
    error?: string;         // 错误信息
}

export interface RequestInspection {
    url: string;
    method: string;
    stages: InspectionStage[];
    totalDuration: number;
}

export interface BuiltinPluginsOptions {
    enableMock: boolean;
    enableRouter: boolean;
    enableLogger: boolean;
    createMockPlugin(options: MockPluginOptions): Plugin;
    createRouterPlugin(options: RouterPluginOptions): Plugin;
    findMockMatch?(url: string, method?: string): MockRule | null;
    getRuleMap?(): Record<string, string>;
    getExcludeMap?(): Record<string, string[]>;
    getRouteRules?(): Array<{ pattern: string; target: string; exclusions: string[] }>;
    loggerPlugin?: Plugin;
}

// ===== ProxyContext: shared mutable state for the proxy server =====

export interface ProxyRecord {
    id?: number;
    method: string;
    source: string;
    target: string;
    time: string;
    statusCode?: number;
    duration?: number;
    mock?: boolean;
    mapLocal?: boolean;
    protocol?: string;
    _fromPluginTest?: boolean;
}

export interface ProxyRecordDetail {
    requestHeaders: Record<string, string | string[] | undefined>;
    requestBody?: string;
    responseHeaders: Record<string, string | string[] | undefined>;
    responseBody?: string;
    statusCode: number;
    statusMessage?: string;
    method: string;
    url: string;
    inspection?: RequestInspection;
}

export interface ProxyContext {
    epDir: string;
    certDir: string;
    settingsPath: string;
    AUTO_OPEN: boolean;
    REFACTOR_CONFIG: RefactorConfig;
    INITIAL_PLUGIN_MODE: PluginMode;
    MAX_RECORD_SIZE: number;
    MAX_DETAIL_SIZE: number;
    MAX_BODY_SIZE: number;
    SHADOW_WARN_MIN_SAMPLES: number;
    SHADOW_WARN_DIFF_RATE: number;
    PLUGIN_ON_HOSTS: Set<string>;
    ENABLE_BUILTIN_ROUTER_PLUGIN: boolean;
    ENABLE_BUILTIN_LOGGER_PLUGIN: boolean;
    ENABLE_BUILTIN_MOCK_PLUGIN: boolean;

    pluginManager: any;
    hookDispatcher: any;
    requestPipeline: Pipeline;
    builtinLoggerPlugin: Plugin;
    shadowCompareTracker: any;
    onModeGate: OnModeGate;
    pipelineGate: PipelineGate;

    routeRules: Array<{ pattern: string; target: string; exclusions: string[] }>;
    ruleMap: Record<string, string>;
    excludeMap: Record<string, string[]>;
    currentMocksPath: string | null;
    mockRules: MockRuleEntry[];
    mockIdSeq: number;
    proxyRecordArr: ProxyRecord[];
    recordIdSeq: number;
    proxyRecordDetailMap: Map<number, ProxyRecordDetail>;
    httpsServerMap: Map<string, any>;

    localWSServer: any;
}

export interface MockRuleEntry {
    id: number;
    name: string;
    urlPattern: string;
    method: string;
    statusCode: number;
    delay: number;
    bodyType: string;
    headers: Record<string, string>;
    body: string;
    enabled: boolean;
}

export interface ProxyResponse {
    statusCode: number;
    statusMessage: string;
    headers: Record<string, string | string[] | undefined>;
    stream: NodeJS.ReadableStream;
    protocol: string;
}

export interface InterceptOptions {
    req: any;
    res: any;
    source: string;
    target: string;
    startTime: number;
    statusCode: number;
    headers: Record<string, any>;
    bodyBuffer: Buffer;
    reqBody: Buffer;
    inspectionMeta?: Record<string, any>;
    cleanHeaders?: (h: Record<string, any>) => Record<string, any>;
}

export interface MockHandler {
    getMockFilePath(): string;
    loadMockRules(): void;
    saveMockRules(): void;
    matchMockRule(url: string, method: string): MockRuleEntry | null;
    buildMockResponseForTest(rule: MockRuleEntry): { statusCode: number; headers: Record<string, string>; body: string };
    sendMockResponse(req: any, res: any, rule: MockRuleEntry, logInfo: { method: string; source: string; target: string }): void;
    loadCustomPathsFromSettings(): { mocksFilePath: string | null };
}

export interface DiagnosticCheck {
    name: string;
    status: string;
    path?: string;
    details?: unknown;
}

export interface DiagnosticsResult {
    status: string;
    checks: DiagnosticCheck[];
    errors: string[];
    warnings: string[];
}
