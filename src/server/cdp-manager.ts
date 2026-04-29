import puppeteer from 'puppeteer-core';
import type { Browser, Page, Target } from 'puppeteer-core';
declare module "puppeteer-core" {
  interface Target {
    _targetId: string;
  }
}
interface TargetInfo {
  targetId: string;
  url: string;
  title: string;
}

interface ConsoleMessage {
  level: string;
  text: string;
  args: any[];
}

interface CodeExecutionResult {
  result: any;
  logs: Array<{
    level: string;
    args: string[];
  }>;
}

class CDPManager {
  private browser: Browser | null;
  private pages: Map<string, Page>;
  private consoleCallback: ((message: ConsoleMessage) => void) | null;

  constructor() {
    this.browser = null;
    this.pages = new Map();
    this.consoleCallback = null;
  }

  async connect(port: number): Promise<string> {
    try {
      this.browser = await puppeteer.connect({
        browserURL: `http://localhost:${port}`,
        defaultViewport: null,
      });

      const version = await this.browser.version();
      console.log(`Connected to Chrome ${version}`);

      // Listen for target creation and destruction
      this.browser.on('targetcreated', (target) => {
        console.log(`Target created: ${target.url()}`);
      });

      this.browser.on('targetdestroyed', (target) => {
        console.log(`Target destroyed: ${target.url()}`);

        this.pages.delete(target._targetId);
      });

      return version;
    } catch (error: any) {
      throw new Error(
        `Failed to connect to Chrome on port ${port}: ${error.message}`,
      );
    }
  }

  async disconnect(): Promise<void> {
    if (this.browser) {
      await this.browser.disconnect();
      this.browser = null;
      this.pages.clear();
      console.log('Disconnected from Chrome');
    }
  }

  async getTargets(): Promise<TargetInfo[]> {
    if (!this.browser) {
      throw new Error('Not connected to Chrome');
    }

    const targets: TargetInfo[] = [];
    for (const target of this.browser.targets()) {
      if (target.type() === 'page') {
        const url = target.url();
        // Return only real web pages, filter out system pages like devtools
        // Allow http/https protocols and about:blank
        if (
          url.startsWith('http://') ||
          url.startsWith('https://') ||
          url === 'about:blank'
        ) {
          targets.push({
            targetId: target._targetId,
            url: url,
            title: await this.getPageTitle(target),
          });
        }
      }
    }
    return targets;
  }

  private async getPageTitle(target: Target): Promise<string> {
    try {
      const page = await target.page();
      return await page!.title();
    } catch {
      return 'Untitled';
    }
  }

  async createTarget(url: string = 'about:blank'): Promise<TargetInfo> {
    if (!this.browser) {
      throw new Error('Not connected to Chrome');
    }

    const page = await this.browser.newPage();
    await page.goto(url);

    const target = page.target();
    this.pages.set(target._targetId, page);

    // Set up console listener
    this.setupConsoleListener(page, target._targetId);

    return {
      targetId: target._targetId,
      url: url,
      title: await page.title(),
    };
  }

  async closeTarget(targetId: string): Promise<void> {
    if (!this.browser) {
      throw new Error('Not connected to Chrome');
    }

    const page = this.pages.get(targetId);
    if (page) {
      await page.close();
      this.pages.delete(targetId);
    } else {
      // Try to close via browser
      const targets = this.browser.targets();
      const target = targets.find((t) => t._targetId === targetId);
      if (target) {
        const targetPage = await target.page();
        if (targetPage) {
          await targetPage.close();
        }
      }
    }
  }

  async evaluateCode(
    targetId: string,
    code: string,
  ): Promise<CodeExecutionResult> {
    if (!this.browser) {
      throw new Error('Not connected to Chrome');
    }

    let page = this.pages.get(targetId)!;
    if (!page) {
      // Try to get the page
      const targets = this.browser.targets();
      const target = targets.find((t) => t._targetId === targetId);
      if (!target) {
        throw new Error('Page not found');
      }
      page = (await target.page())!;
      this.pages.set(targetId, page);
    }

    // Ensure console listener is set up
    this.setupConsoleListener(page, targetId);

    // === Code execution environment analysis ===
    const puppeteerApis = [
      'page\\.',
      'browser\\.',
      '\\bpage\\s*=',
      '\\bbrowser\\s*=',
    ];
    const isPuppeteerCode = puppeteerApis.some((api) =>
      new RegExp(api).test(code),
    );
    const hasAsync = /\b(await|async)\b/.test(code);

    console.log(
      `Code execution analysis: Puppeteer=${isPuppeteerCode}, Async=${hasAsync}`,
    );

    try {
      if (isPuppeteerCode) {
        // === Node.js environment: Execute Puppeteer code ===
        return await this.executePuppeteerCode(code, page);
      } else {
        // === Browser environment: Execute JavaScript code ===
        return await this.executeBrowserCode(code, page, hasAsync);
      }
    } catch (error: any) {
      throw new Error(`Evaluation error: ${error.message}`);
    }
  }

