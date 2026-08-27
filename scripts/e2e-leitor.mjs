// Manual e2e run: npm i --no-save playwright && node scripts/e2e-leitor.mjs
import { chromium } from 'playwright'

const BASE = process.env.E2E_BASE || 'http://localhost:3100'
const USER = process.env.E2E_USER || 'qaburro'
const PASS = process.env.E2E_PASS || 'burro12345'
const CHAPTER = process.env.E2E_CHAPTER || '2000004120'
const BLOCOS = process.argv.slice(2)

const results = []
const consoleErrors = []
const pass = (n, d) => (results.push({ n, ok: true, d }), console.log(`PASS ${n} :: ${d ?? ''}`))
const fail = (n, d) => (results.push({ n, ok: false, d }), console.log(`FAIL ${n} :: ${d ?? ''}`))
async function step(n, fn) {
  try {
    pass(n, await fn())
  } catch (e) {
    fail(n, String(e.message).slice(0, 400))
  }
}
const roda = (b) => !BLOCOS.length || BLOCOS.includes(b)

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ viewport: { width: 430, height: 900 } })
const page = await ctx.newPage()
page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text().slice(0, 200)))

const cacheHeaders = []
page.on('response', (r) => {
  const h = r.headers()['x-hr-cache']
  if (h) cacheHeaders.push(h)
})

async function login() {
  await page.goto(`${BASE}/login`, { waitUntil: 'load' })
  await page.waitForTimeout(3000)
  await page.locator('input').nth(0).fill(USER)
  await page.locator('input[type="password"]').fill(PASS)
  await page.locator('button[type="submit"]').first().click()
  for (let i = 0; i < 60; i++) {
    if (!new URL(page.url()).pathname.startsWith('/login')) return page.url()
    await page.waitForTimeout(1000)
  }
  throw new Error('login não completou')
}

async function abrirLeitor(id = CHAPTER) {
  await page.goto(`${BASE}/reader/${id}`, { waitUntil: 'domcontentloaded' })
  for (let i = 0; i < 40; i++) {
    if ((await page.locator('img').count()) > 0) break
    await page.waitForTimeout(1000)
  }
  await page.waitForTimeout(3000)
}

await step('login', login)

if (roda('leitor')) {
  await abrirLeitor()

  await step('leitor: paginas carregam', async () => {
    const n = await page.locator('img').count()
    if (!n) throw new Error('nenhuma imagem no leitor')
    return `${n} imagens`
  })

  await step('leitor: capitulo baixado vem do disco', async () => {
    await page.waitForTimeout(2000)
    const fromDownload = cacheHeaders.filter((h) => h === 'download').length
    if (!fromDownload) throw new Error(`x-hr-cache visto: ${JSON.stringify([...new Set(cacheHeaders)])}`)
    return `${fromDownload} imagens servidas do download`
  })

  await step('leitor: barras aparecem com um toque e trazem os botoes novos', async () => {
    await page.mouse.click(215, 450)
    await page.waitForTimeout(1200)
    const btns = await page.locator('button').evaluateAll((els) => els.map((e) => e.innerText.trim()).filter(Boolean))
    const txt = await page.locator('body').innerText()
    return `botões: ${JSON.stringify([...new Set(btns)].slice(0, 15))} | tem "Baixado": ${txt.includes('Baixado')}`
  })

  await step('leitor: zoom abre com dois cliques e fecha clicando fora', async () => {
    await page.locator('img').first().dblclick()
    await page.waitForTimeout(1200)
    const pct = page.locator('button', { hasText: /^\d+%$/ })
    if (!(await pct.count())) throw new Error('camada de zoom não abriu')
    const mais = page.locator('button[aria-label="Aumentar zoom"]').first()
    await mais.click()
    await mais.click()
    await page.waitForTimeout(600)
    const nivel = await pct.first().innerText()
    await page.mouse.click(215, 450)
    await page.waitForTimeout(600)
    if (!(await page.locator('button', { hasText: /^\d+%$/ }).count()))
      throw new Error('clicar sobre a imagem fechou a camada')
    await pct.first().click()
    await page.waitForTimeout(600)
    const reset = await pct.first().innerText()
    await page.mouse.click(5, 895)
    await page.waitForTimeout(800)
    if (await page.locator('button', { hasText: /^\d+%$/ }).count())
      throw new Error('camada não fechou ao clicar fora')
    return `abriu, subiu para ${nivel}, reset para ${reset}, clique na imagem não fecha e clique fora fecha`
  })

  await step('leitor: salvar no celular guarda as paginas', async () => {
    await page.mouse.click(215, 450)
    await page.waitForTimeout(1000)
    const b = page.locator('button', { hasText: /Salvar no celular/ }).first()
    if (!(await b.count())) throw new Error('sem botão Salvar no celular')
    await b.click()
    for (let i = 0; i < 90; i++) {
      const t = (await b.innerText().catch(() => '')).trim()
      if (/Salvo/i.test(t)) {
        const idx = await page.evaluate(async () => {
          const c = await caches.open('hr-offline-v1')
          const r = await c.match('/__offline/index.json')
          return r ? await r.json() : null
        })
        return `${t}; índice com ${idx?.length ?? 0} capítulo(s), ${idx?.[0]?.urls?.length ?? 0} páginas`
      }
      if (/falh/i.test(t)) throw new Error(`botão mostrou "${t}"`)
      await page.waitForTimeout(1000)
    }
    throw new Error(`não terminou: "${(await b.innerText().catch(() => '?')).trim()}"`)
  })

  await step('leitor: proximo capitulo atravessa fontes', async () => {
    await page.mouse.click(215, 450)
    await page.waitForTimeout(1000)
    const txt = await page.locator('body').innerText()
    const links = await page.locator('a[href^="/reader/"]').evaluateAll((els) =>
      els.map((e) => ({ href: e.getAttribute('href'), txt: e.innerText.trim().slice(0, 40) })),
    )
    return `links de navegação: ${JSON.stringify(links.slice(0, 6))} | rodapé: ${txt.slice(-160).replace(/\n/g, ' ')}`
  })
}

if (roda('offline')) {
  await step('offline: prateleira lista o que foi salvo', async () => {
    await page.goto(`${BASE}/offline`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(3500)
    const txt = await page.locator('body').innerText()
    if (/Nada salvo ainda/.test(txt)) throw new Error('prateleira vazia')
    return txt.slice(0, 300).replace(/\n/g, ' | ')
  })
}

console.log('\nCONSOLE ERRORS', JSON.stringify(consoleErrors.slice(0, 10)))
console.log('RESUMO', JSON.stringify(results))
await browser.close()
process.exit(results.some((r) => !r.ok) ? 1 : 0)
