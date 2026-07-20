import { getAIConfig, getActiveModel, isAIConfigValid, type AIConfig } from '@/lib/ai-config-store'

export interface RuleMergeContextFile {
  name: string
  content: string
}

function cleanAIResponse(text: string): string {
  return text
    .replace(/^```[a-z]*\n?/i, '')
    .replace(/\n?```$/i, '')
    .trim()
}

function resolveAIConfig(): AIConfig {
  const config = getAIConfig()
  const activeModel = getActiveModel(config)

  if (activeModel) {
    return {
      enabled: config.enabled,
      provider: activeModel.provider,
      apiKey: activeModel.apiKey,
      baseUrl: activeModel.baseUrl,
      model: activeModel.model,
    }
  }

  return config
}

function getPrompts(currentRulesText: string, contextFiles: RuleMergeContextFile[]): { system: string; user: string } {
  const systemRulesSection = contextFiles.length > 0
    ? contextFiles
      .map((file) => `### ${file.name}\n${file.content.trim() || '(empty)'}`)
      .join('\n\n')
    : '(none)'

  return {
    system: `你是 Meddle 的路由规则整理助手。你的任务是合并和精简用户的路由规则，在不改变语义的前提下尽量减少规则数量。

请严格遵守以下要求：
1. 只输出最终规则文本，不要输出解释、标题、Markdown 代码块或额外说明。
2. 输出格式必须是 Meddle 当前支持的 EPRC 文本格式，每行一条规则，target 固定在最后：
   pattern pattern1 ... !exclusion !exclusion2 ... target
3. pattern 匹配的是完整请求 URL。
4. 可以使用通配符，例如 *.wps.cn，它可以匹配 wps.cn 及其所有子域名。
5. 只有在多个规则拥有相同 target 且 exclusions 完全一致、并且可以安全合并时，才允许合并。
6. 可以合并为更少的多 pattern 规则，或者在安全时合并为通配符/正则。
7. 不要引入新的 target、不要删除必要的 exclusion、不要扩大匹配范围导致语义变化。
8. 更具体的规则应排在更宽泛的规则前面。
9. 对无法安全合并的规则，保持原样。
10. “系统路由规则”仅作为上下文参考，你只能重写“当前用户规则”。

系统路由规则上下文如下：
${systemRulesSection}`,
    user: `请合并并精简下面这份“当前用户规则”，返回合并后的最终规则文本：

${currentRulesText.trim() || '(empty)'}`,
  }
}

function getRuleGenerationPrompts(
  requirementPrompt: string,
  currentRulesText: string,
  contextFiles: RuleMergeContextFile[]
): { system: string; user: string } {
  const systemRulesSection = contextFiles.length > 0
    ? contextFiles
      .map((file) => `### ${file.name}\n${file.content.trim() || '(empty)'}`)
      .join('\n\n')
    : '(none)'

  return {
    system: `你是 Meddle 的路由规则生成助手。你的任务是根据用户的自然语言需求，生成可以直接使用的 EPRC 路由规则文本。

请严格遵守以下要求：
1. 只输出最终规则文本，不要输出解释、标题、Markdown 代码块或额外说明。
2. 输出格式必须是 Meddle 当前支持的 EPRC 文本格式，每行一条规则，target 固定在最后：
   pattern pattern1 ... !exclusion !exclusion2 ... target
3. pattern 匹配的是完整请求 URL。
4. 可以使用通配符，例如 *.wps.cn，它可以匹配 wps.cn 及其所有子域名。
5. 可以生成多行规则；更具体的规则必须排在更宽泛的规则前面。
6. 只有在安全时才使用通配符或正则，不要为了压缩规则数量而扩大匹配范围。
7. 不要编造不确定的域名、路径或 target；需求不明确时，优先保守生成。
8. “系统路由规则”和“当前用户规则”仅作为上下文参考，用于避免重复和冲突；你输出的是需要新增的规则。
9. 生成的结果必须能被系统直接解析和保存。

系统路由规则上下文如下：
${systemRulesSection}`,
    user: `请根据下面的需求生成可直接使用的路由规则：

需求：
${requirementPrompt.trim()}

当前用户规则如下，生成时请尽量避免重复：
${currentRulesText.trim() || '(empty)'}`,
  }
}

async function requestOpenAI(config: AIConfig, systemPrompt: string, userPrompt: string): Promise<string> {
  const response = await fetch(config.baseUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.1,
      max_tokens: 3000,
    }),
  })

  if (!response.ok) {
    throw new Error(`OpenAI API 错误 (${response.status}): ${await response.text()}`)
  }

  const data = await response.json()
  const content = data.choices?.[0]?.message?.content
  if (!content || typeof content !== 'string') {
    throw new Error('OpenAI 返回了空结果')
  }
  return cleanAIResponse(content)
}

async function requestAnthropic(config: AIConfig, systemPrompt: string, userPrompt: string): Promise<string> {
  const response = await fetch(config.baseUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: 3000,
      temperature: 0.1,
      system: systemPrompt,
      messages: [
        { role: 'user', content: userPrompt },
      ],
    }),
  })

  if (!response.ok) {
    throw new Error(`Anthropic API 错误 (${response.status}): ${await response.text()}`)
  }

  const data = await response.json()
  const content = data.content?.[0]?.text
  if (!content || typeof content !== 'string') {
    throw new Error('Anthropic 返回了空结果')
  }
  return cleanAIResponse(content)
}

export async function mergeRulesWithAI(
  currentRulesText: string,
  contextFiles: RuleMergeContextFile[],
  extraPrompt?: string
): Promise<string> {
  const config = resolveAIConfig()

  if (!isAIConfigValid(config)) {
    throw new Error('AI 配置不可用，请先在设置中启用并配置可用模型')
  }

  const { system, user } = getPrompts(currentRulesText, contextFiles)
  const finalUserPrompt = extraPrompt?.trim()
    ? `${user}

额外优化要求：
${extraPrompt.trim()}`
    : user

  if (config.provider === 'anthropic') {
    return requestAnthropic(config, system, finalUserPrompt)
  }

  return requestOpenAI(config, system, finalUserPrompt)
}

export async function generateRulesWithAI(
  requirementPrompt: string,
  currentRulesText: string,
  contextFiles: RuleMergeContextFile[]
): Promise<string> {
  const config = resolveAIConfig()

  if (!isAIConfigValid(config)) {
    throw new Error('AI 配置不可用，请先在设置中启用并配置可用模型')
  }

  if (!requirementPrompt.trim()) {
    throw new Error('请输入用于生成规则的提示词')
  }

  const { system, user } = getRuleGenerationPrompts(requirementPrompt, currentRulesText, contextFiles)

  if (config.provider === 'anthropic') {
    return requestAnthropic(config, system, user)
  }

  return requestOpenAI(config, system, user)
}
