// 三层分析框架模式 API - 支持智谱API、Groq API和OpenRouter三选择
const { ENHANCED_COSMIC_SYSTEM_PROMPT } = require('./enhanced-prompts');
const OpenAI = require('openai');

// 智谱客户端（独立配置）
let zhipuClient = null;
function getZhipuClient() {
  // 优先使用ZHIPU专用配置，其次使用OPENAI配置（如果baseURL指向智谱）
  const zhipuApiKey = process.env.ZHIPU_API_KEY || process.env.OPENAI_API_KEY;
  const zhipuBaseUrl = process.env.ZHIPU_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4';

  if (!zhipuClient && zhipuApiKey) {
    zhipuClient = new OpenAI({
      apiKey: zhipuApiKey,
      baseURL: zhipuBaseUrl
    });
    console.log('智谱客户端已初始化');
  }
  return zhipuClient;
}

// Groq客户端（用于三层分析框架模式）
let groqClientLocal = null;
function getGroqClientLocal() {
  if (!groqClientLocal && process.env.GROQ_API_KEY) {
    try {
      const Groq = require('groq-sdk');
      groqClientLocal = new Groq({
        apiKey: process.env.GROQ_API_KEY
      });
      console.log('Groq客户端已初始化（三层分析框架专用）');
    } catch (err) {
      console.error('Groq SDK 加载失败:', err.message);
    }
  }
  return groqClientLocal;
}

// OpenRouter客户端（用于调用Gemini等多种模型）
let openRouterClient = null;
function getOpenRouterClient() {
  const openRouterApiKey = process.env.OPENROUTER_API_KEY;

  if (!openRouterClient && openRouterApiKey) {
    openRouterClient = new OpenAI({
      apiKey: openRouterApiKey,
      baseURL: 'https://openrouter.ai/api/v1',
      defaultHeaders: {
        'HTTP-Referer': process.env.OPENROUTER_REFERER || 'http://localhost:3001',
        'X-Title': process.env.OPENROUTER_TITLE || 'COSMIC Analysis Framework'
      }
    });
    console.log('OpenRouter客户端已初始化（支持Gemini等多种模型）');
  }
  return openRouterClient;
}

// 获取 OpenRouter 备选模型列表
function getOpenRouterFallbackModels() {
  const fallbackStr = process.env.OPENROUTER_FALLBACK_MODELS || 'meta-llama/llama-3.2-3b-instruct:free,mistralai/mistral-7b-instruct:free';
  return fallbackStr.split(',').map(m => m.trim()).filter(m => m.length > 0);
}

// 获取当前激活的客户端和模型配置
function getActiveClientConfig() {
  // THREE_LAYER_PROVIDER: 'zhipu' | 'groq' | 'openrouter' | 'auto'（默认auto，自动检测可用客户端）
  const provider = (process.env.THREE_LAYER_PROVIDER || 'auto').toLowerCase();

  // OpenRouter - 支持Gemini等多种模型
  if (provider === 'openrouter') {
    const client = getOpenRouterClient();
    if (client) {
      return {
        client,
        model: process.env.OPENROUTER_MODEL || 'google/gemini-2.0-flash-exp:free',
        fallbackModels: getOpenRouterFallbackModels(),
        provider: 'openrouter',
        useGroqSDK: false
      };
    }
  }

  if (provider === 'groq') {
    const client = getGroqClientLocal();
    if (client) {
      return {
        client,
        model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
        fallbackModels: [],
        provider: 'groq',
        useGroqSDK: true
      };
    }
  }

  if (provider === 'zhipu') {
    const client = getZhipuClient();
    if (client) {
      return {
        client,
        model: process.env.ZHIPU_MODEL || process.env.OPENAI_MODEL || 'glm-4-flash',
        fallbackModels: [],
        provider: 'zhipu',
        useGroqSDK: false
      };
    }
  }

  // auto 模式：优先使用智谱（国内稳定），其次 OpenRouter，最后 Groq
  if (provider === 'auto') {
    // 优先 智谱（国内稳定，推荐）
    const zpClient = getZhipuClient();
    if (zpClient) {
      return {
        client: zpClient,
        model: process.env.ZHIPU_MODEL || process.env.OPENAI_MODEL || 'glm-4-flash',
        fallbackModels: [],
        provider: 'zhipu',
        useGroqSDK: false
      };
    }

    // 其次 OpenRouter（Gemini 2.0 Flash 免费且强大）
    const orClient = getOpenRouterClient();
    if (orClient) {
      return {
        client: orClient,
        model: process.env.OPENROUTER_MODEL || 'google/gemini-2.0-flash-exp:free',
        fallbackModels: getOpenRouterFallbackModels(),
        provider: 'openrouter',
        useGroqSDK: false
      };
    }

    // 最后 Groq
    const gqClient = getGroqClientLocal();
    if (gqClient) {
      return {
        client: gqClient,
        model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
        fallbackModels: [],
        provider: 'groq',
        useGroqSDK: true
      };
    }
  }

  return null;
}

