# 星露谷模组翻译工具 - 技术设计文档

## 概述

本工具用于自动翻译星露谷（Stardew Valley）模组文件，基于配置文件实现增量翻译，尊重已有翻译。集成 OpenAI/LLM API 进行机器翻译。

## 项目结构

```
ChineseTranslation/
├── src/                      # TypeScript 源代码
│   ├── index.ts             # CLI 入口
│   ├── translator.ts        # 核心翻译逻辑
│   ├── fileHandler.ts       # 文件处理（JSON/TMX等）
│   ├── config.ts            # 配置文件解析
│   ├── diff.ts              # 增量对比逻辑
│   ├── llm.ts               # LLM API 调用（含 mock 模式）
│   └── types.ts             # 类型定义
├── tests/                   # bun:test 测试
│   └── translator.test.ts
├── docs/
│   └── design.md            # 本文档
├── mods/
│   ├── config/              # 模组配置文件
│   ├── default/             # 原始 mod 文件
│   ├── zh/                  # 翻译后的文件
│   └── release/             # 打包输出目录
├── build_release.sh         # 打包脚本
├── package.json
└── tsconfig.json
```

## 配置文件格式

配置文件位于 `mods/config/` 目录，每个模组一个 JSON 文件：

```json
{
  "baseDir": "DeluxeGrabberFix",
  "files": [
    {
      "file": "i18n/default.json",
      "target": "i18n/zh.json",
      "translateAll": true
    }
  ]
}
```

### 字段说明

| 字段 | 说明 |
|------|------|
| `baseDir` | 模组文件夹名，指向 `mods/default/` 和 `mods/zh/` 下的子目录 |
| `files` | 需要翻译的文件列表 |
| `file` | 原始文件路径（相对于 `mods/default/{baseDir}/`） |
| `target` | 翻译后文件路径（相对于 `mods/zh/{baseDir}/`） |
| `translateAll` | 是否全量翻译（默认 false） |
| `translateKeys` | 使用 jsonpath 匹配的 key 列表 |

## LLM 翻译

### 环境配置

在项目根目录 `.env` 文件中配置：

```env
OPENAI_URL=https://api.kimi.com/coding/v1
OPENAI_API_KEY=your_api_key
OPENAI_MODEL=K2.5
```

### llm.ts

- `translateWithLLM(text, from, to)`: 翻译单个文本
- `translateBatch(texts, from, to)`: 批量翻译文本
- `setMockMode(enabled)`: 启用/禁用测试模式
- `setMockTranslation(input, output)`: 设置固定翻译映射
- `parseTranslationResult()`: 清理 AI 返回结果（移除 thinking 标签、编号等）

### 测试模式

测试时不调用真实 LLM API，使用 mock 模式返回预设翻译：

```typescript
import { setMockMode, setMockTranslation } from "./llm";

setMockMode(true);
setMockTranslation("Hello", "你好");
```

## 文件类型处理

### 1. i18n/default.json（全量翻译）

- 读取 `mods/default/{baseDir}/i18n/default.json`
- 对比 `mods/zh/{baseDir}/i18n/zh.json`（旧版本）
- 找出新增或修改的 key
- 调用 LLM 翻译新增 key
- 将增量合并到目标文件

### 2. 其他 JSON 文件（按 key 翻译）

- 读取 `mods/default/{baseDir}/{file}`（原始文件）
- 读取 `mods/zh/{baseDir}/translation.json` 获取已翻译的 key
- 根据 `translateKeys` 使用 ts-jsonpath 匹配需要翻译的内容
- 从 `mods/zh/{baseDir}/{target}` 取出已翻译的值
- 调用 LLM 翻译未翻译的 key
- 覆盖原始文件内容后输出到目标路径

### 3. TMX 文件（XML 格式）

使用 `fast-xml-parser` 的 XPath 功能直接操作 XML：

- 读取 `mods/default/{baseDir}/{file}`（原始 XML 内容）
- 使用 XPath 查询需要翻译的节点
- 根据 `translateKeys` 匹配需要翻译的内容
- 从 `mods/zh/{baseDir}/{target}` 取出已翻译的值
- 直接修改 XML 节点内容
- 输出到目标路径
- **注意**：直接操作 XML 节点，不转换成 JSON，防止二进制内容丢失

## translation.json 格式

记录已翻译过的 key（使用 jsonpath 语法）：

```json
{
  "version": "1.7.3",
  "files": [
    {
      "file": "[CP]Annetta/content.json",
      "keys": ["ConfigSchema.AnnettaPortraitStyle.Description"]
    }
  ]
}
```

## 核心模块

### types.ts

类型定义：

```typescript
enum FileType {
  I18nDefault = "i18n/default.json",  // 全量翻译
  Json = "json",                        // 按 key 翻译
  Tmx = "tmx",                          // XML 格式
  Unknown = "unknown",
}
```

### config.ts

- `loadConfig()`: 加载配置文件
- `getFileType()`: 判断文件类型
- `getOriginPath()`: 获取原始文件路径
- `getTargetPath()`: 获取目标文件路径
- `loadTranslationManifest()`: 加载 translation.json

### fileHandler.ts

- `readJsonFile()`: 读取 JSON 文件
- `writeJsonFile()`: 写入 JSON 文件
- `readTmxFile()`: 读取 TMX 文件（XML）
- `writeTmxFile()`: 写入 TMX 文件

### diff.ts

- `computeJsonDiff()`: 计算新旧文件的增量 key
- `getTranslatedKeysFromManifest()`: 获取已翻译的 key
- `getNewTranslationKeys()`: 获取新增的翻译 key

### llm.ts

- `translateWithLLM()`: 翻译单个文本
- `translateBatch()`: 批量翻译文本
- `setMockMode()`: 设置测试模式
- `setMockTranslation()`: 设置固定翻译映射
- `parseTranslationResult()`: 清理 AI 返回结果

### translator.ts

- `translateFile()`: 翻译单个文件（async）
- `translateI18nFile()`: 翻译 i18n 文件（async）
- `translateJsonFile()`: 翻译普通 JSON 文件（async）
- `translateTmxFile()`: 翻译 TMX 文件

### index.ts

CLI 入口，支持：

```bash
bun run src/index.ts                           # 翻译所有配置
bun run src/index.ts mods/config/DeluxeGrabberFix.json  # 翻译指定配置
```

## 技术栈

- **运行时**: Bun
- **语言**: TypeScript
- **测试**: bun:test
- **依赖**:
  - `ts-jsonpath`: JSON path 解析
  - `fast-xml-parser`: XML 解析

## 使用示例

```bash
# 安装依赖
bun install

# 运行测试
bun test

# 执行翻译
bun run translate mods/config/DeluxeGrabberFix.json

# 打包翻译文件
bun run pack DeluxeGrabberFix
```

## 错误处理

- LLM API 调用失败时，程序终止，不写入文件
- 翻译结果自动清理 AI 多余输出（thinking 标签、编号等）
