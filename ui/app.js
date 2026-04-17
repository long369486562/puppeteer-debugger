class PuppeteerDebuggerUI {
  constructor() {
    this.ws = null;
    this.isConnected = false;
    this.currentPageId = null;

    this.initElements();
    this.bindEvents();
  }

  initElements() {
    this.chromePortInput = document.getElementById('chromePort');
    this.connectBtn = document.getElementById('connectBtn');
    this.statusSpan = document.getElementById('status');
    this.refreshBtn = document.getElementById('refreshBtn');
    this.newPageBtn = document.getElementById('newPageBtn');
    this.pagesList = document.getElementById('pagesList');
    this.codeInput = document.getElementById('codeInput');
    this.runBtn = document.getElementById('runBtn');
    this.resultDiv = document.getElementById('result');
    this.consoleDiv = document.getElementById('console');
    this.clearConsoleBtn = document.getElementById('clearConsoleBtn');
  }

  bindEvents() {
    this.connectBtn.addEventListener('click', () => this.toggleConnection());
    this.refreshBtn.addEventListener('click', () => this.listPages());
    this.newPageBtn.addEventListener('click', () => this.createPage());
    this.runBtn.addEventListener('click', () => this.runCode());
    this.clearConsoleBtn.addEventListener('click', () => this.clearConsole());
    this.codeInput.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.key === 'Enter') {
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
      this.showError('请输入有效的Chrome端口号 (1024-65535)');
      return;
    }

    this.setStatus('connecting', '连接中...');
    this.connectBtn.disabled = true;

    // 连接到WebSocket服务器（从配置读取端口）
    const serverPort = window.CONFIG.server.port;
    this.ws = new WebSocket(`ws://${window.CONFIG.server.host}:${serverPort}`);

    this.ws.onopen = () => {
      console.log('Connected to debugger server');
      // 发送连接Chrome的请求，使用用户输入的Chrome端口
      this.sendMessage({ type: 'connect', port: chromePort });
    };

    this.ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        this.handleMessage(message);
      } catch (error) {
        console.error('Invalid message:', error);
      }
    };

    this.ws.onclose = () => {
      this.setDisconnected();
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      this.showError('连接服务器失败');
      this.setDisconnected();
    };
  }

  disconnect() {
    if (this.ws) {
      this.sendMessage({ type: 'disconnect' });
      this.ws.close();
      this.ws = null;
    }
    this.setDisconnected();
  }

  setDisconnected() {
    this.isConnected = false;
    this.currentPageId = null;
    this.setStatus('disconnected', '未连接');
    this.connectBtn.textContent = '连接';
    this.connectBtn.disabled = false;
    this.runBtn.disabled = true;
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
      case 'connected':
        this.handleConnected(message.version);
        break;
      case 'disconnected':
        this.setDisconnected();
        break;
      case 'pages':
        this.handlePages(message.pages);
        break;
      case 'pageCreated':
        this.handlePageCreated(message.page);
        break;
      case 'pageSelected':
        this.handlePageSelected(message.pageId);
        break;
      case 'pageClosed':
        this.handlePageClosed(message.pageId);
        break;
      case 'evalResult':
        this.handleEvalResult(message.result, message.resultType);
        break;
      case 'console':
        this.handleConsole(message);
        break;
      case 'error':
        this.showError(message.message);
        break;
      default:
        console.log('Unknown message type:', message.type);
    }
  }

  handleConnected(version) {
    this.isConnected = true;
    this.setStatus('connected', `已连接 (${version})`);
    this.connectBtn.textContent = '断开';
    this.connectBtn.disabled = false;
    this.newPageBtn.disabled = false;
    this.refreshBtn.disabled = false;
  }

  handlePages(pages) {
    this.pagesList.innerHTML = '';
    if (pages.length === 0) {
      this.pagesList.innerHTML = '<p class="no-pages">没有找到页面</p>';
      return;
    }

    pages.forEach(page => {
      this.addPageItem(page);
    });
  }

  addPageItem(page) {
    const item = document.createElement('div');
    item.className = 'page-item';
    item.dataset.pageId = page.id;

    if (this.currentPageId === page.id) {
      item.classList.add('selected');
    }

    item.innerHTML = `
      <div class="page-info">
        <div class="page-title">${this.escapeHtml(page.title)}</div>
        <div class="page-url">${this.escapeHtml(page.url)}</div>
      </div>
      <div class="page-actions">
        <button class="btn btn-primary btn-sm select-btn">选择</button>
        <button class="btn btn-danger btn-sm close-btn">关闭</button>
      </div>
    `;

    // 绑定事件
    item.querySelector('.select-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      this.selectPage(page.id);
    });

    item.querySelector('.close-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      this.closePage(page.id);
    });

    item.addEventListener('click', () => this.selectPage(page.id));

    this.pagesList.appendChild(item);
  }

  handlePageCreated(page) {
    this.addPageItem(page);
  }

  handlePageSelected(pageId) {
    this.currentPageId = pageId;
    this.runBtn.disabled = false;

    // 更新UI
    document.querySelectorAll('.page-item').forEach(item => {
      item.classList.toggle('selected', item.dataset.pageId === pageId);
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
    }
  }

  handleEvalResult(result, resultType) {
    this.showResult(result, resultType);
  }

  handleConsole(message) {
    this.addConsoleMessage(message.level, message.text, message.args);
  }

  selectPage(pageId) {
    this.sendMessage({ type: 'selectPage', pageId: pageId });
  }

  closePage(pageId) {
    if (confirm('确定要关闭这个页面吗？')) {
      this.sendMessage({ type: 'closePage', pageId: pageId });
    }
  }

  createPage() {
    const url = prompt('请输入页面URL (留空则创建空白页面):', 'about:blank');
    if (url !== null) {
      this.sendMessage({ type: 'createPage', url: url || 'about:blank' });
    }
  }

  listPages() {
    this.sendMessage({ type: 'listPages' });
  }

  runCode() {
    const code = this.codeInput.value.trim();
    if (!code) {
      this.showError('请输入要执行的代码');
      return;
    }

    // 每次执行前清空结果和控制台
    this.clearResult();
    this.clearConsole();

    // 检查代码类型并给出提示
    const puppeteerApis = ['page\\.', 'browser\\.', 'await page\\.', 'await browser\\.'];
    const isPuppeteerCode = puppeteerApis.some(api => new RegExp(api).test(code));

    this.sendMessage({ type: 'eval', code: code, isPuppeteerCode: isPuppeteerCode });
  }

  showResult(result, type) {
    this.resultDiv.innerHTML = `<div class="result-${type === 'error' ? 'error' : 'success'}">${this.escapeHtml(result)}</div>`;
  }

  clearResult() {
    this.resultDiv.innerHTML = '<p class="placeholder">执行结果将显示在这里</p>';
  }

  addConsoleMessage(level, text, args) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `console-message console-${level}`;

    let content = '';
    if (args && args.length > 0) {
      content = args.join(' ');
    } else {
      content = text;
    }

    messageDiv.textContent = `[${level.toUpperCase()}] ${content}`;
    this.consoleDiv.appendChild(messageDiv);
    this.consoleDiv.scrollTop = this.consoleDiv.scrollHeight;
  }

  clearConsole() {
    this.consoleDiv.innerHTML = '<p class="placeholder">控制台消息将显示在这里</p>';
  }

  clearPages() {
    this.pagesList.innerHTML = '<p class="no-pages">未连接到Chrome实例</p>';
  }

  setStatus(type, text) {
    this.statusSpan.className = `status ${type}`;
    this.statusSpan.textContent = text;
  }

  showError(message) {
    this.setStatus('error', `错误: ${message}`);
    setTimeout(() => {
      if (!this.isConnected) {
        this.setStatus('disconnected', '未连接');
      } else {
        this.setStatus('connected', '已连接');
      }
    }, 3000);
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// 初始化应用
document.addEventListener('DOMContentLoaded', () => {
  new PuppeteerDebuggerUI();
});