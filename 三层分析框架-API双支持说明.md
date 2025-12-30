# 三层分析框架 - 多API支持说明（OpenRouter + Groq + 智谱）

## 概述

三层分析框架现在支持**三种API提供商**，可以灵活切换使用：
1. **OpenRouter** - 可调用 Gemini 2.0 Flash（免费）、Claude 等多种模型
2. **Groq** - 速度极快，支持 LLaMA 等开源模型
3. **智谱AI** - 国产大模型，中文理解优秀

## 配置方式

### 1. 环境变量配置

在 `.env` 文件中添加以下配置：

```bash
# ========== OpenRouter配置（推荐）==========
OPENROUTER_API_KEY=sk-or-v1-your_key_here
OPENROUTER_MODEL=google/gemini-2.0-flash-exp:free

# ========== Groq配置 ==========
GROQ_API_KEY=your_groq_api_key_here
GROQ_MODEL=llama-3.3-70b-versatile

# ========== 智谱AI配置 ==========
ZHIPU_API_KEY=your_zhipu_api_key_here
ZHIPU_BASE_URL=https://open.bigmodel.cn/api/paas/v4
ZHIPU_MODEL=glm-4-flash

# ========== 提供商选择 ==========
THREE_LAYER_PROVIDER=openrouter  # 可选值: 'openrouter' | 'groq' | 'zhipu' | 'auto'
```

### 2. 提供商选择说明

| 值 | 说明 |
|:---|:---|
| `openrouter` | 强制使用 OpenRouter（可调用 Gemini 2.0 Flash 等） |
| `groq` | 强制使用 Groq（速度快） |
| `zhipu` | 强制使用智谱AI（中文理解优秀） |
| `auto` | 自动选择：优先 OpenRouter → Groq → 智谱 |

## OpenRouter 可用模型

通过 OpenRouter 可以调用多种模型：

| 模型 | 模型ID | 特点 |
|:---|:---|:---|
| **Gemini 2.0 Flash** | `google/gemini-2.0-flash-exp:free` | 免费、强大、推荐 |
| Gemini Pro | `google/gemini-pro` | 需付费 |
| Claude 3 Haiku | `anthropic/claude-3-haiku` | 需付费 |
| LLaMA 3.1 70B | `meta-llama/llama-3.1-70b-instruct` | 需付费 |

## 使用场景

### 场景1：使用 OpenRouter + Gemini（推荐）

```bash
OPENROUTER_API_KEY=sk-or-v1-your_key_here
OPENROUTER_MODEL=google/gemini-2.0-flash-exp:free
THREE_LAYER_PROVIDER=openrouter
```

### 场景2：使用 Groq

```bash
GROQ_API_KEY=your_groq_key_here
THREE_LAYER_PROVIDER=groq
```

### 场景3：使用智谱

```bash
ZHIPU_API_KEY=your_zhipu_key_here
THREE_LAYER_PROVIDER=zhipu
```

### 场景4：自动切换（配置多个API）

同时配置多个API，系统自动选择可用的：

```bash
OPENROUTER_API_KEY=your_openrouter_key_here
GROQ_API_KEY=your_groq_key_here
ZHIPU_API_KEY=your_zhipu_key_here
THREE_LAYER_PROVIDER=auto  # 自动选择
```

## API响应

调用三层分析框架API时，响应中会包含当前使用的提供商信息：

```json
{
  "success": true,
  "reply": "...",
  "round": 1,
  "isDone": false,
  "completedFunctions": 0,
  "targetFunctions": 30,
  "mode": "three-layer",
  "provider": "openrouter",
  "model": "google/gemini-2.0-flash-exp:free"
}
```

## 优势对比

| 特性 | OpenRouter (Gemini) | Groq | 智谱AI |
|:---|:---|:---|:---|
| 响应速度 | 快 | 非常快 | 中等 |
| 中文理解 | 优秀 | 良好 | 优秀 |
| 成本 | 免费模型可用 | 免费额度 | 较低 |
| 模型选择 | 丰富 | 有限 | 单一 |
| 推荐场景 | 通用、高质量 | 快速迭代 | 中文专精 |

## 故障排查

如果遇到"请先配置API密钥"的错误，请检查：

1. `.env` 文件是否正确配置了对应的 API Key
2. `THREE_LAYER_PROVIDER` 设置是否与配置的 API Key 匹配
3. 服务器是否已重启（修改 .env 后需要重启）

## 技术实现

文件：`server/three-layer-api.js`

- `getZhipuClient()`: 获取智谱客户端实例
- `getGroqClientLocal()`: 获取Groq客户端实例
- `getOpenRouterClient()`: 获取OpenRouter客户端实例
- `getActiveClientConfig()`: 根据配置选择激活的客户端
- `threeLayerAnalyze()`: 主分析函数，自动使用正确的客户端

## 注意事项

1. **OpenRouter API Key 格式**：以 `sk-or-v1-` 开头
2. **Groq API Key 格式**：以 `gsk_` 开头
3. **智谱 API Key 格式**：智谱控制台获取的密钥
4. **修改配置后必须重启服务器**
