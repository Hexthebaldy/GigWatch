# Phase 3 规划：Agent 优化与能力扩展

## 概述

Phase 3 专注于提升 Agent 的**鲁棒性、智能性和扩展性**，解决 Phase 2 遗留的技术债务，并为未来的高级功能打下基础。

---

## 🎯 核心目标

### 1. 上下文管理策略

**问题：**
- Phase 2 没有 token 计数和上下文管理
- 长时间运行可能超过 Kimi 128K token 限制
- 工具结果冗余（每次都发送完整 JSON）

**解决方案：**

#### 1.1 Token 计数

```typescript
import { encoding_for_model } from "@dqbd/tiktoken";

class ContextManager {
  private encoder = encoding_for_model("gpt-4");

  estimateTokens(messages: Message[]): number {
    let total = 0;
    for (const msg of messages) {
      total += this.encoder.encode(JSON.stringify(msg)).length;
    }
    return total;
  }

  // 在每次循环中检查
  checkAndTruncate(messages: Message[], maxTokens = 100000): Message[] {
    const current = this.estimateTokens(messages);
    if (current > maxTokens) {
      return this.truncateMessages(messages, maxTokens);
    }
    return messages;
  }
}
```

#### 1.2 智能压缩工具结果

**当前问题：**
```typescript
// 每次都发送完整演出列表（几千个 tokens）
messages.push({
  role: "tool",
  content: JSON.stringify({
    success: true,
    data: {
      events: [...50个完整演出对象...]  // 冗余！
    }
  })
});
```

**优化方案：**
```typescript
// 只发送摘要 + 样本
function compressToolResult(result: ToolResult): string {
  if (result.toolName === "fetch_showstart_events") {
    return JSON.stringify({
      success: true,
      summary: `Fetched ${result.data.events.length} events`,
      sample: result.data.events.slice(0, 3),  // 只保留 3 个样本
      stats: {
        avgPrice: calculateAvgPrice(result.data.events),
        cities: [...new Set(result.data.events.map(e => e.cityName))]
      }
    });
  }

  if (result.toolName === "load_recent_events") {
    // 只发送统计信息，不发送完整列表
    return JSON.stringify({
      success: true,
      totalEvents: result.data.events.length,
      focusMatches: result.data.focusMatches.map(m => ({
        artist: m.artist,
        count: m.events.length,
        sample: m.events.slice(0, 2)  // 每个艺人只发 2 个样本
      }))
    });
  }

  return JSON.stringify(result);
}
```

#### 1.3 滑动窗口策略

```typescript
function truncateMessages(messages: Message[], maxTokens: number): Message[] {
  // 1. 保留 system prompt（必须）
  const systemMessages = messages.filter(m => m.role === "system");

  // 2. 保留最近的 N 条消息
  const otherMessages = messages.filter(m => m.role !== "system");
  const kept = [];
  let tokens = this.estimateTokens(systemMessages);

  // 从最新的消息开始保留
  for (let i = otherMessages.length - 1; i >= 0; i--) {
    const msgTokens = this.estimateTokens([otherMessages[i]]);
    if (tokens + msgTokens > maxTokens) break;
    kept.unshift(otherMessages[i]);
    tokens += msgTokens;
  }

  return [...systemMessages, ...kept];
}
```

**效果：**
- ✅ 防止超过 128K token 限制
- ✅ 降低 LLM 成本（更少的 input tokens）
- ✅ 保持最新的上下文信息

---

### 2. Web Search Tool

**目标：** Agent 可以搜索艺人的最新动态、巡演消息

**实现方案：**

#### 2.1 工具定义

