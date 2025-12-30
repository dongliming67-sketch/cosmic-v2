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

// Google Gemini 直接API客户端（推荐：官方SDK，稳定性高）
let geminiClient = null;
let geminiModel = null;
function getGeminiClient() {
  const geminiApiKey = process.env.GEMINI_API_KEY;

  if (!geminiClient && geminiApiKey) {
    try {
      const { GoogleGenerativeAI } = require('@google/generative-ai');
      geminiClient = new GoogleGenerativeAI(geminiApiKey);
      const modelName = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
      geminiModel = geminiClient.getGenerativeModel({ model: modelName });
      console.log(`Google Gemini 客户端已初始化，模型: ${modelName}`);
    } catch (err) {
      console.error('Google Gemini SDK 加载失败:', err.message);
      console.log('提示: 请运行 npm install @google/generative-ai 安装SDK');
    }
  }
  return { client: geminiClient, model: geminiModel };
}

// 获取 OpenRouter 备选模型列表
function getOpenRouterFallbackModels() {
  const fallbackStr = process.env.OPENROUTER_FALLBACK_MODELS || 'meta-llama/llama-3.2-3b-instruct:free,mistralai/mistral-7b-instruct:free';
  return fallbackStr.split(',').map(m => m.trim()).filter(m => m.length > 0);
}

