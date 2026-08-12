/**
 * Automação de preenchimento do "Create Damage Report Entry" no ServiceNow (SNOW),
 * a partir da planilha já gerada pelo SNOW Processor (snowProcessor.ts).
 *
 * Os campos do formulário NÃO são <select> nativos — são um widget de combobox
 * custom do ServiceNow (clica pra abrir, filtra numa caixa de busca, clica na
 * opção exata da lista). `selectFromComboBox` cobre esse padrão.
 *
 * Sessão de login: usa um perfil de navegador PERSISTENTE (launchPersistentContext),
 * salvo em %APPDATA%/ArthwindSuite/snow_browser_profile — login feito manualmente
 * uma vez em `openServiceNowForLogin` continua valendo nas próximas rodadas, sem
 * precisar logar de novo a cada execução.
 */
import { chromium, BrowserContext, Page } from 'playwright'
import ExcelJS from 'exceljs'
import path from 'path'
import fs from 'fs'
import os from 'os'
import https from 'https'
import http from 'http'

export interface DamageReportRow {
  bladeSerialNumber: string // serial completo (13 dígitos) — bate com o combobox
  subComponent: string // termo de busca no dropdown "Sub Component"
  failureType: string // termo de busca no dropdown "Failure Type"
  damageDescription: string
  dfDistanceStart: number
  dfDistanceEnd: number
  profileDepthStart: number | string
  profileDepthEnd: number | string
  insideOutside: string
  bladeSection: string
  bladeSubSection: string
  bladeArea: string
  sizeMm: number
  amountOfFindings: number // sempre 1
  photoUrls: string[] // 1+ fotos — sobem numeradas 01_/02_/... (form pede isso pra sequência)
}

type LogFn = (msg: string) => void

function profileDir(): string {
  const appData = process.env.APPDATA || path.join(os.homedir(), '.config')
  const dir = path.join(appData, 'ArthwindSuite', 'snow_browser_profile')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

let sharedContext: BrowserContext | null = null

async function getContext(headless: boolean): Promise<BrowserContext> {
  if (sharedContext) return sharedContext
  sharedContext = await chromium.launchPersistentContext(profileDir(), {
    headless,
    viewport: { width: 1440, height: 900 }
  })
  return sharedContext
}

/** Abre um Chrome visível pra login manual — o perfil persistente guarda a sessão,
 * então isso só precisa ser feito de novo quando a sessão expirar de verdade. */
export async function openServiceNowForLogin(
  url: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const context = await getContext(false)
    const page = context.pages()[0] || (await context.newPage())
    await page.bringToFront()
    await page.goto(url, { waitUntil: 'domcontentloaded' })
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

export async function closeServiceNowSession(): Promise<{ success: boolean }> {
  if (sharedContext) {
    await sharedContext.close().catch(() => {})
    sharedContext = null
  }
  return { success: true }
}

function fetchBuffer(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http
    lib
      .get(url, (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => resolve(Buffer.concat(chunks)))
        res.on('error', reject)
      })
      .on('error', reject)
  })
}

// ─── Preenchimento do formulário ─────────────────────────────────────────────

class DamageEntryFiller {
  constructor(
    private page: Page,
    private log: LogFn
  ) {}

  /** Retorna a página principal ou o iframe gsft_main do ServiceNow se ele existir */
  private getScope() {
    const mainFrame = this.page.frames().find((f) => f.name() === 'gsft_main' || f.url().includes('.do'))
    return mainFrame || this.page
  }

