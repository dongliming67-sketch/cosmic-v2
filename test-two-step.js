/**
 * 两步骤COSMIC拆分并发测试脚本
 * 执行三次并发测试，比较效果，找出最优和最差
 * 使用内置fetch API，无需额外依赖
 */

const BASE_URL = 'http://localhost:3001';

// 测试用的需求文档内容
const TEST_DOCUMENT = `
# 低空保障任务配置管理

## 功能概述
本模块用于管理低空保障任务的配置信息，支持任务的创建、查询、修改、删除等操作。

## 功能界面说明

### 1. 任务列表页面
- 支持查询（地市、区县、任务名称、任务状态、创建时间）
- 支持导出任务列表数据
- 点击任务名称，跳转至任务详情页面
- 支持批量删除任务

### 2. 任务详情页面
- 查看任务基本信息（任务ID、任务名称、任务类型、任务状态）
- 查看关联航线信息（航线ID、航线名称、起降点）
- 支持修改任务配置
- 支持启用/禁用任务

### 3. 任务创建页面
- 新增保障任务配置
- 选择关联航线
- 设置保障参数（保障区域、保障时段、保障等级）

### 4. 数据统计
- 定时汇总任务执行情况（每日凌晨2点执行）
- 生成任务统计报表
`;

// 评估函数：计算拆分质量分数
function evaluateResult(cosmicTable) {
    const score = {
        total: 0,
        details: {}
    };

    const tableContent = cosmicTable || '';

    // 1. 解析表格行数
    const tableRows = tableContent.match(/\|[^|\n]+\|/g) || [];
    const dataRows = tableRows.filter(row => !row.includes('功能用户') && !row.includes('---') && !row.includes(':---'));
    score.details.rowCount = dataRows.length;

    // 2. 检查是否包含动词开头的数据属性（错误情况）
    const verbPatterns = /删除任务|修改任务|新增任务|查询任务|启用任务|禁用任务/g;
    const verbMatches = tableContent.match(verbPatterns) || [];
    score.details.verbErrors = verbMatches.length;

    // 3. 检查功能过程数量
    const fpMatches = tableContent.match(/\|[^|]+\|[^|]+\|([^|]+)\|/g) || [];
    const uniqueFPs = [...new Set(fpMatches.map(m => {
        const match = m.match(/\|[^|]+\|[^|]+\|([^|]+)\|/);
        return match ? match[1].trim() : '';
    }).filter(fp => fp && !fp.includes('功能过程') && !fp.includes('---') && fp.length > 3))];
    score.details.uniqueFunctionProcesses = uniqueFPs.length;

    // 4. 检查数据属性是否包含专业字段
    const professionalFields = ['任务ID', '保障状态', '航线ID', '保障区域', '任务状态', '创建时间', '地市', '区县'];
    const fieldCount = professionalFields.filter(f => tableContent.includes(f)).length;
    score.details.professionalFields = fieldCount;

    // 5. 检查数据移动类型是否完整（E、R、W、X）
    const hasE = tableContent.includes('|E|');
    const hasR = tableContent.includes('|R|');
    const hasW = tableContent.includes('|W|');
    const hasX = tableContent.includes('|X|');
    score.details.dataMovementComplete = hasE && hasR && hasW && hasX;
    score.details.dataMovementTypes = { hasE, hasR, hasW, hasX };

    // 6. 计算总分
    score.total += Math.min(20, dataRows.length);
    score.total += Math.max(0, 30 - verbMatches.length * 5);
    score.total += Math.min(20, uniqueFPs.length * 3);
    score.total += Math.min(15, fieldCount * 2);
    score.total += score.details.dataMovementComplete ? 15 : 0;

    return score;
}

