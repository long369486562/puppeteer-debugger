# Puppeteer Debugger

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

一个现代化的Web UI调试工具，用于连接Chrome DevTools Protocol (CDP)并实时执行JavaScript/TypeScript代码。支持两种代码执行模式：浏览器上下文和Puppeteer API，所有代码均生成临时ES模块由Bun直接执行，支持import引用项目模块。

## ✨ 功能特性

- 🔗 **CDP连接**: 连接到运行中的Chrome实例
- 📄 **页面管理**: 查看、创建、切换浏览器页面
- 💻 **双模式执行**: 支持浏览器JS/TS和Puppeteer API，代码自动生成临时ES模块由Bun执行
- 📝 **实时输出**: 显示执行结果和控制台日志
- 🎨 **现代化UI**: 响应式设计，简洁美观
- ⚡ **高性能**: WebSocket实时通信，毫秒级响应

## 🚀 快速开始

### 安装依赖

```bash
bun install
```

### 启动调试器

```bash
bun start
```

服务器将在 http://localhost:9000 启动。

### 使用方法

1. **启动Chrome实例**（可选）：
   ```bash
   # 如果你没有运行中的Chrome实例，可以启动一个
   google-chrome --remote-debugging-port=9555 --user-data-dir=/tmp/chrome-debug
   ```

2. 打开浏览器访问 http://localhost:9000
3. 在"Chrome端口"输入框中输入Chrome调试端口（默认9555）
4. 点击"连接"按钮
5. 开始调试！

- 🔤 **多语言支持**: 自动识别JavaScript/TypeScript，支持`@projectRoot`指令引用项目模块

## 📖 代码执行模式

所有代码均由代码预处理器（`code-preprocessor.ts`）自动分析，生成临时ES模块文件后由Bun运行时直接执行。

### 🖥️ 浏览器上下文代码
在页面中执行原生JavaScript/TypeScript，访问浏览器API：

```javascript
// 页面导航
window.location.href = "https://example.com";

// DOM操作
document.body.innerHTML = "<h1>Hello World</h1>";

// 事件处理
document.addEventListener('click', () => console.log('Clicked!'));

// 控制台输出
console.log("Hello from browser context");
```

### ⚙️ Puppeteer API代码
直接使用Puppeteer API，像在Node.js脚本中一样：

```javascript
// 页面导航
await page.goto("https://example.com", {
  waitUntil: 'domcontentloaded',
  timeout: 30000
});

// 截图
await page.screenshot({ path: 'screenshot.png' });

// 元素操作
await page.click('button');
await page.type('input[name="q"]', 'search term');

// 获取页面信息
const title = await page.title();
const url = page.url();
console.log("Page:", title, url);
```

### 📂 @projectRoot 指令

通过在代码首行添加 `// @projectRoot <项目路径>` 指令，可以直接 import 开发中的项目文件进行实时测试，无需构建或发布：

```javascript
// @projectRoot D:/my-project/src
import { myFunction } from './utils/helper';
import { UserAPI } from './api/user';

// 直接调用开发中的代码，修改源码后重新执行即可验证
const result = await myFunction('test');
console.log(result);
```

预处理器会自动将 `./utils/helper` 等相对路径重写为绝对 `file://` URL，使 Bun 运行时能正确解析项目模块。



```
┌─────────────┐    WebSocket    ┌─────────────┐    CDP    ┌─────────────┐
│   Web UI    │◄──────────────►│ Bun Server  │◄────────►│   Chrome    │
│             │   JSON消息       │             │           │   Browser   │
└─────────────┘                 └─────────────┘           └─────────────┘
```

- **前端**: 原生HTML/CSS/JavaScript，无框架依赖
- **后端**: Bun + TypeScript + puppeteer-core + ws
- **通信**: WebSocket + JSON-RPC风格消息协议
- **调试**: Chrome DevTools Protocol (CDP)

## ⚙️ 配置

编辑 `src/config.ts` 文件自定义设置：

```typescript
const config = {
  server: {
    port: 9000,      // Web服务器端口
    host: 'localhost'
  },
  chrome: {
    defaultPort: 9555  // Chrome调试端口
  }
};

export default config;
```

## 📁 项目结构

```
puppeteerDebugger/
├── package.json              # 项目依赖
├── tsconfig.json             # TypeScript配置
├── README.md                 # 文档
├── src/
│   ├── config.ts             # 配置文件
│   ├── server/
│   │   ├── index.ts          # WebSocket服务器主文件
│   │   ├── cdp-manager.ts    # CDP连接管理器
│   │   └── code-preprocessor.ts  # 代码预处理器
│   └── ui/
│       ├── index.html        # 主页面HTML
│       ├── style.css         # 样式文件
│       └── app.js            # 前端交互逻辑
└── 显式启动.vbs              # Windows快捷启动脚本
```

## 🔧 开发

```bash
# 安装依赖
bun install

# 启动开发服务器
bun run dev

# 启动生产服务器
bun start

# 类型检查
bun run tscheck
```

## 📋 通信协议

### 客户端 → 服务器

```json
{"type": "connect", "port": 9555}
{"type": "disconnect"}
{"type": "listPages"}
{"type": "createPage"}
{"type": "selectPage", "pageId": "targetId"}
{"type": "closePage", "pageId": "targetId"}
{"type": "eval", "code": "console.log('hello')", "lang": "js"}
```

### 服务器 → 客户端

```json
{"type": "connected", "version": "Chrome/114.0"}
{"type": "disconnected"}
{"type": "pages", "pages": [{"id": "id1", "url": "url", "title": "title"}]}
{"type": "pageCreated", "page": {"id": "id", "url": "url", "title": "title"}}
{"type": "pageSelected", "pageId": "targetId"}
{"type": "evalResult", "result": "value", "resultType": "string"}
{"type": "console", "level": "log", "text": "message", "args": ["arg1", "arg2"]}
{"type": "error", "message": "error description"}
```

## 🤝 贡献

欢迎提交Issue和Pull Request！

### 开发设置

1. 克隆项目
   ```bash
   git clone https://github.com/long369486562/puppeteer-debugger.git
   cd puppeteer-debugger
   ```

2. 安装依赖
   ```bash
   bun install
   ```

3. 启动开发服务器
   ```bash
   bun start
   ```

4. 打开 http://localhost:9000 开始开发

### 贡献步骤

1. Fork 本项目
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 创建 Pull Request

## 📄 许可证

本项目采用 MIT 许可证 - 查看 [LICENSE](LICENSE) 文件了解详情。

## 🙏 致谢

- [Puppeteer](https://pptr.dev/) - 浏览器自动化框架
- [Chrome DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/) - 调试协议
- [Bun](https://bun.sh/) - JavaScript运行时

---

**如果这个项目对你有帮助，请给它一个⭐ Star！**