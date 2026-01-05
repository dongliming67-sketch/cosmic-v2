// 测试脚本 - 验证两步骤COSMIC拆分API端点
const axios = require('axios');

async function testTwoStepAPI() {
    try {
        console.log('🧪 测试两步骤COSMIC拆分API端点...\n');

        const testFunctionList = `#数据管理
##功能用户
发起者：用户 接收者：用户
##触发事件
用户触发
##功能过程
查询小区数据
##功能过程子过程详细描述
用户在页面输入查询条件，系统接收请求，从数据库读取小区数据，返回查询结果给用户。`;

        const response = await axios.post('http://localhost:2617/api/two-step/cosmic-split', {
            functionProcessList: testFunctionList
        });

        console.log('✅ API调用成功！');
        console.log('响应数据:', JSON.stringify(response.data, null, 2));

    } catch (error) {
        console.error('❌ API调用失败:');
        if (error.response) {
            console.error('状态码:', error.response.status);
            console.error('错误信息:', error.response.data);
        } else {
            console.error('错误:', error.message);
        }
    }
}

testTwoStepAPI();
