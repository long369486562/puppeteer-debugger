const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const CDPManager = require('./cdp-manager');

// 读取配置文件
const config = require('../config');

class PuppeteerDebugger {
  constructor() {
    this.wss = null;
    this.cdpManager = new CDPManager();
    this.clients = new Set();
    this.currentTargetId = null;

    this.setupCDPListeners();
  }

  setupCDPListeners() {
    this.cdpManager.onConsole((message) => {
      this.broadcast({
        type: 'console',
        level: message.level,
        text: message.text,
        args: message.args || []
      });
    });
  }

  start(port = config.server.port) {
    // 创建HTTP服务器提供静态文件
    const server = http.createServer((req, res) => {
      let filePath = path.join(__dirname, '..', 'ui', req.url === '/' ? 'index.html' : req.url);

      // 安全检查：只允许访问ui目录下的文件
      const uiDir = path.join(__dirname, '..', 'ui');
      if (!filePath.startsWith(uiDir)) {
        res.writeHead(403);
        res.end('Access denied');
        return;
      }

      fs.readFile(filePath, (err, data) => {
        if (err) {
          if (err.code === 'ENOENT') {
            res.writeHead(404);
            res.end('File not found');
          } else {
            res.writeHead(500);
            res.end('Internal server error');
          }
          return;
        }

        // 设置正确的Content-Type
        const ext = path.extname(filePath);
        const contentType = {
          '.html': 'text/html',
          '.css': 'text/css',
          '.js': 'text/javascript'
        }[ext] || 'text/plain';

        res.writeHead(200, { 'Content-Type': contentType });
        res.end(data);
      });
    });

    // 启动HTTP服务器
    server.listen(port, () => {
      console.log(`Puppeteer Debugger HTTP server started on http://localhost:${port}`);
    });

    // 创建WebSocket服务器，附加到HTTP服务器
    this.wss = new WebSocket.Server({ server });

    console.log(`Puppeteer Debugger WebSocket server started on ws://localhost:${port}`);

    this.wss.on('connection', (ws) => {
      this.clients.add(ws);

      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleMessage(ws, message);
        } catch (error) {
          console.error('Invalid message:', error);
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Invalid JSON message'
          }));
        }
      });

      ws.on('close', () => {
        this.clients.delete(ws);
      });

      ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        this.clients.delete(ws);
      });
    });
  }

  async handleMessage(ws, message) {
    try {
      switch (message.type) {
        case 'connect':
          await this.handleConnect(ws, message.port);
          break;
        case 'disconnect':
          await this.handleDisconnect(ws);
          break;
        case 'listPages':
          await this.handleListPages(ws);
          break;
        case 'createPage':
          await this.handleCreatePage(ws, message.url);
          break;
        case 'selectPage':
          await this.handleSelectPage(ws, message.pageId);
          break;
        case 'closePage':
          await this.handleClosePage(ws, message.pageId);
          break;
        case 'eval':
          await this.handleEval(ws, message.code);
          break;
        default:
          ws.send(JSON.stringify({
            type: 'error',
            message: `Unknown message type: ${message.type}`
          }));
      }
    } catch (error) {
      console.error('Message handling error:', error);
      ws.send(JSON.stringify({
        type: 'error',
        message: error.message
      }));
    }
  }

  async handleConnect(ws, port) {
    try {
      const version = await this.cdpManager.connect(port);
      ws.send(JSON.stringify({
        type: 'connected',
        version: version
      }));

      // 自动获取页面列表
      await this.handleListPages(ws);
    } catch (error) {
      ws.send(JSON.stringify({
        type: 'error',
        message: `Connection failed: ${error.message}`
      }));
    }
  }

  async handleDisconnect(ws) {
    try {
      await this.cdpManager.disconnect();
      this.currentTargetId = null;
      ws.send(JSON.stringify({
        type: 'disconnected'
      }));
    } catch (error) {
      ws.send(JSON.stringify({
        type: 'error',
        message: `Disconnect failed: ${error.message}`
      }));
    }
  }

  async handleListPages(ws) {
    try {
      const targets = await this.cdpManager.getTargets();
      const pages = targets.map(target => ({
        id: target.targetId,
        url: target.url,
        title: target.title || 'Untitled'
      }));

      ws.send(JSON.stringify({
        type: 'pages',
        pages: pages
      }));
    } catch (error) {
      ws.send(JSON.stringify({
        type: 'error',
        message: `Failed to list pages: ${error.message}`
      }));
    }
  }

  async handleCreatePage(ws, url = 'about:blank') {
    try {
      const target = await this.cdpManager.createTarget(url);
      ws.send(JSON.stringify({
        type: 'pageCreated',
        page: {
          id: target.targetId,
          url: target.url,
          title: target.title || 'Untitled'
        }
      }));

      // 刷新页面列表
      await this.handleListPages(ws);
    } catch (error) {
      ws.send(JSON.stringify({
        type: 'error',
        message: `Failed to create page: ${error.message}`
      }));
    }
  }

  async handleSelectPage(ws, pageId) {
    try {
      // 验证页面是否存在
      const targets = await this.cdpManager.getTargets();
      const target = targets.find(t => t.targetId === pageId);

      if (!target) {
        throw new Error('Page not found');
      }

      this.currentTargetId = pageId;

      // 确保控制台监听器已设置
      const page = await this.cdpManager.getPageById(pageId);
      if (page) {
        this.cdpManager.setupConsoleListener(page, pageId);
      }

      ws.send(JSON.stringify({
        type: 'pageSelected',
        pageId: pageId
      }));
    } catch (error) {
      ws.send(JSON.stringify({
        type: 'error',
        message: `Failed to select page: ${error.message}`
      }));
    }
  }

  async handleClosePage(ws, pageId) {
    try {
      await this.cdpManager.closeTarget(pageId);

      if (this.currentTargetId === pageId) {
        this.currentTargetId = null;
      }

      ws.send(JSON.stringify({
        type: 'pageClosed',
        pageId: pageId
      }));

      // 刷新页面列表
      await this.handleListPages(ws);
    } catch (error) {
      ws.send(JSON.stringify({
        type: 'error',
        message: `Failed to close page: ${error.message}`
      }));
    }
  }

  async handleEval(ws, code) {
    try {
      if (!this.currentTargetId) {
        throw new Error('No page selected');
      }

      const result = await this.cdpManager.evaluateCode(this.currentTargetId, code);

      // 处理异步结果（如果是Promise，需要等待）
      const finalResult = result instanceof Promise ? await result : result;

      // 发送执行结果
      ws.send(JSON.stringify({
        type: 'evalResult',
        result: this.formatResult(finalResult.result),
        resultType: typeof finalResult.result
      }));

      // 如果有捕获的console日志，逐个发送
      if (finalResult.logs && finalResult.logs.length > 0) {
        finalResult.logs.forEach(log => {
          ws.send(JSON.stringify({
            type: 'console',
            level: log.level,
            text: log.args.join(' '),
            args: log.args
          }));
        });
      }
    } catch (error) {
      ws.send(JSON.stringify({
        type: 'error',
        message: `Evaluation failed: ${error.message}`
      }));
    }
  }

  formatResult(result) {
    if (result === null || result === undefined) {
      return String(result);
    }

    if (typeof result === 'object') {
      try {
        return JSON.stringify(result, null, 2);
      } catch {
        return String(result);
      }
    }

    return String(result);
  }

  broadcast(message) {
    const data = JSON.stringify(message);
    this.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    });
  }
}

// 启动服务器
if (require.main === module) {
  const puppeteerDebugger = new PuppeteerDebugger();
  puppeteerDebugger.start();
}

module.exports = PuppeteerDebugger;