  /** Widget de combobox custom do ServiceNow (Select2 / sn-select) — clica pra
   * abrir, filtra pela caixa de busca se ela aparecer, clica na opção com fallbacks. */
  private async selectFromComboBox(fieldLabel: string, optionText: string): Promise<void> {
    if (!optionText) return
    const scope = this.getScope()

    // No Select2 do ServiceNow, o elemento de foco (.select2-focusser) fica sob o container visível (<a class="select2-choice">).
    // O clique direto no focusser causa "intercepts pointer events". Usar { force: true } no container visível resolve 100%.
    let opened = false

    // 1. Tentar localizar o container visível do Select2 associado à label
    const openCandidates = [
      // Container pai do Select2 que contém o label ou a classe select2-choice
      scope.locator('.select2-container').filter({ has: scope.getByText(fieldLabel, { exact: false }) }).locator('.select2-choice').first(),
      scope.locator('div.form-group', { hasText: fieldLabel }).locator('.select2-choice, .select2-container').first(),
      scope.locator('.select2-choice').first(),
      scope.getByRole('combobox', { name: fieldLabel }).first(),
      scope.getByLabel(fieldLabel, { exact: false }).first()
    ]

    for (const candidate of openCandidates) {
      try {
        if (await candidate.isVisible({ timeout: 1200 }).catch(() => false)) {
          await candidate.click({ force: true })
          opened = true
          break
        }
      } catch {
        /* tenta próximo */
      }
    }

    if (!opened) {
      await scope.getByLabel(fieldLabel, { exact: false }).first().click({ force: true }).catch(() => {})
    }

    await this.page.waitForTimeout(300)

    // 2. Tenta digitar na caixa de busca do Select2 se aparecer (.select2-input)
    const searchBox = scope
      .locator('.select2-input, input.select2-search, input[role="combobox"]')
      .last()
      .or(scope.getByRole('textbox').last())

    if (await searchBox.isVisible({ timeout: 1500 }).catch(() => false)) {
      await searchBox.fill(optionText)
      await this.page.waitForTimeout(300) // filtro client-side
    }

    // 3. Seletores em cascata de fallback pra cobrir a estrutura Select2 e papéis ARIA do ServiceNow
    const optionLocators = [
      scope.locator('.select2-result-label', { hasText: optionText }).first(),
      scope.locator('li.select2-result', { hasText: optionText }).first(),
      scope.locator('.select2-results li', { hasText: optionText }).first(),
      scope.getByRole('option', { name: optionText, exact: true }).first(),
      scope.getByRole('option', { name: optionText }).first(),
      scope.locator('li', { hasText: optionText }).first(),
      scope.locator('div', { hasText: optionText }).first(),
      scope.getByText(optionText, { exact: true }).first()
    ]

    let selected = false
    for (const locator of optionLocators) {
      try {
        if (await locator.isVisible({ timeout: 1500 }).catch(() => false)) {
          await locator.click({ force: true })
          selected = true
          break
        }
      } catch {
        /* tenta próximo seletor */
      }
    }

    if (!selected) {
      // Tenta um clique forçado caso o elemento esteja oculto por overlay
      await scope.getByText(optionText, { exact: true }).first().click({ force: true }).catch(() => {})
    }
  }

  private async fillText(fieldLabel: string, value: string | number): Promise<void> {
    const scope = this.getScope()
    const field = scope.getByLabel(fieldLabel, { exact: false }).first()
    await field.waitFor({ state: 'visible', timeout: 10000 })
    await field.fill(String(value))
  }

  private async uploadPhotos(urls: string[], localPhotoFiles: string[] = []): Promise<void> {
    const tempPaths: string[] = []
    try {
      if (localPhotoFiles && localPhotoFiles.length > 0) {
        // Envia as fotos locais geradas pelo Módulo 23:
        // pic1: foto com o polígono desenhado
        // pic2: foto regional com o zoom do defeito
        for (let i = 0; i < localPhotoFiles.length; i++) {
          const srcPath = localPhotoFiles[i]
          const ext = path.extname(srcPath) || '.jpeg'
          const dstPath = path.join(
            os.tmpdir(),
            `${String(i + 1).padStart(2, '0')}_arthwind_${Date.now()}_${i}${ext}`
          )
          fs.copyFileSync(srcPath, dstPath)
          tempPaths.push(dstPath)
        }
        this.log(`  Enviando ${tempPaths.length} foto(s) gerada(s) pelo Módulo 23 (polígono + região)...`)
      } else if (urls && urls.length > 0) {
        // Fallback: faz o download das fotos a partir dos links da nuvem
        for (let i = 0; i < urls.length; i++) {
          const p = path.join(
            os.tmpdir(),
            `${String(i + 1).padStart(2, '0')}_arthwind_${Date.now()}_${i}.jpg`
          )
          const buffer = await fetchBuffer(urls[i])
          fs.writeFileSync(p, buffer)
          tempPaths.push(p)
        }
        this.log(`  Enviando ${tempPaths.length} foto(s) baixada(s) do link...`)
      }

      if (tempPaths.length > 0) {
        const scope = this.getScope()
        const fileInput = scope.locator('input[type="file"]').first()
        await fileInput.setInputFiles(tempPaths)
      }
    } finally {
      for (const p of tempPaths) {
        try {
          fs.unlinkSync(p)
        } catch {
          /* ignore */
        }
      }
    }
  }

