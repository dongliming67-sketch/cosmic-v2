// 并发测试脚本 - 执行3个并发COSMIC拆分测试并分析结果质量
const axios = require('axios');
const fs = require('fs');

const BASE_URL = 'http://localhost:3001';

// 读取测试文档
const testDocPath = './test-docs/江苏移动2025年项目需求文档-低空无线网络优化（参数自动下发） - 张强(1)(1).docx';
let documentContent = '';

// 尝试读取文档内容（从之前的测试中获取）
try {
    // 扩展测试文档内容 - 包含约20个功能过程
    documentContent = `
# 低空保障综合管理平台功能需求

## 1. 低空保障任务管理
### 1.1 查询低空保障任务列表
- 支持按日期、地市、区县、场景名称、任务状态进行条件查询
- 支持分页展示任务列表

### 1.2 新增低空保障任务
用户可以新增低空保障任务，配置任务名称、任务类型、保障区域、开始时间、结束时间等信息

### 1.3 修改低空保障任务
用户可以修改已创建的低空保障任务配置，包括修改任务基本信息、保障时间范围等

### 1.4 删除低空保障任务
用户可以删除低空保障任务配置信息，支持单条删除和批量删除

### 1.5 查看低空保障任务详情
用户可以查看低空保障任务的详细信息，包括任务配置、执行记录等

### 1.6 导出低空保障任务数据
用户可以导出低空保障任务列表数据为Excel文件

## 2. 航线配置管理
### 2.1 查询航线列表
支持查询航线列表，按航线名称、航线编号、状态进行筛选

### 2.2 新增航线配置
配置航线信息，包括航线名称、航线编号、起点坐标、终点坐标、途经点等

### 2.3 修改航线配置
修改已有的航线配置信息，更新航线参数

### 2.4 删除航线配置
删除航线配置信息

### 2.5 导出航线数据
导出航线配置数据为Excel文件

### 2.6 提交航线审批
航线创建后提交审批申请

### 2.7 审核航线审批
审批人审核航线配置的审批申请

### 2.8 处理航线审批结果
处理航线审批的通过或拒绝结果

## 3. 空域配置管理
### 3.1 查询空域列表
查询空域配置列表，按空域名称、类型进行筛选

### 3.2 新增空域配置
新增空域配置信息，包括空域名称、边界坐标、高度限制等

### 3.3 修改空域配置
修改已有空域配置信息

### 3.4 删除空域配置
删除空域配置信息

## 4. 保障监控功能
### 4.1 查看实时保障监控
实时监控低空保障任务执行状态

### 4.2 查看历史保障记录
查看历史低空保障任务执行记录

## 5. 定时任务
### 5.1 定时汇总低空保障执行数据
系统定时汇总低空保障任务的执行数据，生成日报表

### 5.2 定时推送保障预警
系统定时检查保障任务状态，检测异常情况并推送预警
`;
} catch (e) {
    console.error('读取文档失败:', e.message);
    process.exit(1);
}

// 用户配置 - 设为 null 使用服务器默认配置（智谱AI）
const userConfig = null;

