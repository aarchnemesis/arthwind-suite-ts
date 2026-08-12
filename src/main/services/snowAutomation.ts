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
import sharp from 'sharp'
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
  isBlankImage?: boolean
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

export async function ensureBlankImageFile(localPhotosDir?: string): Promise<string> {
  if (localPhotosDir && fs.existsSync(localPhotosDir)) {
    const candidates = ['Blank Image.jpg', 'blank_image.jpg', 'Blank Image.jpeg', 'blank.jpg']
    for (const cand of candidates) {
      const p = path.join(localPhotosDir, cand)
      if (fs.existsSync(p)) return p
    }
  }

  const dst = path.join(os.tmpdir(), 'Blank Image.jpg')
  if (!fs.existsSync(dst)) {
    try {
      await sharp({
        create: {
          width: 800,
          height: 600,
          channels: 3,
          background: { r: 255, g: 255, b: 255 }
        }
      }).jpeg({ quality: 80 }).toFile(dst)
    } catch {}
  }
  return dst
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
    const locators = [
      scope.getByLabel(fieldLabel, { exact: false }).first(),
      scope.locator(`textarea[aria-label*="${fieldLabel}"], input[aria-label*="${fieldLabel}"]`).first(),
      scope.locator(`div.form-group:has-text("${fieldLabel}") textarea, div.form-group:has-text("${fieldLabel}") input`).first()
    ]

    for (const field of locators) {
      try {
        if (await field.isVisible({ timeout: 3000 }).catch(() => false)) {
          await field.fill(String(value))
          return
        }
      } catch {}
    }

    const primary = scope.getByLabel(fieldLabel, { exact: false }).first()
    await primary.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {})
    await primary.fill(String(value)).catch(() => {})
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
      if (data.isBlankImage) {
        const blankPath = await ensureBlankImageFile()
        const dst1 = path.join(os.tmpdir(), 'Blank Image.jpg')
        if (blankPath !== dst1) {
          fs.copyFileSync(blankPath, dst1)
        }
        tempPaths.push(dst1, dst1)
        this.log(`  Enviando 2 foto(s) Blank Image...`)
      } else if (localPhotoFiles && localPhotoFiles.length > 0) {

        // Preserva 100% ESTRITAMENTE a nomenclatura original do Módulo 23 (ex: B0414_S2_PS_DF59.2-59.2_pic1.jpeg)
        for (const srcPath of localPhotoFiles) {
          const originalName = path.basename(srcPath)
          const dstPath = path.join(os.tmpdir(), originalName)
          fs.copyFileSync(srcPath, dstPath)
          tempPaths.push(dstPath)
        }
        this.log(`  Enviando ${tempPaths.length} foto(s) com nomes estritos do Módulo 23 (${tempPaths.map(p => path.basename(p)).join(', ')})...`)
      } else if (data.photoUrls && data.photoUrls.length > 0 && data.photoUrls[0].startsWith('http')) {
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
      } else if (data.photoUrls && data.photoUrls.length > 0) {
        this.log(`  ℹ Arquivo de mídia (${data.photoUrls[0]}) não encontrado na pasta local. Ignorando anexo.`)
      }



      if (tempPaths.length > 0) {
        const scope = this.getScope()

        for (let i = 0; i < tempPaths.length; i++) {
          const filePath = tempPaths[i]
          const fileName = path.basename(filePath)

          // 1. Clica no botão "Add attachments" (📎) para cada foto individualmente
          const attachmentBtn = scope
            .locator('.attachment-button, [title*="attachment"]')
            .or(scope.getByText(/add attachments/i))
            .or(scope.locator('a, button', { hasText: /attachment/i }))
            .first()

          let setViaChooser = false
          if (await attachmentBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
            const fileChooserPromise = this.page.waitForEvent('filechooser', { timeout: 3000 }).catch(() => null)
            await attachmentBtn.click({ force: true }).catch(() => {})
            const fileChooser = await fileChooserPromise

            if (fileChooser) {
              await fileChooser.setFiles([filePath])
              setViaChooser = true
              this.log(`  ✓ Foto ${i + 1}/${tempPaths.length} (${fileName}) anexada via filechooser!`)
            }
          }

          if (!setViaChooser) {
            const fileInput = scope.locator('input[type="file"]').last().or(scope.locator('input[type="file"]').first())
            await fileInput.evaluate((el: HTMLInputElement) => el.setAttribute('multiple', 'multiple')).catch(() => {})
            await fileInput.setInputFiles([filePath])
            this.log(`  ✓ Foto ${i + 1}/${tempPaths.length} (${fileName}) anexada via input DOM!`)
          }

          // Aguarda o encerramento do upload do ServiceNow para a foto atual
          await this.page.waitForTimeout(1500)
        }
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

    // Se o campo "Blade shear web" estiver visível (ex.: quando Blade sub-section é Shear Web)
    const scope = this.getScope()
    const isShearWebVisible =
      (await scope.getByLabel('Blade shear web', { exact: false }).first().isVisible({ timeout: 1200 }).catch(() => false)) ||
      (await scope.locator('div.form-group, .select2-container', { hasText: /blade shear web/i }).first().isVisible({ timeout: 1200 }).catch(() => false))

    if (isShearWebVisible) {
      this.log(`    Campo 'Blade shear web' detectado visível.`)
      const shearWebValue = data.bladeArea && /shear\s*web/i.test(data.bladeArea) ? data.bladeArea : 'Shear Web 1'
      await this.selectFromComboBox('Blade shear web', shearWebValue, 800)
    }

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

async function readDamageRows(excelPath: string, options?: RunAutomationOptions): Promise<DamageReportRow[]> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(excelPath)
  const ws = wb.worksheets[0]
  const rows: DamageReportRow[] = []
  let lastValidBladeSerial = ''

  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r)
    const rawBlade = String(row.getCell(1).value ?? '').trim()
    if (!rawBlade) continue

    let isBlankImage = false
    let bladeSerial = rawBlade

    if (rawBlade.toLowerCase() === 'blank image') {
      if (!options?.includeBlankImages) {
        continue
      }
      isBlankImage = true
      bladeSerial = lastValidBladeSerial
    } else {
      lastValidBladeSerial = rawBlade
    }

    if (!bladeSerial) continue


    const photoLinkRaw = String(row.getCell(14).value ?? '').trim()
    const photoUrls = photoLinkRaw
      ? photoLinkRaw
          .split(/[\n,;]+/)
          .map((s) => s.trim())
          .filter(Boolean)
      : []

    const subComponent = String(row.getCell(2).value ?? '').trim()
    let failureType = String(row.getCell(3).value ?? '').trim()

    // Regra de negócio do cliente: "Air inclusion" com sub-componente "Web Laminate" não existe no SNOW.
    // Nesses casos, altera para "Type of failure is missing"
    if (/web\s*laminate/i.test(subComponent) && /air\s*inclusion|bubbles/i.test(failureType)) {
      failureType = 'Type of failure is missing'
    }

    rows.push({
      bladeSerialNumber: bladeSerial,
      subComponent,
      failureType,
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
      photoUrls,
      isBlankImage
    })
  }
  return rows
}


