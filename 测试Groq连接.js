// 测试Groq API连接
require('dotenv').config();
const OpenAI = require('openai');

async function testGroqConnection() {
  console.log('========================================');
  console.log('测试 Groq API 连接');
  console.log('========================================');
  console.log('');
  
  // 检查环境变量
  console.log('1. 检查环境变量:');
  console.log('   GROQ_API_KEY:', process.env.GROQ_API_KEY ? `已配置 (${process.env.GROQ_API_KEY.substring(0, 20)}...)` : '❌ 未配置');
  console.log('   GROQ_MODEL:', process.env.GROQ_MODEL || 'llama-3.3-70b-versatile (默认)');
  console.log('');
  
  if (!process.env.GROQ_API_KEY) {
    console.error('❌ 错误: GROQ_API_KEY 未配置');
    console.log('');
    console.log('请在 .env 文件中添加:');
    console.log('GROQ_API_KEY=your_groq_api_key_here');
    console.log('GROQ_MODEL=llama-3.3-70b-versatile');
    return;
  }
  
  // 创建客户端
  console.log('2. 创建 Groq 客户端...');
  const client = new OpenAI({
    apiKey: process.env.GROQ_API_KEY,
    baseURL: 'https://api.groq.com/openai/v1'
  });
  console.log('   ✓ 客户端创建成功');
  console.log('');
  
  // 测试API调用
  console.log('3. 测试 API 调用...');
  try {
    const completion = await client.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'user', content: '请用一句话介绍COSMIC方法' }
      ],
      temperature: 0.5,
      max_tokens: 100
    });
    
    console.log('   ✓ API 调用成功!');
    console.log('');
    console.log('4. 响应内容:');
    console.log('   ' + completion.choices[0].message.content);
    console.log('');
    console.log('========================================');
    console.log('✅ Groq API 连接测试通过!');
    console.log('========================================');
    
  } catch (error) {
    console.error('   ❌ API 调用失败!');
    console.log('');
    console.log('错误详情:');
    console.log('   状态码:', error.status);
    console.log('   错误信息:', error.message);
    console.log('   错误类型:', error.type);
    console.log('');
    
    if (error.status === 404) {
      console.log('💡 404错误通常表示:');
      console.log('   1. 模型名称不正确');
      console.log('   2. API端点路径不正确');
      console.log('   3. API密钥无效或已过期');
      console.log('');
      console.log('建议:');
      console.log('   - 检查模型名称是否为: llama-3.3-70b-versatile');
      console.log('   - 确认API密钥是否有效');
      console.log('   - 访问 https://console.groq.com 检查账户状态');
    } else if (error.status === 401) {
      console.log('💡 401错误表示认证失败:');
      console.log('   - API密钥可能无效或已过期');
      console.log('   - 请在 https://console.groq.com 重新生成密钥');
    }
    
    console.log('');
    console.log('========================================');
    console.log('❌ Groq API 连接测试失败');
    console.log('========================================');
  }
}

// 运行测试
testGroqConnection().catch(console.error);
