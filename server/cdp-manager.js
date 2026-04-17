const puppeteer = require('puppeteer-core');

class CDPManager {
  constructor() {
    this.browser = null;
    this.pages = new Map();
    this.consoleCallback = null;
  }

  async connect(port) {
    try {
      this.browser = await puppeteer.connect({
        browserURL: `http://localhost:${port}`,
        defaultViewport: null
      });

      const version = await this.browser.version();
      console.log(`Connected to Chrome ${version}`);

      // 监听目标创建和销毁
      this.browser.on('targetcreated', (target) => {
        console.log(`Target created: ${target.url()}`);
      });

      this.browser.on('targetdestroyed', (target) => {
        console.log(`Target destroyed: ${target.url()}`);
        this.pages.delete(target._targetId);
      });

      return version;
    } catch (error) {
      throw new Error(`Failed to connect to Chrome on port ${port}: ${error.message}`);
    }
  }

  async disconnect() {
    if (this.browser) {
      await this.browser.disconnect();
      this.browser = null;
      this.pages.clear();
      console.log('Disconnected from Chrome');
    }
  }

  async getTargets() {
    if (!this.browser) {
      throw new Error('Not connected to Chrome');
    }

    const targets = [];
    for (const target of this.browser.targets()) {
      if (target.type() === 'page') {
        targets.push({
          targetId: target._targetId,
          url: target.url(),
          title: await this.getPageTitle(target)
        });
      }
    }
    return targets;
  }

  async getPageTitle(target) {
    try {
      const page = await target.page();
      return await page.title();
    } catch {
      return 'Untitled';
    }
  }

  async createTarget(url = 'about:blank') {
    if (!this.browser) {
      throw new Error('Not connected to Chrome');
    }

    const page = await this.browser.newPage();
    await page.goto(url);

    const target = page.target();
    this.pages.set(target._targetId, page);

    // 设置控制台监听
    this.setupConsoleListener(page, target._targetId);

    return {
      targetId: target._targetId,
      url: url,
      title: await page.title()
    };
  }

  async closeTarget(targetId) {
    if (!this.browser) {
      throw new Error('Not connected to Chrome');
    }

    const page = this.pages.get(targetId);
    if (page) {
      await page.close();
      this.pages.delete(targetId);
    } else {
      // 尝试通过browser关闭
      const targets = this.browser.targets();
      const target = targets.find(t => t._targetId === targetId);
      if (target) {
        await target.page().then(page => page.close());
      }
    }
  }

  async evaluateCode(targetId, code) {
    if (!this.browser) {
      throw new Error('Not connected to Chrome');
    }

    let page = this.pages.get(targetId);
    if (!page) {
      // 尝试获取页面
      const targets = this.browser.targets();
      const target = targets.find(t => t._targetId === targetId);
      if (!target) {
        throw new Error('Page not found');
      }
      page = await target.page();
      this.pages.set(targetId, page);
    }

    // 确保控制台监听器已设置
    this.setupConsoleListener(page, targetId);

    // === 代码执行环境分析 ===
    const puppeteerApis = ['page\\.', 'browser\\.', '\\bpage\\s*=', '\\bbrowser\\s*='];
    const isPuppeteerCode = puppeteerApis.some(api => new RegExp(api).test(code));
    const hasAsync = /\b(await|async)\b/.test(code);

    console.log(`Code execution analysis: Puppeteer=${isPuppeteerCode}, Async=${hasAsync}`);

    try {
      if (isPuppeteerCode) {
        // === Node.js环境：执行Puppeteer代码 ===
        return await this.executePuppeteerCode(code, page);
      } else {
        // === 浏览器环境：执行JavaScript代码 ===
        return await this.executeBrowserCode(code, page, hasAsync);
      }
    } catch (error) {
      throw new Error(`Evaluation error: ${error.message}`);
    }
  }

  setupConsoleListener(page, targetId) {
    // 移除现有的监听器（如果有）
    page.removeAllListeners('console');

    // 设置console监听器
    page.on('console', async (msg) => {
      if (this.consoleCallback) {
        try {
          const args = [];
          for (let i = 0; i < msg.args().length; i++) {
            try {
              const arg = msg.args()[i];
              if (arg) {
                args.push(await arg.jsonValue().catch(() => arg.toString()));
              }
            } catch (e) {
              args.push('[object]');
            }
          }

          // 发送到前端
          this.consoleCallback({
            level: msg.type() || 'log',
            text: msg.text(),
            args: args
          });
        } catch (error) {
          console.error('Error processing console message:', error);
        }
      }
    });
  }

  onConsole(callback) {
    this.consoleCallback = callback;
  }

  async getPageById(targetId) {
    let page = this.pages.get(targetId);
    if (!page) {
      const targets = this.browser.targets();
      const target = targets.find(t => t._targetId === targetId);
      if (target) {
        page = await target.page();
        this.pages.set(targetId, page);
      }
    }
    return page;
  }

