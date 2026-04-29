import WebSocket, { WebSocketServer } from 'ws';
import http from 'http';
import fs from 'fs';
import path from 'path';
import CDPManager from './cdp-manager';
import config from '../config';

interface PageInfo {
  id: string;
  url: string;
  title: string;
}

interface ConsoleMessage {
  type: 'console';
  level: string;
  text: string;
  args: any[];
}

interface EvalResultMessage {
  type: 'evalResult';
  result: any;
  resultType: string;
}

interface ErrorMessage {
  type: 'error';
  message: string;
}

type Message = ConsoleMessage | EvalResultMessage | ErrorMessage;

class PuppeteerDebugger {
  private wss: WebSocketServer | null;
  private cdpManager: CDPManager;
  private clients: Set<WebSocket>;
  private currentTargetId: string | null;

  constructor() {
    this.wss = null;
    this.cdpManager = new CDPManager();
    this.clients = new Set();
    this.currentTargetId = null;

    this.setupCDPListeners();
  }

  private setupCDPListeners(): void {
    this.cdpManager.onConsole((message) => {
      this.broadcast({
        type: 'console',
        level: message.level,
        text: message.text,
        args: message.args || [],
      });
    });
  }

  start(port: number = config.server.port): void {
    // Create HTTP server to serve static files
    const server = http.createServer(
      (req: http.IncomingMessage, res: http.ServerResponse) => {
        let filePath = path.join(
          __dirname,
          '..',
          'ui',
          req.url === '/' ? 'index.html' : req.url!,
        );

        // Security check: only allow access to files in ui directory
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

          // Set correct Content-Type
          const ext = path.extname(filePath);
          const contentType: Record<string, string> = {
            '.html': 'text/html',
            '.css': 'text/css',
            '.js': 'text/javascript',
          };

          res.writeHead(200, {
            'Content-Type': contentType[ext] || 'text/plain',
          });
          res.end(data);
        });
      },
    );

    // Start HTTP server
    server.listen(port, () => {
      console.log(
        `Puppeteer Debugger HTTP server started on http://localhost:${port}`,
      );
    });

    // Create WebSocket server, attached to HTTP server
    this.wss = new WebSocketServer({ server });
    // this.wss = new WebSocket.Server({ server });

    console.log(
      `Puppeteer Debugger WebSocket server started on ws://localhost:${port}`,
    );

    this.wss.on('connection', (ws: WebSocket) => {
      this.clients.add(ws);

      ws.on('message', (data: Buffer) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleMessage(ws, message);
        } catch (error) {
          console.error('Invalid message:', error);
          ws.send(
            JSON.stringify({
              type: 'error',
              message: 'Invalid JSON message',
            }),
          );
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

  private async handleMessage(
    ws: WebSocket,
    message: { type: string; [key: string]: any },
  ): Promise<void> {
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
          ws.send(
            JSON.stringify({
              type: 'error',
              message: `Unknown message type: ${message.type}`,
            }),
          );
      }
    } catch (error: any) {
      console.error('Message handling error:', error);
      ws.send(
        JSON.stringify({
          type: 'error',
          message: error.message,
        }),
      );
    }
  }

  private async handleConnect(
    ws: WebSocket,
    port: number,
  ): Promise<void> {
    try {
      const version = await this.cdpManager.connect(port);
      ws.send(
        JSON.stringify({
          type: 'connected',
          version: version,
        }),
      );

      // Automatically get page list
      await this.handleListPages(ws);
    } catch (error: any) {
      ws.send(
        JSON.stringify({
          type: 'error',
          message: `Connection failed: ${error.message}`,
        }),
      );
    }
  }

  private async handleDisconnect(ws: WebSocket): Promise<void> {
    try {
      await this.cdpManager.disconnect();
      this.currentTargetId = null;
      ws.send(
        JSON.stringify({
          type: 'disconnected',
        }),
      );
    } catch (error: any) {
      ws.send(
        JSON.stringify({
          type: 'error',
          message: `Disconnect failed: ${error.message}`,
        }),
      );
    }
  }

  private async handleListPages(ws: WebSocket): Promise<void> {
    try {
      const targets = await this.cdpManager.getTargets();
      const pages: PageInfo[] = targets.map((target) => ({
        id: target.targetId,
        url: target.url,
        title: target.title || 'Untitled',
      }));

      ws.send(
        JSON.stringify({
          type: 'pages',
          pages: pages,
        }),
      );
    } catch (error: any) {
      ws.send(
        JSON.stringify({
          type: 'error',
          message: `Failed to list pages: ${error.message}`,
        }),
      );
    }
  }

  private async handleCreatePage(
    ws: WebSocket,
    url: string = 'about:blank',
  ): Promise<void> {
    try {
      const target = await this.cdpManager.createTarget(url);
      ws.send(
        JSON.stringify({
          type: 'pageCreated',
          page: {
            id: target.targetId,
            url: target.url,
            title: target.title || 'Untitled',
          },
        }),
      );

      // Refresh page list
      await this.handleListPages(ws);
    } catch (error: any) {
      ws.send(
        JSON.stringify({
          type: 'error',
          message: `Failed to create page: ${error.message}`,
        }),
      );
    }
  }

  private async handleSelectPage(
    ws: WebSocket,
    pageId: string,
  ): Promise<void> {
    try {
      // Verify page exists
      const targets = await this.cdpManager.getTargets();
      const target = targets.find((t) => t.targetId === pageId);

      if (!target) {
        throw new Error('Page not found');
      }

      this.currentTargetId = pageId;

      // Ensure console listener is set up
      const page = await this.cdpManager.getPageById(pageId);
      if (page) {
        this.cdpManager.setupConsoleListener(page, pageId);
      }

      ws.send(
        JSON.stringify({
          type: 'pageSelected',
          pageId: pageId,
        }),
      );
    } catch (error: any) {
      ws.send(
        JSON.stringify({
          type: 'error',
          message: `Failed to select page: ${error.message}`,
        }),
      );
    }
  }

  private async handleClosePage(
    ws: WebSocket,
    pageId: string,
  ): Promise<void> {
    try {
      await this.cdpManager.closeTarget(pageId);

      if (this.currentTargetId === pageId) {
        this.currentTargetId = null;
      }

      ws.send(
        JSON.stringify({
          type: 'pageClosed',
          pageId: pageId,
        }),
      );

      // Refresh page list
      await this.handleListPages(ws);
    } catch (error: any) {
      ws.send(
        JSON.stringify({
          type: 'error',
          message: `Failed to close page: ${error.message}`,
        }),
      );
    }
  }

  private async handleEval(ws: WebSocket, code: string): Promise<void> {
    try {
      if (!this.currentTargetId) {
        throw new Error('No page selected');
      }

      const result = await this.cdpManager.evaluateCode(this.currentTargetId, code);

      // Handle async result (if it's a Promise, wait for it)
      const finalResult =
        result instanceof Promise ? await result : result;

      // Send execution result
      ws.send(
        JSON.stringify({
          type: 'evalResult',
          result: this.formatResult(finalResult.result),
          resultType: typeof finalResult.result,
        }),
      );

      // If there are captured console logs, send them one by one
      if (finalResult.logs && finalResult.logs.length > 0) {
        finalResult.logs.forEach((log: ConsoleMessage) => {
          ws.send(
            JSON.stringify({
              type: 'console',
              level: log.level,
              text: log.args.join(' '),
              args: log.args,
            }),
          );
        });
      }
    } catch (error: any) {
      ws.send(
        JSON.stringify({
          type: 'error',
          message: `Evaluation failed: ${error.message}`,
        }),
      );
    }
  }

  private formatResult(result: any): any {
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

  private broadcast(message: Message): void {
    const data = JSON.stringify(message);
    this.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    });
  }
}

// Start server
if (require.main === module) {
  const puppeteerDebugger = new PuppeteerDebugger();
  puppeteerDebugger.start();
}

export default PuppeteerDebugger;
