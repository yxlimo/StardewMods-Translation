# JSONPath 调研报告

## 调研目的

验证现有 JSONPath 库是否能支持项目的自定义路径语法，特别是 `@Id=xxx` 条件定位语法。

## 调研结论

### 1. ts-jsonpath

**结论：不能使用**

`ts-jsonpath` v0.0.1 是一个纯类型推导库（compile-time only），不提供任何运行时查询功能。

- npm 页面描述为 "Type-safe JSONPath"
- 仅提供 TypeScript 类型推导
- 无任何运行时查询函数
- 不能用于实际的数据查询

### 2. jsonpath-plus

**结论：不能支持 `@Id=xxx` 语法**

标准 JSONPath 用 `[?(@.field=="value")]` 语法过滤数组元素：

```javascript
// JSONPath Plus 用法
const result = jp.query(data, "$..[?(@.Id=='someId')].Dialogue");
```

这与我们的需求不同：
- 我们的 `@Id=xxx` 是匹配**对象的 key（字段名）**，不是字段值
- 我们需要查询 `Entries(@Id=dreamy.kickitspot_jellishop)` 找到 key 为 `dreamy.kickitspot_jellishop` 的对象
- JSONPath 的过滤语法是基于元素内部字段值，不是 key 名

### 3. 自定义 query.ts

由于没有现有库能满足需求，项目实现了自定义的 `query.ts` 模块。

#### 支持的语法

| 语法 | 说明 | 示例 |
|------|------|------|
| `key` | 精确匹配 key | `ConfigSchema.Option1` |
| `*` | 通配符，匹配任意字符 | `Changes.*.Message` |
| `(*)` | 数组遍历，遍历该数组的所有元素 | `Changes(*).Entries` |
| `key[index]` | 访问数组指定索引 | `Changes[0].Entries` |
| `key["nested.key"]` | 访问包含点的 key | `Entries["dreamy.kickitspot_CapeSeaCavern"]` |
| `key(@Id=value)` | 条件定位，匹配对象 key 为 value | `Entries(@Id=dreamy.kickitspot_jellishop)` |

#### `@Id=xxx` 语法说明

`@Id=xxx` 是项目的自定义语法，用于在对象中精确定位到特定 key 的条目：

```json
{
  "Entries": {
    "dreamy.kickitspot_jellishop": {
      "Owners": [...]
    }
  }
}
```

路径 `Entries(@Id=dreamy.kickitspot_jellishop)` 会查找 `Entries` 中 key 为 `dreamy.kickitspot_jellishop` 的对象。

**注意**：`@Id=value` 语法匹配的是对象的 key（字段名），而不是字段值。

## 调研的库

| 库名 | 版本 | 能否使用 | 原因 |
|------|------|----------|------|
| ts-jsonpath | 0.0.1 | 否 | 纯类型推导库，无运行时功能 |
| jsonpath-plus | ^9.0.0 | 否 | 使用 `[?(@.field=="value")]` 语法，不支持 key 名匹配 |

## 实现方案

项目使用自定义的 `query.ts` 模块实现路径查询：

- `query(data, pathPattern)` - 查询匹配路径的所有叶子值
- `updateAtPath(data, path, newValue)` - 在指定路径更新值
- `splitPath(pathPattern)` - 将路径模式拆分为段

路径格式使用括号表示法：
- 数组索引：`Changes[0]`（而不是 `Changes.0`）
- 带点的 key：`Entries["key.with.dots"]`
- 条件定位：`Entries(@Id=value)`