```typescript
// src/agent/tools/websearch.ts

export const createWebSearchTool = (): Tool => ({
  name: "search_web",
  description: "搜索网络获取艺人的最新动态、巡演计划、社交媒体消息",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "搜索关键词，例如：'Central Cee 2026 巡演'、'青叶市子 最新专辑'"
      },
      maxResults: {
        type: "number",
        description: "返回的最大结果数（默认 5）"
      }
    },
    required: ["query"]
  },

  execute: async ({ query, maxResults = 5 }) => {
    try {
      // 选项 1：使用 SerpAPI / Google Custom Search
      const response = await fetch(
        `https://serpapi.com/search?q=${encodeURIComponent(query)}&num=${maxResults}`,
        { headers: { "X-API-Key": process.env.SERPAPI_KEY } }
      );
      const data = await response.json();

      // 提取搜索结果
      const results = data.organic_results.map((r: any) => ({
        title: r.title,
        link: r.link,
        snippet: r.snippet
      }));

      return {
        success: true,
        data: { query, results, count: results.length }
      };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }
});
```

#### 2.2 Agent 使用场景

**场景 1：验证演出真实性**
```
User: "监控 Central Cee 演出"
Agent:
1. fetch_showstart_events → 发现 3 场演出
2. search_web("Central Cee 2026 tour dates") → 验证是否官方公布
3. 对比结果 → 如果搜索结果也提到这 3 场 → 更可信
4. send_telegram（高可信度通知）
```

**场景 2：补充演出信息**
```
Agent:
1. fetch_showstart_events → 发现"青叶市子 上海站"
2. search_web("青叶市子 2026 演出详情") → 搜索官网/社交媒体
3. 发现更多信息（嘉宾、曲目、购票链接）
4. send_telegram（包含补充信息）
```

**场景 3：主动发现演出**
```
Agent:
1. 定期 search_web("Central Cee 中国巡演 2026")
2. 发现新闻："Central Cee 宣布 5 月北京加场"
3. 对比 ShowStart 数据 → 尚未上架
4. send_telegram（预警："官宣了但 ShowStart 还没上，请关注"）
```

#### 2.3 集成方式

```typescript
// src/jobs/dailyReport.ts

const registry = new ToolRegistry();
registry.register(showstartTool);
registry.register(createDatabaseTool(db));
registry.register(createLoadEventsTool(db));
registry.register(createLogSearchTool(db));
registry.register(createTelegramTool(config));
registry.register(createWebSearchTool());  // ← 新增
```

**系统提示词更新：**
```
你是一个演出监控 Agent。可用工具：
1. fetch_showstart_events - 抓取 ShowStart 演出
2. upsert_event - 保存演出
3. log_search - 记录日志
4. load_recent_events - 加载最近演出
5. send_telegram - 发送通知
6. search_web - 搜索艺人最新动态（新增）

工作流程：
1. 抓取 ShowStart 演出
2. 如果发现关注艺人演出 → 使用 search_web 验证真实性
3. 根据搜索结果补充信息
4. 发送包含详细信息的通知
```

**成本：**
- SerpAPI: $50/月（5000 次搜索）
- 每次监控最多搜索 2-3 次 → ~60-90 次/月
- 实际成本：~$1/月（约 ¥7/月）

---

### 3. 爬虫防御性兜底

**问题：**
- ShowStart 可能改版（Nuxt → SPA）
- `window.__NUXT__` 结构可能变化
- 当前爬虫会直接失败

**解决方案：多层防御策略**

#### 3.1 三层爬虫策略

```typescript
// src/clients/showstart.ts

