# 快速配置 Groq API

## 问题原因

您遇到的 404 错误是因为 `.env` 文件中没有正确配置 `GROQ_API_KEY`。

## 解决方案（三选一）

### 方法1：运行配置脚本（推荐）

双击运行项目根目录下的 `setup-groq.bat` 文件，它会自动配置好所有内容。

### 方法2：手动创建 .env 文件

1. 在项目根目录创建 `.env` 文件（如果不存在）
2. 添加以下内容：

```env
# OpenAI API配置（用于数量优先和质量优先模式）
OPENAI_API_KEY=your_zhipu_api_key_here
OPENAI_BASE_URL=https://open.bigmodel.cn/api/paas/v4
OPENAI_MODEL=glm-4-flash

# Groq API配置（用于三层分析框架模式）
GROQ_API_KEY=your_groq_api_key_here
GROQ_MODEL=llama-3.3-70b-versatile

# 服务器端口
PORT=3001
```

3. 保存文件

### 方法3：使用命令行

在项目根目录打开命令行，执行：

```bash
echo GROQ_API_KEY=your_groq_api_key_here >> .env
echo GROQ_MODEL=llama-3.3-70b-versatile >> .env
```

## 验证配置

配置完成后，检查 `.env` 文件内容：

```bash
type .env
```

应该能看到：
```
GROQ_API_KEY=your_groq_api_key_here
GROQ_MODEL=llama-3.3-70b-versatile
```

## 重启服务器

配置完成后，**必须重启服务器**：

1. 停止当前服务器：按 `Ctrl+C`
2. 重新启动：`npm start`
3. 刷新浏览器页面

## 测试

1. 上传一个文档
2. 选择"三层分析框架"模式
3. 点击"开始分析"

如果配置正确，应该能看到分析开始，不再出现 404 错误。

## 常见问题

### Q: 还是显示 404 错误？
A: 请确认：
1. `.env` 文件在项目根目录（与 `package.json` 同级）
2. 文件名是 `.env`，不是 `.env.txt` 或其他
3. 已经重启了服务器
4. 使用 `type .env` 命令确认配置已写入

### Q: 如何查看当前配置？
A: 在项目根目录运行：
```bash
type .env
```

### Q: 如何确认服务器读取了配置？
A: 启动服务器时，在控制台应该能看到相关日志。或者在服务器代码中添加：
```javascript
console.log('GROQ_API_KEY:', process.env.GROQ_API_KEY ? '已配置' : '未配置');
```
