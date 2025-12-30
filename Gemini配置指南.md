# Gemini 1.5 API 配置指南

## 📋 已完成的配置

您的项目已成功集成 Google Gemini 1.5 API！以下是已完成的修改：

### 1. 安装的依赖
```
@google/generative-ai  - Google Gemini 官方 Node.js SDK
```

### 2. 修改的文件
- **`.env.example`** - 添加了 Gemini 配置说明
- **`server/three-layer-api.js`** - 添加了 Gemini 客户端支持
- **`.env`** - 配置了您的 Gemini API 密钥

### 3. 当前配置
```env
GEMINI_API_KEY=AIzaSyD4ALpPba5CU9JI4E3nurFmojnczEdHi1M
GEMINI_MODEL=gemini-1.5-flash
THREE_LAYER_PROVIDER=gemini
```

## ⚠️ 网络访问注意事项

**在中国大陆使用 Google Gemini API 需要配置代理！**

Google API 在中国大陆无法直接访问，您需要：

### 方法一：设置系统代理（推荐）
启动程序前，在命令行设置代理环境变量：

```powershell
# PowerShell（Windows）
$env:HTTP_PROXY = "http://127.0.0.1:7890"
$env:HTTPS_PROXY = "http://127.0.0.1:7890"
node server/index.js
```

```cmd
# CMD（Windows）
set HTTP_PROXY=http://127.0.0.1:7890
set HTTPS_PROXY=http://127.0.0.1:7890
node server/index.js
```

### 方法二：使用 OpenRouter（无需代理）
如果没有代理，可以通过 OpenRouter 间接使用 Gemini：

1. 注册 OpenRouter: https://openrouter.ai/
2. 获取 API Key
3. 在 `.env` 中配置：

```env
# 使用 OpenRouter（无需代理）
OPENROUTER_API_KEY=your_openrouter_api_key
OPENROUTER_MODEL=google/gemini-2.0-flash-exp:free
THREE_LAYER_PROVIDER=openrouter
```

### 方法三：继续使用智谱 AI
如果暂时无法解决网络问题，可以恢复使用智谱 AI：

```env
ZHIPU_API_KEY=your_zhipu_api_key
ZHIPU_MODEL=glm-4-flash
THREE_LAYER_PROVIDER=zhipu
```

## 🚀 可用的模型

### Google Gemini（直接 API）
| 模型 | 说明 |
|------|------|
| `gemini-1.5-flash` | 推荐，速度快，适合大多数任务 |
| `gemini-1.5-pro` | 更强大，适合复杂分析任务 |
| `gemini-2.0-flash-exp` | 最新实验版 |

### 通过 OpenRouter
| 模型 | 说明 |
|------|------|
| `google/gemini-2.0-flash-exp:free` | 免费使用 |
| `google/gemini-pro` | 付费，更稳定 |

## 📝 切换提供商

在 `.env` 文件中修改 `THREE_LAYER_PROVIDER` 即可切换：

```env
# 使用 Gemini 直接 API（需要代理）
THREE_LAYER_PROVIDER=gemini

# 使用 OpenRouter（无需代理，推荐）
THREE_LAYER_PROVIDER=openrouter

# 使用智谱 AI（国内稳定）
THREE_LAYER_PROVIDER=zhipu

# 使用 Groq
THREE_LAYER_PROVIDER=groq

# 自动选择（按优先级尝试）
THREE_LAYER_PROVIDER=auto
```

## 🔧 测试连接

运行测试脚本检查配置是否正确：

```bash
# 设置代理后运行
node 测试Gemini连接.js
```

## 📞 技术支持

如果遇到问题：
1. 检查 API 密钥是否正确
2. 确认代理是否正常工作
3. 查看服务器控制台日志
