class PuppeteerDebuggerUI {
  constructor() {
    this.ws = null;
    this.isConnected = false;
    this.currentPageId = null;
    this.startConsole = false;
    this.initElements();
    this.bindEvents();
  }

  initElements() {
    this.chromePortInput = document.getElementById("chromePort");
    this.connectBtn = document.getElementById("connectBtn");
    this.statusSpan = document.getElementById("status");
    this.refreshBtn = document.getElementById("refreshBtn");
    this.newPageBtn = document.getElementById("newPageBtn");
    this.pagesList = document.getElementById("pagesList");
    this.codeInput = document.getElementById("codeInput");
    this.runBtn = document.getElementById("runBtn");
    this.resultDiv = document.getElementById("result");
    this.copyResultBtn = document.getElementById("copyResultBtn");
    this.consoleDiv = document.getElementById("console");
    this.clearConsoleBtn = document.getElementById("clearConsoleBtn");
    this.langDisplay = document.getElementById("langDisplay");
  }

  bindEvents() {
    this.connectBtn.addEventListener("click", () => this.toggleConnection());
    this.refreshBtn.addEventListener("click", () => this.listPages());
    this.newPageBtn.addEventListener("click", () => this.createPage());
    this.runBtn.addEventListener("click", () => this.runCode());
    this.clearConsoleBtn.addEventListener("click", () => this.clearConsole());
    this.copyResultBtn.addEventListener("click", () => this.copyResult());
    this.codeInput.addEventListener("keydown", (e) => {
      if (e.ctrlKey && e.key === "Enter") {
        this.runCode();
      }
    });
  }

  toggleConnection() {
    if (this.isConnected) {
      this.disconnect();
    } else {
      this.connect();
    }
  }

