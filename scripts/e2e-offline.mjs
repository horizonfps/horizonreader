// Manual e2e run: npm i --no-save playwright && node scripts/e2e-offline.mjs
import { chromium } from 'playwright'

const BASE = process.env.E2E_BASE || 'http://localhost:3100'
const USER = process.env.E2E_USER || 'qaburro'
const PASS = process.env.E2E_PASS || 'burro12345'
const CHAPTER = process.env.E2E_CHAPTER || '2000001880'

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

const indice = () =>
  page.evaluate(async () => {
    if (!('caches' in window)) return null
    const c = await caches.open('hr-offline-v1')
    const r = await c.match('/__offline/index.json')
    return r ? await r.json() : []
  })

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

await step('salvar capitulo no aparelho', async () => {
  await page.goto(`${BASE}/reader/${CHAPTER}`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(6000)
  await page.mouse.click(215, 450)
  await page.waitForTimeout(1200)
  await page.locator('button', { hasText: /Salvar no celular/ }).first().click()
  for (let i = 0; i < 60; i++) {
    const idx = await indice()
    const it = (idx || []).find((x) => String(x.chapterId) === String(CHAPTER))
    if (it && it.urls?.length) return `${it.chapterName} com ${it.urls.length} páginas no aparelho`
    await page.waitForTimeout(3000)
  }
  throw new Error('capítulo não entrou no índice do aparelho')
})

await step('prateleira online lista o capitulo salvo', async () => {
  await page.goto(`${BASE}/offline`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(4000)
  const t = await page.locator('body').innerText()
  if (/Nada salvo ainda/.test(t)) throw new Error('prateleira vazia')
  return t.slice(0, 200).replace(/\n/g, ' | ')
})

await step('sem rede: navegacao cai na prateleira', async () => {
  await ctx.setOffline(true)
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' }).catch(() => {})
  await page.waitForTimeout(4000)
  const t = await page.locator('body').innerText()
  if (!/Salvos no aparelho/.test(t))
    throw new Error(`tela sem rede mostrou: ${t.slice(0, 200).replace(/\n/g, ' | ')}`)
  return t.slice(0, 160).replace(/\n/g, ' | ')
})

await step('sem rede: ler o capitulo salvo e chegar ao fim', async () => {
  const ler = page.locator('button', { hasText: /^Ler$/ }).first()
  if (!(await ler.count())) throw new Error('sem botão Ler na prateleira')
  await ler.click()
  await page.waitForTimeout(3000)
  const imgs = await page.locator('img').count()
  if (!imgs) throw new Error('nenhuma página apareceu sem rede')
  for (let i = 0; i < 25; i++) {
    await page.mouse.wheel(0, 4000)
    await page.waitForTimeout(250)
  }
  await page.waitForTimeout(1500)
  const voltar = page.locator('button', { hasText: /voltar/ }).first()
  if (await voltar.count()) await voltar.click()
  await page.waitForTimeout(1500)
  return `${imgs} páginas exibidas sem rede e voltou para a lista`
})

await step('voltando a rede: progresso offline sobe para o servidor', async () => {
  await ctx.setOffline(false)
  await page.waitForTimeout(2000)
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' }).catch(() => {})
  await page.waitForTimeout(8000)
  const r = await page.evaluate(async (id) => {
    const res = await fetch('/api/progress?chapterId=' + id).catch(() => null)
    return res ? { status: res.status, body: (await res.text()).slice(0, 200) } : null
  }, CHAPTER)
  return `resposta do servidor: ${JSON.stringify(r)}`
})

console.log('RESUMO', JSON.stringify(results))
await browser.close()
process.exit(results.some((r) => !r.ok) ? 1 : 0)