// 获取当前激活的客户端和模型配置
function getActiveClientConfig() {
  // THREE_LAYER_PROVIDER: 'gemini' | 'zhipu' | 'groq' | 'openrouter' | 'auto'（默认auto，自动检测可用客户端）
  const provider = (process.env.THREE_LAYER_PROVIDER || 'auto').toLowerCase();

  // Google Gemini 直接API - 推荐，官方SDK稳定性高
  if (provider === 'gemini') {
    const { client, model } = getGeminiClient();
    if (client && model) {
      return {
        client: model, // Gemini SDK 使用 model 对象调用
        model: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
        fallbackModels: [],
        provider: 'gemini',
        useGroqSDK: false,
        useGeminiSDK: true
      };
    }
  }

  // OpenRouter - 支持Gemini等多种模型
  if (provider === 'openrouter') {
    const client = getOpenRouterClient();
    if (client) {
      return {
        client,
        model: process.env.OPENROUTER_MODEL || 'google/gemini-2.0-flash-exp:free',
        fallbackModels: getOpenRouterFallbackModels(),
        provider: 'openrouter',
        useGroqSDK: false,
        useGeminiSDK: false
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
        useGroqSDK: true,
        useGeminiSDK: false
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
        useGroqSDK: false,
        useGeminiSDK: false
      };
    }
  }

  // auto 模式：优先使用 Gemini（推荐），其次智谱（国内稳定），最后 OpenRouter
  if (provider === 'auto') {
    // 优先 Gemini（Google官方API，推荐）
    const gemini = getGeminiClient();
    if (gemini.client && gemini.model) {
      return {
        client: gemini.model,
        model: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
        fallbackModels: [],
        provider: 'gemini',
        useGroqSDK: false,
        useGeminiSDK: true
      };
    }

    // 其次 智谱（国内稳定）
    const zpClient = getZhipuClient();
    if (zpClient) {
      return {
        client: zpClient,
        model: process.env.ZHIPU_MODEL || process.env.OPENAI_MODEL || 'glm-4-flash',
        fallbackModels: [],
        provider: 'zhipu',
        useGroqSDK: false,
        useGeminiSDK: false
      };
    }

    // 再次 OpenRouter（Gemini 2.0 Flash 免费且强大）
    const orClient = getOpenRouterClient();
    if (orClient) {
      return {
        client: orClient,
        model: process.env.OPENROUTER_MODEL || 'google/gemini-2.0-flash-exp:free',
        fallbackModels: getOpenRouterFallbackModels(),
        provider: 'openrouter',
        useGroqSDK: false,
        useGeminiSDK: false
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
        useGroqSDK: true,
        useGeminiSDK: false
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
          useGroqSDK: false,
          useGeminiSDK: false
        };
      }
    }

    if (!clientConfig) {
      return res.status(400).json({
        error: '请先配置API密钥。支持以下方式：\n1. 配置GEMINI_API_KEY使用Google Gemini（推荐）\n2. 配置OPENROUTER_API_KEY使用OpenRouter\n3. 配置GROQ_API_KEY使用Groq\n4. 配置ZHIPU_API_KEY使用智谱\n5. 配置OPENAI_API_KEY使用兼容API'
      });
    }

    const { client, model, fallbackModels = [], provider: activeProvider, useGroqSDK, useGeminiSDK } = clientConfig;

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
## 文档深度理解结果（数据工厂架构）：
- 项目名称：${understanding.projectName || '未知'}
- 预估业务条线：${(understanding.dataEntities || []).join('、') || '待识别'}
${triggerStats}
- 预估功能过程总数：${understanding.totalEstimatedFunctions || 30}

**业务全景观测（数据生命周期）：**
1. **感知层**：识别所有外部交互（文件推送、工单流入、用户指令）。
2. **治理层**：识别数据形态转化（原始入库、多维汇总、分析建模）。
3. **认知层**：**核心拆分点**。按“厂家+业务”矩阵平铺（如：华为视频质差、中兴交互查询）。
4. **分发层**：识别所有输出交付（UI渲染、文件导出、消息推送）。

**三层分析框架 -> 优化执行指令：**

1. **第一层：物理边界锚定** - 准确识别触发物理动作的交互者及其触发事件。
2. **第二层：物理目标挂载** - 100%采用文档定义的具体字段，禁止使用通用属性属性。
3. **第三层：ERWX物理闭环** - 强制满足 E(物理输入)+R(规则检索)+W(结论落地)+X(价值交付) 四个环节。
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

## 三层分析框架 -> 深度优化原则

### 1. 宏观：“厂家+业务”全平铺拆解（膨胀核心）
**严禁合并！** 即使逻辑相似，只要涉及厂家不同（华为/中兴）或业务类型不同（视频/游戏/支付），必须作为**独立FP**拆分。物理表、算法规则和数据域的独立性决定了它们是不同的功能点。

### 2. 微观：ERWX 物理建模
对于每个 FP，你必须手动“补齐”物理闭环：
- **E (Entry)**: 物理输入。接收原始报文/文件/指令包。
- **R (Read)**: 规则检索。读取门限表/特征库/规则配置（这是智能判定的依据）。
- **W (Write)**: 结论落地。将处理结论存入分析表/结果表/审计日志（这是业务痕迹）。
- **X (Exit)**: 价值交付。输出可视化图表、生成文件或发送通知。

### 3. 深层翻译：让隐性功能显性化
- **模糊描述明确化**：如文档说“智能交互”，需翻译为：[语音接入]+[意图识别]+[SQL构建]+[结果抓取]+[分析结论]+[话术渲染]等多个 FP。
- **隐性环节补齐**：任何计算必定伴随“读取判定门限”和“写入计算分值”。
- **异常逻辑监测**：自动补齐关键任务的“异常监测与预警”功能。

### 4. 数据属性物理排他性
- 严禁空泛词。必须使用：华为小区ID、视频时延要求、中兴质差判定准则、告警推送标识。
- 不同 FP 的数据属性重合度必须 **< 30%**。

## 输出格式：
|功能用户|触发事件|功能过程|子过程描述|数据移动类型|数据组|数据属性|
|:---|:---|:---|:---|:---|:---|:---|
|用户触发|用户请求|[厂商品牌][业务对象][核心动作]|接收[场景化]请求数据包|E|[业务对象]请求集|字段1、字段2、字段3|
||||检索[业务规则]判定依据|R|[业务对象]判定门限表|字段1、字段2、字段3|
||||记录[业务结论]处理流水|W|[业务对象]分析结论表|字段1、字段2、字段3|
||||返回[可视化]执行回执|X|[业务对象]响应结果|返回码、可视化图表、判定文本|
`;
    } else {
      // 后续轮次：检查遗漏功能（简化版，不使用硬编码规则）
      userPrompt = `## 任务：检查文档是否还有未拆分的功能

**原始文档内容：**
${documentContent.substring(0, 8000)}${documentContent.length > 8000 ? '\n...(文档已截断)' : ''}

**已完成的功能过程（${uniqueCompleted.length}个）：**
${uniqueCompleted.join('、')}

---

## 检查要点

### 1. 检查是否遗漏了辅助功能
请扫描文档，检查以下常见辅助功能是否都已拆分：
- 查询功能（各类数据查询）
- 导出功能（Excel、报表等）
- 导入功能（批量导入）
- 定时任务（汇总、统计、推送）
- 通知推送（短信、消息）

### 2. 检查功能名称是否具体
确保功能名称能明确指出业务对象，避免过于笼统的命名。

## 判断标准

- ✅ 如果文档中**所有明确描述的功能都已拆分**，请直接回复：**[ALL_DONE]**
- ✅ 如果还有遗漏功能，请继续拆分，输出Markdown表格

## 输出格式（如有未拆分功能）

|功能用户|触发事件|功能过程|子过程描述|数据移动类型|数据组|数据属性|
|:---|:---|:---|:---|:---|:---|:---|
|...|...|...|...|...|...|...|

**核心原则**：只拆分文档中明确描述的功能，不要臆造！`;
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

          if (useGeminiSDK) {
            // Google Gemini 官方 SDK 调用方式
            const fullPrompt = `${systemMessage.content}\n\n用户问题：\n${userPrompt}`;
            const result = await client.generateContent(fullPrompt);
            const response = await result.response;
            const text = response.text();
            // 转换为兼容格式
            completion = {
              choices: [{ message: { content: text } }]
            };
          } else if (useGroqSDK) {
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

    // 简单的完成检测（不使用硬编码规则，让两阶段动态分析处理质量问题）
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

    if (round >= 6) {  // 增加到6轮以支持深度细化
      isDone = true;
      console.log('三层分析框架 - 轮次达到上限(6轮)，强制停止');
    }

    if (reply.length < 100 && round > 1) {
      isDone = true;
      console.log('三层分析框架 - 回复内容过短，认为已完成');
    }

    // 🔧 后处理：清洗AI返回的数据，修复格式问题
    const cleanedReply = cleanupAIResponse(reply);

    res.json({
      success: true,
      reply: cleanedReply,
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

// 🔧 后处理函数：清洗AI返回的数据
function cleanupAIResponse(reply) {
  if (!reply || typeof reply !== 'string') return reply;

  // 常见英文字段名到中文的映射表
  const fieldMapping = {
    // 标识类
    'cell_id': '小区标识', 'cellid': '小区标识', 'CELL_ID': '小区标识',
    'gNBId': '基站编号', 'gnbid': '基站编号', 'gNB_ID': '基站编号',
    'task_id': '任务编号', 'taskid': '任务编号', 'TASK_ID': '任务编号',
    'user_id': '用户编号', 'userid': '用户编号', 'USER_ID': '用户编号',
    'request_id': '请求标识', 'requestid': '请求标识', 'REQUEST_ID': '请求标识',
    'node_id': '节点编号', 'nodeid': '节点编号', 'NODE_ID': '节点编号', 'NODEB_ID': '基站编号',
    'scene_name': '场景名称', 'scenename': '场景名称', 'SCENE_NAME': '场景名称',

    // 网络相关
    'DU_me_moid': '设备标识', 'du_me_moid': '设备标识',
    'NR_PHYSICAL_CELL_DU_ID': '物理小区标识', 'nr_physical_cell_du_id': '物理小区标识',
    'gNBIdLength': '基站编号长度', 'gnbidlength': '基站编号长度',
    'CGI': '小区全局标识', 'cgi': '小区全局标识',
    'NGI': '网络全局标识', 'ngi': '网络全局标识',
    'TCP_POOR_RT': 'TCP差比率', 'tcp_poor_rt': 'TCP差比率',
    'TCP_POOR_SESN_CNT': 'TCP差会话数', 'tcp_poor_sesn_cnt': 'TCP差会话数',
    'DL_SESN_DUR': '下行会话时长', 'dl_sesn_dur': '下行会话时长',
    'UL_SESN_DUR': '上行会话时长', 'ul_sesn_dur': '上行会话时长',
    'DL_RTT_LAT': '下行时延', 'dl_rtt_lat': '下行时延',
    'UL_RTT_LAT': '上行时延', 'ul_rtt_lat': '上行时延',
    'DL_DATA_MB': '下行数据量', 'dl_data_mb': '下行数据量',
    'UL_DATA_MB': '上行数据量', 'ul_data_mb': '上行数据量',
    'TOTAL_SESN_CNT': '总会话数', 'total_sesn_cnt': '总会话数',
    'AVG_TCP_RET_DATA': '平均TCP重传数据', 'avg_tcp_ret_data': '平均TCP重传数据',
    'TCP_ESTB_ACK_LAT': 'TCP建链确认时延', 'tcp_estb_ack_lat': 'TCP建链确认时延',
    'TCP_ESTB_RSP_LAT': 'TCP建链响应时延', 'tcp_estb_rsp_lat': 'TCP建链响应时延',
    'SESN_ACK_FIR_DAT_LAT': '会话首包确认时延', 'sesn_ack_fir_dat_lat': '会话首包确认时延',
    'UL_SESN_RATE_KBPS': '上行会话速率', 'ul_sesn_rate_kbps': '上行会话速率',
    'DL_SESN_RATE_KBPS': '下行会话速率', 'dl_sesn_rate_kbps': '下行会话速率',
    'AVG_TCP_ORD_PKT_CNT': '平均TCP有序包数', 'avg_tcp_ord_pkt_cnt': '平均TCP有序包数',
    'AVG_TCP_LST_PKT_CNT': '平均TCP丢包数', 'avg_tcp_lst_pkt_cnt': '平均TCP丢包数',
    'UDP_SESN_CNT': 'UDP会话数', 'udp_sesn_cnt': 'UDP会话数',

    // 时间类
    'create_time': '创建时间', 'createtime': '创建时间', 'CREATE_TIME': '创建时间',
    'update_time': '更新时间', 'updatetime': '更新时间', 'UPDATE_TIME': '更新时间',
    'start_time': '开始时间', 'starttime': '开始时间', 'START_TIME': '开始时间',
    'end_time': '结束时间', 'endtime': '结束时间', 'END_TIME': '结束时间',
    'timestamp': '时间戳', 'TIMESTAMP': '时间戳',

    // 状态类
    'status': '状态', 'STATUS': '状态',
    'state': '状态', 'STATE': '状态',
    'flag': '标志', 'FLAG': '标志',

    // 通用类
    'name': '名称', 'NAME': '名称',
    'type': '类型', 'TYPE': '类型',
    'count': '数量', 'COUNT': '数量',
    'total': '总计', 'TOTAL': '总计',
    'vendor': '厂商', 'VENDOR': '厂商',
    'city': '城市', 'CITY': '城市',
    'county': '区县', 'COUNTY': '区县',
    'frequency': '频率', 'FREQUENCY': '频率',
    'total_traffic_gb': '总流量GB', 'TOTAL_TRAFFIC_GB': '总流量GB',
    'FILE_NAME': '文件名称', 'file_name': '文件名称',
    'CELL_NAME': '小区名称', 'cell_name': '小区名称',
  };

  let cleaned = reply;

  // 1. 替换英文字段名为中文（在数据属性列中）
  // 匹配表格中最后一列（数据属性列）的内容
  cleaned = cleaned.replace(/\|([^|]*)\|[\s]*$/gm, (match, lastCol) => {
    let newCol = lastCol;
    // 替换所有已知的英文字段名
    for (const [eng, chn] of Object.entries(fieldMapping)) {
      // 使用单词边界匹配，避免部分替换
      const regex = new RegExp(`\\b${eng}\\b`, 'g');
      newCol = newCol.replace(regex, chn);
    }
    return `|${newCol}|`;
  });

  // 2. 将英文逗号替换为中文顿号（仅在数据属性列）
  cleaned = cleaned.replace(/\|([^|]*)\|[\s]*$/gm, (match, lastCol) => {
    // 将英文逗号替换为顿号
    let newCol = lastCol.replace(/,\s*/g, '、');
    // 清理多余的顿号
    newCol = newCol.replace(/、+/g, '、');
    newCol = newCol.replace(/^、|、$/g, '');
    return `|${newCol}|`;
  });

  // 3. 截断过长的数据属性（超过8个字段的截断）
  cleaned = cleaned.replace(/\|([^|]*)\|[\s]*$/gm, (match, lastCol) => {
    const fields = lastCol.split('、').map(f => f.trim()).filter(f => f);
    if (fields.length > 10) {
      // 保留前8个字段
      return `|${fields.slice(0, 8).join('、')}|`;
    }
    return match;
  });

  // 4. 智能简化过长的子过程描述（第4列）- 不再使用省略号截断
  const lines = cleaned.split('\n');
  const processedLines = lines.map(line => {
    if (!line.startsWith('|') || line.includes('---')) return line;

    const cols = line.split('|');
    if (cols.length >= 5) {
      // 第4列是子过程描述（索引4，因为split后第一个是空的）
      let subProcessDesc = cols[4] || '';
      if (subProcessDesc.length > 20) {
        // 智能简化子过程描述 - 保留业务关键词，移除冗余
        subProcessDesc = subProcessDesc
          // 简化复合描述
          .replace(/接收(.{2,15}?)(?:解析)?数据(?:和|与|,|，).+?(?:数据|信息)[，,]?.*?(?:生成|输出|产生).*/g, (m, p1) => {
            return `接收${p1.trim()}数据`;
          })
          // 简化读取描述
          .replace(/读取(.{2,15}?)(?:基础|相关|配置)?(?:指标)?(?:计算)?(?:相关)?数据/g, (m, p1) => {
            return `读取${p1.trim()}数据`;
          })
          // 简化记录描述
          .replace(/记录(.{2,15}?)(?:基础|相关)?(?:指标)?(?:计算)?操作日志/g, (m, p1) => {
            return `记录${p1.trim()}日志`;
          })
          // 简化返回描述
          .replace(/返回(.{2,15}?)(?:基础|相关)?(?:指标)?(?:计算)?操作结果/g, (m, p1) => {
            return `返回${p1.trim()}结果`;
          })
          // 移除冗余的"相关""基础"
          .replace(/相关|基础(?=数据|信息)/g, '')
          // 清理连续空格
          .replace(/\s+/g, '');

        // 不再对子过程描述做任何截断，完全保留AI输出的内容
        // 之前的substring截断会导致信息丢失
        cols[4] = subProcessDesc;
      }
      return cols.join('|');
    }
    return line;
  });

  cleaned = processedLines.join('\n');

  console.log('三层分析框架 - 数据清洗完成（无省略号）');
  return cleaned;
}

// ═══════════════════════════════════════════════════════════
// 阶段1：功能清单提取（动态驱动 - 让AI真正理解文档）
// ═══════════════════════════════════════════════════════════
async function extractFunctionList(req, res) {
  try {
    const { documentContent } = req.body;

    if (!documentContent) {
      return res.status(400).json({ error: '请提供文档内容' });
    }

    let clientConfig = getActiveClientConfig();
    if (!clientConfig) {
      return res.status(400).json({ error: '请先配置API密钥' });
    }

    const { client, model, useGeminiSDK, useGroqSDK, provider } = clientConfig;

    // 功能清单提取专用提示词 - 聚焦于理解文档，不做ERWX拆分
    const extractionPrompt = `你是一个专业的软件需求分析师。请仔细阅读以下文档，提取出所有的功能点。

# 任务目标
从文档中识别所有功能点（功能过程），并以结构化列表形式呈现，让用户可以确认、修改或补充。

# 分析步骤

## 第一步：通读文档
- 理解业务背景和系统边界
- 识别主要业务模块/子系统
- 理解用户角色和触发场景

## 第二步：识别功能点
对于每个功能，识别：
- **功能名称**：动词+业务对象（如"创建飞行任务"、"华为小区用户数5分钟汇总"）
- **触发方式**：用户触发 / 时钟触发 / 接口触发
- **所属模块**：该功能属于哪个业务模块
- **简要描述**：该功能做什么（一句话）

## 第三步：分类整理
将功能按模块或触发方式分组呈现

# 重要原则
1. **只识别文档中明确描述的功能，不要臆造**
2. **功能名称要具体**，避免"数据处理"这种笼统名称
3. **如果涉及多厂家（华为/中兴等）或多业务类型，要分别列出**
4. **定时任务要明确时间间隔**（如"5分钟汇总"而非"定时汇总"）
5. **导入导出要明确数据对象**（如"预警记录导出"而非"数据导出"）

# 输出格式
请严格按照以下JSON格式输出：

\`\`\`json
{
  "projectName": "项目名称",
  "projectDescription": "项目描述（一句话）",
  "totalFunctions": 15,
  "modules": [
    {
      "moduleName": "模块名称",
      "functions": [
        {
          "id": 1,
          "name": "功能名称",
          "triggerType": "用户触发",
          "description": "功能描述",
          "dataObjects": ["涉及的数据对象1", "数据对象2"]
        }
      ]
    }
  ],
  "timedTasks": [
    {
      "name": "定时任务名称",
      "interval": "5分钟",
      "description": "任务描述"
    }
  ],
  "suggestions": ["建议补充的功能1（如果文档暗示但未明确）"]
}
\`\`\`

---

**文档内容：**

${documentContent}

---

请仔细分析上述文档，提取所有功能点。`;

    console.log(`功能清单提取 - 开始分析文档，使用提供商: ${provider}`);

    let completion = null;

    if (useGeminiSDK) {
      const result = await client.generateContent(extractionPrompt);
      const response = await result.response;
      completion = {
        choices: [{ message: { content: response.text() } }]
      };
    } else if (useGroqSDK) {
      completion = await client.chat.completions.create({
        model,
        messages: [{ role: 'user', content: extractionPrompt }],
        temperature: 0.3,
        max_tokens: 8000
      });
    } else {
      completion = await client.chat.completions.create({
        model,
        messages: [{ role: 'user', content: extractionPrompt }],
        temperature: 0.3,
        max_tokens: 8000
      });
    }

    const reply = completion.choices[0].message.content;
    console.log(`功能清单提取 - 完成，响应长度: ${reply.length}`);

    // 尝试解析JSON
    let functionList = null;
    try {
      // 提取JSON部分
      const jsonMatch = reply.match(/```json\s*([\s\S]*?)\s*```/) || reply.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const jsonStr = jsonMatch[1] || jsonMatch[0];
        functionList = JSON.parse(jsonStr);
      }
    } catch (parseError) {
      console.log('功能清单提取 - JSON解析失败，返回原始文本:', parseError.message);
    }

    res.json({
      success: true,
      functionList,
      rawResponse: reply,
      provider
    });
  } catch (error) {
    console.error('功能清单提取失败:', error);
    res.status(500).json({ error: '功能清单提取失败: ' + error.message });
  }
}

