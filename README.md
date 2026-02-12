# GigWatch

🎵 **智能演出监控助手** - 自动追踪你关注的艺人和演出，第一时间 Telegram 通知你

<div align="center">

[![Bun](https://img.shields.io/badge/Bun-1.0+-black?logo=bun)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue?logo=typescript)](https://www.typescriptlang.org/)
[![SQLite](https://img.shields.io/badge/SQLite-3-003B57?logo=sqlite)](https://www.sqlite.org/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

</div>

---

## ✨ 特性

- 🤖 **AI Agent 驱动** - LLM 自主决策，智能分析演出信息
- 🔔 **Telegram 通知** - 关注艺人有新演出？立即通知你
- 📨 **飞书 Bot 对话** - 在飞书里直接和 GigWatch 对话，消息自动落库
- 🎯 **多维度监控** - 艺人、城市、流派、关键词，全方位覆盖
- 📊 **每日报告** - AI 生成精准摘要，不错过任何重要信息
- 🌐 **多种界面** - CLI、Web UI、TUI，随心选择
- 💾 **本地存储** - SQLite 数据库，所有数据本地可控

---

## 🚀 快速开始

### 1. 安装

```bash
# 克隆项目
git clone https://github.com/Hexthebaldy/GigWatch.git
cd GigWatch

# 安装依赖
bun install

# 初始化数据库
bun run init-db
```

### 2. 配置

#### 创建监控配置

```bash
cp config/monitoring.example.json config/monitoring.json
```

编辑 `config/monitoring.json`，添加你关注的艺人和城市：

```json
{
  "monitoring": {
    "focusArtists": ["青叶市子", "Central Cee"],
    "cityCodes": ["21", "10"],  // 21=上海, 10=北京（见 src/dictionary/showstartCities.ts）
    "showStyles": ["2", "3"],   // 2=摇滚, 3=流行（见 src/dictionary/showstartShowStyles.ts）
    "keywords": ["新年"]
  }
}
```

> 💡 城市/风格代码内置在本仓库的 `src/dictionary/` 中，Web UI 可直接勾选无需手填。
> 📁 `src/dictionary/` 存放公共字典；`data/` 仅用于本地数据库文件。

#### 配置环境变量（可选）

创建 `.env` 文件：

```bash
# LLM 配置（AI Agent 功能必需）
OPENAI_API_KEY=sk-xxx
OPENAI_BASE_URL=https://api.moonshot.cn/v1
OPENAI_MODEL=kimi-k2-turbo-preview

# Telegram 通知（推荐配置）
TELEGRAM_BOT_TOKEN=123456789:ABCdef...
TELEGRAM_CHAT_ID=123456789

# Feishu Bot（可选）
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx
FEISHU_BASE_URL=https://open.feishu.cn

# 可选配置
APP_TIMEZONE=Asia/Shanghai      # 默认时区，影响每日 06:00 定时任务
DB_PATH=./data/gigwatch.sqlite  # 数据库路径
APP_PORT=3000                   # Web UI 端口
CONFIG_PATH=./config/monitoring.json  # 自定义配置文件路径（可选）
```

> 📖 详细配置说明：[Telegram 配置指南](./docs/telegram-integration.md)
> 📨 飞书接入说明：[飞书 Bot 注册与接入指南](./docs/feishu-bot-setup.md)
> ⚠️ 飞书后台改完机器人/事件配置后，务必发布新版本；未发布时客户端可能看不到输入框。

### 3. 运行

```bash
# 立即运行一次监控
bun run daily
```

**第一次运行，你会看到：**
- 🔍 自动抓取演出信息
- 🤖 AI Agent 分析结果
- 📱 如果有关注艺人演出 → Telegram 通知
- 📊 生成每日报告

---

## 📱 使用方式

### CLI - 命令行

```bash
# 运行每日监控（推荐在 cron 中定时执行）
bun run daily

# 启动 Telegram 长轮询入口
bun run src/cli.ts telegram

# 启动飞书 Bot 长连接入口
bun run feishu
```

### Web UI - 网页界面

```bash
# 启动 Web 服务器
bun run serve

# 浏览器访问 http://localhost:3000
```

**功能：**
- 📊 查看最新报告
- 🔍 查看搜索日志
- ⚙️ 编辑监控配置（城市/演出风格支持勾选多选，使用内置字典）
- ▶️ 手动触发抓取
- ⏰ 自动定时任务（每天 06:00）

### TUI - 终端界面

```bash
# 启动交互式菜单
bun run tui
```

**功能：**
- 📖 查看最新日报
- 📜 查看搜索日志
- 🚀 立即抓取
- ➕ 新增监控查询
- 🎯 设置关注艺人

---

## 🧠 AI Agent 工作流程

GigWatch 使用 **LLM-driven Agent** 智能监控演出：

```
1. 执行查询
   ↓
2. 抓取演出信息
   ↓
3. 保存到数据库
   ↓
4. AI 分析结果
   ↓
5. 智能决策：是否通知？
   ├─ 关注艺人有演出 → 🚨 紧急通知（带声音）
   ├─ 新演出匹配监控 → 📊 普通通知（静音）
   └─ 无相关演出 → 🔕 不通知
   ↓
6. 生成每日报告
```

**示例通知：**

```
🚨 紧急通知：关注艺人 Central Cee 有新演出！

🎤 Central Cee - WORLD TOUR

📍 上海站（加场）
• 时间：2026年3月7日 19:00
• 地点：纪希秀场
• 票价：¥480起
• 购票：https://www.showstart.com/event/289271

⚡️ 建议尽快购票！
```

---

## 🔧 定时执行

### 使用 cron（推荐）

```bash
# 编辑 crontab
crontab -e

# 添加定时任务（每天 9:00 执行）
0 9 * * * cd /path/to/GigWatch && bun run daily
```

### 使用 Web UI 自动调度

启动 Web 服务器后，会自动在每天 **06:00**（服务器时区）执行监控任务。

---

## 📚 文档

### 快速上手
- [Telegram 5 分钟配置](./docs/telegram-quickstart.md) - 快速接入 Telegram 通知
- [飞书 Bot 注册与接入指南](./docs/feishu-bot-setup.md) - 从创建应用到长连接联调
- [测试指南](./docs/testing-guide.md) - 运行测试确保一切正常

### 深入了解
- [Phase 2: LLM-driven Agent](./docs/phase2-llm-agent.md) - AI Agent 架构详解
- [Telegram 集成完整指南](./docs/telegram-integration.md) - 详细配置说明
- [Agent 架构规划](./docs/agent-architecture-plan.md) - 技术架构文档

### 开发者
- [Phase 1 完成报告](./docs/phase1-completion.md) - 工具系统架构
- [Phase 2 完成总结](./docs/phase2-completion-summary.md) - LLM Agent 实现细节

---

## 🧪 测试

```bash
# 运行所有单元测试
bun run test

# 测试 LLM Agent（需要配置 LLM）
bun run test:llm

# 测试 Telegram 通知（需要配置 Telegram）
bun run test:telegram
```

详见：[测试指南](./docs/testing-guide.md)

---

## 💡 常见问题

### Q: 收不到 Telegram 通知？

**检查：**
1. `.env` 中是否配置了 `TELEGRAM_BOT_TOKEN` 和 `TELEGRAM_CHAT_ID`
2. 是否给 bot 发送过至少一条消息
3. 运行测试：`bun run test:telegram`

详见：[Telegram 配置指南](./docs/telegram-integration.md)

### Q: AI Agent 未启用？

**检查：**
1. `.env` 中是否配置了 `OPENAI_API_KEY`
2. 查看日志：应该看到 `[Agent] Using LLM-driven execution`
3. 如果看到 `LLM not available, using rule-based execution` → 检查 API key

### Q: 如何添加新的监控维度？

**方式 1：Web UI**
- 访问 http://localhost:3000
- 点击"编辑配置"
- 添加艺人/城市/关键词

**方式 2：TUI**
- 运行 `bun run tui`
- 选择"新增查询"或"设置关注艺人"

**方式 3：手动编辑**
- 编辑 `config/monitoring.json`
- 重启服务或重新运行 `bun run daily`

### Q: 成本多少？

**LLM 调用（Kimi K2 Turbo）：**
- 单次监控：约 ¥0.16
- 每日 1 次：约 ¥4.8/月
- 每年：约 ¥58

**ShowStart API：** 免费

**总计：** 每月不到 ¥5

---

## 🛣️ Roadmap

### Phase 3（进行中）

**核心优化：**
- [ ] **上下文管理策略** - Token 计数、智能压缩、滑动窗口，防止超过 128K 限制
- [ ] **Web Search Tool** - Agent 可搜索艺人最新动态、巡演消息、社交媒体
- [ ] **爬虫防御性兜底** - Nuxt 解析失败时自动切换到 LLM 清洗 HTML 模式


---

## 📄 许可

MIT License

---

## 🙏 致谢

- [ShowStart](https://www.showstart.com) - 演出数据来源，你比大麦牛逼多了👍
- [Kimi](https://kimi.moonshot.cn) - 性价比之壁
- [Bun](https://bun.sh) - 你是最棒的JavaScript 运行时

---

<div align="center">

**⭐️ 如果这个项目帮到了你，请给个 Star！**

</div>