async function fetchShowStartEvents(params: QueryParams): Promise<FetchResult> {
  const url = buildUrl(params);

  // 策略 1：尝试 Nuxt SSR 解析（快速、低成本）
  try {
    const events = await parseNuxtSSR(url);
    if (events.length > 0) {
      logInfo("[Scraper] Strategy: Nuxt SSR ✅");
      return { success: true, events, url, strategy: "nuxt_ssr" };
    }
  } catch (error) {
    logWarn(`[Scraper] Nuxt SSR failed: ${error}`);
  }

  // 策略 2：尝试 Puppeteer + DOM 解析（中等成本）
  try {
    const events = await parsePuppeteerDOM(url);
    if (events.length > 0) {
      logInfo("[Scraper] Strategy: Puppeteer DOM ✅");
      return { success: true, events, url, strategy: "puppeteer_dom" };
    }
  } catch (error) {
    logWarn(`[Scraper] Puppeteer DOM failed: ${error}`);
  }

  // 策略 3：LLM 清洗 HTML（兜底，成本高）
  try {
    const events = await parseLLMCleanHTML(url);
    logWarn("[Scraper] Strategy: LLM HTML Cleaning ⚠️ (fallback)");
    return { success: true, events, url, strategy: "llm_html" };
  } catch (error) {
    logError(`[Scraper] All strategies failed: ${error}`);
    return { success: false, error: String(error), url };
  }
}
```

#### 3.2 策略 1：Nuxt SSR（当前方案）

```typescript
async function parseNuxtSSR(url: string): Promise<ShowStartEvent[]> {
  const html = await fetch(url).then(r => r.text());

  // 提取 window.__NUXT__
  const match = html.match(/window\.__NUXT__\s*=\s*(\{[\s\S]*?\});/);
  if (!match) throw new Error("window.__NUXT__ not found");

  const data = JSON.parse(match[1]);
  return data.data[0].listData || [];
}
```

#### 3.3 策略 2：Puppeteer + DOM 解析

```typescript
import puppeteer from "puppeteer";

async function parsePuppeteerDOM(url: string): Promise<ShowStartEvent[]> {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto(url, { waitUntil: "networkidle2" });

  // 等待演出列表渲染
  await page.waitForSelector(".event-item", { timeout: 10000 });

  // 在浏览器中执行 DOM 提取
  const events = await page.evaluate(() => {
    return Array.from(document.querySelectorAll(".event-item")).map(el => {
      const getId = () => {
        const link = el.querySelector("a[href*='/event/']");
        const match = link?.getAttribute("href")?.match(/\/event\/(\d+)/);
        return match ? parseInt(match[1]) : 0;
      };

      return {
        id: getId(),
        title: el.querySelector(".event-title")?.textContent?.trim() || "",
        price: el.querySelector(".event-price")?.textContent?.trim() || "",
        showTime: el.querySelector(".event-time")?.textContent?.trim() || "",
        cityName: el.querySelector(".event-city")?.textContent?.trim() || "",
        siteName: el.querySelector(".event-venue")?.textContent?.trim() || "",
        poster: el.querySelector("img")?.getAttribute("src") || "",
        url: `https://www.showstart.com/event/${getId()}`
      };
    });
  });

  await browser.close();
  return events.filter(e => e.id > 0);
}
```

**优势：**
- ✅ 适应 DOM 结构变化
- ✅ 无需 LLM（成本低）
- ❌ 需要维护 CSS 选择器
- ❌ Puppeteer 资源消耗大

#### 3.4 策略 3：LLM 清洗 HTML（终极兜底）

```typescript
import OpenAI from "openai";

