// ==========================================
// 前端集成示例 - 大文档优化版本
// ==========================================

/**
 * 功能清单提取 - 支持大文档分块处理和多轮迭代
 * @param {string} documentContent - 文档内容
 * @param {Object} options - 配置选项
 * @returns {Promise<Object>} 功能清单结果
 */
async function extractFunctionList(documentContent, options = {}) {
  const {
    enableChunking = true,    // 是否启用分块处理
    maxIterations = 3,        // 最大迭代轮数（1-5）
    onProgress = null         // 进度回调函数
  } = options;

  try {
    // 1. 显示处理中状态
    if (onProgress) {
      onProgress({
        stage: 'starting',
        message: '正在准备分析文档...',
        progress: 0
      });
    }

    // 2. 根据文档大小智能调整迭代轮数
    const adjustedIterations = documentContent.length > 15000 ? 
      Math.max(maxIterations, 3) : 
      Math.min(maxIterations, 2);

    if (onProgress) {
      const willChunk = documentContent.length > 8000;
      onProgress({
        stage: 'analyzing',
        message: willChunk ? 
          `检测到大文档(${documentContent.length}字符)，将分块处理...` : 
          '正在分析文档...',
        progress: 10
      });
    }

    // 3. 调用API
    const startTime = Date.now();
    const response = await fetch('/api/extract-function-list', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        documentContent,
        enableChunking,
        maxIterations: adjustedIterations
      })
    });

    if (!response.ok) {
      throw new Error(`API请求失败: ${response.status}`);
    }

    const result = await response.json();
    const duration = Date.now() - startTime;

    // 4. 处理结果
    if (onProgress) {
      onProgress({
        stage: 'completed',
        message: '文档分析完成！',
        progress: 100
      });
    }

    // 5. 输出统计信息
    console.log('========================================');
    console.log('功能清单提取完成');
    console.log('========================================');
    console.log(`处理模式: ${result.mode === 'chunked' ? '分块处理' : '标准处理'}`);
    if (result.mode === 'chunked') {
      console.log(`文档分块数: ${result.totalChunks || 0}`);
    }
    console.log(`识别功能数: ${result.functionList.totalFunctions}`);
    console.log(`处理耗时: ${(duration / 1000).toFixed(1)}秒`);
    console.log(`平均速度: ${Math.round(result.functionList.totalFunctions / (duration / 1000))}个功能/秒`);
    console.log('========================================');

    return result;

  } catch (error) {
    console.error('功能清单提取失败:', error);
    if (onProgress) {
      onProgress({
        stage: 'error',
        message: '提取失败: ' + error.message,
        progress: 0
      });
    }
    throw error;
  }
}

// ==========================================
// 使用示例1：基础使用
// ==========================================
async function example1_basicUsage() {
  const documentContent = `
    这里是你的需求文档内容...
    可能有很多页...
  `;

  try {
    const result = await extractFunctionList(documentContent);
    
    // 显示结果
    console.log('项目名称:', result.functionList.projectName);
    console.log('功能总数:', result.functionList.totalFunctions);
    
    // 遍历模块和功能
    result.functionList.modules.forEach(module => {
      console.log(`\n模块: ${module.moduleName}`);
      module.functions.forEach(func => {
        console.log(`  - ${func.name} (${func.triggerType})`);
      });
    });
    
  } catch (error) {
    console.error('处理失败:', error);
  }
}

// ==========================================
// 使用示例2：带进度提示
// ==========================================
async function example2_withProgress() {
  const documentContent = '...'; // 你的文档内容

  // 创建进度提示元素
  const progressDiv = document.createElement('div');
  progressDiv.id = 'progress-indicator';
  progressDiv.innerHTML = `
    <div class="progress-bar">
      <div class="progress-fill" style="width: 0%"></div>
    </div>
    <div class="progress-message">准备中...</div>
  `;
  document.body.appendChild(progressDiv);

  try {
    const result = await extractFunctionList(documentContent, {
      enableChunking: true,
      maxIterations: 3,
      onProgress: (info) => {
        // 更新进度条
        const progressFill = document.querySelector('.progress-fill');
        const progressMessage = document.querySelector('.progress-message');
        
        if (progressFill) {
          progressFill.style.width = info.progress + '%';
        }
        if (progressMessage) {
          progressMessage.textContent = info.message;
        }

        console.log(`[${info.stage}] ${info.message} (${info.progress}%)`);
      }
    });

    // 处理成功
    document.getElementById('progress-indicator').remove();
    showSuccessMessage(`成功识别 ${result.functionList.totalFunctions} 个功能！`);
    
    return result;

  } catch (error) {
    document.getElementById('progress-indicator').remove();
    showErrorMessage('功能提取失败: ' + error.message);
  }
}

