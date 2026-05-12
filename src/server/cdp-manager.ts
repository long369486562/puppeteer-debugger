import puppeteer from 'puppeteer-core';
import type { Browser, Page, Target } from 'puppeteer-core';
import { CodePreprocessor } from './code-preprocessor';
import { createJiti, type Jiti } from "jiti";
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
}

class CDPManager {
  private browser: Browser | null;
  private pages: Map<string, Page>;
  private jitimod: Jiti;
  private consoleCallback: ((message: ConsoleMessage) => void) | null;

  constructor() {
    this.browser = null;
    this.pages = new Map();
    this.jitimod = createJiti(import.meta.url, {
      moduleCache:false,
      fsCache: false,
      requireCache: false
    });
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
        // console.log(`Target created: ${target.url()}`);
      });

      this.browser.on('targetdestroyed', (target) => {
        // console.log(`Target destroyed: ${target.url()}`);

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
    lang: "js" | "ts"
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

    // === Node.js environment: Execute Puppeteer code ===
    return await this.executeCode(code, page, lang);
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
   * Execute code in Node.js environment
   */
  private async executeCode(
    code: string,
    page: Page,
    lang: "js" | "ts"
  ): Promise<CodeExecutionResult> {
    // console.log('🔧 Executing code via Blob ESM runtime');
    if (!(page as any).__emitLogExposed) {
      const emit = (level: string, a: any[]) => {
        const args = a.map(String);
        if (this.consoleCallback) {
          this.consoleCallback({ level, text: args.join(' '), args });
        }
      };
      await page.exposeFunction("emitLog", emit);
      (page as any).__emitLogExposed = true;
    }

    const emitForLogger = (level: string, a: any[]) => {
      const args = a.map(String);
      if (this.consoleCallback) {
        this.consoleCallback({ level, text: args.join(' '), args });
      }
    };

    const logger = {
      log: (...a: any[]) => emitForLogger('log', a),
      info: (...a: any[]) => emitForLogger('info', a),
      warn: (...a: any[]) => emitForLogger('warn', a),
      error: (...a: any[]) => emitForLogger('error', a),
      debug: (...a: any[]) => emitForLogger('debug', a),
    };

    const Code_Prepro = await new CodePreprocessor().build({ code, lang });

    try {
      const modDefault = await this.jitimod.import(Code_Prepro.entryFileUrl, { default: true }) as any;

      const result = await modDefault(page, this.browser, logger);

      return { result };
    } catch (error: any) {
      throw new Error(`Puppeteer execution error: ${error.message}`);
    } finally {
      await new CodePreprocessor().deleteFile();
    }
  }
}

export default CDPManager;
