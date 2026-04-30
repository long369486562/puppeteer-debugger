
type Input = {
  code: string
  lang: "js" | "ts"
}
import { rm, access } from "fs/promises"
import { constants } from "fs"
import { randomBytes } from "crypto"


export class CodePreprocessor {
  constructor() { }

  async build(input: Input) {

    // 1️⃣ 解析指令（仅提取 metadata）
    const projectRoot = this.parseDirectives(input.code)
    // console.log("projectRoot", projectRoot)
    // 2️⃣ 判断是否 Node（唯一依据：代码内容）
    const isNode = this.detectNodeContextUsage(input.code)
    // console.log("isNode", isNode)
    const isAs = this.detectAsyncCode(input.code)
    // console.log("isAs", isAs)
    // 3️⃣ Node：import 绝对化处理
    let transformedCode = input.code

    if (projectRoot) {
      console.log(1)
      const rewritten = this.rewriteImports(input.code, projectRoot)
      const { imports, body } = this.splitImports(rewritten)

      transformedCode = this.wrapNodeModule(imports, body, isAs)
    } else if (!projectRoot && isNode) {
      console.log(2)
      const { imports, body } = this.splitImports(input.code)
      transformedCode = this.wrapNodeModule(imports, body, isAs)
    } else {
      console.log(3)
      transformedCode = this.wrapBrowserModule(transformedCode, isAs)
    }
    console.log(transformedCode)
    // 4️⃣ 写入临时文件
    const entryFilePath = await this.writeTempFile(transformedCode, input.lang)

    // 5️⃣ 生成 file:// URL
    const entryFileUrl = this.toFileUrl(entryFilePath).href

    return {
      entryFilePath,
      entryFileUrl
    }
  }

  /**
   * ================================
   * 1. 指令解析
   * ================================
   */
  private parseDirectives(code: string) {
    const projectRootMatch = code.match(/\/\/\s*@projectRoot\s+(.+)/)

    return projectRootMatch?.[1]?.trim() || null
  }
  private splitImports(code: string) {
    const importRegex = /^[ \t]*import .*?;?$/gm

    const imports = code.match(importRegex) ?? []

    const body = code
      .replace(importRegex, "")
      .replace(/\/\/\s*@projectRoot\s+.+/, "")
      .trim()

    return {
      imports: imports.join("\n"),
      body
    }
  }
  /**
   * ================================
   * 2. Node Context 判断（核心）
   * ================================
   *
   * ❗不是 regex 猜业务
   * ❗是判断“是否依赖宿主环境”
   */
  private detectNodeContextUsage(code: string): boolean {
    // module system
    if (/\bimport\b|\brequire\s*\(/.test(code)) return true

    // puppeteer / cdp injected runtime API
    const nodeApis = [
      "page.",
      "browser.",
      "target",
      "goto(",
      "click(",
      "type(",
      "evaluate(",
      "waitFor",
      "$$(",
      "$("
    ]

    return nodeApis.some(api => code.includes(api))
  }
  /**
   * 判断是否有异步代码
   */
  private detectAsyncCode(code: string): boolean {
    // 粗粒度即可（用于预判执行环境）
    return /\basync\b|\bawait\b|Promise\s*\./.test(code)
  }
  /**
   * ================================
   * 3. import 处理（仅 Node）
   * ================================
   *
   * ./A → file:///D:/project/xxx/A
   */
  private rewriteImports(code: string, projectRoot?: string) {
    if (!projectRoot) return code

    return code.replace(
      /from\s+['"](\.\/[^'"]+)['"]/g,
      (_, p1) => {
        const abs = this.toFileUrl(`${projectRoot}/${p1}`).href
        return `from '${abs}'`
      }
    )
  }

  /**
   * ================================
   * 4. Node wrapper
   * ================================
   */
  private wrapNodeModule(imports: string, body: string, isAs: boolean) {
    const resultcode = isAs ? `await (async() => {${body}})();` : `(() => {${body}})();`
    return `
/**
 * AUTO GENERATED - NODE EXECUTION
 */
${imports}
export default async function run(page, browser, xxconsole) {
  // 已经hook过
  if (!console.__EMIT_HOOKED__){
    // 🔥 关键：保存原始引用（用于恢复）
    console.__ORIGINAL__ = {
      log: console.log,
      info: console.info,
      warn: console.warn,
      error: console.error,
      debug: console.debug,
    };
    const patch = (level) => {
      console[level] = (...args) => {
        try {
          xxconsole[level]?.(...args);
        } catch {}
      };
    };
    ["log", "info", "warn", "error", "debug"].forEach(patch);
    // 整体标记
    console.__EMIT_HOOKED__ = true;
  }
  try {
    const result = ${resultcode}
    return result;
  } catch (e) {
    xxconsole.error?.(e?.stack || e?.message || String(e));
  } finally {
    // 2️⃣ 🔥恢复 console（关键）
    if (console.__ORIGINAL__) {
      Object.assign(console, console.__ORIGINAL__);
      delete console.__ORIGINAL__;
    }

    console.__EMIT_HOOKED__ = false;
  }
}
`
  }

  /**
   * ================================
   * 5. Browser wrapper
   * ================================
   *
   * Browser code 被统一封装为 Node module
   */
  private wrapBrowserModule(code: string, isAs: boolean) {
    const resultcode = isAs ? `await (async() => {${code}})();` : `(() => {${code}})();`
    return `
export default async function run(page, browser, xxconsole) {
  return await page.evaluate(async () => {
    // 已经hook过
    if (!console.__EMIT_HOOKED__){
        // 🔥 关键：保存原始引用（用于恢复）
      console.__ORIGINAL__ = {
        log: console.log,
        info: console.info,
        warn: console.warn,
        error: console.error,
        debug: console.debug,
      };
      const patch = (level) => {
        console[level] = (...args) => {
          try {
            window.emitLog?.(level,args);
          } catch {}
        };
      };

      ["log", "info", "warn", "error", "debug"].forEach(patch);
      // 整体标记
      console.__EMIT_HOOKED__ = true;
    }
    try {
      const result = ${resultcode}
      return result;
    } catch (e) {
      window.emitLog?.("error",[e?.stack || e?.message || String(e)]);
    } finally {
      // 2️⃣ 🔥恢复 console（关键）
      if (console.__ORIGINAL__) {
        Object.assign(console, console.__ORIGINAL__);
        delete console.__ORIGINAL__;
      }

      console.__EMIT_HOOKED__ = false;
    }
  });
}
`;
  }

  /**
   * ================================
   * 6. 写临时文件（Bun）
   * ================================
   */
  private async writeTempFile(code: string, lang: string) {
    const id = randomBytes(8).toString("hex")
    const ext = lang === "ts" ? "ts" : "js"

    const fileName = `temp-${id}.${ext}`
    const filePath = `${process.cwd()}/temp/${fileName}`;
    console.log(filePath)
    // 🔥 写入前清理旧文件、
    await this.deleteFile()
    await Bun.write(filePath, code)

    return filePath
  }
  public async deleteFile() {
    try {
      const filePath = `${process.cwd()}/temp/`
      // 1️⃣ 判断是否存在
      await access(filePath, constants.F_OK)

      // 2️⃣ 存在才删除
      await rm(filePath, { recursive: true, force: true })
    } catch (err) {
      // ❗不存在直接忽略
    }
  }
  /**
   * ================================
   * 7. file:// URL
   * ================================
   */
  private toFileUrl(filePath: string) {
    return Bun.pathToFileURL(filePath)
  }
}