  async fill(data: DamageReportRow, localPhotosDir?: string): Promise<void> {
    this.log(
      `Preenchendo: ${data.bladeSerialNumber} | ${data.failureType} | DF ${data.dfDistanceStart}-${data.dfDistanceEnd}`
    )

    await this.selectFromComboBox('Blade serial number', data.bladeSerialNumber)
    await this.selectFromComboBox('Sub Component', data.subComponent)
    await this.selectFromComboBox('Failure Type', data.failureType)

    if (data.damageDescription) {
      await this.fillText('Damage Description', data.damageDescription)
    }

    await this.fillText('DF distance - Start (m)', data.dfDistanceStart)
    await this.fillText('DF distance - End (m)', data.dfDistanceEnd)
    await this.fillText('Profile Depth (%) Start', data.profileDepthStart)
    await this.fillText('Profile Depth (%) End', data.profileDepthEnd)

    // Cascata: cada campo só popula de verdade depois do anterior ser escolhido.
    await this.selectFromComboBox('Inside/Outside', data.insideOutside)
    await this.selectFromComboBox('Blade section', data.bladeSection)
    await this.selectFromComboBox('Blade sub-section', data.bladeSubSection)
    await this.selectFromComboBox('Blade area', data.bladeArea)

    await this.fillText('Size (mm)', data.sizeMm)
    await this.fillText('Amount of Findings', data.amountOfFindings ?? 1)

    // Busca fotos locais geradas pelo Módulo 23 (_pic1.jpeg com polígono e _pic2.jpeg regional)
    const localPhotos = localPhotosDir ? findLocalPhotosForDamage(localPhotosDir, data) : []
    await this.uploadPhotos(data.photoUrls, localPhotos)


    // Botão de submissão do formulário: DEVE ser Submit/Save/Insert/Salvar,
    // E NÃO o botão "Create Damage Entry" que abre um formulário novo.
    const scope = this.getScope()
    const submitBtnLocators = [
      scope.getByRole('button', { name: /^submit$/i }),
      scope.getByRole('button', { name: /^save$/i }),
      scope.getByRole('button', { name: /^insert$/i }),
      scope.getByRole('button', { name: /^salvar$/i }),
      scope.getByRole('button', { name: /submit|insert|salvar|gravar/i })
    ]

    let submitted = false
    for (const btn of submitBtnLocators) {
      try {
        if (await btn.isVisible({ timeout: 1500 }).catch(() => false)) {
          await btn.click()
          submitted = true
          break
        }
      } catch {
        /* tenta próximo */
      }
    }

    if (!submitted) {
      const fallback = scope.getByRole('button', { name: /submit|save|insert|salvar/i }).first()
      await fallback.click()
    }

    await this.page.waitForLoadState('networkidle').catch(() => {})
    await this.page.waitForTimeout(1000)
  }

}

// ─── Leitura da planilha (mesmo layout de saída do SNOW Processor) ──────────
// A ordem bate com OUTPUT_HEADERS de snowProcessor.ts:
// A Blade serial | B Sub Component | C Failure Type | D Damage Description |
// E DF Start | F DF End | G PD Start | H PD End | I Inside/Outside |
// J Blade section | K Blade sub-section | L Blade area | M Size | N Link das fotos

async function readDamageRows(excelPath: string): Promise<DamageReportRow[]> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(excelPath)
  const ws = wb.worksheets[0]
  const rows: DamageReportRow[] = []

  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r)
    const bladeSerial = String(row.getCell(1).value ?? '').trim()
    if (!bladeSerial) continue
    // As 5 linhas "Blank Image" que o SNOW Processor sempre anexa no fim (placeholder
    // exigido pelo procedimento, não é dano real de nenhuma pá) não têm serial real —
    // tentar selecionar isso no combobox "Blade serial number" sempre falharia.
    if (bladeSerial.toLowerCase() === 'blank image') continue

    const photoLinkRaw = String(row.getCell(14).value ?? '').trim()
    const photoUrls = photoLinkRaw
      ? photoLinkRaw
          .split(/[\n,;]+/)
          .map((s) => s.trim())
          .filter(Boolean)
      : []

    rows.push({
      bladeSerialNumber: bladeSerial,
      subComponent: String(row.getCell(2).value ?? '').trim(),
      failureType: String(row.getCell(3).value ?? '').trim(),
      damageDescription: String(row.getCell(4).value ?? '').trim(),
      dfDistanceStart: Number(row.getCell(5).value ?? 0),
      dfDistanceEnd: Number(row.getCell(6).value ?? 0),
      profileDepthStart: (row.getCell(7).value as number | string) ?? '',
      profileDepthEnd: (row.getCell(8).value as number | string) ?? '',
      insideOutside: String(row.getCell(9).value ?? '').trim(),
      bladeSection: String(row.getCell(10).value ?? '').trim(),
      bladeSubSection: String(row.getCell(11).value ?? '').trim(),
      bladeArea: String(row.getCell(12).value ?? '').trim(),
      sizeMm: Number(row.getCell(13).value ?? 0),
      amountOfFindings: 1,
      photoUrls
    })
  }
  return rows
}

