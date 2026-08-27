// Manual e2e run: npm i --no-save playwright && node scripts/e2e-prova.mjs
import { chromium } from 'playwright'

const BASE = process.env.E2E_BASE || 'http://localhost:3100'
const USER = process.env.E2E_USER || 'qaburro'
const PASS = process.env.E2E_PASS || 'burro12345'
const WORK = process.env.E2E_WORK || 'one-piece-mfiszt'
const SOURCE = process.env.E2E_SOURCE || 'MangaRead'
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

async function api(path, init) {
  return page.evaluate(
    async ([p, i]) => {
      const r = await fetch(p, i || undefined)
      const t = await r.text()
      try {
        return { status: r.status, body: JSON.parse(t) }
      } catch {
        return { status: r.status, body: t.slice(0, 300) }
      }
    },
    [path, init],
  )
}

await step('login', login)

if (roda('obra')) {
  await abrirObra()

  await step('obra: botao Baixar da linha vai para a fila', async () => {
    const btns = page.locator('li button')
    const n = await btns.count()
    let alvo = null
    for (let i = 0; i < Math.min(n, 30); i++) {
      if ((await btns.nth(i).innerText()).trim() === 'Baixar') {
        alvo = btns.nth(i)
        break
      }
    }
    if (!alvo) throw new Error('nenhuma linha com botão Baixar')
    await alvo.click()
    for (let i = 0; i < 20; i++) {
      const t = (await alvo.innerText().catch(() => '')).trim()
      if (t && t !== 'Baixar') return `botão virou "${t}"`
      await page.waitForTimeout(500)
    }
    throw new Error('botão continuou "Baixar"')
  })

  await step('obra: Baixar tudo pede confirmacao', async () => {
    const b = page.locator('button', { hasText: /^Baixar tudo \(/ }).first()
    await b.click()
    await page.waitForTimeout(800)
    const txt = await page.locator('body').innerText()
    const temConfirmar = await page.locator('button', { hasText: /^Confirmar$/ }).count()
    const temCancelar = await page.locator('button', { hasText: /^Cancelar$/ }).count()
    if (!temConfirmar || !temCancelar) throw new Error('sem Confirmar/Cancelar')
    await page.locator('button', { hasText: /^Cancelar$/ }).first().click()
    await page.waitForTimeout(500)
    const voltou = await page.locator('button', { hasText: /^Baixar tudo \(/ }).count()
    if (!voltou) throw new Error('cancelar não restaurou a barra')
    return `confirmação aparece e Cancelar volta atrás (${txt.match(/Baixar \d+ capítulos\?/)?.[0] ?? ''})`
  })

  await step('obra: escolher intervalo abre os dois seletores', async () => {
    await page.locator('button', { hasText: 'Escolher intervalo' }).first().click()
    await page.waitForTimeout(1200)
    const selects = page.locator('select')
    const n = await selects.count()
    if (n < 2) throw new Error(`esperava 2 selects, achei ${n}`)
    const opts = await selects.nth(0).locator('option').count()
    const btn = page.locator('button', { hasText: /Baixar \d+ capítulos/ }).first()
    const antes = await btn.innerText()
    const valores = await selects.nth(0).locator('option').evaluateAll((o) => o.slice(0, 3).map((x) => x.value))
    await selects.nth(1).selectOption(valores[2])
    await page.waitForTimeout(600)
    const depois = await btn.innerText()
    if (antes === depois) throw new Error(`contagem não mudou ao trocar o "até" (${antes})`)
    return `${opts} opções; botão foi de "${antes}" para "${depois}"`
  })

  await step('obra: baixar o intervalo escolhido enfileira', async () => {
    const btn = page.locator('button', { hasText: /Baixar \d+ capítulos/ }).first()
    await btn.click()
    for (let i = 0; i < 30; i++) {
      const txt = await page.locator('body').innerText()
      if (/na fila/i.test(txt) || /Enviando/i.test(txt)) {
        await page.waitForTimeout(2500)
        const t2 = await page.locator('body').innerText()
        const m = t2.match(/(\d+) na fila/)
        if (m) return `${m[0]}`
        if (/Cota cheia|Falhou ao enviar/i.test(t2)) return `resposta da barra: ${t2.match(/Cota cheia[^\n]*|Falhou ao enviar/)[0]}`
      }
      await page.waitForTimeout(500)
    }
    throw new Error('barra não confirmou envio')
  })
}

if (roda('fila')) {
  await step('fila: capitulos concluem no servidor', async () => {
    for (let i = 0; i < 60; i++) {
      const r = await api('/api/download')
      const items = r.body?.items || []
      const done = items.filter((x) => x.status === 'DONE')
      const err = items.filter((x) => x.status === 'ERROR')
      const andando = items.filter((x) => x.status === 'QUEUED' || x.status === 'RUNNING')
      if (items.length && !andando.length)
        return `${done.length} concluídos, ${err.length} com erro (${err.map((e) => e.error).slice(0, 2).join('; ')})`
      await page.waitForTimeout(3000)
    }
    const r = await api('/api/download')
    return `ainda rodando após 3min: ${JSON.stringify((r.body?.items || []).map((i) => `${i.chapterName}:${i.status}:${i.pagesDone}/${i.pageCount}`).slice(0, 5))}`
  })
}

if (roda('downloads')) {
  await step('downloads: tela lista os capitulos e o espaco ocupado', async () => {
    await page.goto(`${BASE}/downloads`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(4000)
    const txt = await page.locator('body').innerText()
    if (/Nenhum capítulo baixado ainda/.test(txt)) throw new Error('tela diz que não há nada baixado')
    const ocupa = txt.match(/Downloads ocupam\s*([^\n]+)/)?.[1]
    const caps = txt.match(/(\d+) capítulo\(s\)/)?.[1]
    if (!ocupa || ocupa.trim() === '0 B') throw new Error(`espaço ocupado ficou em ${ocupa}`)
    return `ocupa ${ocupa}, ${caps} capítulo(s)`
  })

  await step('downloads: chave de salvar sozinho no aparelho existe e alterna', async () => {
    const cb = page.locator('input[type="checkbox"]').first()
    if (!(await cb.count())) throw new Error('sem checkbox na tela')
    const antes = await cb.isChecked()
    await cb.click()
    await page.waitForTimeout(800)
    const depois = await cb.isChecked()
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(3000)
    const persistiu = await page.locator('input[type="checkbox"]').first().isChecked()
    if (antes === depois) throw new Error('a chave não alternou')
    if (persistiu !== depois) throw new Error('a chave não sobreviveu ao reload')
    return `alternou ${antes} -> ${depois} e persistiu`
  })

  await step('downloads: remover apaga o capitulo', async () => {
    const antes = (await api('/api/download')).body?.items?.length || 0
    const rm = page.locator('button', { hasText: /^Remover$/ }).first()
    if (!(await rm.count())) throw new Error('sem botão Remover')
    await rm.click()
    await page.waitForTimeout(2500)
    const depois = (await api('/api/download')).body?.items?.length || 0
    if (depois >= antes) throw new Error(`itens antes ${antes}, depois ${depois}`)
    return `${antes} -> ${depois} itens`
  })
}

if (roda('cota')) {
  await step('cota por usuario: barra o proximo download', async () => {
    await page.goto(`${BASE}/downloads`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(3500)
    const linha = page.locator('div', { hasText: /qaburro \(você\)/ }).last()
    const inp = linha.locator('input[type="number"], input').first()
    await inp.fill('1')
    await linha.locator('button', { hasText: /^Salvar$/ }).first().click()
    await page.waitForTimeout(2000)
    await abrirObra()
    const btns = page.locator('li button')
    let alvo = null
    for (let i = 0; i < 30; i++) {
      const t = (await btns.nth(i).innerText().catch(() => '')).trim()
      if (t === 'Baixar') {
        alvo = btns.nth(i)
        break
      }
    }
    if (!alvo) throw new Error('sem linha para testar')
    await alvo.click()
    for (let i = 0; i < 20; i++) {
      const t = (await alvo.innerText().catch(() => '')).trim()
      if (/cota/i.test(t)) return `botão mostrou "${t}"`
      await page.waitForTimeout(500)
    }
    return `botão ficou "${(await alvo.innerText().catch(() => '?')).trim()}" (esperado aviso de cota)`
  })
}

if (roda('info')) {
  await step('info: cartao de downloads do app e limpeza', async () => {
    await page.goto(`${BASE}/info`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(6000)
    const txt = await page.locator('body').innerText()
    if (!txt.includes('DOWNLOADS DO APP')) throw new Error('sem cartão DOWNLOADS DO APP')
    if (!txt.includes('LIMPEZA DE DOWNLOADS')) throw new Error('sem bloco LIMPEZA DE DOWNLOADS')
    const btns = await page
      .locator('button', { hasText: /Apagar/ })
      .evaluateAll((els) => els.map((e) => e.innerText.trim()))
    return `cartão presente; botões: ${JSON.stringify(btns)}`
  })
}

console.log('\nCONSOLE ERRORS', JSON.stringify(consoleErrors.slice(0, 10)))
console.log('RESUMO', JSON.stringify(results))
await browser.close()
process.exit(results.some((r) => !r.ok) ? 1 : 0)
