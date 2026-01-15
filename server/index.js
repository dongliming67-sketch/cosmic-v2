const express = require('express');
const cors = require('cors');
const multer = require('multer');
const mammoth = require('mammoth');
const ExcelJS = require('exceljs');
const OpenAI = require('openai');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = parseInt(process.env.PORT, 10) || 2617;

// 中间件
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// 文件上传配置 - 支持更多格式
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (req, file, cb) => {
    // 解码文件名（处理中文文件名）
    file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');

    const allowedMimes = [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
      'application/msword', // .doc (旧格式)
      'text/plain', // .txt
      'text/markdown', // .md
    ];

    const ext = path.extname(file.originalname).toLowerCase();
    const allowedExts = ['.docx', '.doc', '.txt', '.md'];

    if (allowedMimes.includes(file.mimetype) || allowedExts.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`不支持的文件格式: ${ext}，请上传 .docx, .txt 或 .md 文件`));
    }
  }
});

// 错误处理中间件
const handleMulterError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: '文件大小超过限制（最大50MB）' });
    }
    return res.status(400).json({ error: `上传错误: ${err.message}` });
  } else if (err) {
    return res.status(400).json({ error: err.message });
  }
  next();
};

// OpenAI客户端
let openai = null;
let groqClient = null;

function getOpenAIClient() {
  if (!openai && process.env.OPENAI_API_KEY) {
    openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'
    });
  }
  return openai;
}

// Groq客户端（用于三层分析框架模式）
function getGroqClient() {
  if (!groqClient && process.env.GROQ_API_KEY) {
    const Groq = require('groq-sdk');
    groqClient = new Groq({
      apiKey: process.env.GROQ_API_KEY
    });
    console.log('Groq客户端已初始化，API Key:', process.env.GROQ_API_KEY ? '已配置' : '未配置');
  }
  return groqClient;
}

// 引入增强版提示词
const { ENHANCED_COSMIC_SYSTEM_PROMPT } = require('./enhanced-prompts');
// 引入三层分析框架API（含两阶段动态驱动分析）
const { threeLayerAnalyze, getActiveClientConfig, extractFunctionList, splitFromFunctionList } = require('./three-layer-api');
// 引入两步骤COSMIC拆分提示词
const { STEP1_FUNCTION_EXTRACTION_PROMPT, STEP2_COSMIC_SPLIT_PROMPT } = require('./two-step-cosmic-prompts');

// 通用AI调用助手 (集成Gemini和其他提供商)
async function callAIChat(options) {
  const { messages, temperature = 0.7, max_tokens = 8000, stream = false, res = null, userConfig = null } = options;

  const clientConfig = getActiveClientConfig(userConfig);
  if (!clientConfig) {
    throw new Error('请先配置API密钥');
  }

  const { client, model, useGeminiSDK, useGroqSDK } = clientConfig;

  if (useGeminiSDK) {
    if (stream && res) {
      // Gemini SDK 流式调用
      const fullPrompt = messages.map(m => `${m.role === 'system' ? 'SYSTEM' : 'USER'}: ${m.content}`).join('\n\n');
      const result = await client.generateContentStream(fullPrompt);
      for await (const chunk of result.stream) {
        const text = chunk.text();
        res.write(`data: ${JSON.stringify({ content: text })}\n\n`);
      }
      return null;
    } else {
      // Gemini SDK 非流式
      const fullPrompt = messages.map(m => `${m.role === 'system' ? 'SYSTEM' : 'USER'}: ${m.content}`).join('\n\n');
      const result = await client.generateContent(fullPrompt);
      const response = await result.response;
      const text = response.text();
      return {
        choices: [{ message: { content: text } }],
        usage: { total_tokens: 0 }
      };
    }
  } else {
    // OpenAI 兼容 SDK (智谱, OpenRouter, Groq 等)
    const completion = await client.chat.completions.create({
      model,
      messages,
      temperature,
      max_tokens,
      stream
    });

    if (stream && res) {
      for await (const chunk of completion) {
        const content = chunk.choices[0]?.delta?.content || '';
        if (content) {
          res.write(`data: ${JSON.stringify({ content })}\n\n`);
        }
      }
      return null;
    }
    return completion;
  }
}


// Cosmic拆分系统提示词 - 融合Gemini四阶段方法论
const COSMIC_SYSTEM_PROMPT = `你是一个顶级COSMIC分析专家与业务架构师。你的任务是运用四阶段方法论，将线性文档重构为"立体"的功能模型，确保输出的功能过程超越简单的增删改查（CRUD），具备极高的实战价值与物理层面的唯一性。

# ═══════════════════════════════════════════════════════════
# 第一阶段：文档解耦（理解层 - Document Decoupling）
# ═══════════════════════════════════════════════════════════

## 目标：将杂乱的叙述转化为COSMIC的三大核心要素

### 1. 锁定「功能用户」（Functional User）
**做法**：无视业务逻辑，只找「边界交互者」。
- 凡是能向系统发送指令、或从系统接收数据的实体（人、另一个软件、硬件传感器）均定义为功能用户
- **触发事件 (Triggering Event)**：只能是 \`用户触发\`, \`时钟触发\`, \`接口调用触发\`
- **功能用户 (Functional User)**：格式为 \`发起者：xxx 接收者：xxx\`
  * 若触发事件=用户触发：\`发起者：用户 接收者：用户\`
  * 若触发事件=时钟触发：\`发起者：定时触发器 接收者：网优平台\`
  * 若触发事件=接口调用触发：\`发起者：其他平台 接收者：网优平台\`
- 分类标准与定义：
  * **用户触发**：系统页面实际存在的按钮功能，用户在页面上可直接点击触发
  * **时钟触发**：包含数据采集汇总、流程环节自动流转、短信自动发送等；我方调用其他厂家接口也在此项
  * **接口调用触发**：仅当接口作为**被调用方**时标记以此项

### 2. 识别「数据对象」（Object of Interest）
**做法**：找出文档中的名词实体。
- 判断标准：该实体是否具有独立的状态或属性集合（如：工单、用户、配置项、设备、任务）
- 建立**实体字段池**，为后续去重做准备

### 3. 定义「触发事件」（Triggering Event）
**做法**：寻找「启动开关」。
- 一个功能过程的开始，必须由一个功能用户发起的一个动作触发
- 示例：点击按钮、调用接口、定时器到期、消息到达

# ═══════════════════════════════════════════════════════════
# 第二阶段：过程膨胀与维度扩展（策略层 - Process Expansion）
# ═══════════════════════════════════════════════════════════

## 目标：当文档内容显得单薄时，如何合理地拆分出更多不重复的功能点

### 1. 生命周期全路径拆解（纵向 - 流程轴）
不要只拆「业务处理」，要将一个事务的生命周期拆开：
- **预审准入**：参数校验、身份鉴权、格式验证、前置条件检查
- **主体执行**：核心数据处理、业务逻辑运算、状态转换
- **异步反馈**：结果通知、回调同步、消息推送、事件发布
- **历史追踪**：审计日志生成、操作快照备份、版本记录

### 2. 专项管理维度拆解（横向 - 管理轴）
如果一个接口涉及多个数据对象，强制将其「降维」：
- **归因维度**：追溯操作来源、记录操作路径
- **资产更新维度**：变更资产状态、更新资源配置
- **效能统计维度**：性能指标采集、业务数据汇总
- **合规审计维度**：权限验证、操作审计、数据脱敏

### 3. 负向与异常路径拆解（深度 - 颗粒度）
- **逻辑失败分支**：如「驳回」、「撤回」、「挂起」、「超时」
- **系统防御分支**：如「接口超限拦截」、「格式非法过滤」、「并发冲突检测」

### 4. 字段级颗粒度切片
即使是一个大的数据接口，也要强行"切片"：
- 每一个核心字段（状态码、时间戳、流水号、扩展字段）都应作为独立功能过程的支撑点
- 例如：一个「设备上报接口」可拆分为「设备状态上报」、「设备告警上报」、「设备性能指标上报」

# ═══════════════════════════════════════════════════════════
# 第三阶段：ERWX原子化对照（执行层 - Atomic Decomposition）
# ═══════════════════════════════════════════════════════════

## 目标：将识别出的功能过程（FP）填入标准格式，确保逻辑闭环

### 对于每一个FP，机械化地填充以下四个动作：

**E (Entry - 接收/门卫)**：数据跨越边界进入
- 职责：接收原始请求、解析协议头、校验调用者身份令牌、解析并映射入口字段
- 属性通常包含：请求标识、触发源、核心业务ID、请求时间戳
- 描述公式：接收 + [场景化业务对象] + [协议类型/数据形态] + 指令/包
- 示例：「接收低空任务配置信息异步提交参数包」

**R (Read - 读取/大脑)**：系统为了处理该请求而必须查询的静态或动态数据
- 职责：从数据库检索业务配置、对齐标准字典、检查历史冲突状态、读取审计规则
- 属性包含：映射规则、配置参数、历史快照、关联实体
- 描述公式：检索 + [业务状态/字典] + [关联关系] + 集合/数据
- 示例：「检索低空任务执行前置条件配置规则集合」

**W (Write - 写入/执行)**：系统处理后的结果保存
- 职责：更新业务逻辑主表、原子化写入操作日志、持久化缓存中间态数据、锁定业务资源
- 属性包含：更新后的状态、操作时间、执行日志、版本号
- 描述公式：持久化/记录 + [更新行为] + [表族名] + 事务流水
- 示例：「持久化低空任务配置变更事务流水表」

**X (eXit - 输出/反馈)**：数据跨越边界返回
- 职责：封装标准响应协议体、映射层级化错误码、记录接口处理耗时流水
- 属性包含：返回码、提示语、业务处理回执、响应时间戳
- 描述公式：封装 + [响应等级] + [返回码映射] + 响应体
- 示例：「封装低空任务配置确认回执响应体」

# ═══════════════════════════════════════════════════════════
# 第四阶段：全局数据查重（质量层 - Global Deduplication）
# ═══════════════════════════════════════════════════════════

## 目标：确保数据属性组合在50个（或更多）过程点中唯一

### 核心字段 + 随机辅助字段的动态组合算法

**1. 核心字段占位**：
- 根据FP的含义分配专属字段（如：若FP涉及硬件，则必选SN类字段）
- 每个功能过程必须有一个「锚定字段」作为身份标识

**2. 辅助字段填充**：
- 从通用字段池（ID、Time、Operator、Status、Code、Version、Source、Target）中随机抽取
- 确保不同功能过程使用不同的辅助字段组合

**3. 查重算法**：
- **语义去重**：确保过程名称的「动作+对象」组合唯一
- **物理去重**：检查当前属性组（Attribute Group）的字段集合
  * 如果A过程用了(字段A, B, C)，B过程即便必须用字段A，也会强迫它搭配(D, E)
  * 从而使指纹唯一，实现物理排他性

**4. 字段互斥原则**：
- 同一表格中，相邻的两个功能过程，其数据属性重合度不得超过30%
- 必须包含业务字段（如：sn、code、type）和管理字段（如：timestamp、retry_count、operator_id）

### 命名公式 (Object + Action + State)
- ❌ 严禁：接收任务请求
- ✅ 推荐：接收【低空任务】【配置信息】【异步提交】参数包

# ═══════════════════════════════════════════════════════════
# 执行规范总结
# ═══════════════════════════════════════════════════════════

## 功能过程命名
- 格式：[对象] + [动作/状态] + [处理类型] + [业务场景]
- 示例：「低空任务配置信息异步提交参数验证」

## 数据组命名
- 禁止使用：「请求」、「响应」、「表格」、「记录」等泛化词
- 推荐使用：「业务负荷包」、「状态统一库」、「反馈确认包」、「事务流水表」、「配置规则集」

## 数据属性要求
- 每行必须至少4个字段
- 必须体现该功能的独特业务需求
- 字段组合必须具有物理排他性

## 错误示例（绝对禁止）
- ❌ 仅输出CRUD（查询、修改、新增、删除）
- ❌ 子过程描述重复（如多个功能都写"读取数据库信息"）
- ❌ 缺少E/R/W/X中的任何一项
- ❌ 数据组名字雷同
- ❌ 数据属性组合重复度超过30%

请根据文档内容，严格遵循上述四阶段方法论，进行深度COSMIC拆分。`;

// API路由

// 健康检查 (开放平台模式：密钥由用户浏览器保存，这里返回true以便UI正常显示)
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    hasApiKey: true, // 开放平台模式：密钥由前端每请求携带，无需服务端预设
    provider: 'openai',
    baseUrl: 'https://api.siliconflow.cn/v1'
  });
});

// 更新API配置 (开放平台模式下，仅返回成功，实际配置由前端每请求带上)
app.post('/api/config', (req, res) => {
  const { apiKey, baseUrl } = req.body;

  // 验证一下格式
  if (apiKey && apiKey.includes('你的') && apiKey.includes('密钥')) {
    return res.status(400).json({ error: '请填入真实的 API Key，不要包含中文占位符' });
  }

  res.json({ success: true, message: 'API配置已更新（本地生效）' });
});

// 解析文档（支持多种格式）
app.post('/api/parse-word', upload.single('file'), handleMulterError, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '请上传文件' });
    }

    const ext = path.extname(req.file.originalname).toLowerCase();
    let text = '';
    let html = '';

    console.log(`解析文件: ${req.file.originalname}, 类型: ${req.file.mimetype}, 大小: ${req.file.size} bytes`);

    if (ext === '.docx') {
      // 解析 .docx 文件
      try {
        const result = await mammoth.extractRawText({ buffer: req.file.buffer });
        text = result.value;

        const htmlResult = await mammoth.convertToHtml({ buffer: req.file.buffer });
        html = htmlResult.value;

        if (result.messages && result.messages.length > 0) {
          console.log('Mammoth警告:', result.messages);
        }
      } catch (mammothError) {
        console.error('Mammoth解析错误:', mammothError);
        return res.status(400).json({
          error: `Word文档解析失败: ${mammothError.message}。请确保文件是有效的.docx格式（不支持旧版.doc格式）`
        });
      }
    } else if (ext === '.txt' || ext === '.md') {
      // 解析纯文本或Markdown文件
      text = req.file.buffer.toString('utf-8');
      html = `<pre>${text}</pre>`;
    } else if (ext === '.doc') {
      return res.status(400).json({
        error: '不支持旧版.doc格式，请将文件另存为.docx格式后重新上传'
      });
    } else {
      return res.status(400).json({ error: `不支持的文件格式: ${ext}` });
    }

    if (!text || text.trim().length === 0) {
      return res.status(400).json({ error: '文档内容为空，请检查文件是否正确' });
    }

    res.json({
      success: true,
      text: text,
      html: html,
      filename: req.file.originalname,
      fileSize: req.file.size,
      wordCount: text.length
    });
  } catch (error) {
    console.error('解析文档失败:', error);
    res.status(500).json({ error: '解析文档失败: ' + error.message });
  }
});

// AI对话 - Cosmic拆分
app.post('/api/chat', async (req, res) => {
  try {
    const { messages, documentContent } = req.body;

    const chatMessages = [systemMessage];

    // 如果有文档内容，添加到上下文
    if (documentContent) {
      chatMessages.push({
        role: 'user',
        content: `以下是需要进行Cosmic拆分的功能过程文档内容：\n\n${documentContent}\n\n请根据上述内容进行Cosmic拆分。`
      });
    }

    // 添加用户消息历史
    if (messages && messages.length > 0) {
      chatMessages.push(...messages);
    }

    const completion = await callAIChat({
      messages: chatMessages,
      temperature: 0.7
    });

    const reply = completion.choices[0].message.content;

    res.json({
      success: true,
      reply: reply,
      usage: completion.usage
    });
  } catch (error) {
    console.error('AI对话失败:', error);
    res.status(500).json({ error: 'AI对话失败: ' + error.message });
  }
});


