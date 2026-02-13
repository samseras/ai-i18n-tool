# AI i18n 自动化翻译工具

基于 Google Translate (网页版接口) 的自动化国际化工具，专为 JavaScript 项目设计，能够智能处理插值变量、过滤非翻译字段，并支持多种复杂的文件结构。

## 核心特性

- **完全免费**：使用 `google-translate-api-x`，无需 API Key，无配额限制。
- **变量保护**：自动识别并保护 `{name}`, `{typeName}` 等插值变量，确保翻译后变量名不变。
- **智能过滤**：自动识别并跳过 `path`, `url`, `image`, `id` 等不应翻译的字段。
- **多结构支持**：
  - **标准模块**：处理 `locales/` 下的递归目录结构。
  - **内部数据对象**：直接修改 JS 文件内部定义的导出的多语言对象。
  - **引用型模块**：处理通过 `import` 引入外部语言包汇总导出的结构。
- **ES Module 支持**：原生支持 `export default` 语法。

## 快速开始

### 1. 安装依赖
```bash
npm install
```

### 2. 环境配置
虽然目前使用 Google 翻译网页接口，但部分脚本仍预留了 `dotenv` 加载，可创建空 `.env` 文件或根据需要保留。

## 使用指南

本项目包含三个针对不同文件结构的翻译脚本：

### A. 翻译标准语言包 (Locales)
适用于 `locales/en/` 目录下的所有模块文件。
- **源文件**：`locales/en.js` 及 `locales/en/modules/*.js`
- **命令**：
  ```bash
  node translate.mjs <目标语言代码>
  # 示例：翻译成法语
  node translate.mjs fr
  ```

### B. 翻译工具类内部对象 (Internal Data)
适用于 `utils/` 下直接定义并导出多语言对象的文件（如 `movie-avatar-template-data.js`）。
- **包含文件**：
  - `utils/discover-more-tools-helper.js`
  - `utils/movie-avatar-template-data.js`
  - `utils/instant-avatar-clone-data.js`
- **命令**：
  ```bash
  node batch-translate-utils.mjs <目标语言代码>
  ```

### C. 翻译引用型模块 (Referenced Modules)
适用于主文件仅负责 `import` 不同语言包并汇总导出的结构。
- **包含文件**：
  - `utils/template-data.js`
  - `utils/ai-image-tamplate-data.js`
  - `utils/video-subtitle-remove-template-data.js`
  - `utils/tiktok-product-page-data.js`
- **命令**：
  ```bash
  node translate-referenced-modules.mjs <目标语言代码>
  ```

## 目录结构参考

### 标准 Locales 结构
```text
locales/
├── en.js              # 英文根文件
├── en/
│   └── modules/       # 英文各模块
└── fr/                # 自动生成的法语模块
    └── modules/
```

### Utils 引用结构
```text
utils/
├── template-data.js   # 主汇总文件 (自动添加新语言 import)
└── template-data/
    ├── en.js          # 英文源数据
    └── fr.js          # 自动生成的法语数据
```

## 注意事项

1. **Node.js 版本**：请确保使用 **Node.js v18+** (推荐 v20)，因为脚本使用了动态 `import()` 和现代正则语法。
2. **网络环境**：由于使用 Google 翻译接口，请确保你的网络环境可以访问 Google 服务。
3. **变量保护**：脚本目前保护 `{[^}]+}` 格式的变量。如果你的项目使用其他格式（如 `$t(name)`），请在脚本中调整正则。