async function runSingleTest(testId) {
    console.log(`\n${'='.repeat(60)} `);
    console.log(`🧪 测试 ${testId} 开始...`);
    console.log(`${'='.repeat(60)} `);

    const startTime = Date.now();

    try {
        // 第一步：功能过程识别
        console.log(`[测试${testId}]第一步：功能过程识别...`);
        const step1Res = await axios.post(`${BASE_URL}/api/two-step/extract-functions`, {
            documentContent,
            userConfig
        }, { timeout: 600000 });

        if (!step1Res.data.success) {
            throw new Error(`第一步失败: ${step1Res.data.error} `);
        }

        const functionList = step1Res.data.functionProcessList;
        console.log(`[测试${testId}]第一步完成，功能过程列表长度: ${functionList.length} `);

        // 第二步：COSMIC拆分
        console.log(`[测试${testId}]第二步：COSMIC拆分...`);
        const step2Res = await axios.post(`${BASE_URL}/api/two-step/cosmic-split`, {
            functionProcessList: functionList,
            userConfig
        }, { timeout: 600000 });

        if (!step2Res.data.success) {
            throw new Error(`第二步失败: ${step2Res.data.error} `);
        }

        const tableData = step2Res.data.tableData;
        const duration = ((Date.now() - startTime) / 1000).toFixed(1);

        console.log(`[测试${testId}] ✅ 完成! 耗时: ${duration} s, 记录数: ${tableData.length} `);

        return {
            testId,
            success: true,
            duration: parseFloat(duration),
            recordCount: tableData.length,
            functionProcessList: functionList,
            tableData,
            uniqueFPs: [...new Set(tableData.map(r => r.functionalProcess))].length
        };

    } catch (error) {
        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`[测试${testId}] ❌ 失败: ${error.message} `);
        return {
            testId,
            success: false,
            duration: parseFloat(duration),
            error: error.message
        };
    }
}