// 执行单次测试
async function runSingleTest(testId) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🧪 测试 #${testId} 开始执行...`);
    console.log('='.repeat(60));

    const startTime = Date.now();

    try {
        // 第一步：功能过程识别
        console.log(`[测试#${testId}] 📋 第一步：功能过程识别...`);
        const step1Response = await fetch(`${BASE_URL}/api/two-step/extract-functions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ documentContent: TEST_DOCUMENT })
        });

        if (!step1Response.ok) {
            const errorText = await step1Response.text();
            throw new Error(`Step1 HTTP ${step1Response.status}: ${errorText.substring(0, 200)}`);
        }

        const step1Data = await step1Response.json();
        console.log(`[测试#${testId}] Step1 响应:`, JSON.stringify(step1Data).substring(0, 200));

        const functionList = step1Data.functionProcessList || step1Data.reply || '';
        if (!functionList) {
            throw new Error('Step1返回的functionProcessList为空');
        }

        const step1Time = Date.now() - startTime;
        console.log(`[测试#${testId}] ✅ 第一步完成，耗时: ${step1Time}ms，结果长度: ${functionList.length}`);

        // 第二步：COSMIC拆分
        const step2Start = Date.now();
        console.log(`[测试#${testId}] 🔧 第二步：COSMIC拆分...`);
        const step2Response = await fetch(`${BASE_URL}/api/two-step/cosmic-split`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ functionProcessList: functionList })
        });

        if (!step2Response.ok) {
            const errorText = await step2Response.text();
            throw new Error(`Step2 HTTP ${step2Response.status}: ${errorText.substring(0, 200)}`);
        }

        const step2Data = await step2Response.json();
        console.log(`[测试#${testId}] Step2 响应:`, JSON.stringify(step2Data).substring(0, 200));

        const cosmicTable = step2Data.cosmicResult || step2Data.reply || step2Data.cosmicTable || '';
        if (!cosmicTable) {
            throw new Error('Step2返回的cosmicTable为空');
        }

        const step2Time = Date.now() - step2Start;
        const totalTime = Date.now() - startTime;

        console.log(`[测试#${testId}] ✅ 第二步完成，耗时: ${step2Time}ms，结果长度: ${cosmicTable.length}`);
        console.log(`[测试#${testId}] ⏱️ 总耗时: ${totalTime}ms`);

        // 评估结果
        const evaluation = evaluateResult(cosmicTable);

        return {
            testId,
            success: true,
            step1Time,
            step2Time,
            totalTime,
            functionListLength: functionList.length,
            cosmicTableLength: cosmicTable.length,
            fullCosmicTable: cosmicTable,
            evaluation
        };

    } catch (error) {
        const totalTime = Date.now() - startTime;
        console.log(`[测试#${testId}] ❌ 测试失败: ${error.message}`);
        return {
            testId,
            success: false,
            error: error.message,
            totalTime
        };
    }
}

