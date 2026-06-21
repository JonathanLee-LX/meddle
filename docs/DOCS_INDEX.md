# Easy Proxy 文档索引

本文档提供了 Easy Proxy 项目所有文档的索引，帮助开发者快速找到需要的信息。

## 用户文档

### 使用指南

- **[README.md](../README.md)** - 项目主文档
  - 安装和使用说明
  - 配置文件格式
  - MCP Server 使用

### 配置文档

- **[CONFIG_STRUCTURE.md](../CONFIG_STRUCTURE.md)** - 配置文件结构说明
  - 目录结构
  - 路由规则配置 (.eprc)
  - Mock 规则配置
  - 系统设置
  - SSL 证书

### 日志与来源识别

- **[请求来源应用识别](./APPLICATION_IDENTITY.md)**
  - macOS 本机进程反查
  - 远程设备 User-Agent 推断
  - 可信度、日志字段与 HTTPS 限制
  - 自动化功能测试

## API 和 CLI 文档

- **[API Reference](./API_REFERENCE.md)** ⭐ HTTP API 完整文档
  - Pipeline API（模式切换、Shadow 统计）
  - Plugins API（插件管理、生成、测试）
  - Mock Rules API
  - Route Rules API
  - Rule Files API
  - Logs API
  - Config API
  - Refactor API

- **[CLI Reference](./CLI_REFERENCE.md)** ⭐ CLI 命令完整文档
  - Proxy Commands（启动、环境配置）
  - Diagnostic Commands（doctor、status）
  - Mock Commands（list/add/update/delete）
  - Route Commands（list/show/active/add/update/delete）
  - 全局选项和环境变量

## 插件开发文档

### 快速入门

- **[插件系统完整开发指南](./plugin/PLUGIN_SYSTEM_GUIDE.md)** ⭐ 推荐首选
  - 插件系统概述和核心概念
  - 插件 Manifest 规范详解
  - 插件生命周期（setup/start/stop/dispose）
  - Hook 协议详解（onRequestStart/onBeforeProxy/onBeforeResponse/onAfterResponse/onError）
  - 上下文对象（RequestContext/ResponseContext/ErrorContext）
  - 插件能力 API（Logger/Config/Store/EventBus/HTTP）
  - 错误处理与超时机制
  - 权限模型
  - 四个完整的实战示例
  - 最佳实践（性能优化/错误处理/资源管理/日志/测试）

### 架构设计文档

- **[RFC: 插件化架构重构方案](./plugin/RFC_PLUGIN_ARCHITECTURE.md)**
  - 背景和目标
  - 架构原则
  - 目标架构分层
  - 插件模型草案
  - 现有功能迁移映射
  - 安全与治理
  - 性能预算与可观测性
  - 分阶段里程碑
  - 风险与缓解

- **[ADR-001: 插件 API 与 Hook 协议定版](./plugin/ADR-001-plugin-api.md)**
  - 决策背景和结果
  - 插件 Manifest 定义
  - 插件运行时接口
  - Hook 协议语义
  - 上下文对象定义
  - 能力 API 规范
  - 错误与超时策略
  - 权限模型
  - 版本与兼容策略

- **[ADR-002: 权限隔离](./plugin/ADR-002-permission-isolation.md)**
  - 权限与隔离策略

- **[ADR-003: 迁移回滚](./plugin/ADR-003-migration-rollback.md)**
  - 迁移与回滚机制

## 架构重构文档

- **[架构重构 README](./refactor/README_ARCH_REFACTOR.md)**
  - 架构重构说明

- **[Phase 1 任务看板](./refactor/PHASE1_TASK_BOARD.md)**
  - Phase 1 任务拆解

- **[架构重构评审清单](./refactor/ARCH_REFACTOR_REVIEW_CHECKLIST.md)**
  - 评审检查项

- **[路线图](./refactor/ROADMAP.md)**
  - 项目路线图

- **[源代码结构清理](./refactor/CLEAN_SOURCE_STRUCTURE.md)**
  - 源代码结构优化

## TypeScript 迁移文档

- **[完整 TypeScript 迁移指南](./typescript/COMPLETE_TYPESCRIPT_MIGRATION.md)**
  - TypeScript 迁移详细步骤

- **[TypeScript 重构总结（完整版）](./typescript/FULL_TYPESCRIPT_REFACTOR_SUMMARY.md)**
  - 完整重构工作总结

- **[TypeScript 重构总结](./typescript/TYPESCRIPT_REFACTOR_SUMMARY.md)**
  - 重构工作概要

- **[测试 TypeScript 重构](./typescript/TESTS_TYPESCRIPT_REFACTOR.md)**
  - TypeScript 重构测试

## 代码实现文档

### 核心模块

#### 插件运行时

- **[core/plugin-runtime.ts](../core/plugin-runtime.ts)**
  - `PluginManager` - 插件管理器
  - `HookDispatcher` - Hook 调度器
  - `validateManifest` - Manifest 验证
  - `runWithTimeout` - 超时控制

- **[core/plugin-bootstrap.ts](../core/plugin-bootstrap.ts)**
  - `bootstrapPlugins` - 插件启动流程

- **[core/plugin-health.ts](../core/plugin-health.ts)**
  - `buildPluginHealth` - 插件健康状态构建

### 测试文件

- **[tests/plugin-runtime.spec.ts](../tests/plugin-runtime.spec.ts)**
  - PluginManager 测试
  - HookDispatcher 测试
  - 优先级调度测试
  - 超时和统计测试

- **[tests/plugin-bootstrap.spec.ts](../tests/plugin-bootstrap.spec.ts)**
  - 插件启动流程测试

- **[tests/plugin-health.spec.ts](../tests/plugin-health.spec.ts)**
  - 健康状态构建测试

## 快速导航

### 我想了解...

- **如何开发一个插件？**
  → 查看 [插件系统完整开发指南](./plugin/PLUGIN_SYSTEM_GUIDE.md)

- **插件系统的设计理念？**
  → 查看 [RFC: 插件化架构重构方案](./plugin/RFC_PLUGIN_ARCHITECTURE.md)

- **插件 API 的详细规范？**
  → 查看 [ADR-001: 插件 API 与 Hook 协议定版](./plugin/ADR-001-plugin-api.md)

- **如何使用 Easy Proxy？**
  → 查看 [README.md](../README.md)

- **日志中的应用来源如何识别？**
  → 查看 [请求来源应用识别](./APPLICATION_IDENTITY.md)

- **插件运行时是如何工作的？**
  → 查看 [core/plugin-runtime.ts](../core/plugin-runtime.ts) 源码
  → 查看 [tests/plugin-runtime.spec.ts](../tests/plugin-runtime.spec.ts) 测试用例

- **有哪些插件示例？**
  → 查看 [插件系统完整开发指南](./plugin/PLUGIN_SYSTEM_GUIDE.md) 第 10 章节

## 文档贡献

如果您发现文档有误或需要改进，欢迎提交 Pull Request 或 Issue。

---

最后更新：2026-04-11（代码实现一致性校对）