async function analyzeResults(results) {
    console.log('\n\n');
    console.log('╔════════════════════════════════════════════════════════════════╗');
    console.log('║                   📊 并发测试结果分析报告                       ║');
    console.log('╚════════════════════════════════════════════════════════════════╝');

    // 筛选成功的结果
    const successResults = results.filter(r => r.success);
    if (successResults.length === 0) {
        console.log('\n❌ 所有测试都失败了，无法进行分析');
        results.forEach(r => console.log(`  - 测试${r.testId}: ${r.error} `));
        return;
    }

    console.log(`\n✅ 成功测试: ${successResults.length}/${results.length}`);

    // 统计概览
    console.log('\n📈 【统计概览】');
    successResults.forEach(r => {
        console.log(`  测试${r.testId}: ${r.recordCount}条记录, ${r.uniqueFPs}个功能过程, 耗时${r.duration}s`);
    });

    // 选择记录最多的结果进行详细分析
    const bestResult = successResults.reduce((a, b) => a.recordCount > b.recordCount ? a : b);
    console.log(`\n📋 以下分析基于测试${bestResult.testId}的结果 (${bestResult.recordCount}条记录)`);

    const tableData = bestResult.tableData;

    // =================== 问题1：功能过程泛化检查 ===================
    console.log('\n\n🔍 【问题1：功能过程泛化检查】');
    console.log('='.repeat(60));

    const functionalProcesses = [...new Set(tableData.map(r => r.functionalProcess))];
    const genericPatterns = [
        /^查询.{0,4}$/,      // 过于简短的查询
        /^新增.{0,4}$/,      // 过于简短的新增
        /^修改.{0,4}$/,      // 过于简短的修改
        /^删除.{0,4}$/,      // 过于简短的删除
        /^导出.{0,4}$/,      // 过于简短的导出
        /任务$/,            // 只以"任务"结尾
        /数据$/,            // 只以"数据"结尾
        /信息$/,            // 只以"信息"结尾
    ];

    const genericFPs = functionalProcesses.filter(fp => {
        // 检查是否太短（少于8个字）
        if (fp.length < 8) return true;
        // 检查是否匹配泛化模式
        return genericPatterns.some(p => p.test(fp));
    });

    const specificFPs = functionalProcesses.filter(fp => {
        // 包含具体业务对象（低空保障、航线、质差等）
        const businessKeywords = ['低空', '保障', '航线', '空域', '任务配置', '执行记录', '审批'];
        return businessKeywords.some(kw => fp.includes(kw)) && fp.length >= 8;
    });

    console.log(`\n📊 功能过程分析结果:`);
    console.log(`  - 总功能过程数: ${functionalProcesses.length}`);
    console.log(`  - 泛化功能过程 (需修正): ${genericFPs.length}`);
    console.log(`  - 具体功能过程 (合格): ${specificFPs.length}`);

    if (genericFPs.length > 0) {
        console.log(`\n⚠️ 泛化功能过程列表 (缺乏具体业务对象):`);
        genericFPs.slice(0, 10).forEach((fp, i) => {
            console.log(`  ${i + 1}. ❌ "${fp}" (${fp.length}字)`);
        });
        if (genericFPs.length > 10) {
            console.log(`  ... 还有 ${genericFPs.length - 10} 个`);
        }
    }

    if (specificFPs.length > 0) {
        console.log(`\n✅ 具体功能过程示例 (合格):`);
        specificFPs.slice(0, 5).forEach((fp, i) => {
            console.log(`  ${i + 1}. ✅ "${fp}"`);
        });
    }

    // =================== 新增：数据组连接符问题检查 ===================
    console.log('\n\n🔍 【新增检查：数据组连接符问题】');
    console.log('='.repeat(60));

    const dataGroupsForHyphen = tableData.map(r => r.dataGroup);
    const hyphenDataGroups = dataGroupsForHyphen.filter(dg => {
        if (!dg) return false;
        // 检测是否包含"表-xxx"、"库-xxx"、"数据-xxx"等连接符模式，或中文间隔号"·"
        return /表-|库-|数据-|集-|表·|库·|数据·|集·/.test(dg);
    });

    if (hyphenDataGroups.length > 0) {
        console.log(`\n⚠️ 发现 ${hyphenDataGroups.length} 个数据组包含连接符:`);
        const uniqueHyphenGroups = [...new Set(hyphenDataGroups)].slice(0, 10);
        uniqueHyphenGroups.forEach((dg, i) => {
            console.log(`  ${i + 1}. ❌ "${dg}"`);
        });
        console.log(`\n💡 建议: 将连接符改为更自然的表达，如"xxx查询表"、"xxx导出表"等`);
    } else {
        console.log(`\n✅ 数据组中没有发现连接符问题，清理成功！`);
    }

    // =================== 新增：笼统功能过程检查 ===================
    console.log('\n\n🔍 【新增检查：笼统功能过程】');
    console.log('='.repeat(60));

    const vagueFPPatterns = [
        /^查询结果$/,
        /^数据处理$/,
        /^信息查询$/,
        /^结果展示$/,
        /^数据查询$/,
        /^任务处理$/,
        /^操作执行$/,
        /^请求处理$/
    ];

    const vagueFPs = functionalProcesses.filter(fp => {
        if (!fp) return false;
        return vagueFPPatterns.some(p => p.test(fp.trim()));
    });

    if (vagueFPs.length > 0) {
        console.log(`\n⚠️ 发现 ${vagueFPs.length} 个极其笼统的功能过程:`);
        vagueFPs.forEach((fp, i) => {
            console.log(`  ${i + 1}. ❌ "${fp}" (需要补充具体业务场景)`);
        });
    } else {
        console.log(`\n✅ 没有发现极其笼统的功能过程，质量良好！`);
    }

    // =================== 问题2：子过程描述检查 ===================
    console.log('\n\n🔍 【问题2：子过程描述检查】');
    console.log('='.repeat(60));

    const subProcesses = tableData.map(r => r.subProcessDescription);
    const simplePatterns = [
        /^接收.{0,6}$/,       // 太简单的接收
        /^读取.{0,6}$/,       // 太简单的读取
        /^返回.{0,6}$/,       // 太简单的返回
        /^记录.{0,6}$/,       // 太简单的记录
        /接收请求参数/,       // 通用描述
        /读取数据/,          // 通用描述
        /返回结果/,          // 通用描述
        /返回操作结果/,       // 通用描述
        /读取配置/,          // 通用描述
    ];

    const simpleSubProcesses = subProcesses.filter(sp => {
        if (!sp) return true;
        if (sp.length < 8) return true;
        return simplePatterns.some(p => p.test(sp));
    });

    const goodSubProcesses = subProcesses.filter(sp => {
        if (!sp) return false;
        // 包含业务关键词且长度合适
        const keywords = ['低空', '保障', '航线', '任务', '配置', '执行', '审批', '汇总'];
        return keywords.some(kw => sp.includes(kw)) && sp.length >= 10 && sp.length <= 25;
    });

    console.log(`\n📊 子过程描述分析结果:`);
    console.log(`  - 总子过程数: ${subProcesses.length}`);
    console.log(`  - 过于简单 (需修正): ${simpleSubProcesses.length}`);
    console.log(`  - 质量合格: ${goodSubProcesses.length}`);

    if (simpleSubProcesses.length > 0) {
        console.log(`\n⚠️ 过于简单的子过程描述:`);
        const uniqueSimple = [...new Set(simpleSubProcesses)].slice(0, 10);
        uniqueSimple.forEach((sp, i) => {
            console.log(`  ${i + 1}. ❌ "${sp || '(空)'}"`);
        });
    }

    if (goodSubProcesses.length > 0) {
        console.log(`\n✅ 优质子过程描述示例:`);
        const uniqueGood = [...new Set(goodSubProcesses)].slice(0, 5);
        uniqueGood.forEach((sp, i) => {
            console.log(`  ${i + 1}. ✅ "${sp}"`);
        });
    }

    // =================== 问题3：数据组和数据属性重复检查 ===================
    console.log('\n\n🔍 【问题3：数据组和数据属性重复检查】');
    console.log('='.repeat(60));

    // 数据组重复检查
    const dataGroups = tableData.map(r => r.dataGroup);
    const dataGroupCounts = {};
    dataGroups.forEach(dg => {
        if (dg) {
            dataGroupCounts[dg] = (dataGroupCounts[dg] || 0) + 1;
        }
    });

    const duplicateGroups = Object.entries(dataGroupCounts)
        .filter(([_, count]) => count > 4) // 超过4次认为是过度重复
        .sort((a, b) => b[1] - a[1]);

    console.log(`\n📊 数据组重复分析:`);
    console.log(`  - 不同数据组数: ${Object.keys(dataGroupCounts).length}`);
    console.log(`  - 高度重复的数据组 (出现>4次): ${duplicateGroups.length}`);

    if (duplicateGroups.length > 0) {
        console.log(`\n⚠️ 重复的数据组:`);
        duplicateGroups.slice(0, 10).forEach(([group, count], i) => {
            console.log(`  ${i + 1}. ❌ "${group}" 出现 ${count} 次`);
        });
    }

    // 数据属性重复检查
    const dataAttrs = tableData.map(r => r.dataAttribute);
    const attrCounts = {};
    dataAttrs.forEach(attr => {
        if (attr) {
            attrCounts[attr] = (attrCounts[attr] || 0) + 1;
        }
    });

    const duplicateAttrs = Object.entries(attrCounts)
        .filter(([_, count]) => count > 3) // 超过3次认为是过度重复
        .sort((a, b) => b[1] - a[1]);

    console.log(`\n📊 数据属性重复分析:`);
    console.log(`  - 不同属性组合数: ${Object.keys(attrCounts).length}`);
    console.log(`  - 高度重复的属性组合 (出现>3次): ${duplicateAttrs.length}`);

    if (duplicateAttrs.length > 0) {
        console.log(`\n⚠️ 重复的数据属性组合:`);
        duplicateAttrs.slice(0, 8).forEach(([attr, count], i) => {
            // 截断显示
            const displayAttr = attr.length > 50 ? attr.substring(0, 50) + '...' : attr;
            console.log(`  ${i + 1}. ❌ "${displayAttr}" 出现 ${count} 次`);
        });
    }

    // 检查数据属性中是否还有动词前缀
    console.log(`\n📊 动词前缀检查:`);
    const verbPrefixes = ['删除', '修改', '新增', '查询', '创建', '更新', '导入', '导出'];
    let verbPrefixCount = 0;
    const verbPrefixExamples = [];

    dataAttrs.forEach(attr => {
        if (attr) {
            const fields = attr.split(/[、,，]/);
            fields.forEach(field => {
                for (const verb of verbPrefixes) {
                    if (field.trim().startsWith(verb)) {
                        verbPrefixCount++;
                        if (verbPrefixExamples.length < 5) {
                            verbPrefixExamples.push(field.trim());
                        }
                        break;
                    }
                }
            });
        }
    });

    if (verbPrefixCount > 0) {
        console.log(`  ⚠️ 仍有 ${verbPrefixCount} 个字段包含动词前缀`);
        console.log(`  示例: ${verbPrefixExamples.join(', ')}`);
    } else {
        console.log(`  ✅ 数据属性中没有发现动词前缀，过滤成功！`);
    }

    // =================== 综合评分 ===================
    console.log('\n\n📌 【综合评估】');
    console.log('='.repeat(60));

    const fpScore = Math.round((1 - genericFPs.length / functionalProcesses.length) * 100);
    const spScore = Math.round((1 - simpleSubProcesses.length / subProcesses.length) * 100);
    const dgScore = Math.round((1 - duplicateGroups.length / Object.keys(dataGroupCounts).length) * 100);
    const totalScore = Math.round((fpScore + spScore + dgScore) / 3);

    console.log(`\n  功能过程具体化得分: ${fpScore}%`);
    console.log(`  子过程描述质量得分: ${spScore}%`);
    console.log(`  数据组唯一性得分: ${dgScore}%`);
    console.log(`  ─────────────────────`);
    console.log(`  📊 总体质量得分: ${totalScore}%`);

    if (totalScore >= 80) {
        console.log(`  🎉 评级: 优秀`);
    } else if (totalScore >= 60) {
        console.log(`  ✅ 评级: 良好`);
    } else if (totalScore >= 40) {
        console.log(`  ⚠️ 评级: 需改进`);
    } else {
        console.log(`  ❌ 评级: 不合格`);
    }

    // 保存详细结果到文件
    const reportPath = `./test-result-${Date.now()}.json`;
    fs.writeFileSync(reportPath, JSON.stringify({
        summary: {
            totalTests: results.length,
            successTests: successResults.length,
            bestResult: bestResult.testId,
            totalRecords: bestResult.recordCount,
            uniqueFPs: bestResult.uniqueFPs,
            scores: { fpScore, spScore, dgScore, totalScore }
        },
        issues: {
            genericFPs,
            simpleSubProcesses: [...new Set(simpleSubProcesses)].slice(0, 20),
            duplicateGroups,
            duplicateAttrs: duplicateAttrs.slice(0, 10),
            verbPrefixExamples
        },
        bestTableData: bestResult.tableData
    }, null, 2));
    console.log(`\n📄 详细报告已保存至: ${reportPath}`);
}

async function main() {
    console.log('╔════════════════════════════════════════════════════════════════╗');
    console.log('║            🧪 COSMIC 拆分测试 - 开始（串行执行）                ║');
    console.log('╚════════════════════════════════════════════════════════════════╝');
    console.log(`\n📅 测试时间: ${new Date().toLocaleString()}`);
    console.log(`🔗 服务地址: ${BASE_URL}`);
    console.log(`📄 文档长度: ${documentContent.length} 字符`);
    console.log(`🔄 测试数: 2（串行执行）`);

    console.log('\n⏳ 执行中...\n');

    const results = [];
    for (let i = 1; i <= 2; i++) {
        console.log(`\n${'='.repeat(60)}`);
        console.log(`🧪 开始测试 ${i}/2...`);
        const result = await runSingleTest(i);
        results.push(result);

        if (i < 2) {
            console.log(`\n⏳ 等待 10 秒后执行下一个测试，避免触发 API 并发限制...`);
            await new Promise(resolve => setTimeout(resolve, 10000));
        }
    }

    // 分析结果
    await analyzeResults(results);

    console.log('\n\n🏁 测试完成!');
}

main().catch(console.error);