// 主测试函数
async function runConcurrentTests() {
    console.log('\n');
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║       两步骤COSMIC拆分 - 三并发效果对比测试                ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
    console.log(`\n📅 测试时间: ${new Date().toLocaleString()}`);
    console.log(`🎯 测试内容: 低空保障任务配置管理需求文档`);
    console.log(`🔄 并发数量: 3`);

    // 并发执行三个测试
    console.log('\n🚀 开始并发测试...\n');
    const results = await Promise.all([
        runSingleTest(1),
        runSingleTest(2),
        runSingleTest(3)
    ]);

    // 分析结果
    console.log('\n\n');
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║                      测试结果汇总                           ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    const successResults = results.filter(r => r.success);
    const failedResults = results.filter(r => !r.success);

    // 打印每个测试的结果
    results.forEach((result) => {
        console.log(`\n${'─'.repeat(60)}`);
        console.log(`📊 测试 #${result.testId} 结果:`);
        console.log('─'.repeat(60));

        if (result.success) {
            console.log(`  ✅ 状态: 成功`);
            console.log(`  ⏱️ 总耗时: ${result.totalTime}ms (第一步: ${result.step1Time}ms, 第二步: ${result.step2Time}ms)`);
            console.log(`  📋 功能过程列表长度: ${result.functionListLength} 字符`);
            console.log(`  📊 COSMIC表格长度: ${result.cosmicTableLength} 字符`);
            console.log(`\n  📈 质量评分详情:`);
            console.log(`     - 表格行数: ${result.evaluation.details.rowCount}`);
            console.log(`     - 功能过程数: ${result.evaluation.details.uniqueFunctionProcesses}`);
            console.log(`     - 动词错误数: ${result.evaluation.details.verbErrors}`);
            console.log(`     - 专业字段数: ${result.evaluation.details.professionalFields}`);
            console.log(`     - 数据移动完整: ${result.evaluation.details.dataMovementComplete ? '是' : '否'}`);
            console.log(`         E:${result.evaluation.details.dataMovementTypes.hasE ? '✓' : '✗'} R:${result.evaluation.details.dataMovementTypes.hasR ? '✓' : '✗'} W:${result.evaluation.details.dataMovementTypes.hasW ? '✓' : '✗'} X:${result.evaluation.details.dataMovementTypes.hasX ? '✓' : '✗'}`);
            console.log(`     ━━━━━━━━━━━━━━━━━━━━━━━━━━`);
            console.log(`     🏆 总分: ${result.evaluation.total} / 100`);
        } else {
            console.log(`  ❌ 状态: 失败`);
            console.log(`  💥 错误: ${result.error}`);
        }
    });

    // 找出最优和最差
    if (successResults.length > 0) {
        console.log('\n\n');
        console.log('╔════════════════════════════════════════════════════════════╗');
        console.log('║                      评比结果                              ║');
        console.log('╚════════════════════════════════════════════════════════════╝\n');

        // 按总分排序
        const sorted = successResults.sort((a, b) => b.evaluation.total - a.evaluation.total);

        const best = sorted[0];
        const worst = sorted[sorted.length - 1];

        console.log(`\n🥇 最优结果: 测试 #${best.testId}`);
        console.log(`   ├─ 总分: ${best.evaluation.total} / 100`);
        console.log(`   ├─ 表格行数: ${best.evaluation.details.rowCount}`);
        console.log(`   ├─ 功能过程数: ${best.evaluation.details.uniqueFunctionProcesses}`);
        console.log(`   ├─ 动词错误数: ${best.evaluation.details.verbErrors}`);
        console.log(`   └─ 耗时: ${best.totalTime}ms`);

        if (sorted.length > 1) {
            console.log(`\n🥉 最差结果: 测试 #${worst.testId}`);
            console.log(`   ├─ 总分: ${worst.evaluation.total} / 100`);
            console.log(`   ├─ 表格行数: ${worst.evaluation.details.rowCount}`);
            console.log(`   ├─ 功能过程数: ${worst.evaluation.details.uniqueFunctionProcesses}`);
            console.log(`   ├─ 动词错误数: ${worst.evaluation.details.verbErrors}`);
            console.log(`   └─ 耗时: ${worst.totalTime}ms`);

            const scoreDiff = best.evaluation.total - worst.evaluation.total;
            console.log(`\n📊 分数差距: ${scoreDiff} 分`);

            if (scoreDiff > 20) {
                console.log(`⚠️ 分析: 结果差异较大，模型输出不够稳定`);
            } else if (scoreDiff > 10) {
                console.log(`📝 分析: 结果有一定差异，建议多次测试取最优`);
            } else {
                console.log(`✅ 分析: 结果较为稳定，模型输出一致性好`);
            }
        }

        // 打印最优结果的COSMIC表格片段
        console.log(`\n\n${'═'.repeat(60)}`);
        console.log(`📋 最优结果 (测试#${best.testId}) 的COSMIC表格预览:`);
        console.log('═'.repeat(60));
        console.log(best.fullCosmicTable.substring(0, 4000));
        if (best.fullCosmicTable.length > 4000) {
            console.log('\n... (表格内容已截断，共 ' + best.fullCosmicTable.length + ' 字符)');
        }
    }

    if (failedResults.length > 0) {
        console.log(`\n\n❌ 失败的测试: ${failedResults.map(r => `#${r.testId}`).join(', ')}`);
    }

    console.log('\n\n🏁 测试完成！');
}

// 运行测试
runConcurrentTests().catch(err => {
    console.error('测试脚本执行失败:', err);
    process.exit(1);
});
