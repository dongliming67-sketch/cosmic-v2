// 三层分析框架模式 API - 支持智谱API、Groq API和OpenRouter三选择
const { ENHANCED_COSMIC_SYSTEM_PROMPT } = require('./enhanced-prompts');
const OpenAI = require('openai');

// 智谱客户端（独立配置）
let zhipuClient = null;
function getZhipuClient() {
  // 只有在明确配置了 ZHIPU_API_KEY，或者 OPENAI_BASE_URL 指向智谱时才使用
  const hasZhipuBaseUrl = process.env.OPENAI_BASE_URL && process.env.OPENAI_BASE_URL.includes('bigmodel.cn');
  const zhipuApiKey = process.env.ZHIPU_API_KEY || (hasZhipuBaseUrl ? process.env.OPENAI_API_KEY : null);
  const zhipuBaseUrl = process.env.ZHIPU_BASE_URL || (hasZhipuBaseUrl ? process.env.OPENAI_BASE_URL : 'https://open.bigmodel.cn/api/paas/v4');

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

// 获取当前激活的客户端和模型配置 (支持传入用户配置以实现开放平台模式)
function getActiveClientConfig(userConfig = null) {
  // 如果提供了用户配置，优先使用
  if (userConfig && userConfig.apiKey) {
    const provider = (userConfig.provider || 'openai').toLowerCase();
    const apiKey = userConfig.apiKey;
    const baseUrl = userConfig.baseUrl || 'https://api.openai.com/v1';
    const model = userConfig.model || 'gpt-3.5-turbo';

    console.log(`[Open Platform] 使用用户提供的配置: Provider=${provider}, Model=${model}`);

    if (provider === 'gemini') {
      try {
        const { GoogleGenerativeAI } = require('@google/generative-ai');
        const geminiClient = new GoogleGenerativeAI(apiKey);
        const modelObj = geminiClient.getGenerativeModel({ model: model || 'gemini-2.0-flash' });
        return {
          client: modelObj,
          model: model || 'gemini-2.0-flash',
          fallbackModels: [],
          provider: 'gemini',
          useGroqSDK: false,
          useGeminiSDK: true
        };
      } catch (err) {
        console.error('Gemini SDK 初始化失败:', err.message);
      }
    }

    if (provider === 'groq') {
      try {
        const Groq = require('groq-sdk');
        const groqClient = new Groq({ apiKey });
        return {
          client: groqClient,
          model: model || 'llama-3.3-70b-versatile',
          fallbackModels: [],
          provider: 'groq',
          useGroqSDK: true,
          useGeminiSDK: false
        };
      } catch (err) {
        console.error('Groq SDK 初始化失败:', err.message);
      }
    }

    // 默认 OpenAI 兼容模式 (包括智谱、SiliconFlow/DeepSeek 等)
    const client = new OpenAI({
      apiKey: apiKey,
      baseURL: baseUrl
    });

    return {
      client,
      model,
      fallbackModels: [],
      provider: provider,
      useGroqSDK: false,
      useGeminiSDK: false
    };
  }

  // 以下为回退逻辑：使用环境变量（原有逻辑）
  // THREE_LAYER_PROVIDER: 'gemini' | 'zhipu' | 'groq' | 'openrouter' | 'auto'
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

  // OpenAI兼容API（包括DeepSeek等）
  if (provider === 'openai') {
    const openaiKey = process.env.OPENAI_API_KEY;
    const openaiBaseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';

    if (openaiKey) {
      const client = new OpenAI({
        apiKey: openaiKey,
        baseURL: openaiBaseUrl
      });

      console.log(`OpenAI兼容客户端已初始化，Base URL: ${openaiBaseUrl}`);

      return {
        client,
        model: process.env.OPENAI_MODEL || 'gpt-3.5-turbo',
        fallbackModels: [],
        provider: 'openai',
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

    // 新增：OpenAI 兼容（如 SiliconFlow/DeepSeek）
    if (process.env.OPENAI_API_KEY) {
      const openaiBaseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
      return {
        client: new OpenAI({
          apiKey: process.env.OPENAI_API_KEY,
          baseURL: openaiBaseUrl
        }),
        model: process.env.OPENAI_MODEL || 'gpt-3.5-turbo',
        fallbackModels: [],
        provider: 'openai',
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
    const { documentContent, previousResults = [], round = 1, targetFunctions = 30, understanding = null, userGuidelines = '', provider = null, userConfig = null } = req.body;

    // 如果前端指定了provider，临时覆盖环境变量
    const originalProvider = process.env.THREE_LAYER_PROVIDER;
    if (provider) {
      process.env.THREE_LAYER_PROVIDER = provider;
      console.log(`三层分析框架 - 使用前端指定的提供商: ${provider}`);
    }

    // 尝试获取客户端配置 (优先使用请求中的 userConfig)
    let clientConfig = getActiveClientConfig(userConfig);

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
3. **认知层**：**核心拆分点**。严禁合并，按“厂家+业务+指标”三维矩阵平铺（如：华为视频质差、中兴交互查询、日颗粒度汇总）。
4. **分发层**：识别所有输出交付（UI渲染、文件导出、消息推送）。

**三层分析框架 -> 优化执行指令：**

1. **第一层：物理边界锚定** - 准确识别触发物理动作的功能用户（发起者与接收者）及其触发事件。
2. **第二层：物理目标挂载** - 100%采用文档定义的具体字段，禁止使用通用属性属性。
3. **第三层：ERWX物理闭环** - 强制满足 E(物理输入)+R(规则检索)+W(结论落地)+X(价值交付) 四个环节。

## 触发事件与功能用户映射表（严格遵照执行）：
|触发事件|功能用户赋值规则|说明|
|:---|:---|:---|
|用户触发|发起者：用户 接收者：用户|页面按钮点击跳转等|
|时钟触发|发起者：定时触发器 接收者：网优平台|自动汇总、短信、我方调他方|
|接口调用触发|发起者：其他平台 接收者：网优平台|他方调用我方接口|
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

## 🚨 第零步：业务关键词识别（避免泛化拆分）

**在拆分功能点之前，必须先从文档中提取业务关键词，组合成完整的业务对象名称！**

### 步骤1：扫描文档，提取业务关键词
识别以下关键词类型：
- **业务领域关键词**：网络优化、参数自动化、质差分析、投诉处理、性能监控等
- **数据来源关键词**：华为、中兴、爱立信、诺基亚等厂家名称
- **业务对象关键词**：派单任务、工单、小区、基站、用户、会话等
- **操作场景关键词**：质差诊断、性能汇总、告警推送、数据导入、参数优化等

### 步骤2：组合关键词，形成完整业务对象（严禁泛指！）

❌ **错误示例**（过于泛化，严禁使用）：
- 任务新增、任务修改、任务删除、任务查询 → ❌ 什么任务？没有业务场景！
- 工单处理 → ❌ 什么类型的工单？
- 数据导出 → ❌ 导出什么数据？
- 信息查询 → ❌ 查询什么信息？

✅ **正确示例**（具体业务场景）：
- **参数自动化派单任务**创建、修改、删除、查询
- **质差投诉工单**处理、分配、审核
- **华为小区质差数据**导出、分析
- **中兴基站性能指标信息**查询、汇总

### 步骤3：验证业务对象完整性
每个功能过程名称必须满足：
1. **包含业务场景** + **具体对象** （如：参数自动化 + 派单任务）
2. 或 **数据来源** + **业务对象** （如：华为 + 小区质差数据）
3. 或 **操作类型** + **业务对象** （如：质差诊断 + 结果报告）

**长度检查**：如果业务对象名称少于4个字，说明还不够具体，必须补充限定词！

---

## 三层分析框架 -> 深度优化原则

### 1. 宏观：“厂家+业务+指标”全平铺拆解（膨胀核心）
**严禁合并！** 即使逻辑相似，只要涉及厂家不同（华为/中兴）、业务类型不同（视频/游戏/支付）或指标粒度不同（日/周/月），必须作为**独立FP**拆分。物理表、算法规则和数据域的独立性决定了它们是不同的功能点。

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

### 5. 功能界面说明识别（极重要！）
- **严禁遗漏 UI 描述中的子功能**。如果文档说"支持查询、导出"，必须拆分为独立的 **[查询]** 和 **[导出]** 两个功能过程。
- 不要因为它们写在同一个标题下就合并处理。


## 输出格式要求：

**功能过程命名规范**（极其重要！）：
- ❌ 禁止：任务新增、任务修改、工单查询、数据导出（这些都是泛指，没有业务场景）
- ✅ 必须：参数自动化派单任务创建、华为小区质差数据导出、中兴基站性能指标汇总

**输出表格格式**：
|功能用户|触发事件|功能过程|子过程描述|数据移动类型|数据组|数据属性|
|:---|:---|:---|:---|:---|:---|:---|
|发起者：用户 接收者：用户|用户触发|参数自动化派单任务创建|接收参数自动化派单任务创建请求数据包|E|参数自动化派单任务创建请求参数集|request_id、task_name、task_type、auto_dispatch_rule_id、target_city_id|
||||检索参数自动化派单规则配置数据|R|参数自动化派单规则配置表|rule_id、rule_name、dispatch_condition、target_param_type|
||||记录参数自动化派单任务创建结果流水|W|参数自动化派单任务主表|task_id、task_name、task_status、create_time、creator_id|
||||返回参数自动化派单任务创建成功回执|X|参数自动化派单任务创建响应数据|result_code、message、task_id、task_status|
|发起者：定时触发器 接收者：网优平台|时钟触发|华为小区质差数据定时汇总|接收定时汇总任务脉冲指令|E|定时任务状态包|task_id、current_time、execution_cycle|
||||读取华为小区质差指标计算规则|R|华为小区质差指标规则表|metric_id、threshold_value、calculation_formula、vendor_type|
||||记录华为小区质差数据汇总结果|W|华为小区质差汇总结果表|vendor_name、statistics_date、summary_value、cell_count|
||||返回定时汇总任务执行回执|X|任务执行响应包|execution_result、return_code、message_body|

**关键要求**：
1. "功能过程"列必须包含完整的业务场景，长度至少8个字
2. "子过程描述"列必须复用"功能过程"的业务关键词
3. "数据组"列必须与"功能过程"业务对象保持一致
4. "数据属性"列必须使用文档中定义的具体字段，禁止使用"标识、编号、名称"等通用词
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

  // 4.5【新增】清理数据组中的连接符（如"表-xxx"、"表·xxx"）和过滤笼统功能过程
  // 问题：AI有时会生成"低空保障参数自动化任务运行日志表-读取低空保障任务"或使用"·"中文间隔号
  // 解决：将连接符/间隔号替换为更自然的表达，或直接移除分隔符后的部分
  const cleanupDataGroupLines = cleaned.split('\n');
  const cleanedDataGroupLines = cleanupDataGroupLines.map(line => {
    if (!line.startsWith('|') || line.includes('---') || line.includes('数据组')) return line;

    const cols = line.split('|');
    if (cols.length >= 7) {
      // 第6列是数据组（索引6，因为split后第一个是空的）
      let dataGroup = cols[6] || '';
      const originalGroup = dataGroup;

      // 检测并修复分隔符问题：支持连接符"-"和中文间隔号"·"
      // 匹配模式：xxx表-xxx 或 xxx表·xxx
      const separatorPattern = /[·\-]/;
      if (separatorPattern.test(dataGroup) && (dataGroup.includes('表') || dataGroup.includes('库') || dataGroup.includes('集') || dataGroup.includes('数据'))) {
        // 方案1：如果是"xxx表-动作"或"xxx表·动作"格式，提取基础名
        const separatorMatch = dataGroup.match(/^(.+?(?:表|库|集|数据))[·\-](.+)$/);
        if (separatorMatch) {
          const baseName = separatorMatch[1]; // xxx表/库/集/数据
          const suffix = separatorMatch[2]; // 分隔符后的内容

          // 检测后缀是否包含动词，如果是则只保留基础名
          const verbPatterns = /^(读取|写入|查询|删除|修改|新增|导出|导入|获取|接收|返回|保存|更新|执行)/;
          if (verbPatterns.test(suffix)) {
            // 分隔符后是动词，直接使用基础名
            dataGroup = baseName;
          } else if (suffix.length > 15) {
            // 后缀过长（可能是截断的内容），只保留基础名
            dataGroup = baseName;
          } else {
            // 后缀不是动词开头且长度适中，拼接为更自然的表达
            // 移除末尾的"表/库/集"后重新组合
            const baseWithoutSuffix = baseName.replace(/表$|库$|集$/, '');
            dataGroup = baseWithoutSuffix + suffix + '表';
          }
        } else {
          // 其他情况，直接移除分隔符及其后内容
          dataGroup = dataGroup.split(/[·\-]/)[0].trim();
        }

        if (originalGroup !== dataGroup) {
          console.log(`🔧 数据组分隔符清理: "${originalGroup}" -> "${dataGroup}"`);
        }
      }

      // 第3列是功能过程（索引3）
      let funcProcess = cols[3] || '';

      // 检测并警告笼统的功能过程（如"查询结果"、"数据处理"等）
      const vagueFuncPatterns = [
        /^查询结果$/,
        /^数据处理$/,
        /^信息查询$/,
        /^结果展示$/,
        /^数据查询$/,
        /^任务处理$/,
        /^操作执行$/,
        /^请求处理$/
      ];

      if (funcProcess.trim()) {
        const isVague = vagueFuncPatterns.some(pattern => pattern.test(funcProcess.trim()));
        if (isVague) {
          console.log(`⚠️ 警告：检测到笼统功能过程: "${funcProcess}"，建议增加业务场景描述`);
          // 尝试从子过程描述中提取业务关键词来增强
          const subProcessDesc = cols[4] || '';
          const businessKeywords = subProcessDesc.match(/(低空保障|参数自动化|质差|健康度|告警|工单|航线|飞行|任务配置|规则|监控|统计|分析)/);
          if (businessKeywords && businessKeywords[1]) {
            funcProcess = businessKeywords[1] + funcProcess;
            console.log(`  → 已增强为: "${funcProcess}"`);
          }
        }
      }

      cols[6] = dataGroup;
      cols[3] = funcProcess;
      return cols.join('|');
    }
    return line;
  });

  cleaned = cleanedDataGroupLines.join('\n');

  // 5. 【极重要】过滤数据属性中的动词前缀，去重后补充标准字段
  // 动词黑名单：这些词不应该出现在数据属性字段名中
  const verbBlacklist = [
    '删除', '修改', '新增', '查询', '创建', '更新', '启用', '禁用',
    '读取', '写入', '接收', '返回', '记录', '获取', '设置', '配置',
    '添加', '移除', '编辑', '保存', '提交', '取消', '批量', '导入',
    '导出', '上传', '下载', '查看', '审批', '执行', '同步', '验证',
    '校验', '检查', '确认', '审核', '通过', '拒绝', '撤销', '终止',
    '暂停', '恢复', '重启', '刷新', '加载', '解析', '转换', '生成',
    '计算', '统计', '汇总', '分析', '处理', '发送', '推送', '通知'
  ];

  // 标准字段库（按数据移动类型分类）
  const standardFieldsByType = {
    'E': ['请求标识', '操作流水号', '会话标识', '业务优先级', '用户标识', '时间戳'],
    'R': ['数据版本', '配置版本', '规则标识', '数据源', '有效标识', '时效标签'],
    'W': ['记录ID', '批次号', '操作时间', '变更类型', '持久化标识', '流水号'],
    'X': ['响应状态码', '处理时间', '结果数量', '响应序列', '处理回执', '耗时毫秒']
  };
  const genericFields = ['ID', '名称', '类型', '状态', '创建时间', '操作人', '描述', '编号'];

  // 对表格的最后一列（数据属性列）进行动词过滤
  const finalLines = cleaned.split('\n');
  const verbFilteredLines = finalLines.map(line => {
    if (!line.startsWith('|') || line.includes('---') || line.includes('数据属性')) return line;

    const cols = line.split('|');
    if (cols.length >= 8) {
      // 提取数据移动类型（索引5，因为split后第一个是空的）
      const dataMovementType = (cols[5] || '').trim().toUpperCase();

      // 最后一列是数据属性（索引7，因为split后第一个是空的）
      let dataAttrs = cols[7] || '';
      const attrFields = dataAttrs.split(/[、,，]/).map(f => f.trim()).filter(f => f);
      const originalCount = attrFields.length;

      let cleanedFields = attrFields.map(field => {
        let cleanField = field;
        // 检查字段是否以动词开头，如果是则移除
        for (const verb of verbBlacklist) {
          if (cleanField.startsWith(verb)) {
            cleanField = cleanField.substring(verb.length);
            // 如果移除后为空或只剩一个字，则保留原样
            if (cleanField.length <= 1) {
              cleanField = field;
            }
            break; // 只移除第一个匹配的动词
          }
        }
        return cleanField;
      });

      // 去除重复字段（动词移除后可能导致重复）
      cleanedFields = [...new Set(cleanedFields)];

      // 【新增】如果去重后字段过少（少于3个），从标准字段库补充
      if (cleanedFields.length < 3) {
        const supplementFields = standardFieldsByType[dataMovementType] || genericFields;
        for (const field of supplementFields) {
          // 避免添加已存在的字段（模糊匹配）
          const alreadyExists = cleanedFields.some(f => f.includes(field) || field.includes(f));
          if (!alreadyExists) {
            cleanedFields.push(field);
            if (cleanedFields.length >= 3) break;
          }
        }
        console.log(`⚠️ 数据属性去重后过少(${originalCount}→${cleanedFields.length}个)，已从标准字段库补充`);
      }

      cols[7] = cleanedFields.join('、');
      return cols.join('|');
    }
    return line;
  });

  cleaned = verbFilteredLines.join('\n');

  console.log('三层分析框架 - 数据清洗完成（无省略号，已过滤动词前缀，已去重补充）');
  return cleaned;
}

// ═══════════════════════════════════════════════════════════
// 🔧 文档智能分块处理
// ═══════════════════════════════════════════════════════════

/**
 * 将大文档按语义分块，确保每块都有完整的上下文
 * @param {string} content - 原始文档内容
 * @param {number} maxChunkSize - 每块最大字符数（默认6000）
 * @returns {Array} 分块结果数组
 */
function smartChunkDocument(content, maxChunkSize = 6000) {
  const chunks = [];

  // 如果文档较小，直接返回
  if (content.length <= maxChunkSize) {
    return [{ content, chunkIndex: 0, totalChunks: 1, isComplete: true }];
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`📄 文档分块处理开始`);
  console.log(`文档总长度: ${content.length} 字符`);
  console.log(`每块大小: ${maxChunkSize} 字符`);

  // 尝试按章节分割（识别常见的章节标记）
  const sectionPatterns = [
    /\n#+\s+.+/g,  // Markdown标题
    /\n第[一二三四五六七八九十\d]+[章节部分].+/g,  // 中文章节
    /\n\d+[\.、]\s+.+/g,  // 数字标题
    /\n[一二三四五六七八九十]+[、．].+/g  // 中文数字标题
  ];

  let sections = [];
  for (const pattern of sectionPatterns) {
    const matches = [...content.matchAll(pattern)];
    if (matches.length > 2) {  // 至少找到3个章节标记才认为有效
      sections = matches;
      console.log(`识别到 ${sections.length} 个章节标记`);
      break;
    }
  }

  if (sections.length > 0) {
    // 按章节分块
    let lastIndex = 0;
    for (let i = 0; i < sections.length; i++) {
      const currentSection = sections[i];
      const nextSection = sections[i + 1];

      const start = lastIndex;
      const end = nextSection ? nextSection.index : content.length;
      const sectionContent = content.substring(start, end);

      // 如果单个章节过大，需要进一步拆分
      if (sectionContent.length > maxChunkSize) {
        const subChunks = splitLargeSection(sectionContent, maxChunkSize);
        chunks.push(...subChunks);
      } else {
        chunks.push({ content: sectionContent, size: sectionContent.length });
      }

      lastIndex = currentSection.index;
    }
  } else {
    // 没有明显章节，按段落智能分割
    console.log('未识别到章节标记，按段落智能分割');
    const paragraphs = content.split(/\n\n+/);
    let currentChunk = '';

    for (const para of paragraphs) {
      if (currentChunk.length + para.length > maxChunkSize && currentChunk.length > 0) {
        chunks.push({ content: currentChunk, size: currentChunk.length });
        currentChunk = para;
      } else {
        currentChunk += (currentChunk ? '\n\n' : '') + para;
      }
    }

    if (currentChunk) {
      chunks.push({ content: currentChunk, size: currentChunk.length });
    }
  }

  // 为每个分块添加元数据
  const totalChunks = chunks.length;
  const result = chunks.map((chunk, index) => ({
    content: chunk.content,
    chunkIndex: index,
    totalChunks: totalChunks,
    size: chunk.size || chunk.content.length,
    isComplete: false
  }));

  // 添加重叠区域，确保不漏掉边界功能
  for (let i = 0; i < result.length - 1; i++) {
    const overlapSize = 500;  // 重叠500字符
    const currentContent = result[i].content;
    const nextContent = result[i + 1].content;

    // 将下一块的开头加到当前块的结尾
    result[i].overlapNext = nextContent.substring(0, Math.min(overlapSize, nextContent.length));
  }

  console.log(`文档已分为 ${totalChunks} 块`);
  result.forEach((chunk, i) => {
    console.log(`  块${i + 1}: ${chunk.size} 字符${chunk.overlapNext ? ' (含重叠)' : ''}`);
  });
  console.log('='.repeat(60) + '\n');

  return result;
}

/**
 * 拆分过大的单个章节
 */
function splitLargeSection(sectionContent, maxSize) {
  const chunks = [];
  const sentences = sectionContent.split(/([。！？\n]+)/);
  let currentChunk = '';

  for (let i = 0; i < sentences.length; i += 2) {
    const sentence = sentences[i] + (sentences[i + 1] || '');
    if (currentChunk.length + sentence.length > maxSize && currentChunk.length > 0) {
      chunks.push({ content: currentChunk, size: currentChunk.length });
      currentChunk = sentence;
    } else {
      currentChunk += sentence;
    }
  }

  if (currentChunk) {
    chunks.push({ content: currentChunk, size: currentChunk.length });
  }

  return chunks;
}

// ═══════════════════════════════════════════════════════════
// 阶段1：功能清单提取（动态驱动 - 让AI真正理解文档）
// - 支持大文档分块处理
// - 支持多轮迭代思考
// ═══════════════════════════════════════════════════════════
async function extractFunctionList(req, res) {
  try {
    const { documentContent, enableChunking = true, maxIterations = 3, userGuidelines = '', userConfig = null } = req.body;

    if (!documentContent) {
      return res.status(400).json({ error: '请提供文档内容' });
    }

    let clientConfig = getActiveClientConfig(userConfig);
    if (!clientConfig) {
      return res.status(400).json({ error: '请先配置API密钥' });
    }

    const { client, model, useGeminiSDK, useGroqSDK, provider } = clientConfig;

    console.log(`\n${'='.repeat(80)}`);
    console.log(`🚀 功能清单提取开始`);
    console.log(`文档长度: ${documentContent.length} 字符`);
    console.log(`分块处理: ${enableChunking ? '启用' : '禁用'}`);
    console.log(`最大迭代: ${maxIterations} 轮`);
    console.log(`AI提供商: ${provider}`);
    if (userGuidelines) {
      console.log(`📋 用户限制条件: ${userGuidelines}`);
    }
    console.log('='.repeat(80) + '\n');

    // 判断是否需要分块处理
    const needChunking = enableChunking && documentContent.length > 8000;

    if (needChunking) {
      // 大文档分块处理
      console.log('📄 检测到大文档，启动分块处理模式...');
      const functionList = await extractFromLargeDocument(
        documentContent,
        clientConfig,
        maxIterations,
        userGuidelines  // 传递用户限制条件到分块处理
      );

      return res.json({
        success: true,
        functionList,
        provider,
        mode: 'chunked',
        totalChunks: functionList._metadata?.totalChunks || 0
      });
    }

    // 小文档直接处理（保持原有逻辑）
    console.log('📄 文档大小适中，使用标准处理模式...');

    // 功能清单提取专用提示词 - 极致细粒度拆分版本
    const extractionPrompt = `你是一个COSMIC功能点分析专家。你的任务是按照**最细粒度**拆分出文档中的所有功能。

# ⚡⚡⚡ 最高优先级规则（必须首先执行！）⚡⚡⚡

**�🔴🔴 第一步：扫描文档中的"功能界面说明"或"功能页面说明"部分 🔴🔴🔴**

请立即扫描文档，找到所有"功能界面说明"或"功能页面说明"章节。
这些章节中的每一条都是一个独立功能！

**必须识别的功能类型（按优先级排序）：**

| 文档关键词 | 必须识别为 | 示例 |
|-----------|----------|------|
| **"支持查询"** | **查询[页面/表名]数据** | 文档写"支持查询" → 识别为"查询日粒度小区健康度数据" |
| **"支持导出"** | **导出[页面/表名]数据** | 文档写"支持导出" → 识别为"导出日粒度小区健康度数据" |
| **"支持导入"** | **导入[页面/表名]数据** | 文档写"支持导入" → 识别为"导入小区配置数据" |
| **"点击XXX跳转"** | **[XXX]详情查看** | 文档写"点击质差小区跳转" → 识别为"质差小区详情查看" |

**⚠️ 极其重要**：如果文档中有"支持查询"和"支持导出"，你的功能清单中**必须**有对应的查询功能和导出功能！
如果最终输出中没有"查询"和"导出"功能，说明你没有正确执行此规则！

**示例：文档描述如下时**
\`\`\`
日粒度小区感知健康度综合评估表
功能界面说明
1. 支持查询（日期、地市、小区名称等）
2. 支持导出
\`\`\`

**你必须识别出以下功能**：
1. ✅ **查询日粒度小区感知健康度综合评估表数据**（用户触发）
2. ✅ **导出日粒度小区感知健康度综合评估表数据**（用户触发）

---

# �🚨🚨🚨 绝对禁止的错误（违反者必须重新识别！）


**❌ 禁止泛化表达！以下是严重错误示例：**
- ❌ "数据业务画像生成" → 太泛化！必须明确：生成什么数据？画像包含哪些指标？
- ❌ "数据业务可视化展示" → 太泛化！必须明确：展示什么数据？用什么图表？
- ❌ "数据业务智能体交互" → 太泛化！必须明确：交互什么内容？什么方式交互？
- ❌ "周粒度业务感知可视化分析基础指标汇总情况统计" → 太长太复杂！必须拆分为多个独立功能
- ❌ "数据查询" → 太泛化！必须明确：查询什么数据？
- ❌ "数据导出" → 太泛化！必须明确：导出什么数据？
- ❌ "报表生成" → 太泛化！必须明确：生成什么报表？

**❌ 禁止复合操作！必须拆分为独立功能：**
- ❌ "生成华为小区业务感知健康度评估表-日数据" → 必须拆分为2个功能：
  - ✅ "华为小区业务感知健康度日数据评估"（评估/计算操作）
  - ✅ "华为小区业务感知健康度评估表生成"（生成表格操作）
- ❌ "统计并生成用户报表" → 必须拆分为2个功能：
  - ✅ "用户数据统计"
  - ✅ "用户统计报表生成"
- ❌ "查询并导出数据" → 必须拆分为2个功能：
  - ✅ "XXX数据查询"
  - ✅ "XXX数据Excel导出"
- ❌ "分析并可视化展示" → 必须拆分为2个功能：
  - ✅ "XXX数据分析"
  - ✅ "XXX分析结果折线图展示"

**✅ 正确的具体化示例：**
- ✅ "华为小区用户数日汇总数据查询"（明确：厂商+数据对象+时间粒度+操作）
- ✅ "中兴基站流量5分钟汇总Excel导出"（明确：厂商+数据对象+时间粒度+格式+操作）
- ✅ "爱立信小区负荷率柱状图可视化展示"（明确：厂商+数据对象+指标+图表类型）
- ✅ "用户数趋势折线图查看"（明确：数据对象+图表类型）
- ✅ "日汇总数据定时任务配置"（明确：时间粒度+操作类型）

**🎯 功能名称必须包含的要素（至少3个）：**
1. **数据对象**：用户数/流量/小区/基站/告警/配置（必须明确）
2. **操作动作**：查询/导出/导入/统计/汇总/展示/配置/删除/修改（必须明确，且只能一个操作）
3. **限定条件**：厂商/时间粒度/数据格式/图表类型（至少一个）

**⚠️ 一个功能只能包含一个操作动词！**
如果功能描述中出现"并"、"和"、"然后"等连接词，说明包含多个操作，必须拆分！

# 🚨🚨🚨 最高原则：
1. **组合爆炸式拆分，禁止合并！**
2. **一个功能只能做一件事（单一职责）！**
3. **多个操作必须拆分为多个功能！**

## 核心规则（必须遵守！）

**规则1：厂商×操作×数据 = 独立功能**
- ❌ 错误：识别1个"小区用户数汇总"
- ✅ 正确：识别N个独立功能
  - 华为小区用户数汇总
  - 中兴小区用户数汇总  
  - 爱立信小区用户数汇总
  
**规则2：时间粒度×操作 = 独立功能**
- ❌ 错误：识别1个"数据汇总"
- ✅ 正确：识别N个独立功能
  - 5分钟汇总
  - 小时汇总
  - 日汇总
  - 周汇总
  - 月汇总

**规则3：数据对象×操作 = 独立功能**
- ❌ 错误：识别1个"数据查询"
- ✅ 正确：识别N个独立功能
  - 用户数查询
  - 流量数据查询
  - 小区数据查询
  - 基站数据查询

**规则4：每个操作都要拆分（必须包括基础设施建设类！）**
如果文档提到某类数据或系统，必须检查是否有以下操作，每个都是独立功能：
- **数据操作类**：①数据查询 ②数据导入 ③数据导出 ④数据汇总 ⑤数据统计 ⑥数据分析
- **基础设施类**：①系统搭建 ②环境部署 ③服务配置 ④接口集成 ⑤数据迁移 ⑥版本升级

⚠️ 特别注意：当文档中出现"搭建"、"建立"、"部署"、"安装"、"配置"、"集成"、"迁移"等动词时，
必须识别为独立的功能过程！这些是基础设施建设类功能，不要遗漏！

**规则5：绝对禁止合并！**
- ❌ 禁止：把"华为数据导入、中兴数据导入"合并为"数据导入"
- ❌ 禁止：把"5分钟汇总、小时汇总"合并为"数据汇总"
- ✅ 必须：每个维度组合都单独列出

**规则6：界面元素必须识别为功能！**
- 文档中的每个"按钮"、"链接"、"跳转"都对应一个功能
- 示例：文档提到"点击小区名跳转到详情页" → 识别为"小区详情查看"功能
- 示例：文档提到"导出按钮" → 识别为"数据导出"功能
- 示例：文档提到"支持筛选" → 识别为"条件筛选"功能

**规则7：隐含功能必须挖掘！**
- 如果提到"展示列表"，通常隐含：①数据查询功能 ②列表展示功能
- 如果提到"数据统计"，通常隐含：①原始数据查询 ②统计计算 ③结果展示
- 如果提到"报表生成"，通常隐含：①数据汇总 ②报表生成 ③报表导出

**🚨规则8：基础设施/系统搭建类功能必须识别（极重要，常被遗漏！）**
当文档中出现以下动词时，**必须识别为独立的功能过程**：
| 动词关键词 | 必须识别的功能名称 | 示例 |
|-----------|------------------|------|
| 搭建、建立 | XXX搭建 / XXX建立 | 数据通道搭建、测试环境建立 |
| 部署、发布 | XXX部署 / XXX发布 | 服务部署、版本发布 |
| 安装、配置 | XXX安装 / XXX配置 | 组件安装、参数配置、规则配置 |
| 集成、对接、接入 | XXX集成 / XXX对接 / XXX接入 | 第三方接口集成、数据源接入 |
| 迁移、升级 | XXX迁移 / XXX升级 | 数据迁移、版本升级 |
| 初始化、启动、停止 | XXX初始化 / XXX启动 / XXX停止 | 系统初始化、服务启动 |
| 注册、绑定、解绑 | XXX注册 / XXX绑定 / XXX解绑 | 节点注册、资源绑定 |

📌 **示例**：
- 文档描述"搭建XX环境" → 必须识别为"XX环境搭建"功能
- 文档描述"部署XX服务" → 必须识别为"XX服务部署"功能
- 文档描述"配置XX规则" → 必须识别为"XX规则配置"功能
- 文档描述"对接XX接口" → 必须识别为"XX接口对接"功能

## 💡 笛卡尔积拆分思维（极其重要！）

如果文档提到：
- 3个厂商：华为、中兴、爱立信
- 4种操作：查询、导入、导出、汇总
- 2种数据：用户数、流量

**则必须识别 = 3 × 4 × 2 = 24 个功能！**

具体列表：
1. 华为用户数查询
2. 华为用户数导入
3. 华为用户数导出
4. 华为用户数汇总
5. 华为流量查询
6. 华为流量导入
7. 华为流量导出
8. 华为流量汇总
9. 中兴用户数查询
10. 中兴用户数导入
... (依此类推到24个)

## 📊 拆分示例矩阵

**场景1：小区数据管理**
如果文档提到"小区数据查询和导出"，并且有华为、中兴两个厂商：

| 厂商 | 操作 | 功能名称 |
|------|------|----------|
| 华为 | 查询 | 华为小区数据查询 |
| 华为 | 导出 | 华为小区数据导出 |
| 中兴 | 查询 | 中兴小区数据查询 |
| 中兴 | 导出 | 中兴小区数据导出 |

**总计：4个功能**

**场景2：数据汇总任务**
如果文档提到"用户数汇总"，并且有5分钟、小时、日三种粒度：

| 时间粒度 | 功能名称 |
|----------|----------|
| 5分钟 | 用户数5分钟汇总 |
| 小时 | 用户数小时汇总 |
| 日 | 用户数日汇总 |

**总计：3个功能**

**场景3：组合维度拆分**
如果文档提到"华为和中兴的小区用户数5分钟和小时汇总"：

| 厂商 | 时间粒度 | 功能名称 |
|------|----------|----------|
| 华为 | 5分钟 | 华为小区用户数5分钟汇总 |
| 华为 | 小时 | 华为小区用户数小时汇总 |
| 中兴 | 5分钟 | 中兴小区用户数5分钟汇总 |
| 中兴 | 小时 | 中兴小区用户数小时汇总 |

**总计：4个功能** (2厂商 × 2粒度)

## ⛔ 绝对禁止的错误做法

**错误示例1：合并厂商**
- ❌ 错：识别1个"小区数据查询（支持华为、中兴）"
- ✅ 对：识别2个"华为小区数据查询" + "中兴小区数据查询"

**错误示例2：合并操作**
- ❌ 错：识别1个"用户数据管理（查询、导出）"
- ✅ 对：识别2个"用户数查询" + "用户数导出"

**错误示例3：合并粒度**
- ❌ 错：识别1个"数据汇总任务（多粒度）"
- ✅ 对：识别5个"5分钟汇总" + "小时汇总" + "日汇总" + "周汇总" + "月汇总"

# ═══════════════════════════════════════════════════════════
# 18种超级深度功能挖掘策略（必须逐一应用！）
# ═══════════════════════════════════════════════════════════

⚠️ **重要**：你必须按顺序应用以下所有策略，每个策略都可能识别出新功能！

## 策略1：动词扫描法
扫描文档中所有动词，每个动词+业务对象=一个潜在功能：
- 创建、新增、添加 → XXX创建
- 查询、搜索、筛选 → XXX查询
- 修改、更新、编辑 → XXX修改
- 删除、移除、清除 → XXX删除
- 导入、上传、接收 → XXX导入
- 导出、下载、生成 → XXX导出
- 统计、汇总、计算 → XXX统计
- 推送、发送、通知 → XXX推送
- 监控、检测、预警 → XXX监控
- 搭建、建立、部署 → XXX搭建/部署
- 安装、配置、初始化 → XXX安装/配置
- 集成、对接、接入 → XXX集成/接入
- 迁移、升级、更新 → XXX迁移/升级
- 启动、停止、重启 → XXX启动/停止
- 注册、绑定、解绑 → XXX注册/绑定

## 策略2：界面功能说明拆分
当文档描述"支持XXX功能"时，必须拆分为独立功能：
- "支持查询、导出功能" → ①XXX查询 ②XXX导出（2个功能！）
- "支持增删改查" → ①创建 ②删除 ③修改 ④查询（4个功能！）
- "支持批量操作" → 单独列出批量版本

## 策略3：厂商维度全拆分（极重要！）
文档中每提到一个厂商，所有跟该厂商相关的操作都要单独列出：

**如果文档提到：**
- 华为、中兴、爱立信三个厂商
- 每个厂商有：数据查询、数据导入、数据导出、数据汇总

**则必须识别 = 3厂商 × 4操作 = 12个功能：**
1. 华为数据查询
2. 华为数据导入
3. 华为数据导出
4. 华为数据汇总
5. 中兴数据查询
6. 中兴数据导入
7. 中兴数据导出
8. 中兴数据汇总
9. 爱立信数据查询
10. 爱立信数据导入
11. 爱立信数据导出
12. 爱立信数据汇总

## 策略4：时间粒度全拆分（极重要！）
文档中每提到一个时间粒度，所有跟该粒度相关的操作都要单独列出：

**如果文档提到：**
- 5分钟、小时、日、周、月 5种粒度
- 每种粒度有：数据汇总、数据统计、报表生成

**则必须识别 = 5粒度 × 3操作 = 15个功能：**
1. 5分钟数据汇总
2. 5分钟数据统计
3. 5分钟报表生成
4. 小时数据汇总
5. 小时数据统计
... (依此类推到15个)

## 策略5：数据对象全拆分（极重要！）
文档中每提到一个数据对象，所有跟该对象相关的操作都要单独列出：

**如果文档提到：**
- 用户数、流量、小区、基站 4种数据
- 每种数据有：查询、导入、导出

**则必须识别 = 4数据对象 × 3操作 = 12个功能：**
1. 用户数查询
2. 用户数导入
3. 用户数导出
4. 流量查询
5. 流量导入
6. 流量导出
7. 小区数据查询
8. 小区数据导入
9. 小区数据导出
10. 基站数据查询
11. 基站数据导入
12. 基站数据导出

## 策略6：触发方式维度识别
识别所有触发方式：
- 用户触发：点击按钮、提交表单
- 时钟触发：定时任务、周期执行
- 接口触发：外部系统调用、数据推送
- 事件触发：状态变更触发、阈值触发

## 策略7：辅助功能必须识别
以下功能通常被遗漏，必须单独识别：
- **数据导出**：Excel导出、PDF导出、报表导出
- **数据导入**：批量导入、模板导入
- **条件查询**：按时间查询、按条件筛选
- **统计分析**：数量统计、趋势分析
- **告警推送**：短信通知、消息推送

## 策略8：定时任务专项识别
扫描以下关键词，识别定时任务：
- "每X分钟"、"定时"、"周期"、"自动"
- "日汇总"、"月报表"、"定期清理"

## 策略9：数据接入层功能
识别所有数据接入方式：
- 文件接收（FTP、本地上传）
- 接口对接（API调用、消息队列）
- 手动导入（Excel上传）

## 策略10：数据分发层功能
识别所有数据输出方式：
- 页面展示（列表、图表、大屏）
- 文件导出（Excel、PDF、CSV）
- 接口推送（对接其他系统）
- 消息通知（短信、邮件、站内信）

## 策略11：管理支撑功能
识别系统管理类功能：
- 配置管理（参数配置、规则配置）
- 权限管理（用户管理、角色管理）
- 日志管理（操作日志查询）

## 策略12：界面元素系统性扫描（新增！）
逐个扫描文档中提到的每个界面元素，每个元素都可能对应功能：
- **按钮**："提交"按钮 → 数据提交功能
- **链接**："查看详情"链接 → 详情查看功能
- **下拉框**："选择地市"下拉框 → 地市筛选功能
- **输入框**："输入关键词"输入框 → 关键词搜索功能
- **日期选择器**："选择日期"控件 → 日期范围查询功能
- **复选框**："全选"复选框 → 批量选择功能
- **表格列**：可点击的表头 → 排序功能

## 策略13：表格字段功能识别（新增！）
每个表格都包含多个隐藏功能：
- **表格名称本身** → 该表数据查询/展示功能
- **表格有导出按钮** → 该表数据导出功能
- **表格有查询条件** → 每个查询条件都是筛选功能的一部分
- **表格可点击行** → 详情查看功能
- **表格有分页** → 分页查询功能（可合并到查询功能）
- **表格有操作列（编辑/删除）** → 对应的修改/删除功能

## 策略14：数据流转功能识别（新增！）
追踪数据的完整生命周期：
- **数据接收** → 每种数据源（文件、接口、手工）都是独立功能
- **数据解析** → 如果文档提到解析，单独列为功能
- **数据验证** → 如果提到校验，单独列为功能
- **数据转换** → 如果提到格式转换，单独列为功能
- **数据存储** → 入库操作（通常隐含在其他功能中）
- **数据检索** → 查询功能
- **数据输出** → 导出、推送、展示等

## 策略15：批量操作功能识别（新增！）
单个操作和批量操作要分别识别：
- 如果文档提到"批量XXX"，单独列为一个功能
- 示例：既有"数据导入"，也要识别"批量数据导入"
- 示例：既有"数据删除"，也要识别"批量数据删除"

## 策略16：条件组合功能识别（新增！）
查询条件的每种组合都应细化：
- 如果查询条件有5个（日期、地市、区县、厂商、指标）
- 不仅要识别"XXX查询"功能
- 还要确认是否有"高级筛选"或"组合查询"作为独立功能

## 策略17：隐藏的CRUD功能识别（新增！）
系统性检查每个业务对象的增删改查：
- 如果文档提到某个"表"或"数据"
- 检查是否有：①创建 ②查询 ③修改 ④删除 ⑤导出 ⑥导入
- 即使文档只提到"管理"，也要拆分成多个具体功能
- 示例："用户管理" → ①用户创建 ②用户查询 ③用户修改 ④用户删除 ⑤用户导出

## 策略18：二次验证扫描（新增！）
在识别完成后，重新扫描文档，检查是否遗漏：
- 扫描所有**动词**（查询、导出、统计、生成、接收...）
- 扫描所有**名词+动词组合**（数据+导出、报表+生成...）
- 扫描所有**"支持""可以""能够"**后面的功能描述
- 扫描所有**逗号、顿号分隔的功能列表**
- 检查已识别功能数量，如果少于文档字数/200，说明遗漏严重

## 策略19：页面/表格系统性识别（关键！）
对于文档中每个提到的页面或表格，必须系统性识别：
- **查询功能**：该页面/表格的数据查询
- **导出功能**：如果提到"支持导出"或有导出按钮
- **详情查看**：如果表格行可点击或有"查看详情"
- **新增功能**：如果有"新增"、"添加"按钮
- **修改功能**：如果有"编辑"、"修改"按钮
- **删除功能**：如果有"删除"按钮
示例：文档提到"用户管理页面" → 必须识别5个功能：①用户查询 ②用户新增 ③用户修改 ④用户删除 ⑤用户导出

## 策略20：关键词触发识别（强制！）
遇到以下关键词，强制识别对应功能：
- "支持查询" → 必须有"XXX数据查询"功能
- "支持导出" / "导出功能" → 必须有"XXX数据导出"功能
- "点击跳转" / "跳转至" → 必须有"XXX详情查看"或"XXX跳转"功能
- "定时" / "周期" / "自动" → 必须有"XXX定时任务"功能
- "批量" → 如有"批量删除"，则删除功能要拆分为：单个删除 + 批量删除（2个）
- "管理" → 必须拆分为至少4个功能：查询、新增、修改、删除
- **"搭建" / "建立"** → 必须有"XXX搭建"或"XXX环境建立"功能
- **"部署" / "发布"** → 必须有"XXX部署"或"XXX发布"功能
- **"安装" / "配置"** → 必须有"XXX安装"或"XXX配置"功能
- **"集成" / "对接" / "接入"** → 必须有"XXX集成"或"XXX接入"功能
- **"迁移" / "升级"** → 必须有"XXX迁移"或"XXX升级"功能
- **"初始化" / "启动" / "停止"** → 必须有对应的系统操作功能

## 策略21：基础设施/系统搭建类功能识别（🚨 极重要！）
⚠️ 这类功能经常被遗漏！必须专项识别！

### 必须识别的基础设施类功能：
| 文档关键词 | 必须识别的功能 | 触发类型 |
|-----------|--------------|----------|
| 搭建XX环境 | XX环境搭建 | 用户触发 |
| 建立XX连接 | XX连接建立 | 用户触发/系统触发 |
| 部署XX服务 | XX服务部署 | 用户触发 |
| 发布XX版本 | XX版本发布 | 用户触发 |
| 安装XX组件 | XX组件安装 | 用户触发 |
| 配置XX参数 | XX参数配置 | 用户触发 |
| 集成XX系统 | XX系统集成 | 用户触发 |
| 对接XX接口 | XX接口对接 | 用户触发 |
| 接入XX数据源 | XX数据源接入 | 用户触发/系统触发 |
| 迁移XX数据 | XX数据迁移 | 用户触发/系统触发 |
| 升级XX版本 | XX版本升级 | 用户触发 |
| 初始化XX模块 | XX模块初始化 | 系统触发 |
| 启动XX服务 | XX服务启动 | 用户触发/系统触发 |
| 停止XX服务 | XX服务停止 | 用户触发/系统触发 |
| 注册XX节点 | XX节点注册 | 用户触发/系统触发 |
| 绑定XX资源 | XX资源绑定 | 用户触发 |
| 解绑XX资源 | XX资源解绑 | 用户触发 |

### 示例：文档描述的基础设施功能识别
📝 文档原文："本系统支持搭建数据采集环境，配置采集规则，并对接第三方数据接口"
✅ 必须识别的功能（3个）：
1. **数据采集环境搭建**（用户触发）- 搭建数据采集所需的运行环境
2. **采集规则配置**（用户触发）- 配置数据采集的业务规则和参数
3. **第三方数据接口对接**（用户触发）- 对接外部第三方数据源接口

📝 文档原文："支持服务部署与版本升级管理"
✅ 必须识别的功能（2个）：
1. **服务部署**（用户触发）- 部署系统服务到生产环境
2. **版本升级**（用户触发）- 升级系统或模块版本

## 策略22：功能界面说明专项识别（🚨🚨🚨 极极重要！）
⚠️ 文档中"功能界面说明"部分是功能识别的核心来源，必须逐条识别！

### 文档格式识别规则：
当文档中出现以下格式的内容时，每一条都必须识别为独立功能：

**格式1：编号+支持+功能**
\`\`\`
1. 支持查询（条件1、条件2...）
2. 支持导出
3. 点击XXX，跳转至YYY
\`\`\`
→ 必须识别为3个独立功能！

**格式2：逗号/顿号分隔的功能列表**
\`\`\`
支持查询、导出、打印功能
\`\`\`
→ 必须拆分为3个独立功能：①XXX查询 ②XXX导出 ③XXX打印

**格式3：括号内的条件说明**
\`\`\`
支持查询（日期、地市、区县、场景名称、是否健康度质差、是否质差）
\`\`\`
→ 括号内是查询条件，整体识别为1个带多条件的查询功能

### 必须识别的功能界面关键词：
| 文档关键词 | 必须识别的功能 | 备注 |
|-----------|--------------|------|
| 支持查询 | XXX数据查询 | 括号内是查询条件 |
| 支持导出 | XXX数据导出 | 通常是Excel导出 |
| 点击XXX跳转 | XXX详情查看/跳转 | 每个跳转都是一个功能 |
| 上查询，下列表 | XXX列表查询 | 查询+列表展示 |
| 双击进入 | XXX详情查看 | 详情页进入功能 |
| 右键菜单 | XXX右键操作 | 右键菜单功能 |
| 按钮操作 | XXX按钮功能 | 按钮触发的功能 |

### 示例：功能界面说明识别
📝 文档原文：
\`\`\`
1.1.4.1 功能界面说明
1. 支持查询（日期（时间段）、NGI（模糊查询）、小区名称（模糊查询）、地市（下拉）、
   场景名称（模糊查询）、是否健康度质差（下拉）、是否质差（下拉））。
2. 支持导出。
\`\`\`

✅ 必须识别的功能（2个）：
1. **小区业务感知健康度数据查询**（用户触发）- 按日期、NGI、小区名称、地市、场景名称等条件查询
2. **小区业务感知健康度数据导出**（用户触发）- 支持导出查询结果

## 策略23：功能过程深度拆分（🚨 避免遗漏！）
当识别到查询、导出等功能后，还需要检查是否有以下隐含功能：

### 查询类功能的隐含功能：
- **条件筛选**：如果有多个查询条件，可能有独立的筛选功能
- **分页查询**：如果数据量大，通常有分页功能
- **排序功能**：如果表格列可点击排序
- **数据刷新**：如果有刷新按钮

### 列表类功能的隐含功能：
- **详情查看**：点击行查看详情
- **批量选择**：复选框批量操作
- **列设置**：自定义显示列

### 导出类功能的隐含功能：
- **格式选择**：如果支持多种导出格式（Excel、PDF、CSV）
- **范围选择**：如果能选择导出范围（全部、选中、当前页）

## 策略24：🚨🚨🚨 支持查询/导出功能的具体化拆分（极其重要！）

⚠️ **这是最常见的遗漏错误！文档中"支持查询"和"支持导出"必须与具体数据名称结合！**

### 问题描述：
当文档中出现以下描述时：
\`\`\`
1. 支持查询（日期、NGI、小区名称、地市、场景名称、健康度质差、质差等）
2. 支持导出
\`\`\`

**❌ 错误做法**：仅识别为1个"支持查询"和1个"支持导出"功能
**✅ 正确做法**：必须结合页面/表格的数据名称，拆分为具体的功能过程

### 必须拆分规则：

**规则1：查询功能必须包含具体数据名称**
- ❌ 错误：查询（支持多条件）
- ✅ 正确：查询日粒度小区业务感知健康度详情表数据

**规则2：导出功能必须包含具体数据名称**
- ❌ 错误：导出
- ✅ 正确：导出小区业务感知健康度详情表-日数据

### 示例拆分：

📝 **文档原文**：
\`\`\`
日粒度小区感知健康度综合评估表-日
1.1.4.1 功能界面说明
1. 支持查询（日期（时间段）、NGI（模糊查询）、小区名称（模糊查询）、地市（下拉）、场景名称（模糊查询）、健康度质差（大于、小于））。
2. 支持导出。
\`\`\`

✅ **必须识别的功能（2个）**：
1. **查询日粒度小区感知健康度综合评估表数据**（用户触发）
2. **导出日粒度小区感知健康度综合评估表数据**（用户触发）

**🚨 关键点**：功能名称必须包含具体的表名/数据名称，不能只说"查询"或"导出"！

## 策略25：🚨🚨🚨 多数据源组合功能的独立拆分（极其重要！）

⚠️ **当一个功能基于多个数据源时，必须拆分为独立的功能过程！**

### 问题描述：
当文档描述类似以下内容时：
\`\`\`
基于中兴小区级智算板指标-日数据、中兴小区级智算板长视频指标-日数据、
中兴小区级智算板网页浏览器-日数据和中兴小区级智算板移动游戏指标-日数据，
调用健康度评估规则和质差评估规则，生成中兴小区业务感知健康度评估表-日数据。
\`\`\`

**❌ 错误做法**：识别为1个"中兴小区业务感知健康度评估表-日数据生成"功能
**✅ 正确做法**：必须拆分为多个独立的功能过程

### 必须拆分规则：

**规则1：每个数据源读取是独立的R(Read)操作**
- 读取中兴小区级智算板指标-日数据 → 独立的数据读取功能
- 读取中兴小区级智算板长视频指标-日数据 → 独立的数据读取功能
- 读取中兴小区级智算板网页浏览器-日数据 → 独立的数据读取功能
- 读取中兴小区级智算板移动游戏指标-日数据 → 独立的数据读取功能

**规则2：每个独立数据指标的评估是独立的功能过程**

### 示例拆分：

📝 **文档原文**：
\`\`\`
基于中兴小区级智算板指标-日数据、中兴小区级智算板长视频指标-日数据、
中兴小区级智算板网页浏览器-日数据和中兴小区级智算板移动游戏指标-日数据，
调用健康度评估规则和质差评估规则，生成中兴小区业务感知健康度评估表-日数据。
\`\`\`

✅ **必须识别的功能（至少5个）**：
1. **读取中兴小区级智算板基础指标-日数据**（用户触发/时钟触发）
2. **读取中兴小区级智算板长视频指标-日数据**（用户触发/时钟触发）
3. **读取中兴小区级智算板网页浏览器指标-日数据**（用户触发/时钟触发）
4. **读取中兴小区级智算板移动游戏指标-日数据**（用户触发/时钟触发）
5. **生成中兴小区业务感知健康度评估表-日数据**（用户触发/时钟触发）

### 判断标准：

**在描述中出现以下关键词时，必须拆分**：
- "基于XXX、YYY、ZZZ" → XXX、YYY、ZZZ各自是独立的读取功能
- "和XXX数据" → XXX是独立的读取功能
- "调用XXX规则" → 规则应用可能是独立功能
- "读取XXX和YYY" → 拆分为2个独立读取功能

**🚨 核心原则：一个功能只能做一件事！读取多个数据源=多个功能！**

## 策略26：功能页面说明中列表项的精确拆分

当文档中"功能界面说明"或"功能页面说明"部分出现编号列表时，**每个编号都是一个独立功能**：

### 示例：
\`\`\`
功能界面说明
1. 支持查询（日期、NGI、小区名称等）
2. 支持导出
\`\`\`

**必须识别2个独立功能**：
1. 查询XXX表数据（功能名称要包含具体表名！）
2. 导出XXX表数据（功能名称要包含具体表名！）

### 命名规则：
功能名称 = **操作动词 + 具体数据表名/页面名**

例如：
- 页面名称：日粒度小区感知健康度综合评估表
- 支持查询 → **查询日粒度小区感知健康度综合评估表数据**
- 支持导出 → **导出日粒度小区感知健康度综合评估表数据**


# ═══════════════════════════════════════════════════════════
# 功能识别输出要求
# ═══════════════════════════════════════════════════════════

对于每个功能，必须识别：
- **功能名称**：[厂商/业务对象]+动词+[时间粒度]（如"华为小区用户数5分钟汇总"）
- **触发方式**：用户触发 / 时钟触发 / 接口触发
- **所属模块**：该功能属于哪个业务模块
- **简要描述**：该功能做什么（一句话）
- **涉及数据**：该功能处理的主要数据对象

# ═══════════════════════════════════════════════════════════
# 🚨🚨🚨 最重要！"功能界面说明"专项识别 🚨🚨🚨
# ═══════════════════════════════════════════════════════════

文档中"功能界面说明"部分通常包含大量功能描述，这些功能**必须全部识别**！

## 必须识别的功能类型：

### 1. 查询功能（最常遗漏！）
当文档描述"支持查询（条件1、条件2...）"时：
- **必须识别为一个独立功能**："XXX数据查询"
- 示例：文档写"支持查询（日期、地市、区县、场景名称）"
  → 识别为："周粒度小区健康度数据查询"（用户触发）

### 2. 导出功能（最常遗漏！）
当文档描述"支持导出"或"导出功能"时：
- **必须识别为一个独立功能**："XXX数据导出"
- 示例：文档写"支持导出"
  → 识别为："周粒度小区健康度数据导出"（用户触发）

### 3. 跳转/详情查看功能（最常遗漏！）
当文档描述"点击XXX，跳转到YYY"时：
- **必须识别为一个独立功能**："XXX详情查看" 或 "跳转至YYY"
- 示例：文档写"点击质差小区数，跳转至小区业务感知健康度&质差详情表-日"
  → 识别为："质差小区详情跳转查看"（用户触发）
- 示例：文档写"点击健康度总分，跳转至小区感知健康度综合评估表-日"
  → 识别为："健康度综合评估详情查看"（用户触发）

### 4. 统计/汇总功能
当文档描述"统计XXX情况"时：
- **必须识别为一个独立功能**
- 示例：文档写"统计周粒度省市县场景级小区健康度&质差情况"
  → 识别为："周粒度小区健康度统计分析"（时钟触发 或 用户触发）

### 5. 列表展示功能
当文档描述"上查询，下列表呈现"时：
- 查询和列表展示可以合并为一个"XXX数据查询"功能

## 🚨 绝对禁止遗漏的功能清单（扩展版）

请在识别时，**逐字扫描**文档中的以下关键词，每出现一次都必须对应一个功能：

| 关键词 | 必须识别的功能 | 示例 |
|-------|--------------|------|
| "管理" | 拆分为增删改查导出 | "用户管理"→5个功能 |
| "支持查询" | XXX数据查询 | "支持按日期查询" |  
| "支持导出" | XXX数据导出 | "支持导出Excel" |
| "导出功能" | XXX数据导出 | "数据导出功能" |
| "点击XXX跳转" | XXX详情查看/跳转 | "点击小区名跳转" |
| "跳转至" | XXX详情查看/跳转 | "跳转至详情页" |
| "统计" | XXX统计分析 | "统计用户数" |
| "汇总" | XXX数据汇总 | "日汇总任务" |
| "定时" / "每X分钟" | XXX定时任务 | "每5分钟执行" |
| "导入" | XXX数据导入 | "文件导入" |
| "上传" | XXX数据上传 | "上传配置文件" |
| "下载" | XXX数据下载 | "下载模板" |
| "筛选" | XXX数据筛选 | "按条件筛选" |
| "排序" | XXX数据排序 | "按时间排序" |
| "展示" | XXX数据展示 | "图表展示" |
| "呈现" | XXX数据呈现 | "列表呈现" |
| "推送" | XXX消息推送 | "告警推送" |
| "通知" | XXX消息通知 | "短信通知" |
| "配置" | XXX参数配置 | "规则配置" |
| "设置" | XXX参数设置 | "阈值设置" |
| "生成" | XXX报表生成 | "生成日报" |
| "计算" | XXX数据计算 | "计算健康度" |
| "分析" | XXX数据分析 | "趋势分析" |
| "监控" | XXX状态监控 | "性能监控" |
| "预警" | XXX异常预警 | "阈值预警" |
| **"搭建"** | **XXX搭建** | **"搭建数据通道"** |
| **"建立"** | **XXX建立** | **"建立连接"** |
| **"部署"** | **XXX部署** | **"服务部署"** |
| **"发布"** | **XXX发布** | **"版本发布"** |
| **"安装"** | **XXX安装** | **"组件安装"** |
| **"集成"** | **XXX集成** | **"接口集成"** |
| **"对接"** | **XXX对接** | **"系统对接"** |
| **"接入"** | **XXX接入** | **"数据源接入"** |
| **"迁移"** | **XXX迁移** | **"数据迁移"** |
| **"升级"** | **XXX升级** | **"版本升级"** |
| **"初始化"** | **XXX初始化** | **"系统初始化"** |
| **"启动"** | **XXX启动** | **"服务启动"** |
| **"停止"** | **XXX停止** | **"服务停止"** |
| **"注册"** | **XXX注册** | **"节点注册"** |
| **"绑定"** | **XXX绑定** | **"资源绑定"** |
| **"解绑"** | **XXX解绑** | **"资源解绑"** |

# ✅🚨 最终检查清单（输出前必须逐项核对！）

**🚨 泛化检查（最重要！违规必须重做！）：**
逐个检查每个功能名称，确保：
- [ ] ❌ 是否有"数据业务XXX"这样的泛化表达？（必须改为具体数据对象）
- [ ] ❌ 是否有只写"数据"而不说明具体是什么数据？（必须明确：用户数/流量/小区/基站）
- [ ] ❌ 是否有只写"可视化"而不说明用什么图表？（必须明确：柱状图/折线图/饼图）
- [ ] ❌ 是否有只写"展示"而不说明展示什么？（必须明确展示对象和方式）
- [ ] ❌ 是否有功能名称超过15个字？（必须拆分为多个功能）
- [ ] ✅ 每个功能名称是否都包含：数据对象+操作动作+限定条件？
- [ ] ✅ 功能数量是否≥20个？（如果<20个，说明拆分不够细！）

**基础检查：**
- [ ] 文档中"功能界面说明"部分的每个功能是否都已识别？
- [ ] 文档中"支持查询"是否已识别为查询功能？
- [ ] 文档中"支持导出"是否已识别为导出功能？
- [ ] 文档中所有"点击XXX跳转"是否都已识别为跳转功能？
- [ ] 文档中所有"定时/汇总"任务是否都已识别？
- [ ] **🚨 文档中所有"搭建/部署/配置/集成/迁移"是否都已识别为独立功能？**

**维度拆分检查：**
- [ ] 不同厂商（华为/中兴/爱立信）的功能是否分开列出？
- [ ] 不同时间粒度（5分钟/小时/日/周/月）的功能是否分开列出？
- [ ] 不同数据对象（用户数/流量/小区/基站）的功能是否分开列出？
- [ ] 不同操作类型（单个/批量）的功能是否分开列出？

**完整性检查：**
- [ ] 每个提到的"表"或"界面"是否都识别了：查询、导出、详情查看功能？
- [ ] 每个提到的"管理"功能是否拆分为：增、删、改、查、导出？
- [ ] 所有按钮、链接、下拉框等界面元素对应的功能是否都已识别？
- [ ] 识别的功能总数是否≥文档字数/200？（粗略估算，字数多应该功能也多）
- [ ] 是否检查了文档中用逗号、顿号分隔的功能列表？

**二次验证：**
- [ ] 重新快速浏览文档，看是否还有遗漏的动词（查、增、删、改、导、统计...）
- [ ] **🚨 检查是否遗漏了"搭建"、"部署"、"配置"、"集成"、"迁移"这类基础设施动词**
- [ ] 检查是否有"支持XXX、XXX、XXX"这样的多功能描述被拆分了
- [ ] 确认功能数量：如果识别少于20个，很可能遗漏严重！
- [ ] **🚨🚨 检查"支持查询"和"支持导出"功能名称是否包含具体的数据表名/页面名？（绝对禁止只写"查询"或"导出"！）**
- [ ] **🚨🚨 检查是否有"基于XXX、YYY、ZZZ数据"的描述？如果有，是否已拆分为多个独立的读取功能？**
- [ ] **🚨🚨 检查功能描述中是否有"和"、"并"、"同时"等连接词？如果有，是否已拆分为多个独立功能？**


# 🎯 功能命名模板（必须遵守！）

**标准命名格式：[数据对象] + [操作动作] + [限定条件]**

**示例1：查询类功能**
- ✅ "小区用户数查询"（数据对象：小区用户数 + 操作：查询）
- ✅ "华为基站流量查询"（限定：华为 + 数据对象：基站流量 + 操作：查询）
- ✅ "5分钟汇总数据查询"（限定：5分钟汇总 + 数据对象：数据 + 操作：查询）

**示例2：导出类功能**
- ✅ "小区用户数Excel导出"（数据对象 + 格式 + 操作）
- ✅ "华为基站告警CSV导出"（限定 + 数据对象 + 格式 + 操作）

**示例3：可视化类功能**
- ✅ "用户数趋势折线图展示"（数据对象 + 趋势 + 图表类型 + 操作）
- ✅ "小区负荷率柱状图查看"（数据对象 + 指标 + 图表类型 + 操作）
- ✅ "流量分布饼图可视化"（数据对象 + 分布 + 图表类型 + 操作）

**示例4：定时任务**
- ✅ "用户数5分钟汇总定时任务"（数据对象 + 时间粒度 + 操作 + 任务类型）
- ✅ "华为小区数据日汇总定时任务"（限定 + 数据对象 + 时间粒度 + 操作 + 任务类型）

**❌ 绝对禁止的错误命名（一旦出现必须立即修正）：**
- ❌ "用户画像" → 必须拆分为：用户行为特征统计、用户属性分析、用户标签生成
- ❌ "小区画像" → 必须拆分为：小区负荷率统计、小区用户数分析、小区流量特征分析
- ❌ "业务画像" → 必须拆分为：业务类型统计、业务流量分析、业务用户分布分析
- ❌ "数据可视化" → 必须拆分为：用户数折线图展示、流量柱状图展示、分布饼图展示
- ❌ "首页展示" → 必须拆分为：关键指标展示、趋势图表展示、告警信息展示
- ❌ "交互功能" → 必须拆分为：参数配置、数据查询、结果导出
- ❌ "数据业务XXX" → 改为具体数据对象
- ❌ "数据XXX" → 改为"用户数XXX"、"流量XXX"等
- ❌ "可视化展示" → 改为"XX折线图展示"、"XX柱状图查看"
- ❌ "智能体交互" → 改为"XX数据提交"、"XX参数配置"
- ❌ "画像生成" → 改为"XX指标统计"、"XX特征分析"

**🚫 严格禁止使用的词汇黑名单：**
以下词汇绝对不能单独作为功能名称的主要部分：
- "画像"（必须明确是什么指标/特征）
- "可视化"（必须明确图表类型）
- "交互"（必须明确交互什么）
- "展示"（必须明确展示什么和用什么方式）
- "数据"（必须明确具体数据对象）
- "业务"（必须明确具体业务类型）
- "生成"（必须明确生成什么）
- "管理"（必须拆分为增删改查导）

**🚫 严格禁止的复合操作连接词：**
功能名称中出现以下词汇，说明包含多个操作，必须拆分：
- "生成XXX表/报表" → 拆分为：数据计算/评估 + 表格生成
- "统计并生成" → 拆分为：统计 + 生成
- "查询并导出" → 拆分为：查询 + 导出
- "分析并展示" → 拆分为：分析 + 展示
- "评估并生成" → 拆分为：评估 + 生成
- "计算并保存" → 拆分为：计算 + 保存
- "汇总并推送" → 拆分为：汇总 + 推送

**🚫🚫🚫 极其重要的禁止规则（必须遵守！）：**

**禁止规则1：功能名称必须包含具体数据表名**
- ❌ 错误：支持查询 → 必须改为：查询[具体表名]数据
- ❌ 错误：支持导出 → 必须改为：导出[具体表名]数据
- ❌ 错误：数据查询 → 必须改为：[具体数据对象]查询
- ❌ 错误：数据导出 → 必须改为：[具体数据对象]导出
示例：
- ✅ 正确：查询日粒度小区感知健康度综合评估表数据
- ✅ 正确：导出小区业务感知健康度详情表-日数据

**禁止规则2：基于多数据源的功能必须拆分为独立功能**
- ❌ 错误：基于A、B、C数据生成D报表（1个功能）
- ✅ 正确：拆分为4个功能：①读取A数据 ②读取B数据 ③读取C数据 ④生成D报表
示例：
- ❌ 错误：中兴小区业务感知健康度评估表-日数据生成（基于4个指标数据）
- ✅ 正确（5个功能）：
  - 读取中兴小区级智算板基础指标-日数据
  - 读取中兴小区级智算板长视频指标-日数据
  - 读取中兴小区级智算板网页浏览器指标-日数据
  - 读取中兴小区级智算板移动游戏指标-日数据
  - 生成中兴小区业务感知健康度评估表-日数据


# 输出格式
请严格按照以下JSON格式输出：

\`\`\`json
{
  "projectName": "项目名称",
  "projectDescription": "项目描述（一句话）",
  "totalFunctions": 50,  // ⚠️ 必须≥20，否则说明拆分不够细！
  "modules": [
    {
      "moduleName": "模块名称",
      "functions": [
        {
          "id": 1,
          "name": "小区用户数查询",  // ⚠️ 必须具体，禁止泛化！
          "triggerType": "用户触发",
          "description": "查询指定小区的用户数统计数据",
          "dataObjects": ["小区用户数"]  // ⚠️ 必须具体到数据对象
        }
      ]
    }
  ],
  "timedTasks": [
    {
      "name": "用户数5分钟汇总定时任务",  // ⚠️ 必须包含时间粒度
      "interval": "5分钟",
      "description": "每5分钟汇总用户数数据"
    }
  ],
  "suggestions": []
}
\`\`\`

# 🚨🚨🚨 极其重要：输出格式要求 🚨🚨🚨

1. **必须输出JSON格式**：你的回复必须是一个有效的JSON对象，包裹在 \`\`\`json 和 \`\`\` 之间
2. **不要输出任何解释文字**：直接输出JSON，不要在JSON前后添加任何说明
3. **确保JSON格式正确**：
   - 所有字符串必须用双引号
   - 数组最后一个元素后不要加逗号
   - 确保所有括号正确闭合

---
${userGuidelines ? `
# 🚨🚨🚨 用户强制要求（必须严格遵守！）

**以下是用户特别指定的限制条件，必须在所有规则中优先执行：**

\`\`\`
${userGuidelines}
\`\`\`

**⚠️ 必须严格按照上述用户要求来命名功能！如果用户要求"动词在前"，所有功能名称必须以动词开头！**

---
` : ''}
**文档内容：**

${documentContent}

---

**请直接输出JSON格式的功能清单（不要输出任何其他内容）：**`;

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
        temperature: 0.2,  // 降低温度提高准确性和完整性
        max_tokens: 16000  // 增加token限制以识别更多功能
      });
    } else {
      completion = await client.chat.completions.create({
        model,
        messages: [{ role: 'user', content: extractionPrompt }],
        temperature: 0.2,  // 降低温度提高准确性和完整性
        max_tokens: 16000  // 增加token限制以识别更多功能
      });
    }

    const reply = completion.choices[0].message.content;
    console.log(`功能清单提取 - 完成，响应长度: ${reply.length}`);

    // 🔧 多轮迭代补充（如果启用）
    let finalReply = reply;
    if (maxIterations > 1) {
      console.log(`\n🔄 启动多轮迭代补充机制（${maxIterations - 1}轮）...`);
      finalReply = await iterativeEnhancement(
        documentContent,
        reply,
        clientConfig,
        maxIterations - 1
      );
    }

    // 尝试解析JSON - 增强版解析逻辑
    let functionList = null;
    let parseDetails = { attempts: [], success: false };

    try {
      // 提取JSON部分 - 使用多种匹配策略
      let jsonStr = null;
      let extractMethod = '';

      // 策略1：匹配 ```json ... ``` 代码块（非贪婪匹配）
      const jsonBlockMatch = reply.match(/```json\s*([\s\S]*?)```/);
      if (jsonBlockMatch && jsonBlockMatch[1]) {
        jsonStr = jsonBlockMatch[1].trim();
        extractMethod = 'json代码块';
        parseDetails.attempts.push({ method: extractMethod, found: true });
      }

      // 策略2：匹配 ``` ... ``` 代码块（可能没有json标记）
      if (!jsonStr) {
        const codeBlockMatch = reply.match(/```\s*([\s\S]*?)```/);
        if (codeBlockMatch && codeBlockMatch[1] && codeBlockMatch[1].trim().startsWith('{')) {
          jsonStr = codeBlockMatch[1].trim();
          extractMethod = '普通代码块';
          parseDetails.attempts.push({ method: extractMethod, found: true });
        }
      }

      // 策略3：直接匹配最外层的 { ... } 对象（使用更智能的括号匹配）
      if (!jsonStr) {
        const firstBrace = reply.indexOf('{');
        if (firstBrace !== -1) {
          // 使用括号匹配找到完整的JSON对象
          let depth = 0;
          let lastBrace = -1;
          for (let i = firstBrace; i < reply.length; i++) {
            if (reply[i] === '{') depth++;
            if (reply[i] === '}') {
              depth--;
              if (depth === 0) {
                lastBrace = i;
                break;
              }
            }
          }

          if (lastBrace !== -1) {
            jsonStr = reply.substring(firstBrace, lastBrace + 1);
            extractMethod = '直接括号匹配';
            parseDetails.attempts.push({ method: extractMethod, found: true });
          }
        }
      }

      if (jsonStr) {
        // 清理JSON字符串中的常见问题
        const originalLength = jsonStr.length;
        jsonStr = jsonStr
          // 移除可能的BOM字符
          .replace(/^\uFEFF/, '')
          // 移除JSON中的注释（// 和 /* */）
          .replace(/\/\/[^\n]*/g, '')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          // 移除尾随逗号（对象和数组中最后一个元素后的逗号）
          .replace(/,(\s*[}\]])/g, '$1')
          // 修复可能的换行问题
          .replace(/\r\n/g, '\n')
          // 移除控制字符（除了换行和制表符）
          .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
          // 修复可能的转义问题
          .replace(/\\\\n/g, '\\n')
          .trim();

        console.log(`功能清单提取 - 提取方法: ${extractMethod}, 原始长度: ${originalLength}, 清理后长度: ${jsonStr.length}`);
        console.log('功能清单提取 - JSON预览:', jsonStr.substring(0, 200) + '...');

        try {
          functionList = JSON.parse(jsonStr);
          parseDetails.success = true;
          parseDetails.method = extractMethod;
          console.log('功能清单提取 - JSON解析成功');
        } catch (strictError) {
          console.log('功能清单提取 - 标准JSON解析失败:', strictError.message);
          parseDetails.attempts.push({ method: '标准解析', error: strictError.message });

          // 尝试更宽松的解析
          try {
            let relaxedJson = jsonStr
              .replace(/,(\s*[}\]])/g, '$1')  // 移除尾随逗号
              .replace(/([{,]\s*)([a-zA-Z_$][\w$]*)\s*:/g, '$1"$2":')  // 无引号的key加引号
              .replace(/:\s*'([^']*)'/g, ': "$1"')  // 单引号值转双引号
              .replace(/""/g, '"');  // 修复双引号问题

            functionList = JSON.parse(relaxedJson);
            parseDetails.success = true;
            parseDetails.method = extractMethod + '(宽松模式)';
            console.log('功能清单提取 - 宽松模式JSON解析成功');
          } catch (relaxedError) {
            console.log('功能清单提取 - 宽松模式解析失败:', relaxedError.message);
            parseDetails.attempts.push({ method: '宽松解析', error: relaxedError.message });

            // 尝试修复截断的JSON
            try {
              console.log('功能清单提取 - 尝试修复截断的JSON');
              let repairedJson = jsonStr;

              // 检查是否在字符串中间被截断（最后一个字符不是 } ] " ）
              if (!repairedJson.match(/[}\]"]\s*$/)) {
                // 如果在字符串值中被截断，尝试补全引号
                const lastQuote = repairedJson.lastIndexOf('"');
                const lastColon = repairedJson.lastIndexOf(':');
                if (lastColon > lastQuote) {
                  // 在键值对的值部分被截断，补全引号
                  repairedJson += '"';
                  console.log('补全了缺失的引号');
                }
              }

              // 统计未闭合的括号
              let openBraces = 0, openBrackets = 0;
              let inString = false;
              for (let i = 0; i < repairedJson.length; i++) {
                const char = repairedJson[i];
                if (char === '"' && (i === 0 || repairedJson[i - 1] !== '\\')) {
                  inString = !inString;
                }
                if (!inString) {
                  if (char === '{') openBraces++;
                  if (char === '}') openBraces--;
                  if (char === '[') openBrackets++;
                  if (char === ']') openBrackets--;
                }
              }

              // 移除可能的不完整项（最后一个逗号后的内容）
              if (openBraces > 0 || openBrackets > 0) {
                const lastComma = repairedJson.lastIndexOf(',');
                const lastCloseBrace = repairedJson.lastIndexOf('}');
                const lastCloseBracket = repairedJson.lastIndexOf(']');
                const lastClose = Math.max(lastCloseBrace, lastCloseBracket);

                if (lastComma > lastClose) {
                  // 有一个逗号在最后一个闭合括号之后，说明后面的内容可能不完整
                  repairedJson = repairedJson.substring(0, lastComma);
                  console.log('移除了不完整的最后一项');

                  // 重新计算括号
                  openBraces = 0; openBrackets = 0; inString = false;
                  for (let i = 0; i < repairedJson.length; i++) {
                    const char = repairedJson[i];
                    if (char === '"' && (i === 0 || repairedJson[i - 1] !== '\\')) {
                      inString = !inString;
                    }
                    if (!inString) {
                      if (char === '{') openBraces++;
                      if (char === '}') openBraces--;
                      if (char === '[') openBrackets++;
                      if (char === ']') openBrackets--;
                    }
                  }
                }
              }

              // 补全缺失的闭合括号
              console.log(`需要补全: ${openBrackets} 个], ${openBraces} 个}`);
              repairedJson += ']'.repeat(openBrackets) + '}'.repeat(openBraces);

              functionList = JSON.parse(repairedJson);
              parseDetails.success = true;
              parseDetails.method = extractMethod + '(修复模式)';
              console.log('功能清单提取 - JSON修复成功');
            } catch (repairError) {
              console.log('功能清单提取 - JSON修复失败:', repairError.message);
              parseDetails.attempts.push({ method: 'JSON修复', error: repairError.message });
            }
          }
        }
      } else {
        console.log('功能清单提取 - 未找到JSON内容');
        parseDetails.attempts.push({ method: 'JSON提取', found: false });
      }
    } catch (parseError) {
      console.error('功能清单提取 - 解析过程异常:', parseError);
      parseDetails.attempts.push({ method: '总体解析', error: parseError.message });
    }

    // 策略4：如果JSON解析全部失败，尝试从纯文本中提取功能列表
    if (!functionList) {
      console.log('功能清单提取 - JSON解析失败，尝试从纯文本提取功能列表');
      parseDetails.attempts.push({ method: '纯文本提取', started: true });

      functionList = extractFunctionListFromText(finalReply);
      if (functionList && functionList.modules && functionList.modules.length > 0) {
        parseDetails.success = true;
        parseDetails.method = '纯文本提取';
        console.log('功能清单提取 - 从纯文本提取成功，识别到', functionList.totalFunctions, '个功能');
      } else {
        console.log('功能清单提取 - 纯文本提取也失败');
        parseDetails.attempts.push({ method: '纯文本提取', success: false });
      }
    }

    // 记录解析详情到响应中，便于调试
    if (!functionList) {
      console.error('功能清单提取 - 所有解析策略均失败');
      console.error('解析尝试详情:', JSON.stringify(parseDetails, null, 2));
      console.error('AI响应预览:', reply.substring(0, 500));
    }

    // 🔧 验证并修正泛化的功能名称
    if (functionList) {
      console.log('\n🔍 检测并修正泛化功能名称...');
      functionList = validateAndFixFunctionNames(functionList);

      // 🔧🔧🔧 自动补充缺失的查询和导出功能
      console.log('\n🔍 自动检测并补充缺失的查询/导出功能...');
      functionList = autoAddMissingQueryExportFunctions(functionList, documentContent);

      // 🚨 自动过滤掉不合格的泛化功能
      console.log('\n🚨 自动过滤泛化功能...');
      const beforeFilterCount = functionList.totalFunctions;
      functionList = autoFilterGenericFunctions(functionList);
      const afterFilterCount = functionList.totalFunctions;

      if (beforeFilterCount > afterFilterCount) {
        console.log(`✅ 已自动过滤 ${beforeFilterCount - afterFilterCount} 个泛化功能`);
      } else {
        console.log(`✅ 所有功能均符合要求，无需过滤`);
      }

      // 检查质量
      const qualityIssues = checkFunctionListQuality(functionList);
      if (qualityIssues.length > 0) {
        console.log('\n⚠️ 功能列表质量问题:');
        qualityIssues.forEach(issue => console.log('  - ' + issue));
      }
    }


    res.json({
      success: true,
      functionList,
      rawResponse: finalReply,
      provider,
      mode: 'standard',
      parseDetails: !functionList ? parseDetails : undefined
    });
  } catch (error) {
    console.error('功能清单提取失败:', error);
    res.status(500).json({ error: '功能清单提取失败: ' + error.message });
  }
}

/**
 * 大文档分块处理 - 核心函数
 * 将文档分块后，对每块进行深度分析，最后合并结果
 */
async function extractFromLargeDocument(documentContent, clientConfig, maxIterations, userGuidelines = '') {
  const { client, model, useGeminiSDK, useGroqSDK, provider } = clientConfig;

  // 1. 智能分块
  const chunks = smartChunkDocument(documentContent, 6000);
  console.log(`\n📦 开始处理 ${chunks.length} 个文档块...\n`);

  // 2. 对每个块进行功能提取
  const allFunctionsPerChunk = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`🔍 处理第 ${i + 1}/${chunks.length} 块 (${chunk.size} 字符)`);
    console.log('─'.repeat(60));

    // 构建针对当前块的提示词（简化版，聚焦当前块，包含用户限制条件）
    const chunkPrompt = buildChunkExtractionPrompt(chunk, i + 1, chunks.length, userGuidelines);

    // 调用AI进行功能提取
    let completion = null;
    try {
      if (useGeminiSDK) {
        const result = await client.generateContent(chunkPrompt);
        const response = await result.response;
        completion = {
          choices: [{ message: { content: response.text() } }]
        };
      } else if (useGroqSDK) {
        completion = await client.chat.completions.create({
          model,
          messages: [{ role: 'user', content: chunkPrompt }],
          temperature: 0.2,
          max_tokens: 12000
        });
      } else {
        completion = await client.chat.completions.create({
          model,
          messages: [{ role: 'user', content: chunkPrompt }],
          temperature: 0.2,
          max_tokens: 12000
        });
      }

      const reply = completion.choices[0].message.content;

      // 多轮迭代补充当前块的功能（如果启用）
      let finalReply = reply;
      if (maxIterations > 1) {
        console.log(`  🔄 对当前块进行 ${maxIterations - 1} 轮迭代补充...`);
        finalReply = await iterativeEnhancement(
          chunk.content,
          reply,
          clientConfig,
          maxIterations - 1
        );
      }

      // 解析功能列表
      const chunkFunctions = parseFunctionListFromResponse(finalReply);
      allFunctionsPerChunk.push(chunkFunctions);

      console.log(`  ✅ 当前块识别到 ${chunkFunctions.totalFunctions} 个功能`);

    } catch (error) {
      console.error(`  ❌ 处理第 ${i + 1} 块失败:`, error.message);
      allFunctionsPerChunk.push({ modules: [], totalFunctions: 0 });
    }
  }

  // 3. 合并所有块的结果
  console.log(`\n${'='.repeat(60)}`);
  console.log('🔗 合并所有块的功能清单...');
  const mergedFunctionList = mergeFunctionLists(allFunctionsPerChunk);

  // 4. 去重和质量检查
  console.log('🧹 去重和质量检查...');
  let finalFunctionList = deduplicateAndValidate(mergedFunctionList);

  // 4.5 验证并修正泛化功能名称
  console.log('🔍 检测并修正泛化功能名称...');
  finalFunctionList = validateAndFixFunctionNames(finalFunctionList);

  // 检查质量
  const qualityIssues = checkFunctionListQuality(finalFunctionList);
  if (qualityIssues.length > 0) {
    console.log('\n⚠️ 功能列表质量问题:');
    qualityIssues.forEach(issue => console.log('  - ' + issue));
  }

  // 5. 添加元数据
  finalFunctionList._metadata = {
    totalChunks: chunks.length,
    processedAt: new Date().toISOString(),
    mode: 'chunked-processing'
  };

  console.log(`\n✅ 大文档处理完成！`);
  console.log(`总计识别功能: ${finalFunctionList.totalFunctions} 个`);
  console.log('='.repeat(60) + '\n');

  return finalFunctionList;
}

/**
 * 构建针对文档块的提取提示词
 */
function buildChunkExtractionPrompt(chunk, chunkIndex, totalChunks, userGuidelines = '') {
  const userGuidelinesSection = userGuidelines ? `
# 🚨🚨🚨 用户强制要求（必须严格遵守！）

**以下是用户特别指定的限制条件，必须在所有规则中优先执行：**

\`\`\`
${userGuidelines}
\`\`\`

**⚠️ 必须严格按照上述用户要求来命名功能！如果用户要求"动词在前"，所有功能名称必须以动词开头！**

---
` : '';

  return `你是功能点识别专家。当前处理文档的第 ${chunkIndex}/${totalChunks} 部分。
${userGuidelinesSection}

# 🚨🚨🚨 绝对禁止泛化表达！（违规必须重做）

**❌ 严重错误示例（禁止出现）：**
- ❌ "数据业务画像生成" → 必须改为："用户行为特征统计" 或 "小区流量特征分析"
- ❌ "数据业务可视化展示" → 必须改为："用户数趋势折线图展示" 或 "流量分布饼图查看"
- ❌ "数据业务智能体交互" → 必须改为："用户数据查询提交" 或 "配置参数设置"
- ❌ "数据查询" → 必须改为："小区用户数查询" 或 "基站流量查询"

**✅ 正确示例（必须这样写）：**
- ✅ "小区用户数日汇总数据查询"（明确：数据对象+时间粒度+操作）
- ✅ "华为基站流量折线图展示"（明确：厂商+数据对象+图表类型+操作）
- ✅ "用户数5分钟汇总定时任务"（明确：数据对象+时间粒度+操作）

**🎯 每个功能名称必须包含（至少3个）：**
1. **数据对象**：用户数/流量/小区/基站（不能只写"数据"）
2. **操作动作**：查询/导出/统计/展示/配置（必须明确）
3. **限定条件**：厂商/时间粒度/图表类型（至少一个）

# 核心识别规则

1. **厂商维度拆分**：不同厂商（华为/中兴/爱立信）的同类功能必须单独列出
2. **操作维度拆分**：每个操作（查询/导出/导入/统计/汇总）都是独立功能
3. **时间粒度拆分**：不同时间粒度（5分钟/小时/日/周/月）必须分开
4. **数据对象拆分**：不同数据对象（用户数/流量/小区/基站）必须分开

# 必须识别的功能类型

- ✅ **查询功能**：文档中提到"支持查询"、"查询条件"等
- ✅ **导出功能**：文档中提到"导出"、"下载"、"生成Excel"等
- ✅ **导入功能**：文档中提到"导入"、"上传"、"批量导入"等
- ✅ **详情查看**：文档中提到"点击跳转"、"查看详情"等
- ✅ **统计汇总**：文档中提到"统计"、"汇总"、"计算"等
- ✅ **定时任务**：文档中提到"定时"、"周期"、"自动执行"等
- ✅ **数据展示**：图表、列表、大屏等展示功能（必须明确图表类型）
- ✅ **推送通知**：短信、邮件、消息推送等
- ✅ **🚨基础设施类（极重要，常被遗漏！）**：
  - 文档中提到"搭建"、"建立" → 识别为"XXX搭建"功能
  - 文档中提到"部署"、"发布" → 识别为"XXX部署"功能
  - 文档中提到"配置"、"设置" → 识别为"XXX配置"功能
  - 文档中提到"集成"、"对接"、"接入" → 识别为"XXX集成/接入"功能
  - 文档中提到"迁移"、"升级" → 识别为"XXX迁移/升级"功能
  - 文档中提到"初始化"、"启动"、"停止" → 识别为对应的系统操作功能

# 文档内容

${chunk.content}
${chunk.overlapNext ? '\n[下一块开头预览]：' + chunk.overlapNext : ''}

# 输出格式

请以JSON格式输出：

\`\`\`json
{
  "chunkIndex": ${chunkIndex},
  "modules": [
    {
      "moduleName": "模块名称",
      "functions": [
        {
          "id": 1,
          "name": "小区用户数查询",  // ⚠️ 禁止泛化！必须包含：数据对象+操作
          "triggerType": "用户触发",
          "description": "查询指定小区的用户数统计数据",
          "dataObjects": ["小区用户数"]  // ⚠️ 必须具体，不能只写"数据"
        },
        {
          "id": 2,
          "name": "用户数趋势折线图展示",  // ⚠️ 可视化必须明确图表类型
          "triggerType": "用户触发",
          "description": "以折线图形式展示用户数随时间的变化趋势",
          "dataObjects": ["用户数趋势"]
        }
      ]
    }
  ]
}
\`\`\`

**⚠️ 输出前自查：**
- 是否有功能名称包含"数据业务"？（必须删除！）
- 是否有功能名称只写"数据"不说明具体对象？（必须明确！）
- 是否有功能名称只写"可视化"不说明图表类型？（必须明确！）
- 功能数量是否≥5个？（块内功能太少说明识别不够！）

**直接输出JSON，不要添加任何解释文字！**`;
}

/**
 * 多轮迭代补充机制 - 让AI反复思考，补充遗漏的功能
 */
async function iterativeEnhancement(documentContent, previousResponse, clientConfig, iterations) {
  const { client, model, useGeminiSDK, useGroqSDK } = clientConfig;
  let currentResponse = previousResponse;

  for (let i = 0; i < iterations; i++) {
    console.log(`\n  📝 第 ${i + 1}/${iterations} 轮补充迭代...`);

    // 解析当前已识别的功能
    const currentFunctions = parseFunctionListFromResponse(currentResponse);
    const functionNames = currentFunctions.modules
      .flatMap(m => m.functions || [])
      .map(f => f.name)
      .join('、');

    console.log(`  当前已识别: ${currentFunctions.totalFunctions} 个功能`);

    // 构建补充提示词
    const enhancementPrompt = `你刚才识别了以下功能：

${functionNames}

# 🚨 首先检查已识别功能是否有泛化表达（必须修正！）

**检查清单：**
- 是否有"数据业务XXX"？→ 必须改为具体数据对象（用户数/流量/小区）
- 是否有只写"数据"不明确对象？→ 必须明确是什么数据
- 是否有只写"可视化/展示"不说明图表？→ 必须明确图表类型（折线图/柱状图/饼图）
- 是否有功能名称超过15字？→ 必须拆分为多个功能

**如果发现泛化表达，请先输出修正后的功能清单！**

# 重新审查文档，找出可能遗漏的功能

特别检查：
1. 是否遗漏了辅助功能（导出、查询、详情查看）
2. 是否遗漏了不同厂商的独立功能（华为/中兴/爱立信必须分开）
3. 是否遗漏了不同时间粒度的功能（5分钟/小时/日/周/月必须分开）
4. 是否遗漏了定时任务
5. 是否遗漏了界面交互功能（跳转、筛选、排序）
6. 是否遗漏了隐含功能（"展示列表"隐含查询+展示2个功能）

**⚠️ 补充的功能必须具体，禁止泛化！**
- ✅ 正确："小区用户数查询"
- ❌ 错误："数据查询"

如果发现遗漏或需要修正，请输出补充/修正的功能清单（JSON格式）。
如果既无遗漏也无需修正，请输出：{"noMoreFunctions": true}

文档内容（前5000字）：
${documentContent.substring(0, 5000)}`;

    let completion = null;
    try {
      if (useGeminiSDK) {
        const result = await client.generateContent(enhancementPrompt);
        const response = await result.response;
        completion = {
          choices: [{ message: { content: response.text() } }]
        };
      } else if (useGroqSDK) {
        completion = await client.chat.completions.create({
          model,
          messages: [{ role: 'user', content: enhancementPrompt }],
          temperature: 0.3,
          max_tokens: 8000
        });
      } else {
        completion = await client.chat.completions.create({
          model,
          messages: [{ role: 'user', content: enhancementPrompt }],
          temperature: 0.3,
          max_tokens: 8000
        });
      }

      const enhancementReply = completion.choices[0].message.content;

      // 检查是否完成
      if (enhancementReply.includes('"noMoreFunctions"') || enhancementReply.includes('没有遗漏')) {
        console.log(`  ✅ AI认为已经完整，停止迭代`);
        break;
      }

      // 合并补充的功能
      const enhancedFunctions = parseFunctionListFromResponse(enhancementReply);
      if (enhancedFunctions.totalFunctions > 0) {
        console.log(`  ➕ 补充了 ${enhancedFunctions.totalFunctions} 个功能`);
        currentResponse = mergeResponses(currentResponse, enhancementReply);
      } else {
        console.log(`  ℹ️ 本轮未发现新功能`);
      }

    } catch (error) {
      console.error(`  ⚠️ 第 ${i + 1} 轮迭代失败:`, error.message);
      break;
    }
  }

  return currentResponse;
}

/**
 * 解析AI响应为功能列表对象
 */
function parseFunctionListFromResponse(response) {
  // 尝试JSON解析
  let functionList = null;

  try {
    // 提取JSON
    const jsonMatch = response.match(/```json\s*([\s\S]*?)```/) ||
      response.match(/```\s*([\s\S]*?)```/) ||
      response.match(/\{[\s\S]*\}/);

    if (jsonMatch) {
      const jsonStr = jsonMatch[1] || jsonMatch[0];
      functionList = JSON.parse(jsonStr.trim());
    }
  } catch (e) {
    // JSON解析失败，尝试文本提取
    functionList = extractFunctionListFromText(response);
  }

  if (!functionList || !functionList.modules) {
    return {
      projectName: '',
      projectDescription: '',
      totalFunctions: 0,
      modules: [],
      timedTasks: [],
      suggestions: []
    };
  }

  // 计算总功能数
  functionList.totalFunctions = functionList.modules
    .reduce((sum, m) => sum + (m.functions ? m.functions.length : 0), 0);

  return functionList;
}

/**
 * 合并多个功能列表
 */
function mergeFunctionLists(functionLists) {
  const merged = {
    projectName: '',
    projectDescription: '',
    totalFunctions: 0,
    modules: [],
    timedTasks: [],
    suggestions: []
  };

  // 使用Map来合并同名模块
  const moduleMap = new Map();

  for (const list of functionLists) {
    if (!list || !list.modules) continue;

    // 取第一个非空的项目信息
    if (!merged.projectName && list.projectName) {
      merged.projectName = list.projectName;
    }
    if (!merged.projectDescription && list.projectDescription) {
      merged.projectDescription = list.projectDescription;
    }

    // 合并模块和功能
    for (const module of list.modules) {
      if (!module.moduleName) continue;

      if (!moduleMap.has(module.moduleName)) {
        moduleMap.set(module.moduleName, {
          moduleName: module.moduleName,
          functions: []
        });
      }

      const existingModule = moduleMap.get(module.moduleName);
      if (module.functions && Array.isArray(module.functions)) {
        existingModule.functions.push(...module.functions);
      }
    }

    // 合并定时任务
    if (list.timedTasks && Array.isArray(list.timedTasks)) {
      merged.timedTasks.push(...list.timedTasks);
    }

    // 合并建议
    if (list.suggestions && Array.isArray(list.suggestions)) {
      merged.suggestions.push(...list.suggestions);
    }
  }

  merged.modules = Array.from(moduleMap.values());
  merged.totalFunctions = merged.modules
    .reduce((sum, m) => sum + (m.functions ? m.functions.length : 0), 0);

  return merged;
}

/**
 * 去重和验证功能列表
 */
function deduplicateAndValidate(functionList) {
  const seen = new Set();

  for (const module of functionList.modules) {
    if (!module.functions) continue;

    // 去重功能
    const uniqueFunctions = [];
    for (const func of module.functions) {
      const normalizedName = func.name
        .replace(/[\s\-\_&（）()]/g, '')
        .toLowerCase();

      if (!seen.has(normalizedName)) {
        seen.add(normalizedName);
        uniqueFunctions.push(func);
      }
    }

    module.functions = uniqueFunctions;

    // 重新分配ID
    module.functions.forEach((func, index) => {
      func.id = index + 1;
    });
  }

  // 重新计算总数
  functionList.totalFunctions = functionList.modules
    .reduce((sum, m) => sum + (m.functions ? m.functions.length : 0), 0);

  // 去重定时任务
  if (functionList.timedTasks) {
    const uniqueTasks = [];
    const taskNames = new Set();
    for (const task of functionList.timedTasks) {
      if (!taskNames.has(task.name)) {
        taskNames.add(task.name);
        uniqueTasks.push(task);
      }
    }
    functionList.timedTasks = uniqueTasks;
  }

  return functionList;
}

/**
 * 合并两个响应文本（用于迭代补充）
 */
function mergeResponses(originalResponse, newResponse) {
  // 简单合并：将新响应附加到原响应
  return originalResponse + '\n\n--- 补充内容 ---\n\n' + newResponse;
}

/**
 * 验证并修正泛化的功能名称
 * 检测到泛化表达后自动展开为具体功能
 */
function validateAndFixFunctionNames(functionList) {
  // 泛化词汇黑名单和复合操作检测
  const genericTerms = {
    '用户画像': ['用户行为特征统计', '用户属性分析', '用户标签生成'],
    '小区画像': ['小区负荷率统计', '小区用户数分析', '小区流量特征分析'],
    '业务画像': ['业务类型统计', '业务流量分析', '业务用户分布分析'],
    '数据可视化': ['数据趋势折线图展示', '数据分布柱状图展示', '数据占比饼图展示'],
    '数据业务可视化': ['业务数据折线图展示', '业务数据柱状图展示', '业务数据饼图展示'],
    '首页展示': ['关键指标卡片展示', '趋势图表展示', '实时告警展示'],
    '交互功能': ['参数配置', '数据查询', '结果导出'],
    '智能体交互': ['数据提交', '参数设置', '查询请求'],
    '可视化展示': ['折线图展示', '柱状图展示', '饼图展示'],
    '数据展示': ['数据列表展示', '数据图表展示', '数据详情展示']
  };

  // 复合操作模式检测（正则匹配）
  const compoundOperationPatterns = [
    // "生成XXX表/报表" 模式
    {
      pattern: /生成(.+?)(评估表|报表|表格|报告)/,
      split: (match) => {
        const dataObj = match[1];
        return [
          `${dataObj}评估`,
          `${dataObj}评估表生成`
        ];
      }
    },
    // "统计并生成" 模式
    {
      pattern: /(统计|计算|分析|评估)并(生成|导出|展示)/,
      split: (match, fullName) => {
        const beforeAnd = fullName.substring(0, fullName.indexOf('并'));
        const afterAnd = fullName.substring(fullName.indexOf('并') + 1);
        return [beforeAnd, afterAnd];
      }
    },
    // "查询并导出" 模式
    {
      pattern: /查询并导出/,
      split: (match, fullName) => {
        const prefix = fullName.replace('查询并导出', '');
        return [
          `${prefix}查询`,
          `${prefix}Excel导出`
        ];
      }
    }
  ];

  let hasGeneric = false;
  const warnings = [];

  for (const module of functionList.modules) {
    if (!module.functions) continue;

    const expandedFunctions = [];

    for (const func of module.functions) {
      let isGeneric = false;
      let expandedNames = null;

      // 首先检查复合操作
      let compoundDetected = false;
      for (const pattern of compoundOperationPatterns) {
        const match = func.name.match(pattern.pattern);
        if (match) {
          compoundDetected = true;
          isGeneric = true;
          hasGeneric = true;

          const splitNames = pattern.split(match, func.name);
          warnings.push(`⚠️ 检测到复合操作 "${func.name}"，自动拆分为 ${splitNames.length} 个独立功能`);

          for (let i = 0; i < splitNames.length; i++) {
            expandedFunctions.push({
              ...func,
              id: expandedFunctions.length + 1,
              name: splitNames[i],
              description: `${splitNames[i]}功能`
            });
          }

          break;
        }
      }

      // 如果不是复合操作，再检查泛化词汇
      if (!compoundDetected) {
        for (const [genericTerm, expansions] of Object.entries(genericTerms)) {
          if (func.name.includes(genericTerm)) {
            isGeneric = true;
            hasGeneric = true;
            expandedNames = expansions;

            warnings.push(`⚠️ 检测到泛化功能 "${func.name}"，自动展开为 ${expansions.length} 个具体功能`);

            // 将泛化功能展开为多个具体功能
            for (let i = 0; i < expansions.length; i++) {
              expandedFunctions.push({
                ...func,
                id: expandedFunctions.length + 1,
                name: func.name.replace(genericTerm, expansions[i]),
                description: func.description.replace(genericTerm, expansions[i])
              });
            }

            break;
          }
        }
      }

      // 如果不是泛化功能，保留原功能
      if (!isGeneric) {
        // 但仍需检查是否只有单个泛化词
        const singleGenericTerms = ['画像', '可视化', '交互', '生成'];
        let needsWarning = false;

        for (const term of singleGenericTerms) {
          if (func.name === term || func.name.endsWith(term) && func.name.length < 6) {
            warnings.push(`⚠️ 功能 "${func.name}" 过于简陋，建议明确具体内容`);
            needsWarning = true;
            break;
          }
        }

        expandedFunctions.push(func);
      }
    }

    // 替换原功能列表
    module.functions = expandedFunctions;

    // 重新分配ID
    module.functions.forEach((func, index) => {
      func.id = index + 1;
    });
  }

  // 重新计算总功能数
  functionList.totalFunctions = functionList.modules
    .reduce((sum, m) => sum + (m.functions ? m.functions.length : 0), 0);

  if (hasGeneric) {
    console.log('\n' + '='.repeat(60));
    console.log('🔧 泛化功能自动修正');
    console.log('='.repeat(60));
    warnings.forEach(w => console.log(w));
    console.log(`修正后总功能数: ${functionList.totalFunctions}`);
    console.log('='.repeat(60) + '\n');
  }

  return functionList;
}

/**
 * 检查功能列表质量，如果泛化过多则拒绝
 * 使用通用规则检测泛化功能，而不是硬编码特定名称
 */
function checkFunctionListQuality(functionList) {
  const issues = [];

  // 检查功能总数
  if (functionList.totalFunctions < 10) {
    issues.push(`功能数量过少（${functionList.totalFunctions}个），可能识别不完整`);
  }

  // 🎯 具体业务动作关键词（必须包含至少一个）
  const actionKeywords = [
    '查询', '导出', '导入', '添加', '删除', '修改', '更新', '创建', '编辑',
    '计算', '统计', '汇总', '分析', '评估', '判定', '检测', '识别',
    '推送', '发送', '接收', '上报', '同步', '告警', '通知',
    '搭建', '部署', '配置', '集成', '迁移', '初始化', '启动', '停止'
  ];

  // 🚫 抽象泛化词汇（单独使用或结尾时视为泛化）
  const genericWords = [
    '画像', '可视化', '交互', '展示', '查看', '显示', '呈现',
    '管理', '处理', '操作', '功能', '模块', '系统', '平台',
    '数据', '信息', '内容', '业务', '服务'
  ];

  // 🚫 纯UI渲染词汇（这些不是COSMIC功能过程）
  const uiRenderingWords = [
    '图展示', '图查看', '图表展示', '图表查看',
    '可视化展示', '可视化呈现',
    '页面展示', '界面展示', '首页展示'
  ];

  // 🚫 功能说明文字特征（这些是描述而非功能名称）
  const descriptionPatterns = [
    /触发.*响应/, /触发.*情况/, /支持.*功能/,
    /用户触发/, /时钟触发/, /接口触发/,
    /.*的情况$/
  ];

  for (const module of functionList.modules) {
    if (!module.functions) continue;

    for (const func of module.functions) {
      const funcName = func.name || '';

      // ====== 检查1：功能名称长度 ======
      if (funcName.length < 4) {
        issues.push(`❌ 功能 "${funcName}" 名称过短（小于4字），缺乏具体业务描述`);
        continue;
      }

      // ====== 检查2：是否是功能说明文字而非功能名称 ======
      for (const pattern of descriptionPatterns) {
        if (pattern.test(funcName)) {
          issues.push(`❌ 功能 "${funcName}" 看起来是功能说明文字，而非具体功能名称`);
          break;
        }
      }

      // ====== 检查3：是否是纯UI渲染（不是COSMIC功能过程） ======
      for (const uiWord of uiRenderingWords) {
        if (funcName.includes(uiWord)) {
          issues.push(`❌ 功能 "${funcName}" 包含"${uiWord}"，这是前端UI渲染，不属于COSMIC功能过程。应改为数据查询或导出功能`);
          break;
        }
      }

      // ====== 检查4：必须包含具体业务动作 ======
      const hasActionKeyword = actionKeywords.some(keyword => funcName.includes(keyword));
      if (!hasActionKeyword) {
        // 允许定时任务和汇总类功能不强制包含动作词
        if (!funcName.includes('定时') && !funcName.includes('汇总') && !func.triggerType?.includes('时钟')) {
          issues.push(`⚠️ 功能 "${funcName}" 缺少明确的业务动作关键词（如：查询、导出、统计、计算等）`);
        }
      }

      // ====== 检查5：不能只有抽象词汇，必须包含具体业务对象 ======
      // 检查功能名是否主要由泛化词汇组成
      let hasConcreteContent = false;

      // 移除所有泛化词汇后，看是否还有实质内容
      let nameWithoutGeneric = funcName;
      for (const word of genericWords) {
        nameWithoutGeneric = nameWithoutGeneric.replace(new RegExp(word, 'g'), '');
      }
      for (const action of actionKeywords) {
        nameWithoutGeneric = nameWithoutGeneric.replace(new RegExp(action, 'g'), '');
      }

      // 如果移除泛化词和动作词后，剩余内容少于2个字，说明缺乏具体业务对象
      if (nameWithoutGeneric.trim().length < 2) {
        issues.push(`❌ 功能 "${funcName}" 过于泛化，缺少具体的业务对象名称（如：用户数、小区评估、健康度指标等）`);
        hasConcreteContent = false;
      } else {
        hasConcreteContent = true;
      }

      // ====== 检查6：以抽象词结尾的功能（通常是泛化的） ======
      if (hasConcreteContent) {
        for (const word of genericWords) {
          if (funcName.endsWith(word) && funcName.length === word.length) {
            issues.push(`❌ 功能 "${funcName}" 单独使用抽象词汇"${word}"，必须明确具体内容`);
            break;
          }
          // 检查是否只是在泛化词前加了一个修饰词（如"用户画像"、"小区画像"）
          if (funcName.endsWith(word) && funcName.length <= word.length + 4) {
            // 检查是否包含具体的业务指标
            const hasSpecificIndicator = /特征|属性|行为|标签|负荷|流量|用户数|业务类型|健康度|质差|评估|分析|统计/.test(funcName);
            if (!hasSpecificIndicator) {
              issues.push(`⚠️ 功能 "${funcName}" 以"${word}"结尾但缺少具体业务指标，建议细化为具体功能`);
            }
          }
        }
      }

      // ====== 检查7：包含"数据"但未明确具体数据对象 ======
      if (funcName.includes('数据')) {
        const hasSpecificDataObject = /用户数|流量|小区|基站|告警|配置|指标|评估|健康度|质差|任务|订单|设备|工单/.test(funcName);
        if (!hasSpecificDataObject) {
          issues.push(`❌ 功能 "${funcName}" 包含"数据"但未明确具体数据对象（如：用户数数据、小区流量数据、健康度指标数据等）`);
        }
      }
    }
  }

  return issues;
}

/**
 * 自动过滤掉泛化的不合格功能
 * @param {Object} functionList - 功能清单
 * @returns {Object} 过滤后的功能清单
 */
function autoFilterGenericFunctions(functionList) {
  if (!functionList || !functionList.modules) return functionList;

  // 业务动作关键词
  const actionKeywords = [
    '查询', '导出', '导入', '添加', '删除', '修改', '更新', '创建', '编辑',
    '计算', '统计', '汇总', '分析', '评估', '判定', '检测', '识别',
    '推送', '发送', '接收', '上报', '同步', '告警', '通知',
    '搭建', '部署', '配置', '集成', '迁移', '初始化', '启动', '停止'
  ];

  // 抽象泛化词汇
  const genericWords = [
    '画像', '可视化', '交互', '展示', '查看', '显示', '呈现',
    '管理', '处理', '操作', '功能', '模块', '系统', '平台',
    '数据', '信息', '内容', '业务', '服务'
  ];

  // 纯UI渲染词汇
  const uiRenderingWords = [
    '图展示', '图查看', '图表展示', '图表查看',
    '可视化展示', '可视化呈现',
    '页面展示', '界面展示', '首页展示'
  ];

  // 功能说明文字特征
  const descriptionPatterns = [
    /触发.*响应/, /触发.*情况/, /支持.*功能/,
    /用户触发/, /时钟触发/, /接口触发/,
    /.*的情况$/
  ];

  const filteredModules = [];
  let totalFiltered = 0;

  for (const module of functionList.modules) {
    if (!module.functions) {
      filteredModules.push(module);
      continue;
    }

    const filteredFunctions = [];

    for (const func of module.functions) {
      const funcName = func.name || '';
      let shouldFilter = false;
      let filterReason = '';

      // 检查1：功能名称过短
      if (funcName.length < 4) {
        shouldFilter = true;
        filterReason = `名称过短（${funcName.length}字）`;
      }

      // 检查2：是否是功能说明文字
      if (!shouldFilter) {
        for (const pattern of descriptionPatterns) {
          if (pattern.test(funcName)) {
            shouldFilter = true;
            filterReason = '功能说明文字';
            break;
          }
        }
      }

      // 检查3：是否包含纯UI渲染词汇
      if (!shouldFilter) {
        for (const uiWord of uiRenderingWords) {
          if (funcName.includes(uiWord)) {
            shouldFilter = true;
            filterReason = `包含UI渲染词汇"${uiWord}"`;
            break;
          }
        }
      }

      // 检查4：移除泛化词和动作词后，是否还有实质内容
      if (!shouldFilter) {
        let nameWithoutGeneric = funcName;
        for (const word of genericWords) {
          nameWithoutGeneric = nameWithoutGeneric.replace(new RegExp(word, 'g'), '');
        }
        for (const action of actionKeywords) {
          nameWithoutGeneric = nameWithoutGeneric.replace(new RegExp(action, 'g'), '');
        }

        if (nameWithoutGeneric.trim().length < 2) {
          shouldFilter = true;
          filterReason = '缺少具体业务对象';
        }
      }

      // 检查5：以泛化词结尾且没有具体指标
      if (!shouldFilter) {
        for (const word of genericWords) {
          if (funcName.endsWith(word) && funcName.length <= word.length + 4) {
            const hasSpecificIndicator = /特征|属性|行为|标签|负荷|流量|用户数|业务类型|健康度|质差|评估|分析|统计|计算/.test(funcName);
            if (!hasSpecificIndicator) {
              shouldFilter = true;
              filterReason = `以"${word}"结尾但缺少具体指标`;
              break;
            }
          }
        }
      }

      // 检查6：包含"数据"但未明确具体对象
      if (!shouldFilter && funcName.includes('数据')) {
        const hasSpecificDataObject = /用户数|流量|小区|基站|告警|配置|指标|评估|健康度|质差|任务|订单|设备|工单/.test(funcName);
        if (!hasSpecificDataObject) {
          shouldFilter = true;
          filterReason = '包含"数据"但未明确具体对象';
        }
      }

      // 决定是否保留
      if (shouldFilter) {
        console.log(`  🗑️  过滤: "${funcName}" - 原因: ${filterReason}`);
        totalFiltered++;
      } else {
        filteredFunctions.push(func);
      }
    }

    // 只保留有功能的模块
    if (filteredFunctions.length > 0) {
      filteredModules.push({
        ...module,
        functions: filteredFunctions
      });
    }
  }

  // 重新计算总功能数
  const newTotalFunctions = filteredModules.reduce((sum, m) => sum + (m.functions ? m.functions.length : 0), 0);

  console.log(`\n📊 过滤统计: 原${functionList.totalFunctions}个 → 现${newTotalFunctions}个，已过滤${totalFiltered}个泛化功能`);

  return {
    ...functionList,
    modules: filteredModules,
    totalFunctions: newTotalFunctions
  };
}

// 从纯文本中提取功能列表的辅助函数
function extractFunctionListFromText(text) {
  try {
    const result = {
      projectName: '',
      projectDescription: '',
      totalFunctions: 0,
      modules: [],
      timedTasks: [],
      suggestions: []
    };

    // 提取项目名称
    const projectNameMatch = text.match(/项目名称[：:]\s*(.+)/);
    if (projectNameMatch) {
      result.projectName = projectNameMatch[1].trim();
    }

    // 提取项目描述
    const projectDescMatch = text.match(/(?:项目描述|简要描述)[：:]\s*(.+)/);
    if (projectDescMatch) {
      result.projectDescription = projectDescMatch[1].trim();
    }

    // 识别模块和功能
    const lines = text.split('\n');
    let currentModule = null;
    let functionId = 1;
    const allFunctions = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // 识别模块标题（通常是 ## 或 ### 开头，或者包含"模块"字样）
      const moduleMatch = line.match(/^#{1,3}\s*(.+模块.*)/) ||
        line.match(/^#{1,3}\s*(\d+[\.、]\s*.+)/) ||
        line.match(/所属模块[：:]\s*(.+)/);
      if (moduleMatch) {
        const moduleName = moduleMatch[1].replace(/^[\d\.、\s]+/, '').trim();
        if (moduleName && moduleName.length > 1 && moduleName.length < 50) {
          currentModule = {
            moduleName: moduleName,
            functions: []
          };
          result.modules.push(currentModule);
        }
        continue;
      }

      // 识别功能项（多种格式）
      // 格式1: "功能名称：XXX" 或 "名称：XXX"
      const funcNameMatch = line.match(/(?:功能名称|名称)[：:]\s*(.+)/);
      if (funcNameMatch) {
        const funcName = funcNameMatch[1].trim();
        if (funcName && funcName.length > 1) {
          // 查找触发方式（可能在下一行或同一行）
          let triggerType = '用户触发';
          const triggerMatch = line.match(/触发方式[：:]\s*(.+)/) ||
            (lines[i + 1] && lines[i + 1].match(/触发方式[：:]\s*(.+)/));
          if (triggerMatch) {
            triggerType = triggerMatch[1].trim();
          }

          // 查找描述
          let description = '';
          const descMatch = (lines[i + 1] && lines[i + 1].match(/(?:描述|简要描述)[：:]\s*(.+)/)) ||
            (lines[i + 2] && lines[i + 2].match(/(?:描述|简要描述)[：:]\s*(.+)/));
          if (descMatch) {
            description = descMatch[1].trim();
          }

          const func = {
            id: functionId++,
            name: funcName,
            triggerType: triggerType,
            description: description,
            dataObjects: []
          };

          if (currentModule) {
            currentModule.functions.push(func);
          }
          allFunctions.push(func);
        }
        continue;
      }

      // 格式2: "- XXX功能" 或 "* XXX" 或 "1. XXX"
      const listItemMatch = line.match(/^[-*•]\s*(.+)/) || line.match(/^\d+[\.、]\s*(.+)/);
      if (listItemMatch) {
        const itemText = listItemMatch[1].trim();
        // 检查是否像是功能名称（包含动词或"功能"字样）
        const actionVerbs = ['创建', '查询', '修改', '删除', '导入', '导出', '统计', '汇总', '推送', '监控', '分析', '生成', '接收', '发送', '上传', '下载', '搭建', '建立', '部署', '安装', '配置', '初始化', '集成', '对接', '接入', '迁移', '升级', '启动', '停止', '注册', '绑定', '解绑'];
        const isFunction = actionVerbs.some(verb => itemText.includes(verb)) ||
          itemText.includes('功能') ||
          itemText.includes('数据') ||
          itemText.match(/[\u4e00-\u9fa5]{2,}(?:入库|解析|处理|计算|展示|可视化)/);

        if (isFunction && itemText.length > 2 && itemText.length < 50) {
          // 判断触发类型
          let triggerType = '用户触发';
          if (itemText.includes('定时') || itemText.includes('周期') || itemText.includes('自动') ||
            itemText.includes('每天') || itemText.includes('每周') || itemText.includes('汇总')) {
            triggerType = '时钟触发';
          } else if (itemText.includes('接收') || itemText.includes('推送') || itemText.includes('接口')) {
            triggerType = '接口触发';
          }

          const func = {
            id: functionId++,
            name: itemText.replace(/[：:].+$/, '').trim(),
            triggerType: triggerType,
            description: '',
            dataObjects: []
          };

          if (currentModule) {
            currentModule.functions.push(func);
          }
          allFunctions.push(func);
        }
        continue;
      }

      // 格式3: 识别定时任务
      const timerMatch = line.match(/(?:定时任务|周期任务)[：:]\s*(.+)/) ||
        line.match(/每(?:天|周|月|小时|分钟).+(?:执行|运行|汇总|统计)/);
      if (timerMatch) {
        const taskName = timerMatch[1] || line;
        result.timedTasks.push({
          name: taskName.trim(),
          interval: '',
          description: ''
        });
        continue;
      }

      // 格式4: 识别建议补充的功能
      if (line.includes('建议补充') || line.includes('建议添加')) {
        const suggestionMatch = line.match(/建议(?:补充|添加)[：:]\s*(.+)/);
        if (suggestionMatch) {
          result.suggestions.push(suggestionMatch[1].trim());
        }
      }
    }

    // 如果没有识别到模块，创建一个默认模块
    if (result.modules.length === 0 && allFunctions.length > 0) {
      result.modules.push({
        moduleName: '功能模块',
        functions: allFunctions
      });
    }

    // 计算总功能数
    result.totalFunctions = allFunctions.length;

    // 如果没有识别到任何功能，返回null
    if (result.totalFunctions === 0) {
      return null;
    }

    return result;
  } catch (error) {
    console.log('从纯文本提取功能列表失败:', error.message);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════
// 阶段2：基于确认的功能清单进行ERWX拆分
// ═══════════════════════════════════════════════════════════
async function splitFromFunctionList(req, res) {
  try {
    const { documentContent, confirmedFunctions, previousResults = [], round = 1, processedIndex = 0, userConfig = null } = req.body;

    // ⚠️ 调试日志：检查接收到的参数
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🔍 调试信息：接收到的参数`);
    console.log(`  - round: ${round}`);
    console.log(`  - processedIndex: ${processedIndex}`);
    console.log(`  - confirmedFunctions.length: ${confirmedFunctions?.length || 0}`);
    console.log(`  - previousResults.length: ${previousResults?.length || 0}`);
    console.log('='.repeat(60));

    if (!confirmedFunctions || confirmedFunctions.length === 0) {
      return res.status(400).json({ error: '请提供确认的功能清单' });
    }

    let clientConfig = getActiveClientConfig(userConfig);
    if (!clientConfig) {
      return res.status(400).json({ error: '请先配置API密钥' });
    }

    const { client, model, useGeminiSDK, useGroqSDK, provider } = clientConfig;

    // 已完成的功能（用于显示）
    const completedFunctions = previousResults.map(r => r.functionalProcess).filter(Boolean);
    const uniqueCompleted = [...new Set(completedFunctions)];

    // ⚠️ 修复循环拆分问题：使用索引位置而不是名称匹配来确定待处理功能
    // 之前的问题：AI返回的功能名可能与确认的功能名有细微差异，导致无法正确判断已完成状态
    // 解决方案：使用processedIndex记录已处理到的位置，按顺序处理，避免重复

    // 每轮处理功能数量
    const batchSize = 10;

    // 直接按索引获取待处理的功能，而不是通过名称匹配
    const startIndex = processedIndex;
    const pendingFunctions = confirmedFunctions.slice(startIndex);

    console.log(`📊 计算结果：startIndex=${startIndex}, pendingFunctions.length=${pendingFunctions.length}`);

    if (pendingFunctions.length === 0) {
      return res.json({
        success: true,
        reply: '[ALL_DONE]',
        isDone: true,
        completedFunctions: uniqueCompleted.length
      });
    }


    // 每轮处理功能数量（平衡速度和质量）- 已在上方定义batchSize
    const currentBatch = pendingFunctions.slice(0, batchSize);
    const totalBatches = Math.ceil(confirmedFunctions.length / batchSize);  // 使用总功能数计算总批次
    const currentBatchNumber = Math.floor(startIndex / batchSize) + 1;  // 使用startIndex计算当前批次号

    console.log(`\n${'='.repeat(60)}`);
    console.log(`批次 ${currentBatchNumber}/${totalBatches}: 处理 ${currentBatch.length} 个功能`);
    console.log(`总确认功能数: ${confirmedFunctions.length}`);
    console.log(`startIndex: ${startIndex}, 待处理: ${pendingFunctions.length}`);
    console.log(`\n本批功能列表:`);
    currentBatch.forEach((f, idx) => {
      console.log(`  ${idx + 1}. ${f.name}`);
    });
    if (uniqueCompleted.length > 0) {
      console.log(`\n已完成功能:`);
      uniqueCompleted.forEach((name, idx) => {
        console.log(`  ${idx + 1}. ${name}`);
      });
    }
    console.log('='.repeat(60) + '\n');

    // 构建拆分提示词 - 超强化版本，确保每个功能必须有完整的E+R+W+X
    const splitPrompt = `你是一个COSMIC拆分专家。现在处理第 ${currentBatchNumber}/${totalBatches} 批，共${currentBatch.length}个功能。

⚠️ **重要**：你必须为下面列出的每一个功能都输出4行（E+R+W+X），不能遗漏任何一个！

# ═══════════════════════════════════════════════════════════
# 🚨🚨🚨 最高优先级规则（必须严格遵守！）🚨🚨🚨
# ═══════════════════════════════════════════════════════════

## 批次信息
- 当前批次：${currentBatchNumber}/${totalBatches}
- 本批功能数：${currentBatch.length}
- **必须输出行数：${currentBatch.length * 4} 行**（${currentBatch.length}功能 × 4行/功能）

## 规则1：每个功能必须有且只有4行（E+R+W+X）
- 第1行：E（Entry/接收）- 接收外部输入
- 第2行：R（Read/读取）- 读取规则或配置
- 第3行：W（Write/写入）- 保存处理结果
- 第4行：X（Exit/输出）- 返回响应结果

## 规则2：子过程描述必须包含功能名称的核心关键词
❌ 错误：功能名是"华为小区用户数5分钟汇总"，子过程写"接收数据"
✅ 正确：功能名是"华为小区用户数5分钟汇总"，子过程写"接收华为小区用户数数据"

## 规则3：绝对禁止遗漏任何功能！
🚨 你必须逐一处理下面的${currentBatch.length}个功能，每个都输出4行，总共${currentBatch.length * 4}行！

---

# 📋 待拆分的功能列表（共${currentBatch.length}个，每个4行，共${currentBatch.length * 4}行）

${currentBatch.map((fn, i) => {
      // 提取功能名称的核心关键词
      const keywords = fn.name
        .replace(/[&（）()]/g, '')
        .replace(/数据|功能|处理|计算|评估|分析|操作/g, ' ')
        .split(/[\s,，、]+/)
        .filter(s => s.length > 1)
        .slice(0, 4)
        .join('、') || fn.name;

      return `## 功能${i + 1}/${currentBatch.length}: ${fn.name}
- 触发方式：${fn.triggerType || '用户触发'}
- 描述：${fn.description || '（无描述）'}
- **核心关键词（必须出现在子过程描述中）**：${keywords}`;
    }).join('\n\n')}

---

# 📚 参考文档内容

${documentContent.substring(0, 5000)}${documentContent.length > 5000 ? '\n...(文档已截断)' : ''}

---

# ═══════════════════════════════════════════════════════════
# ERWX 拆分详细规则
# ═══════════════════════════════════════════════════════════

| 类型 | 子过程含义 | 命名公式 | 示例 |
|-----|----------|---------|-----|
| **E** | 接收外部输入 | 接收+[核心关键词]+请求/数据 | 接收华为小区用户数数据 |
| **R** | 读取规则配置 | 读取+[核心关键词]+配置/规则 | 读取用户数汇总规则配置 |
| **W** | 写入处理结果 | 保存/记录+[核心关键词]+结果 | 保存华为小区用户数汇总结果 |
| **X** | 输出响应结果 | 返回+[核心关键词]+响应 | 返回用户数汇总执行状态 |

---

# ✅ 输出格式（严格按此格式）

|功能用户|触发事件|功能过程|子过程描述|数据移动类型|数据组|数据属性|
|:---|:---|:---|:---|:---|:---|:---|
|时钟触发|定时任务|华为小区用户数5分钟汇总|接收华为小区用户数原始数据|E|华为用户数原始数据|时间、小区标识、用户数量、区域|
||||读取用户数汇总规则配置|R|汇总规则配置表|汇总周期、统计维度、过滤条件|
||||保存华为小区用户数汇总结果|W|华为用户数汇总表|统计时间、小区标识、汇总用户数|
||||返回用户数汇总执行状态|X|汇总执行响应|执行状态、处理记录数、耗时|

---

# 🚨 输出前检查清单（必须核对！）

请在输出表格前，确认以下内容：
- [ ] 是否为每个功能都输出了4行（E+R+W+X）？
- [ ] 总行数是否等于 ${currentBatch.length * 4} 行？
- [ ] 每个子过程描述是否包含了功能名称的关键词？
- [ ] 数据属性是否使用中文、用顿号分隔？

---

**请开始输出（共${currentBatch.length}个功能 × 4行 = ${currentBatch.length * 4}行）：**`;

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
        temperature: 0.3,  // 降低温度提高稳定性
        max_tokens: 16000  // 增加token限制以处理更多功能
      });
    } else {
      completion = await client.chat.completions.create({
        model,
        messages: [systemMessage, { role: 'user', content: splitPrompt }],
        temperature: 0.3,  // 降低温度提高稳定性
        max_tokens: 16000  // 增加token限制以处理更多功能
      });
    }

    const reply = completion.choices[0].message.content;
    const cleanedReply = cleanupAIResponse(reply);

    // 🔍 遗漏功能检测：解析AI实际拆分的功能过程名称
    const actualSplitFunctions = [];
    const tableLineRegex = /\|([^|]*)\|([^|]*)\|([^|]+)\|([^|]*)\|([EeRrWwXx])\|/g;
    let match;
    while ((match = tableLineRegex.exec(cleanedReply)) !== null) {
      const funcName = match[3].trim();
      if (funcName && funcName !== '功能过程' && funcName !== ':---' && funcName !== '---') {
        actualSplitFunctions.push(funcName);
      }
    }
    const uniqueActualFunctions = [...new Set(actualSplitFunctions)];

    // 对比本批预期处理的功能和实际拆分的功能
    const expectedFunctionNames = currentBatch.map(f => f.name);
    const missedFunctions = expectedFunctionNames.filter(expected => {
      // 模糊匹配：检查实际拆分的功能名是否包含预期功能名的核心关键词
      const keywords = expected.replace(/[\u0026（）()]/g, '').split(/[，、\s]+/).filter(s => s.length > 1);
      const matched = uniqueActualFunctions.some(actual => {
        // 精确匹配
        if (actual === expected) return true;
        // 核心关键词匹配
        const matchedKeywords = keywords.filter(kw => actual.includes(kw));
        return matchedKeywords.length >= Math.max(1, Math.floor(keywords.length / 2));
      });
      return !matched;
    });

    if (missedFunctions.length > 0) {
      console.log(`\n⚠️ 本批次遗漏了 ${missedFunctions.length} 个功能:`);
      missedFunctions.forEach((fn, idx) => console.log(`  ${idx + 1}. ${fn}`));
    } else {
      console.log(`\n✅ 本批次 ${currentBatch.length} 个功能全部拆分完成`);
    }

    // 判断是否完成
    const isDone = pendingFunctions.length <= batchSize;

    // 计算下一轮的起始索引
    const nextProcessedIndex = startIndex + currentBatch.length;

    const remainingCount = Math.max(0, pendingFunctions.length - batchSize);
    console.log(`\n批次 ${currentBatchNumber}/${totalBatches} 完成`);
    console.log(`已处理索引范围: ${startIndex} - ${nextProcessedIndex - 1}`);
    console.log(`已完成功能数: ${nextProcessedIndex}/${confirmedFunctions.length}`);
    console.log(`剩余待处理: ${remainingCount} 个功能\n`);

    res.json({
      success: true,
      reply: cleanedReply,
      round,
      isDone,
      completedFunctions: uniqueCompleted.length,
      pendingCount: remainingCount,
      currentBatch: currentBatch.length,
      currentBatchFunctions: currentBatch.map(f => f.name), // 返回本批处理的功能名
      totalFunctions: confirmedFunctions.length,
      batchNumber: currentBatchNumber,
      totalBatches: totalBatches,
      nextProcessedIndex: nextProcessedIndex,  // ⚠️ 新增：返回下一轮的起始索引
      provider,
      // 🔍 遗漏功能追踪
      actualSplitCount: uniqueActualFunctions.length,  // 本批实际拆分的功能数
      missedFunctions: missedFunctions,  // 本批遗漏的功能列表
      hasMissedFunctions: missedFunctions.length > 0  // 是否有遗漏功能
    });
  } catch (error) {
    console.error('基于功能清单拆分失败:', error);
    res.status(500).json({ error: '拆分失败: ' + error.message });
  }
}

// ═══════════════════════════════════════════════════════════
// 🔧 自动补充缺失的查询/导出功能
// ═══════════════════════════════════════════════════════════

/**
 * 自动检测文档中的"支持查询"和"支持导出"，补充到功能清单中
 * @param {Object} functionList - AI识别的功能清单
 * @param {string} documentContent - 原始文档内容
 * @returns {Object} 补充后的功能清单
 */
function autoAddMissingQueryExportFunctions(functionList, documentContent) {
  if (!functionList || !documentContent) return functionList;

  // 提取所有现有功能名称
  const existingFunctions = [];
  if (functionList.modules) {
    functionList.modules.forEach(module => {
      if (module.functions) {
        module.functions.forEach(fn => {
          existingFunctions.push(fn.name.toLowerCase());
        });
      }
    });
  }
  if (functionList.timedTasks) {
    functionList.timedTasks.forEach(task => {
      existingFunctions.push(task.name.toLowerCase());
    });
  }

  // 检查是否已有查询/导出功能（移除这些全局标志，改用具体匹配）
  /*
  const hasQueryFunction = existingFunctions.some(name =>
    name.includes('查询') || name.includes('搜索') || name.includes('筛选')
  );
  // ...
  */

  // 用于存储新增的功能
  const newFunctions = [];
  let nextId = (functionList.totalFunctions || existingFunctions.length) + 1;

  // 正则模式：匹配"功能界面说明"或"功能页面说明"章节
  // 并提取前面的表名/页面名
  const patterns = [
    // 模式1：章节标题 + 功能说明
    /([^\n]{2,50}?(?:表|页面|模块|界面|统计|评估|详情|汇总|分析))[^\n]*\n[^]*?(?:功能界面说明|功能页面说明|功能说明)[^]*?((?:\d+[.、．]?\s*(?:支持查询|支持导出|支持导入|点击[^\n]+跳转)[^\n]*\n?)+)/gi,
    // 模式2：直接匹配 "支持查询" 或 "支持导出"
    /^[^\n]*?(\d+[.、．]?\s*支持查询[^\n]*)/gm,
    /^[^\n]*?(\d+[.、．]?\s*支持导出[^\n]*)/gm,
    /^[^\n]*?(\d+[.、．]?\s*支持导入[^\n]*)/gm,
  ];

  // 扫描文档，提取页面名称和功能描述
  const pageContexts = extractPageContexts(documentContent);

  console.log(`📋 在文档中发现 ${pageContexts.length} 个页面/表格上下文`);

  pageContexts.forEach(context => {
    const { pageName, hasQuery, hasExport, hasImport, hasJump, jumpDetails } = context;
    // 清理页面名称，移除前导动词、符号和序号
    const cleanedPageName = pageName
      .replace(/^[\s\n#\d\.、]+/, '') // 移除前导空白、#、数字、点、顿号
      .replace(/^(?:生成|统计|汇总|分析|计算|评估|展示|导出|导入|查询|进行|支持|查看)/, '') // 移除前导动词
      .trim();

    console.log(`  - ${pageName} (清理后: ${cleanedPageName}): 查询=${hasQuery}, 导出=${hasExport}, 导入=${hasImport}, 跳转=${hasJump}`);

    // 补充查询功能
    if (hasQuery) {
      const queryFunctionName = `${cleanedPageName}查询`;
      if (!existingFunctions.includes(queryFunctionName.toLowerCase())) {
        newFunctions.push({
          id: nextId++,
          name: queryFunctionName,
          triggerType: '用户触发',
          description: `按条件查询${pageName}数据`,
          dataObjects: [pageName],
          _autoAdded: true
        });
        console.log(`    ✅ 自动补充: ${queryFunctionName}`);
      }
    }

    // 补充导出功能
    if (hasExport) {
      const exportFunctionName = `${cleanedPageName}导出`;
      if (!existingFunctions.includes(exportFunctionName.toLowerCase())) {
        newFunctions.push({
          id: nextId++,
          name: exportFunctionName,
          triggerType: '用户触发',
          description: `导出${pageName}数据为Excel`,
          dataObjects: [pageName],
          _autoAdded: true
        });
        console.log(`    ✅ 自动补充: ${exportFunctionName}`);
      }
    }

    // 补充导入功能
    if (hasImport) {
      const importFunctionName = `${cleanedPageName}导入`;
      if (!existingFunctions.includes(importFunctionName.toLowerCase())) {
        newFunctions.push({
          id: nextId++,
          name: importFunctionName,
          triggerType: '用户触发',
          description: `导入${pageName}数据`,
          dataObjects: [pageName],
          _autoAdded: true
        });
        console.log(`    ✅ 自动补充: ${importFunctionName}`);
      }
    }

    // 补充跳转/详情查看功能
    if (hasJump && jumpDetails.length > 0) {
      jumpDetails.forEach(detail => {
        const jumpFunctionName = `${detail}详情查看`;
        if (!existingFunctions.includes(jumpFunctionName.toLowerCase())) {
          newFunctions.push({
            id: nextId++,
            name: jumpFunctionName,
            triggerType: '用户触发',
            description: `查看${detail}的详细信息`,
            dataObjects: [detail],
            _autoAdded: true
          });
          console.log(`    ✅ 自动补充: ${jumpFunctionName}`);
        }
      });
    }
  });

  // 将新功能添加到功能清单中
  if (newFunctions.length > 0) {
    console.log(`\n🎯 共自动补充 ${newFunctions.length} 个缺失的查询/导出功能`);

    // 确保有modules数组
    if (!functionList.modules) {
      functionList.modules = [];
    }

    // 找到或创建"辅助功能"模块
    let auxModule = functionList.modules.find(m =>
      m.moduleName === '辅助功能' || m.moduleName.includes('辅助') || m.moduleName.includes('通用')
    );

    if (!auxModule) {
      auxModule = {
        moduleName: '辅助功能（自动补充）',
        functions: []
      };
      functionList.modules.push(auxModule);
    }

    // 添加新功能
    auxModule.functions = auxModule.functions || [];
    auxModule.functions.push(...newFunctions);

    // 更新总功能数
    functionList.totalFunctions = (functionList.totalFunctions || 0) + newFunctions.length;
  } else {
    console.log(`\n✅ 功能清单已包含必要的查询/导出功能，无需补充`);
  }

  return functionList;
}

/**
 * 从文档中提取页面/表格上下文信息
 * @param {string} documentContent - 文档内容
 * @returns {Array} 页面上下文数组
 */
function extractPageContexts(documentContent) {
  const contexts = [];
  const foundPageNames = new Set(); // 用于去重

  // 模式1：查找 "XXX" 后跟 "功能界面说明"
  // 改进正则表达式：
  // 1. 明确排除以 "将"、"按"、"由于" 等虚词开头的行（通常是描述性句子而非标题）
  // 2. 增加对 Markdown 标题 (#) 或 数字标题的优先支持
  const sectionPattern = /((?:^|\n)(?:#+\s*|\d+[.、]\s*)?[^\n将按由于]{2,60}?(?:表|页面|界面|模块|统计|评估|详情|汇总|分析|综合|检测|监控|报表)(?:-[日周月])?)[^\n]*\n(?:[^\n]*\n){0,10}?(?:功能界面说明|功能页面说明|功能说明|界面说明)[^\n]*\n((?:[^\n]*\n){1,20})/gi;

  let match;
  while ((match = sectionPattern.exec(documentContent)) !== null) {
    const pageName = match[1].replace(/^\d+[\.\\s]+/, '').trim();
    const functionDesc = match[2];

    // 检查功能描述中是否有查询/导出/导入
    const hasQuery = /支持查询|查询功能|条件查询/i.test(functionDesc);
    const hasExport = /支持导出|导出功能|Excel导出/i.test(functionDesc);
    const hasImport = /支持导入|导入功能|批量导入/i.test(functionDesc);
    const hasJump = /点击.*跳转|跳转至|跳转到/i.test(functionDesc);

    // 提取跳转详情
    const jumpDetails = [];
    const jumpPattern = /点击[^，。、]*?([^\s，。、]{2,20})[^，。、]*?跳转/gi;
    let jumpMatch;
    while ((jumpMatch = jumpPattern.exec(functionDesc)) !== null) {
      if (jumpMatch[1] && jumpMatch[1].length > 1) {
        jumpDetails.push(jumpMatch[1]);
      }
    }

    if (hasQuery || hasExport || hasImport || hasJump) {
      if (!foundPageNames.has(pageName)) {
        foundPageNames.add(pageName);
        contexts.push({
          pageName,
          hasQuery,
          hasExport,
          hasImport,
          hasJump,
          jumpDetails
        });
      }
    }
  }

  // 🚨 模式1.5：专门针对 "粒度" 类标题（日粒度、周粒度、月粒度）
  // 这类标题常见格式：日粒度小区业务感知健康度&质差评估
  const granularityPattern = /((?:^|\n)(?:#+\s*|\d+[\.\d]*[.、]?\s*)?[日周月5五分分钟小时]粒度[^\n]{2,50})[^\n]*\n(?:[^\n]*\n){0,15}?(?:功能界面说明|功能页面说明|功能说明|界面说明)[^\n]*\n((?:[^\n]*\n){1,25})/gi;

  while ((match = granularityPattern.exec(documentContent)) !== null) {
    const rawPageName = match[1].replace(/^[\s\n#\d\.\、]+/, '').trim();
    // 清理页面名称，保留核心内容
    const pageName = rawPageName.replace(/[&＆]+/g, '').replace(/\s+/g, '');
    const functionDesc = match[2];

    console.log(`📋 模式1.5匹配到粒度标题: "${pageName}"`);
    console.log(`   功能描述内容: "${functionDesc.substring(0, 100)}..."`);

    // 检查功能描述中是否有查询/导出/导入
    const hasQuery = /支持查询|查询功能|条件查询/i.test(functionDesc);
    const hasExport = /支持导出|导出功能|Excel导出/i.test(functionDesc);
    const hasImport = /支持导入|导入功能|批量导入/i.test(functionDesc);
    const hasJump = /点击.*跳转|跳转至|跳转到/i.test(functionDesc);

    if ((hasQuery || hasExport || hasImport || hasJump) && !foundPageNames.has(pageName)) {
      foundPageNames.add(pageName);
      contexts.push({
        pageName,
        hasQuery,
        hasExport,
        hasImport,
        hasJump,
        jumpDetails: []
      });
      console.log(`   ✅ 识别到: 查询=${hasQuery}, 导出=${hasExport}`);
    }
  }

  // 🚨 模式1.6：向上回溯法 - 找到"功能界面说明"后向上查找最近的标题
  const lines = documentContent.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // 检查是否是"功能界面说明"行
    if (/^(?:\d+[\.\d]*[.、]?\s*)?(?:功能界面说明|功能页面说明|功能说明|界面说明)\s*$/.test(line)) {
      // 向下查找功能描述（支持查询、支持导出等）
      let functionDescLines = [];
      let hasQuery = false;
      let hasExport = false;
      let hasImport = false;

      for (let j = i + 1; j < Math.min(i + 20, lines.length); j++) {
        const descLine = lines[j].trim();
        if (!descLine) continue;

        // 如果遇到新标题则停止
        if (/^(?:\d+[\.\d]*[.、]\s*)?[^\d\s]/.test(descLine) &&
          !descLine.includes('支持') &&
          descLine.length < 60 &&
          /[表页面模块界面统计评估详情汇总分析]/.test(descLine)) {
          break;
        }

        functionDescLines.push(descLine);
        if (/支持查询|查询功能|条件查询/i.test(descLine)) hasQuery = true;
        if (/支持导出|导出功能|Excel导出/i.test(descLine)) hasExport = true;
        if (/支持导入|导入功能|批量导入/i.test(descLine)) hasImport = true;
      }

      // 如果找到了查询/导出功能，向上查找标题
      if (hasQuery || hasExport || hasImport) {
        let pageName = null;

        // 向上查找最近的标题（最多回溯20行）
        for (let k = i - 1; k >= Math.max(0, i - 20); k--) {
          const titleLine = lines[k].trim();
          if (!titleLine) continue;

          // 跳过描述性句子（以"将"、"按"、"通过"等开头）
          if (/^[将按由于通过根据基于为了]/.test(titleLine)) continue;

          // 检查是否是标题行（包含关键词或以#/数字开头）
          if (/[日周月]粒度/.test(titleLine) ||
            /(?:表|页面|界面|模块|统计|评估|详情|汇总|分析|综合|检测|监控|报表|健康度)/.test(titleLine) ||
            /^#+\s/.test(titleLine) ||
            /^\d+[\.\d]*[.、]\s*[^\s]/.test(titleLine)) {
            pageName = titleLine
              .replace(/^#+\s*/, '')
              .replace(/^\d+[\.\d]*[.、]\s*/, '')
              .replace(/[&＆]+/g, '')
              .trim();

            if (pageName.length > 3 && pageName.length < 60) {
              break;
            }
          }
        }

        if (pageName && !foundPageNames.has(pageName)) {
          foundPageNames.add(pageName);
          contexts.push({
            pageName,
            hasQuery,
            hasExport,
            hasImport,
            hasJump: false,
            jumpDetails: []
          });
          console.log(`📋 模式1.6回溯法识别到: "${pageName}"`);
          console.log(`   ✅ 查询=${hasQuery}, 导出=${hasExport}`);
        }
      }
    }
  }

  // 🚨 模式2.5：扫描文档中所有"粒度"相关的章节
  // 专门处理类似格式：
  // 日粒度小区业务感知健康度&质差评估
  // ...描述...
  // 功能界面说明
  // 1、支持查询...
  // 2、支持导出
  const granularityHeaders = documentContent.match(/(?:^|\n)(?:#+\s*|\d+[\.\d]*[.、]?\s*)?[日周月5五分分钟小时]粒度[^\n]{2,60}/gi) || [];

  for (const header of granularityHeaders) {
    const headerClean = header.replace(/^[\s\n#\d\.\、]+/, '').replace(/[&＆]+/g, '').trim();

    if (foundPageNames.has(headerClean)) continue; // 已处理过

    // 查找该标题后的内容
    const headerIndex = documentContent.indexOf(header);
    if (headerIndex === -1) continue;

    const afterHeader = documentContent.substring(headerIndex, headerIndex + 3000);

    // 检查后续内容是否有"功能界面说明"以及"支持查询/导出"
    const hasUISection = /功能界面说明|功能页面说明|功能说明|界面说明/.test(afterHeader);
    const hasQuery = /支持查询|条件查询|查询功能/.test(afterHeader);
    const hasExport = /支持导出|导出功能|Excel导出/.test(afterHeader);
    const hasImport = /支持导入|导入功能|批量导入/.test(afterHeader);

    if (hasUISection && (hasQuery || hasExport || hasImport)) {
      foundPageNames.add(headerClean);
      contexts.push({
        pageName: headerClean,
        hasQuery,
        hasExport,
        hasImport,
        hasJump: false,
        jumpDetails: []
      });
      console.log(`📋 模式2.5扫描粒度章节识别到: "${headerClean}"`);
      console.log(`   ✅ 查询=${hasQuery}, 导出=${hasExport}, 导入=${hasImport}`);
    }
  }

  // 模式3：如果上面都没找到，尝试直接搜索 "支持查询" 和 "支持导出"
  if (contexts.length === 0) {
    // 查找最近的表名
    const tableNames = documentContent.match(/([^\n]{3,40}?(?:表|页面|统计表|评估表|详情表|汇总表|分析表)(?:-[日周月])?)/g) || [];

    const hasQueryInDoc = /支持查询/i.test(documentContent);
    const hasExportInDoc = /支持导出/i.test(documentContent);
    const hasImportInDoc = /支持导入/i.test(documentContent);

    if ((hasQueryInDoc || hasExportInDoc || hasImportInDoc) && tableNames.length > 0) {
      // 使用找到的第一个表名作为上下文
      const defaultPageName = tableNames[0].replace(/^\d+[\.\\s]+/, '').trim();
      contexts.push({
        pageName: defaultPageName,
        hasQuery: hasQueryInDoc,
        hasExport: hasExportInDoc,
        hasImport: hasImportInDoc,
        hasJump: false,
        jumpDetails: []
      });
    }
  }

  console.log(`\n📊 extractPageContexts 总计识别到 ${contexts.length} 个页面上下文`);
  contexts.forEach((ctx, idx) => {
    console.log(`   ${idx + 1}. ${ctx.pageName}: 查询=${ctx.hasQuery}, 导出=${ctx.hasExport}`);
  });

  return contexts;
}

/**
 * 验证并修正泛化的功能名称（占位函数，如果不存在）
 */
function validateAndFixFunctionNames(functionList) {
  // 如果不需要修改，直接返回
  if (!functionList || !functionList.modules) return functionList;

  // 在这里可以添加更多验证和修正逻辑
  return functionList;
}

/**
 * 检查功能列表质量（占位函数）
 */
function checkFunctionListQuality(functionList) {
  const issues = [];

  if (!functionList) {
    issues.push('功能列表为空');
    return issues;
  }

  const totalFunctions = functionList.totalFunctions || 0;

  if (totalFunctions < 5) {
    issues.push(`功能数量过少（${totalFunctions}个），可能存在遗漏`);
  }

  // 检查是否有查询和导出功能
  const allFunctions = [];
  if (functionList.modules) {
    functionList.modules.forEach(m => {
      if (m.functions) {
        m.functions.forEach(f => allFunctions.push(f.name));
      }
    });
  }

  const hasQuery = allFunctions.some(n => n.includes('查询'));
  const hasExport = allFunctions.some(n => n.includes('导出'));

  if (!hasQuery) {
    issues.push('未识别到任何"查询"功能');
  }
  if (!hasExport) {
    issues.push('未识别到任何"导出"功能');
  }

  return issues;
}

module.exports = {
  threeLayerAnalyze,
  getActiveClientConfig,
  extractFunctionList,
  splitFromFunctionList
};