// 三层分析框架 - 循环调用API（支持智谱、Groq和OpenRouter三选择）
async function threeLayerAnalyze(req, res, getOpenAIClient) {
  try {
    const { documentContent, previousResults = [], round = 1, targetFunctions = 30, understanding = null, userGuidelines = '', provider = null } = req.body;

    // 如果前端指定了provider，临时覆盖环境变量
    const originalProvider = process.env.THREE_LAYER_PROVIDER;
    if (provider) {
      process.env.THREE_LAYER_PROVIDER = provider;
      console.log(`三层分析框架 - 使用前端指定的提供商: ${provider}`);
    }

    // 尝试获取专用客户端配置
    let clientConfig = getActiveClientConfig();

    // 恢复原始环境变量
    if (provider && originalProvider !== undefined) {
      process.env.THREE_LAYER_PROVIDER = originalProvider;
    } else if (provider) {
      delete process.env.THREE_LAYER_PROVIDER;
    }

    // 如果专用配置不可用，回退到传入的OpenAI客户端
    if (!clientConfig) {
      const fallbackClient = getOpenAIClient();
      if (fallbackClient) {
        clientConfig = {
          client: fallbackClient,
          model: process.env.OPENAI_MODEL || 'glm-4-flash',
          provider: 'openai-compatible',
          useGroqSDK: false
        };
      }
    }

    if (!clientConfig) {
      return res.status(400).json({
        error: '请先配置API密钥。支持以下方式：\n1. 配置OPENROUTER_API_KEY使用OpenRouter（推荐，可调用Gemini）\n2. 配置GROQ_API_KEY使用Groq\n3. 配置ZHIPU_API_KEY使用智谱\n4. 配置OPENAI_API_KEY使用兼容API'
      });
    }

    const { client, model, fallbackModels = [], provider: activeProvider, useGroqSDK } = clientConfig;

    // 构建模型尝试列表：主模型 + 备选模型
    const modelsToTry = [model, ...fallbackModels];
    let currentModelIndex = 0;
    let currentModel = model;

    const completedFunctions = previousResults.map(r => r.functionalProcess).filter(Boolean);
    const uniqueCompleted = [...new Set(completedFunctions)];

    const usedSubProcessDescs = previousResults.map(r => r.subProcessDesc).filter(Boolean);
    const uniqueSubProcessDescs = [...new Set(usedSubProcessDescs)];

    let understandingContext = '';
    if (understanding) {
      const modules = understanding.coreModules || [];
      const modulesList = modules.map(m => {
        const functions = m.estimatedFunctions || [];
        const funcList = Array.isArray(functions) && functions.length > 0 && typeof functions[0] === 'object'
          ? functions.map(f => `  · ${f.functionName} [${f.triggerType}] - ${f.scenario || ''}`).join('\n')
          : functions.map(f => `  · ${f}`).join('\n');
        return `- **${m.moduleName}**：\n${funcList}`;
      }).join('\n\n');

      const breakdown = understanding.functionBreakdown || {};
      const triggerStats = breakdown.userTriggeredFunctions || breakdown.timerTriggeredFunctions || breakdown.interfaceTriggeredFunctions
        ? `
**触发方式分布统计**：
- 用户触发功能：${breakdown.userTriggeredFunctions || 0}个
- 时钟触发功能：${breakdown.timerTriggeredFunctions || 0}个
- 接口触发功能：${breakdown.interfaceTriggeredFunctions || 0}个`
        : '';

      understandingContext = `
## 文档深度理解结果（三层分析框架）：
- 项目名称：${understanding.projectName || '未知'}
- 系统架构：${understanding.systemArchitecture || '待确定'}
- 数据实体：${(understanding.dataEntities || []).join('、') || '待识别'}
${triggerStats}
- 预估功能过程总数：${understanding.totalEstimatedFunctions || 30}

**核心模块及功能（含触发方式和使用场景）：**
${modulesList || '暂无'}

---

**三层分析框架要求：**

1. **第一层：确定FP边界** - 严格按照标注的触发方式填写"功能用户"和"触发事件"列
2. **第二层：确定数据组边界** - 必须100%采用文档表格中定义的具体字段，禁止使用通用属性
3. **第三层：ERWX闭环填充** - 每个功能过程必须有完整的E+R+W+X四个子过程

`;
    }

    let userPrompt = '';
    if (round === 1) {
      let guidelinesContext = '';
      if (userGuidelines) {
        guidelinesContext = `\n\n## 用户特定的拆分要求（请务必严格遵守）：\n**${userGuidelines}**\n`;
      }

      userPrompt = `以下是功能文档内容：
${guidelinesContext}
${documentContent}

${understandingContext}

## 三层分析框架核心原则

### ⚠️ 最重要原则：只拆分文档中明确描述的功能！
- **严禁臆造**：不要添加文档中没有提到的功能
- **严禁扩展**：不要为了凑数量而拆分出额外的功能
- **忠于原文**：功能名称必须与文档描述保持一致
- **有多少拆多少**：文档描述了几个功能就拆几个，不多不少

### 第一层：确定FP边界（只识别文档明确描述的功能）
- 只识别文档中**明确写出**的功能，不要推测或扩展
- 如果文档只写了"查询"，就只拆"查询"，不要自动补充"新增、修改、删除"
- 如果文档没有提到某个功能，就不要拆分它

### 第二层：确定数据组边界
- 使用文档中定义的具体字段
- 如果文档没有详细字段说明，使用合理的业务字段

### 第三层：ERWX闭环填充
- 每个功能过程必须有完整的E+R+W+X四个子过程
- E：接收请求参数
- R：读取相关数据
- W：写入/更新数据（查询功能写入查询日志）
- X：返回结果

## 输出格式要求：
**只输出一个Markdown数据表格，不要输出任何格式说明或其他解释文字！**

|功能用户|触发事件|功能过程|子过程描述|数据移动类型|数据组|数据属性|
|:---|:---|:---|:---|:---|:---|:---|
|用户触发|用户请求|[功能名称]|接收[功能名称]请求参数|E|[功能名称]请求数据|字段1、字段2、字段3|
||||读取[功能名称]相关数据|R|[功能名称]关联数据|字段1、字段2、字段3|
||||保存/更新[功能名称]数据|W|[功能名称]持久化数据|字段1、字段2、字段3|
||||返回[功能名称]结果|X|[功能名称]响应数据|返回码、提示消息、业务数据|

**再次强调：只拆分文档中明确描述的功能，不要自己添加功能！**`;
    } else {
      // 后续轮次：重点是判断文档是否已拆完，而不是鼓励挖掘更多
      userPrompt = `## 任务：检查文档是否还有未拆分的功能

**原始文档内容：**
${documentContent.substring(0, 8000)}${documentContent.length > 8000 ? '\n...(文档已截断)' : ''}

**已完成的功能过程（${uniqueCompleted.length}个）：**
${uniqueCompleted.join('、')}

---

## 🚨 核心原则：只拆分文档中明确描述的功能！

请仔细对比上述"原始文档内容"和"已完成的功能过程"：

1. **逐一检查文档中的每个功能描述**，看是否已经在"已完成"列表中
2. **只有文档中明确写出但尚未拆分的功能**才需要继续拆分
3. **严禁臆造**：不要添加文档中没有提到的功能
4. **严禁扩展**：如果文档只写了"查询"，不要自动补充"新增、修改、删除"

## 判断标准：

- ✅ 如果文档中**所有明确描述的功能都已拆分**，请直接回复：**[ALL_DONE]**
- ✅ 如果文档中**还有明确描述但未拆分的功能**，请只拆分这些功能，输出Markdown表格

## 输出格式（如有未拆分功能）：

|功能用户|触发事件|功能过程|子过程描述|数据移动类型|数据组|数据属性|
|:---|:---|:---|:---|:---|:---|:---|
|...|...|...|...|...|...|...|

**再次强调：如果文档中的功能都已拆分完成，请直接回复 [ALL_DONE]，不要勉强继续！**`;
    }

    const systemMessage = {
      role: 'system',
      content: ENHANCED_COSMIC_SYSTEM_PROMPT
    };

    console.log(`三层分析框架 - 第 ${round} 轮分析开始，已完成 ${uniqueCompleted.length} 个功能过程...`);
    console.log(`使用提供商: ${activeProvider}, 主模型: ${model}`);
    if (fallbackModels.length > 0) {
      console.log(`备选模型: ${fallbackModels.join(', ')}`);
    }

    // 带模型故障转移和重试机制的API调用
    let completion = null;
    let lastError = null;
    let usedModel = model; // 最终成功使用的模型
    const maxRetriesPerModel = 2; // 每个模型最多重试2次
    const retryDelay = 3000; // 重试延迟3秒

    // 尝试所有模型（主模型 + 备选模型）
    for (let modelIndex = 0; modelIndex < modelsToTry.length; modelIndex++) {
      currentModel = modelsToTry[modelIndex];

      if (modelIndex > 0) {
        console.log(`\n🔄 三层分析框架 - 切换到备选模型: ${currentModel}`);
      }

      // 对当前模型进行重试
      for (let attempt = 0; attempt < maxRetriesPerModel; attempt++) {
        try {
          if (attempt > 0) {
            console.log(`三层分析框架 - 模型 ${currentModel} 第 ${attempt + 1} 次重试...`);
            await sleep(retryDelay);
          }

          if (useGroqSDK) {
            // Groq SDK 调用方式
            completion = await client.chat.completions.create({
              model: currentModel,
              messages: [
                systemMessage,
                { role: 'user', content: userPrompt }
              ],
              temperature: 0.5,
              max_tokens: 8000
            });
          } else {
            // OpenAI 兼容 API 调用方式（智谱、OpenRouter等）
            completion = await client.chat.completions.create({
              model: currentModel,
              messages: [
                systemMessage,
                { role: 'user', content: userPrompt }
              ],
              temperature: 0.5,
              max_tokens: 8000
            });
          }

          // 成功
          usedModel = currentModel;
          if (currentModel !== model) {
            console.log(`✅ 三层分析框架 - 备选模型 ${currentModel} 调用成功！`);
          }
          break;
        } catch (err) {
          lastError = err;
          const errorMessage = err.message || '';
          const statusCode = err.status || err.statusCode || (err.response && err.response.status);

          console.error(`三层分析框架 - 模型 ${currentModel} 调用失败 (尝试 ${attempt + 1}/${maxRetriesPerModel}):`, errorMessage);

          // 判断错误类型
          const isRateLimitError = statusCode === 429 || errorMessage.includes('rate limit') || errorMessage.includes('too many requests') || errorMessage.includes('Rate limit');
          const isTokenLimitError = errorMessage.includes('token') || errorMessage.includes('context length') || errorMessage.includes('maximum');
          const isServerError = statusCode >= 500 && statusCode < 600;
          const isNetworkError = errorMessage.includes('ECONNRESET') || errorMessage.includes('ETIMEDOUT') || errorMessage.includes('network');

          // 如果是速率限制错误，直接切换到下一个模型（不再重试当前模型）
          if (isRateLimitError) {
            console.log(`⚠️ 三层分析框架 - 模型 ${currentModel} 遇到速率限制，切换到下一个模型...`);
            break; // 跳出当前模型的重试循环，尝试下一个模型
          }

          // 如果是token超限，尝试缩短prompt后重试
          if (isTokenLimitError && attempt < maxRetriesPerModel - 1) {
            console.log('三层分析框架 - 检测到Token超限，尝试缩短提示词...');
            if (userPrompt.length > 10000) {
              userPrompt = userPrompt.substring(0, Math.floor(userPrompt.length * 0.7)) + '\n...(文档已截断)';
              console.log(`三层分析框架 - 提示词已缩短至 ${userPrompt.length} 字符`);
              continue;
            }
          }

          // 如果是服务器错误或网络错误，可以重试
          if ((isServerError || isNetworkError) && attempt < maxRetriesPerModel - 1) {
            console.log(`三层分析框架 - 检测到 ${isServerError ? '服务器错误' : '网络错误'}，将在 ${retryDelay / 1000}秒后重试...`);
            continue;
          }

          // 当前模型的所有重试都失败了，尝试下一个模型
          if (attempt === maxRetriesPerModel - 1) {
            console.log(`❌ 三层分析框架 - 模型 ${currentModel} 所有重试均失败`);
          }
        }
      }

      // 如果成功获得结果，跳出模型循环
      if (completion) {
        break;
      }
    }

    if (!completion) {
      const triedModels = modelsToTry.slice(0, currentModelIndex + 1).join(', ');
      throw new Error(`所有模型均失败: ${triedModels}. 最后错误: ${lastError?.message || '未知错误'}`);
    }

    const reply = completion.choices[0].message.content;
    console.log(`三层分析框架 - 第 ${round} 轮完成（${activeProvider}/${usedModel}），响应长度: ${reply.length}`);

    let isDone = false;

    if (reply.includes('[ALL_DONE]') || reply.includes('已完成') || reply.includes('全部拆分') || reply.includes('无需补充')) {
      isDone = true;
      console.log('三层分析框架 - 检测到完成标记');
    }

    const hasValidTable = reply.includes('|') && (reply.includes('|E|') || reply.includes('| E |') || reply.match(/\|[^|]*\|[^|]*\|[^|]*\|[^|]*\|E\|/));
    if (!hasValidTable && round > 1) {
      isDone = true;
      console.log('三层分析框架 - 回复中没有有效表格，认为已完成');
    }

    if (uniqueCompleted.length >= targetFunctions) {
      isDone = true;
      console.log(`三层分析框架 - 已完成 ${uniqueCompleted.length} 个功能过程，达到目标 ${targetFunctions}`);
    }

    if (round >= 5) {
      isDone = true;
      console.log('三层分析框架 - 轮次达到上限(5轮)，强制停止');
    }

    if (reply.length < 100 && round > 1) {
      isDone = true;
      console.log('三层分析框架 - 回复内容过短，认为已完成');
    }

    res.json({
      success: true,
      reply: reply,
      round: round,
      isDone: isDone,
      completedFunctions: uniqueCompleted.length,
      targetFunctions,
      mode: 'three-layer',
      provider: activeProvider,
      model: usedModel,  // 实际使用的模型（可能是主模型或备选模型）
      originalModel: model,  // 原始配置的主模型
      usedFallback: usedModel !== model  // 是否使用了备选模型
    });
  } catch (error) {
    console.error('三层分析框架分析失败:', error);

    // 更详细的错误信息
    const errorMessage = error.message || '未知错误';
    const statusCode = error.status || error.statusCode || (error.response && error.response.status);

    let userFriendlyError = '分析失败: ' + errorMessage;

    // 针对不同错误给出建议
    if (statusCode === 429 || errorMessage.includes('rate limit')) {
      userFriendlyError = '⚠️ API速率限制：请求过于频繁，请稍后重试（建议等待1-2分钟）';
    } else if (errorMessage.includes('token') || errorMessage.includes('context length')) {
      userFriendlyError = '⚠️ Token超限：文档过长，请尝试减小文档或减少目标功能数量';
    } else if (statusCode >= 500) {
      userFriendlyError = '⚠️ 服务器错误：API服务暂时不可用，请稍后重试或切换其他提供商';
    } else if (errorMessage.includes('API key') || errorMessage.includes('authentication')) {
      userFriendlyError = '⚠️ API密钥错误：请检查API密钥是否正确配置';
    }

    res.status(500).json({
      error: userFriendlyError,
      details: errorMessage,
      suggestion: '建议：1. 稍后重试 2. 减少目标功能数量 3. 切换到其他API提供商（在.env中设置THREE_LAYER_PROVIDER）'
    });
  }
}

// 辅助函数：延迟
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { threeLayerAnalyze };

