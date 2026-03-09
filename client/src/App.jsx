import React, { useState, useRef, useEffect, useCallback } from 'react';
import axios from 'axios';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Upload,
  FileText,
  Send,
  Download,
  Settings,
  Bot,
  User,
  Loader2,
  CheckCircle,
  AlertCircle,
  X,
  FileSpreadsheet,
  Trash2,
  Copy,
  Check,
  RefreshCw,
  Eye,
  Table,
  Info,
  Zap,
  Sparkles,
  Target,
  Brain,
  ChevronDown,
  Plus,
  BarChart3
} from 'lucide-react';

function App() {
  // 状态管理
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [documentContent, setDocumentContent] = useState('');
  const [documentName, setDocumentName] = useState('');

  const [apiStatus, setApiStatus] = useState({ hasApiKey: false });
  const [tableData, setTableData] = useState([]);
  const [streamingContent, setStreamingContent] = useState('');
  const [copied, setCopied] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [showPreview, setShowPreview] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [showTableView, setShowTableView] = useState(false);
  const [toastMessage, setToastMessage] = useState(''); // toast提示消息
  const [minFunctionCount, setMinFunctionCount] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = window.localStorage.getItem('minFunctionCount');
      if (saved) {
        const parsed = parseInt(saved, 10);
        if (!Number.isNaN(parsed)) {
          return parsed;
        }
      }
    }
    return 30;
  });
  // 拆分模式: 'quantity' = 数量优先, 'quality' = 质量优先, 'three-layer' = 三层分析框架, 'two-step' = 两步骤COSMIC拆分
  const [splitMode, setSplitMode] = useState('two-step');
  const [understanding, setUnderstanding] = useState(null);
  const [analysisPhase, setAnalysisPhase] = useState(''); // 'understanding' | 'splitting' | 'reviewing' | ''
  const [currentModuleIndex, setCurrentModuleIndex] = useState(0);

  const [isWaitingForAnalysis, setIsWaitingForAnalysis] = useState(false);
  const [userGuidelines, setUserGuidelines] = useState('');


  // 两阶段动态分析：功能清单相关状态
  const [functionList, setFunctionList] = useState(null); // AI提取的功能清单
  const [showFunctionListPanel, setShowFunctionListPanel] = useState(false); // 是否显示确认面板
  const [confirmedFunctions, setConfirmedFunctions] = useState([]); // 用户确认的功能列表
  const [isExtractingFunctions, setIsExtractingFunctions] = useState(false); // 是否正在提取功能清单

  // 对话式添加功能相关状态
  const [showAddFunctionDialog, setShowAddFunctionDialog] = useState(false); // 是否显示对话式添加弹窗
  const [addFunctionInput, setAddFunctionInput] = useState(''); // 用户输入的需求描述
  const [isAnalyzingNewFunction, setIsAnalyzingNewFunction] = useState(false); // 是否正在AI分析

  const [twoStepFunctionList, setTwoStepFunctionList] = useState(''); // 第一步识别的功能过程列表
  const [showFunctionListEditor, setShowFunctionListEditor] = useState(false); // 是否显示功能过程列表编辑器
  const [isTwoStepProcessing, setIsTwoStepProcessing] = useState(false); // 是否正在两步骤处理中
  const [twoStepCurrentStep, setTwoStepCurrentStep] = useState(0); // 当前步骤：0=未开始，1=功能识别中，2=等待确认，3=COSMIC拆分中

  // 模型选择相关状态 - 仅支持心流平台的两个模型
  const [selectedModel, setSelectedModel] = useState(() => {
    if (typeof window !== 'undefined') {
      return window.localStorage.getItem('selectedModel') || 'deepseek-v3';
    }
    return 'deepseek-v3';
  }); // 'deepseek-v3' | 'qwen3-coder'


  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const dropZoneRef = useRef(null);
  const abortControllerRef = useRef(null); // 用于中断正在进行的分析

  // 检查API状态
  useEffect(() => {
    const initApi = async () => {
      await checkApiStatus();
      // 同步模型选择到后端
      const savedModel = window.localStorage.getItem('selectedModel') || 'deepseek-v3';
      try {
        await axios.post('/api/switch-model', { model: savedModel, provider: 'iflow' });
      } catch (e) {
        console.error('同步模型失败:', e);
      }
    };
    initApi();
  }, []);

  // 持久化最小功能过程数量
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('minFunctionCount', String(minFunctionCount));
    }
  }, [minFunctionCount]);



  // 持久化选中的模型
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('selectedModel', selectedModel);
    }
  }, [selectedModel]);

  // 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  const checkApiStatus = async () => {
    try {
      const res = await axios.get('/api/health');
      setApiStatus(res.data);
    } catch (error) {
      console.error('检查API状态失败:', error);
    }
  };

  // 切换模型（仅支持心流平台的 deepseek-v3 和 qwen3-coder-plus）
  const handleModelChange = async (model) => {
    setSelectedModel(model);


    try {
      // 通知后端切换模型
      await axios.post('/api/switch-model', { model, provider: 'iflow' });

      const modelLabel = model === 'deepseek-v3' ? 'DeepSeek-V3' : 'Qwen3-Coder-Plus';
      showToast(`已切换到${modelLabel}模型`);
    } catch (error) {
      console.error('切换模型失败:', error);
      showToast('切换模型失败: ' + error.message);
    }
  };

  // 显示toast提示
  const showToast = (message) => {
    setToastMessage(message);
    setTimeout(() => setToastMessage(''), 2500);
  };

  // 获取用户API配置（心流平台模式，API密钥由后端.env管理）
  const getUserConfig = () => {
    const savedModel = window.localStorage.getItem('selectedModel') || 'deepseek-v3';

    // 心流平台模型映射
    const modelMap = {
      'deepseek-v3': 'deepseek-v3',
      'qwen3-coder': 'qwen3-coder-plus'
    };

    return {
      apiKey: null, // API密钥由后端.env中的IFLOW_API_KEY管理
      baseUrl: 'https://apis.iflow.cn/v1',
      model: modelMap[savedModel] || 'deepseek-v3',
      provider: 'iflow'
    };
  };



  // 拖拽上传处理
  const handleDragEnter = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    // 只有当离开拖拽区域时才取消状态
    if (e.currentTarget === dropZoneRef.current && !e.currentTarget.contains(e.relatedTarget)) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      processFile(files[0]);
    }
  }, []);

  // 文件选择处理
  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      processFile(file);
    }
    // 重置input以便可以重复选择同一文件
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // 处理文件上传
  const processFile = async (file) => {
    // 清除之前的错误
    setErrorMessage('');

    // 检查文件类型
    const allowedExtensions = ['.docx', '.txt', '.md'];
    const ext = '.' + file.name.split('.').pop().toLowerCase();

    if (!allowedExtensions.includes(ext)) {
      setErrorMessage(`不支持的文件格式: ${ext}。请上传 .docx, .txt 或 .md 文件`);
      return;
    }

    // 检查文件大小
    if (file.size > 50 * 1024 * 1024) {
      setErrorMessage('文件大小超过限制（最大50MB）');
      return;
    }

    const formData = new FormData();
    formData.append('file', file);

    try {
      setIsLoading(true);
      setUploadProgress(0);

      const res = await axios.post('/api/parse-word', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (progressEvent) => {
          const progress = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          setUploadProgress(progress);
        }
      });

      if (res.data.success) {
        setDocumentContent(res.data.text);
        setDocumentName(res.data.filename);
        setUploadProgress(100);

        // 添加系统消息
        const wordCount = res.data.wordCount || res.data.text.length;
        setMessages(prev => [...prev, {
          role: 'system',
          content: `📄 已成功导入文档: ${res.data.filename}\n📊 文档大小: ${(res.data.fileSize / 1024).toFixed(2)} KB | 字符数: ${wordCount}\n\n文档内容预览:\n${res.data.text.substring(0, 800)}${res.data.text.length > 800 ? '\n\n... (点击"预览文档"查看完整内容)' : ''}`
        }]);

        // 不再自动开始分析，而是等待用户输入
        setIsWaitingForAnalysis(true);
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: '✅ 文档已就绪！您现在可以在对话框中输入**特殊的拆分要求**（例如："仅拆分接口功能"、"重点拆分XX模块"），或者直接点击底部的**"开始智能拆分"**按钮开始分析。'
        }]);
      }
    } catch (error) {
      console.error('文档解析失败:', error);
      const errorMsg = error.response?.data?.error || error.message;
      setErrorMessage(`文档解析失败: ${errorMsg}`);
      setMessages(prev => [...prev, {
        role: 'system',
        content: `❌ 文档解析失败: ${errorMsg}`
      }]);
    } finally {
      setIsLoading(false);
      setTimeout(() => setUploadProgress(0), 1000);
    }
  };

  // 前端去重函数 - 合并多轮数据时去除重复的功能过程
  const deduplicateByFunctionalProcess = (existingData, newData) => {
    // 获取已存在的功能过程名称（小写用于比较）
    const existingProcesses = new Set(
      existingData
        .filter(r => r.dataMovementType === 'E' && r.functionalProcess)
        .map(r => r.functionalProcess.toLowerCase().trim())
    );

    // 过滤新数据，只保留不重复的功能过程及其子过程
    const result = [];
    let currentProcess = '';
    let skipCurrentProcess = false;

    for (const row of newData) {
      const rowProcess = (row.functionalProcess || '').trim();

      // 如果是E类型，检查是否重复
      if (row.dataMovementType === 'E' && rowProcess) {
        currentProcess = rowProcess;
        if (existingProcesses.has(rowProcess.toLowerCase())) {
          console.log(`前端去重: 跳过重复功能过程 "${rowProcess}"`);
          skipCurrentProcess = true;
          continue;
        } else {
          skipCurrentProcess = false;
          existingProcesses.add(rowProcess.toLowerCase());
        }
      }

      if (!skipCurrentProcess) {
        result.push(row);
      }
    }

    console.log(`前端去重: 新数据 ${newData.length} 条 -> 保留 ${result.length} 条`);
    return result;
  };

  // 开始AI分析 - 循环调用直到完成（数量优先模式）
  const startAnalysis = async (content, guidelines = '') => {
    if (!apiStatus.hasApiKey) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: '⚠️ 请先配置API密钥才能使用AI分析功能。点击右上角的设置按钮进行配置。'
      }]);
      return;
    }

    // 中断之前的分析
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    setIsLoading(true);
    setIsWaitingForAnalysis(false); // 开始分析后不再等待
    setStreamingContent('');
    setTableData([]); // 清空之前的表格数据

    let allTableData = [];
    let round = 1;
    const maxRounds = 12; // 最多循环12次，防止无限循环
    let uniqueFunctions = [];
    const globalRowSet = new Set(); // 仅用于整行去重
    let documentUnderstanding = null;

    try {
      // 检查是否已被中断
      if (signal.aborted) return;

      // ========== 第一阶段：深度理解文档 ==========
      setMessages([{
        role: 'system',
        content: '🔍 **第一阶段：深度理解文档**\n正在分析文档结构、识别核心模块和功能点...'
      }]);

      try {
        const understandRes = await axios.post('/api/quality-analyze/understand', {
          documentContent: content,
          userConfig: getUserConfig()
        }, { signal });

        if (understandRes.data.success) {
          documentUnderstanding = understandRes.data.understanding;

          // 显示文档理解结果 - 增强版：展示触发方式
          const modules = documentUnderstanding.coreModules || [];
          const modulesSummary = modules.map((m, i) => {
            const functions = m.estimatedFunctions || [];
            let funcDisplay = '';
            if (Array.isArray(functions) && functions.length > 0) {
              if (typeof functions[0] === 'object') {
                // 新格式：包含触发方式的对象
                funcDisplay = functions.map((f, j) =>
                  `      ${j + 1}. ${f.functionName} [${f.triggerType}]${f.scenario ? ` - ${f.scenario}` : ''}`
                ).join('\n');
              } else {
                // 旧格式：仅字符串
                funcDisplay = functions.map((f, j) => `      ${j + 1}. ${f}`).join('\n');
              }
            } else {
              funcDisplay = '      待识别';
            }
            return `**${i + 1}. ${m.moduleName}** (${functions.length}个功能)\n   ${m.moduleDescription || ''}\n   ${m.subModules?.length > 0 ? `子模块：${m.subModules.join('、')}\n   ` : ''}功能列表：\n${funcDisplay}`;
          }).join('\n\n');

          // 构建触发方式统计
          const breakdown = documentUnderstanding.functionBreakdown || {};
          const triggerStats = breakdown.userTriggeredFunctions || breakdown.timerTriggeredFunctions || breakdown.interfaceTriggeredFunctions
            ? `\n**触发方式分布**：\n- 👤 用户触发：${breakdown.userTriggeredFunctions || 0}个\n- ⏰ 时钟触发：${breakdown.timerTriggeredFunctions || 0}个\n- 🔌 接口触发：${breakdown.interfaceTriggeredFunctions || 0}个\n`
            : '';

          setMessages([{
            role: 'assistant',
            content: `## 📋 文档深度理解完成（含触发方式识别）

**项目名称**：${documentUnderstanding.projectName || '未识别'}

**项目描述**：${documentUnderstanding.projectDescription || '无'}

**系统架构**：${documentUnderstanding.systemArchitecture || '待确定'}

**系统边界**：${documentUnderstanding.systemBoundary || '待确定'}

**用户角色**：${(documentUnderstanding.userRoles || []).join('、') || '用户'}

**数据实体**：${(documentUnderstanding.dataEntities || []).join('、') || '待识别'}
${triggerStats}
---

### 🧩 识别到的核心模块 (${modules.length}个)

${modulesSummary || '暂无模块信息'}

---

**预估功能过程总数**：约 ${documentUnderstanding.totalEstimatedFunctions || 30} 个
**目标功能过程数**：${minFunctionCount} 个

---

✨ **触发方式已智能识别，将在拆分时自动应用**

🚀 **开始第二阶段：COSMIC功能拆分（数量优先）...**`
          }]);

          // 短暂延迟，让用户看到理解结果
          await new Promise((resolve, reject) => {
            const timeout = setTimeout(resolve, 1500);
            signal.addEventListener('abort', () => {
              clearTimeout(timeout);
              reject(new DOMException('Aborted', 'AbortError'));
            });
          });
        }
      } catch (e) {
        if (e.name === 'AbortError' || e.name === 'CanceledError' || signal.aborted) {
          console.log('分析已被用户中断');
          return;
        }
        console.log('文档深度理解失败，继续使用常规分析:', e.message);
        setMessages([{
          role: 'system',
          content: '⚠️ 文档深度理解跳过，直接进行COSMIC拆分分析...'
        }]);
      }

      // ========== 第二阶段：COSMIC功能拆分 ==========
      while (round <= maxRounds) {
        // 检查是否已被中断
        if (signal.aborted) {
          console.log('分析已被用户中断');
          return;
        }

        if (uniqueFunctions.length >= minFunctionCount) {
          break;
        }

        // 更新进度提示
        setMessages(prev => {
          const filtered = prev.filter(m => !m.content.startsWith('🔄'));
          return [...filtered, {
            role: 'system',
            content: `🔄 **第二阶段：COSMIC拆分** - 第 ${round} 轮分析中...\n已识别 ${allTableData.length} 个子过程 / 目标 ${minFunctionCount} 个功能过程`
          }];
        });

        const response = await axios.post('/api/continue-analyze', {
          documentContent: content,
          previousResults: allTableData,
          round: round,
          targetFunctions: minFunctionCount,
          understanding: documentUnderstanding,
          userGuidelines: guidelines,
          userConfig: getUserConfig()
        }, { signal });

        if (response.data.success) {
          const replyContent = response.data.reply;

          // 解析表格数据 - 直接使用后端已处理好的数据，不再前端二次处理
          try {
            const tableRes = await axios.post('/api/parse-table', { markdown: replyContent });
            console.log(`第 ${round} 轮解析结果:`, tableRes.data);
            if (tableRes.data.success && tableRes.data.tableData.length > 0) {
              // 直接使用后端返回的数据，不做额外过滤
              const newData = tableRes.data.tableData;
              console.log(`第 ${round} 轮获取 ${newData.length} 条数据`);

              // 统计数据移动类型分布
              const typeCount = { E: 0, R: 0, W: 0, X: 0 };
              newData.forEach(row => {
                const t = (row.dataMovementType || '').toUpperCase();
                if (typeCount[t] !== undefined) typeCount[t]++;
              });
              console.log(`数据移动类型分布:`, typeCount);

              if (newData.length > 0) {
                // 使用去重函数合并数据，避免功能过程重复
                const deduplicatedNewData = deduplicateByFunctionalProcess(allTableData, newData);
                if (deduplicatedNewData.length > 0) {
                  allTableData = [...allTableData, ...deduplicatedNewData];
                  setTableData(allTableData);
                  console.log(`第 ${round} 轮新增 ${deduplicatedNewData.length} 条（去重后），总计 ${allTableData.length} 条`);
                } else {
                  console.log(`第 ${round} 轮数据全部重复，跳过`);
                }
              }
            }
          } catch (e) {
            console.log(`第 ${round} 轮表格解析失败`);
          }

          // 显示本轮结果
          setMessages(prev => {
            const filtered = prev.filter(m => !m.content.startsWith('🔄'));
            return [...filtered, {
              role: 'assistant',
              content: `**第 ${round} 轮完成** (已识别 ${allTableData.length} 个子过程)\n\n${replyContent}`
            }];
          });

          uniqueFunctions = [...new Set(allTableData.map(r => r.functionalProcess).filter(Boolean))];
          const reachedTarget = uniqueFunctions.length >= minFunctionCount;

          if (reachedTarget) {
            console.log(`达到用户设定的最少功能过程数量: ${minFunctionCount}`);
            break;
          }

          // 检查是否完成
          if (response.data.isDone && !reachedTarget) {
            setMessages(prev => [...prev, {
              role: 'system',
              content: '⚠️ AI表示已拆分完成，但尚未达到目标数量，继续尝试扩展覆盖...'
            }]);
          } else if (response.data.isDone && reachedTarget) {
            console.log('AI表示已完成所有功能过程');
            break;
          }

          // 如果这轮没有新增数据，可能已经完成
          const tableRes = await axios.post('/api/parse-table', { markdown: replyContent }).catch(() => null);
          if (!tableRes?.data?.tableData?.length && round > 1) {
            console.log('本轮无新增数据，结束循环');
            break;
          }
        }

        round++;

        // 轮次间延迟（支持中断）
        if (round <= maxRounds) {
          try {
            await new Promise((resolve, reject) => {
              const timeout = setTimeout(resolve, 1500);
              signal.addEventListener('abort', () => {
                clearTimeout(timeout);
                reject(new DOMException('Aborted', 'AbortError'));
              });
            });
          } catch (e) {
            if (e.name === 'AbortError' || signal.aborted) {
              console.log('分析已被用户中断');
              return;
            }
          }
        }
      }

      // 统计功能过程数量
      uniqueFunctions = [...new Set(allTableData.map(r => r.functionalProcess).filter(Boolean))];
      const reachedTarget = uniqueFunctions.length >= minFunctionCount;

      // 最终汇总
      setMessages(prev => {
        const filtered = prev.filter(m => !m.content.startsWith('🔄'));
        return [...filtered, {
          role: 'assistant',
          content: `🎉 **分析完成！**\n\n经过 **${round}** 轮分析，共识别：\n- **${uniqueFunctions.length}** 个功能过程（目标 ${minFunctionCount} 个${reachedTarget ? ' ✅' : ' ⚠️ 未达标'}）\n- **${allTableData.length}** 个子过程（CFP点数）\n\n数据移动类型分布：\n- 输入(E): ${allTableData.filter(r => r.dataMovementType === 'E').length}\n- 读取(R): ${allTableData.filter(r => r.dataMovementType === 'R').length}\n- 写入(W): ${allTableData.filter(r => r.dataMovementType === 'W').length}\n- 输出(X): ${allTableData.filter(r => r.dataMovementType === 'X').length}\n\n点击"查看表格"或"导出Excel"查看完整结果。`
        }];
      });

      if (!reachedTarget) {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `⚠️ 未达到用户设定的最少功能过程数量（${minFunctionCount} 个）。建议：\n- 检查原始文档是否有更多可拆分的功能描述\n- 提高最大轮数或降低目标数量\n- 重新上传更详细的需求文档`
        }]);
      }

    } catch (error) {
      // 如果是用户中断，不显示错误
      if (error.name === 'AbortError' || error.name === 'CanceledError') {
        console.log('分析已被用户中断');
        return;
      }
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `❌ 分析失败: ${error.response?.data?.error || error.message}`
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  // 质量优先分析 - 先深度理解文档，再进行拆分
  const startQualityAnalysis = async (content, guidelines = '') => {
    if (!apiStatus.hasApiKey) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: '⚠️ 请先配置API密钥才能使用AI分析功能。点击右上角的设置按钮进行配置。'
      }]);
      return;
    }

    // 中断之前的分析
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    setIsLoading(true);
    setIsWaitingForAnalysis(false); // 开始分析后不再等待
    setStreamingContent('');
    setTableData([]);

    let allTableData = [];
    let round = 1;
    const maxRounds = 12;
    let uniqueFunctions = [];
    let documentUnderstanding = null;

    try {
      // 检查是否已被中断
      if (signal.aborted) return;

      // ========== 第一阶段：深度理解文档 ==========
      setMessages([{
        role: 'system',
        content: '🔍 **第一阶段：深度理解文档**\n正在分析文档结构、识别核心模块和功能点...'
      }]);

      try {
        const understandRes = await axios.post('/api/quality-analyze/understand', {
          documentContent: content
        }, { signal });

        if (understandRes.data.success) {
          documentUnderstanding = understandRes.data.understanding;

          // 显示文档理解结果 - 增强版：展示更详细的功能点信息和触发方式
          const modules = documentUnderstanding.coreModules || [];
          const modulesSummary = modules.map((m, i) => {
            const funcs = m.estimatedFunctions || [];
            let funcList = '';
            if (funcs.length > 0) {
              if (typeof funcs[0] === 'object') {
                // 新格式：包含触发方式的对象
                funcList = funcs.map((f, j) => {
                  const triggerIcon = f.triggerType === '用户触发' ? '👤' : f.triggerType === '时钟触发' ? '⏰' : '🔌';
                  return `      ${j + 1}. ${triggerIcon} ${f.functionName} [${f.triggerType}]${f.scenario ? `\n         场景：${f.scenario}` : ''}`;
                }).join('\n');
              } else {
                // 旧格式：仅字符串
                funcList = funcs.map((f, j) => `      ${j + 1}. ${f}`).join('\n');
              }
            } else {
              funcList = '      待识别';
            }
            return `**${i + 1}. ${m.moduleName}** (${funcs.length}个功能)\n   ${m.moduleDescription || ''}\n   ${m.subModules?.length > 0 ? `子模块：${m.subModules.join('、')}\n   ` : ''}功能列表：\n${funcList}`;
          }).join('\n\n');

          // 统计功能分类
          const breakdown = documentUnderstanding.functionBreakdown || {};
          const breakdownSummary = breakdown.crudFunctions || breakdown.queryFunctions
            ? `\n**功能分类统计**：\n- 增删改查：${breakdown.crudFunctions || 0}个\n- 查询统计：${breakdown.queryFunctions || 0}个\n- 导入导出：${breakdown.importExportFunctions || 0}个\n- 流程审批：${breakdown.workflowFunctions || 0}个\n- 配置管理：${breakdown.configFunctions || 0}个\n- 其他功能：${breakdown.otherFunctions || 0}个`
            : '';

          // 跨模块功能和定时任务
          const crossFuncs = documentUnderstanding.crossModuleFunctions || [];
          const timedTasks = documentUnderstanding.timedTasks || [];
          let additionalInfo = '';
          if (crossFuncs.length > 0) {
            const crossFuncsList = crossFuncs.map(cf =>
              typeof cf === 'object'
                ? `- ${cf.functionName} [${cf.triggerType}] (关联：${(cf.relatedModules || []).join('、')})`
                : `- ${cf}`
            ).join('\n');
            additionalInfo += `\n**跨模块功能**：\n${crossFuncsList}\n`;
          }
          if (timedTasks.length > 0) {
            const timedTasksList = timedTasks.map(t =>
              `- ⏰ ${t.taskName} (${t.schedule}): ${t.description}`
            ).join('\n');
            additionalInfo += `\n**定时任务明细**：\n${timedTasksList}\n`;
          }

          setMessages([{
            role: 'assistant',
            content: `## 📋 文档深度理解完成（含触发方式详细识别）

**项目名称**：${documentUnderstanding.projectName || '未识别'}

**项目描述**：${documentUnderstanding.projectDescription || '无'}

**系统架构**：${documentUnderstanding.systemArchitecture || '待确定'}

**系统边界**：${documentUnderstanding.systemBoundary || '待确定'}

**用户角色**：${(documentUnderstanding.userRoles || []).join('、') || '用户'}

**数据实体**：${(documentUnderstanding.dataEntities || []).join('、') || '待识别'}

**外部接口**：${(documentUnderstanding.externalInterfaces || []).join('、') || '无'}
${additionalInfo}
---

### 🧩 识别到的核心模块 (${modules.length}个)

${modulesSummary || '暂无模块信息'}

---
${breakdownSummary}
**预估功能过程总数**：约 ${documentUnderstanding.totalEstimatedFunctions || 30} 个

---

✨ **每个功能的触发方式已智能识别（👤用户触发 / ⏰时钟触发 / 🔌接口触发）**

🚀 **开始第二阶段：COSMIC功能拆分（质量优先）...**`
          }]);

          // 短暂延迟，让用户看到理解结果
          await new Promise((resolve, reject) => {
            const timeout = setTimeout(resolve, 1500);
            signal.addEventListener('abort', () => {
              clearTimeout(timeout);
              reject(new DOMException('Aborted', 'AbortError'));
            });
          });
        }
      } catch (e) {
        if (e.name === 'AbortError' || e.name === 'CanceledError' || signal.aborted) {
          console.log('分析已被用户中断');
          return;
        }
        console.log('文档深度理解失败，继续使用常规分析:', e.message);
        setMessages([{
          role: 'system',
          content: '⚠️ 文档深度理解跳过，直接进行COSMIC拆分分析...'
        }]);
      }

      // ========== 第二阶段：COSMIC功能拆分 ==========
      const estimatedTotal = documentUnderstanding?.totalEstimatedFunctions || 30;
      let noProgressRounds = 0; // 连续无进展轮次计数

      while (round <= maxRounds) {
        // 检查是否已被中断
        if (signal.aborted) {
          console.log('分析已被用户中断');
          return;
        }

        uniqueFunctions = [...new Set(allTableData.map(r => r.functionalProcess).filter(Boolean))];
        const currentFunctionCount = uniqueFunctions.length;
        const progress = Math.min(100, Math.round((currentFunctionCount / estimatedTotal) * 100));

        // 更新进度提示
        setMessages(prev => {
          const filtered = prev.filter(m => !m.content.startsWith('🔄'));
          return [...filtered, {
            role: 'system',
            content: `🔄 **第二阶段：COSMIC拆分** - 第 ${round} 轮分析中...\n已识别 ${currentFunctionCount}/${estimatedTotal} 个功能过程（${progress}%），${allTableData.length} 个子过程`
          }];
        });

        const response = await axios.post('/api/quality-continue-analyze', {
          documentContent: content,
          previousResults: allTableData,
          round: round,
          understanding: documentUnderstanding, // 传递文档理解结果
          userGuidelines: guidelines
        }, { signal });

        if (response.data.success) {
          const replyContent = response.data.reply;
          let hasNewData = false;

          // 解析表格数据
          try {
            const tableRes = await axios.post('/api/parse-table', { markdown: replyContent });
            console.log(`质量优先第 ${round} 轮解析结果:`, tableRes.data);
            if (tableRes.data.success && tableRes.data.tableData.length > 0) {
              const newData = tableRes.data.tableData;
              console.log(`质量优先第 ${round} 轮获取 ${newData.length} 条数据`);

              if (newData.length > 0) {
                // 使用去重函数合并数据，避免功能过程重复
                const deduplicatedNewData = deduplicateByFunctionalProcess(allTableData, newData);
                if (deduplicatedNewData.length > 0) {
                  allTableData = [...allTableData, ...deduplicatedNewData];
                  setTableData(allTableData);
                  hasNewData = true;
                  noProgressRounds = 0; // 重置无进展计数
                  console.log(`质量优先第 ${round} 轮新增 ${deduplicatedNewData.length} 条（去重后），总计 ${allTableData.length} 条`);
                } else {
                  noProgressRounds++;
                  console.log(`质量优先第 ${round} 轮数据全部重复，无进展轮次: ${noProgressRounds}`);
                }
              } else {
                noProgressRounds++;
              }
            } else {
              noProgressRounds++;
            }
          } catch (e) {
            console.log(`质量优先第 ${round} 轮表格解析失败:`, e.message);
            noProgressRounds++;
          }

          // 显示本轮结果
          uniqueFunctions = [...new Set(allTableData.map(r => r.functionalProcess).filter(Boolean))];
          setMessages(prev => {
            const filtered = prev.filter(m => !m.content.startsWith('🔄'));
            return [...filtered, {
              role: 'assistant',
              content: `**第 ${round} 轮完成** (已识别 ${uniqueFunctions.length}/${estimatedTotal} 个功能过程，${allTableData.length} 个子过程)\n\n${replyContent}`
            }];
          });

          // 改进的完成判断逻辑 - 需要满足多个条件才能停止
          const reachedTarget = uniqueFunctions.length >= estimatedTotal;
          const hasCompleteMarker = replyContent.includes('[ALL_DONE]') ||
            replyContent.includes('已完成所有') ||
            replyContent.includes('全部拆分完成');
          const consecutiveNoProgress = noProgressRounds >= 3; // 连续3轮无进展

          const shouldStop =
            // 条件1：已达到预估数量 且 (AI明确完成 或 连续无进展)
            (reachedTarget && (response.data.isDone || hasCompleteMarker || consecutiveNoProgress)) ||
            // 条件2：连续5轮无进展（彻底没数据了）
            noProgressRounds >= 5 ||
            // 条件3：轮次过多
            round >= maxRounds;

          if (shouldStop) {
            const stopReason = reachedTarget ? '已达到预估功能数量' :
              noProgressRounds >= 5 ? '连续多轮无新数据' :
                '达到最大轮次';
            console.log(`质量优先 - 停止分析，原因: ${stopReason}，当前${uniqueFunctions.length}个功能，预估${estimatedTotal}个`);
            break;
          }

          // 如果还没达到预估数量且有新数据，提示继续
          if (!reachedTarget && hasNewData) {
            console.log(`质量优先 - 继续拆分，当前${uniqueFunctions.length}个功能，目标${estimatedTotal}个`);
          }
        }

        round++;

        // 轮次间延迟（支持中断）
        if (round <= maxRounds) {
          try {
            await new Promise((resolve, reject) => {
              const timeout = setTimeout(resolve, 1500);
              signal.addEventListener('abort', () => {
                clearTimeout(timeout);
                reject(new DOMException('Aborted', 'AbortError'));
              });
            });
          } catch (e) {
            if (e.name === 'AbortError' || signal.aborted) {
              console.log('分析已被用户中断');
              return;
            }
          }
        }
      }

      // 统计功能过程数量
      uniqueFunctions = [...new Set(allTableData.map(r => r.functionalProcess).filter(Boolean))];

      // 最终汇总
      setMessages(prev => {
        const filtered = prev.filter(m => !m.content.startsWith('🔄'));
        return [...filtered, {
          role: 'assistant',
          content: `🎉 **质量优先分析完成！**\n\n经过 **${round}** 轮分析，根据文档内容共识别：\n- **${uniqueFunctions.length}** 个功能过程\n- **${allTableData.length}** 个子过程（CFP点数）\n\n数据移动类型分布：\n- 输入(E): ${allTableData.filter(r => r.dataMovementType === 'E').length}\n- 读取(R): ${allTableData.filter(r => r.dataMovementType === 'R').length}\n- 写入(W): ${allTableData.filter(r => r.dataMovementType === 'W').length}\n- 输出(X): ${allTableData.filter(r => r.dataMovementType === 'X').length}\n\n✨ 已完整覆盖文档中的所有功能描述。\n\n点击"查看表格"或"导出Excel"查看完整结果。`
        }];
      });

    } catch (error) {
      // 如果是用户中断，不显示错误
      if (error.name === 'AbortError' || error.name === 'CanceledError') {
        console.log('分析已被用户中断');
        return;
      }
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `❌ 分析失败: ${error.response?.data?.error || error.message}`
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  // 三层分析框架模式 - 两阶段动态驱动分析
  // 阶段1：提取功能清单让用户确认
  const startThreeLayerAnalysis = async (content, guidelines = '') => {
    if (!apiStatus.hasApiKey) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: '⚠️ 请先配置API密钥才能使用AI分析功能。点击右上角的设置按钮进行配置。'
      }]);
      return;
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    setIsLoading(true);
    setIsExtractingFunctions(true);
    setIsWaitingForAnalysis(false);
    setStreamingContent('');

    try {
      if (signal.aborted) return;

      setMessages([{
        role: 'system',
        content: '🔍 **阶段1：功能清单提取**\n正在分析文档，识别所有功能点...\n\n完成后将显示功能清单供您确认、修改或补充。'
      }]);

      // 调用功能清单提取API - 传递用户限制条件
      const response = await axios.post('/api/extract-function-list', {
        documentContent: content,
        userGuidelines: guidelines,
        userConfig: getUserConfig()
      }, { signal });

      if (response.data.success) {
        const extractedList = response.data.functionList;

        if (extractedList) {
          setFunctionList(extractedList);

          // 将所有功能展平为确认列表
          const allFunctions = [];
          (extractedList.modules || []).forEach(mod => {
            (mod.functions || []).forEach(fn => {
              allFunctions.push({
                ...fn,
                moduleName: mod.moduleName,
                selected: true // 默认全选
              });
            });
          });

          // 添加定时任务
          (extractedList.timedTasks || []).forEach((task, idx) => {
            allFunctions.push({
              id: `timer_${idx}`,
              name: task.name,
              triggerType: '时钟触发',
              description: task.description,
              interval: task.interval,
              moduleName: '定时任务',
              selected: true
            });
          });

          setConfirmedFunctions(allFunctions);
          setShowFunctionListPanel(true);

          // 使用实际识别的功能数量，而不是AI预估的数量，确保显示一致
          const actualFunctionCount = allFunctions.length;

          setMessages(prev => [...prev, {
            role: 'assistant',
            content: `## ✅ 功能清单提取完成！

**项目名称**：${extractedList.projectName || '未识别'}

**识别到 ${actualFunctionCount} 个功能点**

请点击上方的 **"确认功能清单"** 按钮查看和编辑功能列表：
- ✏️ 可以**删除**不需要的功能
- ➕ 可以**添加**遗漏的功能
- 📝 可以**修改**功能名称或描述

确认后将开始ERWX拆分。`
          }]);
        } else {
          // 如果解析失败，显示原始响应并提供重试选项
          console.log('功能清单解析失败，原始响应:', response.data.rawResponse?.substring(0, 500));
          console.log('解析详情:', response.data.parseDetails);

          // 构建详细的错误信息
          let errorDetail = '';
          if (response.data.parseDetails) {
            const details = response.data.parseDetails;
            errorDetail = '\n\n**解析尝试详情：**\n';
            details.attempts.forEach((attempt, idx) => {
              if (attempt.error) {
                errorDetail += `${idx + 1}. ${attempt.method}: ❌ ${attempt.error}\n`;
              } else if (attempt.found === false) {
                errorDetail += `${idx + 1}. ${attempt.method}: ⚠️ 未找到\n`;
              } else if (attempt.found === true) {
                errorDetail += `${idx + 1}. ${attempt.method}: ✓ 已找到但解析失败\n`;
              } else if (attempt.started) {
                errorDetail += `${idx + 1}. ${attempt.method}: 已尝试但未成功\n`;
              }
            });
          }

          setMessages(prev => [...prev, {
            role: 'assistant',
            content: `## 📋 AI分析结果\n\n${response.data.rawResponse.substring(0, 1000)}${response.data.rawResponse.length > 1000 ? '\n\n...(完整内容请查看控制台)' : ''}\n\n---\n\n⚠️ **自动解析失败**\n\n系统尝试了多种解析策略但均未成功。${errorDetail}\n\n**可能的原因：**\n- AI返回的JSON格式不规范\n- 响应中包含了额外的说明文字\n- 网络传输过程中数据异常\n\n**建议操作：**\n1. 🔄 点击"重新分析"按钮重试（AI可能会返回不同格式）\n2. 🔧 检查后端控制台日志，查看详细的解析错误\n3. 📝 如果持续失败，请联系技术支持并提供上述AI响应内容`
          }]);
        }
      } else {
        throw new Error(response.data.error || '功能清单提取失败');
      }
    } catch (error) {
      if (error.name === 'CanceledError' || signal.aborted) {
        setMessages(prev => [...prev, {
          role: 'system',
          content: '⚠️ 分析已中断'
        }]);
      } else {
        console.error('功能清单提取失败:', error);
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `❌ 功能清单提取失败: ${error.message}\n\n请检查密钥是否配置正确`
        }]);
      }
    } finally {
      setIsLoading(false);
      setIsExtractingFunctions(false);
    }
  };

  // 阶段2：基于确认的功能清单进行ERWX拆分
  const startSplitFromFunctionList = async () => {
    const selectedFunctions = confirmedFunctions.filter(fn => fn.selected);

    if (selectedFunctions.length === 0) {
      showToast('请至少选择一个功能进行拆分');
      return;
    }

    setShowFunctionListPanel(false);
    setIsLoading(true);
    setTableData([]);

    let allTableData = [];
    let round = 1;
    let processedIndex = 0;  // ⚠️ 新增：跟踪已处理的功能索引位置
    let allMissedFunctions = [];  // 🔍 收集所有批次中遗漏的功能（用于追补拆分）
    // 批次大小与后端保持一致（10个），计算总批次数
    const batchSize = 10;
    const totalBatches = Math.ceil(selectedFunctions.length / batchSize);
    const maxRounds = totalBatches + 3; // 额外加3轮作为保险

    try {
      setMessages(prev => [...prev, {
        role: 'system',
        content: `🚀 **阶段2：ERWX拆分**\n\n基于您确认的 **${selectedFunctions.length}** 个功能进行拆分...\n\n✓ 功能清单已确认\n✓ 采用分批处理模式（每批${batchSize}个功能）\n✓ 预计需要 ${totalBatches} 个批次\n✓ 开始生成ERWX子过程`
      }]);

      while (round <= maxRounds) {
        const uniqueFunctions = [...new Set(allTableData.map(r => r.functionalProcess).filter(Boolean))];

        setMessages(prev => {
          const filtered = prev.filter(m => !m.content.startsWith('🔄'));
          return [...filtered, {
            role: 'system',
            content: `🔄 **拆分进度**\n\n批次: ${Math.min(round, totalBatches)}/${totalBatches}\n已完成功能: ${uniqueFunctions.length}/${selectedFunctions.length}\n子过程数: ${allTableData.length}\n\n正在处理中...`
          }];
        });

        // ⚠️ 调试日志：输出请求前的索引位置
        console.log(`[前端] 第${round}轮请求, processedIndex=${processedIndex}`);

        const response = await axios.post('/api/split-from-function-list', {
          documentContent: documentContent,
          confirmedFunctions: selectedFunctions,
          previousResults: allTableData,
          round: round,
          processedIndex: processedIndex,
          userConfig: getUserConfig()
        });

        // ⚠️ 调试日志：输出响应中的索引信息
        console.log(`[前端] 第${round}轮响应, nextProcessedIndex=${response.data.nextProcessedIndex}, currentBatch=${response.data.currentBatch}`);

        if (response.data.success) {
          const reply = response.data.reply;

          // 显示本批处理的功能
          if (response.data.currentBatchFunctions && response.data.currentBatchFunctions.length > 0) {
            console.log(`第${round}轮处理的功能:`, response.data.currentBatchFunctions);
          }

          if (!reply.includes('[ALL_DONE]')) {
            setMessages(prev => [...prev, {
              role: 'assistant',
              content: reply
            }]);

            // 解析表格数据
            try {
              const tableRes = await axios.post('/api/parse-table', { markdown: reply });
              if (tableRes.data.success && tableRes.data.tableData.length > 0) {
                const newRows = tableRes.data.tableData;
                const deduplicatedNewData = deduplicateByFunctionalProcess(allTableData, newRows);
                if (deduplicatedNewData.length > 0) {
                  allTableData = [...allTableData, ...deduplicatedNewData];
                  setTableData(allTableData);

                  // 显示本批处理的功能和实际拆分出的功能
                  const newFunctions = [...new Set(deduplicatedNewData.map(r => r.functionalProcess))];
                  console.log(`第${round}轮: 预期处理 ${response.data.currentBatch} 个功能，实际拆出 ${newFunctions.length} 个功能`);
                  console.log('实际拆出的功能:', newFunctions);
                }
              }
            } catch (parseError) {
              console.log(`功能清单拆分第 ${round} 轮表格解析失败:`, parseError.message);
            }

            // 🔍 收集遗漏功能（用于追补拆分）
            if (response.data.hasMissedFunctions && response.data.missedFunctions) {
              const missedInBatch = response.data.missedFunctions;
              console.warn(`⚠️ 第${round}轮遗漏了 ${missedInBatch.length} 个功能:`, missedInBatch);
              // 将遗漏功能添加到追补队列（去重）
              missedInBatch.forEach(missedName => {
                if (!allMissedFunctions.some(f => f.name === missedName)) {
                  const originalFunc = selectedFunctions.find(f => f.name === missedName);
                  if (originalFunc) {
                    allMissedFunctions.push(originalFunc);
                  }
                }
              });
            }
          }

          if (response.data.isDone) {
            // 🔄 阶段2.5：追补遗漏功能
            if (allMissedFunctions.length > 0) {
              console.log(`\n🔄 发现 ${allMissedFunctions.length} 个遗漏功能，开始追补拆分...`);
              setMessages(prev => {
                const filtered = prev.filter(m => !m.content.startsWith('🔄'));
                return [...filtered, {
                  role: 'system',
                  content: `🔄 **追补阶段**\n\n发现 ${allMissedFunctions.length} 个功能在常规批次中未完成拆分，正在追补...`
                }];
              });

              // 对遗漏功能进行专门拆分
              try {
                const supplementResponse = await axios.post('/api/split-from-function-list', {
                  documentContent: documentContent,
                  confirmedFunctions: allMissedFunctions,
                  previousResults: allTableData,
                  round: round + 1,
                  processedIndex: 0  // 从头开始处理遗漏功能
                });

                if (supplementResponse.data.success && !supplementResponse.data.reply.includes('[ALL_DONE]')) {
                  const supplementReply = supplementResponse.data.reply;
                  setMessages(prev => [...prev, {
                    role: 'assistant',
                    content: `**追补拆分结果：**\n\n${supplementReply}`
                  }]);

                  // 解析追补数据
                  try {
                    const supplementTableRes = await axios.post('/api/parse-table', { markdown: supplementReply });
                    if (supplementTableRes.data.success && supplementTableRes.data.tableData.length > 0) {
                      const supplementRows = supplementTableRes.data.tableData;
                      const deduplicatedSupplement = deduplicateByFunctionalProcess(allTableData, supplementRows);
                      if (deduplicatedSupplement.length > 0) {
                        allTableData = [...allTableData, ...deduplicatedSupplement];
                        setTableData(allTableData);
                        console.log(`追补拆分新增 ${deduplicatedSupplement.length} 条数据`);
                      }
                    }
                  } catch (e) {
                    console.log('追补拆分表格解析失败:', e.message);
                  }
                }
              } catch (e) {
                console.error('追补拆分请求失败:', e.message);
              }
            }

            const uniqueFunctions = [...new Set(allTableData.map(r => r.functionalProcess).filter(Boolean))];
            const batchInfo = response.data.totalBatches ? `\n完成批次: ${response.data.totalBatches}/${response.data.totalBatches}` : '';
            const supplementInfo = allMissedFunctions.length > 0 ? `\n追补功能: ${allMissedFunctions.length}个` : '';
            setMessages(prev => {
              const filtered = prev.filter(m => !m.content.startsWith('🔄'));
              return [...filtered, {
                role: 'system',
                content: `✅ **拆分完成！**${batchInfo}${supplementInfo}

**结果统计：**
- 功能过程数: **${uniqueFunctions.length}** / ${selectedFunctions.length} (原实测)
- 子过程总数: **${allTableData.length}** (CFP点数)
- 平均每功能: **${(allTableData.length / Math.max(1, uniqueFunctions.length)).toFixed(1)}** 个子过程

**数据移动类型分布：**
- 输入(E): ${allTableData.filter(r => r.dataMovementType === 'E').length} 个
- 读取(R): ${allTableData.filter(r => r.dataMovementType === 'R').length} 个
- 写入(W): ${allTableData.filter(r => r.dataMovementType === 'W').length} 个
- 输出(X): ${allTableData.filter(r => r.dataMovementType === 'X').length} 个

${uniqueFunctions.length < selectedFunctions.length ? '⚠️ 部分功能可能未完全拆分，请检查原始 **结果** 或 **"导出Excel"** 查看完整结果。' : '✓ 所有功能已拆分完成'}

点击"查看表格"或"导出Excel"查看完整结果。`
              }];
            });
            break;
          }

          // ⚠️ 修复循环拆分问题：更新已处理的索引位置
          // 优先使用后端返回的nextProcessedIndex，确保前后端状态同步
          processedIndex = response.data.nextProcessedIndex || (processedIndex + (response.data.currentBatch || batchSize));
          round++;
        } else {
          throw new Error(response.data.error || '拆分失败');
        }
      }
    } catch (error) {
      console.error('功能清单拆分失败:', error);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `❌ 拆分失败: ${error.message}`
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  // 打开对话式添加功能弹窗
  const addNewFunction = () => {
    setShowAddFunctionDialog(true);
    setAddFunctionInput('');
  };

  // 手动添加一个简单的功能（不经过AI分析）
  const addSimpleFunction = () => {
    const newId = `custom_${Date.now()}`;
    setConfirmedFunctions(prev => [...prev, {
      id: newId,
      name: '新功能',
      triggerType: '用户触发',
      description: '',
      moduleName: '自定义',
      selected: true,
      isNew: true
    }]);
    setShowAddFunctionDialog(false);
  };

  // 对话式AI分析添加功能
  const analyzeAndAddFunctions = async () => {
    if (!addFunctionInput.trim()) {
      showToast('请输入需求描述');
      return;
    }

    if (!apiStatus.hasApiKey) {
      showToast('请先配置API密钥');
      return;
    }

    setIsAnalyzingNewFunction(true);

    try {
      const response = await axios.post('/api/analyze-additional-functions', {
        userInput: addFunctionInput.trim(),
        documentContent: documentContent,
        existingFunctions: confirmedFunctions.map(fn => fn.name)
      });

      if (response.data.success && response.data.functions && response.data.functions.length > 0) {
        const newFunctions = response.data.functions.map((fn, idx) => ({
          id: `ai_${Date.now()}_${idx}`,
          name: fn.name,
          triggerType: fn.triggerType || '用户触发',
          description: fn.description || '',
          moduleName: fn.moduleName || '自定义',
          selected: true,
          isNew: true
        }));

        setConfirmedFunctions(prev => [...prev, ...newFunctions]);
        showToast(`✅ AI识别到 ${newFunctions.length} 个新功能`);
        setShowAddFunctionDialog(false);
        setAddFunctionInput('');
      } else {
        showToast('未识别到新功能，请尝试更详细的描述');
      }
    } catch (error) {
      console.error('AI分析失败:', error);
      showToast(`分析失败: ${error.response?.data?.error || error.message}`);
    } finally {
      setIsAnalyzingNewFunction(false);
    }
  };

  // 更新功能信息
  const updateFunction = (id, field, value) => {
    setConfirmedFunctions(prev => prev.map(fn =>
      fn.id === id ? { ...fn, [field]: value } : fn
    ));
  };

  // 切换功能选中状态
  const toggleFunctionSelection = (id) => {
    setConfirmedFunctions(prev => prev.map(fn =>
      fn.id === id ? { ...fn, selected: !fn.selected } : fn
    ));
  };

  // 删除功能
  const removeFunction = (id) => {
    setConfirmedFunctions(prev => prev.filter(fn => fn.id !== id));
  };

  // 统一的分析入口
  const handleStartAnalysis = async (content, guidelines = '') => {
    setUserGuidelines(guidelines);
    if (splitMode === 'quality') {
      await startQualityAnalysis(content, guidelines);
    } else if (splitMode === 'three-layer') {
      await startThreeLayerAnalysis(content, guidelines);
    } else if (splitMode === 'two-step') {
      await startTwoStepExtraction();
    } else {
      await startAnalysis(content, guidelines);
    }
  };

  // 发送消息 - 增强版：支持后续要求生成cosmic并同步到表格
  const sendMessage = async () => {
    if (!inputText.trim() || isLoading) return;

    // 如果正在等待分析，且有文档内容，则将当前输入作为指导意见开始分析
    if (isWaitingForAnalysis && documentContent) {
      const guidelines = inputText.trim();
      const userMessage = { role: 'user', content: `拆分要求：${guidelines}` };
      setMessages(prev => [...prev, userMessage]);
      setInputText('');
      await handleStartAnalysis(documentContent, guidelines);
      return;
    }

    const userMessage = { role: 'user', content: inputText };
    setMessages(prev => [...prev, userMessage]);
    const userInput = inputText;
    setInputText('');
    setIsLoading(true);
    setStreamingContent('');

    try {
      const response = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentContent: documentContent,
          messages: [...messages.filter(m => m.role !== 'system'), userMessage],
          existingTableData: tableData,
          generateCosmic: true,
          userGuidelines: userGuidelines
        })
      });

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullContent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;

            try {
              const parsed = JSON.parse(data);
              if (parsed.content) {
                fullContent += parsed.content;
                setStreamingContent(fullContent);
              }
            } catch (e) {
              // 忽略解析错误
            }
          }
        }
      }

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: fullContent
      }]);
      setStreamingContent('');

      // 尝试解析表格数据并合并到现有数据
      await parseAndMergeTableData(fullContent, userInput);

    } catch (error) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `❌ 发送失败: ${error.message}`
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  // 解析并合并表格数据（用于对话后续要求）
  const parseAndMergeTableData = async (markdown, userRequest = '') => {
    try {
      const res = await axios.post('/api/parse-table', { markdown });
      if (res.data.success && res.data.tableData.length > 0) {
        const newData = res.data.tableData;

        if (tableData.length === 0) {
          // 如果没有现有数据，直接设置
          setTableData(newData);
          showToast(`✅ 已生成 ${newData.length} 条COSMIC数据`);
        } else {
          // 使用去重函数合并数据
          const deduplicatedNewData = deduplicateByFunctionalProcess(tableData, newData);
          if (deduplicatedNewData.length > 0) {
            const mergedData = [...tableData, ...deduplicatedNewData];
            setTableData(mergedData);
            showToast(`✅ 已新增 ${deduplicatedNewData.length} 条COSMIC数据，共 ${mergedData.length} 条`);
          } else {
            showToast('ℹ️ 未发现新的功能过程数据');
          }
        }
      }
    } catch (error) {
      console.log('表格解析失败，可能没有有效表格:', error.message);
    }
  };

  // 从Markdown解析表格
  const parseTableFromMarkdown = async (markdown) => {
    try {
      const res = await axios.post('/api/parse-table', { markdown });
      if (res.data.success && res.data.tableData.length > 0) {
        setTableData(res.data.tableData);
      }
    } catch (error) {
      console.log('表格解析失败，可能没有有效表格');
    }
  };

  // 两步骤COSMIC拆分 - 第一步：功能过程识别
  const startTwoStepExtraction = async () => {
    if (!documentContent) {
      showToast('请先上传需求文档');
      return;
    }

    setIsTwoStepProcessing(true);
    setTwoStepCurrentStep(1);
    setIsLoading(true);

    setMessages([{
      role: 'system',
      content: '📋 **两步骤COSMIC拆分 - 第一步：功能过程识别**\n正在从需求文档中提取功能过程...'
    }]);

    try {
      const res = await axios.post('/api/two-step/extract-functions', {
        documentContent,
        userConfig: getUserConfig()
      });

      if (res.data.success) {
        setTwoStepFunctionList(res.data.functionProcessList);
        setTwoStepCurrentStep(2);
        setShowFunctionListEditor(true);

        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `## ✅ 功能过程识别完成\n\n已识别出功能过程列表，请在编辑器中查看、修改或补充，然后进行第二步COSMIC拆分。\n\n${res.data.functionProcessList.substring(0, 500)}...\n\n*（完整内容请在编辑器中查看）*`
        }]);

        showToast('功能过程识别完成，请确认后进行COSMIC拆分');
      }
    } catch (error) {
      console.error('功能过程识别失败:', error);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `❌ 功能过程识别失败：${error.response?.data?.error || error.message}`
      }]);
      setTwoStepCurrentStep(0);
      setIsTwoStepProcessing(false);
    } finally {
      setIsLoading(false);
    }
  };

  // 两步骤COSMIC拆分 - 第二步：COSMIC拆分
  const startTwoStepCosmicSplit = async () => {
    if (!twoStepFunctionList || !twoStepFunctionList.trim()) {
      showToast('功能过程列表为空，请先完成第一步');
      return;
    }

    setTwoStepCurrentStep(3);
    setIsLoading(true);
    setShowFunctionListEditor(false);

    setMessages(prev => [...prev, {
      role: 'system',
      content: '🔧 **两步骤COSMIC拆分 - 第二步：COSMIC拆分**\n正在将功能过程列表拆分为COSMIC表格...'
    }]);

    try {
      const res = await axios.post('/api/two-step/cosmic-split', {
        functionProcessList: twoStepFunctionList,
        userConfig: getUserConfig()
      });

      if (res.data.success) {
        if (res.data.tableData && res.data.tableData.length > 0) {
          setTableData(res.data.tableData);

          setMessages(prev => [...prev, {
            role: 'assistant',
            content: `## ✅ COSMIC拆分完成\n\n共生成 **${res.data.tableData.length}** 条COSMIC记录。\n\n功能过程数量：**${[...new Set(res.data.tableData.map(r => r.functionalProcess))].length}** 个\n\n您可以点击"查看表格"按钮查看详细数据，或直接导出Excel。`
          }]);

          showToast(`COSMIC拆分完成，共${res.data.tableData.length}条记录`);
        } else {
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: `## ⚠️ COSMIC拆分完成，但未生成表格数据\n\n${res.data.cosmicResult}`
          }]);
        }

        setTwoStepCurrentStep(0);
        setIsTwoStepProcessing(false);
      }
    } catch (error) {
      console.error('COSMIC拆分失败:', error);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `❌ COSMIC拆分失败：${error.response?.data?.error || error.message}`
      }]);
      setTwoStepCurrentStep(2);
    } finally {
      setIsLoading(false);
    }
  };

  // 导出Excel
  const exportExcel = async () => {
    if (tableData.length === 0) {
      alert('没有可导出的数据，请先进行Cosmic拆分分析');
      return;
    }

    try {
      const response = await axios.post('/api/export-excel', {
        tableData,
        filename: documentName ? documentName.replace('.docx', '') + '_cosmic拆分结果' : 'cosmic拆分结果'
      }, {
        responseType: 'blob'
      });

      // 下载文件
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `${documentName ? documentName.replace('.docx', '') + '_' : ''}cosmic拆分结果.xlsx`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      alert('导出失败: ' + error.message);
    }
  };

  // 复制内容
  const copyContent = (content) => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // 清空对话
  const clearChat = () => {
    setMessages([]);
    setDocumentContent('');
    setDocumentName('');
    setTableData([]);
    setStreamingContent('');
  };

  // 处理键盘事件
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="min-h-screen bg-[#FAF9F7]">
      {/* Claude风格顶部导航 */}
      <header className="bg-[#FAF9F7] border-b border-[#E5E3DE] sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-[#D97757] rounded-lg flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-[#1A1915] tracking-tight">Cosmic</h1>
              <p className="text-xs text-[#A8A49E]">功能规模智能分析</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* API状态 */}
            <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm ${apiStatus.hasApiKey ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
              <CheckCircle className="w-4 h-4" />
              <span>{apiStatus.hasApiKey ? 'API已连接' : '未配置API'}</span>
            </div>

            {/* 拆分模式标识 */}
            <div className="flex items-center bg-[#EDEAE5] rounded-lg p-1">
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium bg-white text-[#D97757] shadow-sm">
                <BarChart3 className="w-4 h-4" />
                <span>两步骤拆分</span>
              </div>
            </div>


            {/* 确认功能清单按钮 - 当有待确认的功能时显示 */}
            {confirmedFunctions.length > 0 && (
              <button
                onClick={() => setShowFunctionListPanel(true)}
                className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium bg-amber-100 text-amber-700 hover:bg-amber-200 rounded-lg transition-all animate-pulse"
              >
                <CheckCircle className="w-4 h-4" />
                <span>确认功能清单</span>
                <span className="bg-amber-500 text-white text-xs px-1.5 py-0.5 rounded-full">
                  {confirmedFunctions.filter(fn => fn.selected).length}
                </span>
              </button>
            )}

            {/* 查看表格按钮 */}
            <button
              onClick={() => setShowTableView(true)}
              disabled={tableData.length === 0}
              className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium bg-[#EDEAE5] text-[#1A1915] hover:bg-[#E5E3DE] rounded-lg disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              <Table className="w-4 h-4" />
              <span>查看表格</span>
              {tableData.length > 0 && (
                <span className="bg-[#D97757] text-white text-xs px-1.5 py-0.5 rounded-full">
                  {tableData.length}
                </span>
              )}
            </button>

            {/* 导出按钮 */}
            <button
              onClick={exportExcel}
              disabled={tableData.length === 0}
              className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium bg-[#D97757] text-white hover:bg-[#C4684A] rounded-lg disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              <Download className="w-4 h-4" />
              <span>导出Excel</span>
            </button>

            {/* 清空按钮 */}
            <button
              onClick={clearChat}
              className="p-2 text-[#6B6760] hover:text-[#D97757] hover:bg-[#EDEAE5] rounded-lg transition-all"
              title="清空对话"
            >
              <Trash2 className="w-4 h-4" />
            </button>

            {/* 模型切换 */}
            <div className="flex items-center bg-[#EDEAE5] rounded-lg p-1">
              <button
                onClick={() => handleModelChange('deepseek-v3')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${selectedModel === 'deepseek-v3'
                  ? 'bg-white text-[#D97757] shadow-sm'
                  : 'text-[#6B6760] hover:text-[#1A1915]'
                  }`}
              >
                <Bot className="w-4 h-4" />
                <span>DeepSeek-V3</span>
              </button>
              <button
                onClick={() => handleModelChange('qwen3-coder')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${selectedModel === 'qwen3-coder'
                  ? 'bg-white text-[#D97757] shadow-sm'
                  : 'text-[#6B6760] hover:text-[#1A1915]'
                  }`}
              >
                <Bot className="w-4 h-4" />
                <span>Qwen3-Coder</span>
              </button>
            </div>

          </div>
        </div>
      </header>

      {/* 双栏主内容区 */}
      <main className="max-w-7xl mx-auto px-6 py-6">
        <div className="flex gap-6 h-[calc(100vh-100px)]">
          {/* 左侧栏 - 上传区和设置 */}
          <div className="w-[400px] flex-shrink-0 flex flex-col gap-4">
            {/* 导入Word文档卡片 */}
            <div className="bg-white border border-[#E5E3DE] rounded-xl p-5">
              <h2 className="text-base font-semibold text-[#1A1915] mb-4 flex items-center gap-2">
                <Upload className="w-5 h-5 text-[#D97757]" />
                导入Word文档
              </h2>
              <div
                ref={dropZoneRef}
                onClick={() => fileInputRef.current?.click()}
                onDragEnter={handleDragEnter}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all ${isDragging
                  ? 'border-[#D97757] bg-[#FEF7F4]'
                  : documentContent
                    ? 'border-[#D97757]/30 bg-[#FEF7F4]/50'
                    : 'border-[#E5E3DE] hover:border-[#D97757]/50 hover:bg-[#FEF7F4]/30'
                  }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".docx,.txt,.md"
                  onChange={handleFileSelect}
                  className="hidden"
                />
                {isDragging ? (
                  <>
                    <Upload className="w-8 h-8 text-[#D97757] mx-auto mb-2 animate-bounce" />
                    <p className="text-[#D97757] font-medium text-sm">松开鼠标上传文件</p>
                  </>
                ) : documentContent ? (
                  <div className="flex flex-col items-center gap-2">
                    <FileText className="w-8 h-8 text-[#D97757]" />
                    <p className="font-medium text-[#1A1915] text-sm">{documentName}</p>
                    <p className="text-xs text-[#6B6760]">{(documentContent.length / 1024).toFixed(1)} KB</p>
                    <div className="flex gap-2 mt-2">
                      <button
                        onClick={(e) => { e.stopPropagation(); setShowPreview(true); }}
                        className="px-3 py-1 text-xs bg-white border border-[#E5E3DE] text-[#6B6760] rounded-lg hover:bg-[#EDEAE5] transition-all"
                      >
                        预览
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (apiStatus.hasApiKey) {
                            // 随时可以重新分析，会中断当前分析并重新开始
                            handleStartAnalysis(documentContent);
                          } else {
                            setToastMessage('API未配置，请检查服务端 .env 文件中的 IFLOW_API_KEY');
                          }
                        }}
                        className="px-3 py-1 text-xs bg-[#D97757] text-white rounded-lg hover:bg-[#C4684A] transition-all flex items-center gap-1"
                      >
                        {isLoading ? (
                          <>
                            <Loader2 className="w-3 h-3 animate-spin" />
                            重新开始
                          </>
                        ) : (
                          <>
                            <RefreshCw className="w-3 h-3" />
                            重新分析
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <FileText className="w-8 h-8 text-[#A8A49E] mx-auto mb-2" />
                    <p className="text-[#1A1915] font-medium text-sm mb-1">点击或拖拽上传</p>
                    <p className="text-xs text-[#A8A49E]">支持 .docx, .txt, .md 格式</p>
                  </>
                )}
              </div>

              {/* 上传进度 */}
              {uploadProgress > 0 && uploadProgress < 100 && (
                <div className="mt-3">
                  <div className="w-full bg-[#E5E3DE] rounded-full h-1.5">
                    <div
                      className="bg-[#D97757] h-1.5 rounded-full transition-all duration-300"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                </div>
              )}

              {/* 错误提示 */}
              {errorMessage && (
                <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-red-700 flex-1">{errorMessage}</p>
                  <button onClick={() => setErrorMessage('')} className="text-red-400 hover:text-red-600">
                    <X className="w-3 h-3" />
                  </button>
                </div>
              )}
            </div>

            {/* 三层分析框架模型选择 - 折叠式 */}
            {splitMode === 'three-layer' && (
              <div className="bg-white border border-[#E5E3DE] rounded-xl overflow-hidden">
                <button
                  onClick={() => setProviderExpanded(!providerExpanded)}
                  className="w-full p-4 flex items-center justify-between hover:bg-[#FEF7F4] transition-all"
                >
                  <div className="flex items-center gap-3">
                    <div className="text-left">
                      <h3 className="text-sm font-medium text-[#1A1915]">大模型提供商</h3>
                      <p className="text-xs text-[#A8A49E]">
                        当前：{threeLayerProvider === 'auto' ? '自动选择' :
                          threeLayerProvider === 'iflow' ? '心流DeepSeek-R1' :
                            threeLayerProvider === 'openrouter' ? '通义千问' :
                              threeLayerProvider === 'groq' ? '文心一言' : '智谱AI'}
                      </p>
                    </div>
                  </div>
                  <ChevronDown className={`w-5 h-5 text-[#A8A49E] transition-transform duration-200 ${providerExpanded ? 'rotate-180' : ''}`} />
                </button>

                {providerExpanded && (
                  <div className="px-4 pb-4 space-y-2 border-t border-[#E5E3DE]">
                    <label className="flex items-center gap-3 p-3 border border-[#E5E3DE] rounded-lg cursor-pointer hover:bg-[#FEF7F4] transition-all mt-3">
                      <input
                        type="radio"
                        name="threeLayerProvider"
                        value="auto"
                        checked={threeLayerProvider === 'auto'}
                        onChange={(e) => setThreeLayerProvider(e.target.value)}
                        className="w-4 h-4 text-[#D97757] focus:ring-[#D97757]"
                      />
                      <div className="flex-1">
                        <div className="text-sm font-medium text-[#1A1915]">自动选择</div>
                        <div className="text-xs text-[#A8A49E]">心流DeepSeek-R1 → 文心一言 → 通义千问 → 智谱</div>
                      </div>
                    </label>
                    <label className="flex items-center gap-3 p-3 border border-[#E5E3DE] rounded-lg cursor-pointer hover:bg-[#FEF7F4] transition-all">
                      <input
                        type="radio"
                        name="threeLayerProvider"
                        value="iflow"
                        checked={threeLayerProvider === 'iflow'}
                        onChange={(e) => setThreeLayerProvider(e.target.value)}
                        className="w-4 h-4 text-[#D97757] focus:ring-[#D97757]"
                      />
                      <div className="flex-1">
                        <div className="text-sm font-medium text-[#1A1915]">心流DeepSeek-R1</div>
                        <div className="text-xs text-[#A8A49E]">心流开放平台 (推荐，速度快)</div>
                      </div>
                    </label>
                    <label className="flex items-center gap-3 p-3 border border-[#E5E3DE] rounded-lg cursor-pointer hover:bg-[#FEF7F4] transition-all">
                      <input
                        type="radio"
                        name="threeLayerProvider"
                        value="openrouter"
                        checked={threeLayerProvider === 'openrouter'}
                        onChange={(e) => setThreeLayerProvider(e.target.value)}
                        className="w-4 h-4 text-[#D97757] focus:ring-[#D97757]"
                      />
                      <div className="flex-1">
                        <div className="text-sm font-medium text-[#1A1915]">通义千问</div>
                        <div className="text-xs text-[#A8A49E]">通义千问测试 (免费)</div>
                      </div>
                    </label>
                    <label className="flex items-center gap-3 p-3 border border-[#E5E3DE] rounded-lg cursor-pointer hover:bg-[#FEF7F4] transition-all">
                      <input
                        type="radio"
                        name="threeLayerProvider"
                        value="groq"
                        checked={threeLayerProvider === 'groq'}
                        onChange={(e) => setThreeLayerProvider(e.target.value)}
                        className="w-4 h-4 text-[#D97757] focus:ring-[#D97757]"
                      />
                      <div className="flex-1">
                        <div className="text-sm font-medium text-[#1A1915]">文心一言</div>
                        <div className="text-xs text-[#A8A49E]">测试(速度快)</div>
                      </div>
                    </label>
                    <label className="flex items-center gap-3 p-3 border border-[#E5E3DE] rounded-lg cursor-pointer hover:bg-[#FEF7F4] transition-all">
                      <input
                        type="radio"
                        name="threeLayerProvider"
                        value="zhipu"
                        checked={threeLayerProvider === 'zhipu'}
                        onChange={(e) => setThreeLayerProvider(e.target.value)}
                        className="w-4 h-4 text-[#D97757] focus:ring-[#D97757]"
                      />
                      <div className="flex-1">
                        <div className="text-sm font-medium text-[#1A1915]">智谱AI</div>
                        <div className="text-xs text-[#A8A49E]">GLM-4 Flash (国内稳定)</div>
                      </div>
                    </label>
                  </div>
                )}
              </div>
            )}

            {/* 最少功能过程数量设置 */}
            <div className="bg-white border border-[#E5E3DE] rounded-xl p-5">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="text-sm font-medium text-[#1A1915]">最少功能过程数量</h3>
                  <p className="text-xs text-[#A8A49E]">达到该数量后才停止分析（默认30，推荐30-120）</p>
                </div>
                <span className="text-xl font-bold text-[#D97757]">{minFunctionCount}</span>
              </div>
              <input
                type="range"
                min="10"
                max="150"
                step="5"
                value={minFunctionCount}
                onChange={(e) => setMinFunctionCount(Number(e.target.value))}
                className="w-full accent-[#D97757]"
              />
              <div className="mt-2">
                <input
                  type="number"
                  min="10"
                  max="150"
                  value={minFunctionCount}
                  onChange={(e) => setMinFunctionCount(Math.min(150, Math.max(10, Number(e.target.value) || 10)))}
                  className="w-full px-3 py-2 border border-[#E5E3DE] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#D97757]/20 focus:border-[#D97757]"
                />
              </div>
            </div>

            {/* 使用说明卡片 */}
            <div className="bg-white border border-[#E5E3DE] rounded-xl p-5">
              <h3 className="text-sm font-semibold text-[#1A1915] mb-3">使用说明</h3>
              <div className="space-y-2">
                <div className="flex items-start gap-2">
                  <span className="w-5 h-5 bg-[#D97757] text-white text-xs rounded-full flex items-center justify-center flex-shrink-0">1</span>
                  <p className="text-xs text-[#6B6760]">上传包含功能过程描述的Word文档</p>
                </div>
                <div className="flex items-start gap-2">
                  <span className="w-5 h-5 bg-[#D97757] text-white text-xs rounded-full flex items-center justify-center flex-shrink-0">2</span>
                  <p className="text-xs text-[#6B6760]">AI自动分析并生成Cosmic拆分表格</p>
                </div>
                <div className="flex items-start gap-2">
                  <span className="w-5 h-5 bg-[#D97757] text-white text-xs rounded-full flex items-center justify-center flex-shrink-0">3</span>
                  <p className="text-xs text-[#6B6760]">通过对话优化拆分结果</p>
                </div>
                <div className="flex items-start gap-2">
                  <span className="w-5 h-5 bg-[#D97757] text-white text-xs rounded-full flex items-center justify-center flex-shrink-0">4</span>
                  <p className="text-xs text-[#6B6760]">导出Excel格式的拆分结果</p>
                </div>
              </div>
            </div>

            {/* 需求内容卡片 - 有文档时显示 */}
            {documentContent && (
              <div className="bg-white border border-[#E5E3DE] rounded-xl p-5 flex-1 min-h-0 flex flex-col">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-[#1A1915] flex items-center gap-2">
                    <FileText className="w-4 h-4 text-[#D97757]" />
                    需求内容
                  </h3>
                  <button
                    onClick={() => setShowPreview(true)}
                    className="text-xs text-[#D97757] hover:underline"
                  >
                    查看完整内容 →
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto bg-[#FAF9F7] rounded-lg p-3 text-xs text-[#6B6760] leading-relaxed max-h-[300px]">
                  <pre className="whitespace-pre-wrap font-sans">
                    {documentContent.length > 2000
                      ? documentContent.substring(0, 2000) + '\n\n... (点击"查看完整内容"查看更多)'
                      : documentContent}
                  </pre>
                </div>
              </div>
            )}

            {/* 统计卡片 - 有数据时显示 */}
            {tableData.length > 0 && (
              <div className="bg-white border border-[#E5E3DE] rounded-xl p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-[#1A1915] flex items-center gap-2">
                    <BarChart3 className="w-4 h-4 text-[#D97757]" />
                    分析结果
                  </h3>
                  <button
                    onClick={() => setShowTableView(true)}
                    className="text-xs text-[#D97757] hover:underline"
                  >
                    查看表格 →
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="text-center p-2 bg-[#FEF7F4] rounded-lg">
                    <p className="text-xl font-bold text-[#D97757]">
                      {[...new Set(tableData.map(r => r.functionalProcess).filter(Boolean))].length}
                    </p>
                    <p className="text-xs text-[#6B6760]">功能过程</p>
                  </div>
                  <div className="text-center p-2 bg-green-50 rounded-lg">
                    <p className="text-xl font-bold text-green-600">{tableData.length}</p>
                    <p className="text-xs text-[#6B6760]">子过程(CFP)</p>
                  </div>
                </div>
                {/* 功能过程关键词 */}
                <div className="mt-3 pt-3 border-t border-[#E5E3DE]">
                  <p className="text-xs text-[#6B6760] mb-2">功能过程关键词：</p>
                  <div className="flex flex-wrap gap-1">
                    {[...new Set(tableData.map(r => r.functionalProcess).filter(Boolean))].slice(0, 8).map((fp, idx) => (
                      <span key={idx} className="px-2 py-0.5 bg-[#EDEAE5] text-[#6B6760] text-xs rounded-full">
                        {fp}
                      </span>
                    ))}
                    {[...new Set(tableData.map(r => r.functionalProcess).filter(Boolean))].length > 8 && (
                      <span className="px-2 py-0.5 bg-[#D97757] text-white text-xs rounded-full">
                        +{[...new Set(tableData.map(r => r.functionalProcess).filter(Boolean))].length - 8}
                      </span>
                    )}
                  </div>
                </div>
                {/* 两步拆分模式下显示重新编辑按钮 */}
                {splitMode === 'two-step' && twoStepFunctionList && (
                  <div className="mt-3 pt-3 border-t border-[#E5E3DE]">
                    <button
                      onClick={() => setShowFunctionListEditor(true)}
                      className="w-full px-3 py-2 bg-amber-50 border border-amber-200 text-amber-700 text-xs rounded-lg hover:bg-amber-100 transition-colors flex items-center justify-center gap-2"
                    >
                      <BarChart3 className="w-3 h-3" />
                      重新编辑功能过程列表
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 右侧栏 - 对话区 */}
          <div className="flex-1 flex flex-col bg-white border border-[#E5E3DE] rounded-xl overflow-hidden">
            {/* 对话区头部 */}
            <div className="px-5 py-4 border-b border-[#E5E3DE] flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-[#FEF7F4] rounded-xl flex items-center justify-center">
                  <Bot className="w-5 h-5 text-[#D97757]" />
                </div>
                <div>
                  <h2 className="font-medium text-[#1A1915]">开始分析</h2>
                  <p className="text-xs text-[#6B6760]">上传文档或直接输入内容</p>
                </div>
              </div>
            </div>

            {/* 对话消息区 */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {messages.length === 0 && !streamingContent && (
                <div className="text-center py-12 text-[#A8A49E]">
                  <Bot className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">上传文档或输入内容开始对话</p>
                </div>
              )}

              {messages.map((msg, idx) => (
                <div key={idx} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${msg.role === 'user'
                    ? 'bg-[#1A1915]'
                    : msg.role === 'system'
                      ? 'bg-[#A8A49E]'
                      : 'bg-[#D97757]'
                    }`}>
                    {msg.role === 'user' ? (
                      <User className="w-4 h-4 text-white" />
                    ) : (
                      <Sparkles className="w-4 h-4 text-white" />
                    )}
                  </div>
                  <div className={`flex-1 max-w-[80%] ${msg.role === 'user' ? 'text-right' : ''}`}>
                    <div className={`inline-block text-left ${msg.role === 'user'
                      ? 'bg-[#1A1915] text-white rounded-2xl rounded-tr-md px-4 py-2.5'
                      : msg.role === 'system'
                        ? 'bg-[#EDEAE5] text-[#6B6760] rounded-2xl rounded-tl-md px-4 py-2.5'
                        : 'bg-[#FAF9F7] border border-[#E5E3DE] text-[#1A1915] rounded-2xl rounded-tl-md px-4 py-2.5'
                      }`}>
                      {msg.role === 'assistant' ? (
                        <div className="prose prose-sm max-w-none prose-headings:text-[#1A1915] prose-p:text-[#1A1915] prose-strong:text-[#1A1915]">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {msg.content}
                          </ReactMarkdown>
                        </div>
                      ) : (
                        <p className="whitespace-pre-wrap text-sm">{msg.content}</p>
                      )}
                    </div>
                    {msg.role === 'assistant' && (
                      <button
                        onClick={() => copyContent(msg.content)}
                        className="mt-1 text-xs text-[#A8A49E] hover:text-[#6B6760] flex items-center gap-1"
                      >
                        {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                        {copied ? '已复制' : '复制'}
                      </button>
                    )}
                  </div>
                </div>
              ))}

              {/* 流式输出 */}
              {streamingContent && (
                <div className="flex gap-3">
                  <div className="w-8 h-8 rounded-lg bg-[#D97757] flex items-center justify-center flex-shrink-0">
                    <Sparkles className="w-4 h-4 text-white" />
                  </div>
                  <div className="flex-1 max-w-[80%]">
                    <div className="bg-[#FAF9F7] border border-[#E5E3DE] rounded-2xl rounded-tl-md px-4 py-2.5">
                      <div className="prose prose-sm max-w-none">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {streamingContent}
                        </ReactMarkdown>
                      </div>
                      <span className="inline-block w-2 h-4 bg-[#D97757] animate-pulse ml-1" />
                    </div>
                  </div>
                </div>
              )}

              {/* 加载状态 */}
              {isLoading && !streamingContent && (
                <div className="flex gap-3">
                  <div className="w-8 h-8 rounded-lg bg-[#D97757] flex items-center justify-center">
                    <Sparkles className="w-4 h-4 text-white" />
                  </div>
                  <div className="bg-[#FAF9F7] border border-[#E5E3DE] rounded-2xl rounded-tl-md px-4 py-2.5 flex items-center gap-2">
                    <Loader2 className="w-4 h-4 text-[#D97757] animate-spin" />
                    <span className="text-sm text-[#6B6760]">正在分析中...</span>
                  </div>
                </div>
              )}

              {/* 等待分析提示 */}
              {isWaitingForAnalysis && documentContent && (
                <div className="flex justify-end">
                  <div className="inline-flex items-center gap-3 bg-orange-50 border border-orange-100 rounded-lg p-3 animate-fade-in">
                    <div className="flex items-center gap-2 text-orange-800 text-sm">
                      <Info className="w-4 h-4 flex-shrink-0" />
                      <span>输入限制条件后发送，或直接开始</span>
                    </div>
                    <button
                      onClick={() => handleStartAnalysis(documentContent, inputText.trim())}
                      disabled={isLoading}
                      className="px-4 py-1.5 bg-[#D97757] text-white rounded-lg hover:bg-[#C4684A] shadow-sm transition-all flex items-center gap-2 text-sm font-medium whitespace-nowrap"
                    >
                      <Sparkles className="w-4 h-4" />
                      开始智能拆分
                    </button>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* 输入区 */}
            <div className="p-4 border-t border-[#E5E3DE]">
              <div className="bg-[#FAF9F7] border border-[#E5E3DE] rounded-xl p-2">
                <div className="flex gap-2">
                  <textarea
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="输入功能过程描述或与AI对话..."
                    className="flex-1 resize-none border-0 bg-transparent px-3 py-2 focus:outline-none text-[#1A1915] placeholder:text-[#A8A49E] text-sm"
                    rows={1}
                  />
                  <button
                    onClick={sendMessage}
                    disabled={!inputText.trim() || isLoading}
                    className="px-4 py-2 bg-[#D97757] text-white rounded-lg hover:bg-[#C4684A] disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center gap-2"
                  >
                    {isLoading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Send className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>
              <p className="text-xs text-[#A8A49E] text-center mt-2">按 Enter 发送，Shift + Enter 换行</p>
            </div>
          </div>
        </div>
      </main>

      {/* API设置弹窗已移除 - 心流平台密钥由后端.env管理，无需前端配置 */}

      {/* 文档预览弹窗 */}
      {showPreview && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl m-4 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b">
              <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                <FileText className="w-5 h-5 text-blue-500" />
                文档预览: {documentName}
              </h2>
              <button
                onClick={() => setShowPreview(false)}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              <pre className="whitespace-pre-wrap text-sm text-gray-700 font-mono bg-gray-50 p-4 rounded-lg">
                {documentContent}
              </pre>
            </div>
            <div className="p-4 border-t flex justify-end gap-3">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(documentContent);
                  alert('文档内容已复制到剪贴板');
                }}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 flex items-center gap-2"
              >
                <Copy className="w-4 h-4" />
                复制内容
              </button>
              <button
                onClick={() => setShowPreview(false)}
                className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 表格预览弹窗 */}
      {showTableView && tableData.length > 0 && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-6xl m-4 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b">
              <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                <Table className="w-5 h-5 text-blue-500" />
                Cosmic拆分结果表格 ({tableData.length} 条记录)
              </h2>
              <button
                onClick={() => setShowTableView(false)}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-blue-500 text-white">
                    <th className="border border-blue-600 px-3 py-2 text-left">功能用户</th>
                    <th className="border border-blue-600 px-3 py-2 text-left">触发事件</th>
                    <th className="border border-blue-600 px-3 py-2 text-left">功能过程</th>
                    <th className="border border-blue-600 px-3 py-2 text-left">子过程描述</th>
                    <th className="border border-blue-600 px-3 py-2 text-center w-20">类型</th>
                    <th className="border border-blue-600 px-3 py-2 text-left">数据组</th>
                    <th className="border border-blue-600 px-3 py-2 text-left">数据属性</th>
                  </tr>
                </thead>
                <tbody>
                  {tableData.map((row, idx) => {
                    // 只有E类型行显示功能用户、触发事件、功能过程，R/W/X行这三列留空
                    const isEntryRow = row.dataMovementType === 'E';
                    return (
                      <tr key={idx} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                        <td className="border border-gray-200 px-3 py-2">{isEntryRow ? row.functionalUser : ''}</td>
                        <td className="border border-gray-200 px-3 py-2">{isEntryRow ? row.triggerEvent : ''}</td>
                        <td className="border border-gray-200 px-3 py-2 font-medium">{isEntryRow ? row.functionalProcess : ''}</td>
                        <td className="border border-gray-200 px-3 py-2">{row.subProcessDesc}</td>
                        <td className="border border-gray-200 px-3 py-2 text-center">
                          <span className={`px-2 py-0.5 rounded text-xs font-bold ${row.dataMovementType === 'E' ? 'bg-green-100 text-green-700' :
                            row.dataMovementType === 'R' ? 'bg-blue-100 text-blue-700' :
                              row.dataMovementType === 'W' ? 'bg-orange-100 text-orange-700' :
                                row.dataMovementType === 'X' ? 'bg-purple-100 text-purple-700' :
                                  'bg-gray-100 text-gray-700'
                            }`}>
                            {row.dataMovementType}
                          </span>
                        </td>
                        <td className="border border-gray-200 px-3 py-2">{row.dataGroup}</td>
                        <td className="border border-gray-200 px-3 py-2">{row.dataAttributes}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="p-4 border-t flex justify-end gap-3">
              <button
                onClick={exportExcel}
                className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 flex items-center gap-2"
              >
                <FileSpreadsheet className="w-4 h-4" />
                导出Excel
              </button>
              <button
                onClick={() => setShowTableView(false)}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 功能清单确认面板 */}
      {showFunctionListPanel && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
            {/* 面板标题 */}
            <div className="p-6 border-b border-gray-200 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                  <CheckCircle className="w-6 h-6 text-amber-500" />
                  确认功能清单
                </h2>
                <p className="text-sm text-gray-500 mt-1">
                  请确认以下功能是否正确，您可以添加、删除或修改功能
                </p>
              </div>
              <button
                onClick={() => setShowFunctionListPanel(false)}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            {/* 功能列表 */}
            <div className="flex-1 overflow-auto p-6">
              <div className="space-y-3">
                {confirmedFunctions.map((fn, idx) => (
                  <div
                    key={fn.id || idx}
                    className={`p-4 rounded-xl border-2 transition-all ${fn.selected
                      ? 'border-amber-300 bg-amber-50'
                      : 'border-gray-200 bg-gray-50 opacity-60'
                      }`}
                  >
                    <div className="flex items-start gap-4">
                      {/* 选中复选框 */}
                      <input
                        type="checkbox"
                        checked={fn.selected}
                        onChange={() => toggleFunctionSelection(fn.id)}
                        className="mt-1.5 w-5 h-5 text-amber-500 rounded focus:ring-amber-400"
                      />

                      {/* 功能信息 */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2">
                          {fn.isNew ? (
                            <input
                              type="text"
                              value={fn.name}
                              onChange={(e) => updateFunction(fn.id, 'name', e.target.value)}
                              className="flex-1 px-3 py-1.5 border border-amber-300 rounded-lg text-sm font-medium focus:outline-none focus:ring-2 focus:ring-amber-400"
                              placeholder="输入功能名称"
                            />
                          ) : (
                            <span className="font-medium text-gray-800">{fn.name}</span>
                          )}
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${fn.triggerType === '时钟触发'
                            ? 'bg-blue-100 text-blue-700'
                            : fn.triggerType === '接口触发'
                              ? 'bg-purple-100 text-purple-700'
                              : 'bg-green-100 text-green-700'
                            }`}>
                            {fn.triggerType || '用户触发'}
                          </span>
                          <span className="px-2 py-0.5 rounded text-xs bg-gray-200 text-gray-600">
                            {fn.moduleName || '未分类'}
                          </span>
                        </div>
                        {fn.description && (
                          <p className="text-sm text-gray-500">{fn.description}</p>
                        )}
                        {fn.interval && (
                          <p className="text-xs text-blue-600 mt-1">⏰ 执行间隔: {fn.interval}</p>
                        )}
                      </div>

                      {/* 删除按钮 */}
                      <button
                        onClick={() => removeFunction(fn.id)}
                        className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                        title="删除此功能"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* 对话式添加新功能区域 */}
              <div className="mt-4 p-4 border-2 border-dashed border-gray-300 rounded-xl bg-gray-50 hover:border-amber-300 transition-all">
                <div className="flex items-center gap-2 mb-3">
                  <Bot className="w-5 h-5 text-amber-500" />
                  <span className="font-medium text-gray-700">添加新功能</span>
                </div>

                <textarea
                  value={addFunctionInput}
                  onChange={(e) => setAddFunctionInput(e.target.value)}
                  placeholder="请描述您要添加的功能需求，例如：&#10;• 我需要一个数据导出功能，支持导出Excel和PDF格式&#10;• 系统需要支持按日期范围查询用户活动数据&#10;• 添加一个定时任务用于每天凌晨汇总前一天的数据"
                  className="w-full px-4 py-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent resize-none bg-white"
                  rows={4}
                  disabled={isAnalyzingNewFunction}
                />

                <div className="flex items-center justify-between mt-3">
                  <button
                    onClick={addSimpleFunction}
                    className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                    disabled={isAnalyzingNewFunction}
                  >
                    <Plus className="w-4 h-4 inline mr-1" />
                    直接添加空白功能
                  </button>

                  <button
                    onClick={analyzeAndAddFunctions}
                    disabled={isAnalyzingNewFunction || !addFunctionInput.trim()}
                    className="px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-2 text-sm font-medium"
                  >
                    {isAnalyzingNewFunction ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        AI分析中...
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4" />
                        AI智能分析
                      </>
                    )}
                  </button>
                </div>

                {addFunctionInput.trim() && (
                  <p className="text-xs text-gray-400 mt-2">
                    💡 提示：AI将根据您的描述自动识别功能点、触发类型和所属模块
                  </p>
                )}
              </div>
            </div>

            {/* 底部操作栏 */}
            <div className="p-6 border-t border-gray-200 flex items-center justify-between">
              <div className="text-sm text-gray-500">
                已选择 <span className="font-bold text-amber-600">{confirmedFunctions.filter(fn => fn.selected).length}</span> / {confirmedFunctions.length} 个功能
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowFunctionListPanel(false)}
                  className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  稍后确认
                </button>
                <button
                  onClick={() => {
                    setConfirmedFunctions([]);
                    setFunctionList(null);
                    setShowFunctionListPanel(false);
                  }}
                  className="px-4 py-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                >
                  清空列表
                </button>
                <button
                  onClick={startSplitFromFunctionList}
                  disabled={confirmedFunctions.filter(fn => fn.selected).length === 0}
                  className="px-6 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2 font-medium"
                >
                  <Zap className="w-4 h-4" />
                  确认并开始拆分
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Toast提示 */}
      {toastMessage && (
        <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 z-50 animate-fade-in">
          <div className="bg-[#1A1915] text-white px-6 py-3 rounded-xl shadow-lg flex items-center gap-3 max-w-md">
            <CheckCircle className="w-5 h-5 text-[#D97757] flex-shrink-0" />
            <span className="text-sm">{toastMessage}</span>
          </div>
        </div>
      )}

      {/* 模型选择弹窗已移除 - 模型切换通过侧边栏完成 */}

      {/* Red Alert GI Watermark */}
      <div className="gi-watermark">
        <div className="gi-soldier"></div>
      </div>

      {/* 功能过程列表编辑器弹窗 - 两步骤COSMIC拆分 */}
      {showFunctionListEditor && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-6xl m-4 h-[90vh] flex flex-col">
            {/* 标题栏 */}
            <div className="flex items-center justify-between p-6 border-b border-gray-200 flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-amber-100 rounded-lg flex items-center justify-center">
                  <BarChart3 className="w-5 h-5 text-amber-600" />
                </div>
                <div>
                  <h2 className="text-xl font-semibold text-gray-800">功能过程列表编辑器</h2>
                  <p className="text-sm text-gray-500">请确认、修改或补充功能过程，然后进行COSMIC拆分</p>
                </div>
              </div>
              <button
                onClick={() => setShowFunctionListEditor(false)}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            {/* 编辑器内容 */}
            <div className="flex-1 overflow-hidden p-6 flex flex-col min-h-0">
              {/* 步骤指示 */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex-shrink-0 mb-4">
                <div className="flex items-start gap-3">
                  <Info className="w-5 h-5 text-blue-500 mt-0.5 flex-shrink-0" />
                  <div className="text-sm text-blue-700">
                    <p className="font-medium mb-1">第一步已完成：功能过程识别</p>
                    <p>AI已从需求文档中提取功能过程。您可以在下方文本框中：</p>
                    <ul className="list-disc list-inside mt-2 space-y-1">
                      <li>检查识别结果是否准确</li>
                      <li>修改功能过程描述</li>
                      <li>添加遗漏的功能过程</li>
                      <li>删除不需要的功能过程</li>
                    </ul>
                  </div>
                </div>
              </div>

              {/* 文本编辑器 */}
              <div className="flex-1 flex flex-col min-h-0">
                <label className="block text-sm font-medium text-gray-700 mb-2 flex-shrink-0">
                  功能过程列表（Markdown格式）
                </label>
                <textarea
                  value={twoStepFunctionList}
                  onChange={(e) => setTwoStepFunctionList(e.target.value)}
                  className="flex-1 w-full px-4 py-3 border border-gray-300 rounded-lg font-mono text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent resize-none bg-gray-50 overflow-y-auto"
                  placeholder="功能过程列表将显示在这里..."
                  style={{ minHeight: '300px' }}
                />
                <p className="mt-2 text-xs text-gray-500 flex-shrink-0">
                  💡 提示：保持Markdown格式（使用 # 和 ##），每个功能过程应包含功能用户、触发事件、功能过程和子过程描述
                </p>
              </div>
            </div>

            {/* 底部按钮 */}
            <div className="flex items-center justify-between p-6 border-t border-gray-200 bg-gray-50 flex-shrink-0">
              <button
                onClick={() => setShowFunctionListEditor(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 rounded-lg transition-colors"
              >
                取消
              </button>
              <div className="flex items-center gap-3">
                <div className="text-sm text-gray-500">
                  字符数: {twoStepFunctionList.length}
                </div>
                <button
                  onClick={startTwoStepCosmicSplit}
                  disabled={!twoStepFunctionList.trim() || isLoading}
                  className="flex items-center gap-2 px-6 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
                >
                  <Zap className="w-4 h-4" />
                  <span>开始COSMIC拆分</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* API配置引导弹窗已移除 - 心流平台密钥由后端.env管理，无需前端配置 */}

    </div>
  );
}

export default App;
