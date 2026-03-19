import { useState } from 'react'
import { useLogs } from './use-logs'
import { useRules } from './use-rules'
import { useMocks } from './use-mocks'
import { usePlugins } from './use-plugins'

/**
 * Composed store hook that combines all domain-specific hooks
 */
export function useProxyStore() {
  const [maxRecords, setMaxRecords] = useState(1000)

  const logs = useLogs(maxRecords)
  const rules = useRules()
  const mocks = useMocks()
  const plugins = usePlugins()

  return {
    // Logs
    records: logs.records,
    selectedRecordId: logs.selectedRecordId,
    recordDetail: logs.recordDetail,
    detailLoading: logs.detailLoading,
    detailError: logs.detailError,
    fetchDetail: logs.fetchDetail,
    closeDetail: logs.closeDetail,
    clearRecords: logs.clearRecords,
    replayRequest: logs.replayRequest,
    maxRecords,
    setMaxRecords,

    // Rules
    rules: rules.rules,
    setRules: rules.setRules,
    ruleFiles: rules.ruleFiles,
    activeFileName: rules.activeFileName,
    fetchRuleFiles: rules.fetchRuleFiles,
    fetchFileContent: rules.fetchFileContent,
    saveFileContent: rules.saveFileContent,
    createRuleFile: rules.createRuleFile,
    toggleRuleFile: rules.toggleRuleFile,
    deleteRuleFile: rules.deleteRuleFile,

    // Mocks
    mockRules: mocks.mockRules,
    fetchMocks: mocks.fetchMocks,
    createMock: mocks.createMock,
    updateMock: mocks.updateMock,
    deleteMock: mocks.deleteMock,

    // Plugins
    plugins: plugins.plugins,
    pluginMode: plugins.pluginMode,
    switchPluginMode: plugins.switchPluginMode,
    thirdPartyPlugins: plugins.thirdPartyPlugins,
    thirdPartySecurity: plugins.thirdPartySecurity,
    fetchPlugins: plugins.fetchPlugins,
    startPlugin: plugins.startPlugin,
    stopPlugin: plugins.stopPlugin,
    togglePlugin: plugins.togglePlugin,
    fetchThirdPartyPlugins: plugins.fetchThirdPartyPlugins,
    loadThirdPartyPlugin: plugins.loadThirdPartyPlugin,
    unloadThirdPartyPlugin: plugins.unloadThirdPartyPlugin,
  }
}
