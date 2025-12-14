# Preset Transfer Tool

一个功能强大的 SillyTavern 扩展，用于在不同预设之间管理和转移预设条目，支持拖放、批量编辑、状态管理和正则绑定等高级功能。

## ✨ 功能特性

- **📋 条目转移**：在预设之间移动或复制条目，界面直观易用
- **🔄 拖放操作**：通过拖拽重新排序条目或在预设间移动
- **🔍 搜索过滤**：实时搜索快速查找条目
- **✏️ 批量编辑**：一次性修改多个条目
- **📊 条目状态**：跟踪条目状态（激活/停用/测试），带可视化指示器
- **🎯 正则绑定**：将条目链接到正则脚本，实现高级自动化
- **📦 导入导出**：备份和分享你的预设配置
- **🔄 预设更新**：自动更新预设以支持新的 API 字段
- **🤖 AI 助手**：获取 AI 驱动的条目管理建议
- **📱 移动端支持**：完全响应式设计，支持触摸操作

## 📦 安装方法

### 方法 1：通过 URL 安装（推荐）

1. 打开 SillyTavern，进入 **Extensions**（拼图图标）
2. 点击 **Install Extension**
3. 粘贴仓库 URL：
   ```
   https://github.com/YOUR_USERNAME/preset-transfer
   ```
4. 点击 **Save** 并刷新页面

### 方法 2：手动安装

1. 下载最新版本
2. 解压到 `SillyTavern/public/scripts/extensions/third-party/preset-transfer/`
3. 刷新 SillyTavern

## 🚀 使用说明

1. 在扩展面板中点击 **Preset Transfer** 按钮
2. 从下拉菜单中选择源预设和目标预设
3. 使用界面进行操作：
   - **选择条目**：点击复选框
   - **拖动条目**：拖拽以重新排序或在预设间移动
   - **编辑条目**：点击编辑图标
   - **转移条目**：使用箭头按钮
   - **批量操作**：通过批量编辑器

## 🛠️ 开发

### 环境要求

- Node.js 18+
- npm 或 pnpm

### 设置

```bash
# 安装依赖
npm install

# 开发模式（监听文件变化）
npm run dev

# 生产构建
npm run build
```

### 构建输出

- `dist/index.js` - 打包后的 JavaScript
- `dist/style.css` - 编译后的样式

**注意**：`dist/` 文件夹必须提交到仓库，以便 SillyTavern 能直接从 GitHub 加载扩展。

## 📁 项目结构

```
preset-transfer/
├── src/
│   ├── core/          # 核心工具和 API
│   ├── preset/        # 预设数据管理
│   ├── operations/    # 业务逻辑操作
│   ├── display/       # 列表渲染和显示
│   ├── ui/            # UI 组件和模态框
│   ├── events/        # 事件处理
│   ├── features/      # 高级功能
│   ├── settings/      # 设置管理
│   ├── batch/         # 批量操作
│   └── styles/        # 样式工具
├── dist/              # 构建输出（需提交）
├── manifest.json      # 扩展清单
├── package.json       # npm 配置
└── vite.config.js     # 构建配置
```

## 🤝 贡献

欢迎贡献！请：

1. Fork 本仓库
2. 创建功能分支
3. 进行修改
4. 充分测试
5. 提交 Pull Request

## 📄 许可证

MIT License - 详见 LICENSE 文件

## 🐛 问题与支持

如果遇到问题或有建议：
- 在 GitHub 上提交 issue
- 提供详细的复现步骤
- 包含你的 SillyTavern 版本

## 🙏 致谢

为 SillyTavern 社区用 ❤️ 打造
