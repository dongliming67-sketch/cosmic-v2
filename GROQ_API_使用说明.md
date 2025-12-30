# Groq API 集成说明

## 概述

已成功将 Groq API 集成到 COSMIC 拆分智能体系统中。Groq 提供超快的推理速度和多种开源大模型支持。

## 配置方法

### 1. 修改 `.env` 文件

复制 `.env.example` 为 `.env`，然后取消注释 Groq 配置部分：

```env
# Groq (推荐：速度快，支持多种开源模型)
OPENAI_BASE_URL=https://api.groq.com/openai/v1
OPENAI_API_KEY=your_groq_api_key_here
OPENAI_MODEL=llama-3.3-70b-versatile
```

### 2. 可选模型

Groq 支持多种高性能模型，推荐以下几个：

| 模型名称 | 特点 | 适用场景 |
|---------|------|---------|
| `llama-3.3-70b-versatile` | 最新 Llama 3.3，70B 参数，综合能力强 | **推荐用于 COSMIC 拆分** |
| `llama-3.1-70b-versatile` | Llama 3.1，70B 参数，稳定可靠 | 通用任务 |
| `mixtral-8x7b-32768` | Mixtral MoE 架构，上下文 32K | 长文档处理 |
| `gemma2-9b-it` | Google Gemma 2，9B 参数，速度快 | 快速响应场景 |

## 性能对比

### Groq vs 智谱 AI (GLM-4-Flash)

| 维度 | Groq (Llama 3.3 70B) | 智谱 AI (GLM-4-Flash) |
|------|---------------------|---------------------|
| **推理速度** | ⚡ 极快 (500+ tokens/s) | 🐢 较慢 (50-100 tokens/s) |
| **模型能力** | 🎯 强大 (70B 参数) | 🎯 强大 (优化版) |
| **成本** | 💰 免费额度充足 | 💰 按量计费 |
| **稳定性** | ✅ 高 | ✅ 高 |
| **中文支持** | ⚠️ 良好但略逊 | ✅ 优秀 |
| **COSMIC 拆分质量** | ✅ 优秀 | ✅ 优秀 |

### 推荐使用场景

**Groq 更适合：**
- 需要快速响应的场景
- 大量文档批量处理
- 英文或中英混合文档
- 对推理速度有要求

**智谱 AI 更适合：**
- 纯中文文档处理
- 需要深度理解中文语义
- 对中文专业术语敏感

## 使用建议

### 方案 1：Groq 优先（推荐）

```env
OPENAI_BASE_URL=https://api.groq.com/openai/v1
OPENAI_API_KEY=your_groq_api_key_here
OPENAI_MODEL=llama-3.3-70b-versatile
```

**优势：**
- 速度快 5-10 倍
- 免费额度充足
- 拆分质量与智谱相当

### 方案 2：智谱 AI（备选）

```env
OPENAI_BASE_URL=https://open.bigmodel.cn/api/paas/v4
OPENAI_API_KEY=your_zhipu_api_key
OPENAI_MODEL=glm-4-flash
```

**优势：**
- 中文理解更深入
- 适合复杂中文文档

## 实际测试建议

建议用同一份文档分别测试两个 API，对比：

1. **拆分速度**：Groq 应该快 5-10 倍
2. **拆分质量**：功能过程数量、命名准确性、ERWX 完整性
3. **中文理解**：专业术语识别、业务逻辑理解

## 切换方法

无需重启服务器，直接在前端界面修改 API 配置即可：

1. 点击"API 配置"按钮
2. 修改 Base URL 和 API Key
3. 点击"保存配置"

## 注意事项

- 请使用自己的 Groq API Key 进行配置，勿将密钥提交到仓库
- 如需更换 API Key，请访问 [Groq Console](https://console.groq.com/)
- 建议定期检查 API 使用额度
- 如遇到速率限制，可考虑升级 Groq 账户或切换到智谱 AI

## 总结

**Groq 的 Llama 3.3 70B 模型在速度上有压倒性优势，拆分质量与智谱 AI 相当。对于大多数场景，推荐优先使用 Groq。**
