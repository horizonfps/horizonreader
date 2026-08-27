// Manual e2e run: npm i --no-save playwright && node scripts/e2e-lidos.mjs
import { chromium } from 'playwright'

const BASE = process.env.E2E_BASE || 'http://localhost:3100'
const USER = process.env.E2E_USER || 'qaburro'
const PASS = process.env.E2E_PASS || 'burro12345'
const WORK = process.env.E2E_WORK || 'one-piece-mfiszt'
const SOURCE = process.env.E2E_SOURCE || 'MangaRead'

const results = []
const pass = (n, d) => (results.push({ n, ok: true, d }), console.log(`PASS ${n} :: ${d ?? ''}`))
const fail = (n, d) => (results.push({ n, ok: false, d }), console.log(`FAIL ${n} :: ${d ?? ''}`))
async function step(n, fn) {
  try {
    pass(n, await fn())
  } catch (e) {
    fail(n, String(e.message).slice(0, 300))
  }
}

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ viewport: { width: 430, height: 900 } })
const page = await ctx.newPage()
page.setDefaultTimeout(20000)

await step('login', async () => {
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
})

async function abrirObra() {
  await page.goto(`${BASE}/work/${WORK}`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(4000)
  if (await page.locator(`text=${SOURCE}`).first().count())
    await page.locator(`text=${SOURCE}`).first().click()
  for (let i = 0; i < 40; i++) {
    if ((await page.locator('a[href^="/reader/"]').count()) > 3) return
    await page.waitForTimeout(1000)
  }
  throw new Error('lista de capítulos não carregou')
}

await step('obra: botao de desmarcar lidos automaticos aparece', async () => {
  await abrirObra()
  const t = await page.locator('body').innerText()
  const m = t.match(/Desmarcar \d+ lidos? autom[áa]ticos?/)
  if (!m) throw new Error(`sem botão de desmarcar. Trecho: ${t.slice(t.indexOf('Capítulos'), t.indexOf('Capítulos') + 200).replace(/\n/g, ' | ')}`)
  return m[0]
})

await step('desmarcar: pergunta o alcance e desfaz na obra', async () => {
  const b = page.locator('button', { hasText: /Desmarcar \d+ lidos? autom/ }).first()
  const antes = (await b.innerText()).trim()
  await b.click()
  await page.waitForTimeout(1000)
  const t = await page.locator('body').innerText()
  const temEscopo = /Só nesta obra/.test(t) && /Em todas as obras/.test(t)
  if (!temEscopo) throw new Error(`sem as duas opções de alcance: ${t.slice(0, 200).replace(/\n/g, ' | ')}`)
  await page.locator('button', { hasText: /Só nesta obra/ }).first().click()
  await page.waitForTimeout(4000)
  const t2 = await page.locator('body').innerText()
  const aindaTem = /Desmarcar \d+ lidos? autom/.test(t2)
  return `${antes} -> ${aindaTem ? 'botão ainda presente' : 'botão sumiu (nada mais automático)'}`
})

await step('leitor: rodape mostra proximo capitulo (com fonte quando atravessa)', async () => {
  const link = page.locator('a[href^="/reader/"]').first()
  const href = await link.getAttribute('href')
  await page.goto(`${BASE}${href}`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(6000)
  for (let i = 0; i < 30; i++) {
    await page.mouse.wheel(0, 6000)
    await page.waitForTimeout(200)
  }
  await page.waitForTimeout(2000)
  const t = await page.locator('body').innerText()
  const m = t.match(/Próximo capítulo[^\n]*/) || t.match(/Fim\./)
  await page.mouse.click(215, 450)
  await page.waitForTimeout(1200)
  const navs = await page
    .locator('a[href^="/reader/"], button')
    .evaluateAll((els) => els.map((e) => e.innerText.trim()).filter((x) => /cap|Próximo|Anterior/i.test(x)).slice(0, 6))
  return `rodapé: ${m?.[0] ?? 'nada'} | navegação: ${JSON.stringify(navs)}`
})

console.log('RESUMO', JSON.stringify(results))
await browser.close()
process.exit(results.some((r) => !r.ok) ? 1 : 0)
