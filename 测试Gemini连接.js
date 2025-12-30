// 测试 Gemini 1.5 Flash API 连接
require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

async function testGemini() {
    console.log('========================================');
    console.log('Google Gemini API 连接测试');
    console.log('========================================\n');

    const apiKey = process.env.GEMINI_API_KEY;
    const modelName = process.env.GEMINI_MODEL || 'gemini-2.0-flash';

    if (!apiKey) {
        console.error('❌ 错误: 未找到 GEMINI_API_KEY 环境变量');
        console.log('请在 .env 文件中设置 GEMINI_API_KEY=your_api_key');
        process.exit(1);
    }

    console.log(`📌 API Key: ${apiKey.substring(0, 10)}...${apiKey.substring(apiKey.length - 4)}`);
    console.log(`📌 模型: ${modelName}`);
    console.log('\n正在测试API连接...\n');

    try {
        // 初始化 Gemini 客户端
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: modelName });

        // 发送测试请求
        const prompt = '请用一句话介绍你自己。';
        console.log(`📤 发送测试消息: "${prompt}"`);

        const startTime = Date.now();
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();
        const endTime = Date.now();

        console.log(`\n✅ API调用成功!`);
        console.log(`⏱️ 响应时间: ${endTime - startTime}ms`);
        console.log(`\n📥 Gemini 回复:\n${text}`);
        console.log('\n========================================');
        console.log('🎉 Gemini API 配置正确，可以正常使用！');
        console.log('========================================');

    } catch (error) {
        console.error('❌ API调用失败:', error.message);

        if (error.message.includes('API key')) {
            console.log('\n💡 提示: API密钥可能无效，请检查密钥是否正确');
        } else if (error.message.includes('quota') || error.message.includes('rate')) {
            console.log('\n💡 提示: API配额已用完或请求频率过高，请稍后重试');
        } else if (error.message.includes('network') || error.message.includes('ENOTFOUND')) {
            console.log('\n💡 提示: 网络连接失败，请检查网络或代理设置');
        }

        process.exit(1);
    }
}

testGemini();