/** Extrai o S/N de 4 dígitos exatos do serial completo (ex.: "A1 811 0413 0115" -> "0413" ou "B0413_S2..." -> "0413") */
export function extractBladeSn(bladeSerial: string): string {
  if (!bladeSerial) return ''
  const trimmed = bladeSerial.trim()

  // 1. Estrutura padrão: "A1 811 0410 0115" -> tokens[2] é "0410"
  const tokens = trimmed.split(/[\s\-_]+/)
  if (tokens.length >= 4 && /^\d{4}$/.test(tokens[2])) {
    return tokens[2]
  }

  // 2. Nomes de arquivo ou códigos como "B0413_S2..." ou "0413"
  const match = trimmed.match(/(?:B|^|[\s\-_])(\d{4})(?:[\s\-_]|$)/i)
  if (match) {
    return match[1]
  }

  // 3. Fallback genérico para 4 dígitos
  const match4 = trimmed.match(/\d{4}/)
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
    let lastValidBladeSerial = ''

    for (let r = 2; r <= ws.rowCount; r++) {
      const row = ws.getRow(r)
      const rawBlade = String(row.getCell(1).value ?? '').trim()
      if (!rawBlade) continue

      let bladeSerial = rawBlade
      if (rawBlade.toLowerCase() === 'blank image') {
        if (!lastValidBladeSerial) continue
        bladeSerial = lastValidBladeSerial
      } else {
        lastValidBladeSerial = rawBlade
      }

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
  videoPath?: string
}

/**
 * Mapeia previamente a pasta Fotos/ gerada pelo Módulo 23 no início da automação.
 * Indexa cada defeito pelas chaves (ex.: "0413_df58.5" ou "0413_df58.5-59")
 * com os caminhos absolutos exatos das fotos pic1.jpeg, pic2.jpeg e vídeos (mp4/mov/avi) no disco.
 */
export function buildLocalPhotosMap(localPhotosDir: string): Map<string, LocalPhotoPair> {
  const map = new Map<string, LocalPhotoPair>()
  if (!localPhotosDir || !fs.existsSync(localPhotosDir)) return map

  const scannedDirs = new Set<string>()

  function scan(dir: string) {
    try {
      const items = fs.readdirSync(dir, { withFileTypes: true })
      for (const item of items) {
        const full = path.join(dir, item.name)
        if (item.isDirectory()) {
          scan(full)
        } else if (item.isFile()) {
          const lower = item.name.toLowerCase()
          const isImg = lower.endsWith('.jpeg') || lower.endsWith('.jpg') || lower.endsWith('.png')
          const isVid = lower.endsWith('.mp4') || lower.endsWith('.mov') || lower.endsWith('.avi') || lower.endsWith('.mkv')
          if (!isImg && !isVid) continue

          const shortSn = extractBladeSn(item.name).toLowerCase()
          const dfMatch = lower.match(/df[\d\.\-_]+/)
          const dfKey = dfMatch ? dfMatch[0] : ''
          const secMatch = lower.match(/s1|s2/i)
          const secKey = secMatch ? secMatch[0].toLowerCase() : ''
          const areaMatch = lower.match(/(?:^|_)(ps|ss)(?:_|\.|$)/i)
          const areaKey = areaMatch ? areaMatch[1].toLowerCase() : ''

          if (shortSn && dfKey) {
            const keysToSet: string[] = []
            if (secKey && areaKey) {
              keysToSet.push(`${shortSn}_${secKey}_${areaKey}_${dfKey}`)
            }
            keysToSet.push(`${shortSn}_${dfKey}`)

            for (const key of keysToSet) {
              if (!map.has(key)) {
                map.set(key, {})
              }
              const entry = map.get(key)!
              if (lower.includes('pic1')) {
                entry.pic1Path = full
              } else if (lower.includes('pic2')) {
                entry.pic2Path = full
              } else if (isVid || lower.includes('video') || lower.includes('vid')) {
                entry.videoPath = full
              }
            }
          }
        }
      }
    } catch {}
  }

  function scanWithParent(dir: string) {
    if (!dir || !fs.existsSync(dir) || scannedDirs.has(dir)) return
    scannedDirs.add(dir)
    scan(dir)

    const parent = path.dirname(dir)
    if (parent && fs.existsSync(parent) && !scannedDirs.has(parent)) {
      const candidates = ['Videos', 'Vídeos', 'videos', 'vídeos', 'Fotos', 'fotos']
      for (const cand of candidates) {
        const candPath = path.join(parent, cand)
        if (fs.existsSync(candPath) && !scannedDirs.has(candPath)) {
          scannedDirs.add(candPath)
          scan(candPath)
        }
      }
    }
  }

  scanWithParent(localPhotosDir)
  return map
}

export function findLocalPhotosFromMap(photosMap: Map<string, LocalPhotoPair>, data: DamageReportRow): string[] {
  if (!photosMap || photosMap.size === 0) return []

  const shortSn = extractBladeSn(data.bladeSerialNumber).toLowerCase()
  const secCode = /section\s*2|s2/i.test(data.bladeSection) ? 's2' : 's1'
  const areaCode = data.bladeArea ? data.bladeArea.toLowerCase() : 'ss'
  const df1 = `df${data.dfDistanceStart}-${data.dfDistanceEnd}`.toLowerCase()
  const df2 = `df${data.dfDistanceStart}`.toLowerCase()

  const result: string[] = []

  // Tenta chave específica com Seção e Área primeiro (ex: "0379_s1_ps_df45_df50")
  let entry =
    photosMap.get(`${shortSn}_${secCode}_${areaCode}_${df1}`) ||
    photosMap.get(`${shortSn}_${secCode}_${areaCode}_${df2}`) ||
    photosMap.get(`${shortSn}_${secCode}_${areaCode}_df45_df50`) ||
    photosMap.get(`${shortSn}_${secCode}_${areaCode}_df45-50`) ||
    photosMap.get(`${shortSn}_${df1}`) ||
    photosMap.get(`${shortSn}_${df2}`)

  const isVideoRow = data.dfDistanceStart === 45 && data.dfDistanceEnd === 50


  if (entry) {
    if (isVideoRow) {
      if (entry.videoPath) result.push(entry.videoPath)
    } else {
      if (entry.pic1Path) result.push(entry.pic1Path)
      if (entry.pic2Path) result.push(entry.pic2Path)
    }
  }

  return result
}

export function findLocalPhotosForDamage(localPhotosDir: string, data: DamageReportRow): string[] {
  if (!localPhotosDir || !fs.existsSync(localPhotosDir)) return []

  const shortSn = extractBladeSn(data.bladeSerialNumber).toLowerCase() // ex: "0413"
  const dfStartStr = String(data.dfDistanceStart).trim().toLowerCase() // ex: "58.5"

  const pic1Files: string[] = []
  const pic2Files: string[] = []
  const videoFiles: string[] = []
  const scannedDirs = new Set<string>()

  function scan(dir: string) {
    try {
      const items = fs.readdirSync(dir, { withFileTypes: true })
      for (const item of items) {
        const full = path.join(dir, item.name)
        if (item.isDirectory()) {
          scan(full)
        } else if (item.isFile()) {
          const lower = item.name.toLowerCase()
          const isImg = lower.endsWith('.jpeg') || lower.endsWith('.jpg') || lower.endsWith('.png')
          const isVid = lower.endsWith('.mp4') || lower.endsWith('.mov') || lower.endsWith('.avi') || lower.endsWith('.mkv')
          if (!isImg && !isVid) continue

          // Verifica se o caminho absoluto ou o nome do arquivo contém a pá (ex: "0413" ou "b0413")
          const hasSn = !shortSn || lower.includes(shortSn) || full.toLowerCase().includes(`\\${shortSn}\\`) || full.toLowerCase().includes(`/${shortSn}/`)
          // Verifica se o nome do arquivo contém a distância do DF (ex: "df58.5")
          const hasDf = lower.includes(`df${dfStartStr}`)

          if (hasSn && (hasDf || isVid)) {
            if (lower.includes('pic1')) {
              pic1Files.push(full)
            } else if (lower.includes('pic2')) {
              pic2Files.push(full)
            } else if (isVid) {
              let secCode = 'S1'
              if (/section\s*2|s2/i.test(data.bladeSection)) secCode = 'S2'

              let areaCode = 'SS'
              if (/ps|pressure/i.test(data.bladeArea)) areaCode = 'PS'

              // Se o nome do arquivo indicar S1/S2 ou PS/SS diferente do esperado nesta linha, ignora
              if (lower.includes('s1') && secCode !== 'S1') continue
              if (lower.includes('s2') && secCode !== 'S2') continue
              if (lower.includes('ps') && areaCode !== 'PS') continue
              if (lower.includes('ss') && areaCode !== 'SS') continue

              const targetName = `B${shortSn}_${secCode}_${areaCode}_DF45_DF50.mp4`
              if (path.basename(full).toLowerCase() === targetName.toLowerCase()) {
                videoFiles.push(full)
              } else {
                const dst = path.join(os.tmpdir(), targetName)
                try {
                  fs.copyFileSync(full, dst)
                  videoFiles.push(dst)
                } catch {
                  videoFiles.push(full)
                }
              }
            }
          }
        }
      }
    } catch {}
  }

  function scanWithParent(dir: string) {
    if (!dir || !fs.existsSync(dir) || scannedDirs.has(dir)) return
    scannedDirs.add(dir)
    scan(dir)

    const parent = path.dirname(dir)
    if (parent && fs.existsSync(parent) && !scannedDirs.has(parent)) {
      const candidates = ['Videos', 'Vídeos', 'videos', 'vídeos', 'Fotos', 'fotos']
      for (const cand of candidates) {
        const candPath = path.join(parent, cand)
        if (fs.existsSync(candPath) && !scannedDirs.has(candPath)) {
          scannedDirs.add(candPath)
          scan(candPath)
        }
      }
    }
  }

  scanWithParent(localPhotosDir)

  const isVideoRow = data.dfDistanceStart === 45 && data.dfDistanceEnd === 50
  const result: string[] = []

  if (isVideoRow) {
    if (videoFiles.length > 0) result.push(videoFiles[0])
  } else {
    if (pic1Files.length > 0) result.push(pic1Files[0])
    if (pic2Files.length > 0) result.push(pic2Files[0])
  }

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
  includeBlankImages?: boolean // Se true, inclui as 5 linhas Blank Image (para turbinas/inspeções com < 5 defeitos)
  skipSubmitted?: boolean // Se true, pula linhas já submetidas no histórico
  processOnlyVideos?: boolean // Se true, filtra e processa APENAS os 4 vídeos de cada pá (DF 45-50)
}

export async function auditLiveDamageEntries(page: Page, log: LogFn): Promise<Set<string>> {
  const auditSet = new Set<string>()
  try {
    const scopes = [page, ...page.frames()]
    for (const s of scopes) {
      const rowsLocator = s.locator('tr.list_row, tr[sys_id], .list2_body tr, table.list_table tr')
      const count = await rowsLocator.count()
      if (count === 0) continue

      for (let i = 0; i < count; i++) {
        const text = await rowsLocator.nth(i).textContent().catch(() => '')
        if (!text) continue

        const shortSn = extractBladeSn(text).toLowerCase()
        if (!shortSn) continue

        // Extrai Seção (S1/S2) e Área (PS/SS) se presente no texto da linha da tabela
        const secCode = /section\s*2|s2/i.test(text) ? 's2' : 's1'
        const areaMatch = text.match(/(?:^|[\s_])(ps|ss)(?:[\s_]|$)/i)
        const areaCode = areaMatch ? areaMatch[1].toLowerCase() : ''

        // Procura números DF no texto da linha (ex: 45, 50, 53.2)
        const dfNumbers = text.match(/\b\d{1,3}(?:\.\d+)?\b/g) || []
        for (const dfVal of dfNumbers) {
          auditSet.add(`${shortSn}_df${dfVal}`)
          if (areaCode) {
            auditSet.add(`${shortSn}_${secCode}_${areaCode}_df${dfVal}`)
          }
        }
      }
    }
    if (auditSet.size > 0) {
      log(`✓ Auditoria ao vivo do ServiceNow concluída: ${auditSet.size} assinatura(s) de defeito já existente(s) na tabela do relatório.`)
    }
  } catch {}
  return auditSet
}

export async function checkRowExistsInLiveTable(page: Page, row: DamageReportRow): Promise<boolean> {
  try {
    const scopes = [page, ...page.frames()]
    const shortSn = extractBladeSn(row.bladeSerialNumber)

    for (const s of scopes) {
      const rowsLocator = s.locator('tr.list_row, tr[sys_id], .list2_body tr, table.list_table tr')
      const count = await rowsLocator.count()
      if (count === 0) continue

      for (let i = 0; i < count; i++) {
        const text = await rowsLocator.nth(i).textContent().catch(() => '')
        if (!text) continue

        const hasSn = !shortSn || text.includes(shortSn)
        const hasSubComp = text.includes(row.subComponent) || (row.subComponent.includes('Shell') && text.includes('Shell'))

        let hasMatch = false
        if (row.dfDistanceStart === 45 && row.dfDistanceEnd === 50) {
          const hasSec = text.includes(row.bladeSection) || (row.bladeSection === 'Section 1' && text.includes('Section 1'))
          const hasArea = text.includes(row.bladeArea)
          hasMatch = hasSn && hasSubComp && (text.includes('45') || text.includes('50')) && hasSec && hasArea
        } else {
          const hasDf = text.includes(String(row.dfDistanceStart))
          hasMatch = hasSn && hasSubComp && hasDf
        }

        if (hasMatch) {
          return true
        }
      }
    }
  } catch {}
  return false
}


function getSubmittedStorePath(): string {
  const appData = process.env.APPDATA || path.join(os.homedir(), '.config')
  const dir = path.join(appData, 'ArthwindSuite')
  fs.mkdirSync(dir, { recursive: true })
  return path.join(dir, 'snow_submitted_rows.json')
}

export function loadSubmittedRows(): Set<string> {
  try {
    const storePath = getSubmittedStorePath()
    if (fs.existsSync(storePath)) {
      const data = JSON.parse(fs.readFileSync(storePath, 'utf-8'))
      return new Set(data)
    }
  } catch {}
  return new Set()
}

export function markRowSubmitted(rowKey: string) {
  try {
    const store = loadSubmittedRows()
    store.add(rowKey)
    const storePath = getSubmittedStorePath()
    fs.writeFileSync(storePath, JSON.stringify(Array.from(store), null, 2))
  } catch {}
}

export function clearSubmittedRowsStore() {
  try {
    const storePath = getSubmittedStorePath()
    if (fs.existsSync(storePath)) {
      fs.unlinkSync(storePath)
    }
  } catch {}
}

export function buildRowKey(incidentUrl: string, row: DamageReportRow): string {
  const shortSn = extractBladeSn(row.bladeSerialNumber)
  return `${incidentUrl}_${shortSn}_${row.subComponent}_${row.failureType}_${row.dfDistanceStart}_${row.dfDistanceEnd}_${row.bladeSection}_${row.bladeArea}`
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
    const allRows = await readDamageRows(excelPath, options)
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

    // Filtragem opcional: Apenas Vídeos (DF 45-50)
    if (options.processOnlyVideos) {
      filteredRows = filteredRows.filter((r) => r.dfDistanceStart === 45 && r.dfDistanceEnd === 50)
      log(`Filtro 'Apenas Vídeos' ativo: ${filteredRows.length} entrada(s) de vídeo selecionada(s).`)
    }

    if (filteredRows.length === 0) {
      return { success: false, processed: 0, failed: 0, errors: [], error: 'Nenhuma linha corresponde ao filtro selecionado.' }
    }

    const start = Math.max(0, (options.startRow ?? 1) - 1)
    const end = Math.min(filteredRows.length, options.endRow ?? filteredRows.length)
    const slicedRows = filteredRows.slice(start, end)

    const skipSubmitted = options.skipSubmitted ?? true
    const submittedStore = loadSubmittedRows()

    let rows = slicedRows
    if (skipSubmitted && submittedStore.size > 0) {
      const initialCount = slicedRows.length
      rows = slicedRows.filter((r) => !submittedStore.has(buildRowKey(incidentUrl, r)))
      const skippedCount = initialCount - rows.length
      if (skippedCount > 0) {
        log(`ℹ ${skippedCount} linha(s) já submetida(s) no histórico foram ignoradas. (${rows.length} restante(s))`)
      }
    }

    const autoSubmit = options.autoSubmit ?? false

    log(`${rows.length} linha(s) a processar (Modo: ${autoSubmit ? 'Submissão Automática' : 'Conferência Manual'}).`)

    // Abre a página principal para realizar a auditoria prévia ao vivo dos defeitos já cadastrados no ServiceNow
    let auditContext: BrowserContext
    try {
      auditContext = await getContext(options.headless ?? false)
    } catch {
      await closeServiceNowSession()
      auditContext = await getContext(options.headless ?? false)
    }
    const auditPage = auditContext.pages().find((p) => !p.isClosed()) || (await auditContext.newPage())
    if (!auditPage.url().includes(incidentUrl.split('?')[0])) {
      await auditPage.goto(incidentUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})
    }
    await auditLiveDamageEntries(auditPage, log)

    let processed = 0
    let failed = 0
    const errors: string[] = []

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const prefix = `[${i + 1}/${rows.length}]`
      try {
        let context: BrowserContext
        try {
          context = await getContext(options.headless ?? false)
        } catch {
          await closeServiceNowSession()
          context = await getContext(options.headless ?? false)
        }

        // Identifica a página do relatório principal (Inspection Report)
        let parentPage = context.pages().find((p) => !p.isClosed() && p.url().includes(incidentUrl.split('?')[0]))
        if (!parentPage) {
          parentPage = context.pages().find((p) => !p.isClosed()) || (await context.newPage())
          await parentPage.goto(incidentUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})
        }

        await parentPage.bringToFront().catch(() => {})

        // Checagem ao vivo na tabela Damage Report Entries do ServiceNow
        const existsInSnow = await checkRowExistsInLiveTable(parentPage, row)
        if (existsInSnow) {
          log(`  ℹ [SNOW Live Audit] Entrada para ${row.bladeSerialNumber} (${row.subComponent} DF ${row.dfDistanceStart}-${row.dfDistanceEnd}) já cadastrada na tabela do ServiceNow. Pulando...`)
          if (autoSubmit) markRowSubmitted(buildRowKey(incidentUrl, row))
          continue
        }

        // Abre o formulário obtendo o link do Add Damage Entry ou criando uma nova aba dedicada via context.newPage()
        let targetFormPage: Page | null = null

        // 1. Tenta extrair o href do botão Add Damage Entry na página principal
        let formHref: string | null = null
        const scopes = [parentPage, ...parentPage.frames()]
        for (const s of scopes) {
          const btnLocators = [
            s.locator('a, button', { hasText: /^add damage entry$/i }),
            s.locator('a, button', { hasText: /^create damage entry$/i }),
            s.getByRole('link', { name: /add damage entry|create damage entry/i }),
            s.getByRole('button', { name: /add damage entry|create damage entry/i }),
            s.locator('a, button', { hasText: /damage entry/i })
          ]
          for (const loc of btnLocators) {
            try {
              if (await loc.isVisible({ timeout: 800 }).catch(() => false)) {
                const h = await loc.getAttribute('href').catch(() => null)
                if (h) {
                  formHref = h
                  break
                }
              }
            } catch {}
          }
          if (formHref) break
        }

        if (formHref) {
          const origin = new URL(parentPage.url()).origin
          const fullFormUrl = formHref.startsWith('http') ? formHref : `${origin}${formHref.startsWith('/') ? '' : '/'}${formHref}`
          targetFormPage = await context.newPage()
          await targetFormPage.goto(fullFormUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})
          await targetFormPage.bringToFront().catch(() => {})
          log(`  ✓ Aberta nova aba limpa para a linha ${prefix}`)
        } else {
          // Fallback: clica no botão interceptando popup
          const initialCount = context.pages().filter((p) => !p.isClosed()).length
          const popupPromise = context.waitForEvent('page', { timeout: 4000 }).catch(() => null)

          let clickedAdd = false
          for (let attempt = 0; attempt < 5; attempt++) {
            for (const s of scopes) {
              const locators = [
                s.locator('button, a', { hasText: /^add damage entry$/i }),
                s.locator('button, a', { hasText: /^create damage entry$/i }),
                s.getByRole('button', { name: /add damage entry|create damage entry|nova entrada/i }),
                s.getByRole('link', { name: /add damage entry|create damage entry|nova entrada/i }),
                s.getByText(/add damage entry|create damage entry/i).first()
              ]
              for (const loc of locators) {
                try {
                  if (await loc.isVisible({ timeout: 800 }).catch(() => false)) {
                    await loc.click({ force: true })
                    clickedAdd = true
                    break
                  }
                } catch {}
              }
              if (clickedAdd) break
            }
            if (clickedAdd) break
            await parentPage.waitForTimeout(800)
          }

          const newPopupPage = await popupPromise
          if (newPopupPage && !newPopupPage.isClosed()) {
            targetFormPage = newPopupPage
          } else {
            const currentPages = context.pages().filter((p) => !p.isClosed())
            if (currentPages.length > initialCount) {
              targetFormPage = currentPages[currentPages.length - 1]
            } else {
              targetFormPage = parentPage
            }
          }
          await targetFormPage.bringToFront().catch(() => {})
        }



        const checkFormReady = async (p: Page): Promise<boolean> => {
          const scopes = [p, ...p.frames()]
          for (const s of scopes) {
            try {
              const hasLabel = await s.getByText(/blade serial number|sub component|failure type/i).first().isVisible({ timeout: 500 }).catch(() => false)
              const hasSelect2 = await s.locator('.select2-container, .select2-choice').first().isVisible({ timeout: 500 }).catch(() => false)
              if (hasLabel || hasSelect2) return true
            } catch {}
          }
          return false
        }

        let isFormReady = await checkFormReady(targetFormPage)
        if (!isFormReady) {
          await targetFormPage.waitForTimeout(2500)
          isFormReady = await checkFormReady(targetFormPage)
        }

        if (!isFormReady) {
          log(`  ⚠ O formulário de cadastro não abriu na aba de destino. Recarregando página do relatório...`)
          await parentPage.goto(incidentUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})
          throw new Error("A tela 'Create Damage Entry' não carregou a tempo.")
        }

        // Cruza a linha atual com o mapa pré-indexado de fotos
        let localPhotos = options.localPhotosDir
          ? findLocalPhotosFromMap(photosMap, row)
          : []

        if (localPhotos.length === 0 && options.localPhotosDir) {
          localPhotos = findLocalPhotosForDamage(options.localPhotosDir, row)
        }

        const filler = new DamageEntryFiller(targetFormPage, (m) => log(`  ${prefix} ${m}`))
        await filler.fill(row, localPhotos, autoSubmit)

        processed++

        // Salva na memória local APENAS se a submissão automática estiver ativa e com sucesso
        if (autoSubmit) {
          const rowKey = buildRowKey(incidentUrl, row)
          markRowSubmitted(rowKey)
        }

        log(`✓ ${prefix} OK: ${row.bladeSerialNumber} — ${row.failureType}`)

        if (autoSubmit) {
          // Aguarda ServiceNow processar o submit nativo sem causar race condition
          await targetFormPage.waitForTimeout(2000)

          const scopes = [parentPage, ...parentPage.frames()]
          let canSeeCreateBtn = false
          for (const s of scopes) {
            const hasBtn = await s.getByRole('button', { name: /create damage entry|add damage entry|nova entrada/i }).isVisible({ timeout: 500 }).catch(() => false)
            if (hasBtn) {
              canSeeCreateBtn = true
              break
            }
          }

          if (!canSeeCreateBtn) {
            await parentPage.goto(incidentUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})
          }
        } else {
          log(`  ℹ Formulário [${i + 1}/${rows.length}] mantido aberto na tela para revisão. Avançando para a próxima linha...`)
        }
      } catch (err: any) {
        failed++
        const msg = `✗ ${prefix} FALHOU: ${row.bladeSerialNumber} — ${row.failureType}: ${err.message}`
        errors.push(msg)
        log(msg)
      }
    }

    if (!autoSubmit) {
      log(`ℹ Concluído! ${processed} formulário(s) preenchido(s) com sucesso e mantido(s) aberto(s) em abas/janelas para sua revisão final.`)
    }



    log(`Concluído: ${processed} ok, ${failed} falha(s) de ${rows.length}.`)
    return { success: true, processed, failed, errors }
  } catch (err: any) {
    return { success: false, processed: 0, failed: 0, errors: [], error: err.message }
  }
}