// 流式AI对话 - 增强版：支持后续要求生成cosmic并同步到表格
app.post('/api/chat/stream', async (req, res) => {
  try {
    const { messages, documentContent, existingTableData = [], generateCosmic = false, userGuidelines = '', userConfig = null } = req.body;

    console.log('收到流式对话请求，文档长度:', documentContent?.length || 0, '生成COSMIC:', generateCosmic);

    // 设置SSE响应头
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    const systemMessage = {
      role: 'system',
      content: COSMIC_SYSTEM_PROMPT
    };

    const chatMessages = [systemMessage];

    if (documentContent) {
      let guidelinesText = userGuidelines ? `\n用户设定的全局拆分要求：${userGuidelines}\n` : '';
      chatMessages.push({
        role: 'user',
        content: `以下是需要进行Cosmic拆分的功能过程文档内容：${guidelinesText}\n\n${documentContent}\n\n请根据上述内容进行Cosmic拆分，生成标准的Markdown表格。`
      });
    }

    if (existingTableData && existingTableData.length > 0) {
      const existingFunctions = [...new Set(existingTableData.map(r => r.functionalProcess).filter(Boolean))];
      if (existingFunctions.length > 0) {
        chatMessages.push({
          role: 'assistant',
          content: `我已经完成了以下功能过程的COSMIC拆分：${existingFunctions.join('、')}`
        });
      }
    }

    if (messages && messages.length > 0) {
      const lastUserMsg = messages[messages.length - 1];
      if (lastUserMsg && lastUserMsg.role === 'user') {
        const userContent = lastUserMsg.content || '';
        const cosmicKeywords = ['拆分', '功能', 'cosmic', '表格', '添加', '补充', '生成', '分析'];
        const shouldGenerateCosmic = cosmicKeywords.some(kw => userContent.toLowerCase().includes(kw));

        if (shouldGenerateCosmic) {
          const enhancedMessages = messages.slice(0, -1);
          enhancedMessages.push({
            role: 'user',
            content: `${userContent}\n\n**重要**：请根据上述要求，生成对应的COSMIC功能过程拆分表格（Markdown格式）。`
          });
          chatMessages.push(...enhancedMessages);
        } else {
          chatMessages.push(...messages);
        }
      } else {
        chatMessages.push(...messages);
      }
    }

    await callAIChat({
      messages: chatMessages,
      stream: true,
      res,
      userConfig
    });

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (error) {
    console.error('流式对话失败:', error.message);
    if (!res.headersSent) {
      res.setHeader('Content-Type', 'text/event-stream');
    }
    res.write(`data: ${JSON.stringify({ error: '调用AI失败: ' + error.message })}\n\n`);
    res.end();
  }
});

// 循环调用 - 继续生成直到完成所有功能过程（数量优先模式 - 增强版：同步质量优先的深度思考）
app.post('/api/continue-analyze', async (req, res) => {
  try {
    const { documentContent, previousResults = [], round = 1, targetFunctions = 30, understanding = null, userGuidelines = '', userConfig = null } = req.body;

    // 构建已完成的功能过程列表

    const completedFunctions = previousResults.map(r => r.functionalProcess).filter(Boolean);
    const uniqueCompleted = [...new Set(completedFunctions)];

    // 构建已使用的子过程描述列表（用于去重检查）
    const usedSubProcessDescs = previousResults.map(r => r.subProcessDesc).filter(Boolean);
    const uniqueSubProcessDescs = [...new Set(usedSubProcessDescs)];

    // 构建文档理解上下文（如果有）- 增强版：包含触发方式信息
    let understandingContext = '';
    if (understanding) {
      const modules = understanding.coreModules || [];
      const modulesList = modules.map(m => {
        const functions = m.estimatedFunctions || [];
        const funcList = Array.isArray(functions) && functions.length > 0 && typeof functions[0] === 'object'
          ? functions.map(f => `${f.functionName} (${f.triggerType})`).join('、')
          : functions.join('、');
        return `- ${m.moduleName}: ${funcList}`;
      }).join('\n');

      // 构建触发方式统计
      const breakdown = understanding.functionBreakdown || {};
      const triggerStats = `
触发方式分布：
- 用户触发功能：${breakdown.userTriggeredFunctions || '未统计'}个
- 时钟触发功能：${breakdown.timerTriggeredFunctions || '未统计'}个
- 接口触发功能：${breakdown.interfaceTriggeredFunctions || '未统计'}个`;

      understandingContext = `
## 文档深度理解结果（含触发方式标注）：
- 项目名称：${understanding.projectName || '未知'}
- 项目描述：${understanding.projectDescription || '无'}
- 系统架构：${understanding.systemArchitecture || '待确定'}
- 系统边界：${understanding.systemBoundary || '待确定'}
- 用户角色：${(understanding.userRoles || []).join('、') || '用户'}
- 数据实体：${(understanding.dataEntities || []).join('、') || '待识别'}
${triggerStats}
- 核心模块及功能（含触发方式）：
${modulesList || '暂无'}
- 预估功能过程总数：${understanding.totalEstimatedFunctions || targetFunctions}

**请基于以上理解，确保拆分的功能过程与文档实际内容一致，并严格按照标注的触发方式填写"功能用户"和"触发事件"列！**

**触发方式填写规范（必须严格遵守）：**
- 用户触发 → 功能用户="发起者：用户 接收者：用户"，触发事件="用户触发"
- 时钟触发 → 功能用户="发起者：定时触发器 接收者：网优平台"，触发事件="时钟触发"
- 接口触发 → 功能用户="发起者：其他平台 接收者：网优平台"，触发事件="接口调用触发"

`;
    }

    let userPrompt = '';
    if (round === 1) {
      // 构建用户指导指导上下文
      let guidelinesContext = '';
      if (userGuidelines) {
        guidelinesContext = `\n\n## 用户特定的拆分要求（请务必严格遵守）：\n**${userGuidelines}**\n`;
      }

      userPrompt = `以下是功能文档内容：
${guidelinesContext}
${documentContent}

${understandingContext}
## 重要：深度思考要求
在开始拆分之前，请先深度理解文档：
1. **通读全文**：理解业务背景、用户角色、系统边界
2. **识别核心功能**：只识别文档中明确描述的功能，不要臆造
3. **分析功能关系**：理解功能之间的依赖和调用关系

## 核心原则：质量第一
- **宁缺毋滥**：只拆分文档中明确描述的功能，不要为了凑数量而乱拆
- **精准命名**：功能过程名称必须与文档描述一致
- **子过程唯一**：每个子过程描述在整个分析结果中必须唯一，不能重复

请对文档中的功能进行高质量COSMIC拆分。

## 输出格式要求（极其重要）：
**只输出一个Markdown数据表格，不要输出任何格式说明、示例表格或其他解释文字！**
直接输出以下格式的表格：

|功能用户|触发事件|功能过程|子过程描述|数据移动类型|数据组|数据属性|
|:---|:---|:---|:---|:---|:---|:---|
|发起者：用户 接收者：用户|用户触发|创建飞行计划|接收创建飞行计划请求参数|E|创建飞行计划请求|计划名称、起飞时间、航线ID|
||||读取创建飞行计划航线配置|R|创建飞行计划航线表|航线ID、航线名称、起点|
||||保存创建飞行计划记录|W|创建飞行计划数据表|计划ID、创建时间、状态|
||||返回创建飞行计划结果|X|创建飞行计划响应|计划ID、状态、消息|
|发起者：用户 接收者：用户|用户触发|查询任务列表|接收查询任务列表请求参数|E|查询任务请求|查询条件、分页参数|
||||读取查询任务列表数据|R|任务数据表|任务ID、任务名称、状态|
||||记录查询任务列表操作日志|W|任务查询日志表|查询人、查询时间、查询条件|
||||返回查询任务列表结果|X|任务列表响应|任务列表、总数|

## 高质量拆分核心要求（必须严格遵守！）：
1. **每个功能过程必须有4个子过程：E + R + W + X**
   - ✅ 正确：E → R → W → X（4个子过程，标准结构）
   - ❌ 错误：只有E（缺少R、W、X）
   - ❌ 错误：E → R → X（缺少W）
   - ❌ 错误：E → W → X（缺少R）
   - **即使是查询功能，也要有W（记录查询日志）**
   - **即使是简单操作，也要有R（读取相关数据）**
2. **功能过程名称**：动词+具体业务对象，如"创建飞行计划"
3. **子过程描述必须包含功能过程关键词**：如"读取创建飞行计划航线配置"
4. **数据组命名要具体**：包含功能过程关键词，如"创建飞行计划请求"

## 严格限制：
1. **每个功能过程必须有E、R、W、X四种类型，缺一不可！**
2. 顺序必须是：E → R → W → X
3. 目标识别约 ${targetFunctions} 个功能过程
4. **只输出数据表格，不要输出格式说明或示例！**`;
    } else {
      // 构建已使用子过程描述的提示（避免重复）
      const usedDescsHint = uniqueSubProcessDescs.length > 0
        ? `\n\n## 已使用的子过程描述（绝对不能重复使用）：\n${uniqueSubProcessDescs.slice(0, 50).join('\n')}${uniqueSubProcessDescs.length > 50 ? '\n...(更多)' : ''}\n`
        : '';

      userPrompt = `继续分析文档中尚未拆分的功能过程。

已完成的功能过程（${uniqueCompleted.length}个）：
${uniqueCompleted.slice(0, 30).join('、')}${uniqueCompleted.length > 30 ? '...' : ''}

目标覆盖约 ${targetFunctions} 个功能过程，**质量优先于数量**。

## 输出格式要求（极其重要）：
**只输出一个Markdown数据表格，不要输出任何格式说明或解释文字！**

## 子过程完整性要求（必须严格遵守！）：
**每个功能过程必须有4个子过程：E + R + W + X，缺一不可！**
- 所有功能：E → R → W → X（4个子过程）
- **即使是查询功能，也要有W（记录查询日志）**
- **即使是简单操作，也要有R（读取相关数据）**

正确示例（注意每个功能过程都有E、R、W、X四个子过程）：
|功能用户|触发事件|功能过程|子过程描述|数据移动类型|数据组|数据属性|
|:---|:---|:---|:---|:---|:---|:---|
|发起者：用户 接收者：用户|用户触发|删除任务记录|接收任务删除请求参数|E|任务删除请求|任务ID、删除原因|
||||读取任务当前状态|R|任务状态表|任务ID、状态、创建时间|
||||执行任务删除操作|W|任务操作日志|任务ID、操作类型、操作时间|
||||返回任务删除结果|X|任务删除响应|操作状态、消息|
|发起者：用户 接收者：用户|用户触发|查询设备列表|接收设备列表查询请求|E|设备查询请求|查询条件、分页参数|
||||读取设备列表数据|R|设备数据表|设备ID、设备名称、状态|
||||记录设备列表查询日志|W|设备查询日志表|查询人、查询时间、查询条件|
||||返回设备列表结果|X|设备列表响应|设备列表、总数|

## 核心要求：
1. **每个功能过程必须有E、R、W、X四种类型，缺一不可！**
2. **绝对禁止**只输出E行而没有后续R、W、X行的情况！
3. **功能过程名称只在E行填写**，后续R/W/X行的功能过程列留空
4. **不能与已完成的功能过程重复**

请继续拆分尚未处理的功能，**只输出数据表格**。
如果所有功能都已完成，回复"[ALL_DONE]"。`;
    }

    const systemMessage = {
      role: 'system',
      content: COSMIC_SYSTEM_PROMPT
    };

    console.log(`数量优先第 ${round} 轮分析开始，已完成 ${uniqueCompleted.length} 个功能过程，已有 ${uniqueSubProcessDescs.length} 个子过程描述...`);

    const completion = await callAIChat({
      messages: [
        systemMessage,
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.5,
      userConfig
    });


    const reply = completion.choices[0].message.content;
    console.log(`数量优先第 ${round} 轮完成，响应长度: ${reply.length}`);

    // 增强的完成判断逻辑
    let isDone = false;

    // 1. 明确的完成标记
    if (reply.includes('[ALL_DONE]') || reply.includes('已完成') || reply.includes('全部拆分') || reply.includes('无需补充')) {
      isDone = true;
      console.log('数量优先 - 检测到完成标记');
    }

    // 2. 如果回复中没有有效的表格数据，认为已完成
    const hasValidTable = reply.includes('|') && (reply.includes('|E|') || reply.includes('| E |') || reply.match(/\|[^|]*\|[^|]*\|[^|]*\|[^|]*\|E\|/));
    if (!hasValidTable && round > 1) {
      isDone = true;
      console.log('数量优先 - 回复中没有有效表格，认为已完成');
    }

    // 3. 如果已完成的功能过程数量达到或超过目标，认为已完成
    if (uniqueCompleted.length >= targetFunctions) {
      isDone = true;
      console.log(`数量优先 - 已完成 ${uniqueCompleted.length} 个功能过程，达到目标 ${targetFunctions}`);
    }

    // 4. 如果轮次过多（超过10轮），强制停止
    if (round >= 10) {
      isDone = true;
      console.log('数量优先 - 轮次达到上限(10轮)，强制停止');
    }

    // 5. 如果回复内容过短（少于100字符），可能是AI认为已完成
    if (reply.length < 100 && round > 1) {
      isDone = true;
      console.log('数量优先 - 回复内容过短，认为已完成');
    }

    res.json({
      success: true,
      reply: reply,
      round: round,
      isDone: isDone,
      completedFunctions: uniqueCompleted.length,
      targetFunctions
    });
  } catch (error) {
    console.error('分析失败:', error);
    res.status(500).json({ error: '分析失败: ' + error.message });
  }
});

// ========== 质量优先循环分析 API ==========
// 与数量优先类似的循环调用方式，但使用更高质量的prompt确保功能过程质量
app.post('/api/quality-continue-analyze', async (req, res) => {
  try {
    const { documentContent, previousResults = [], round = 1, targetFunctions = 30, understanding = null, userGuidelines = '', userConfig = null } = req.body;

    // 构建已完成的功能过程列表

    const completedFunctions = previousResults.map(r => r.functionalProcess).filter(Boolean);
    const uniqueCompleted = [...new Set(completedFunctions)];

    // 构建文档理解上下文（如果有）- 质量优先增强版：包含触发方式信息
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

      // 构建触发方式统计
      const breakdown = understanding.functionBreakdown || {};
      const triggerStats = breakdown.userTriggeredFunctions || breakdown.timerTriggeredFunctions || breakdown.interfaceTriggeredFunctions
        ? `
**触发方式分布统计**：
- 用户触发功能：${breakdown.userTriggeredFunctions || 0}个 (用户点击、操作、查询等)
- 时钟触发功能：${breakdown.timerTriggeredFunctions || 0}个 (定时、周期、自动执行)
- 接口触发功能：${breakdown.interfaceTriggeredFunctions || 0}个 (接收推送、回调、外部调用)`
        : '';

      // 构建定时任务列表
      const timedTasks = understanding.timedTasks || [];
      const timedTasksList = timedTasks.length > 0
        ? `\n**定时任务明细**：\n${timedTasks.map(t => `- ${t.taskName} (${t.schedule}): ${t.description}`).join('\n')}`
        : '';

      understandingContext = `
## 文档深度理解结果（含触发方式详细标注）：
- 项目名称：${understanding.projectName || '未知'}
- 项目描述：${understanding.projectDescription || '无'}
- 系统架构：${understanding.systemArchitecture || '待确定'}
- 系统边界：${understanding.systemBoundary || '待确定'}
- 用户角色：${(understanding.userRoles || []).join('、') || '用户'}
- 数据实体：${(understanding.dataEntities || []).join('、') || '待识别'}
- 外部接口：${(understanding.externalInterfaces || []).join('、') || '无'}
${triggerStats}${timedTasksList}
- 预估功能过程总数：${understanding.totalEstimatedFunctions || 30}

**核心模块及功能（含触发方式和使用场景）：**
${modulesList || '暂无'}

---

**请基于以上深度理解，严格按照以下规则进行COSMIC拆分：**

1. **确保拆分的功能过程与文档实际内容一致，覆盖所有核心模块的功能**
2. **严格按照标注的触发方式填写"功能用户"和"触发事件"列**：
   - 用户触发 → 功能用户="发起者：用户 接收者：用户"，触发事件="用户触发"
   - 时钟触发 → 功能用户="发起者：定时触发器 接收者：网优平台"，触发事件="时钟触发"
   - 接口触发 → 功能用户="发起者：其他平台 接收者：网优平台"，触发事件="接口调用触发"
3. **不要臆造文档中没有的功能**
4. **每个功能过程必须有完整的E+R+W+X四个子过程**

`;
    }

    let userPrompt = '';
    if (round === 1) {
      // 构建用户指导指导上下文
      let guidelinesContext = '';
      if (userGuidelines) {
        guidelinesContext = `\n\n## 用户特定的拆分要求（请务必严格遵守）：\n**${userGuidelines}**\n`;
      }

      userPrompt = `以下是功能文档内容：
${guidelinesContext}
${documentContent}

${understandingContext}请对文档中的功能进行立体化COSMIC拆分，输出Markdown表格。

## 一、 逻辑重构铁律（必须严格遵守！）

你必须停止平面的"增删改查"思维，采用 3D 立体建模：

1. **纵向（流程轴）**：挖掘"全生命周期"。
   - 严禁只写"执行"。必须自动拆解出【预校验/入场】、【执行中状态更新】、【异常捕获与重试】、【结果异步确认/出场】等独立过程。
   
2. **横向（管理轴）**：挖掘"隐藏底座"。
   - 自动补全文档未言明的管理功能：操作审计（Audit）、权限核查（Auth）、字典对齐（Mapping）、系统日志（Log）、合规自检（Check）。

3. **深度（颗粒度）**：挖掘"原子字段"。
   - 将复合接口按字段映射拆解。每一个核心字段（状态码、流水号）的读写都应被视为潜在的数据移动。

## 二、 ERWX 原子化建模规范

每一行描述必须符合以下原子化公式，严禁使用"接收请求/保存数据"等模糊词汇：

- **E (Entry/门卫)**：接收 + [场景化业务对象] + [协议/形态] + [指令/包]。
- **R (Read/大脑)**：检索 + [业务状态/字典] + [关联关系] + [集合/数据]。
- **W (Write/执行)**：持久化/更新 + [行为描述] + [表族名] + [事务流水/日志]。
- **X (eXit/反馈)**：封装 + [响应等级] + [返回码映射] + [响应体/凭证]。

## 三、 数据属性与查重（绝对唯一性）

1. **原子化字段池**：从文档中扫描所有业务字段（SN、厂家、码值）和管理字段（Timestamp、Operator、RetryCount）。
2. **特征指纹去重**：
   - 每个功能必须有一个"锚定字段"。
   - **指纹互斥**：相邻功能的数据属性组合重合度必须低于 30%。通过随机异位填充辅助字段（如在A功能写时间，B功能写版本号）实现物理查重。
3. **命名公式 (Object + Action + State)**：如【低空任务】【参数变更】【流水表】。

请立刻开始深度拆分，确保输出的功能过程具备极高的实战覆盖率。

## 高质量拆分要求：
1. **功能过程名称必须精准到场景级别**：不仅要有"动词+名词"，还要有"状态/类型/范围"描述
2. **子过程描述必须高度场景化**：要让人一眼看出这是什么业务场景下的什么操作
3. **数据组命名必须业务化**：避免使用"请求、响应、表、记录"等通用词，要用具体的业务术语
4. **数据属性必须差异化**：每个功能过程的字段组合必须是唯一的，体现该功能的特定需求

## 功能过程与子过程的层级关系：
**一个功能过程必须包含多个子过程，功能过程名称只在第一行（E行）填写，后续子过程行的功能过程列必须留空！**

正确示例（高质量拆分 - 展示两个高度区分化的功能）：
| 功能用户 | 触发事件 | 功能过程 | 子过程描述 | 数据移动类型 | 数据组 | 数据属性 |
|:---|:---|:---|:---|:---|:---|:---|
| 用户触发 | 用户请求 | 创建新的飞行计划任务 | 接收新飞行计划任务创建表单数据 | E | 飞行计划任务新建表单提交数据 | 飞行计划模板ID、计划任务名称、计划创建人、起飞预定时间、航线选择ID、无人机指定ID、任务优先级 |
|||| 读取可用航线库和无人机资源分配情况 | R | 可分配航线与无人机资源池 | 航线ID、航线名称、起点坐标、终点坐标、无人机ID、当前位置、剩余电量、可用状态、维护计划 |
|||| 保存飞行计划任务初始配置和资源绑定关系 | W | 飞行计划任务初始配置持久化数据 | 计划任务ID、计划名称、创建时间、计划状态、分配航线、分配无人机、预计起飞时间、创建人ID |
|||| 返回飞行计划任务创建成功凭证和资源清单 | X | 飞行计划任务创建凭证与资源清单 | 计划任务ID、创建状态、预计起飞时间、分配的航线信息、分配的无人机信息、任务优先级、创建时间戳 |
| 用户触发 | 用户请求 | 启用已暂停的飞行任务恢复执行 | 接收飞行任务恢复执行指令参数 | E | 飞行任务恢复执行指令参数集 | 暂停任务ID、恢复执行操作人、恢复时间点、暂停原因码、恢复后预计完成时间 |
|||| 读取飞行任务暂停前的执行进度和设备状态 | R | 飞行任务暂停前执行快照数据 | 任务ID、暂停时航点位置、暂停时飞行高度、暂停前已飞行时长、暂停前已完成航点数、无人机暂停时设备状态、剩余电量百分比 |
|||| 更新飞行任务执行状态为运行中并记录恢复时间点 | W | 飞行任务状态转换操作日志 | 任务ID、状态转换类型、从暂停到运行、状态转换时间、恢复操作人、恢复原因、预计恢复后完成时间 |
|||| 返回飞行任务恢复执行确认及预计完成时间 | X | 飞行任务恢复执行确认回执 | 任务ID、恢复执行状态、恢复时间点、当前航点位置、预计完成时间、剩余飞行时长、操作确认码 |

## 其他规则：
1. **每个功能过程必须有4个子过程：E + R + W + X，缺一不可！**
2. 顺序必须是：E → R → W → X
3. 功能过程名称必须唯一且高度可区分
4. **完整覆盖文档中的所有功能描述，不要遗漏**
5. **严格避免功能过程之间的描述雷同，每个功能过程都必须有明显的业务特征差异**`;
    } else {
      // 计算完成进度
      const estimatedTarget = understanding?.totalEstimatedFunctions || 30;
      const progress = Math.round((uniqueCompleted.length / estimatedTarget) * 100);
      const remaining = Math.max(0, estimatedTarget - uniqueCompleted.length);

      userPrompt = `继续分析文档中尚未拆分的功能过程。

## 📊 当前进度
        - 已完成：${uniqueCompleted.length} 个功能过程
          - 预估总数：${estimatedTarget} 个
            - 完成进度：${progress}%
              - 待拆分：约 ${remaining} 个

## 已完成的功能过程列表：
${uniqueCompleted.slice(0, 30).join('、')}${uniqueCompleted.length > 30 ? '...' : ''}

## ⚠️ 重要提示：请拆分文档理解阶段识别出的所有功能！

      在第一阶段文档理解中，我们识别出了约${estimatedTarget} 个功能过程，当前仅完成${uniqueCompleted.length} 个（${progress}%）。
      请根据文档内容，继续拆分尚未处理的功能过程，确保不遗漏任何已识别的功能。

## ⚠️ 极其重要：避免与已完成功能过程雷同！

### 功能过程区分化检查清单：
      在拆分新的功能过程之前，必须确保：
      1. ✅ 功能过程名称与已完成的功能在业务场景上有明显差异
      2. ✅ 子过程描述不能与已完成功能的描述模式雷同
      3. ✅ 数据组名称不能简单复用"请求/响应/表/记录"等通用模式
      4. ✅ 数据属性组合必须体现该功能的独特业务需求

### 高区分度命名规范：
** 功能过程命名公式 **：动词 + 业务状态 / 类型 / 范围 + 具体业务对象 + 操作场景

❌ 禁止泛化命名：
      - "启用XX" → 必须说明启用什么状态的XX，启用后进入什么状态
        - "创建XX" → 必须说明创建什么类型的XX，创建的业务场景是什么
          - "查询XX" → 必须说明查询什么范围的XX，查询的目的是什么
            - "修改XX" → 必须说明修改XX的哪个方面，修改的业务场景是什么

✅ 正确的高区分度命名：
      - "启用已暂停的XX恢复执行" vs "创建新的XX初始化配置" - 明确了不同的业务状态和场景
        - "查询XX实时监控数据列表" vs "查询XX历史统计报表" - 明确了数据的不同维度和用途
          - "修改XX执行中的参数配置" vs "修改XX基础信息档案" - 明确了修改的不同内容和时机

### 子过程描述场景化要求：
      每个功能过程的E / R / W / X四个子过程必须在描述中清晰体现该功能的独特业务场景：

** E（Entry）** - 必须体现输入数据的业务场景特征：
      - ❌ "接收XX请求参数" → ✅ "接收XX[具体业务场景]指令参数集"
        - 例如："接收飞行任务恢复执行指令参数集" vs "接收飞行计划任务新建表单数据"

          ** R（Read）** - 必须体现需要读取什么业务数据、为什么要读取：
      - ❌ "读取XX信息" → ✅ "读取XX[业务目的]所需的[具体数据范围]"
        - 例如："读取飞行任务暂停前的执行进度快照" vs "读取可分配的航线库和无人机资源池"

          ** W（Write）** - 必须体现写入什么业务逻辑、写入的业务意义：
      - ❌ "保存XX记录" → ✅ "更新/保存/记录XX[业务逻辑][业务结果]"
        - 例如："更新飞行任务状态为运行中并记录恢复时间点" vs "保存飞行计划初始配置和资源绑定关系"

          ** X（eXit）** - 必须体现返回什么业务结果、结果的业务价值：
      - ❌ "返回XX结果" → ✅ "返回XX[业务凭证/确认][关键业务信息]"
        - 例如："返回飞行任务恢复执行确认及预计完成时间" vs "返回飞行计划创建凭证和分配的资源清单"

### 数据组和数据属性差异化要求：

** 数据组命名 ** - 必须用业务术语而非技术术语：
      - ❌ "XX请求"、"XX响应"、"XX表"、"XX记录" → 泛化
        - ✅ "XX[业务场景]指令参数集"、"XX[业务结果]确认回执"、"XX[数据性质]快照数据"、"XX[业务逻辑]持久化数据"

          ** 数据属性组合 ** - 必须体现功能的独特业务需求：
      - 不同功能过程的数据属性必须有明显差异，不能只是换个动词
        - 每个功能过程的字段组合应该是该功能特有的，体现该功能的业务逻辑

## 输出格式要求（极其重要）：
** 只输出一个Markdown数据表格，不要输出任何格式说明或解释文字！**

## 子过程完整性要求（必须严格遵守！）：
** 每个功能过程必须有4个子过程：E + R + W + X，缺一不可！**
        - 所有功能：E → R → W → X（4个子过程）
- ** 即使是查询功能，也要有W（记录查询日志）**
- ** 即使是简单操作，也要有R（读取相关数据）**

        正确示例（展示高区分度拆分 - 注意两个功能的高度差异化）：
| 功能用户 | 触发事件 | 功能过程 | 子过程描述 | 数据移动类型 | 数据组 | 数据属性 |
|: ---|: ---|: ---|: ---|: ---|: ---|: ---|
| 用户触发 | 用户请求 | 查询设备实时监控数据列表 | 接收设备实时监控查询筛选条件 | E | 设备实时监控查询筛选参数 | 设备类型筛选、地理位置范围、监控时间段、数据刷新频率 |
|||| 读取设备当前运行状态和实时传感器数据流 | R | 设备实时运行状态数据流 | 设备ID、当前运行模式、实时温度、实时压力、实时速度、数据采集时间戳 |
|||| 记录设备实时监控查询访问日志和筛选条件 | W | 设备监控访问审计日志 | 查询用户ID、查询时间戳、筛选条件详情、查询结果数量、数据加载耗时 |
|||| 返回设备实时监控数据列表和图表可视化配置 | X | 设备实时监控数据可视化响应 | 设备列表、实时数据数组、图表配置参数、数据刷新间隔、告警阈值设置 |
| 用户触发 | 用户请求 | 导出设备历史运行数据报表 | 接收设备历史数据导出任务创建指令 | E | 设备历史数据导出任务参数 | 设备ID列表、历史时间范围、数据维度选择、导出文件格式、报表模板选择 |
|||| 读取设备指定时间段的历史运行记录和统计指标 | R | 设备历史运行数据归档库 | 设备ID、运行日期、日均运行时长、故障次数、维护记录、性能指标统计 |
|||| 生成设备历史数据导出文件并保存导出任务记录 | W | 设备数据导出任务执行记录 | 导出任务ID、导出文件路径、文件大小、导出数据行数、导出开始时间、导出完成时间、导出操作人 |
|||| 返回设备历史数据报表下载链接和文件元信息 | X | 设备数据报表下载凭证 | 导出任务ID、文件下载URL、文件有效期、文件格式、文件大小、数据记录数、生成时间 |

## 核心要求：
      1. ** 每个功能过程必须有E、R、W、X四种类型，缺一不可！**
        2. ** 绝对禁止 ** 只输出E行而没有后续R、W、X行的情况！
      3. ** 功能过程名称只在E行填写 **，后续R / W / X行的功能过程列留空
      4. ** 不能与已完成的功能过程重复或高度相似 **
        5. ** 每个新功能过程都必须在业务场景、描述模式、数据组合上与已有功能有明显差异 **

          请继续拆分尚未处理的功能，** 只输出数据表格 **。
      如果所有功能都已完成，回复"[ALL_DONE]"。`;
    }

    const systemMessage = {
      role: 'system',
      content: COSMIC_SYSTEM_PROMPT
    };

    console.log(`质量优先 - 第 ${round} 轮分析开始，已完成 ${uniqueCompleted.length} 个功能过程...`);

    const completion = await callAIChat({
      messages: [
        systemMessage,
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.5
    });


    const reply = completion.choices[0].message.content;
    console.log(`质量优先 - 第 ${round} 轮完成，响应长度: ${reply.length}`);

    // 改进的完成判断逻辑 - 更保守，避免提前终止
    let isDone = false;

    // 统计已完成的功能过程数量
    const estimatedTarget = understanding?.totalEstimatedFunctions || targetFunctions || 30;

    // 1. 检查回复中是否有有效的表格数据
    const hasValidTable = reply.includes('|') && (reply.includes('|E|') || reply.includes('| E |') || reply.match(/\|[^|]*\|[^|]*\|[^|]*\|[^|]*\|E\|/));

    // 2. 明确的完成标记（必须同时满足：有完成标记 且 达到目标数量）
    const hasCompleteMarker = reply.includes('[ALL_DONE]') ||
      reply.includes('已完成所有') ||
      reply.includes('全部拆分完成') ||
      reply.includes('无需补充');
    const reachedTarget = uniqueCompleted.length >= estimatedTarget;

    if (hasCompleteMarker && reachedTarget) {
      isDone = true;
      console.log(`质量优先 - 检测到完成标记且已达到目标数量: ${uniqueCompleted.length} / ${estimatedTarget}`);
    }

    // 3. 如果回复中没有有效表格且不是第一轮且已达到目标，认为完成
    if (!hasValidTable && round > 1 && reachedTarget) {
      isDone = true;
      console.log(`质量优先 - 无有效表格且已达目标: ${uniqueCompleted.length} / ${estimatedTarget}`);
    }

    // 4. 如果回复内容过短（少于100字符）且不是第一轮且已达到目标
    if (reply.length < 100 && round > 1 && reachedTarget) {
      isDone = true;
      console.log(`质量优先 - 回复过短且已达目标: ${uniqueCompleted.length} / ${estimatedTarget}`);
    }

    // 5. 如果轮次过多（超过10轮），强制停止
    if (round >= 10) {
      isDone = true;
      console.log(`质量优先 - 轮次达到上限(10轮)，当前${uniqueCompleted.length} / ${estimatedTarget}`);
    }

    // 6. 如果还没达到目标数量，不要提前终止
    if (!reachedTarget && hasValidTable) {
      isDone = false;
      console.log(`质量优先 - 继续拆分，当前${uniqueCompleted.length} / ${estimatedTarget}，本轮有新数据`);
    }

    res.json({
      success: true,
      reply: reply,
      round: round,
      isDone: isDone,
      completedFunctions: uniqueCompleted.length,
      targetFunctions: estimatedTarget
    });
  } catch (error) {
    console.error('质量优先分析失败:', error);
    res.status(500).json({ error: '分析失败: ' + error.message });
  }
});

// ========== 质量优先智能拆分 API（三阶段流程，已弃用） ==========
// 先深度理解文档，确保每个功能过程的质量，再逐步扩展数量
const QUALITY_FIRST_SYSTEM_PROMPT = `你是一个顶级COSMIC功能点分析专家。你的任务是深度理解需求文档，识别并拆分高质量的功能过程，超越传统的CRUD思维，实现"立体化"建模。

## 1. 核心原则：质量与维度
- ** 立体建模 **：不仅关注核心业务流程（流程轴），还要挖掘隐藏的管理底座（审计、日志、权限、字典匹配）。
- ** ERWX 原子化 **：每一个过程必须符合【门卫Entry、大脑Read、执行Write、反馈Exit】的职责划分。
- ** 颗粒度拆解 **：对于大型接口，将其切片为支撑细粒度字段的功能过程。

## 2. COSMIC数据移动类型(ERWX 模型)
- ** E(Entry / 门卫) **: 跨越边界，解析协议头，校验身份，接收指令参数集。
- ** R(Read / 大脑) **: 检索业务字典，查阅历史状态，对齐配置规则。
- ** W(Write / 执行) **: 原子化写入业务表，持久化事务流水，记录审计日志。
- ** X(eXit / 反馈) **: 封装响应协议体，映射多级动作回显，记录接口耗时。

## 3. 功能点识别与查重
- ** 命名公式 **：[核心对象] + [深度动作] + [流水状态]。
- ** 互斥去重 **：不同功能的子过程描述和字段组合必须具备物理层面的显著差异，严禁雷同。

  请严格按照提供的Markdown表格格式输出。`;

// 质量优先分析 - 第一阶段：深度理解文档（增强版 - 确保功能点完整覆盖）
app.post('/api/quality-analyze/understand', async (req, res) => {
  try {
    const { documentContent, imageDescriptions = [], userGuidelines = '', userConfig = null } = req.body;

    console.log('质量优先分析 - 第一阶段：深度理解文档（增强版）...', userGuidelines ? `用户指导：${userGuidelines}` : '');


    // 构建图片描述上下文
    let imageContext = '';
    if (imageDescriptions && imageDescriptions.length > 0) {
      imageContext = `\n\n文档中的图片 / 界面截图描述：\n${imageDescriptions.map((desc, i) => `图${i + 1}: ${desc}`).join('\n')}\n\n ** 请特别注意：图片中展示的界面元素、按钮、菜单、表格等都可能代表独立的功能点，必须识别并包含在功能列表中！**\n`;
    }

    // 构建用户指导指导上下文
    let guidelinesContext = '';
    if (userGuidelines) {
      guidelinesContext = `\n\n## 用户特定的拆分要求（请务必严格遵守）：\n**${userGuidelines}**\n`;
    }

    const understandPrompt = `你是一个顶级业务架构师与COSMIC分析专家。请对以下需求文档进行"立体化"深度分析，运用Gemini四阶段方法论中的第一阶段（文档解耦）和第二阶段（过程膨胀）。
${guidelinesContext}
${documentContent}
${imageContext}

# ═══════════════════════════════════════════════════════════
# 第一阶段：文档解耦（Document Decoupling）
# ═══════════════════════════════════════════════════════════

## 任务1：识别边界交互者（功能用户）
无视业务逻辑，只找「边界交互者」：
- **用户触发**：人工操作、界面点击、手动输入的功能
- **时钟触发**：定时任务、周期执行、自动调度的功能
- **接口触发**：外部系统调用、API推送、消息队列的功能

## 任务2：提取数据对象（Object of Interest）
找出文档中所有具有独立状态或属性集合的名词实体：
- 业务实体：工单、用户、设备、任务、订单、配置项等
- 为每个实体建立**字段池**，包含该实体的所有可能属性

## 任务3：识别触发事件
为每个功能确定其启动开关：点击按钮、调用接口、定时器到期、消息到达等

# ═══════════════════════════════════════════════════════════
# 第二阶段：过程膨胀与维度扩展（Process Expansion）
# ═══════════════════════════════════════════════════════════

## 3D轴向分析框架

### 纵向（流程轴）- 生命周期全路径拆解
对每个功能推导其完整生命周期，不要只看"执行"：
1. **预审准入**：参数校验、身份鉴权、格式验证、前置条件检查
2. **主体执行**：核心数据处理、业务逻辑运算、状态转换
3. **异步反馈**：结果通知、回调同步、消息推送、事件发布
4. **审计追踪**：操作日志、快照备份、版本记录

### 横向（管理轴）- 专项管理维度拆解
1. **归因维度**：追溯来源、记录路径
2. **资产维度**：变更状态、锁定资源
3. **效能维度**：指标采集、数据汇总
4. **合规维度**：操作审计、数据脱敏

## 请输出以下JSON格式的分析报告（严禁输出任何多余文字）：
{
  "projectName": "项目名称",
  "projectDescription": "项目核心目标简述",
  "systemArchitecture": "系统类型（如：微服务、单体、嵌入式）",
  "systemBoundary": "系统的外部边界说明",
  "userRoles": ["角色1", "角色2"],
  "dataEntities": ["实体1", "实体2"],
  "externalInterfaces": ["外部接口1", "外部接口2"],
  "functionBreakdown": {
     "userTriggeredFunctions": 0,
     "timerTriggeredFunctions": 0,
     "interfaceTriggeredFunctions": 0
  },
  "coreModules": [
    {
      "moduleName": "模块名称",
      "estimatedFunctions": [
        {
            }
          ]
        }
      ],
        "timedTasks": [
          {
            "taskName": "定时任务名称",
            "schedule": "执行频率",
            "description": "任务描述"
          }
        ],
          "crossModuleFunctions": [
            {
              "functionName": "跨模块功能名称",
              "triggerType": "触发类型",
              "relatedModules": ["模块1", "模块2"]
            }
          ],
            "functionBreakdown": {
        "userTriggeredFunctions": 0,
          "timerTriggeredFunctions": 0,
            "interfaceTriggeredFunctions": 0
      },
      "totalEstimatedFunctions": 30
    }

** 关键要求 **：
    1. fieldPool必须全面，包含文档中所有可能的字段
    2. 每个功能必须指定anchorField（锚定字段）
    3. suggestedAttributes要体现字段组合的互斥性
    4. 功能名称必须符合Object + Action + State格式
    5. 必须区分三种触发类型，并统计数量`;

    const completion = await callAIChat({
      messages: [
        { role: 'system', content: '你是一个需求分析专家，擅长从需求文档中提取结构化信息。请只输出JSON格式，不要有其他文字。' },
        { role: 'user', content: understandPrompt }
      ],
      temperature: 0.3,
      max_tokens: 4000,
      userConfig
    });


    let analysisResult;
    try {
      const content = completion.choices[0].message.content;
      // 提取JSON部分
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        analysisResult = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('未找到JSON格式');
      }
    } catch (e) {
      console.error('解析理解结果失败:', e);
      analysisResult = {
        projectName: '未知项目',
        projectDescription: '文档分析中',
        systemBoundary: '待确定',
        userRoles: ['用户'],
        coreModules: [{ moduleName: '核心模块', moduleDescription: '主要功能', estimatedFunctions: [] }],
        dataEntities: [],
        externalInterfaces: [],
        totalEstimatedFunctions: 30
      };
    }

    console.log('文档理解完成:', analysisResult.projectName, '预估功能数:', analysisResult.totalEstimatedFunctions);

    res.json({
      success: true,
      understanding: analysisResult,
      message: `已深度理解文档，识别到 ${analysisResult.coreModules?.length || 0} 个核心模块，预估 ${analysisResult.totalEstimatedFunctions || 30} 个功能过程`
    });
  } catch (error) {
    console.error('文档理解失败:', error);
    res.status(500).json({ error: '文档理解失败: ' + error.message });
  }
});

// 质量优先分析 - 第二阶段：按模块逐步拆分
app.post('/api/quality-analyze/split', async (req, res) => {
  try {
    const { documentContent, understanding, moduleIndex = 0, previousResults = [] } = req.body;

    const modules = understanding?.coreModules || [];

    if (moduleIndex >= modules.length) {
      return res.json({
        success: true,
        isDone: true,
        message: '所有模块已分析完成'
      });
    }

    const currentModule = modules[moduleIndex];
    console.log(`质量优先分析 - 第二阶段：拆分模块 ${moduleIndex + 1}/${modules.length}: ${currentModule.moduleName}`);

    // 构建已完成的功能过程列表
    const completedFunctions = previousResults.map(r => r.functionalProcess).filter(Boolean);
    const uniqueCompleted = [...new Set(completedFunctions)];

    const splitPrompt = `基于以下需求文档，对"${currentModule.moduleName}"模块进行COSMIC功能过程拆分。

## 文档内容
${documentContent}

## 当前模块信息
- 模块名称：${currentModule.moduleName}
- 模块描述：${currentModule.moduleDescription}
- 预期功能：${currentModule.estimatedFunctions?.join('、') || '待识别'}

## 项目背景
- 项目名称：${understanding.projectName}
- 用户角色：${understanding.userRoles?.join('、') || '用户'}
- 数据实体：${understanding.dataEntities?.join('、') || '待识别'}

${uniqueCompleted.length > 0 ? `## 已完成的功能过程（请勿重复）\n${uniqueCompleted.join('、')}` : ''}

## 输出要求
1. 只拆分"${currentModule.moduleName}"模块相关的功能过程
2. 每个功能过程必须完整（E→R/W→X）
3. 功能过程名称必须唯一且具体
4. 数据组和数据属性必须与业务场景相关

请输出Markdown表格格式：

|功能用户|触发事件|功能过程|子过程描述|数据移动类型|数据组|数据属性|`;

    const completion = await callAIChat({
      messages: [
        { role: 'system', content: QUALITY_FIRST_SYSTEM_PROMPT },
        { role: 'user', content: splitPrompt }
      ],
      temperature: 0.5,
      userConfig
    });


    const reply = completion.choices[0].message.content;
    console.log(`模块 ${currentModule.moduleName} 拆分完成，响应长度: ${reply.length}`);

    res.json({
      success: true,
      reply: reply,
      moduleIndex: moduleIndex,
      moduleName: currentModule.moduleName,
      totalModules: modules.length,
      isDone: moduleIndex >= modules.length - 1,
      message: `模块 ${moduleIndex + 1}/${modules.length} "${currentModule.moduleName}" 拆分完成`
    });
  } catch (error) {
    console.error('模块拆分失败:', error);
    res.status(500).json({ error: '模块拆分失败: ' + error.message });
  }
});

// 质量优先分析 - 第三阶段：质量审查与补充
app.post('/api/quality-analyze/review', async (req, res) => {
  try {
    const { documentContent, understanding, tableData } = req.body;

    console.log('质量优先分析 - 第三阶段：质量审查...');


    // 统计当前功能过程
    const uniqueFunctions = [...new Set(tableData.map(r => r.functionalProcess).filter(Boolean))];
    const expectedCount = understanding?.totalEstimatedFunctions || 30;

    const reviewPrompt = `请审查以下COSMIC拆分结果，并补充遗漏的功能过程。

## 原始文档
${documentContent.substring(0, 3000)}${documentContent.length > 3000 ? '...(文档已截断)' : ''}

## 项目信息
- 项目名称：${understanding?.projectName || '未知'}
- 预估功能数：${expectedCount}
- 当前已拆分：${uniqueFunctions.length} 个功能过程

## 已拆分的功能过程
${uniqueFunctions.join('、')}

## 审查任务
1. 检查是否有遗漏的重要功能过程
2. 如果当前数量(${uniqueFunctions.length})明显少于预估(${expectedCount})，请补充遗漏的功能
3. 补充的功能过程必须是文档中明确描述或合理推断的

${uniqueFunctions.length < expectedCount * 0.7 ? `
## 需要补充
当前功能过程数量偏少，请从以下角度补充：
- 查询类功能（列表查询、详情查询、条件搜索）
- 管理类功能（新增、修改、删除、审批）
- 统计类功能（数据统计、报表生成、趋势分析）
- 导入导出功能
- 系统配置功能
` : ''}

请输出需要补充的功能过程（Markdown表格格式），如果无需补充请回复"[REVIEW_DONE]"。`;

    const completion = await callAIChat({
      messages: [
        { role: 'system', content: QUALITY_FIRST_SYSTEM_PROMPT },
        { role: 'user', content: reviewPrompt }
      ],
      temperature: 0.5
    });


    const reply = completion.choices[0].message.content;
    const isDone = reply.includes('[REVIEW_DONE]') || reply.includes('无需补充') || reply.includes('已完整');

    console.log('质量审查完成，是否需要补充:', !isDone);

    res.json({
      success: true,
      reply: reply,
      isDone: isDone,
      currentCount: uniqueFunctions.length,
      expectedCount: expectedCount,
      message: isDone ? '质量审查通过，无需补充' : '发现遗漏功能，正在补充'
    });
  } catch (error) {
    console.error('质量审查失败:', error);
    res.status(500).json({ error: '质量审查失败: ' + error.message });
  }
});

// ========== 三层分析框架模式 API ==========
app.post('/api/three-layer-analyze', (req, res) => {
  threeLayerAnalyze(req, res, getOpenAIClient);
});

// ========== 两阶段动态驱动分析 API ==========
// 阶段1：提取功能清单（让用户确认、修改、补充）
app.post('/api/extract-function-list', (req, res) => {
  extractFunctionList(req, res);
});

// 阶段2：基于确认的功能清单进行ERWX拆分
app.post('/api/split-from-function-list', (req, res) => {
  splitFromFunctionList(req, res);
});

// ========== 两步骤COSMIC拆分模式 API ==========
// 步骤1：功能过程识别（从需求文档中提取功能过程）
app.post('/api/two-step/extract-functions', async (req, res) => {
  try {
    const { documentContent, userConfig = null } = req.body;

    // 调试日志
    console.log('\n' + '='.repeat(60));
    console.log('📋 两步骤COSMIC拆分 - 第一步：功能过程识别');
    console.log('文档长度:', documentContent?.length || 0);
    console.log('🔑 userConfig 接收情况:', userConfig ? {
      hasApiKey: !!userConfig.apiKey,
      apiKeyPrefix: userConfig.apiKey ? userConfig.apiKey.substring(0, 10) + '...' : 'null',
      baseUrl: userConfig.baseUrl,
      model: userConfig.model,
      provider: userConfig.provider
    } : 'null (未传递)');
    console.log('='.repeat(60));

    if (!documentContent || !documentContent.trim()) {
      return res.status(400).json({ error: '请提供需求文档内容' });
    }

    const clientConfig = getActiveClientConfig(userConfig);
    if (!clientConfig) {
      console.log('❌ 无法获取客户端配置，userConfig 和环境变量均未设置');
      return res.status(400).json({ error: '请先配置API密钥' });
    }

    console.log('✅ 客户端配置成功:', {
      provider: clientConfig.provider,
      model: clientConfig.model,
      useGeminiSDK: clientConfig.useGeminiSDK
    });

    const { client, model, useGeminiSDK } = clientConfig;

    // 构建完整提示词，强调深度思考和严格遵守格式
    const prompt = `# 【深度思考模式】功能过程识别

请在正式输出之前，先进行深度思考和分析。务必仔细阅读需求文档的每一个细节！

## 深度思考任务
1. **通读全文**：仔细阅读整个需求文档，理解业务背景 and 功能目标
2. **识别功能边界**：明确哪些是独立的功能过程，哪些是子过程
3. **分类触发类型**：每个功能属于用户触发、时钟触发还是接口触发
4. **检查完整性**：确保所有查询、导出、新增、修改、删除等操作都被识别
5. **验证格式**：确保输出严格符合markdown格式要求

---

## 【极重要】功能界面说明深度解析

需求文档中如果包含"功能界面说明"、"界面功能"、"功能说明"等内容，必须逐条深度解析：

### 必须识别的关键词和对应功能
| 文档中的描述 | 必须识别为 | 功能过程命名示例 |
|---|---|---|
| "支持查询（条件1、条件2...）" | 独立的查询功能 | 查询xxx统计数据 |
| "支持导出" | 独立的导出功能 | 导出xxx数据 |
| "点击xxx，跳转至xxx" | 独立的跳转查询功能 | 查询xxx详情 |
| "点击xxx查看详情" | 独立的查看功能 | 查看xxx详情 |
| "支持自定义查询" | 独立的自定义查询功能 | 自定义条件查询xxx |
| "重制后可以按需查询" | 独立的查询功能 | 按条件查询xxx |

### 解析示例
假设文档中写了：
\`\`\`
功能界面说明
1、支持查询（日期、地市、区县、场景名称、健康度总分）
2、支持导出
3、点击质差小区数，跳转至质差详情表-日
4、点击健康度总分，跳转至健康度评估详情
\`\`\`

则必须识别出4个独立的功能过程：
1. **查询健康度统计数据**（用户触发）
2. **导出健康度统计数据**（用户触发）
3. **查询质差小区详情**（用户触发）
4. **查询健康度评估详情**（用户触发）

**绝对禁止将多个操作合并为一个功能过程！**

---

## 必须遵守的规则
- 功能过程命名：必须始终包含具体的业务对象（如"查询低空保障任务配置"）
- 触发类型只有3种：用户触发、时钟触发、接口调用触发
- 定时任务的功能过程必须以"定时"开头
- 接口触发的功能过程建议写"同步xxx数据"
- 不能写模板导出类功能、不能写模型、页面等关键字

## 【极重要：业务对象具体化原则】

你必须严格遵守以下命名规则，严禁生成笼统的功能过程：
- ✅ **必须包含**：业务领域 + 具体对象 + 动作（如：查询 **低空保障** **任务** **配置信息**）
- ❌ **严禁使用**：动词 + 通用名词（如：查询任务、导出结果、新增记录）
- 涉及厂商时，必须带上厂商名称（华为/中兴/爱立信）

---

${STEP1_FUNCTION_EXTRACTION_PROMPT}

---

## 需求文档内容
\`\`\`
${documentContent}
\`\`\`

---

## 输出要求
请严格按照以下markdown格式输出，确保识别出所有细化的功能操作（查询、导出、详情查看、新增、修改、删除）：

\`\`\`markdown
#功能模块名称
##功能用户
发起者：xxx 接收者：xxx
##触发事件
用户触发/时钟触发/接口调用触发
##功能过程
[领域/场景][具体业务对象][操作名称]（例：查询低空保障任务配置信息）
##功能过程子过程详细描述
详细描述业务逻辑：接收xxx请求 -> 读取xxx配置/数据 -> 执行xxx逻辑 -> 返回xxx结果
\`\`\`

重复上述格式，直到所有功能过程都已输出。不要输出任何解释性文字或示例表格。 现在请开始深度分析文档。`;

    let reply = '';

    if (useGeminiSDK) {
      const result = await client.generateContent(prompt);
      const response = await result.response;
      reply = response.text();
    } else {
      const completion = await client.chat.completions.create({
        model,
        messages: [
          {
            role: 'system',
            content: '你是一位资深的COSMIC功能分析专家。请认真阅读提示词中的所有规则，进行深度思考后严格按照格式要求输出。'
          },
          { role: 'user', content: prompt }
        ],
        temperature: 0.5,  // 降低temperature提高规范性
        max_tokens: 8000
      });
      reply = completion.choices[0].message.content;
    }

    console.log('✅ 功能过程识别完成');
    console.log('结果长度:', reply.length);

    res.json({
      success: true,
      functionProcessList: reply,
      message: '功能过程识别完成'
    });

  } catch (error) {
    console.error('功能过程识别失败:', error);
    res.status(500).json({ error: '识别失败: ' + error.message });
  }
});

// 步骤2：COSMIC拆分（将功能过程列表拆分为COSMIC表格）
app.post('/api/two-step/cosmic-split', async (req, res) => {
  try {
    const { functionProcessList, userConfig = null } = req.body;

    if (!functionProcessList || !functionProcessList.trim()) {
      return res.status(400).json({ error: '请提供功能过程列表' });
    }

    const clientConfig = getActiveClientConfig(userConfig);
    if (!clientConfig) {
      return res.status(400).json({ error: '请先配置API密钥' });
    }

    console.log('\n' + '='.repeat(60));
    console.log('🔧 两步骤COSMIC拆分 - 第二步：COSMIC拆分');
    console.log('功能过程列表长度:', functionProcessList.length);
    console.log('='.repeat(60));

    // 【调试】预解析功能过程列表，统计识别到的功能过程数量
    const functionProcessMatches = functionProcessList.match(/##功能过程\n([^\n#]+)/g) || [];
    const extractedFunctions = functionProcessMatches.map(m => m.replace('##功能过程\n', '').trim());
    console.log(`📋 预解析识别到 ${extractedFunctions.length} 个功能过程:`);
    extractedFunctions.forEach((fn, idx) => console.log(`   ${idx + 1}. ${fn}`));

    // 输出功能过程列表的前500个字符（调试用）
    console.log('📄 功能过程列表前500字符:');
    console.log(functionProcessList.substring(0, 500));
    console.log('...(省略)...');

    const { client, model, useGeminiSDK } = clientConfig;

    // 强化提示词，添加深度思考模式和严格格式约束
    const enhancedPrompt = `# 【深度思考模式】COSMIC功能拆分

请在正式输出之前，进行深度思考和分析。这是COSMIC功能点拆分的第二步，需要严格按照COSMIC方法论进行拆分。

## 深度思考任务
1. **理解功能过程**：仔细分析每个功能过程的业务目标和数据流
2. **识别数据移动**：确定每个功能过程的E(入口)→R(读取)→W(写入)→X(出口)链路
3. **选择合适的数据组**：根据业务对象确定每个子过程操作的数据集合
4. **生成数据属性**：从业务角度思考每个数据组需要的具体字段

---

${STEP2_COSMIC_SPLIT_PROMPT}

---

## 【极重要】子过程描述业务化规范（必须严格遵守！）

### 核心原则：子过程描述必须包含功能过程的业务关键词
- **每个子过程描述在整个表格中必须唯一，不能重复！**
- **必须将功能过程的业务关键词融入子过程描述中**
- **禁止使用过于简单的通用描述**

### 子过程描述命名公式
- E类型：接收 + [业务对象] + [操作类型] + 请求
- R类型：读取 + [业务对象] + [数据类型] + 数据/配置
- W类型：记录 + [业务对象] + [操作类型] + 日志/结果
- X类型：返回 + [业务对象] + [操作类型] + 结果

### 正确示例（请模仿这种格式）
假设功能过程是"查询华为小区质差数据"：
| 数据移动类型 | 子过程描述示例 |
|---|---|
| E | 接收华为小区质差查询请求 |
| R | 读取华为小区质差配置规则 |
| W | 记录华为小区质差查询日志 |
| X | 返回华为小区质差查询结果 |

假设功能过程是"导出中兴小区指标报表"：
| 数据移动类型 | 子过程描述示例 |
|---|---|
| E | 接收中兴小区指标导出请求 |
| R | 读取中兴小区指标数据表 |
| W | 生成中兴小区指标导出文件 |
| X | 返回中兴小区指标导出结果 |

### 错误示例（禁止这样写）
- ❌ "接收请求参数" （太简单，没有业务关键词）
- ❌ "读取数据" （太简单，没有业务关键词）
- ❌ "写入结果" （太简单，没有业务关键词）
- ❌ "返回结果" （太简单，没有业务关键词）
- ❌ "从中兴小区级智网指标-日报析数据中读取数据" （太长）

---

## 【极重要】数据属性唯一性规范（必须严格遵守！）

### 重合度检测机制
**系统将自动检测数据属性的重合度（阈值15%），即使只有15%的字段重复也会触发差异化处理！**
- 重合度 = 重叠字段数 / 较小集合的大小
- 示例：[小区标识、小区名称、统计时间] vs [小区标识、质差等级、判定时间] → 重合度 = 1/3 = 33% > 15% → **触发去重！**
- **因此，你必须在生成时就确保每个功能过程的数据属性高度差异化！**

### 禁止生硬去重
**严禁使用以下方式强行去重**：
- ❌ 添加无意义后缀："小区标识1"、"小区标识2"
- ❌ 添加校验码后缀："xxx校验码123"、"xxx校验码456"
- ❌ 添加随机编号："数据编号A"、"数据编号B"

### 正确做法：基于业务差异化
- ✅ 根据功能过程的业务关键词生成差异化字段
- ✅ 不同数据移动类型使用不同粒度的字段：
  - E（入口）：请求标识、操作流水、会话追踪、业务优先级
  - R（读取）：数据版本、源标识、时效性标签、关联实体数
  - W（写入）：事务码、记录ID、写入分区号、变更轨迹ID
  - X（出口）：响应序列、处理回执、分页游标、刷新凭证

### 数据属性格式规范
1. **分隔符**：必须使用中文顿号"、"分隔，禁止使用逗号","
2. **语言**：必须使用中文，禁止使用英文字段名如cell_id
3. **数量**：至少3个属性，最多8个属性
4. **示例**：华为小区标识、质差门限值、统计日期、计算结果、状态标识

### 差异化策略（极重要！）
**为了确保数据属性重合度小于15%，你必须采用以下策略**：
1. **业务关键词前缀化**：将功能过程的关键词融入每个字段
   - 功能："查询华为小区质差数据" → 字段：华为质差请求标识、华为小区质差门限、华为质差判定规则
2. **ERWX类型特定字段**：根据数据移动类型选择完全不同的字段集
   - E使用：请求类字段（请求标识、操作流水、会话追踪）
   - R使用：配置类字段（数据版本、源标识、时效性标签）
   - W使用：记录类字段（事务码、记录ID、变更轨迹ID）
   - X使用：响应类字段（响应序列、处理回执、分页游标）
3. **维度字段补充**：添加厂商、业务、网络、时间、地域等维度字段
   - 厂商：华为厂商标识、中兴厂商标识
   - 网络：4G网络类型、5G网络类型
   - 时间：小时粒度、日粒度、周粒度

---

## 输入内容（功能过程列表）
\`\`\`
${functionProcessList}
\`\`\`

---

## 【极重要】功能过程唯一性要求

**输入的功能过程列表中包含多个不同的功能，你必须为每个功能保持其原有的功能过程名称！**

- ✅ 正确做法：如果输入列表有"查询小区数据"、"导出指标报表"、"新增配置规则"三个功能，输出中也应该有这三个不同的功能过程
- ❌ 错误做法：把所有功能都拆成同一个功能过程名称（如全部叫"查询小区数据"）

**必须严格遵守**：
1. 输入列表有N个不同的功能过程，输出表格中就应该有N个不同的功能过程
2. 每个功能过程名称必须与输入列表中的对应功能一致
3. 不要合并不同的功能，不要重复相同的功能过程名称

---

## 输出格式（必须严格按照此格式输出）

**示例1**：如果输入包含"查询华为小区质差数据"这个功能

\`\`\`markdown
|功能用户|触发事件|功能过程|子过程描述|数据移动类型|数据组|数据属性|
|:---|:---|:---|:---|:---|:---|:---|
|发起者：用户 接收者：用户|用户触发|查询华为小区质差数据|接收华为小区质差查询请求|E|华为小区质差查询请求|华为质差请求标识、查询条件、时间范围、用户标识|
||||读取华为小区质差配置规则|R|华为小区质差配置表|华为小区标识、质差门限值、判定规则、配置版本|
||||记录华为小区质差查询日志|W|华为小区质差查询日志|查询日志ID、操作时间、查询耗时、结果数量|
||||返回华为小区质差查询结果|X|华为小区质差查询结果|质差数据列表、统计汇总、响应状态码、处理时间|
\`\`\`

**示例2**：如果输入包含"导出中兴小区指标报表"这个功能

\`\`\`markdown
|功能用户|触发事件|功能过程|子过程描述|数据移动类型|数据组|数据属性|
|:---|:---|:---|:---|:---|:---|:---|
|发起者：用户 接收者：用户|用户触发|导出中兴小区指标报表|接收中兴小区指标导出请求|E|中兴小区指标导出请求|中兴指标导出标识、导出范围、文件格式|
||||读取中兴小区指标数据表|R|中兴小区指标数据表|中兴小区标识、指标名称、指标值、统计时间|
||||生成中兴小区指标导出文件|W|中兴小区指标导出文件|导出文件路径、文件大小、生成时间|
||||返回中兴小区指标导出结果|X|中兴小区指标导出响应|导出文件链接、导出状态、完成时间|
\`\`\`

**注意**：以上只是示例格式，实际输出时必须根据输入的功能过程列表生成对应的表格，每个功能一个独立的ERWX流程！

现在请开始深度分析并输出COSMIC拆分表格。**记住：输入有多少个不同的功能过程，输出就应该有多少个不同的功能过程！**`;

    let reply = '';

    if (useGeminiSDK) {
      const result = await client.generateContent(enhancedPrompt);
      const response = await result.response;
      reply = response.text();
    } else {
      const completion = await client.chat.completions.create({
        model,
        messages: [{ role: 'user', content: enhancedPrompt }],
        temperature: 0.5,  // 降低temperature提高格式规范性
        max_tokens: 16000
      });
      reply = completion.choices[0].message.content;
    }

    console.log('✅ COSMIC拆分完成');
    console.log('结果长度:', reply.length);

    // ========== 完整的表格解析逻辑（与主流程一致） ==========
    let tableData = [];

    // 清理文本的辅助函数
    const sanitizeText = (text) => {
      if (!text) return text;
      return String(text)
        .replace(/【[^】]*】/g, '')
        .replace(/\[[^\]]*\]/g, '')
        .replace(/\(\d+\)/g, '')
        .replace(/（\d+）/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    };

    // ========== 【新增】子过程描述格式验证函数 ==========
    // 检测子过程描述是否看起来像数据属性列表（格式错误）
    const isInvalidSubProcessDesc = (desc) => {
      if (!desc) return true;

      // 1. 检测是否包含多个顿号分隔的词（数据属性的典型特征）
      const commaCount = (desc.match(/[、,，]/g) || []).length;
      if (commaCount >= 2) {
        console.log(`⚠️ 检测到子过程描述包含${commaCount}个分隔符，疑似数据属性格式: "${desc}"`);
        return true;
      }

      // 2. 检测是否以典型的数据属性字段名开头或结尾
      const attrPatterns = [
        /^(任务|地市|区县|状态|时间|编号|类型|名称|标识|参数|配置)[名称类型编号标识ID]*/,
        /(名称|类型|编号|标识|ID|时间|状态)$/,
      ];
      const words = desc.split(/[、,，]/).map(w => w.trim()).filter(w => w);
      if (words.length >= 2) {
        const allLookLikeAttrs = words.every(word => {
          return word.length <= 6 && !word.match(/^(接收|读取|获取|查询|写入|保存|更新|删除|返回|输出|生成|记录|处理)/);
        });
        if (allLookLikeAttrs) {
          console.log(`⚠️ 所有词都像数据属性字段: "${desc}"`);
          return true;
        }
      }

      // 3. 检查是否包含有效的动词开头
      const validVerbs = ['接收', '读取', '获取', '查询', '写入', '保存', '更新', '删除', '返回', '输出', '生成', '记录', '处理', '触发', '调用', '呈现', '展示', '验证', '校验'];
      const hasValidVerb = validVerbs.some(verb => desc.includes(verb));

      // 如果没有有效动词，且长度较短，可能是错误格式
      if (!hasValidVerb && desc.length > 5 && commaCount >= 1) {
        console.log(`⚠️ 子过程描述缺少有效动词且包含分隔符: "${desc}"`);
        return true;
      }

      return false;
    };

    // ========== 【新增】根据上下文重新生成子过程描述 ==========
    // 当检测到格式错误时，根据功能过程名称和数据移动类型自动生成正确的描述
    const regenerateSubProcessDesc = (invalidDesc, functionalProcess, dataMovementType) => {
      // 提取功能过程中的关键业务词
      const extractBusinessKeyword = (process) => {
        if (!process) return '业务';

        // 移除动词，提取核心业务对象
        const cleanedProcess = process
          .replace(/^(查询|创建|删除|修改|编辑|导出|导入|统计|配置|处理|执行|启用|禁用|新增|更新|保存|读取|获取)/g, '')
          .trim();

        if (cleanedProcess.length >= 2) {
          return cleanedProcess.slice(0, 8); // 取前8个字作为业务关键词
        }
        return process.slice(0, 6) || '业务';
      };

      const businessKeyword = extractBusinessKeyword(functionalProcess);
      const moveType = (dataMovementType || '').toUpperCase();

      // 根据数据移动类型生成标准格式的子过程描述
      switch (moveType) {
        case 'E':
          return `接收${businessKeyword}请求`;
        case 'R':
          return `读取${businessKeyword}数据`;
        case 'W':
          return `记录${businessKeyword}结果`;
        case 'X':
          return `返回${businessKeyword}响应`;
        default:
          return `处理${businessKeyword}数据`;
      }
    };

    // ========== 增强版：智能简化子过程描述（不超过15个字）==========
    // 核心思路：从冗长描述中提取核心业务关键词，而非简单截断
    const simplifySubProcessDesc = (desc) => {
      if (!desc) return desc;

      // 第一步：移除常见的冗余前缀和后缀
      let cleaned = desc
        .replace(/请求[-·：:]/g, '')  // 移除 "请求-"、"请求·" 等
        .replace(/[-·：:]请求/g, '请求')  // 保留末尾的"请求"
        .replace(/输入[^\u4e00-\u9fa5]*/g, '')  // 移除 "输入xxx"
        .replace(/从.*?中(?=读取|获取|查询)/g, '')  // 移除 "从xxx中"
        .replace(/向.*?(?=写入|保存|更新)/g, '')  // 移除 "向xxx"
        .replace(/低空保障参数自动化/g, '低空保障')  // 缩短特定长词
        .replace(/任务运行日志操作/g, '任务日志')  // 缩短特定长词
        .replace(/自动化任务/g, '任务')  // 缩短
        .replace(/配置表/g, '配置')  // 缩短
        .replace(/派单任务管理表/g, '派单管理')  // 缩短
        .trim();

      // 如果清理后已经足够短，直接返回
      if (cleaned.length <= 15) return cleaned;

      // 第二步：提取关键动词
      const actionVerbs = ['接收', '读取', '获取', '查询', '写入', '保存', '更新', '删除', '返回', '呈现', '输出', '生成', '触发', '调用', '记录', '处理'];
      let action = '';
      for (const verb of actionVerbs) {
        if (cleaned.includes(verb)) {
          action = verb;
          break;
        }
      }

      // 第三步：智能提取核心业务对象（2-8个字）
      if (action) {
        const idx = cleaned.indexOf(action);
        const afterAction = cleaned.slice(idx + action.length);

        // 尝试提取结构化的业务对象
        // 优先匹配模式：核心名词（2-6字）+ 可选后缀（数据/结果/信息/请求/响应）
        const patterns = [
          /([\u4e00-\u9fa5]{2,6})(数据|结果|信息|请求|响应|日志|配置|任务|记录)/,
          /([\u4e00-\u9fa5]{2,8})/
        ];

        for (const pattern of patterns) {
          const match = afterAction.match(pattern);
          if (match) {
            let core = match[1];
            let suffix = match[2] || '';

            // 如果核心词太长，尝试进一步精简
            if (core.length > 6) {
              // 提取最后4-6个有意义的字作为核心
              core = core.slice(-6);
            }

            const result = action + core + suffix;
            return result.slice(0, 15);
          }
        }
      }

      // 第四步：兜底 - 智能截断，保留开头动词和结尾名词
      // 检测开头的动词
      let prefix = '';
      for (const verb of actionVerbs) {
        if (cleaned.startsWith(verb)) {
          prefix = verb;
          break;
        }
      }

      // 检测结尾的名词
      const suffixes = ['数据', '结果', '信息', '请求', '响应', '日志', '配置', '任务', '记录', '表'];
      let suffixWord = '';
      for (const suf of suffixes) {
        if (cleaned.endsWith(suf)) {
          suffixWord = suf;
          break;
        }
      }

      if (prefix && suffixWord) {
        // 提取中间的核心内容
        const middle = cleaned.slice(prefix.length, cleaned.length - suffixWord.length);
        // 取中间内容的后6个字（通常更有业务含义）
        const coreMiddle = middle.length > 6 ? middle.slice(-6) : middle;
        return (prefix + coreMiddle + suffixWord).slice(0, 15);
      }

      // 最终兜底：直接截断
      return cleaned.slice(0, 15);
    };

    // 清洗数据属性（英文转中文、格式规范化）
    const cleanDataAttributes = (attrs) => {
      if (!attrs) return attrs;

      // 常见英文字段名到中文的映射表
      const fieldMapping = {
        'cell_id': '小区标识', 'task_id': '任务编号', 'user_id': '用户编号',
        'create_time': '创建时间', 'update_time': '更新时间', 'start_time': '开始时间',
        'end_time': '结束时间', 'status': '状态', 'name': '名称', 'type': '类型'
      };

      let cleaned = attrs;
      for (const [eng, chn] of Object.entries(fieldMapping)) {
        const regex = new RegExp(`\\b${eng}\\b`, 'gi');
        cleaned = cleaned.replace(regex, chn);
      }

      // 将英文逗号替换为中文顿号
      cleaned = cleaned.replace(/,\s*/g, '、');
      cleaned = cleaned.replace(/、+/g, '、');
      cleaned = cleaned.replace(/^、|、$/g, '');

      // 截断过长的属性列表（最多8个）
      const fields = cleaned.split('、').map(f => f.trim()).filter(f => f);
      if (fields.length > 8) {
        cleaned = fields.slice(0, 8).join('、');
      }

      return cleaned;
    };

    // 智能归一化触发类型
    const normalizeUserTrigger = (userVal = '', triggerVal = '', functionalProcess = '') => {
      const user = (userVal || '').trim();
      const trigger = (triggerVal || '').trim();
      const process = (functionalProcess || '').trim();

      // 时钟触发模式
      if (/定时|周期|每天|每小时|自动汇总|自动同步|定期|批量推送|定时推送/.test(process) ||
        /时钟|定时/.test(user) || /定时|周期/.test(trigger)) {
        return { user: '发起者：定时触发器 接收者：网优平台', trigger: '时钟触发' };
      }

      // 接口触发模式
      if (/接收.*推送|接收.*通知|接收.*回调|Webhook|回调处理|外部.*推送|消息队列|事件监听/i.test(process) ||
        /接口|事件|队列/i.test(user) || /接口|事件|队列/i.test(trigger)) {
        return { user: '发起者：其他平台 接收者：网优平台', trigger: '接口调用触发' };
      }

      // 默认用户触发
      return { user: '发起者：用户 接收者：用户', trigger: '用户触发' };
    };

    try {
      // 查找表格
      const tableMatch = reply.match(/\|[^\n]+\|[\s\S]*?(?=\n\n|\n```|$)/);
      if (tableMatch) {
        const tableText = tableMatch[0];
        const lines = tableText.trim().split('\n').filter(line => line.includes('|'));

        // 跳过表头和分隔行
        const dataLines = lines.filter((line, idx) => idx >= 2 && !line.includes('---') && !line.includes(':---'));

        let currentFunctionalUser = '';
        let currentTriggerEvent = '';
        let currentFunctionalProcess = '';

        for (const line of dataLines) {
          const cells = line.split('|').map(c => c.trim()).filter((_, idx, arr) => idx > 0 && idx < arr.length);

          if (cells.length < 4) continue;

          // 解析各列（处理合并单元格情况）
          let functionalUser = cells[0] || '';
          let triggerEvent = cells[1] || '';
          let functionalProcess = cells[2] || '';
          let subProcessDesc = cells[3] || '';
          let dataMovementType = (cells[4] || '').toUpperCase();
          let dataGroup = cells[5] || '';
          let dataAttributes = cells[6] || '';

          // 处理数据移动类型识别
          const moveSet = new Set(['E', 'R', 'W', 'X']);
          if (!moveSet.has(dataMovementType)) {
            const idx = cells.findIndex(cell => moveSet.has((cell || '').toUpperCase()));
            if (idx !== -1) {
              dataMovementType = (cells[idx] || '').toUpperCase();
              subProcessDesc = cells[idx - 1] || subProcessDesc;
              dataGroup = cells[idx + 1] || dataGroup;
              dataAttributes = cells.slice(idx + 2).filter(Boolean).join('、') || dataAttributes;
            }
          }

          // 更新当前功能过程（处理合并单元格）
          if (functionalProcess) {
            currentFunctionalProcess = sanitizeText(functionalProcess);
          }
          if (functionalUser && triggerEvent) {
            const normalized = normalizeUserTrigger(functionalUser, triggerEvent, currentFunctionalProcess);
            currentFunctionalUser = normalized.user;
            currentTriggerEvent = normalized.trigger;
          } else if (currentFunctionalProcess && dataMovementType === 'E') {
            const normalized = normalizeUserTrigger('', '', currentFunctionalProcess);
            currentFunctionalUser = normalized.user;
            currentTriggerEvent = normalized.trigger;
          }


          // 清理和规范化各字段
          subProcessDesc = sanitizeText(subProcessDesc);

          // 【关键修复】验证子过程描述格式，如果无效则自动修正
          if (isInvalidSubProcessDesc(subProcessDesc)) {
            const originalDesc = subProcessDesc;
            subProcessDesc = regenerateSubProcessDesc(originalDesc, currentFunctionalProcess, dataMovementType);
            console.log(`🔧 修正子过程描述: "${originalDesc}" → "${subProcessDesc}"`);
          } else {
            subProcessDesc = simplifySubProcessDesc(subProcessDesc);
          }

          dataGroup = sanitizeText(dataGroup);

          // 【关键修复】优化数据组名称：移除冗余动词前缀，保持名词性
          const cleanDataGroupName = (name) => {
            if (!name) return name;
            const verbs = ['查询', '创建', '删除', '修改', '编辑', '导出', '导入', '统计', '配置', '处理', '执行', '新增', '更新', '生成', '返回', '获取', '同步', '汇总', '查看'];
            let cleaned = name;
            for (const verb of verbs) {
              if (cleaned.startsWith(verb)) {
                cleaned = cleaned.replace(verb, '');
              }
            }
            return cleaned.replace(/^[·：:、 ]+/, '').trim() || name;
          };
          dataGroup = cleanDataGroupName(dataGroup);

          dataAttributes = sanitizeText(dataAttributes);
          dataAttributes = cleanDataAttributes(dataAttributes);

          // 补全缺失的数据组
          if (!dataGroup && currentFunctionalProcess) {
            dataGroup = `${currentFunctionalProcess.slice(0, 6)}·${subProcessDesc.slice(0, 4)}数据`;
          }

          // 【关键修复】数据属性智能补全：如果属性少于3个，或与数据组高度重合（AI混淆），执行智能扩展
          const attrFields = (dataAttributes || '').split(/[、,，]/).filter(f => f.trim().length >= 1);
          const groupStr = (dataGroup || '').toLowerCase().trim();
          const attrStr = (dataAttributes || '').toLowerCase().trim();

          if (!dataAttributes || attrFields.length < 3 || (groupStr && attrStr && (groupStr === attrStr || groupStr.includes(attrStr) || attrStr.includes(groupStr)))) {
            console.log(`🔍 识别到属性过少或内容可能错误 (Count: ${attrFields.length}, Val: "${dataAttributes}")，开始智能补全...`);
            dataAttributes = await generateUniqueAttrString(
              dataAttributes || '',
              subProcessDesc,
              currentFunctionalProcess,
              [],
              dataGroup,
              0
            );
          }

          tableData.push({
            functionalUser: dataMovementType === 'E' ? currentFunctionalUser : '',
            triggerEvent: dataMovementType === 'E' ? currentTriggerEvent : '',
            functionalProcess: dataMovementType === 'E' ? currentFunctionalProcess : '',
            subProcessDesc,
            dataMovementType,
            dataGroup,
            dataAttributes,
            _parentProcess: currentFunctionalProcess  // 内部使用
          });
        }
      }
    } catch (parseError) {
      console.error('表格解析失败:', parseError);
    }

    // ========== 应用去重和格式化逻辑（增强版：与质量优先模块完全一致）==========
    console.log(`\n📊 表格解析完成，共解析到 ${tableData.length} 条数据`);

    if (tableData.length > 0) {
      console.log('\n========== 开始两步骤拆分后处理：去重 + 格式化 ==========');

      // 功能过程去重
      console.log('⏳ 步骤1：执行功能过程去重...');
      tableData = removeDuplicateFunctionalProcesses(tableData);
      console.log(`✓ 功能过程去重后: ${tableData.length} 条`);

      // 确保每个功能过程的子过程完整性（E+R+W+X）
      console.log('\n⏳ 步骤2：检查子过程完整性（E+R+W+X）...');
      tableData = ensureProcessCompleteness(tableData);
      console.log(`✓ 子过程完整性检查后: ${tableData.length} 条`);

      // 最终系统性去重（采用质量优先模块的去重逻辑）
      console.log('\n⏳ 步骤3：执行最终系统性去重（数据属性重合度检测）...');
      console.log('🔍 开始调用 performFinalDeduplication 函数...');
      tableData = await performFinalDeduplication(tableData);
      console.log(`✓ 最终去重后: ${tableData.length} 条`);

      // 【新增】最终子过程描述格式验证（最后一道防线）
      console.log('\n⏳ 步骤3.5：最终子过程描述格式验证...');
      let fixedCount = 0;
      tableData = tableData.map(row => {
        // 再次验证子过程描述格式
        const desc = row.subProcessDesc || '';
        const hasMultipleSeparators = (desc.match(/[、,，]/g) || []).length >= 2;
        const lacksValidVerb = !['接收', '读取', '获取', '查询', '写入', '保存', '更新', '删除', '返回', '输出', '生成', '记录', '处理'].some(v => desc.includes(v));

        if (hasMultipleSeparators || (lacksValidVerb && hasMultipleSeparators)) {
          // 获取功能过程名称
          const processName = row.functionalProcess || row._parentProcess || '';
          const moveType = row.dataMovementType || '';

          // 提取业务关键词
          let businessKeyword = processName.replace(/^(查询|创建|删除|修改|编辑|导出|导入|统计|配置|处理|执行|启用|禁用|新增|更新|保存|读取|获取)/g, '').trim();
          if (businessKeyword.length < 2) businessKeyword = processName.slice(0, 6) || '业务';
          businessKeyword = businessKeyword.slice(0, 8);

          // 生成正确格式的子过程描述
          let newDesc = '';
          switch (moveType.toUpperCase()) {
            case 'E': newDesc = `接收${businessKeyword}请求`; break;
            case 'R': newDesc = `读取${businessKeyword}数据`; break;
            case 'W': newDesc = `记录${businessKeyword}结果`; break;
            case 'X': newDesc = `返回${businessKeyword}响应`; break;
            default: newDesc = `处理${businessKeyword}数据`;
          }

          console.log(`🔧 最终修正: "${desc}" → "${newDesc}"`);
          fixedCount++;
          return { ...row, subProcessDesc: newDesc };
        }
        return row;
      });
      if (fixedCount > 0) {
        console.log(`✓ 最终格式验证修正了 ${fixedCount} 条子过程描述`);
      } else {
        console.log(`✓ 所有子过程描述格式均正确`);
      }

      // 移除内部字段
      console.log('\n⏳ 步骤4：清理内部字段...');
      tableData = tableData.map(row => {
        const { _parentProcess, ...cleanRow } = row;
        return cleanRow;
      });

      console.log('========== 两步骤拆分后处理完成 ==========\n');
    } else {
      console.warn('⚠️ 警告：tableData 为空，跳过去重处理！');
    }

    res.json({
      success: true,
      cosmicResult: reply,
      tableData: tableData,
      message: `COSMIC拆分完成，共${tableData.length}条记录`
    });

  } catch (error) {
    console.error('COSMIC拆分失败:', error);
    res.status(500).json({ error: '拆分失败: ' + error.message });
  }
});

// ========== 对话式添加功能 API ==========
// 用户输入需求描述，AI智能分析并识别新的功能点
app.post('/api/analyze-additional-functions', async (req, res) => {
  try {
    const { userInput, documentContent = '', existingFunctions = [] } = req.body;

    if (!userInput || !userInput.trim()) {
      return res.status(400).json({ error: '请提供需求描述' });
    }

    const clientConfig = getActiveClientConfig();
    if (!clientConfig) {
      return res.status(400).json({ error: '请先配置API密钥' });
    }

    console.log('\n' + '='.repeat(60));
    console.log('📝 对话式添加功能分析');
    console.log('用户输入:', userInput);
    console.log('现有功能数量:', existingFunctions.length);
    console.log('='.repeat(60));

    const analysisPrompt = `你是一个COSMIC功能点分析专家。用户描述了一些需要添加的功能需求，请根据描述识别并提取功能点。

## 用户需求描述
${userInput}

${documentContent ? `## 原始文档上下文（参考）
${documentContent.substring(0, 2000)}...` : ''}

${existingFunctions.length > 0 ? `## 已有功能列表（避免重复）
${existingFunctions.slice(0, 30).join('、')}` : ''}

## 任务要求
1. 根据用户描述，识别出所有功能点
2. 每个功能点必须是具体的、可拆分的操作
3. 功能名称必须包含：数据对象+操作动作（如"用户数据查询"、"报表Excel导出"）
4. 避免与已有功能重复
5. 判断每个功能的触发类型：用户触发、时钟触发、接口触发
6. 判断每个功能所属的模块

## 关键识别规则
- "查询"、"搜索"、"筛选" → 识别为查询类功能
- "导出"、"下载" → 识别为导出类功能
- "导入"、"上传" → 识别为导入类功能
- "统计"、"汇总"、"分析" → 识别为统计类功能
- "定时"、"每天"、"周期" → 触发类型为"时钟触发"
- "配置"、"设置"、"管理" → 识别为配置管理类功能
- "新增"、"创建"、"添加" → 识别为新增类功能
- "修改"、"编辑"、"更新" → 识别为修改类功能
- "删除"、"移除" → 识别为删除类功能

## 输出格式（严格JSON）
请直接输出JSON数组，不要添加任何其他文字：
[
  {
    "name": "功能名称（动词+名词形式，如'查询用户数据'）",
    "triggerType": "用户触发|时钟触发|接口触发",
    "description": "功能简要描述",
    "moduleName": "所属模块"
  }
]

如果用户描述中没有明确的功能需求，返回空数组 []`;

    const { client, model, useGeminiSDK } = clientConfig;

    let reply = '';

    if (useGeminiSDK) {
      const result = await client.generateContent(analysisPrompt);
      const response = await result.response;
      reply = response.text();
    } else {
      const completion = await client.chat.completions.create({
        model,
        messages: [{ role: 'user', content: analysisPrompt }],
        temperature: 0.3,
        max_tokens: 2000
      });
      reply = completion.choices[0].message.content;
    }

    console.log('AI分析结果:', reply.substring(0, 500));

    // 解析JSON响应
    let functions = [];
    try {
      // 尝试提取JSON数组
      const jsonMatch = reply.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        functions = JSON.parse(jsonMatch[0]);
      }
    } catch (parseError) {
      console.error('JSON解析失败:', parseError.message);
      // 尝试从文本中提取功能名称
      const nameMatches = reply.match(/"name"\s*:\s*"([^"]+)"/g);
      if (nameMatches) {
        functions = nameMatches.map((match, idx) => {
          const name = match.match(/"name"\s*:\s*"([^"]+)"/)[1];
          return {
            name,
            triggerType: '用户触发',
            description: '',
            moduleName: '自定义'
          };
        });
      }
    }

    // 过滤掉与现有功能重复的
    const newFunctions = functions.filter(fn =>
      !existingFunctions.some(existing =>
        existing.toLowerCase().includes(fn.name.toLowerCase()) ||
        fn.name.toLowerCase().includes(existing.toLowerCase())
      )
    );

    console.log(`识别到 ${functions.length} 个功能，去重后 ${newFunctions.length} 个`);

    res.json({
      success: true,
      functions: newFunctions,
      totalIdentified: functions.length,
      message: newFunctions.length > 0
        ? `识别到 ${newFunctions.length} 个新功能`
        : '未识别到新功能'
    });

  } catch (error) {
    console.error('对话式功能分析失败:', error);
    res.status(500).json({ error: '分析失败: ' + error.message });
  }
});

// 导出Excel
app.post('/api/export-excel', async (req, res) => {
  try {
    const { tableData, filename } = req.body;

    if (!tableData || !Array.isArray(tableData) || tableData.length === 0) {
      return res.status(400).json({ error: '无有效数据可导出' });
    }

    // ========== 预处理：自动填充空白格 ==========
    // 将功能用户、触发事件、功能过程向下填充到空白行
    const filledTableData = fillEmptyCells(tableData);

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Cosmic拆分结果');

    // 设置列
    worksheet.columns = [
      { header: '功能用户', key: 'functionalUser', width: 25 },
      { header: '触发事件', key: 'triggerEvent', width: 15 },
      { header: '功能过程', key: 'functionalProcess', width: 30 },
      { header: '子过程描述', key: 'subProcessDesc', width: 35 },
      { header: '数据移动类型', key: 'dataMovementType', width: 15 },
      { header: '数据组', key: 'dataGroup', width: 25 },
      { header: '数据属性', key: 'dataAttributes', width: 50 }
    ];

    // 设置表头样式
    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF4472C4' }
    };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
    headerRow.height = 25;

    // 添加数据
    filledTableData.forEach((row, index) => {
      const dataRow = worksheet.addRow({
        functionalUser: row.functionalUser || '',
        triggerEvent: row.triggerEvent || '',
        functionalProcess: row.functionalProcess || '',
        subProcessDesc: row.subProcessDesc || '',
        dataMovementType: row.dataMovementType || '',
        dataGroup: row.dataGroup || '',
        dataAttributes: row.dataAttributes || ''
      });

      // 交替行颜色
      if (index % 2 === 1) {
        dataRow.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFF2F2F2' }
        };
      }

      dataRow.alignment = { vertical: 'middle', wrapText: true };
    });

    // 添加边框
    worksheet.eachRow((row, rowNumber) => {
      row.eachCell((cell) => {
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
      });
    });

    // 生成文件
    const buffer = await workbook.xlsx.writeBuffer();

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename || 'cosmic_result')}.xlsx"`);
    res.send(buffer);
  } catch (error) {
    console.error('导出Excel失败:', error);
    res.status(500).json({ error: '导出Excel失败: ' + error.message });
  }
});

// ========== 自动填充空白格函数 ==========
// 将功能用户、触发事件、功能过程向下填充到空白行（像Excel合并单元格的效果）
function fillEmptyCells(tableData) {
  if (!tableData || tableData.length === 0) return tableData;

  const result = [];
  let lastFunctionalUser = '';
  let lastTriggerEvent = '';
  let lastFunctionalProcess = '';

  for (let i = 0; i < tableData.length; i++) {
    const row = { ...tableData[i] };

    // 如果当前行有功能用户，更新记录；否则使用上一个有效值
    if (row.functionalUser && row.functionalUser.trim()) {
      lastFunctionalUser = row.functionalUser.trim();
    } else {
      row.functionalUser = lastFunctionalUser;
    }

    // 如果当前行有触发事件，更新记录；否则使用上一个有效值
    if (row.triggerEvent && row.triggerEvent.trim()) {
      lastTriggerEvent = row.triggerEvent.trim();
    } else {
      row.triggerEvent = lastTriggerEvent;
    }

    // 如果当前行有功能过程，更新记录；否则使用上一个有效值
    if (row.functionalProcess && row.functionalProcess.trim()) {
      lastFunctionalProcess = row.functionalProcess.trim();
    } else {
      row.functionalProcess = lastFunctionalProcess;
    }

    result.push(row);
  }

  console.log(`自动填充完成: ${result.length} 行数据`);
  return result;
}

// AI智能去重 - 分析前面数据组内容，结合子过程关键字生成新名称
// 例如："用户信息" 重复时，根据子过程"删除用户"生成 "用户信息删除表"
async function aiGenerateUniqueName(originalName, subProcessDesc, functionalProcess, existingNames) {
  try {
    const prompt = `你是一个数据命名专家。现在有一个数据组/数据属性名称"${originalName}"与已有名称重复。


上下文信息：
- 功能过程：${functionalProcess}
- 子过程描述：${subProcessDesc}
- 已存在的类似名称：${existingNames.slice(0, 5).join(', ')}

请根据子过程描述的业务含义，直接生成一个新的完整名称，将原名称与子过程的关键动作/对象结合。

要求：
1. 不要使用括号，直接将关键词融入名称
2. 新名称要体现子过程的具体业务动作
3. 只输出新名称本身，不要其他解释
4. 名称要简洁，不超过15个字

示例：
- 原名称"用户信息"，子过程"删除用户记录" -> 用户信息删除表
- 原名称"设备数据"，子过程"读取设备状态" -> 设备状态读取数据
- 原名称"告警记录"，子过程"写入告警处理结果" -> 告警处理结果记录
- 原名称"订单信息"，子过程"查询历史订单" -> 历史订单查询信息`;

    const completion = await callAIChat({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3
    });

    const newName = completion.choices[0].message.content.trim();

    // 清理可能的多余内容，包括【】括号及其内容
    const cleanName = newName
      .replace(/["'\n\r]/g, '')
      .replace(/【[^】]*】/g, '')  // 去除【xxx】标签（包括内容）- 修正正则
      .replace(/\[[^\]]*\]/g, '')  // 去除[xxx]标签（包括内容）- 修正正则
      .trim()
      .slice(0, 20);
    return cleanName || generateUniqueNameLocal(originalName, subProcessDesc);
  } catch (error) {
    console.log('AI生成名称失败，使用本地提取:', error.message);
    return generateUniqueNameLocal(originalName, subProcessDesc);
  }
}

// 本地名称生成（备用方案）- 将原名称与子过程关键词结合（用于数据组）
function generateUniqueNameLocal(originalName, subProcessDesc = '') {
  // 从子过程描述中提取关键动词和名词
  const cleaned = subProcessDesc
    .replace(/[\d]/g, '')
    .replace(/[，。、《》（）()？：；\-·]/g, ' ')
    .trim();

  if (!cleaned) {
    return originalName + '扩展表';
  }

  // 常见动词列表
  const actionWords = ['查询', '读取', '写入', '删除', '更新', '新增', '修改', '获取', '提交', '保存', '导出', '导入', '分析', '统计', '处理', '审核', '验证', '确认'];

  // 提取动词
  let action = '';
  for (const word of actionWords) {
    if (cleaned.includes(word)) {
      action = word;
      break;
    }
  }

  // 提取名词（去掉动词后的内容）
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  const noun = tokens.find(t => t.length >= 2 && !actionWords.includes(t)) || '';

  // 组合新名称
  if (action && noun) {
    return originalName + action + noun;
  } else if (action) {
    return originalName + action + '表';
  } else if (noun) {
    return originalName + noun + '表';
  } else {
    // 直接取子过程描述的前几个字
    const prefix = tokens.slice(0, 2).map(t => t.slice(0, 3)).join('');
    return originalName + (prefix || '扩展') + '表';
  }
}

// AI智能去重 - 专门用于数据属性，使用更多字段组合
async function aiGenerateUniqueAttrName(originalName, subProcessDesc, functionalProcess, existingNames, dataGroup) {
  const client = getOpenAIClient();
  if (!client) {
    return generateUniqueAttrNameLocal(originalName, subProcessDesc, dataGroup);
  }

  try {
    const prompt = `你是一个数据属性命名专家。现在有一个数据属性名称"${originalName}"与已有名称重复。

上下文信息：
- 功能过程：${functionalProcess}
- 子过程描述：${subProcessDesc}
- 所属数据组：${dataGroup}
- 已存在的类似名称：${existingNames.slice(0, 5).join(', ')}

请根据上下文信息，生成一个新的数据属性名称。

要求：
1. 不要使用括号，直接将关键词融入名称
2. 新名称要体现数据属性的具体特征（如ID、类型、参数、版本、状态等）
3. 可以结合数据组名称、子过程动作来区分
4. 只输出新名称本身，不要其他解释
5. 名称要简洁，不超过15个字

示例：
- 原名称"模型ID"，子过程"查询模型信息"，数据组"模型数据" -> 查询模型标识
- 原名称"设备类型"，子过程"更新设备状态"，数据组"设备信息" -> 设备状态类型
- 原名称"模型数据"，子过程"读取模型版本"，数据组"模型信息" -> 模型版本数据
- 原名称"设备参数"，子过程"导出设备配置"，数据组"设备导出" -> 导出配置参数`;

    const completion = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'glm-4-flash',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.4,
      max_tokens: 50
    });

    const newName = completion.choices[0].message.content.trim();
    // 清理可能的多余内容，包括【】括号及其内容
    const cleanName = newName
      .replace(/["'\n\r]/g, '')
      .replace(/【[^】]*】/g, '')  // 去除【xxx】标签（包括内容）- 修正正则
      .replace(/\[[^\]]*\]/g, '')  // 去除[xxx]标签（包括内容）- 修正正则
      .trim()
      .slice(0, 20);
    return cleanName || generateUniqueAttrNameLocal(originalName, subProcessDesc, dataGroup);
  } catch (error) {
    console.log('AI生成属性名称失败，使用本地提取:', error.message);
    return generateUniqueAttrNameLocal(originalName, subProcessDesc, dataGroup);
  }
}

// 本地属性名称生成（备用方案）- 使用更多字段组合
function generateUniqueAttrNameLocal(originalName, subProcessDesc = '', dataGroup = '') {
  const cleaned = subProcessDesc
    .replace(/[\d]/g, '')
    .replace(/[，。、《》（）()？：；\-·]/g, ' ')
    .trim();

  // 属性相关的后缀词
  const attrSuffixes = ['标识', '编号', '类型', '参数', '版本', '状态', '配置', '属性', '字段', '值'];
  // 常见动词列表
  const actionWords = ['查询', '读取', '写入', '删除', '更新', '新增', '修改', '获取', '提交', '保存', '导出', '导入', '分析', '统计', '处理', '审核', '验证', '确认'];

  // 提取动词
  let action = '';
  for (const word of actionWords) {
    if (cleaned.includes(word)) {
      action = word;
      break;
    }
  }

  // 从数据组中提取关键词
  const groupKeyword = dataGroup.replace(/[数据表信息记录]/g, '').slice(0, 4);

  // 随机选择一个属性后缀
  const randomSuffix = attrSuffixes[Math.floor(Math.random() * attrSuffixes.length)];

  // 组合新名称 - 使用不同于数据组的组合方式
  if (action && groupKeyword) {
    return action + groupKeyword + randomSuffix;
  } else if (action) {
    return action + originalName + randomSuffix;
  } else if (groupKeyword) {
    return groupKeyword + originalName.slice(0, 4) + randomSuffix;
  } else {
    const tokens = cleaned.split(/\s+/).filter(Boolean);
    const prefix = tokens.slice(0, 2).map(t => t.slice(0, 2)).join('');
    return (prefix || '扩展') + originalName + randomSuffix;
  }
}

// ========== 功能过程去重函数 ==========
// 删除重复的功能过程及其下的所有子过程
function removeDuplicateFunctionalProcesses(tableData) {
  if (!tableData || tableData.length === 0) return tableData;

  const seenProcesses = new Set(); // 已出现的功能过程名称
  const result = [];
  let currentProcess = ''; // 当前正在处理的功能过程
  let skipCurrentProcess = false; // 是否跳过当前功能过程

  for (let i = 0; i < tableData.length; i++) {
    const row = tableData[i];

    // 获取当前行的功能过程（可能为空，需要继承）
    const rowProcess = (row.functionalProcess || '').trim();
    const parentProcess = (row._parentProcess || '').trim();
    const effectiveProcess = rowProcess || parentProcess || currentProcess;

    // 如果是E类型（入口），说明是新功能过程的开始
    if (row.dataMovementType === 'E' && rowProcess) {
      currentProcess = rowProcess;

      // 检查是否重复
      const processKey = rowProcess.toLowerCase();
      if (seenProcesses.has(processKey)) {
        console.log(`发现重复功能过程: "${rowProcess}"，跳过该功能过程的所有子过程`);
        skipCurrentProcess = true;
        continue; // 跳过这一行
      } else {
        seenProcesses.add(processKey);
        skipCurrentProcess = false;
      }
    }

    // 如果当前功能过程被标记为跳过，则跳过该行
    if (skipCurrentProcess) {
      // 检查是否进入了新的功能过程（通过E类型判断）
      if (row.dataMovementType === 'E' && rowProcess && rowProcess !== currentProcess) {
        // 新功能过程开始，重新检查
        currentProcess = rowProcess;
        const processKey = rowProcess.toLowerCase();
        if (seenProcesses.has(processKey)) {
          console.log(`发现重复功能过程: "${rowProcess}"，跳过该功能过程的所有子过程`);
          skipCurrentProcess = true;
          continue;
        } else {
          seenProcesses.add(processKey);
          skipCurrentProcess = false;
        }
      } else {
        continue; // 继续跳过
      }
    }

    result.push(row);
  }

  console.log(`功能过程去重: 原 ${tableData.length} 条 -> 现 ${result.length} 条，共 ${seenProcesses.size} 个唯一功能过程`);
  return result;
}

// ========== 功能过程完整性检查和补全函数 ==========
// 检查每个功能过程是否有完整的E+R+W+X四个子过程，如果缺失则自动补全
function ensureProcessCompleteness(tableData) {
  if (!tableData || tableData.length === 0) return tableData;

  console.log('========== 开始功能过程完整性检查（必须有E+R+W+X四个子过程） ==========');

  // 按功能过程分组
  const processMap = new Map();
  let currentProcess = '';

  for (const row of tableData) {
    const processName = row.functionalProcess || row._parentProcess || currentProcess;
    if (row.dataMovementType === 'E' && row.functionalProcess) {
      currentProcess = row.functionalProcess;
    }

    const effectiveProcess = processName || currentProcess;
    if (!processMap.has(effectiveProcess)) {
      processMap.set(effectiveProcess, []);
    }
    processMap.get(effectiveProcess).push({ ...row, _effectiveProcess: effectiveProcess });
  }

  const result = [];

  for (const [processName, rows] of processMap.entries()) {
    if (!processName) {
      result.push(...rows);
      continue;
    }

    // 统计各类型 - 必须有E、R、W、X四种类型
    const hasE = rows.some(r => r.dataMovementType === 'E');
    const hasR = rows.some(r => r.dataMovementType === 'R');
    const hasW = rows.some(r => r.dataMovementType === 'W');
    const hasX = rows.some(r => r.dataMovementType === 'X');

    // 获取第一行的基础信息
    const baseRow = rows[0] || {};
    const functionalUser = baseRow.functionalUser || '用户触发';
    const triggerEvent = baseRow.triggerEvent || '用户请求';

    // 如果缺少E，在开头补充
    if (!hasE) {
      console.log(`功能过程"${processName}"缺少E，自动补充`);
      result.push({
        functionalUser,
        triggerEvent,
        functionalProcess: processName,
        subProcessDesc: `接收${processName}请求参数`,
        dataMovementType: 'E',
        dataGroup: `${processName}请求`,
        dataAttributes: `请求参数、操作人、请求时间`
      });
    }

    // 添加原有的E行
    const eRows = rows.filter(r => r.dataMovementType === 'E');
    for (const row of eRows) {
      const { _effectiveProcess, ...cleanRow } = row;
      result.push(cleanRow);
    }

    // 如果缺少R，补充一个R
    if (!hasR) {
      console.log(`功能过程"${processName}"缺少R，自动补充`);
      result.push({
        functionalUser: '',
        triggerEvent: '',
        functionalProcess: '',
        subProcessDesc: `读取${processName}相关数据`,
        dataMovementType: 'R',
        dataGroup: `${processName}数据表`,
        dataAttributes: `数据ID、数据内容、更新时间`
      });
    }

    // 添加原有的R行
    const rRows = rows.filter(r => r.dataMovementType === 'R');
    for (const row of rRows) {
      const { _effectiveProcess, ...cleanRow } = row;
      result.push(cleanRow);
    }

    // 如果缺少W，补充一个W
    if (!hasW) {
      console.log(`功能过程"${processName}"缺少W，自动补充`);
      result.push({
        functionalUser: '',
        triggerEvent: '',
        functionalProcess: '',
        subProcessDesc: `记录${processName}操作日志`,
        dataMovementType: 'W',
        dataGroup: `${processName}日志表`,
        dataAttributes: `操作人、操作时间、操作内容`
      });
    }

    // 添加原有的W行
    const wRows = rows.filter(r => r.dataMovementType === 'W');
    for (const row of wRows) {
      const { _effectiveProcess, ...cleanRow } = row;
      result.push(cleanRow);
    }

    // 如果缺少X，在末尾补充
    if (!hasX) {
      console.log(`功能过程"${processName}"缺少X，自动补充`);
      result.push({
        functionalUser: '',
        triggerEvent: '',
        functionalProcess: '',
        subProcessDesc: `返回${processName}操作结果`,
        dataMovementType: 'X',
        dataGroup: `${processName}响应`,
        dataAttributes: `操作状态、结果消息、处理时间`
      });
    }

    // 添加原有的X行
    const xRows = rows.filter(r => r.dataMovementType === 'X');
    for (const row of xRows) {
      const { _effectiveProcess, ...cleanRow } = row;
      result.push(cleanRow);
    }
  }

  console.log(`完整性检查完成: ${tableData.length} -> ${result.length} 条`);
  return result;
}

// ========== 最终系统性去重函数（增强版：基于重合度去重）==========
// 对整个表格数据进行最终检查，确保数据组和数据属性没有完全重复
// 借鉴质量优先模块：相邻功能过程的数据属性重合度不得超过30%
async function performFinalDeduplication(tableData) {
  console.log('\n🚀🚀🚀 performFinalDeduplication 函数被调用！');
  console.log(`📥 输入数据: ${tableData ? tableData.length : 0} 条`);

  if (!tableData || tableData.length === 0) {
    console.log('⚠️ 输入数据为空，直接返回');
    return tableData;
  }

  console.log('========== 开始最终系统性去重检查（增强版：基于重合度）==========');

  // ========== 辅助函数：计算两个属性列表的重合度 ==========
  const calculateOverlapRate = (attrs1, attrs2) => {
    if (!attrs1 || !attrs2) return 0;

    // 将属性字符串拆分为字段数组
    const fields1 = attrs1.split(/[、,，|]/).map(f => f.trim().toLowerCase()).filter(f => f.length >= 2);
    const fields2 = attrs2.split(/[、,，|]/).map(f => f.trim().toLowerCase()).filter(f => f.length >= 2);

    if (fields1.length === 0 || fields2.length === 0) return 0;

    // 计算重叠字段数
    let overlapCount = 0;
    for (const f1 of fields1) {
      for (const f2 of fields2) {
        // 完全匹配或包含关系都算重叠
        if (f1 === f2 || f1.includes(f2) || f2.includes(f1)) {
          overlapCount++;
          break;
        }
      }
    }

    // 重合度 = 重叠数 / 较小集合的大小
    return overlapCount / Math.min(fields1.length, fields2.length);
  };

  // 辅助函数：检测数据移动类型
  const detectMoveType = (subProcessDesc) => {
    if (!subProcessDesc) return '';
    if (subProcessDesc.includes('接收') || subProcessDesc.includes('触发')) return 'E';
    if (subProcessDesc.includes('读取') || subProcessDesc.includes('获取') || subProcessDesc.includes('查询')) return 'R';
    if (subProcessDesc.includes('写入') || subProcessDesc.includes('保存') || subProcessDesc.includes('记录') || subProcessDesc.includes('更新')) return 'W';
    if (subProcessDesc.includes('返回') || subProcessDesc.includes('输出') || subProcessDesc.includes('响应')) return 'X';
    return '';
  };

  // ========== 辅助函数：为属性添加差异化字段（增强版：先瘦身后添加）==========
  const addDifferentiatingFields = (attrs, subProcessDesc, functionalProcess, dataMovementType, existingAttrsSet) => {

    // ===== 新增：数据属性智能瘦身函数（修复版：更温和的瘦身策略 + 更彻底的动词移除）=====
    // 核心思路：只移除真正冗余的词，同时彻底移除动词前缀，确保保留足够的业务信息
    const slimDownAttributes = (fieldName, functionalProcess, dataMovementType) => {
      if (!fieldName || fieldName.length <= 4) return fieldName; // 已经很短了，保留

      // 保护机制：如果字段名太短，不瘦身（避免过度精简）
      const MIN_SAFE_LENGTH = 3; // 降低到3个字（因为很多名词本身就是3-4字）

      // 0. 【新增】首先移除所有动词前缀（这是最关键的修复）
      const actionVerbs = [
        '编辑', '修改', '更新', '删除', '创建', '新增', '添加', '移除', '设置',
        '配置', '调整', '变更', '录入', '填写', '输入', '选择', '指定',
        '查询', '查看', '检索', '搜索', '浏览', '读取', '获取', '提取',
        '导出', '导入', '上传', '下载', '发送', '接收', '推送',
        '执行', '处理', '操作', '启动', '关闭', '启用', '禁用', '激活',
        '审核', '审批', '确认', '验证', '校验', '检测', '监控', '分析',
        '计算', '统计', '汇总', '聚合', '整合', '合并', '拆分'
      ];

      let cleanedFieldName = fieldName;
      for (const verb of actionVerbs) {
        // 只移除开头的动词
        if (cleanedFieldName.startsWith(verb)) {
          cleanedFieldName = cleanedFieldName.slice(verb.length);
          console.log(`  → 移除动词前缀: "${fieldName}" -> "${cleanedFieldName}"`);
          break; // 只移除一次
        }
      }

      // 如果移除动词后变得太短，返回原值但记录警告
      if (cleanedFieldName.length < 2) {
        console.log(`  ⚠️ 动词移除后过短: "${fieldName}" (移除后: "${cleanedFieldName}")，保留原值但可能有问题`);
        return fieldName;
      }

      // 1. 提取功能过程中的核心场景关键词
      const extractSceneKeywords = (process) => {
        const scenePatterns = [
          /(华为|中兴|爱立信|诺基亚|大唐)/,  // 厂商
          /(小区|基站|用户|网络|设备|站点|区域|地市|县)/,  // 网络对象
          /(质差|优化|告警|故障|投诉|工单|任务|健康度)/,  // 场景
          /(评估|评分|指标|统计|汇总|报表|日报|周报|月报)/,  // 业务类型
        ];

        let keywords = [];
        for (const pattern of scenePatterns) {
          const match = process.match(pattern);
          if (match) keywords.push(match[1]);
        }
        return keywords.slice(0, 2).join(''); // 最多保留2个关键词
      };

      const sceneKeyword = extractSceneKeywords(functionalProcess);

      // 使用清理后的字段名继续处理
      fieldName = cleanedFieldName;

      // 2. 重新定义冗余后缀词（大幅缩减，只保留真正冗余的）
      // !!! 关键修复：移除"参数"、"配置"、"设置"等可能包含业务信息的词
      const redundantSuffixes = [
        '数据', '信息', '内容', '详情', '记录',  // 只保留最常见的5个冗余词
      ];

      // 3. 定义必要的核心词（这些词应该保留）
      const coreWords = [
        '标识', 'ID', '编号', '代码', '名称', '类型', '状态', '等级',
        '时间', '日期', '位置', '坐标', '地址', '区域',
        '数量', '数值', '比率', '百分比', '阈值', '门限',
        '版本', '序号', '索引', '键', '码',
        '参数', '配置', '设置', '属性'  // 新增：这些词也是核心业务词
      ];

      // 4. 保护性关键词：如果字段名只包含这些词，绝对不精简
      const protectedKeywords = [
        '任务ID', '任务名称', '任务分类', '任务类型', '任务状态',
        '地市', '状态', '创建时间', '更新时间',
        '操作人', '操作时间', '操作类型',
        '请求参数', '请求时间', '响应结果', '返回状态',
        '查询条件', '过滤条件', '排序规则',
        '数据源', '数据类型', '数据值'
      ];

      // 检查是否是保护关键词
      if (protectedKeywords.some(keyword => fieldName.includes(keyword))) {
        return fieldName; // 保护关键词，不瘦身
      }

      // 4. 开始瘦身（更保守的策略）
      let slimmedField = fieldName;
      let hasSlimmed = false; // 标记是否已经瘦身过

      // 4.1 只在字段名过长（>10字）时才考虑移除冗余后缀
      if (slimmedField.length > 10) {
        for (const suffix of redundantSuffixes) {
          // 更严格的条件：只移除末尾的冗余词，且确保剩余部分足够长
          if (slimmedField.endsWith(suffix) && slimmedField.length > suffix.length + MIN_SAFE_LENGTH) {
            const withoutSuffix = slimmedField.slice(0, -suffix.length);

            // 检查剩余部分是否包含核心词或场景关键词
            const hasCoreWord = coreWords.some(core => withoutSuffix.includes(core));
            const hasSceneKeyword = sceneKeyword && withoutSuffix.includes(sceneKeyword);

            // 只有在确保有足够信息的情况下才移除
            if ((hasCoreWord || hasSceneKeyword) && withoutSuffix.length >= MIN_SAFE_LENGTH) {
              slimmedField = withoutSuffix;
              hasSlimmed = true;
              break; // 只移除一次，避免过度精简
            }
          }
        }
      }

      // 4.2 特殊处理：如果字段名很长（>12字）且包含重复的操作动词
      if (slimmedField.length > 12 && !hasSlimmed) {
        // 只移除明显的重复描述词（操作动词）
        const middleRedundant = ['查询', '导出', '统计', '分析'];
        for (const word of middleRedundant) {
          // 只有当字段名中该词出现在中间位置时才移除
          const wordIndex = slimmedField.indexOf(word);
          if (wordIndex > 2 && wordIndex < slimmedField.length - 3 && slimmedField.length > 10) {
            const withoutWord = slimmedField.replace(word, '');
            if (withoutWord.length >= MIN_SAFE_LENGTH) {
              slimmedField = withoutWord;
              break; // 只移除一次
            }
          }
        }
      }

      // 4.3 最终长度控制（宽松标准：允许6-12字）
      // 只有在非常长的情况下才强制截断
      if (slimmedField.length > 12) {
        // 保留前缀关键词 + 核心词
        const hasCoreAtEnd = coreWords.some(core => slimmedField.endsWith(core));
        if (hasCoreAtEnd) {
          // 保留核心词在末尾
          const coreWordAtEnd = coreWords.find(core => slimmedField.endsWith(core));
          const targetLength = 12;
          const prefix = slimmedField.slice(0, targetLength - coreWordAtEnd.length);
          slimmedField = prefix + coreWordAtEnd;
        } else {
          // 没有核心词在末尾，保守截取前12字
          slimmedField = slimmedField.slice(0, 12);
        }
      }

      // 最终保护：确保瘦身后的字段不会太短
      if (slimmedField.length < 3) {
        return fieldName; // 太短了，返回原值
      }

      return slimmedField || fieldName; // 如果瘦身失败，返回原值
    };

    // ===== 步骤1：对已有字段进行瘦身 =====
    let fieldsArray = attrs.split(/[、,，|]/).map(f => f.trim()).filter(f => f.length >= 2);

    // 瘦身每个字段
    fieldsArray = fieldsArray.map(field => slimDownAttributes(field, functionalProcess, dataMovementType));

    // 去重（瘦身后可能产生重复）
    fieldsArray = Array.from(new Set(fieldsArray));

    // ===== 步骤1.5：强制差异化检查（防止瘦身后字段过于相似）=====
    // 检查瘦身后的字段是否与全局已使用的字段高度相似
    const minFieldLength = 4; // 字段最短长度
    fieldsArray = fieldsArray.map(field => {
      const fieldLower = field.toLowerCase();

      // 检查是否已被全局使用（完全相同）
      if (existingAttrsSet.has(fieldLower)) {
        console.log(`⚠️ 数据属性瘦身后重复: "${field}"，强制差异化...`);

        // 提取业务特征词用于差异化（修复版：提取真正的业务关键词）
        const extractBusinessFeature = (process, moveType) => {
          if (!process) return '';

          // 优先使用厂商特征
          const vendorMatch = process.match(/(华为|中兴|爱立信|诺基亚)/);
          if (vendorMatch) return vendorMatch[1];

          // 提取业务领域关键词（如"低空保障"、"参数配置"等）
          const domainMatch = process.match(/(低空保障|低空|保障|参数|配置|自动化|任务|工单|告警|质差|优化|健康度|评估|统计|监控|管理|调度|执行|删除|创建|编辑|查看|启用|禁用|批量)/);
          if (domainMatch) return domainMatch[1];

          // 提取网络对象关键词
          const objectMatch = process.match(/(小区|基站|用户|网络|设备|站点|区域|地市)/);
          if (objectMatch) return objectMatch[1];

          // 兜底：提取功能过程的核心词（移除动词后的前4个字）
          const cleanedProcess = process
            .replace(/查询|创建|删除|修改|导出|导入|统计|配置|处理|执行|启用|禁用|编辑|查看|返回|读取|保存|生成|输出|接收/g, '')
            .trim();

          if (cleanedProcess.length >= 2) {
            return cleanedProcess.slice(0, 4); // 取前4个字作为业务特征
          }

          // 最终兜底：直接取功能过程的前4个字（不再使用单字"入/取/存/出"）
          return process.slice(0, 4);
        };

        const businessFeature = extractBusinessFeature(functionalProcess, dataMovementType);

        // 智能插入特征词（而不是简单追加）
        if (field.length > 6) {
          // 在中间插入特征词
          const mid = Math.floor(field.length / 2);
          field = field.slice(0, mid) + businessFeature + field.slice(mid);
        } else {
          // 短字段，直接追加
          field = businessFeature + field;
        }

        // 限制最大长度
        field = field.slice(0, 10);

        console.log(`  → 差异化后: "${field}"`);
      }

      // 确保字段不会太短
      if (field.length < minFieldLength && functionalProcess) {
        const prefix = functionalProcess.slice(0, minFieldLength - field.length);
        field = prefix + field;
      }

      return field;
    });

    // ===== 步骤2：从功能过程中提取业务关键词，用于生成差异化字段（修复版）=====
    const extractBusinessContext = (text) => {
      if (!text) return { core: '', vendor: '', object: '', scene: '', domain: '' };

      // 提取厂商
      const vendorMatch = text.match(/(华为|中兴|爱立信|诺基亚|大唐)/);
      const vendor = vendorMatch ? vendorMatch[1] : '';

      // 提取业务领域（新增：如"低空保障"、"参数配置"等）
      const domainMatch = text.match(/(低空保障|低空|保障|自动化|参数配置|任务管理|工单管理|设备管理|告警管理|质差分析|健康度|监控中心)/);
      const domain = domainMatch ? domainMatch[1] : '';

      // 提取网络对象
      const objectMatch = text.match(/(小区|基站|用户|网络|设备|站点|区域|地市)/);
      const object = objectMatch ? objectMatch[1] : '';

      // 提取场景
      const sceneMatch = text.match(/(质差|优化|告警|故障|投诉|工单|任务|健康度|评估|统计|汇总|编辑|删除|创建|查看|启用|禁用|执行|批量)/);
      const scene = sceneMatch ? sceneMatch[1] : '';

      // 提取核心词（移除动词后的剩余，但保留更多业务信息）
      const verbs = ['查询', '创建', '删除', '修改', '导出', '导入', '统计', '分析', '配置', '设置', '获取', '更新', '生成', '汇总', '计算', '评估', '审核', '整合', '编辑', '查看', '启用', '禁用', '执行', '批量', '立即'];
      let core = text;
      for (const v of verbs) {
        core = core.replace(new RegExp(v, 'g'), '');
      }
      // 只移除最冗余的词，保留"数据"、"参数"等可能有业务含义的词
      core = core.replace(/管理|系统|平台|功能|模块/g, '').trim().slice(0, 8);

      return { core, vendor, object, scene, domain };
    };

    const bizContext = extractBusinessContext(functionalProcess);
    // 构建业务前缀：优先使用业务领域 + 场景，其次是厂商 + 对象
    const businessPrefix =
      (bizContext.domain ? bizContext.domain.slice(0, 4) : '') +
      (bizContext.scene ? bizContext.scene.slice(0, 2) : '') ||
      `${bizContext.vendor}${bizContext.scene}${bizContext.object}`.slice(0, 8) ||
      bizContext.core.slice(0, 6) ||
      functionalProcess.slice(0, 4);

    // ===== 步骤3：优化差异化字段池（业务化而非技术化，且移除动词）=====
    const differentiatingFieldPools = {
      // E（入口）：请求相关字段（纯名词）
      'E': [
        `${businessPrefix}请求ID`,
        `${businessPrefix}批次号`,
        `${businessPrefix}会话标识`,
        '用户标识',
        '时间戳',
        '来源渠道',
        '业务类型码',
        '优先级'
      ],
      // R（读取）：配置和规则相关字段（纯名词）
      'R': [
        `${businessPrefix}配置版本`,
        `${businessPrefix}规则标识`,
        `${businessPrefix}数据源`,
        '时间范围',
        '条件组合',
        '过滤规则',
        '关联对象数',
        '数据范围'
      ],
      // W（写入）：记录和日志相关字段（纯名词）
      'W': [
        `${businessPrefix}记录ID`,
        `${businessPrefix}流水号`,
        `${businessPrefix}批次号`,
        '时间戳',
        '人员标识',
        '变更类型',
        '持久化标识',
        '分区键'
      ],
      // X（出口）：响应和结果相关字段（纯名词）
      'X': [
        `${businessPrefix}响应ID`,
        `${businessPrefix}结果集`,
        `${businessPrefix}序号`,
        '状态码',
        '结果数量',
        '耗时毫秒',
        '游标位置',
        '任务令牌'
      ]
    };

    // 通用差异化字段（更业务化）
    const generalDifferentiatingFields = [
      `${businessPrefix}追踪码`,
      `${businessPrefix}流水号`,
      '操作标识',
      '处理序号',
      '业务标签',
      '状态码',
      '时间戳'
    ];

    const moveType = dataMovementType || detectMoveType(subProcessDesc);
    let candidatePool = [...(differentiatingFieldPools[moveType] || []), ...generalDifferentiatingFields];

    // ===== 步骤4：按业务相关度排序候选字段 =====
    candidatePool = candidatePool.sort((a, b) => {
      const aWeight = a.includes(businessPrefix) ? 1 : 0;
      const bWeight = b.includes(businessPrefix) ? 1 : 0;
      return bWeight - aWeight;
    });

    // ===== 步骤5：尝试添加差异化字段（最多2个）=====
    let addedCount = 0;
    const shuffled = candidatePool.sort(() => Math.random() - 0.5);
    for (const field of shuffled) {
      if (addedCount >= 2) break;

      const isExisting = fieldsArray.some(f => f === field || f.includes(field) || field.includes(f));
      const fieldLower = field.toLowerCase();
      const isGlobalUsed = existingAttrsSet.has(fieldLower);

      if (!isExisting && !isGlobalUsed) {
        fieldsArray.push(field);
        existingAttrsSet.add(fieldLower);
        addedCount++;
      }
    }

    // ===== 步骤6：兜底机制（更简洁的业务字段）=====
    if (addedCount === 0) {
      // 根据数据移动类型选择合适的兜底字段（精简版）
      const fallbackFieldsByType = {
        'E': [`${businessPrefix}请求码`, `${businessPrefix}会话ID`, `${businessPrefix}批次号`],
        'R': [`${businessPrefix}配置版本`, `${businessPrefix}读取时间`, `${businessPrefix}数据源`],
        'W': [`${businessPrefix}写入序号`, `${businessPrefix}操作流水`, `${businessPrefix}变更批次`],
        'X': [`${businessPrefix}响应码`, `${businessPrefix}输出序号`, `${businessPrefix}返回批次`]
      };
      const fallbackPool = fallbackFieldsByType[moveType] || [`${businessPrefix}追踪码`, `${businessPrefix}处理序号`, `${businessPrefix}操作批次`];

      for (const fallbackField of fallbackPool) {
        const fallbackLower = fallbackField.toLowerCase();
        if (!existingAttrsSet.has(fallbackLower)) {
          fieldsArray.push(fallbackField);
          existingAttrsSet.add(fallbackLower);
          break;
        }
      }
    }

    // ===== 步骤7：最终清理和返回 =====
    const finalFields = fieldsArray.filter((v, i, a) => a.indexOf(v) === i);
    return finalFields.slice(0, 8).join('、');
  };

  // 清理序号和括号的辅助函数（包括括号内的内容）
  const cleanNumberSuffix = (text) => {
    if (!text) return text;
    return String(text)
      .replace(/\(\d+\)/g, '')  // 去除 (2)、(3) 等序号
      .replace(/（\d+）/g, '')  // 去除中文括号序号
      .replace(/【[^】]*】/g, '')  // 去除【xxx】标签（包括内容）
      .replace(/\[[^\]]*\]/g, '')  // 去除[xxx]标签（包括内容）
      .replace(/\s+/g, ' ')
      .trim();
  };

  // 先清理所有行的【】括号和序号
  tableData = tableData.map(row => ({
    ...row,
    functionalProcess: cleanNumberSuffix(row.functionalProcess),
    subProcessDesc: cleanNumberSuffix(row.subProcessDesc),
    dataGroup: cleanNumberSuffix(row.dataGroup),
    dataAttributes: cleanNumberSuffix(row.dataAttributes)
  }));

  // ========== 第零步：功能过程去重 ==========
  tableData = removeDuplicateFunctionalProcesses(tableData);
  console.log(`功能过程去重后剩余 ${tableData.length} 条数据`);

  // ========== 第一步：子过程描述去重（增强版：瘦身后强制差异化）==========
  const seenSubProcessDescs = new Map();
  const subProcessCounters = new Map(); // 记录每种描述出现的次数

  tableData = tableData.map((row, index) => {
    const key = (row.subProcessDesc || '').toLowerCase().trim();

    if (key && seenSubProcessDescs.has(key)) {
      console.log(`⚠️ 检测到重复子过程描述: "${row.subProcessDesc}"`);

      const funcProcess = cleanNumberSuffix(row._parentProcess || row.functionalProcess || '');
      const dataMovementType = row.dataMovementType || '';

      // 尝试1：重新生成（可能已经瘦身过）
      let newDesc = generateSemanticSubProcessDesc(row.subProcessDesc, funcProcess);
      newDesc = cleanNumberSuffix(newDesc);

      // 检查重新生成的描述是否还是重复
      const newKey = newDesc.toLowerCase().trim();
      if (seenSubProcessDescs.has(newKey)) {
        console.log(`  → 重新生成仍重复，尝试强制差异化...`);

        // 尝试2：添加业务差异化后缀（基于ERWX类型）
        const typeSuffixes = {
          'E': ['入口', '接收', '触发'],
          'R': ['查阅', '提取', '检索'],
          'W': ['存储', '保存', '登记'],
          'X': ['输出', '反馈', '应答']
        };
        const suffixList = typeSuffixes[dataMovementType] || ['操作', '处理', '执行'];

        // 提取功能过程的核心特征词（2-4字）
        const extractFeature = (process) => {
          const features = process.match(/(华为|中兴|爱立信|质差|优化|告警|健康度|评估|统计|汇总|日表|周表|月表)/);
          return features ? features[1] : process.slice(0, 4);
        };
        const feature = extractFeature(funcProcess);

        // 组合：原描述 + 特征词 + 类型后缀
        for (const suffix of suffixList) {
          const candidateDesc = `${newDesc.slice(0, 12)}${feature}${suffix}`.slice(0, 15);
          const candidateKey = candidateDesc.toLowerCase().trim();

          if (!seenSubProcessDescs.has(candidateKey)) {
            newDesc = candidateDesc;
            console.log(`  → 强制差异化成功: "${row.subProcessDesc}" -> "${newDesc}"`);
            break;
          }
        }

        // 尝试3：如果还是重复，添加功能过程核心关键词
        if (seenSubProcessDescs.has(newDesc.toLowerCase().trim())) {
          console.log(`  → 添加功能过程关键词...`);
          const coreKeyword = funcProcess.replace(/查询|创建|删除|修改|导出|导入|统计|配置/g, '').slice(0, 6);
          newDesc = `${newDesc.slice(0, 10)}${coreKeyword}`.slice(0, 15);
        }

        // 尝试4：兜底机制 - 添加计数序号（极少情况）
        const finalKey = newDesc.toLowerCase().trim();
        if (seenSubProcessDescs.has(finalKey)) {
          console.log(`  → 使用计数器兜底...`);
          const counter = (subProcessCounters.get(finalKey) || 1) + 1;
          subProcessCounters.set(finalKey, counter);

          // 添加序号，但用业务化的方式（不是简单的1、2、3）
          const counterSuffixes = ['二次', '备选', '辅助', '补充', '扩展'];
          const counterSuffix = counterSuffixes[Math.min(counter - 2, counterSuffixes.length - 1)];
          newDesc = `${newDesc.slice(0, 13)}${counterSuffix}`.slice(0, 15);

          console.log(`  → 兜底差异化: "${row.subProcessDesc}" -> "${newDesc}"`);
        }
      }

      if (newDesc !== row.subProcessDesc) {
        console.log(`✓ 子过程描述去重成功: "${row.subProcessDesc}" -> "${newDesc}"`);
        row = { ...row, subProcessDesc: newDesc };
      }
    }

    // 记录已使用的描述
    const finalKey = (row.subProcessDesc || '').toLowerCase().trim();
    seenSubProcessDescs.set(finalKey, { index, funcProcess: row.functionalProcess });

    return row;
  });

  const result = [];
  const seenDataGroups = new Map();
  const seenDataAttrs = new Map();
  const usedAttrFields = new Set(); // 跟踪所有已使用的字段，用于避免生成新的重复

  // 第一遍：收集所有重复项（完全相同）
  tableData.forEach((row, idx) => {
    const groupKey = (row.dataGroup || '').toLowerCase().trim();
    const attrKey = (row.dataAttributes || '').toLowerCase().trim();

    if (groupKey) {
      if (!seenDataGroups.has(groupKey)) {
        seenDataGroups.set(groupKey, { count: 0, indices: [], original: row.dataGroup });
      }
      const entry = seenDataGroups.get(groupKey);
      entry.count++;
      entry.indices.push(idx);
    }

    if (attrKey) {
      if (!seenDataAttrs.has(attrKey)) {
        seenDataAttrs.set(attrKey, { count: 0, indices: [], original: row.dataAttributes });
      }
      const entry = seenDataAttrs.get(attrKey);
      entry.count++;
      entry.indices.push(idx);

      // 记录所有字段到已使用集合
      attrKey.split(/[、,，|]/).forEach(f => {
        const field = f.trim().toLowerCase();
        if (field.length >= 2) usedAttrFields.add(field);
      });
    }
  });

  // 找出完全重复的数据组和数据属性
  const duplicateGroups = Array.from(seenDataGroups.entries()).filter(([_, v]) => v.count > 1);
  const duplicateAttrs = Array.from(seenDataAttrs.entries()).filter(([_, v]) => v.count > 1);

  console.log(`发现 ${duplicateGroups.length} 个完全重复数据组，${duplicateAttrs.length} 个完全重复数据属性`);

  // 第二遍：处理完全重复项 + 高重合度项
  for (let i = 0; i < tableData.length; i++) {
    const row = { ...tableData[i] };
    const groupKey = (row.dataGroup || '').toLowerCase().trim();
    const attrKey = (row.dataAttributes || '').toLowerCase().trim();

    // 处理完全重复的数据组
    if (groupKey && seenDataGroups.has(groupKey)) {
      const entry = seenDataGroups.get(groupKey);
      if (entry.count > 1) {
        const positionInDuplicates = entry.indices.indexOf(i);
        if (positionInDuplicates > 0) {
          const existingNames = result.map(r => r.dataGroup).filter(Boolean);
          const newName = await generateUniqueGroupName(
            row.dataGroup,
            row.subProcessDesc,
            row._parentProcess || row.functionalProcess || '',
            existingNames,
            positionInDuplicates
          );
          console.log(`数据组完全重复去重[${i}]: "${row.dataGroup}" -> "${newName}"`);
          row.dataGroup = newName;
        }
      }
    }

    // ========== 处理完全重复的数据属性 ==========
    if (attrKey && seenDataAttrs.has(attrKey)) {
      const entry = seenDataAttrs.get(attrKey);
      if (entry.count > 1) {
        const positionInDuplicates = entry.indices.indexOf(i);
        if (positionInDuplicates > 0) {
          const existingAttrs = result.map(r => r.dataAttributes).filter(Boolean);
          const newAttrs = await generateUniqueAttrString(
            row.dataAttributes,
            row.subProcessDesc,
            row._parentProcess || row.functionalProcess || '',
            existingAttrs,
            row.dataGroup,
            positionInDuplicates
          );
          console.log(`数据属性完全重复去重[${i}]: "${row.dataAttributes}" -> "${newAttrs}"`);
          row.dataAttributes = newAttrs;
        }
      }
    }

    // ========== 增强：检查与已处理行的高重合度（包括完全相同）==========
    // 关键修复：即使上面已经处理过完全重复，也要检查高重合度
    // 这样可以捕获那些字段略有不同但仍然高度重复的情况
    let needsDifferentiation = false;
    let maxOverlapRate = 0;

    for (const existingRow of result) {
      const overlapRate = calculateOverlapRate(row.dataAttributes, existingRow.dataAttributes);
      if (overlapRate > maxOverlapRate) {
        maxOverlapRate = overlapRate;
      }

      // 【修复】提高阈值到0.5（50%），避免过度去重导致添加过多无意义的差异化字段
      // 注意：如果完全相同（100%），上面已经处理过了，这里会再次增强
      if (overlapRate >= 0.5) {
        needsDifferentiation = true;
        console.log(`发现高重合度(${(overlapRate * 100).toFixed(0)}%): 行${i} "${row.dataAttributes?.slice(0, 30)}..." vs 已有行`);
        // 不要break，继续检查所有行，找到最大重合度
      }
    }

    if (needsDifferentiation) {
      console.log(`  → 最大重合度: ${(maxOverlapRate * 100).toFixed(0)}%，开始添加差异化字段`);
      // 添加差异化字段
      const enhancedAttrs = addDifferentiatingFields(
        row.dataAttributes,
        row.subProcessDesc,
        row._parentProcess || row.functionalProcess || '',
        row.dataMovementType,
        usedAttrFields
      );
      if (enhancedAttrs !== row.dataAttributes) {
        console.log(`高重合度去重[${i}]: "${row.dataAttributes}" -> "${enhancedAttrs}"`);
        row.dataAttributes = enhancedAttrs;
        // 更新已使用字段集合
        enhancedAttrs.split(/[、,，|]/).forEach(f => {
          const field = f.trim().toLowerCase();
          if (field.length >= 2) usedAttrFields.add(field);
        });
      }
    }

    result.push(row);
  }

  // ========== 最终清理：确保所有字段都不包含【】括号及其内容 ==========
  const finalCleanedResult = result.map(row => {
    const cleanBrackets = (text) => {
      if (!text) return text;
      return String(text)
        .replace(/【[^】]*】/g, '')
        .replace(/\[[^\]]*\]/g, '')
        .replace(/([\u4e00-\u9fa5]{2,4})\1+/g, '$1')
        .replace(/\s+/g, ' ')
        .trim();
    };

    return {
      ...row,
      functionalProcess: cleanBrackets(row.functionalProcess),
      subProcessDesc: cleanBrackets(row.subProcessDesc),
      dataGroup: cleanBrackets(row.dataGroup),
      dataAttributes: cleanBrackets(row.dataAttributes)
    };
  });

  console.log('========== 最终去重检查完成（增强版）==========');
  return finalCleanedResult;
}

// 生成唯一的数据组名称
async function generateUniqueGroupName(originalName, subProcessDesc, functionalProcess, existingNames, duplicateIndex) {
  // 从功能过程中提取动词关键词
  const actionVerbs = ['查询', '创建', '删除', '修改', '更新', '导出', '导入', '新增', '编辑', '审批', '审核', '提交', '撤销', '启用', '禁用', '配置', '设置', '分配', '取消', '生成', '保存', '读取', '搭建', '建立', '部署', '安装', '集成', '迁移', '初始化', '启动', '停止', '注册', '绑定', '解绑'];
  let processAction = '';
  for (const verb of actionVerbs) {
    if (functionalProcess.includes(verb)) {
      processAction = verb;
      break;
    }
  }

  // 根据子过程描述提取关键词
  const keywords = extractKeywords(subProcessDesc);
  const actionWord = keywords.action || '';
  const nounWord = keywords.noun || '';

  // 【关键修复】优化去重策略：避免动词出现在数据组开头
  const strategies = [
    () => `${originalName}·${nounWord || '详情'}`,
    () => `${functionalProcess.replace(/查询|导出|新增|修改|删除/g, '').slice(0, 8)}·${originalName}`,
    () => `${originalName}${nounWord || '表'}`,
    () => `${originalName}·${actionWord}${nounWord || '数据'}`,
    () => `${originalName}·模块${duplicateIndex + 1}`
  ];

  for (const strategy of strategies) {
    const candidate = strategy();
    // 再次清理动词，确保万无一失
    const cleanedCandidate = candidate ? candidate.replace(/^(查询|创建|删除|修改|导出|导入|统计|配置|新增|更新|生成|返回|获取)/, '').replace(/^[· ]+/, '') : null;

    if (cleanedCandidate && cleanedCandidate.length > 2 && !existingNames.some(n => n.toLowerCase() === cleanedCandidate.toLowerCase())) {
      return cleanedCandidate.slice(0, 25);
    }
  }

  // 最后兜底：使用名词化的功能过程名
  return `${functionalProcess.replace(/查询|导出|新增|修改|删除/g, '').slice(0, 10)}·${originalName}`.slice(0, 25);
}

// 生成唯一的数据属性字符串 - 增强版：根据E/R/W/X类型和功能过程生成具体的数据属性
async function generateUniqueAttrString(originalAttrs, subProcessDesc, functionalProcess, existingAttrs, dataGroup, duplicateIndex) {
  // 【关键修复】清理原有属性，如果原有属性看起来像个“数据组”名称（而不是列表），则丢弃它
  let fieldsArray = (originalAttrs || '').split(/[|,、，]/).map(f => f.trim()).filter(Boolean);

  // 如果只有一个字段且长度较长，或者包含“请求”、“相应”、“表”等字样，说明是AI混淆了数据组和属性
  if (fieldsArray.length === 1 && (fieldsArray[0].length > 5 || /请求|响应|界面|模块|表|数据组/.test(fieldsArray[0]))) {
    console.log(`⚠️ 检测到属性列混入数据组名称: "${fieldsArray[0]}"，清空重制`);
    fieldsArray = [];
  }

  // 从功能过程中提取业务关键词
  const extractBusinessKeywords = (process) => {
    if (!process) return '';
    const genericWords = ['查询', '创建', '删除', '修改', '导出', '导入', '统计', '分析', '配置', '设置', '获取', '更新', '生成', '汇总', '计算', '评估', '审核', '审批', '同步', '派发', '反馈'];
    let keywords = process;
    for (const word of genericWords) {
      keywords = keywords.replace(new RegExp(word, 'g'), '');
    }
    return keywords.trim().slice(0, 8) || process.slice(0, 6);
  };

  const businessKeyword = extractBusinessKeywords(functionalProcess);

  // 检测数据移动类型（E/R/W/X）
  let dataMovementType = '';
  if (subProcessDesc.includes('接收') || subProcessDesc.includes('触发')) {
    dataMovementType = 'E';
  } else if (subProcessDesc.includes('读取') || subProcessDesc.includes('获取') || subProcessDesc.includes('查询')) {
    dataMovementType = 'R';
  } else if (subProcessDesc.includes('写入') || subProcessDesc.includes('保存') || subProcessDesc.includes('记录') || subProcessDesc.includes('更新')) {
    dataMovementType = 'W';
  } else if (subProcessDesc.includes('返回') || subProcessDesc.includes('输出') || subProcessDesc.includes('响应')) {
    dataMovementType = 'X';
  }

  // 根据E/R/W/X类型生成不同的数据属性候选
  const erwxTemplates = {
    'E': [ // Entry - 输入型数据
      `${businessKeyword}请求ID`, `${businessKeyword}参数`, '操作标识', '请求时间', '用户令牌',
      '业务场景', '过滤条件', '排序维度', '触发源标识'
    ],
    'R': [ // Read - 读取型数据
      `${businessKeyword}ID`, `${businessKeyword}名称`, `${businessKeyword}类型`, '基本信息',
      '所属地市', '更新频率', '生效状态', '源端标识', '读取批次号'
    ],
    'W': [ // Write - 写入型数据
      `${businessKeyword}执行结果`, '处理状态', '操作流水', '更新耗时',
      '日志ID', '事务码', '持久化路径', '入库时间', '异常描述'
    ],
    'X': [ // Exit - 输出型数据
      '处理回执', `${businessKeyword}结果集`, '状态码', '结果总数', '分页游标',
      '响应时间', '成功标记', '输出流水', '提示原文'
    ]
  };

  // 获取当前类型的候选字段
  const typeSpecificCandidates = erwxTemplates[dataMovementType] || [];

  // 通用候选字段
  const generalCandidates = [
    `${businessKeyword}标识`, `${businessKeyword}编码`, `${businessKeyword}分类`,
    `${businessKeyword}详情`, '创建时间', '更新时间', '操作人员'
  ];

  // 构建完整的候选列表
  const allCandidates = [...new Set([...typeSpecificCandidates, ...generalCandidates])];

  // 确保至少有 3-4 个属性
  const targetCount = 4;

  // 添加新字段
  for (const candidate of allCandidates) {
    if (fieldsArray.length >= targetCount) break;

    const isDup = fieldsArray.some(f => f === candidate || f.includes(candidate) || candidate.includes(f));
    if (!isDup) fieldsArray.push(candidate);
  }

  // 兜底补齐：如果还不够，强制组合出 3 个
  while (fieldsArray.length < 3) {
    const fallback = [`${businessKeyword}ID`, `${businessKeyword}状态`, '记录时间'][fieldsArray.length];
    if (fallback && !fieldsArray.includes(fallback)) {
      fieldsArray.push(fallback);
    } else {
      fieldsArray.push(`业务字段${fieldsArray.length + 1}`);
    }
  }

  // 去重并清理
  fieldsArray = [...new Set(fieldsArray)].filter(f => f && f.length >= 2);
  return fieldsArray.slice(0, 8).join('、');
}

// 从子过程描述中提取关键词
function extractKeywords(subProcessDesc = '') {
  const cleaned = subProcessDesc
    .replace(/[\d]/g, '')
    .replace(/[，。、《》（）()？：；\-·]/g, ' ')
    .trim();

  const actionWords = ['查询', '读取', '写入', '删除', '更新', '新增', '修改', '获取', '提交', '保存', '导出', '导入', '分析', '统计', '处理', '审核', '验证', '确认', '接收', '返回', '初始化', '生成', '模拟', '导出'];

  let action = '';
  for (const word of actionWords) {
    if (cleaned.includes(word)) {
      action = word;
      break;
    }
  }

  const tokens = cleaned.split(/\s+/).filter(Boolean);
  const noun = tokens.find(t => t.length >= 2 && !actionWords.includes(t)) || '';

  return { action, noun };
}

// ========== 智能语义化子过程描述去重（增强版）==========
// 核心思路：将功能过程的业务关键词完整融入子过程描述，确保每个子过程描述唯一
// 增强：检测过于简单的描述，主动丰富业务内容
// 例如："查询华为小区质差数据" 的子过程 "接收请求参数" -> "接收华为小区质差查询请求"
// 例如："导出中兴小区指标报表" 的子过程 "读取数据" -> "读取中兴小区指标数据"
// ========== 增强版：智能关键词提取 + 子过程描述生成（10-15字精准控制）==========
function generateSemanticSubProcessDesc(originalDesc, functionalProcess) {
  if (!originalDesc || !functionalProcess) return originalDesc;

  // ===== 步骤1：从功能过程中智能提取核心业务关键词（修复版）=====
  const extractCoreKeywords = (process) => {
    if (!process) return { keywords: '', action: '' };

    // 只移除真正冗余的修饰词（大幅缩减）
    const redundantWords = [
      '功能', '模块', '界面', '过程', '流程', '相关'  // 只保留最冗余的词
    ];

    // 提取核心动词
    const actionVerbs = [
      '查询', '创建', '删除', '修改', '更新', '导出', '导入', '新增',
      '编辑', '审批', '审核', '提交', '撤销', '启用', '禁用', '配置',
      '设置', '分配', '取消', '发布', '生成', '同步', '备份', '恢复',
      '验证', '确认', '搭建', '建立', '部署', '安装', '集成', '迁移',
      '初始化', '启动', '停止', '注册', '绑定', '解绑', '汇总', '统计',
      '分析', '计算', '评估', '整合', '查看', '获取', '执行', '批量'
    ];

    let action = '';
    let businessCore = process;

    // 提取动词
    for (const verb of actionVerbs) {
      if (process.includes(verb)) {
        action = verb;
        // 分离动词前后的内容
        const verbIndex = process.indexOf(verb);
        const beforeVerb = process.slice(0, verbIndex);
        const afterVerb = process.slice(verbIndex + verb.length);
        // 业务核心 = 动词后的内容（优先）或动词前的内容
        // 修复：优先取动词后的内容，因为中文习惯是"动词+宾语"
        businessCore = afterVerb || beforeVerb;
        break;
      }
    }

    // 温和地移除冗余词（只移除最冗余的几个）
    for (const word of redundantWords) {
      businessCore = businessCore.replace(new RegExp(word, 'g'), '');
    }

    // 清理多余的空格
    businessCore = businessCore.trim();

    // 如果业务核心太短，尝试使用完整的功能过程名称（移除动词）
    if (businessCore.length < 4 && process.length > 4) {
      let fullCore = process;
      for (const verb of actionVerbs) {
        fullCore = fullCore.replace(verb, '');
      }
      for (const word of redundantWords) {
        fullCore = fullCore.replace(new RegExp(word, 'g'), '');
      }
      businessCore = fullCore.trim() || businessCore;
    }

    // 限制关键词长度（扩大为8-12字，保留更多信息）
    const finalKeywords = businessCore.slice(0, 12);

    return { keywords: finalKeywords, action };
  };

  // ===== 步骤2：检测子过程描述的类型（E/R/W/X）=====
  const detectSubProcessType = (desc) => {
    if (desc.includes('接收') || desc.includes('触发')) return 'E';
    if (desc.includes('读取') || desc.includes('获取') || desc.includes('查询')) return 'R';
    if (desc.includes('写入') || desc.includes('保存') || desc.includes('记录') || desc.includes('更新') || desc.includes('生成')) return 'W';
    if (desc.includes('返回') || desc.includes('输出') || desc.includes('响应')) return 'X';
    return '';
  };

  // ===== 步骤3：根据类型选择合适的动词和后缀 =====
  const getOptimalVerbAndSuffix = (type, action, funcProcess) => {
    const templates = {
      'E': { verbs: ['接收'], suffixes: ['请求', '参数', '指令'] },
      'R': { verbs: ['读取', '获取', '查询'], suffixes: ['配置', '规则', '数据表'] },
      'W': { verbs: ['记录', '生成', '写入'], suffixes: ['日志', '结果', '文件'] },
      'X': { verbs: ['返回', '输出'], suffixes: ['结果', '响应', '数据'] }
    };

    // 如果类型未识别，根据功能过程的动词来推断
    let effectiveType = type;
    if (!effectiveType && funcProcess) {
      // 根据功能过程的动词推断子过程类型
      if (funcProcess.match(/^(查询|查看|获取|统计|分析)/)) effectiveType = 'E'; // 查询类功能的E
      else if (funcProcess.match(/^(创建|新增|添加)/)) effectiveType = 'E'; // 创建类功能的E
      else if (funcProcess.match(/^(修改|编辑|更新)/)) effectiveType = 'E'; // 修改类功能的E  
      else if (funcProcess.match(/^(删除|移除)/)) effectiveType = 'E'; // 删除类功能的E
      else if (funcProcess.match(/^(导出|下载)/)) effectiveType = 'E'; // 导出类功能的E
      else if (funcProcess.match(/^(导入|上传)/)) effectiveType = 'E'; // 导入类功能的E
      else if (funcProcess.match(/^(启用|禁用|执行|批量)/)) effectiveType = 'E'; // 操作类功能的E
      else effectiveType = 'E'; // 默认按E处理（入口）
    }

    // 确保有有效的模板（绝不使用"处理"作为动词）
    const template = templates[effectiveType] || templates['E']; // 兜底使用E类型，而不是"处理"
    const verb = template.verbs[0]; // 取第一个作为默认动词

    // 根据功能过程的动作类型选择后缀
    let suffix = template.suffixes[0];
    if (action === '查询' || action === '统计') suffix = template.suffixes[0] || '条件';
    if (action === '导出') suffix = '文件';
    if (action === '创建' || action === '新增') suffix = '记录';

    return { verb, suffix };
  };

  // ===== 步骤4：智能生成精简的子过程描述 =====
  const { keywords, action } = extractCoreKeywords(functionalProcess);
  const type = detectSubProcessType(originalDesc);
  const { verb, suffix } = getOptimalVerbAndSuffix(type, action, functionalProcess);

  // 检查是否需要重新生成（原描述太简单或太长）
  const needsRegeneration =
    originalDesc.length < 8 ||
    originalDesc.length > 15 ||
    /^(接收|读取|写入|返回)(请求|数据|结果)$/.test(originalDesc);

  if (!needsRegeneration && originalDesc.length >= 10 && originalDesc.length <= 15) {
    // 原描述长度合适且不太简单，保留
    return originalDesc;
  }

  // 生成新描述：动词 + 核心关键词 + 后缀
  // 确保总长度在10-15字之间
  let newDesc = `${verb}${keywords}${suffix}`;

  // 精确控制长度
  if (newDesc.length < 10) {
    // 太短，补充更多业务信息
    const extraInfo = action || functionalProcess.slice(0, 4);
    newDesc = `${verb}${keywords}${extraInfo}${suffix}`;
  }

  // 最终截断到15字
  newDesc = newDesc.slice(0, 15);

  // 确保不少于10字（兜底）
  if (newDesc.length < 10 && keywords.length > 0) {
    // 补充原描述的部分内容
    const originalSuffix = originalDesc.replace(verb, '').slice(0, 5);
    newDesc = (verb + keywords + originalSuffix).slice(0, 15);
  }

  return newDesc;
}

// 在子过程描述中插入功能过程关键词（保留原函数作为备用）
function insertProcessKeyword(subProcessDesc, processKeyword) {
  // 常见的动词前缀
  const actionPrefixes = ['接收', '读取', '查询', '获取', '保存', '写入', '更新', '删除', '返回', '输出', '生成', '执行', '处理', '验证', '确认', '提交', '导出', '导入', '调用'];

  for (const prefix of actionPrefixes) {
    if (subProcessDesc.startsWith(prefix)) {
      // 在动词后插入功能过程关键词
      const rest = subProcessDesc.slice(prefix.length);
      // 如果剩余部分已经包含关键词，则不重复插入
      if (rest.includes(processKeyword)) {
        return subProcessDesc;
      }
      return `${prefix}${processKeyword}${rest}`;
    }
  }

  // 如果没有匹配到动词前缀，直接在开头添加关键词
  return `${processKeyword}${subProcessDesc}`;
}

function ensureMinimumAttributes(attrStr = '', functionalProcess = '', subProcessDesc = '') {
  const fields = Array.from(
    new Set(
      attrStr
        .split(/[|,、，]/)
        .map(f => f.trim())
        .filter(Boolean)
    )
  );

  // 从功能过程中提取业务关键词（去除通用动词）
  const extractBusinessObject = (process) => {
    if (!process) return '';
    const verbs = ['查询', '创建', '删除', '修改', '导出', '导入', '统计', '分析', '配置', '生成', '汇总'];
    let result = process;
    for (const verb of verbs) {
      result = result.replace(verb, '');
    }
    return result.trim().slice(0, 6) || process.slice(0, 6);
  };

  const businessObj = extractBusinessObject(functionalProcess);

  // 检测E/R/W/X类型
  let moveType = '';
  if (subProcessDesc.includes('接收') || subProcessDesc.includes('触发')) {
    moveType = 'E';
  } else if (subProcessDesc.includes('读取') || subProcessDesc.includes('获取') || subProcessDesc.includes('查询')) {
    moveType = 'R';
  } else if (subProcessDesc.includes('写入') || subProcessDesc.includes('保存') || subProcessDesc.includes('记录') || subProcessDesc.includes('更新')) {
    moveType = 'W';
  } else if (subProcessDesc.includes('返回') || subProcessDesc.includes('输出') || subProcessDesc.includes('响应')) {
    moveType = 'X';
  }

  // 根据类型生成候选属性
  const typeCandidates = {
    'E': [`${businessObj}请求ID`, '操作人标识', '请求时间', '查询条件', '操作权限'],
    'R': [`${businessObj}ID`, `${businessObj}名称`, '数据版本', '读取时间', '来源标识'],
    'W': [`${businessObj}操作类型`, '操作时间', '操作人', '日志ID', '变更内容'],
    'X': ['响应状态', `${businessObj}结果`, '处理耗时', '返回记录数', '成功标识']
  };

  const candidates = typeCandidates[moveType] || [
    `${businessObj}标识`,
    `${businessObj}编号`,
    '操作参数',
    '处理结果',
    '记录时间',
    '更新时间',
    '操作人',
    '状态标记'
  ];

  for (const candidate of candidates) {
    if (fields.length >= 4) break;
    if (candidate && !fields.includes(candidate) && !fields.some(f => f.includes(candidate) || candidate.includes(f))) {
      fields.push(candidate);
    }
  }

  // 兜底：如果仍然不足3个，使用通用字段
  const fallback = ['记录编号', '业务描述', '处理时间', 'ID', '参数', '编号', '处理状态'];
  for (const candidate of fallback) {
    if (fields.length >= 3) break;
    if (!fields.includes(candidate)) {
      fields.push(candidate);
    }
  }

  return fields.slice(0, Math.max(fields.length, 3)).join('、');
}

// 解析Markdown表格为结构化数据
app.post('/api/parse-table', async (req, res) => {
  try {
    const { markdown } = req.body;

    if (!markdown) {
      return res.status(400).json({ error: '无Markdown内容' });
    }

    // 提取表格内容
    const tableMatch = markdown.match(/\|[^\n]+\|[\s\S]*?\|[^\n]+\|/g);
    if (!tableMatch) {
      return res.status(400).json({ error: '未找到有效的Markdown表格' });
    }

    const rawLines = markdown.split('\n');
    const lines = rawLines.filter(line => line.trim().startsWith('|'));

    if (lines.length < 3) {
      return res.status(400).json({ error: '表格数据不完整' });
    }

    // 跳过表头和分隔行
    const dataLines = lines.slice(2);

    let currentFunctionalUser = '';
    let currentTriggerEvent = '';
    let currentFunctionalProcess = '';
    const pendingRows = [];

    // 清理文本：去除序号(2)、(3)等，替换连字符，去除【】括号及其内容，清理重复词
    const sanitizeText = (value = '') => {
      if (!value) return '';
      let text = String(value)
        .replace(/\(\d+\)/g, '')  // 去除 (2)、(3) 等序号
        .replace(/（\d+）/g, '')  // 去除中文括号序号
        .replace(/【[^】]*】/g, '')  // 去除【xxx】标签（包括内容）- 修正正则
        .replace(/\[[^\]]*\]/g, '')  // 去除[xxx]标签（包括内容）- 修正正则
        .replace(/-/g, '·')
        .replace(/\s+/g, ' ')
        .trim();

      // 清理重复词：如"读取读取"、"保存保存"、"查询查询"等
      // 匹配中文词汇重复的情况
      const commonVerbs = ['读取', '保存', '查询', '获取', '写入', '删除', '更新', '修改', '创建', '新增', '提交', '返回', '接收', '发送', '校验', '验证', '检查', '计算', '统计', '分析', '处理', '执行', '调用', '触发', '启动', '停止', '暂停', '恢复', '取消', '确认', '审批', '审核', '导出', '导入', '上传', '下载', '配置', '设置', '编辑'];

      for (const verb of commonVerbs) {
        // 匹配连续重复的动词，替换为单个
        const duplicatePattern = new RegExp(`(${verb})\\1+`, 'g');
        text = text.replace(duplicatePattern, verb);
      }

      // 通用重复词检测：匹配任意2-4个汉字的重复
      text = text.replace(/([\u4e00-\u9fa5]{2,4})\1+/g, '$1');

      return text;
    };

    // 🔧 清洗数据属性：将英文字段名转为中文，将英文逗号转为顿号
    const cleanDataAttributes = (attrs = '') => {
      if (!attrs) return '';

      // 英文字段名到中文的映射
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
        'AVG_TCP_RET_DATA': '平均TCP重传', 'avg_tcp_ret_data': '平均TCP重传',
        'TCP_ESTB_ACK_LAT': 'TCP建链确认时延', 'tcp_estb_ack_lat': 'TCP建链确认时延',
        'TCP_ESTB_RSP_LAT': 'TCP建链响应时延', 'tcp_estb_rsp_lat': 'TCP建链响应时延',
        'SESN_ACK_FIR_DAT_LAT': '首包确认时延', 'sesn_ack_fir_dat_lat': '首包确认时延',
        'UL_SESN_RATE_KBPS': '上行会话速率', 'ul_sesn_rate_kbps': '上行会话速率',
        'DL_SESN_RATE_KBPS': '下行会话速率', 'dl_sesn_rate_kbps': '下行会话速率',
        'AVG_TCP_ORD_PKT_CNT': '平均有序包数', 'avg_tcp_ord_pkt_cnt': '平均有序包数',
        'AVG_TCP_LST_PKT_CNT': '平均丢包数', 'avg_tcp_lst_pkt_cnt': '平均丢包数',
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
        'total_traffic_gb': '总流量', 'TOTAL_TRAFFIC_GB': '总流量',
        'FILE_NAME': '文件名称', 'file_name': '文件名称',
        'CELL_NAME': '小区名称', 'cell_name': '小区名称',
      };

      let cleaned = attrs;

      // 1. 替换已知的英文字段名为中文
      for (const [eng, chn] of Object.entries(fieldMapping)) {
        const regex = new RegExp(`\\b${eng}\\b`, 'gi');
        cleaned = cleaned.replace(regex, chn);
      }

      // 2. 将英文逗号替换为中文顿号
      cleaned = cleaned.replace(/,\s*/g, '、');

      // 3. 将 | 分隔符替换为顿号
      cleaned = cleaned.replace(/\s*\|\s*/g, '、');

      // 4. 清理多余的顿号
      cleaned = cleaned.replace(/、+/g, '、');
      cleaned = cleaned.replace(/^、|、$/g, '');

      // 5. 截断过长的属性列表（最多保留8个字段）
      const fields = cleaned.split('、').map(f => f.trim()).filter(f => f);
      if (fields.length > 8) {
        cleaned = fields.slice(0, 8).join('、');
      }

      return cleaned;
    };

    // 🔧 增强子过程描述 - 确保包含功能过程关键词，不要太简单
    const enhanceSubProcessDesc = (desc = '', functionalProcess = '') => {
      if (!desc) return desc;

      // 从功能过程中提取核心业务关键词
      const extractBusinessKeywords = (process) => {
        if (!process) return [];
        // 移除通用动词，保留业务对象
        const genericVerbs = ['查询', '创建', '删除', '修改', '导出', '导入', '统计', '分析', '配置', '设置', '获取', '更新', '新增', '编辑', '审批', '审核', '生成', '同步', '汇总', '计算', '评估'];
        let businessPart = process;
        for (const verb of genericVerbs) {
          businessPart = businessPart.replace(verb, '');
        }
        // 分割并过滤有意义的词
        const keywords = businessPart.split(/[，、\s]+/).filter(w => w.length >= 2 && w.length <= 8);
        return keywords.slice(0, 3); // 最多保留3个关键词
      };

      const businessKeywords = extractBusinessKeywords(functionalProcess);
      const mainKeyword = businessKeywords.length > 0 ? businessKeywords.join('') : '';

      // 检查子过程描述是否太简单（通用模板或太短）
      const tooSimplePatterns = [
        /^接收.*?请求(参数)?$/,
        /^接收.*?(?:整合|汇总|统计|评估|分析)?请求$/,
        /^读取.*?数据$/,
        /^读取(华为|中兴|爱立信|诺基亚)?数据$/,  // 厂商+数据
        /^写入.*?结果$/,
        /^写入整合结果$/,
        /^保存.*?结果$/,
        /^返回.*?结果$/,
        /^返回.*?响应$/,
        /^查询.*?数据$/,
        /^获取.*?数据$/,
        /^获取.*?信息$/,
        /^记录.*?日志$/,
        /^写入.*?记录$/,
        /^.{2,4}(数据|请求|结果|响应|信息|日志|记录)$/  // 3-5字的简短描述
      ];

      // 检查是否太简单：匹配模式或长度太短
      const isSimple = tooSimplePatterns.some(p => p.test(desc)) || desc.length < 10;

      // 如果描述太简单且有业务关键词，则增强
      if (isSimple && mainKeyword) {
        const actionPrefixes = ['接收', '读取', '查询', '获取', '保存', '记录', '写入', '更新', '删除', '返回', '输出', '生成', '调用', '执行'];

        for (const prefix of actionPrefixes) {
          if (desc.startsWith(prefix)) {
            const rest = desc.slice(prefix.length);

            // 检查剩余部分是否已包含业务关键词的核心部分（至少4个字符）
            const keywordCore = mainKeyword.length >= 4 ? mainKeyword.slice(0, 4) : mainKeyword;
            if (rest.includes(keywordCore)) {
              // 已有业务关键词但可能不完整，检查是否需要补充更多上下文
              if (desc.length < 12) {
                // 太短，补充动作类型
                const actionSuffix = {
                  '接收': '请求参数', '读取': '配置数据', '查询': '业务数据',
                  '保存': '处理结果', '记录': '操作日志', '返回': '响应结果'
                };
                return `${prefix}${mainKeyword}${actionSuffix[prefix] || rest}`;
              }
              return desc;
            }

            // 在动词后插入完整业务关键词
            // 例如："读取华为数据" + "小区业务感知健康度评估" -> "读取小区业务感知健康度评估华为数据"
            const enhancedDesc = `${prefix}${mainKeyword}${rest}`;
            console.log(`子过程描述增强: "${desc}" -> "${enhancedDesc}"`);
            return enhancedDesc;
          }
        }
        // 没有匹配到动词前缀，在开头添加业务关键词
        return `${mainKeyword}${desc}`;
      }

      // 原有的简化逻辑（保留但不过度简化）
      if (desc.length > 30) {
        let simplified = desc
          .replace(/接收.*?数据.*?[，,].*?生成.*/, (m) => {
            const match = m.match(/接收(.{2,10}?).*?数据/);
            return match ? `接收${match[1]}数据` : desc;
          })
          .replace(/读取.*?相关.*?配置.*?数据/, (m) => {
            const match = m.match(/读取(.{2,10}?)(相关|基础|配置)/);
            return match ? `读取${match[1]}配置数据` : desc;
          });
        return simplified;
      }

      return desc;
    };

    // 保留旧名称的兼容性
    const simplifySubProcessDesc = (desc = '') => enhanceSubProcessDesc(desc, currentFunctionalProcess);

    const normalizeCells = (line) => {
      // 保留所有单元格，包括空的（用于合并单元格）
      const rawCells = line.split('|');
      // 去掉首尾的空字符串（由于 | 开头和结尾产生）
      if (rawCells.length > 0 && rawCells[0].trim() === '') rawCells.shift();
      if (rawCells.length > 0 && rawCells[rawCells.length - 1].trim() === '') rawCells.pop();
      return rawCells.map(cell => cell.trim());
    };

    // ========== 智能判断功能触发类型 ==========
    // 核心原则：看功能的"启动源"是什么！
    // - 用户触发：用户点击按钮、提交表单等显式操作发起的（即使是后台执行的耗时任务）
    // - 时钟触发：系统按预设时间自动执行的（必须有明确的定时/周期关键词）
    // - 接口触发：外部系统推送/回调触发的
    const intelligentTriggerAnalysis = (functionalProcess = '') => {
      const process = functionalProcess.trim();

      // ===== 第一优先级：时钟触发 =====
      // 必须有明确的定时/周期/自动执行关键词
      // 这类功能是系统按时间自动执行的，无需用户干预
      const timerPatterns = [
        /定时/,           // 定时清理、定时同步、定时统计
        /周期/,           // 周期执行、周期检查
        /每日/,           // 每日统计、每日报表
        /每周/,           // 每周汇总
        /每月/,           // 每月报告
        /每年/,           // 每年归档
        /每小时/,         // 每小时刷新
        /自动执行/,       // 自动执行任务
        /自动清理/,       // 自动清理日志
        /自动同步/,       // 自动同步数据
        /自动备份/,       // 自动备份数据库
        /自动生成/,       // 自动生成报表
        /自动刷新/,       // 自动刷新缓存
        /自动推送/,       // 自动推送消息
        /凌晨/,           // 凌晨执行
        /夜间/,           // 夜间处理
        /定期/,           // 定期备份、定期清理
      ];

      for (const pattern of timerPatterns) {
        if (pattern.test(process)) {
          return { user: '时钟触发', trigger: '定时任务' };
        }
      }

      // ===== 第二优先级：接口触发 =====
      // 只有外部系统推送/回调才是接口触发
      const interfacePatterns = [
        /接收.*推送/,     // 接收外部推送
        /接收.*通知/,     // 接收系统通知
        /接收.*回调/,     // 接收回调
        /Webhook/i,       // Webhook回调
        /回调处理/,       // 处理回调
        /外部.*推送/,     // 外部系统推送
        /第三方.*推送/,   // 第三方推送
        /消息队列/,       // 消息队列消费
        /事件监听/,       // 事件监听
      ];

      for (const pattern of interfacePatterns) {
        if (pattern.test(process)) {
          return { user: '接口触发', trigger: '接口调用' };
        }
      }

      // ===== 默认：用户触发 =====
      // 所有用户点击按钮发起的操作都是用户触发
      // 包括：查询、创建、编辑、删除、搭建、加工、批量处理等
      // 即使是后台执行的耗时任务，只要是用户发起的，就是用户触发
      return { user: '用户触发', trigger: '用户请求' };
    };

    const normalizeUserTrigger = (userVal = '', triggerVal = '', functionalProcess = '') => {
      const user = (userVal || '').trim();
      const trigger = (triggerVal || '').trim();

      // 如果已经有明确的触发类型，优先使用
      if (/用户|前台|界面/.test(user)) return { user: '用户触发', trigger: trigger || '用户请求' };
      if (/时钟|定时/.test(user)) return { user: '时钟触发', trigger: trigger || '定时任务' };
      if (/接口|事件|队列|Webhook/i.test(user)) return { user: '接口触发', trigger: trigger || '接口调用' };
      if (/用户|前台|界面/.test(trigger)) return { user: '用户触发', trigger: trigger || '用户请求' };
      if (/定时|周期/.test(trigger)) return { user: '时钟触发', trigger: trigger || '定时任务' };
      if (/接口|事件|队列|Webhook/i.test(trigger)) return { user: '接口触发', trigger: trigger || '接口调用' };

      // 如果没有明确的触发类型，根据功能过程智能判断
      if (functionalProcess) {
        return intelligentTriggerAnalysis(functionalProcess);
      }

      return { user: user || '用户触发', trigger: trigger || '用户请求' };
    };

    dataLines.forEach((line, rowIdx) => {
      const cells = normalizeCells(line);
      console.log(`行 ${rowIdx}: cells.length=${cells.length}, cells=`, cells.slice(0, 7));

      // 只要有足够的列就处理（合并单元格时前几列可能为空）
      if (cells.length >= 4) {
        let subProcessDesc = cells[3] || '';
        let dataMovementType = cells[4] || '';
        let dataGroup = cells[5] || '';
        let dataAttributes = cells[6] || '';

        const moveSet = new Set(['E', 'R', 'W', 'X']);
        const normalizedMove = (dataMovementType || '').toUpperCase();
        if (!moveSet.has(normalizedMove)) {
          const idx = cells.findIndex(cell => moveSet.has((cell || '').toUpperCase()));
          if (idx !== -1) {
            dataMovementType = (cells[idx] || '').toUpperCase();
            subProcessDesc = cells[idx - 1] || subProcessDesc;
            dataGroup = cells[idx + 1] || dataGroup;
            const attrCells = cells.slice(idx + 2);
            dataAttributes = attrCells.filter(Boolean).join(' | ') || dataAttributes;
          }
        } else {
          dataMovementType = normalizedMove;
        }

        // 如果仍然缺失，尝试从行数推断
        if (!dataMovementType) {
          const fallbackIdx = cells.findIndex(cell => moveSet.has((cell || '').toUpperCase()));
          if (fallbackIdx !== -1) {
            dataMovementType = (cells[fallbackIdx] || '').toUpperCase();
          }
        }

        // 【关键修正】处理功能过程与子过程的层级关系
        // 规则：只有 E 类型的行才有新的功能过程名称，R/W/X 行继承上一个 E 行的功能过程
        // 但在数据中保留完整信息用于统计，前端显示时再处理留空逻辑
        let rowFunctionalProcess = '';
        let rowFunctionalUser = '';
        let rowTriggerEvent = '';

        if (dataMovementType === 'E') {
          // E 类型行：如果有功能过程名称，更新当前功能过程
          if (cells[2]) {
            currentFunctionalProcess = cells[2];
          }
          // 智能判断触发类型：传入功能过程名称进行分析
          const normalized = normalizeUserTrigger(cells[0], cells[1], currentFunctionalProcess);
          if (cells[0] || cells[1] || currentFunctionalProcess) {
            currentFunctionalUser = normalized.user;
            currentTriggerEvent = normalized.trigger;
          }

          // E行显示完整信息
          rowFunctionalProcess = currentFunctionalProcess;
          rowFunctionalUser = normalized.user || currentFunctionalUser;
          rowTriggerEvent = normalized.trigger || currentTriggerEvent;
        } else {
          // R/W/X 类型行：继承上一个E行的功能过程（用于统计和去重）
          // 但前端显示时这三列应该留空（符合COSMIC规范）
          if (cells[2] && cells[2] !== currentFunctionalProcess) {
            console.log(`修正: 行 ${rowIdx} 的功能过程 "${cells[2]}" 属于当前功能过程: "${currentFunctionalProcess}"`);
          }
          // 数据中保留完整信息用于统计，前端显示时根据 dataMovementType 判断是否显示
          rowFunctionalProcess = currentFunctionalProcess; // 保留用于统计
          // R/W/X行继承E行的触发类型（已经根据功能过程智能判断过了）
          rowFunctionalUser = currentFunctionalUser; // 保留用于统计
          rowTriggerEvent = currentTriggerEvent; // 保留用于统计
        }

        // 如果数据组或数据属性缺失，自动拼接功能过程+子过程描述，尽量保持唯一
        if (!dataGroup) {
          dataGroup = `${currentFunctionalProcess || '功能过程'}·${subProcessDesc || '数据'}`;
        }

        if (!dataAttributes) {
          dataAttributes = `${currentFunctionalProcess || '功能过程'}ID | ${subProcessDesc || '子过程'}字段 | 记录时间`;
        }

        dataAttributes = ensureMinimumAttributes(dataAttributes, currentFunctionalProcess, subProcessDesc);

        // 清理所有文本字段中的【】标签和序号
        subProcessDesc = sanitizeText(subProcessDesc);
        dataGroup = sanitizeText(dataGroup);
        dataAttributes = sanitizeText(dataAttributes);
        // 同时清理功能过程名称中的【】标签
        if (currentFunctionalProcess) {
          currentFunctionalProcess = sanitizeText(currentFunctionalProcess);
        }
        rowFunctionalProcess = sanitizeText(rowFunctionalProcess);

        // 🔧 应用数据属性清洗（英文转中文、逗号转顿号、截断过长）
        dataAttributes = cleanDataAttributes(dataAttributes);

        // 🔧 增强子过程描述 - 确保包含完整的业务上下文
        subProcessDesc = enhanceSubProcessDesc(subProcessDesc, currentFunctionalProcess);

        // 🔧 增强数据组名称 - 确保数据组不太简单
        const enhanceDataGroup = (group, process, subDesc, moveType) => {
          if (!group) return group;

          // 检测是否是过于简单的数据组名称
          const tooSimpleDataGroups = [
            /^(华为|中兴|爱立信|诺基亚)?数据$/,
            /^(整合|汇总|统计|分析|评估|查询|导出)?结果$/,
            /^(请求|响应|配置|参数)$/,
            /^.{1,4}数据$/,  // 太短的"XX数据"
            /^.{1,4}请求$/,  // 太短的"XX请求"
            /^.{1,4}结果$/,  // 太短的"XX结果"
            /^.{1,4}表$/     // 太短的"XX表"
          ];

          const isSimple = tooSimpleDataGroups.some(p => p.test(group)) || group.length < 6;

          if (!isSimple) return group;

          // 从功能过程中提取业务关键词
          const extractBusiness = (text) => {
            if (!text) return '';
            const verbs = ['查询', '创建', '删除', '修改', '导出', '导入', '统计', '分析', '配置', '设置', '获取', '更新', '生成', '汇总', '计算', '评估', '审核', '整合'];
            let result = text;
            for (const v of verbs) {
              result = result.replace(v, '');
            }
            return result.trim().slice(0, 10) || text.slice(0, 8);
          };

          const businessPart = extractBusiness(process);

          // 根据数据移动类型添加不同后缀
          const typeSuffixes = {
            'E': '请求参数表',
            'R': '数据源表',
            'W': '操作记录表',
            'X': '响应结果表'
          };
          const suffix = typeSuffixes[moveType] || '数据表';

          // 如果数据组已包含业务对象的部分内容，只添加后缀
          if (businessPart && group.includes(businessPart.slice(0, 3))) {
            // 已有部分业务关键词，补充类型后缀
            if (!group.includes('表') && !group.includes('结果') && !group.includes('请求')) {
              return `${group}${suffix.replace('表', '')}`;
            }
            return group;
          }

          // 构建增强后的数据组名称
          const enhanced = `${businessPart}${group}`.slice(0, 20);
          console.log(`数据组增强: "${group}" -> "${enhanced}"`);
          return enhanced;
        };

        dataGroup = enhanceDataGroup(dataGroup, currentFunctionalProcess, subProcessDesc, dataMovementType);

        // 如果数据组名称太简单（少于5个字符），自动补充功能过程关键词
        if (dataGroup && dataGroup.length < 5) {
          const processKeyword = currentFunctionalProcess.slice(0, 6) || '业务';
          dataGroup = `${processKeyword}·${dataGroup}`;
          console.log(`数据组名称过短，已补充: ${dataGroup}`);
        }

        // 记录待处理的行数据，稍后统一处理重复
        pendingRows.push({
          functionalUser: rowFunctionalUser,
          triggerEvent: rowTriggerEvent,
          functionalProcess: rowFunctionalProcess,
          subProcessDesc,
          dataMovementType,
          dataGroup,
          dataAttributes,
          rowIdx,
          _parentProcess: currentFunctionalProcess // 内部使用，记录所属的功能过程
        });
      }
    });

    // 第1.5遍：验证每个功能过程的子过程完整性
    // 核心原则：每个功能过程必须有完整的 E + R + W + X 四个子过程
    const processSubMap = new Map(); // 记录每个功能过程的子过程

    // 先按功能过程分组
    for (const row of pendingRows) {
      const processName = row._parentProcess || row.functionalProcess || '';
      if (!processSubMap.has(processName)) {
        processSubMap.set(processName, []);
      }
      processSubMap.get(processName).push(row);
    }

    const filteredRows = [];

    // 对每个功能过程进行验证和处理
    for (const [processName, rows] of processSubMap.entries()) {
      // 统计各类型子过程
      const typeCount = { E: 0, R: 0, W: 0, X: 0 };
      const typeRows = { E: [], R: [], W: [], X: [] };

      for (const row of rows) {
        const moveType = (row.dataMovementType || '').toUpperCase();
        if (typeCount.hasOwnProperty(moveType)) {
          typeCount[moveType]++;
          typeRows[moveType].push(row);
        }
      }

      // 检查完整性 - 必须有E、R、W、X四种类型
      const hasE = typeCount.E > 0;
      const hasR = typeCount.R > 0;
      const hasW = typeCount.W > 0;
      const hasX = typeCount.X > 0;

      if (!hasE || !hasR || !hasW || !hasX) {
        console.log(`功能过程"${processName}"子过程不完整: E=${typeCount.E}, R=${typeCount.R}, W=${typeCount.W}, X=${typeCount.X}`);
      }

      // 保留所有子过程，每种类型保留1个
      let keptRows = [];

      // 保留E（1个）
      if (typeRows.E.length > 0) {
        keptRows.push(typeRows.E[0]);
      }

      // 保留R（1个）
      if (typeRows.R.length > 0) {
        keptRows.push(typeRows.R[0]);
      }

      // 保留W（1个）
      if (typeRows.W.length > 0) {
        keptRows.push(typeRows.W[0]);
      }

      // 保留X（1个）
      if (typeRows.X.length > 0) {
        keptRows.push(typeRows.X[0]);
      }

      // 按正确顺序排序（E -> R -> W -> X）
      keptRows.sort((a, b) => {
        const order = { E: 0, R: 1, W: 2, X: 3 };
        const aOrder = order[(a.dataMovementType || '').toUpperCase()] ?? 99;
        const bOrder = order[(b.dataMovementType || '').toUpperCase()] ?? 99;
        return aOrder - bOrder;
      });

      filteredRows.push(...keptRows);

      if (rows.length !== keptRows.length) {
        console.log(`功能过程"${processName}": ${rows.length} -> ${keptRows.length} 条子过程`);
      }
    }

    console.log(`子过程验证完成: ${pendingRows.length} -> ${filteredRows.length} 条`);

    // 第二遍：处理重复的子过程描述、数据组和数据属性（调用AI智能去重）
    const tableData = [];
    const seenSubProcessMap = new Map(); // 记录已出现的子过程描述及其来源
    const seenGroupsMap = new Map(); // 记录已出现的数据组及其来源
    const seenAttrsMap = new Map();  // 记录已出现的数据属性及其来源

    for (const row of filteredRows) {
      let { dataGroup, dataAttributes, subProcessDesc, functionalProcess, _parentProcess } = row;
      // 使用 _parentProcess 作为实际的功能过程名称（用于去重和生成）
      // 先清理【】括号
      const actualProcess = sanitizeText(_parentProcess || functionalProcess || '');

      // 处理子过程描述重复 - 使用智能语义化去重
      const subProcessKey = subProcessDesc.toLowerCase().trim();
      if (subProcessKey && seenSubProcessMap.has(subProcessKey)) {
        // 使用智能语义化去重函数，将功能过程的业务动作自然融入子过程描述
        let newSubProcessDesc = generateSemanticSubProcessDesc(subProcessDesc, actualProcess);
        // 再次清理生成的新描述
        newSubProcessDesc = sanitizeText(newSubProcessDesc);
        if (newSubProcessDesc !== subProcessDesc) {
          console.log(`子过程描述语义化去重: "${subProcessDesc}" -> "${newSubProcessDesc}"`);
          subProcessDesc = newSubProcessDesc;
        }
      }
      seenSubProcessMap.set(subProcessDesc.toLowerCase().trim(), { name: subProcessDesc, process: actualProcess });

      // 处理数据组重复 - 直接结合关键词生成新名称，不使用括号
      const groupKey = dataGroup.toLowerCase();
      if (seenGroupsMap.has(groupKey)) {
        const existingNames = Array.from(seenGroupsMap.values()).map(v => v.name);
        // 调用AI生成新的完整名称（关键词+原内容结合）
        const newName = await aiGenerateUniqueName(dataGroup, subProcessDesc, actualProcess, existingNames);
        console.log(`数据组去重: "${dataGroup}" -> "${newName}"`);
        dataGroup = newName;
      }
      seenGroupsMap.set(dataGroup.toLowerCase(), { name: dataGroup, desc: subProcessDesc });

      // 处理数据属性重复 - 将新生成的字段添加到原有字段中，并打乱顺序
      const attrKey = dataAttributes.toLowerCase();
      if (seenAttrsMap.has(attrKey)) {
        const existingNames = Array.from(seenAttrsMap.values()).map(v => v.name);
        // 调用专门的属性去重函数，生成新字段名
        const newFieldName = await aiGenerateUniqueAttrName(dataAttributes, subProcessDesc, actualProcess, existingNames, dataGroup);

        // 将原有字段拆分成数组（支持 | 或 , 或 、 分隔）
        let fieldsArray = dataAttributes.split(/[|,、]/).map(f => f.trim()).filter(Boolean);

        // 将新生成的字段添加到数组中
        fieldsArray.push(newFieldName);

        // 打乱字段顺序（Fisher-Yates 洗牌算法）
        for (let i = fieldsArray.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [fieldsArray[i], fieldsArray[j]] = [fieldsArray[j], fieldsArray[i]];
        }

        // 重新组合成字符串
        const newDataAttributes = ensureMinimumAttributes(fieldsArray.join(', '), actualProcess, subProcessDesc);
        console.log(`数据属性去重: "${dataAttributes}" -> "${newDataAttributes}"`);
        dataAttributes = newDataAttributes;
      }
      seenAttrsMap.set(dataAttributes.toLowerCase(), { name: dataAttributes, desc: subProcessDesc });

      // 最终清理：确保所有字段都不包含【】括号及其内容，并去除重复词
      const finalClean = (text) => {
        if (!text) return text;
        return String(text)
          .replace(/【[^】]*】/g, '')  // 去除【xxx】标签（包括内容）- 修正正则
          .replace(/\[[^\]]*\]/g, '')  // 去除[xxx]标签（包括内容）- 修正正则
          .replace(/([\u4e00-\u9fa5]{2,4})\1+/g, '$1')
          .replace(/\s+/g, ' ')
          .trim();
      };

      subProcessDesc = finalClean(subProcessDesc);
      dataGroup = finalClean(dataGroup);
      dataAttributes = finalClean(dataAttributes);
      // 同时清理功能过程名称
      const cleanedFunctionalProcess = finalClean(row.functionalProcess || '');

      // 移除内部字段 _parentProcess，不输出到最终结果
      const { _parentProcess: _, ...cleanRow } = row;
      tableData.push({
        ...cleanRow,
        functionalProcess: cleanedFunctionalProcess,
        subProcessDesc,
        dataGroup,
        dataAttributes
      });
    }

    // ========== 功能过程完整性检查 ==========
    // 确保每个功能过程都有完整的E+R/W+X子过程链
    const completeTableData = ensureProcessCompleteness(tableData);

    // ========== 最终系统性去重检查 ==========
    // 对整个 tableData 进行最终的去重检查，确保数据组和数据属性没有重复
    const finalTableData = await performFinalDeduplication(completeTableData);

    // ========== 最终强制清理【】括号 ==========
    // 确保返回的数据绝对不包含【】括号
    // 使用多种方式确保彻底清理
    const removeBrackets = (text) => {
      if (!text) return text;
      let result = String(text);
      // 方法1: 正则匹配【xxx】
      result = result.replace(/【[^】]*】/g, '');
      // 方法2: 正则匹配[xxx]
      result = result.replace(/\[[^\]]*\]/g, '');
      // 方法3: 循环清理，防止嵌套
      while (result.includes('【') || result.includes('】') || result.includes('[') || result.includes(']')) {
        result = result.replace(/【[^】]*】/g, '');
        result = result.replace(/\[[^\]]*\]/g, '');
        // 如果还有单独的括号，直接删除
        result = result.replace(/[【】\[\]]/g, '');
      }
      return result.replace(/\s+/g, ' ').trim();
    };

    const cleanedFinalData = finalTableData.map(row => {
      const cleaned = {
        ...row,
        functionalProcess: removeBrackets(row.functionalProcess),
        subProcessDesc: removeBrackets(row.subProcessDesc),
        dataGroup: removeBrackets(row.dataGroup),
        dataAttributes: removeBrackets(row.dataAttributes)
      };
      // 打印日志确认清理效果
      if (row.subProcessDesc && row.subProcessDesc.includes('【')) {
        console.log(`清理前: "${row.subProcessDesc}" -> 清理后: "${cleaned.subProcessDesc}"`);
      }
      return cleaned;
    });

    res.json({ success: true, tableData: cleanedFinalData });
  } catch (error) {
    console.error('解析表格失败:', error);
    res.status(500).json({ error: '解析表格失败: ' + error.message });
  }
});

