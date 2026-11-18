// Only isolated loopback test envs; keep the older `node check.mjs [base]` invocation working.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chromium, webkit } from 'playwright'

export function testArgs() {
  const args = process.argv.slice(2)
  const engine = ['chromium', 'webkit'].includes(args[0]) ? args.shift() : 'chromium'
  const base = args.shift() ?? 'http://127.0.0.1:5183'
  if (args.length || !/^http:\/\/127\.0\.0\.1:(5183|5184|5283|5285|5383|5385)$/.test(base)) throw new Error(`not the test env: ${base}`)
  return { engine, base }
}

// WebKit needs a profile on disk for OPFS (an ephemeral context behaves like private browsing).
export async function testContext(engine, options = {}) {
  // Settings can install the push worker even on Vite. Keep requests interceptable unless
  // a check explicitly exercises service-worker/offline behavior.
  options = { serviceWorkers: 'block', ...options }
  const browser = engine === 'webkit' ? undefined : await chromium.launch()
  const context = browser
    ? await browser.newContext(options)
    : await webkit.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'vasta-check-')), options)
  if (browser) {
    const close = context.close.bind(context)
    context.close = async () => {
      await close()
      await browser.close()
    }
  }
  if (engine === 'webkit' && process.env.MODE !== 'json') {
    // Playwright WebKit shares OPFS between otherwise fresh profiles. Start this test device
    // without a previous run's SQLite files, before the app can open a worker on them.
    const page = context.pages()[0] ?? (await context.newPage())
    const { base } = testArgs()
    await page.route('**/*', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html>' }))
    await page.goto(base)
    await page.evaluate(async () => {
      const root = await navigator.storage.getDirectory()
      await root.removeEntry('.vasta', { recursive: true }).catch((error) => {
        if (error.name !== 'NotFoundError') throw error
      })
    })
    await page.unroute('**/*')
    await page.close()
  }
  if (process.env.MODE === 'json') await context.addInitScript(() => localStorage.setItem('vasta.replica', 'off'))
  return context
}