// ═══════════════════════════════════════════════════════════
// 阶段2：基于确认的功能清单进行ERWX拆分
// ═══════════════════════════════════════════════════════════
async function splitFromFunctionList(req, res) {
  try {
    const { documentContent, confirmedFunctions, previousResults = [], round = 1 } = req.body;

    if (!confirmedFunctions || confirmedFunctions.length === 0) {
      return res.status(400).json({ error: '请提供确认的功能清单' });
    }

    let clientConfig = getActiveClientConfig();
    if (!clientConfig) {
      return res.status(400).json({ error: '请先配置API密钥' });
    }

    const { client, model, useGeminiSDK, useGroqSDK, provider } = clientConfig;

    // 已完成的功能
    const completedFunctions = previousResults.map(r => r.functionalProcess).filter(Boolean);
    const uniqueCompleted = [...new Set(completedFunctions)];

    // 待拆分的功能（使用更严格的匹配逻辑，避免误判）
    const pendingFunctions = confirmedFunctions.filter(fn => {
      // 检查是否已经完成（使用更严格的匹配）
      const isCompleted = uniqueCompleted.some(completed => {
        // 完全匹配（忽略空格和特殊符号）
        const normalizedFn = fn.name.replace(/[\s&\-\_]/g, '').toLowerCase();
        const normalizedCompleted = completed.replace(/[\s&\-\_]/g, '').toLowerCase();
        // 只有完全相同才算已完成，不使用includes
        return normalizedFn === normalizedCompleted;
      });
      return !isCompleted;
    });

    if (pendingFunctions.length === 0) {
      return res.json({
        success: true,
        reply: '[ALL_DONE]',
        isDone: true,
        completedFunctions: uniqueCompleted.length
      });
    }

    // 每轮处理更多功能（确保不遗漏）
    const batchSize = 8;
    const currentBatch = pendingFunctions.slice(0, batchSize);

    // 构建拆分提示词 - 强调子过程描述必须包含功能过程关键词
    const splitPrompt = `你是一个COSMIC拆分专家。请对以下${currentBatch.length}个确认的功能进行ERWX拆分。

# ⚠️ 最重要的规则：子过程描述必须包含功能过程的关键词！

## 错误示例（禁止）：
| 功能过程 | 子过程描述（错误❌） |
|---------|------------------|
| 中兴智算板栅格字典表计算 | 接收栅格数据 |
| 中兴智算板栅格字典表计算 | 读取轮廓数据 |
| 中兴智算板栅格字典表计算 | 返回计算结果 |

## 正确示例（必须）：
| 功能过程 | 子过程描述（正确✅） |
|---------|------------------|
| 中兴智算板栅格字典表计算 | 接收**中兴智算板栅格**数据 |
| 中兴智算板栅格字典表计算 | 读取**中兴栅格字典表**轮廓 |
| 中兴智算板栅格字典表计算 | 保存**中兴栅格字典表**计算 |
| 中兴智算板栅格字典表计算 | 返回**中兴栅格字典表**结果 |

---

# 待拆分的功能列表（共${currentBatch.length}个，必须全部拆分！）

${currentBatch.map((fn, i) => `### 功能${i + 1}: ${fn.name}
- 触发方式：${fn.triggerType || '用户触发'}
- 描述：${fn.description || '无'}
- 涉及数据：${(fn.dataObjects || []).join('、') || '待识别'}
- **提取关键词**：${fn.name.replace(/[&]/g, '').split(/(?:数据|功能|处理|计算|评估|分析|查询|汇总|导出|导入)/).filter(s => s.length > 1).slice(0, 3).join('、') || fn.name}`).join('\n\n')}

---

# 参考文档内容

${documentContent.substring(0, 6000)}${documentContent.length > 6000 ? '\n...(文档已截断)' : ''}

---

# ERWX拆分规则

每个功能过程必须拆分为**4个子过程**（E+R+W+X）：

| 类型 | 含义 | 子过程描述格式（必须包含功能关键词） |
|-----|-----|-------------------------------|
| E | 接收 | 接收**[功能关键词]**请求/数据 |
| R | 读取 | 读取**[功能关键词]**配置/规则 |
| W | 写入 | 保存/记录**[功能关键词]**结果 |
| X | 输出 | 返回**[功能关键词]**响应 |

# 输出格式

请输出Markdown表格，**确保上述${currentBatch.length}个功能全部都有4行（E+R+W+X）**：

|功能用户|触发事件|功能过程|子过程描述|数据移动类型|数据组|数据属性|
|:---|:---|:---|:---|:---|:---|:---|
|时钟触发|时钟触发|中兴智算板栅格字典表计算|接收中兴智算板栅格数据|E|中兴栅格数据包|时间、栅格ID、经度、纬度|
||||读取中兴栅格字典表轮廓|R|中兴栅格字典表|地市、区县、场景名称|
||||保存中兴栅格字典表计算|W|中兴栅格计算结果表|栅格ID、关联场景、计算时间|
||||返回中兴栅格字典表结果|X|中兴栅格计算响应|计算状态、结果数量|

# 核心要求（请严格遵守）

1. **必须拆分上述全部${currentBatch.length}个功能**，不能遗漏任何一个！
2. **每个功能必须有E+R+W+X四个子过程**
3. **子过程描述必须包含功能过程的关键词**（这是最重要的！）
4. **功能名称只在E行填写，后续R/W/X行留空**
5. **数据属性使用中文，用顿号分隔**

请开始拆分（共${currentBatch.length}个功能，预期输出${currentBatch.length * 4}行）：`;

    console.log(`基于功能清单拆分 - 第${round}轮，待拆分${currentBatch.length}个功能，使用提供商: ${provider}`);

    let completion = null;
    const systemMessage = {
      role: 'system',
      content: ENHANCED_COSMIC_SYSTEM_PROMPT
    };

    if (useGeminiSDK) {
      const fullPrompt = `${systemMessage.content}\n\n${splitPrompt}`;
      const result = await client.generateContent(fullPrompt);
      const response = await result.response;
      completion = {
        choices: [{ message: { content: response.text() } }]
      };
    } else if (useGroqSDK) {
      completion = await client.chat.completions.create({
        model,
        messages: [systemMessage, { role: 'user', content: splitPrompt }],
        temperature: 0.5,
        max_tokens: 8000
      });
    } else {
      completion = await client.chat.completions.create({
        model,
        messages: [systemMessage, { role: 'user', content: splitPrompt }],
        temperature: 0.5,
        max_tokens: 8000
      });
    }

    const reply = completion.choices[0].message.content;
    const cleanedReply = cleanupAIResponse(reply);

    // 判断是否完成
    const isDone = pendingFunctions.length <= batchSize;

    console.log(`基于功能清单拆分 - 第${round}轮完成，剩余${pendingFunctions.length - batchSize}个功能`);

    res.json({
      success: true,
      reply: cleanedReply,
      round,
      isDone,
      completedFunctions: uniqueCompleted.length,
      pendingCount: Math.max(0, pendingFunctions.length - batchSize),
      provider
    });
  } catch (error) {
    console.error('基于功能清单拆分失败:', error);
    res.status(500).json({ error: '拆分失败: ' + error.message });
  }
}

module.exports = {
  threeLayerAnalyze,
  getActiveClientConfig,
  extractFunctionList,
  splitFromFunctionList
};

