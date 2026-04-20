# 星露谷模组翻译工具 - 技术设计文档

## 概述

本工具用于自动翻译星露谷（Stardew Valley）模组文件，基于配置文件实现增量翻译，尊重已有翻译。集成 OpenAI/LLM API 进行机器翻译。

## 项目结构

```
ChineseTranslation/
├── src/
│   ├── index.ts             # CLI 入口
│   ├── translator.ts        # 核心翻译逻辑
│   ├── fileHandler.ts       # 文件读写
│   ├── config.ts            # 配置文件解析
│   ├── diff.ts              # 值差异检测
│   ├── llm.ts               # LLM API 调用（含 mock 模式）
│   ├── modDiscovery.ts      # 自动发现 mods
│   ├── versionManager.ts    # 版本管理
│   └── types.ts             # 类型定义
├── tests/                   # bun:test 测试
├── docs/
│   └── design.md            # 本文档
├── mods/
│   ├── config/              # 模组配置文件（可选）
│   ├── default/             # 原始 mod 文件
│   ├── zh/                  # 翻译后的文件
│   └── release/             # 打包输出目录
├── package.json
└── tsconfig.json
```

## 核心概念

### zh.json.default - 翻译前的英文原版备份

翻译完成后，`i18n/default.json` 会被复制为 `i18n/zh.json.default`。这是翻译前的英文原版备份，用于下次翻译时做 diff。

### 值差异检测（Value Diff）

diff 比对的是 `default.json` vs `zh.json.default`，检测值是否变化：
- **newKeys**: default 有但 zh.default 没有 → 新增 key，需要翻译
- **changedKeys**: 两者都有但值不同 → 变更 key，需要重新翻译
- **unchangedKeys**: 两者都有且值相同 → 沿用 zh.json 的翻译

### config.json 定位

config.json 是**补充配置**，非必须：
- 用于指定需要翻译的**额外 json 文件**（非 i18n 目录）
- 不管有没有 config，都会自动扫描 i18n 目录

## i18n 翻译流程

```
1. 读取 i18n/default.json（英文原版）
2. 读取 i18n/zh.json（如存在，已翻译版本）
3. 读取 i18n/zh.json.default（如存在，上次翻译时的英文原版）

条件判断：
- zh.json 不存在 → 全新翻译，所有 key 都翻译
- zh.json 存在但 zh.json.default 不存在 → 报错（数据不一致）
- zh.json.default 存在 → 进行值差异检测

4. 比较 default.json vs zh.json.default：
   - 值变了 → 重新翻译
   - 值没变 → 延用 zh.json 的翻译

5. 翻译完成后：
   - 写入 i18n/zh.json（中文翻译）
   - 复制 default.json → zh.json.default（备份）
```

## manifest.json 版本对比

```
1. 读取 default/manifest.json 的 Version → defaultVersion
2. 读取 zh/manifest.json 的 Version → zhVersion（如存在）
3. 比较：defaultVersion > zhVersion?
   - 否 → 跳过（无新版本）
   - 是 → 继续翻译
4. 翻译完成后更新 zh/manifest.json 的 Version = defaultVersion
```

## CLI 命令

```bash
bun run translate <mod-name>     # 翻译模组（自动发现 i18n）
bun run list                     # 列出可发现的模组
bun run check <mod-name>         # 查看会翻译哪些 key
bun run pack <mod-name>          # 打包成 zip
```

### 环境变量

```env
STARDEW_TRANSLATION_ANTHROPIC_API_KEY=your_key
STARDEW_TRANSLATION_ANTHROPIC_MODEL=claude-sonnet-4
STARDEWMOD_TRANSLATION_ORIGIN_DIR=mods/default
STARDEWMOD_TRANSLATION_ZH_DIR=mods/zh
```

## 配置文件格式

配置文件位于 `mods/config/` 目录（可选）：

```json
{
  "baseDir": "DeluxeGrabberFix",
  "files": [
    {
      "file": "i18n/default.json",
      "target": "i18n/zh.json"
    }
  ]
}
```

## 核心模块

### translator.ts

- `translateI18nFile(originPath, targetPath, result)`: 翻译 i18n 文件
  - 读取 zh.json.default 做值差异检测
  - 翻译新增/变更的 key
  - 沿用未变更 key 的现有翻译
  - 写入目标文件并备份 default.json

### diff.ts

- `computeValueDiff(defaultData, zhDefaultData)`: 使用 deep-diff 计算值级别差异
  - 返回 `{ newKeys, changedKeys, unchangedKeys }`

### versionManager.ts

- `compareVersions(v1, v2)`: 比较 semver 版本
- `needsTranslation(defaultVersion, zhVersion)`: 判断是否需要翻译
- `getModVersion(baseDir, isZh, originDir, zhDir)`: 获取模组版本
- `updateZhManifestVersion(baseDir, newVersion, zhDir)`: 更新 zh manifest 版本

### modDiscovery.ts

- `discoverMods(originDir, zhDir)`: 自动发现 mods/default 下的模组
- `generateDefaultConfig(modInfo)`: 为模组生成默认配置（仅 i18n）

## 测试

```bash
bun test           # 运行所有测试
```

测试覆盖：
- 值差异检测逻辑
- 版本比较逻辑
- 翻译流程（新增/变更/不变 key 的处理）

## 错误处理

- LLM API 调用失败时，程序终止，不写入文件
- zh.json 存在但 zh.json.default 不存在时报错
- 翻译结果自动清理 AI 多余输出（thinking 标签、编号等）