  /**
   * 在Node.js环境中执行Puppeteer代码
   */
  async executePuppeteerCode(code, page) {
    console.log('🔧 Executing Puppeteer code in Node.js environment');

    const logs = [];
    const originalConsoleLog = console.log;
    const originalConsoleInfo = console.info;
    const originalConsoleWarn = console.warn;
    const originalConsoleError = console.error;

    // 重写Node.js的console方法来捕获输出
    console.log = (...args) => {
      logs.push({ level: 'log', args: args.map(arg => String(arg)) });
      originalConsoleLog.apply(console, args);
    };

    console.info = (...args) => {
      logs.push({ level: 'info', args: args.map(arg => String(arg)) });
      originalConsoleInfo.apply(console, args);
    };

    console.warn = (...args) => {
      logs.push({ level: 'warn', args: args.map(arg => String(arg)) });
      originalConsoleWarn.apply(console, args);
    };

    console.error = (...args) => {
      logs.push({ level: 'error', args: args.map(arg => String(arg)) });
      originalConsoleError.apply(console, args);
    };

    try {
      const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
      const fn = new AsyncFunction('page', 'browser', code);
      const result = await fn(page, this.browser);

      // 过滤Chrome内部日志
      const filteredLogs = logs.filter(log => {
        const message = log.args.join(' ');
        return !message.includes('onbeforeunload save spyCache') &&
               !message.includes('Extension context invalidated') &&
               !message.includes('chrome-extension://') &&
               !message.startsWith('DevTools') &&
               !message.includes('webNavigation');
      });

      return { result, logs: filteredLogs };
    } catch (error) {
      // 恢复原始console方法
      console.log = originalConsoleLog;
      console.info = originalConsoleInfo;
      console.warn = originalConsoleWarn;
      console.error = originalConsoleError;
      throw new Error(`Puppeteer execution error: ${error.message}`);
    } finally {
      // 恢复原始console方法
      console.log = originalConsoleLog;
      console.info = originalConsoleInfo;
      console.warn = originalConsoleWarn;
      console.error = originalConsoleError;
    }
  }

  /**
   * 在浏览器环境中执行JavaScript代码
   */
  async executeBrowserCode(code, page, hasAsync) {
    console.log(`🔧 Executing browser code (${hasAsync ? 'async' : 'sync'})`);

    if (hasAsync) {
      // 异步浏览器代码
      const result = await page.evaluate(`(async () => {
        const originalConsoleLog = console.log;
        const originalConsoleInfo = console.info;
        const originalConsoleWarn = console.warn;
        const originalConsoleError = console.error;

        const logs = [];

        console.log = (...args) => {
          logs.push({ level: 'log', args: args.map(arg => String(arg)) });
          originalConsoleLog.apply(console, args);
        };

        console.info = (...args) => {
          logs.push({ level: 'info', args: args.map(arg => String(arg)) });
          originalConsoleInfo.apply(console, args);
        };

        console.warn = (...args) => {
          logs.push({ level: 'warn', args: args.map(arg => String(arg)) });
          originalConsoleWarn.apply(console, args);
        };

        console.error = (...args) => {
          logs.push({ level: 'error', args: args.map(arg => String(arg)) });
          originalConsoleError.apply(console, args);
        };

        try {
          ${code}
        } catch (error) {
          logs.push({ level: 'error', args: ['Execution error: ' + error.message] });
        }

        return logs;
      })()`);

      // 过滤Chrome内部日志
      const filteredLogs = result.filter(log => {
        const message = log.args.join(' ');
        return !message.includes('onbeforeunload save spyCache') &&
               !message.includes('Extension context invalidated') &&
               !message.includes('chrome-extension://') &&
               !message.startsWith('DevTools') &&
               !message.includes('webNavigation');
      });

      return { result: undefined, logs: filteredLogs };
    } else {
      // 同步浏览器代码
      const result = await page.evaluate(`(() => {
        const originalConsoleLog = console.log;
        const originalConsoleInfo = console.info;
        const originalConsoleWarn = console.warn;
        const originalConsoleError = console.error;

        const logs = [];

        console.log = (...args) => {
          logs.push({ level: 'log', args: args.map(arg => String(arg)) });
          originalConsoleLog.apply(console, args);
        };

        console.info = (...args) => {
          logs.push({ level: 'info', args: args.map(arg => String(arg)) });
          originalConsoleInfo.apply(console, args);
        };

        console.warn = (...args) => {
          logs.push({ level: 'warn', args: args.map(arg => String(arg)) });
          originalConsoleWarn.apply(console, args);
        };

        console.error = (...args) => {
          logs.push({ level: 'error', args: args.map(arg => String(arg)) });
          originalConsoleError.apply(console, args);
        };

        try {
          const userResult = (() => {
            ${code}
          })();
          return { result: userResult, logs: logs };
        } catch (error) {
          logs.push({ level: 'error', args: ['Execution error: ' + error.message] });
          return { result: undefined, logs: logs };
        }
      })()`);

      // 过滤Chrome内部日志
      const filteredLogs = (result ? result.logs : []).filter(log => {
        const message = log.args.join(' ');
        return !message.includes('onbeforeunload save spyCache') &&
               !message.includes('Extension context invalidated') &&
               !message.includes('chrome-extension://') &&
               !message.startsWith('DevTools') &&
               !message.includes('webNavigation');
      });

      return {
        result: result ? result.result : undefined,
        logs: filteredLogs
      };
    }
  }
}

module.exports = CDPManager;