  connect() {
    const chromePort = parseInt(this.chromePortInput.value);
    if (!chromePort || chromePort < 1024 || chromePort > 65535) {
      this.showError("请输入有效的Chrome端口号 (1024-65535)");
      return;
    }

    this.setStatus("connecting", "连接中...");
    this.connectBtn.disabled = true;

    // 连接到WebSocket服务器（从配置读取端口）
    const serverPort = window.CONFIG.server.port;
    this.ws = new WebSocket(`ws://${window.CONFIG.server.host}:${serverPort}`);

    this.ws.onopen = () => {
      console.log("Connected to debugger server");
      // 发送连接Chrome的请求，使用用户输入的Chrome端口
      this.sendMessage({ type: "connect", port: chromePort });
    };

    this.ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        this.handleMessage(message);
      } catch (error) {
        console.error("Invalid message:", error);
      }
    };

    this.ws.onclose = () => {
      this.setDisconnected();
    };

    this.ws.onerror = (error) => {
      console.error("WebSocket error:", error);
      this.showError("连接服务器失败");
      this.setDisconnected();
    };
  }

  disconnect() {
    if (this.ws) {
      this.sendMessage({ type: "disconnect" });
      this.ws.close();
      this.ws = null;
    }
    this.setDisconnected();
  }

  setDisconnected() {
    this.isConnected = false;
    this.currentPageId = null;
    this.setStatus("disconnected", "未连接");
    this.connectBtn.textContent = "连接";
    this.connectBtn.disabled = false;
    this.runBtn.disabled = true;
    this.copyResultBtn.disabled = true;
    this.clearConsoleBtn.disabled = true;
    this.startConsole = false;
    this.newPageBtn.disabled = true;
    this.refreshBtn.disabled = true;
    this.clearPages();
    this.clearResult();
    this.clearConsole();
  }

  sendMessage(message) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  handleMessage(message) {
    switch (message.type) {
      case "connected":
        this.handleConnected(message.version);
        break;
      case "disconnected":
        this.setDisconnected();
        break;
      case "pages":
        this.handlePages(message.pages);
        break;
      case "pageCreated":
        this.handlePageCreated(message.page);
        break;
      case "pageSelected":
        this.handlePageSelected(message.pageId);
        break;
      case "pageClosed":
        this.handlePageClosed(message.pageId);
        break;
      case "evalResult":
        this.handleEvalResult(message.result, message.resultType);
        break;
      case "console":
        this.handleConsole(message);
        break;
      case "error":
        this.showError(message.message);
        break;
      default:
        console.log("Unknown message type:", message.type);
    }
  }

  handleConnected(version) {
    this.isConnected = true;
    this.setStatus("connected", `已连接 (${version})`);
    this.connectBtn.textContent = "断开";
    this.connectBtn.disabled = false;
    this.newPageBtn.disabled = false;
    this.refreshBtn.disabled = false;
  }

  handlePages(pages) {
    this.pagesList.innerHTML = "";
    if (pages.length === 0) {
      this.pagesList.innerHTML = '<p class="no-pages">没有找到页面</p>';
      return;
    }

    pages.forEach((page) => {
      this.addPageItem(page);
    });
  }

  addPageItem(page) {
    const item = document.createElement("div");
    item.className = "page-item";
    item.dataset.pageId = page.id;

    if (this.currentPageId === page.id) {
      item.classList.add("selected");
    }

    item.innerHTML = `
      <div class="page-info">
        <div class="page-title">${this.escapeHtml(page.title)}</div>
        <div class="page-url">${this.escapeHtml(page.url)}</div>
      </div>
      <div class="page-actions">
        <button class="btn btn-primary select-btn">选择</button>
        <button class="btn btn-danger close-btn">关闭</button>
      </div>
    `;

    // 绑定事件
    item.querySelector(".select-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      this.selectPage(page.id);
    });

    item.querySelector(".close-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      this.closePage(page.id);
    });

    item.addEventListener("click", () => this.selectPage(page.id));

    this.pagesList.appendChild(item);
  }

  handlePageCreated(page) {
    this.addPageItem(page);
  }

  handlePageSelected(pageId) {
    this.currentPageId = pageId;
    this.runBtn.disabled = false;

    // 更新UI
    document.querySelectorAll(".page-item").forEach((item) => {
      item.classList.toggle("selected", item.dataset.pageId === pageId);
    });
  }

  handlePageClosed(pageId) {
    const item = document.querySelector(`[data-page-id="${pageId}"]`);
    if (item) {
      item.remove();
    }

    if (this.currentPageId === pageId) {
      this.currentPageId = null;
      this.runBtn.disabled = true;
      this.copyResultBtn.disabled = true;
      this.startConsole = false;
      this.clearConsoleBtn.disabled = true;
    }
  }

  handleEvalResult(result, resultType) {
    this.showResult(result, resultType);
    this.runBtn.disabled = false;
  }

  handleConsole(message) {
    this.clearConsoleBtn.disabled = false;
    this.initConsole(message)
    this.addConsoleMessage(message.level, message.text, message.args);
  }

  selectPage(pageId) {
    this.sendMessage({ type: "selectPage", pageId: pageId });
  }

  closePage(pageId) {
    if (confirm("确定要关闭这个页面吗？")) {
      this.sendMessage({ type: "closePage", pageId: pageId });
    }
  }

  createPage() {
    const url = prompt("请输入页面URL (留空则创建空白页面):", "about:blank");
    if (url !== null) {
      this.sendMessage({ type: "createPage", url: url || "about:blank" });
    }
  }

  listPages() {
    this.sendMessage({ type: "listPages" });
  }

  runCode() {
    const code = this.codeInput.value.trim();
    if (!code) {
      this.showError("请输入要执行的代码");
      return;
    }

    // 检测代码类型 (JS/TS)
    const lang = this.detectLanguage(code);
    this.updateLangDisplay(lang);

    // 每次执行前清空结果和控制台
    this.clearResult();
    this.clearConsole();
    this.runBtn.disabled = true;
    this.sendMessage({
      type: "eval",
      code: code,
      lang: lang
    });
  }

  detectLanguage(code) {
    // TypeScript 检测:
    // 1. import/export type 语法
    // 2. 类型注解 :type
    // 3. 接口 interface
    // 4. 泛型 <T>
    // 5. 类型声明 type/enum
    // 6. 访问修饰符 public/private/protected
    // 7. 命名空间 namespace
    // 8. 装饰器 @
    // 9. declare 关键字
    // 10. implements 关键字

    const tsPatterns = [
      /\?\./, // optional chaining
      /\!\./, // non-null assertion
      /\?\?/, // nullish coalescing
      /\s+as\s+\w+/, // type assertion
      /\bsatisfies\b/, // TS 4.9+
      /\bimport\s+type\b/, // type-only import
      /\bexport\s+type\b/, // export type
      /:\s*[A-Z][a-zA-Z]+\b/, // 类型注解 :Type
      /\binterface\s+\w+\s*{?/, // interface
      /\btype\s+\w+\s*=/, // type alias
      /\benum\s+\w+\s*{/, // enum
      /\bclass\s+\w+[^{]*\bimplements\b/, // implements
      /\b(public|private|protected)\s+\w+\s*[:=]/, // 访问修饰符
      /\bnamespace\s+\w+\s*{/, // namespace
      /\bdeclare\s+(class|function|const|module|namespace)\b/, // declare
      /^[ \t]*@\w+/m, // 装饰器
      /<\w+>\s*\(/, // 泛型调用
      /\bconst\s+\w+\s*:\s*[A-Z][a-zA-Z]+\b/, // const 变量有类型注解
      /\bfunction\s+\w+\s*<\w+>\s*\(/, // 泛型函数
      /\b(Array|Map|Set|Promise)<\w+>/, // 泛型类型
      /\b(Partial|Required|Pick|Omit|Record)\b/, // TypeScript 工具类型
    ];

    // 包含多个TS特征，或者包含ts相关文件扩展名
    const tsScore = tsPatterns.reduce(
      (score, pattern) => score + (pattern.test(code) ? 1 : 0),
      0,
    );

    return tsScore >= 1 ? "ts" : "js";
  }

  updateLangDisplay(lang) {
    if (!this.langDisplay) return;
    this.langDisplay.textContent = `(${lang.toUpperCase()})`;
    this.langDisplay.className = `lang-display lang-${lang}`;
  }

  showResult(result, type) {
    this.copyResultBtn.disabled = result===""?true:false;
    this.resultDiv.innerHTML = `<div class="result-${type === "error" ? "error" : "success"}">${this.escapeHtml(result)}</div>`;
    // 当显示结果时启用复制按钮
  }

  clearResult() {
    this.resultDiv.innerHTML =
      '<p class="placeholder">执行结果将显示在这里</p>';
    // 隐藏复制按钮
    this.startConsole = false;
    this.copyResultBtn.disabled = true;
  }

  addConsoleMessage(level, text, args) {
    const messageDiv = document.createElement("div");
    messageDiv.className = `console-message console-${level}`;

    let content = "";
    if (args && args.length > 0) {
      content = args.join(" ");
    } else {
      content = text;
    }

    messageDiv.textContent = `[${level.toUpperCase()}] ${content}`;
    this.consoleDiv.appendChild(messageDiv);
    this.consoleDiv.scrollTop = this.consoleDiv.scrollHeight;
  }
  initConsole(message) {
    if (!this.startConsole) {
      this.startConsole = true;
      this.consoleDiv.innerHTML = "";
    }
  }
  clearConsole() {
    this.clearConsoleBtn.disabled = true;
    this.consoleDiv.innerHTML =
      '<p class="placeholder">控制台消息将显示在这里</p>';
  }

  clearPages() {
    this.pagesList.innerHTML = '<p class="no-pages">未连接到Chrome实例</p>';
  }

  copyResult() {
    const resultElement = this.resultDiv.querySelector(
      ".result-success, .result-error",
    );
    if (!resultElement) {
      this.showError("没有可复制的结果");
      return;
    }
    const resultText = resultElement.textContent;
    /** fallback：HTTP 下也能复制 */
    function fallbackCopy(text) {
      const handler = (e) => {
        e.preventDefault();
        e.clipboardData?.setData("text/plain", text);
        document.removeEventListener("copy", handler);
        alert("兼容方法，复制成功");
      };

      document.addEventListener("copy", handler);
      document.execCommand("copy"); // 仅触发事件
    }
    // 安全上下文才可以使用 navigator.clipboard
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard
        .writeText(resultText)
        .then(() => {
          alert("复制成功");
          // 临时改变按钮文本提供反馈
          const originalText = this.copyResultBtn.title;
          this.copyResultBtn.title = "已复制!";
          setTimeout(() => {
            this.copyResultBtn.title = originalText;
          }, 1500);
        })
        .catch(() => {
          console.log("重试兼容方法");
          fallbackCopy(resultText);
        });
    } else {
      fallbackCopy(resultText);
    }
  }

  setStatus(type, text) {
    this.statusSpan.className = `status ${type}`;
    this.statusSpan.textContent = text;
  }

  showError(message) {
    this.setStatus("error", `错误: ${message}`);
    setTimeout(() => {
      if (!this.isConnected) {
        this.setStatus("disconnected", "未连接");
      } else {
        this.setStatus("connected", "已连接");
      }
    }, 3000);
  }

  escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }
}

// 初始化应用
document.addEventListener("DOMContentLoaded", () => {
  new PuppeteerDebuggerUI();
});