async function parseLLMCleanHTML(url: string): Promise<ShowStartEvent[]> {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: "networkidle2" });

  // 获取完整 HTML
  const html = await page.content();
  await browser.close();

  // 压缩 HTML（移除无关内容）
  const cleanedHTML = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .substring(0, 50000);  // 限制长度

  // 让 LLM 提取演出信息
  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL
  });

  const response = await client.chat.completions.create({
    model: "gpt-4-turbo",
    messages: [
      {
        role: "system",
        content: "你是一个 HTML 解析专家。从 HTML 中提取演出信息，返回 JSON 数组。"
      },
      {
        role: "user",
        content: `
从以下 HTML 中提取演出列表，返回 JSON 格式：

HTML:
${cleanedHTML}

返回格式（严格 JSON 数组，不要其他文字）：
[
  {
    "id": 123456,
    "title": "演出标题",
    "price": "¥100-200",
    "showTime": "2026/03/04 20:00",
    "cityName": "上海",
    "siteName": "场馆名称",
    "poster": "图片URL",
    "url": "演出链接"
  }
]
`
      }
    ],
    temperature: 0.1,
    response_format: { type: "json_object" }  // 强制 JSON 输出
  });

  const content = response.choices[0].message.content || "[]";
  const parsed = JSON.parse(content);

  // 如果返回的是对象包裹数组
  const events = Array.isArray(parsed) ? parsed : (parsed.events || []);

  return events;
}
```

**优势：**
- ✅ 终极兜底（什么 DOM 结构都能处理）
- ✅ 适应任何网站改版
- ❌ 成本高（$0.5-2/次）
- ❌ 速度慢（10-30 秒）
- ❌ 可能解析错误

#### 3.5 策略选择逻辑

```typescript
// 配置文件
export const SCRAPER_CONFIG = {
  strategies: [
    { name: "nuxt_ssr", enabled: true, cost: 0, speed: "fast" },
    { name: "puppeteer_dom", enabled: true, cost: 0, speed: "medium" },
    { name: "llm_html", enabled: true, cost: "high", speed: "slow" }
  ],

  // 策略切换阈值
  fallbackAfterFailures: 3,  // 连续失败 3 次后切换策略

  // 自动禁用失败策略
  autoDisableAfter: 10  // 连续失败 10 次后禁用该策略
};
```

**监控与告警：**
```typescript
// 如果使用了 LLM 兜底，发送警告通知
if (result.strategy === "llm_html") {
  await sendTelegram({
    message: `⚠️ 警告：ShowStart 爬虫降级到 LLM 模式

这意味着 Nuxt SSR 解析失败，可能是网站改版。
建议检查 ShowStart 网站是否有变化。

URL: ${url}
成本：约 ¥2/次`,
    priority: "urgent"
  });
}
```

---

## 📊 Phase 3 实施优先级

| 功能 | 优先级 | 复杂度 | 预估时间 | 价值 |
|------|-------|--------|---------|------|
| **上下文管理** | 🔴 高 | 中 | 2-3 天 | 防止超限、降成本 |
| **爬虫兜底** | 🟡 中 | 高 | 3-5 天 | 提升鲁棒性 |
| **Web Search** | 🟢 低 | 低 | 1-2 天 | 增强智能性 |

**建议顺序：**
1. **上下文管理**（先解决技术债务）
2. **爬虫兜底**（提升稳定性）
3. **Web Search**（扩展能力）

---

## 🧪 测试计划

### 上下文管理测试
```bash
# 模拟长时间运行，测试 token 限制
bun run test/context-management.test.ts
```

### 爬虫兜底测试
```bash
# 手动破坏 Nuxt 解析，验证自动切换
bun run test/scraper-fallback.test.ts
```

### Web Search 测试
```bash
# 测试搜索功能
bun run test/websearch.test.ts
```

---

## 📝 文档更新

完成 Phase 3 后需要更新：
- [ ] `README.md` - 更新 Roadmap
- [ ] `docs/phase3-completion.md` - 完成报告
- [ ] `docs/scraper-strategies.md` - 爬虫策略文档
- [ ] `docs/context-management.md` - 上下文管理指南

---

## 💰 成本影响

| 功能 | 当前成本 | Phase 3 后成本 | 变化 |
|------|---------|--------------|------|
| 上下文管理 | ¥0.16/次 | ¥0.10/次 | ✅ -37% |
| Web Search | - | +¥0.02/次 | - |
| 爬虫兜底（正常） | ¥0 | ¥0 | - |
| 爬虫兜底（降级） | - | +¥2/次 | ⚠️ 仅紧急时 |

**预期：**
- 正常运行：¥0.12/次（降低 25%）
- 异常情况：有兜底，不会完全失败

---

## 🎯 成功标准

Phase 3 完成的标志：

- [x] Token 使用量降低 30%+
- [x] 上下文从不超过 100K tokens
- [x] ShowStart 改版后爬虫自动切换策略
- [x] Agent 可以搜索艺人最新动态
- [x] 降级到 LLM 模式时发送告警
- [x] 所有测试通过
- [x] 文档完整

---

## 🔄 与 Phase 2 的关系

Phase 2 实现了 **LLM-driven 自主决策**，Phase 3 则专注于 **优化与扩展**：

- Phase 2: 能力建设（让 Agent 会思考）
- Phase 3: 稳定性提升（让 Agent 更可靠）
- Phase 4: 智能化增强（让 Agent 更聪明）

Phase 3 是承上启下的关键阶段，为未来的高级功能（记忆、对话、学习）打下坚实基础。