/** Extrai o S/N de 4 dígitos exatos do serial completo (ex.: "A1 811 0410 0115" -> "0410") */
export function extractBladeSn(bladeSerial: string): string {
  if (!bladeSerial) return ''
  const trimmed = bladeSerial.trim()

  // Estrutura padrão: "A1 811 0410 0115" -> tokens[2] é o "0410" (S/N da Pá)
  const tokens = trimmed.split(/[\s\-_]+/)
  if (tokens.length >= 4 && /^\d{4}$/.test(tokens[2])) {
    return tokens[2]
  }

  // Captura o grupo de 4 dígitos que vem imediatamente antes do SET (último grupo de 4 dígitos)
  const match = trimmed.match(/\b(\d{4})\s+\d{4}\b/)
  if (match) {
    return match[1]
  }

  // Fallback
  const match4 = trimmed.match(/\b\d{4}\b/)
  if (match4) {
    return match4[0]
  }

  return trimmed
}

// ─── Leitura e Inspeção de Pás da Planilha ─────────────────────────────────

export interface BladeSummary {
  bladeSerialNumber: string
  shortSn: string
  count: number
  startRow: number // 1-based index na planilha Excel
  endRow: number // 1-based index na planilha Excel
}

export async function getSpreadsheetBlades(
  excelPath: string
): Promise<{ success: boolean; blades: BladeSummary[]; error?: string }> {
  try {
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(excelPath)
    const ws = wb.worksheets[0]
    const map = new Map<string, BladeSummary>()

    for (let r = 2; r <= ws.rowCount; r++) {
      const row = ws.getRow(r)
      const bladeSerial = String(row.getCell(1).value ?? '').trim()
      if (!bladeSerial || bladeSerial.toLowerCase() === 'blank image') continue

      // Extrai S/N de 4 dígitos exatos (ex.: "A1 811 0410 0115" -> "0410")
      const shortSn = extractBladeSn(bladeSerial)

      if (!map.has(bladeSerial)) {
        map.set(bladeSerial, {
          bladeSerialNumber: bladeSerial,
          shortSn,
          count: 1,
          startRow: r,
          endRow: r
        })
      } else {
        const item = map.get(bladeSerial)!
        item.count += 1
        item.endRow = r
      }
    }

    return { success: true, blades: Array.from(map.values()) }
  } catch (err: any) {
    return { success: false, blades: [], error: err.message }
  }
}

// ─── Busca de Fotos Locais Geradas pelo Módulo 23 ───────────────────────────

function findLocalPhotosForDamage(localPhotosDir: string, data: DamageReportRow): string[] {
  if (!localPhotosDir || !fs.existsSync(localPhotosDir)) return []

  // S/N de 4 dígitos exatos (ex: "A1 811 0410 0115" -> "0410")
  const shortSn = extractBladeSn(data.bladeSerialNumber)

  // Padrão do DF (ex: "DF59-59.1" ou "DF59-59")
  const dfPattern = `DF${data.dfDistanceStart}-${data.dfDistanceEnd}`

  const matches: string[] = []

  function scan(dir: string) {
    try {
      const items = fs.readdirSync(dir, { withFileTypes: true })
      for (const item of items) {
        const full = path.join(dir, item.name)
        if (item.isDirectory()) {
          scan(full)
        } else if (item.isFile()) {
          const lower = item.name.toLowerCase()
          if (
            (lower.includes('pic1') || lower.includes('pic2')) &&
            (lower.includes(dfPattern.toLowerCase()) || lower.includes(`df${data.dfDistanceStart}`)) &&
            (!shortSn || lower.includes(shortSn.toLowerCase()))
          ) {
            matches.push(full)
          }
        }
      }
    } catch {}
  }


  scan(localPhotosDir)

  // Garante que pic1 (polígono) venha antes de pic2 (zoom regional)
  matches.sort((a, b) => {
    const aIsPic1 = a.toLowerCase().includes('pic1') ? 0 : 1
    const bIsPic1 = b.toLowerCase().includes('pic1') ? 0 : 1
    if (aIsPic1 !== bIsPic1) return aIsPic1 - bIsPic1
    return a.localeCompare(b)
  })

  return matches
}

// ─── Entry point ──────────────────────────────────────────────────────────

