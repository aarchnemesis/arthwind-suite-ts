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
import { SnowMappings } from './snowProcessor'


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
  private async selectFromComboBox(
    fieldLabel: string,
    optionText: string,
    waitAfterMs: number = 600
  ): Promise<void> {
    if (!optionText) return
    const scope = this.getScope()
    this.log(`    Selecionando [${fieldLabel}]: "${optionText}"`)

    // No Select2 do ServiceNow, o elemento de foco (.select2-focusser) fica sob o container visível (<a class="select2-choice">).
    // O clique direto no focusser causa "intercepts pointer events". Usar { force: true } no container visível resolve 100%.
    let opened = false

    // 1. Tentar localizar o container visível do Select2 associado à label
    const openCandidates = [
      scope.locator('.select2-container').filter({ has: scope.getByText(fieldLabel, { exact: false }) }).locator('.select2-choice').first(),
      scope.locator('div.form-group', { hasText: fieldLabel }).locator('.select2-choice, .select2-container').first(),
      scope.locator('.form-group, .sc-form-field').filter({ hasText: fieldLabel }).locator('.select2-choice').first(),
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
      await this.page.waitForTimeout(400) // tempo pro Select2 filtrar as opções no DOM
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

    // Aguarda a reação/cascata client-side do ServiceNow para popular os campos dependentes (ex: Sub Component -> Failure Type)
    await this.page.waitForTimeout(waitAfterMs)
  }

  private async fillText(fieldLabel: string, value: string | number): Promise<void> {
    const scope = this.getScope()
    const field = scope.getByLabel(fieldLabel, { exact: false }).first()
    await field.waitFor({ state: 'visible', timeout: 10000 })
    await field.fill(String(value))
  }

  private buildPhotoBaseName(data: DamageReportRow): string {
    const shortSn = extractBladeSn(data.bladeSerialNumber)
    const paddedBladeSn = String(shortSn).replace(/^B/i, '').padStart(4, '0')
    const bladeCode = `B${paddedBladeSn}`

    const areaCode = SnowMappings.areaToFileCode(data.bladeArea)

    let secCode = 'S1'
    if (data.bladeSection === 'Section 2') secCode = 'S2'
    else if (data.bladeSection === 'Section 3') secCode = 'S3'
    else if (data.bladeSection.match(/^Section\s*(\d+)$/i)) {
      const match = data.bladeSection.match(/^Section\s*(\d+)$/i)
      if (match) secCode = `S${match[1]}`
    } else if (data.bladeSection.match(/^S\d+$/i)) {
      secCode = data.bladeSection.toUpperCase()
    }

    return `${bladeCode}_${secCode}_${areaCode}_DF${data.dfDistanceStart}-${data.dfDistanceEnd}`
  }

  private async uploadPhotos(
    data: DamageReportRow,
    localPhotoFiles: string[] = []
  ): Promise<void> {
    const tempPaths: string[] = []

    try {
      if (localPhotoFiles && localPhotoFiles.length > 0) {
        // Preserva 100% ESTRITAMENTE a nomenclatura original do Módulo 23 (ex: B0414_S2_PS_DF59.2-59.2_pic1.jpeg)
        for (const srcPath of localPhotoFiles) {
          const originalName = path.basename(srcPath)
          const dstPath = path.join(os.tmpdir(), originalName)
          fs.copyFileSync(srcPath, dstPath)
          tempPaths.push(dstPath)
        }
        this.log(`  Enviando ${tempPaths.length} foto(s) com nomes estritos do Módulo 23 (${tempPaths.map(p => path.basename(p)).join(', ')})...`)
      } else if (data.photoUrls && data.photoUrls.length > 0) {
        // Fallback da nuvem: gera pic1 e pic2 com o nome estrito oficial do Módulo 23 (SEM prefixo 01_ ou 02_)
        const baseName = this.buildPhotoBaseName(data)
        const buffer = await fetchBuffer(data.photoUrls[0])

        const p1Name = `${baseName}_pic1.jpeg`
        const p2Name = `${baseName}_pic2.jpeg`
        const dst1 = path.join(os.tmpdir(), p1Name)
        const dst2 = path.join(os.tmpdir(), p2Name)

        fs.writeFileSync(dst1, buffer)
        fs.writeFileSync(dst2, buffer)
        tempPaths.push(dst1, dst2)
        this.log(`  Enviando 2 foto(s) com nomes estritos (${p1Name}, ${p2Name})...`)
      }

      if (tempPaths.length > 0) {
        const scope = this.getScope()

        // 1. Clica no botão "Add attachments" (📎) no ServiceNow para ativar o input
        const attachmentBtn = scope
          .locator('.attachment-button, [title*="attachment"]')
          .or(scope.getByText(/add attachments/i))
          .or(scope.locator('a, button', { hasText: /attachment/i }))
          .first()

        let setViaChooser = false
        if (await attachmentBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
          // Intercepta o evento 'filechooser' nativo do Chromium para impedir a abertura da janela do Windows Explorer
          const fileChooserPromise = this.page.waitForEvent('filechooser', { timeout: 3000 }).catch(() => null)
          await attachmentBtn.click({ force: true }).catch(() => {})
          const fileChooser = await fileChooserPromise

          if (fileChooser) {
            await fileChooser.setFiles(tempPaths)
            setViaChooser = true
            this.log(`  ✓ ${tempPaths.length} foto(s) anexadas via filechooser interceptado (sem janela do Explorer)!`)
          }
        }

        if (!setViaChooser) {
          // Fallback de injeção direta no input[type="file"]
          const fileInput = scope.locator('input[type="file"]').last().or(scope.locator('input[type="file"]').first())
          await fileInput.setInputFiles(tempPaths)
          this.log(`  ✓ ${tempPaths.length} foto(s) anexadas via input direto no DOM!`)
        }

        await this.page.waitForTimeout(1200)

      }
    } catch (err: any) {
      this.log(`  ⚠ Erro no upload de fotos: ${err.message || err}`)
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


  private async addOptionalFields(optionSearchText: string = '241'): Promise<void> {
    const scope = this.getScope()
    this.log(`    Configurando Optional Fields ("${optionSearchText}")...`)

    try {
      // 1. Marca o checkbox "Set Optional Fields" se não estiver marcado
      const setOptionalCheckbox = scope
        .locator('label', { hasText: /set optional fields/i })
        .locator('input[type="checkbox"]')
        .or(scope.getByLabel(/set optional fields/i))
        .first()

      if (await setOptionalCheckbox.isVisible({ timeout: 2000 }).catch(() => false)) {
        const isChecked = await setOptionalCheckbox.isChecked().catch(() => false)
        if (!isChecked) {
          await setOptionalCheckbox.check({ force: true }).catch(async () => {
            await setOptionalCheckbox.click({ force: true })
          })
          this.log(`    ✓ Checkbox 'Set Optional Fields' marcado.`)
          await this.page.waitForTimeout(500)
        }
      } else {
        await scope.getByText(/set optional fields/i).first().click({ force: true }).catch(() => {})
        await this.page.waitForTimeout(500)
      }

      // Se a opção SN_241 já está presente na tabela Optional Fields, não adiciona de novo
      const alreadyAdded = await scope.getByText(/SN_241|NR81\.5/i).first().isVisible({ timeout: 1000 }).catch(() => false)
      if (alreadyAdded) {
        this.log(`    ✓ Opção SN_241 já está presente na tabela Optional Fields.`)
        return
      }

      // 2. Clicar no botão "Add" da seção Optional Fields para abrir a modal "Add Row"
      const addBtns = scope.locator('button, a.btn, input[type="button"]').filter({ hasText: /^add$/i })
      let clickedAddTable = false
      for (let i = 0; i < await addBtns.count(); i++) {
        const btn = addBtns.nth(i)
        if (await btn.isVisible().catch(() => false)) {
          await btn.click({ force: true })
          clickedAddTable = true
          break
        }
      }

      if (!clickedAddTable) {
        await scope.getByText(/^add$/i).first().click({ force: true }).catch(() => {})
      }

      this.log(`    ✓ Clicado no botão Add. Aguardando a modal 'Add Row'...`)
      await this.page.waitForTimeout(600)

      // 3. Modal "Add Row" (busca na página global para encontrar a modal e a lista Select2 anexada ao document.body)
      const modal = this.page.locator('.modal-dialog, .modal-content, [role="dialog"]').first()
      await modal.waitFor({ state: 'visible', timeout: 5000 })

      // Clica no campo "Option" no modal (Select2)
      const optionField = modal
        .locator('.select2-choice')
        .or(modal.getByRole('combobox', { name: /option/i }))
        .or(modal.getByLabel(/option/i, { exact: false }))
        .first()

      await optionField.click({ force: true })
      await this.page.waitForTimeout(300)

      // Digita "241" na caixa de busca do Select2 visível no body
      const searchBox = this.page
        .locator('.select2-input:visible, input.select2-search:visible, input[role="combobox"]:visible')
        .last()

      if (await searchBox.isVisible({ timeout: 2000 }).catch(() => false)) {
        await searchBox.fill(optionSearchText)
        await this.page.waitForTimeout(400)
        // Pressiona Enter para confirmar a seleção destacada no Select2
        await searchBox.press('Enter').catch(() => {})
        await this.page.waitForTimeout(300)
      }

      // Clicar explicitamente na opção visível no Select2 caso o Enter não tenha fechado o dropdown
      const optionItem = this.page
        .locator('.select2-result-label:visible, li.select2-result:visible, .select2-highlighted:visible', { hasText: /241|SN_241/i })
        .first()

      if (await optionItem.isVisible({ timeout: 1000 }).catch(() => false)) {
        await optionItem.click({ force: true }).catch(() => {})
        await this.page.waitForTimeout(300)
      }

      // 4. Marca o checkbox "True / False" se disponível no modal
      const trueFalseCheckbox = modal
        .getByLabel(/true\s*\/\s*false/i)
        .or(modal.locator('label', { hasText: /true\s*\/\s*false/i }).locator('input[type="checkbox"]'))
        .or(modal.locator('input[type="checkbox"]'))
        .first()

      if (await trueFalseCheckbox.isVisible({ timeout: 1500 }).catch(() => false)) {
        const isTrueChecked = await trueFalseCheckbox.isChecked().catch(() => false)
        if (!isTrueChecked) {
          await trueFalseCheckbox.check({ force: true }).catch(async () => {
            await trueFalseCheckbox.click({ force: true })
          })
          this.log(`    ✓ Checkbox 'True / False' marcado.`)
          await this.page.waitForTimeout(300)
        }
      }

      // 5. Clicar no botão "Add" DENTRO da modal para salvar a linha
      const modalAddBtn = modal
        .getByRole('button', { name: /^add$/i })
        .or(modal.locator('button.btn-primary', { hasText: /^add$/i }))
        .first()

      await modalAddBtn.click({ force: true })
      this.log(`    ✓ Opção SN_241 adicionada com sucesso na modal!`)
      await this.page.waitForTimeout(800)

    } catch (err: any) {
      this.log(`    ⚠ Erro ao configurar Optional Fields: ${err.message || err}`)
    }
  }

  async fill(data: DamageReportRow, localPhotoFiles: string[] = [], autoSubmit: boolean = false): Promise<void> {
    this.log(
      `Preenchendo: ${data.bladeSerialNumber} | ${data.subComponent} | ${data.failureType} | DF ${data.dfDistanceStart}-${data.dfDistanceEnd}`
    )

    await this.selectFromComboBox('Blade serial number', data.bladeSerialNumber, 800)
    // 1200ms de espera após selecionar Sub Component para permitir que o ServiceNow execute o Script Client que popula o Failure Type
    await this.selectFromComboBox('Sub Component', data.subComponent, 1200)
    await this.selectFromComboBox('Failure Type', data.failureType, 800)

    if (data.damageDescription) {
      await this.fillText('Damage Description', data.damageDescription)
    }

    await this.fillText('DF distance - Start (m)', data.dfDistanceStart)
    await this.fillText('DF distance - End (m)', data.dfDistanceEnd)
    await this.fillText('Profile Depth (%) Start', data.profileDepthStart)
    await this.fillText('Profile Depth (%) End', data.profileDepthEnd)

    // Cascata: cada campo só popula de verdade depois do anterior ser escolhido.
    await this.selectFromComboBox('Inside/Outside', data.insideOutside, 800)
    await this.selectFromComboBox('Blade section', data.bladeSection, 800)
    await this.selectFromComboBox('Blade sub-section', data.bladeSubSection, 800)
    await this.selectFromComboBox('Blade area', data.bladeArea, 800)

    await this.fillText('Size (mm)', data.sizeMm)
    await this.fillText('Amount of Findings', data.amountOfFindings ?? 1)

    // Preenche a caixa de Optional fields (opções: SN_241) e clica no botão Add
    await this.addOptionalFields('241')

    // Anexa as fotos com nomes estritos do Módulo 23
    await this.uploadPhotos(data, localPhotoFiles)



    // Submissão do formulário: somente realizada se autoSubmit for true
    if (autoSubmit) {
      this.log(`  Submetendo formulário...`)
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
    } else {
      this.log(`  ✓ Formulário e fotos preenchidos! (Modo conferência ativo: mantendo formulário aberto).`)
    }
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

export interface LocalPhotoPair {
  pic1Path?: string
  pic2Path?: string
}

/**
 * Mapeia previamente a pasta Fotos/ gerada pelo Módulo 23 no início da automação.
 * Indexa cada defeito pelas chaves (ex.: "0414_df59.2-59.2" ou "0414_df59.2")
 * com os caminhos absolutos exatos das fotos pic1.jpeg e pic2.jpeg no disco.
 */
export function buildLocalPhotosMap(localPhotosDir: string): Map<string, LocalPhotoPair> {
  const map = new Map<string, LocalPhotoPair>()
  if (!localPhotosDir || !fs.existsSync(localPhotosDir)) return map

  function scan(dir: string) {
    try {
      const items = fs.readdirSync(dir, { withFileTypes: true })
      for (const item of items) {
        const full = path.join(dir, item.name)
        if (item.isDirectory()) {
          scan(full)
        } else if (item.isFile()) {
          const lower = item.name.toLowerCase()
          if (!lower.endsWith('.jpeg') && !lower.endsWith('.jpg') && !lower.endsWith('.png')) continue

          const shortSn = extractBladeSn(item.name).toLowerCase()
          const dfMatch = lower.match(/df[\d\.\-]+/)
          const dfKey = dfMatch ? dfMatch[0] : ''

          if (shortSn && dfKey) {
            const key = `${shortSn}_${dfKey}`
            if (!map.has(key)) {
              map.set(key, {})
            }
            const entry = map.get(key)!
            if (lower.includes('pic1')) {
              entry.pic1Path = full
            } else if (lower.includes('pic2')) {
              entry.pic2Path = full
            }
          }
        }
      }
    } catch {}
  }

  scan(localPhotosDir)
  return map
}

function findLocalPhotosFromMap(photosMap: Map<string, LocalPhotoPair>, data: DamageReportRow): string[] {
  if (!photosMap || photosMap.size === 0) return []

  const shortSn = extractBladeSn(data.bladeSerialNumber).toLowerCase()
  const df1 = `df${data.dfDistanceStart}-${data.dfDistanceEnd}`.toLowerCase()
  const df2 = `df${data.dfDistanceStart}`.toLowerCase()

  const entry = photosMap.get(`${shortSn}_${df1}`) || photosMap.get(`${shortSn}_${df2}`)
  const result: string[] = []

  if (entry) {
    if (entry.pic1Path) result.push(entry.pic1Path)
    if (entry.pic2Path) result.push(entry.pic2Path)
  }

  return result
}

export function findLocalPhotosForDamage(localPhotosDir: string, data: DamageReportRow): string[] {
  if (!localPhotosDir || !fs.existsSync(localPhotosDir)) return []

  const shortSn = extractBladeSn(data.bladeSerialNumber).toLowerCase()
  const dfStartStr = String(data.dfDistanceStart).trim().toLowerCase()
  const dfEndStr = String(data.dfDistanceEnd).trim().toLowerCase()

  const foundPic1: string[] = []
  const foundPic2: string[] = []

  function scan(dir: string) {
    try {
      const items = fs.readdirSync(dir, { withFileTypes: true })
      for (const item of items) {
        const full = path.join(dir, item.name)
        if (item.isDirectory()) {
          scan(full)
        } else if (item.isFile()) {
          const lower = item.name.toLowerCase()
          if (!lower.endsWith('.jpeg') && !lower.endsWith('.jpg') && !lower.endsWith('.png')) continue

          const matchSn = !shortSn || lower.includes(shortSn)
          const matchDf = lower.includes(`df${dfStartStr}`) || lower.includes(`df${dfEndStr}`)

          if (matchSn && matchDf) {
            if (lower.includes('pic1')) foundPic1.push(full)
            else if (lower.includes('pic2')) foundPic2.push(full)
          }
        }
      }
    } catch {}
  }

  scan(localPhotosDir)

  const result: string[] = []
  if (foundPic1.length > 0) result.push(foundPic1[0])
  if (foundPic2.length > 0) result.push(foundPic2[0])

  return result
}

// ─── Entry point ──────────────────────────────────────────────────────────

export interface RunAutomationOptions {
  headless?: boolean
  startRow?: number // 1-based, inclusive
  endRow?: number // 1-based, inclusive
  selectedBlades?: string[] // Lista de seriais de pás selecionados para processar
  localPhotosDir?: string // Pasta local com as fotos geradas pelo Módulo 23 (contendo _pic1 e _pic2)
  autoSubmit?: boolean // Se true, clica em Submit no formulário. Padrão: false.
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

    // Mapeia previamente todas as fotos da pasta local Fotos/ do Módulo 23
    const photosMap = options.localPhotosDir ? buildLocalPhotosMap(options.localPhotosDir) : new Map()
    if (photosMap.size > 0) {
      log(`✓ Mapeamento prévio de fotos concluído: ${photosMap.size} conjunto(s) de fotos indexado(s).`)
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
          await page.getByRole('button', { name: /create damage entry|add damage entry/i }).click({ timeout: 5000 })
        }

        const activeScope = page.frames().find((f) => f.name() === 'gsft_main' || f.url().includes('.do')) || page
        await activeScope.getByLabel('Blade serial number', { exact: false }).first().waitFor({ state: 'visible', timeout: 12000 }).catch(() => {})

        // Cruza a linha atual com o mapa pré-indexado de fotos
        const localPhotos = options.localPhotosDir
          ? findLocalPhotosFromMap(photosMap, row)
          : []

        const filler = new DamageEntryFiller(page, (m) => log(`  ${prefix} ${m}`))
        await filler.fill(row, localPhotos, options.autoSubmit ?? false)

        processed++
        log(`✓ ${prefix} OK: ${row.bladeSerialNumber} — ${row.failureType}`)

        if (!(options.autoSubmit ?? false)) {
          log(`ℹ Modo conferência manual ativo: o formulário foi preenchido e mantido aberto no navegador para sua revisão.`)
          break
        }


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
