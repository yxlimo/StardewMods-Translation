# translateKeys 语法文档

## 概述

`translateKeys` 是配置文件中用于指定需要翻译的 JSON 路径模式，支持数组迭代、嵌套查询和条件定位。

## 基本语法

| 语法 | 说明 | 示例 |
|------|------|------|
| `key` | 精确匹配 key | `ConfigSchema.Option1.Description` |
| `*` | 通配符，匹配任意字符 | `Changes.*.Message` |
| `(*)` | 数组遍历，遍历该数组的所有元素 | `Changes(*).Entries` |
| `key[index]` | 访问数组指定索引 | `Changes[0].Entries` |
| `key[*]` | 遍历数组成员（用于嵌套路径） | `Owners[*].Dialogues[*]` |
| `key["nested.key"]` | 访问包含点的 key | `Entries["dreamy.kickitspot_CapeSeaCavern"]` |
| `key(@Id=value)` | 条件定位，匹配对象 key 为 value | `Entries(@Id=dreamy.kickitspot_jellishop)` |

## JSON 注释支持

使用 JSON5 解析器，支持以下注释格式：

```json
{
  // 单行注释
  "Changes": [
    {
      /* 多行
         注释 */
      "Entries": {}
    }
  ]
}
```

## 详细说明

### 1. 精确匹配

```json
{
  "translateKeys": ["ConfigSchema.Option1.Description"]
}
```

匹配 `data.ConfigSchema.Option1.Description` 的值。

### 2. 点号分隔符

路径按 `.` 分隔，但会忽略以下内容内的点：
- 方括号内：`["key.with.dots"]`
- 圆括号内：`(@Id=value)`

### 3. 数组遍历 `(*)`

用于遍历数组本身的所有元素：

```json
{
  "translateKeys": ["Changes(*).Entries.CapeBusStop.ChooseDestinationMessage"]
}
```

对于数据结构：
```json
{
  "Changes": [
    { "Entries": { "CapeBusStop": { "ChooseDestinationMessage": "Hello" } } },
    { "Entries": { "CapeBusStop": { "ChooseDestinationMessage": "World" } } }
  ]
}
```

会匹配并返回：
- `Changes[0].Entries.CapeBusStop.ChooseDestinationMessage` = "Hello"
- `Changes[1].Entries.CapeBusStop.ChooseDestinationMessage` = "World"

### 4. 带点的 Key

当 key 本身包含点时，使用方括号引号语法：

```json
{
  "translateKeys": ["Changes(*).Entries[\"dreamy.kickitspot_CapeSeaCavern\"].LockedMessage"]
}
```

### 5. 嵌套数组遍历 `[*]`

用于遍历嵌套数组的成员：

```json
{
  "translateKeys": [
    "Changes(*).Entries[\"dreamy.kickitspot_jellishop\"].Owners[*].Dialogues[*].Dialogue"
  ]
}
```

对于数据结构：
```json
{
  "Changes": [{
    "Entries": {
      "dreamy.kickitspot_jellishop": {
        "Owners": [
          {
            "Name": "Jelli",
            "Dialogues": [
              { "Dialogue": "Hello" },
              { "Dialogue": "World" }
            ]
          }
        ]
      }
    }
  }]
}
```

会匹配：
- `Owners[0].Dialogues[0].Dialogue` = "Hello"
- `Owners[0].Dialogues[1].Dialogue` = "World"

### 6. 条件定位 `@Id=value`

用于在对象中精确定位到特定 key 的条目：

```json
{
  "translateKeys": [
    "Changes(*).Entries(@Id=dreamy.kickitspot_jellishop).Owners[*].Dialogues[*].Dialogue"
  ]
}
```

`Entries(@Id=dreamy.kickitspot_jellishop)` 会查找 `Entries` 中 key 为 `dreamy.kickitspot_jellishop` 的对象。

**注意**：`@Id=value` 语法匹配的是对象的 key（字段名），而不是字段值。

### 7. 数组索引

```json
{
  "translateKeys": ["Changes[0].Entries.CapeBusStop"]
}
```

直接访问 `Changes` 数组的第 0 个元素。

## 完整示例

配置 `TestMod.json`：

```json
{
  "baseDir": "TestMod",
  "files": [
    {
      "file": "Data/dataWithArray.json",
      "target": "Data/dataWithArray.json",
      "translateKeys": [
        "Changes(*).Entries.CapeBusStop.ChooseDestinationMessage",
        "Changes(*).Entries[\"dreamy.kickitspot_CapeSeaCavern\"].LockedMessage",
        "Changes(*).Entries[\"dreamy.kickitspot_jellishop\"].Owners[*].Dialogues[*].Dialogue",
        "Changes(*).Entries[\"dreamy.kickitspot_jellishop2\"].Owners[*].Dialogues[*].Dialogue"
      ]
    }
  ]
}
```

对应的源数据结构 `dataWithArray.json`：

```json
{
  // Cape Stardew Mine Cart Data
  "Changes": [
    {
      // Bus stop destination
      "Entries": {
        "CapeBusStop": {
          "ChooseDestinationMessage": "EnglishMessageToTranslate"
        }
      }
    },
    {
      // Sea cavern with lock
      "Entries": {
        "dreamy.kickitspot_CapeSeaCavern": {
          "LockedMessage": "EnglishMessageToTranslate"
        }
      }
    },
    {
      "Action": "EditData",
      "Target": "Data/Shops",
      "Entries": {
        "dreamy.kickitspot_jellishop": {
          "Owners": [
            {
              "Name": "Jelli",
              "Dialogues": [
                { "Dialogue": "EnglishMessageToTranslate" }
              ]
            }
          ]
        }
      }
    }
  ]
}
```

## CLI 命令

```bash
# 检查需要翻译的 key
bun run check <mod-name>

# 执行翻译
bun run translate <mod-name>

# 指定配置文件
bun run check -c mods/config/TestMod.json
bun run translate -c mods/config/TestMod.json
```

## 语法规则

1. **分隔符**：`.` 用于分隔路径层级
2. **引号保护**：方括号内的内容不会被当作路径分隔符
3. **括号保护**：圆括号内的 `.` 不会分隔路径
4. **条件语法**：`@Id=value` 必须在圆括号内，匹配对象 key
5. **数组遍历**：
   - `(*)` 遍历数组本身
   - `[*]` 遍历数组成员（用于嵌套路径）
   - `[n]` 访问指定索引

## 返回路径格式

查询返回的路径使用以下格式：
- 数组遍历：`Changes[0]`（包含实际索引）
- 普通 key：`Entries.Field`
- 带点的 key：`Entries["key.with.dots"]`
- 组合：`Changes[0].Entries["key"].Field[1].Message`