  public setupConsoleListener(
    page: Page,
    targetId: string,
  ): void {
    // Remove existing listeners (if any)
    page.removeAllListeners('console');

    // Set up console listener
    page.on('console', async (msg) => {
      if (this.consoleCallback) {
        try {
          const args: any[] = [];
          for (let i = 0; i < msg.args().length; i++) {
            try {
              const arg = msg.args()[i];
              if (arg) {
                args.push(
                  await arg.jsonValue().catch(() => arg.toString()),
                );
              }
            } catch (e) {
              args.push('[object]');
            }
          }

          // Send to frontend
          this.consoleCallback!({
            level: msg.type() || 'log',
            text: msg.text(),
            args: args,
          });
        } catch (error) {
          console.error('Error processing console message:', error);
        }
      }
    });
  }

  onConsole(callback: (message: ConsoleMessage) => void): void {
    this.consoleCallback = callback;
  }

  async getPageById(targetId: string): Promise<Page | null> {
    let page = this.pages.get(targetId);
    if (!page) {
      const targets = this.browser!.targets();
      const target = targets.find((t) => t._targetId === targetId);
      if (target) {
        page = (await target.page())!;
        if (page) {
          this.pages.set(targetId, page);
        }
      }
    }
    return page || null;
  }

  /**
   * Execute Puppeteer code in Node.js environment
   */
  private async executePuppeteerCode(
    code: string,
    page: Page,
  ): Promise<CodeExecutionResult> {
    console.log('🔧 Executing Puppeteer code via Blob ESM runtime');

    const logs: Array<{ level: string; args: string[] }> = [];

    const logger = {
      log: (...a: any[]) =>
        logs.push({ level: 'log', args: a.map(String) }),
      info: (...a: any[]) =>
        logs.push({ level: 'info', args: a.map(String) }),
      warn: (...a: any[]) =>
        logs.push({ level: 'warn', args: a.map(String) }),
      error: (...a: any[]) =>
        logs.push({ level: 'error', args: a.map(String) }),
    };

    try {
      const wrapped = `
export default async function run({ page, browser, console }) {
${code}
}
`;

      const base64 = Buffer.from(wrapped).toString('base64');

      const url = `data:text/javascript;base64,${base64}`;

      const mod = await import(url);

      const result = await mod.default({
        page,
        browser: this.browser,
        console: logger,
      });

      // ================================
      // 6. Filter logs
      // ================================
      const filteredLogs = logs.filter((log) => {
        const m = log.args.join(' ');
        return (
          !m.includes('onbeforeunload save spyCache') &&
          !m.includes('Extension context invalidated') &&
          !m.includes('chrome-extension://') &&
          !m.startsWith('DevTools') &&
          !m.includes('webNavigation')
        );
      });

      return { result, logs: filteredLogs };
    } catch (error: any) {
      throw new Error(`Puppeteer execution error: ${error.message}`);
    }
  }

  /**
   * Execute JavaScript code in browser environment
   */
  private async executeBrowserCode(
    code: string,
    page: Page,
    hasAsync: boolean,
  ): Promise<CodeExecutionResult> {
    console.log(
      `🔧 Executing browser code (${hasAsync ? 'async' : 'sync'})`,
    );
    const wrapper = hasAsync ? 'async ' : '';
    console.log(code);
    const runCode = hasAsync
      ? `await (async () => {${code}})();`
      : `(() => {${code}})();`;

    const result= await page.evaluate(
      `(${wrapper}() => {
        const originalConsoleLog = console.log;
        const originalConsoleInfo = console.info;
        const originalConsoleWarn = console.warn;
        const originalConsoleError = console.error;

        const logs: Array<{ level: string; args: string[] }> = [];

        console.log = (...args: any[]) => {
          logs.push({ level: 'log', args: args.map(arg => String(arg)) });
          originalConsoleLog.apply(console, args);
        };

        console.info = (...args: any[]) => {
          logs.push({ level: 'info', args: args.map(arg => String(arg)) });
          originalConsoleInfo.apply(console, args);
        };

        console.warn = (...args: any[]) => {
          logs.push({ level: 'warn', args: args.map(arg => String(arg)) });
          originalConsoleWarn.apply(console, args);
        };

        console.error = (...args: any[]) => {
          logs.push({ level: 'error', args: args.map(arg => String(arg)) });
          originalConsoleError.apply(console, args);
        };

        try {
          const userResult = ${runCode};
          return { result: userResult, logs: logs };
        } catch (error: any) {
          logs.push({ level: 'error', args: ['Execution error: ' + error.message] });
          return { result: undefined, logs: logs };
        }
      })()`,
    ) as CodeExecutionResult;

    // Filter Chrome internal logs
    const filteredLogs = (result ? result.logs! : []).filter((log: { level: string; args: string[] }) => {
      const message = log.args.join(' ');
      return (
        !message.includes('onbeforeunload save spyCache') &&
        !message.includes('Extension context invalidated') &&
        !message.includes('chrome-extension://') &&
        !message.startsWith('DevTools') &&
        !message.includes('webNavigation')
      );
    });

    return {
      result: result ? result.result! : undefined,
      logs: filteredLogs,
    };
  }
}

export default CDPManager;