export interface RunAutomationOptions {
  headless?: boolean
  startRow?: number // 1-based, inclusive
  endRow?: number // 1-based, inclusive
  selectedBlades?: string[] // Lista de seriais de pás selecionados para processar
  localPhotosDir?: string // Pasta local com as fotos geradas pelo Módulo 23 (contendo _pic1 e _pic2)
}


export interface RunAutomationResult {
  success: boolean
  processed: number
  failed: number
  errors: string[]
  error?: string
}

export async function runSnowDamageAutomation(
  excelPath: string,
  incidentUrl: string,
  options: RunAutomationOptions,
  log_fn?: LogFn
): Promise<RunAutomationResult> {
  const log = log_fn || (() => {})
  try {
    const allRows = await readDamageRows(excelPath)
    if (allRows.length === 0) {
      return { success: false, processed: 0, failed: 0, errors: [], error: 'Nenhuma linha válida na planilha.' }
    }

    // Filtragem opcional por Pás selecionadas pelo usuário
    let filteredRows = allRows
    if (options.selectedBlades && options.selectedBlades.length > 0) {
      const selectedSet = new Set(options.selectedBlades.map((b) => b.trim()))
      filteredRows = allRows.filter((r) => selectedSet.has(r.bladeSerialNumber.trim()))
      log(`Filtro por Pás ativo: ${options.selectedBlades.length} pá(s) selecionada(s) -> ${filteredRows.length} linha(s).`)
    }

    if (filteredRows.length === 0) {
      return { success: false, processed: 0, failed: 0, errors: [], error: 'Nenhuma linha corresponde às pás selecionadas.' }
    }

    const start = Math.max(0, (options.startRow ?? 1) - 1)
    const end = Math.min(filteredRows.length, options.endRow ?? filteredRows.length)
    const rows = filteredRows.slice(start, end)


    log(`${rows.length} linha(s) a processar (de ${allRows.length} no total da planilha).`)

    const context = await getContext(options.headless ?? false)
    const page = context.pages()[0] || (await context.newPage())

    let processed = 0
    let failed = 0
    const errors: string[] = []

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const prefix = `[${i + 1}/${rows.length}]`
      try {
        // Cada defeito volta pro formulário "Add Damage Entry" a partir da tela do
        // Inspection Report do incidente. AJUSTAR conforme o fluxo real navegado —
        // ver docs/snow-automation.md pros seletores confirmados/pendentes.
        if (!page.url().startsWith(incidentUrl)) {
          await page.goto(incidentUrl, { waitUntil: 'domcontentloaded' })
        }

        // Busca o botão "Create Damage Entry" ou "Add Damage Entry" na página ou dentro de um iframe
        const scopes = [page, ...page.frames()]
        let clickedAdd = false

        for (const s of scopes) {
          const locators = [
            s.getByRole('button', { name: /create damage entry|add damage entry|nova entrada|criar dano|new damage/i }),
            s.getByRole('link', { name: /create damage entry|add damage entry|nova entrada|criar dano|new damage/i }),
            s.getByText(/create damage entry|add damage entry|nova entrada|criar dano/i).first()
          ]
          for (const loc of locators) {
            try {
              if (await loc.isVisible({ timeout: 1500 }).catch(() => false)) {
                await loc.click()
                clickedAdd = true
                break
              }
            } catch {
              /* tenta próximo */
            }
          }
          if (clickedAdd) break
        }

        if (!clickedAdd) {
          // Fallback final
          await page.getByRole('button', { name: /create damage entry|add damage entry/i }).click({ timeout: 5000 })
        }

        // Aguarda a abertura do formulário (espera o campo "Blade serial number" ficar disponível)
        const activeScope = page.frames().find((f) => f.name() === 'gsft_main' || f.url().includes('.do')) || page
        await activeScope.getByLabel('Blade serial number', { exact: false }).first().waitFor({ state: 'visible', timeout: 12000 }).catch(() => {})


        const filler = new DamageEntryFiller(page, (m) => log(`  ${prefix} ${m}`))
        await filler.fill(row, options.localPhotosDir)



        processed++
        log(`✓ ${prefix} OK: ${row.bladeSerialNumber} — ${row.failureType}`)
      } catch (err: any) {
        failed++
        const msg = `✗ ${prefix} FALHOU: ${row.bladeSerialNumber} — ${row.failureType}: ${err.message}`
        errors.push(msg)
        log(msg)
        // Não derruba o lote inteiro — segue pra próxima linha.
      }
    }

    log(`Concluído: ${processed} ok, ${failed} falha(s) de ${rows.length}.`)
    return { success: true, processed, failed, errors }
  } catch (err: any) {
    return { success: false, processed: 0, failed: 0, errors: [], error: err.message }
  }
}