// ==========================================
// 使用示例3：批量处理多个文档
// ==========================================
async function example3_batchProcessing(documents) {
  const results = [];
  
  for (let i = 0; i < documents.length; i++) {
    const doc = documents[i];
    console.log(`\n处理文档 ${i + 1}/${documents.length}: ${doc.name}`);
    
    try {
      const result = await extractFunctionList(doc.content, {
        enableChunking: true,
        maxIterations: 2, // 批量处理时可以降低迭代轮数以加快速度
        onProgress: (info) => {
          console.log(`  [${doc.name}] ${info.message}`);
        }
      });
      
      results.push({
        documentName: doc.name,
        success: true,
        functionCount: result.functionList.totalFunctions,
        result: result
      });
      
      // 添加延迟以避免API速率限制
      await sleep(2000);
      
    } catch (error) {
      results.push({
        documentName: doc.name,
        success: false,
        error: error.message
      });
    }
  }
  
  // 输出批量处理统计
  console.log('\n========================================');
  console.log('批量处理完成');
  console.log('========================================');
  console.log(`总文档数: ${documents.length}`);
  console.log(`成功: ${results.filter(r => r.success).length}`);
  console.log(`失败: ${results.filter(r => !r.success).length}`);
  console.log(`总功能数: ${results.filter(r => r.success).reduce((sum, r) => sum + r.functionCount, 0)}`);
  
  return results;
}

// ==========================================
// 使用示例4：与现有工作流集成
// ==========================================
async function example4_workflowIntegration() {
  // 假设这是你现有的文档分析流程
  
  // 步骤1: 用户上传文档
  const documentContent = getUserUploadedDocument();
  
  // 步骤2: 提取功能清单（新增）
  console.log('🔍 步骤1: 提取功能清单...');
  const extractResult = await extractFunctionList(documentContent, {
    enableChunking: true,
    maxIterations: 3
  });
  
  const functionList = extractResult.functionList;
  console.log(`✅ 识别到 ${functionList.totalFunctions} 个功能`);
  
  // 步骤3: 用户确认功能清单（现有流程）
  console.log('\n📋 步骤2: 用户确认功能清单...');
  const confirmedFunctions = await showFunctionListForConfirmation(functionList);
  console.log(`✅ 用户确认了 ${confirmedFunctions.length} 个功能`);
  
  // 步骤4: 基于确认的功能进行ERWX拆分（现有流程）
  console.log('\n⚙️ 步骤3: 进行ERWX拆分...');
  const splitResult = await performERWXSplit(documentContent, confirmedFunctions);
  console.log(`✅ 拆分完成，生成 ${splitResult.rowCount} 行数据`);
  
  // 步骤5: 导出Excel（现有流程）
  console.log('\n📊 步骤4: 导出Excel...');
  await exportToExcel(splitResult);
  console.log('✅ Excel已生成');
  
  return {
    functionList,
    confirmedFunctions,
    splitResult
  };
}

// ==========================================
// 辅助函数
// ==========================================

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getUserUploadedDocument() {
  // 实现文档上传逻辑
  return '文档内容...';
}

async function showFunctionListForConfirmation(functionList) {
  // 实现功能清单确认界面
  // 这里简化处理，实际应显示UI让用户选择
  return functionList.modules.flatMap(m => m.functions || []);
}

async function performERWXSplit(documentContent, confirmedFunctions) {
  // 调用现有的ERWX拆分API
  const response = await fetch('/api/split-from-function-list', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      documentContent,
      confirmedFunctions,
      previousResults: [],
      round: 1
    })
  });
  
  return await response.json();
}

async function exportToExcel(splitResult) {
  // 实现Excel导出逻辑
  console.log('导出Excel...');
}

function showSuccessMessage(message) {
  console.log('✅ ' + message);
  // 实现UI提示
}

function showErrorMessage(message) {
  console.error('❌ ' + message);
  // 实现UI提示
}

// ==========================================
// 性能监控工具
// ==========================================

class PerformanceMonitor {
  constructor() {
    this.metrics = [];
  }

  async track(name, asyncFn) {
    const startTime = Date.now();
    const startMemory = performance.memory ? performance.memory.usedJSHeapSize : 0;
    
    try {
      const result = await asyncFn();
      const duration = Date.now() - startTime;
      const endMemory = performance.memory ? performance.memory.usedJSHeapSize : 0;
      
      this.metrics.push({
        name,
        duration,
        memoryDelta: endMemory - startMemory,
        success: true,
        timestamp: new Date().toISOString()
      });
      
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      
      this.metrics.push({
        name,
        duration,
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      });
      
      throw error;
    }
  }

  report() {
    console.log('\n========================================');
    console.log('性能监控报告');
    console.log('========================================');
    
    this.metrics.forEach(metric => {
      console.log(`\n${metric.name}:`);
      console.log(`  耗时: ${metric.duration}ms`);
      if (metric.memoryDelta) {
        console.log(`  内存: ${(metric.memoryDelta / 1024 / 1024).toFixed(2)}MB`);
      }
      console.log(`  状态: ${metric.success ? '成功' : '失败'}`);
      if (metric.error) {
        console.log(`  错误: ${metric.error}`);
      }
    });
    
    const totalDuration = this.metrics.reduce((sum, m) => sum + m.duration, 0);
    const successCount = this.metrics.filter(m => m.success).length;
    
    console.log('\n总计:');
    console.log(`  总耗时: ${totalDuration}ms`);
    console.log(`  成功率: ${(successCount / this.metrics.length * 100).toFixed(1)}%`);
    console.log('========================================\n');
  }
}

// 使用性能监控
async function example5_withPerformanceMonitoring() {
  const monitor = new PerformanceMonitor();
  
  try {
    const result = await monitor.track('功能清单提取', async () => {
      return await extractFunctionList('你的文档内容...');
    });
    
    monitor.report();
    return result;
    
  } catch (error) {
    monitor.report();
    throw error;
  }
}

// ==========================================
// 导出供外部使用
// ==========================================

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    extractFunctionList,
    PerformanceMonitor
  };
}
