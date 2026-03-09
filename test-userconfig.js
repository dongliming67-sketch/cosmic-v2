// 测试 userConfig 是否正确发送到后端
const axios = require('axios');

async function testUserConfig() {
    // 模拟前端发送的 userConfig（心流平台 DeepSeek-V3）
    const userConfig = {
        apiKey: null,
        baseUrl: 'https://apis.iflow.cn/v1',
        model: 'deepseek-v3',
        provider: 'iflow'
    };

    console.log('发送的 userConfig:', JSON.stringify(userConfig, null, 2));

    try {
        const response = await axios.post('http://localhost:2617/api/two-step/extract-functions', {
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
