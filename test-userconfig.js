// 测试 userConfig 是否正确发送到后端
const axios = require('axios');

async function testUserConfig() {
    // 模拟前端发送的 userConfig
    const userConfig = {
        apiKey: 'sk-test-key-from-frontend', // 替换为你的真实 key 进行测试
        baseUrl: 'https://api.siliconflow.cn/v1',
        model: 'deepseek-ai/DeepSeek-R1-Distill-Qwen-32B',
        provider: 'openai'
    };

    console.log('发送的 userConfig:', JSON.stringify(userConfig, null, 2));

    try {
        const response = await axios.post('http://localhost:3002/api/two-step/extract-functions', {
            documentContent: '测试文档内容：这是一个简单的功能需求。',
            userConfig: userConfig
        });
        console.log('响应:', response.data);
    } catch (error) {
        console.log('错误状态码:', error.response?.status);
        console.log('错误信息:', error.response?.data || error.message);
    }
}

testUserConfig();