// 🔄 模型切换API
app.post('/api/switch-model', async (req, res) => {
  try {
    const { model, provider } = req.body;
    res.json({
      success: true,
      message: `已切换到 ${model} 模型（本地生效）`,
      config: {
        model,
        provider
      }
    });
  } catch (error) {
    console.error('模型切换失败:', error);
    res.status(500).json({ error: '模型切换失败: ' + error.message });
  }
});

// 静态资源托管（生产模式）
const CLIENT_DIST_PATH = path.join(__dirname, '../client/dist');
if (fs.existsSync(CLIENT_DIST_PATH)) {
  app.use(express.static(CLIENT_DIST_PATH));

  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) {
      return next();
    }
    res.sendFile(path.join(CLIENT_DIST_PATH, 'index.html'));
  });
} else {
  console.warn('⚠️  未检测到 client/dist 构建目录，生产环境将无法提供前端静态资源');
}

// 启动服务器（带端口占用重试）
function startServer(port, retries = 5) {
  const server = app.listen(port, () => {
    const hasGemini = !!process.env.GEMINI_API_KEY;
    const hasOpenAI = !!process.env.OPENAI_API_KEY;
    const hasZhipu = !!process.env.ZHIPU_API_KEY;
    const hasGroq = !!process.env.GROQ_API_KEY;

    let status = '未配置';
    if (hasGemini) status = '已配置 (Gemini)';
    else if (hasZhipu) status = '已配置 (智谱)';
    else if (hasOpenAI) status = '已配置 (OpenAI)';
    else if (hasGroq) status = '已配置 (Groq)';

    console.log(`🚀 Cosmic拆分智能体服务器运行在 http://localhost:${port}`);
    console.log(`📋 API密钥状态: ${status}`);
    if (fs.existsSync(CLIENT_DIST_PATH)) {
      console.log('🖥️  静态前端: 已启用 client/dist 产物');
    }
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && retries > 0) {
      const nextPort = port + 1;
      console.warn(`⚠️  端口 ${port} 被占用，尝试使用端口 ${nextPort}...`);
      setTimeout(() => startServer(nextPort, retries - 1), 300);
    } else {
      console.error('服务器启动失败:', err);
      process.exit(1);
    }
  });
}

startServer(PORT);
