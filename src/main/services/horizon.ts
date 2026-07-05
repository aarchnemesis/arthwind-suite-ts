import fs from 'fs'
import path from 'path'
import JSZip from 'jszip'
import { parseDate } from './workflow'

// ─── Constants and Interfaces ──────────────────────────────────────────────────

export const INSPECTION_TYPES_VALIDOS = [
  "Autonomous Drone", "Blade External Other", "Blade Internal",
  "Gearbox Borescope", "Generic", "Ground Photo", "Manual Drone",
  "Rope Inspection", "Tower External", "Transition Piece",
]

export interface ValidationResult {
  success: boolean
  is_valid: boolean
  extras: string[]
  faltantes: string[]
  suggestions: Record<string, { suggestion: string; score: number }>
  auto_matches: Record<string, string>
  turbinas_horizon: number
  turbinas_atw: number
  turbinas_hor_list: string[]
  turbinas_atw_list: string[]
  n_duplicatas: number
}

export interface RequirementsResult {
  is_valid: boolean
  errors: string[]
  warnings: string[]
}

// ─── Helper Functions ─────────────────────────────────────────────────────────

function cleanFilename(name: string): string {
  if (!name) return ""
  return path.basename(String(name).trim().replace(/['"]/g, "")).toLowerCase()
}

function loadCsvRobust(content: string, isDamage = false): any[] | null {
  try {
    const lines = content.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
    if (lines.length === 0) return null

    const firstLine = lines[0]
    const sep = isDamage ? ',' : (firstLine.split(';').length > firstLine.split(',').length ? ';' : ',')
    const headers = firstLine.split(sep).map(h => h.trim().replace(/['"]/g, ''))

    const data: any[] = []
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i]
      let parts = line.split(sep)
      if (isDamage && parts.length > headers.length) {
        const fixed = parts.slice(0, headers.length - 1)
        let coords = parts.slice(headers.length - 1).join(',').trim().replace(/['"]/g, '')
        if (coords.startsWith('[[') && coords.endsWith(']]')) {
          coords = coords.substring(1, coords.length - 1)
        }
        fixed.push(coords)
        parts = fixed
      } else {
        parts = parts.slice(0, headers.length).map(p => p.trim().replace(/['"]/g, ''))
      }

      const obj: any = {}
      headers.forEach((h, idx) => {
        obj[h] = parts[idx] || ''
      })
      data.push(obj)
    }
    return data
  } catch {
    return null
  }
}

function loadHorizonBase(content: string): any[] | null {
  try {
    const lines = content.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
    if (lines.length === 0) return null

    const headerLine = lines[0]
    const sep = headerLine.split(';').length > headerLine.split(',').length ? ';' : ','
    const headers = headerLine.split(sep).map(h => h.trim().replace(/['"]/g, ''))

    const skipKeywords = ['delete this row', 'explanation:', 'valid data options']
    const data: any[] = []

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i]
      const firstField = line.split(sep)[0].trim().replace(/['"]/g, '').toLowerCase()
      if (skipKeywords.some(kw => firstField.includes(kw))) {
        continue
      }
      const parts = line.split(sep).slice(0, headers.length).map(p => p.trim().replace(/['"]/g, ''))

      const obj: any = {}
      headers.forEach((h, idx) => {
        if (h !== 'Notes') {
          obj[h] = parts[idx] || ''
        }
      })

      const hasValue = Object.values(obj).some(val => String(val).trim() !== '')
      if (hasValue) {
        data.push(obj)
      }
    }
    return data
  } catch {
    return null
  }
}

function mergeHorizonBases(paths: string[]): any[] | null {
  const dfs: any[] = []
  for (const p of paths) {
    if (!fs.existsSync(p)) continue
    const content = fs.readFileSync(p, 'utf-8')
    const df = loadHorizonBase(content)
    if (df && df.length > 0) {
      dfs.push(...df)
    }
  }
  if (dfs.length === 0) return null

  const seen = new Set<string>()
  const result: any[] = []
  dfs.forEach(row => {
    const t = String(row.Turbine || '').trim()
    if (!seen.has(t)) {
      seen.add(t)
      result.push(row)
    }
  })
  return result
}

function mergeAtwSummaries(paths: string[]): any[] | null {
  const dfs: any[] = []
  for (const p of paths) {
    if (!fs.existsSync(p)) continue
    const content = fs.readFileSync(p, 'utf-8')
    const df = loadCsvRobust(content)
    if (df && df.length > 0) {
      dfs.push(...df)
    }
  }
  if (dfs.length === 0) return null

  const seen = new Set<string>()
  const result: any[] = []
  dfs.forEach(row => {
    const t = String(row.Turbine || '').trim()
    if (!seen.has(t)) {
      seen.add(t)
      result.push(row)
    }
  })
  return result
}

function deduplicateAtw(df: any[]): { df: any[]; n_duplicatas: number } {
  if (!df || df.length === 0) return { df: [], n_duplicatas: 0 }
  const seen = new Set<string>()
  const result: any[] = []
  df.forEach(row => {
    const t = String(row.Turbine || '').trim()
    if (!seen.has(t)) {
      seen.add(t)
      result.push(row)
    }
  })
  return { df: result, n_duplicatas: df.length - result.length }
}

function standardizeTurbineName(name: string): string {
  if (!name) return ''
  let s = String(name).trim().toLowerCase()
  s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  
  // Remove generic prefixes
  s = s.replace(/^(aeros?|wtg|aerogerador|turbine|maquina)\b/g, '')
  s = s.replace(/^aero\s+/g, '')
  
  // Insert spaces between letters and digits to split them properly
  s = s.replace(/([a-z])([0-9])/g, '$1 $2')
  s = s.replace(/([0-9])([a-z])/g, '$1 $2')
  
  // Replace non-alphanumeric (dashes, slashes, punctuation, spaces) with spaces
  s = s.replace(/[^a-z0-9]/g, ' ')
  
  const parts = s.split(/\s+/).filter(Boolean).map(p => {
    if (/^[0-9]+$/.test(p)) {
      return p.replace(/^0+(\d)/, '$1')
    }
    return p
  })
  
  return parts.join('')
}

function normalizar(s: string): string {
  return standardizeTurbineName(s)
}

function normalizarFuzzy(s: string): string {
  return standardizeTurbineName(s)
}

function getLcsLength(s1: string, s2: string): number {
  const m = s1.length
  const n = s2.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (s1[i - 1] === s2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }
  return dp[m][n]
}

function sequenceMatcherRatio(s1: string, s2: string): number {
  if (!s1 || !s2) return 0
  const lcs = getLcsLength(s1, s2)
  return (2.0 * lcs) / (s1.length + s2.length)
}

function suggestTurbineMatch(nomeHorizon: string, opcoesAtw: string[]): [string, number] {
  const nomeNorm = normalizarFuzzy(nomeHorizon)
  let melhorScore = -1.0
  let melhorOpcao = opcoesAtw.length > 0 ? opcoesAtw[0] : ""

  for (const opcao of opcoesAtw) {
    const score = sequenceMatcherRatio(nomeNorm, normalizarFuzzy(opcao))
    if (score > melhorScore) {
      melhorScore = score
      melhorOpcao = opcao
    }
  }
  return [melhorOpcao, melhorScore]
}

function parseDateToYyyyMmDd(raw: string): string {
  const val = String(raw).trim()
  if (!val || ['nan', 'nat', 'none', 'null'].includes(val.toLowerCase())) {
    return ''
  }
  const parsed = parseDate(val)
  if (parsed) {
    const mm = String(parsed.getMonth() + 1).padStart(2, '0')
    const dd = String(parsed.getDate()).padStart(2, '0')
    const yyyy = parsed.getFullYear()
    return `${yyyy}-${mm}-${dd}`
  }
  return ''
}

function toCsv(data: any[], delimiter = ','): string {
  if (data.length === 0) return ''
  const headers = Object.keys(data[0])
  const csvLines = [headers.join(delimiter)]
  data.forEach(row => {
    const line = headers.map(h => {
      let val = String(row[h] || '')
      if (val.includes(delimiter) || val.includes('"') || val.includes('\n')) {
        val = `"${val.replace(/"/g, '""')}"`
      }
      return val
    }).join(delimiter)
    csvLines.push(line)
  })
  return csvLines.join('\r\n')
}

function toDamageCsv(data: any[]): string {
  if (data.length === 0) return ''
  const headers = Object.keys(data[0])
  const csvLines = [headers.join(',')]
  data.forEach(row => {
    const line = headers.map(h => {
      let val = String(row[h] || '').trim().replace(/^"|"$/g, '').replace(/^'|'$/g, '')
      if (h === 'Coordinates') {
        return `"${val}"`
      }
      if (val.includes(',') || val.includes('"') || val.includes('\n')) {
        return `"${val.replace(/"/g, '""')}"`
      }
      return val
    }).join(',')
    csvLines.push(line)
  })
  return csvLines.join('\r\n')
}

// ─── Core Services ───────────────────────────────────────────────────────────

export async function horizonAnalisar(horizonPaths: string[], atwPaths: string[]): Promise<any> {
  try {
    const dfHor = mergeHorizonBases(horizonPaths)
    const dfAtwRaw = mergeAtwSummaries(atwPaths)

    if (!dfHor || !dfAtwRaw) {
      return { success: false, error: 'Falha ao carregar ficheiros CSV.' }
    }

    const { df: dfAtw, n_duplicatas: nDup } = deduplicateAtw(dfAtwRaw)

    // Se atwPaths[0] existe, busca arquivos adicionais no mesmo diretório para avisar se houver inconsistência
    if (atwPaths.length > 0 && fs.existsSync(atwPaths[0])) {
      const dir = path.dirname(atwPaths[0])
      
      let detailsCount = 0
      let detailsTurbines: string[] = []
      
      // 1. Procurar arquivos galleries ou details
      try {
        const files = fs.readdirSync(dir)
        const detailsFile = files.find(f => {
          const fl = f.toLowerCase()
          return (fl.includes('galleries') || fl.includes('details') || fl.includes('gallery')) && fl.endsWith('.csv')
        })
        if (detailsFile) {
          const detailsPath = path.join(dir, detailsFile)
          const contentDetails = fs.readFileSync(detailsPath, 'utf-8')
          const dfD = loadCsvRobust(contentDetails)
          if (dfD && dfD.length > 0) {
            const idc = 'ID' in dfD[0] ? 'ID' : Object.keys(dfD[0])[0]
            detailsTurbines = Array.from(new Set(dfD.map(row => String(row[idc] || '').trim()).filter(Boolean)))
            detailsCount = detailsTurbines.length
          }
        }
      } catch (e) {
        // Ignore
      }

      // 2. Procurar pasta Damages ou Danos
      let damagesCount = 0
      try {
        const files = fs.readdirSync(dir)
        const damagesDirName = files.find(f => {
          const fl = f.toLowerCase()
          return fl === 'damages' || fl === 'damages_atw' || fl === 'danos'
        })
        if (damagesDirName) {
          const damagesDirPath = path.join(dir, damagesDirName)
          const stat = fs.statSync(damagesDirPath)
          if (stat.isDirectory()) {
            const damFiles = fs.readdirSync(damagesDirPath)
            damagesCount = damFiles.filter(f => f.toLowerCase().endsWith('.csv')).length
          }
        }
      } catch (e) {
        // Ignore
      }

      const summaryTurbines = new Set(dfAtw.map(r => String(r.Turbine || '').trim()).filter(Boolean))
      
      if ((detailsCount > 0 && summaryTurbines.size < detailsCount) || (damagesCount > 0 && summaryTurbines.size < damagesCount)) {
        return {
          success: false,
          error: `Inconsistência Crítica detectada no diretório: O resumo carregado (summary_atw.csv) contém apenas ${summaryTurbines.size} turbina(s), mas foram encontradas ${detailsCount} turbinas no arquivo de fotos (galleries_atw.csv) e ${damagesCount} turbinas na pasta de Danos (Damages). Por favor, exporte novamente o resumo do ATW contendo todas as turbinas antes de prosseguir.`
        }
      }
    }

    const result = validateNomenclature(dfHor, dfAtw, {}, [], [], nDup)
    return result
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

export function validateNomenclature(
  dfHor: any[],
  dfAtw: any[],
  vinculosConfirmados: Record<string, string> = {},
  turbinasRemovidas: string[] = [],
  turbinasHorizonRemovidas: string[] = [],
  nDuplicatas = 0
): ValidationResult {
  const vinculos = vinculosConfirmados
  const removidas = new Set(turbinasRemovidas)
  const horRemovidas = new Set(turbinasHorizonRemovidas)

  const turbinasAtwList = Array.from(new Set(
    dfAtw.map(row => String(row.Turbine || '').trim()).filter(Boolean)
  )).sort()

  const turbinasHorList = Array.from(new Set(
    dfHor.map(row => String(row.Turbine || '').trim()).filter(Boolean)
  )).sort()

  const setAtw = new Set(turbinasAtwList)
  const setHor = new Set(turbinasHorList)

  const setHorMapeado = new Set(Object.values(vinculos))
  const setHorVincKey = new Set(Object.keys(vinculos))

  const exactAtw = new Set([...setAtw].filter(x => setHor.has(x)))
  const remainingHor = [...setHor].filter(x => !exactAtw.has(x) && !setHorVincKey.has(x))
  const remainingAtw = [...setAtw].filter(x => !exactAtw.has(x) && !setHorMapeado.has(x))

  const atwNormMap: Record<string, string> = {}
  remainingAtw.forEach(t => {
    const nt = normalizar(t)
    if (!atwNormMap[nt]) {
      atwNormMap[nt] = t
    }
  })

  const autoMatches: Record<string, string> = {}
  const matchedAtwNorm = new Set<string>()
  remainingHor.sort().forEach(th => {
    const nh = normalizar(th)
    if (atwNormMap[nh] && !matchedAtwNorm.has(nh)) {
      autoMatches[th] = atwNormMap[nh]
      matchedAtwNorm.add(nh)
    }
  })

  const setHorResolvido = new Set([...setHorVincKey, ...Object.keys(autoMatches)])
  const setAtwResolvido = new Set([...setHorMapeado, ...Object.values(autoMatches)])

  const setHorSemVinculo = [...setHor].filter(x => !setHorResolvido.has(x))
  const extras = [...setAtw].filter(x => !setHor.has(x) && !setAtwResolvido.has(x) && !removidas.has(x)).sort()
  const faltantes = setHorSemVinculo.filter(x => !setAtw.has(x) && !horRemovidas.has(x)).sort()

  const opcoesAtw = [...setAtw].filter(x => !removidas.has(x) && !setAtwResolvido.has(x)).sort()
  const suggestions: Record<string, { suggestion: string; score: number }> = {}

  faltantes.forEach(th => {
    if (opcoesAtw.length > 0) {
      const [sugerido, score] = suggestTurbineMatch(th, opcoesAtw)
      suggestions[th] = { suggestion: sugerido, score: parseFloat(score.toFixed(2)) }
    }
  })

  return {
    success: true,
    is_valid: (extras.length === 0 && faltantes.length === 0),
    extras,
    faltantes,
    suggestions,
    auto_matches: autoMatches,
    turbinas_horizon: turbinasHorList.length,
    turbinas_atw: turbinasAtwList.length,
    turbinas_hor_list: turbinasHorList,
    turbinas_atw_list: turbinasAtwList,
    n_duplicatas: nDuplicatas
  }
}

export async function horizonValidarRequisitos(
  horizonPaths: string[],
  summaryPaths: string[],
  detailsPath: string,
  damagesPaths: string[],
  turbinasRemovidas: string[],
  vinculosConfirmados: Record<string, string>
): Promise<any> {
  try {
    const dfHor = mergeHorizonBases(horizonPaths)
    let taskMap: Record<string, any> = {}

    if (dfHor && dfHor.length > 0 && 'Turbine' in dfHor[0]) {
      const cols = ['Horizon Task ID', 'Site'].filter(c => c in dfHor[0])
      if (cols.length > 0) {
        const uniqueTurbines = new Set(dfHor.map(r => String(r.Turbine || '').trim()).filter(Boolean))
        uniqueTurbines.forEach(t => {
          const matchedRow = dfHor.find(r => String(r.Turbine || '').trim() === t)
          if (matchedRow) {
            const entry: any = {}
            cols.forEach(c => { entry[c] = matchedRow[c] })
            taskMap[t] = entry
          }
        })
      }

      Object.entries(vinculosConfirmados).forEach(([th, ta]) => {
        if (taskMap[th]) {
          taskMap[ta] = taskMap[th]
        }
      })

      const atwContentsCheck = mergeAtwSummaries(summaryPaths)
      if (atwContentsCheck && atwContentsCheck.length > 0) {
        const normMap: Record<string, any> = {}
        Object.entries(taskMap).forEach(([k, v]) => {
          normMap[normalizar(k)] = v
        })

        const uniqueAtwTurbines = Array.from(new Set(
          atwContentsCheck.map(r => String(r.Turbine || '').trim()).filter(Boolean)
        ))

        uniqueAtwTurbines.forEach(ta => {
          if (!taskMap[ta]) {
            const entry = normMap[normalizar(ta)]
            if (entry) {
              taskMap[ta] = entry
            }
          }
        })
      }
    }

    const damagesContents: [string, string][] = []
    for (const dp of damagesPaths || []) {
      if (fs.existsSync(dp)) {
        damagesContents.push([path.basename(dp), fs.readFileSync(dp, 'utf-8')])
      }
    }

    const summaryContent = summaryPaths.length > 0 && fs.existsSync(summaryPaths[0]) ? fs.readFileSync(summaryPaths[0], 'utf-8') : ''
    const detailsContent = fs.existsSync(detailsPath) ? fs.readFileSync(detailsPath, 'utf-8') : ''

    const result = validateRequirements(
      summaryContent,
      detailsContent,
      damagesContents,
      turbinasRemovidas,
      vinculosConfirmados,
      taskMap
    )

    return { success: true, is_valid: result.is_valid, errors: result.errors, warnings: result.warnings }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

export function validateRequirements(
  contentSummary: string,
  contentDetails: string,
  damagesContents: [string, string][],
  turbinasRemovidas: string[] = [],
  vinculosConfirmados: Record<string, string> = {},
  taskMap: Record<string, any> = {}
): RequirementsResult {
  const erros: string[] = []
  const avisos: string[] = []
  const removidasSet = new Set(turbinasRemovidas)
  const vinculos = vinculosConfirmados
  const nomesAtwVinculados = new Set(Object.values(vinculos))
  const validSet = new Set([
    ...Object.keys(taskMap || {}),
    ...nomesAtwVinculados
  ].filter(x => !removidasSet.has(x)))

  // ── Inconsistências de Arquivos (Verificações Críticas de Integridade) ──
  const dfS = loadCsvRobust(contentSummary)
  const dfD = loadCsvRobust(contentDetails)

  if (dfS && dfS.length > 0 && dfD && dfD.length > 0) {
    const turbinesInSummary = new Set(dfS.map(r => String(r.Turbine || '').trim()).filter(Boolean))
    const idc = 'ID' in dfD[0] ? 'ID' : Object.keys(dfD[0])[0]
    const turbinesInDetails = new Set(dfD.map(r => String(r[idc] || '').trim()).filter(Boolean))

    const missingInSummary = Array.from(turbinesInDetails).filter(t => !turbinesInSummary.has(t))
    if (missingInSummary.length > 0) {
      erros.push(`Inconsistência Crítica: O arquivo de fotos (galleries_atw.csv) contém ${turbinesInDetails.size} turbina(s), mas o resumo (summary_atw.csv) só contém ${turbinesInSummary.size} turbina(s). Estão faltando no resumo as seguintes turbinas: ${missingInSummary.sort().join(', ')}. Por favor, exporte novamente o resumo do ATW contendo todas as turbinas.`)
    }
  }

  if (dfS && dfS.length > 0 && damagesContents && damagesContents.length > 0) {
    const turbinesInSummary = new Set(dfS.map(r => String(r.Turbine || '').trim()).filter(Boolean))
    const damagesTurbines = damagesContents.map(([filename]) => path.basename(filename, '.csv').trim())
    const missingInSummaryFromDamages = damagesTurbines.filter(t => !turbinesInSummary.has(t))
    if (missingInSummaryFromDamages.length > 0) {
      erros.push(`Inconsistência de Danos: A pasta de Danos (Damages) contém arquivos para ${damagesContents.length} turbina(s), mas o resumo (summary_atw.csv) só tem ${turbinesInSummary.size} turbina(s). Estão faltando no resumo: ${missingInSummaryFromDamages.sort().join(', ')}.`)
    }
  }

  // ── Summary ──
  if (dfS && dfS.length > 0 && 'Turbine' in dfS[0]) {
    const filteredDfS = dfS.filter(row => !removidasSet.has(String(row.Turbine || '').trim()))

    const dateCol = Object.keys(dfS[0]).find(c => c.toLowerCase().includes('date') || c.toLowerCase().includes('data'))
    if (!dateCol) {
      erros.push("Summary: coluna de data não encontrada")
    } else {
      const sample = filteredDfS.map(row => String(row[dateCol] || '').trim()).filter(Boolean).slice(0, 20)
      let formatoBr = false
      let ambiguo = false

      sample.forEach(x => {
        const matchBr = x.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
        if (matchBr) {
          const day = parseInt(matchBr[1], 10)
          if (day > 12) {
            formatoBr = true
          } else {
            ambiguo = true
          }
        }
      })

      if (formatoBr) {
        avisos.push("Summary: datas em formato BR (dd/mm/yyyy) — serão convertidas automaticamente para mm/dd/yyyy")
      } else if (ambiguo) {
        avisos.push("Summary: datas com formato ambíguo — verifique se estão em mm/dd/yyyy")
      }
    }

    if ('Inspection Type' in dfS[0]) {
      const inspectionTypesValidos = new Set(INSPECTION_TYPES_VALIDOS)
      const invalidTypes = new Set<string>()
      filteredDfS.forEach(row => {
        const t = String(row['Inspection Type'] || '').trim()
        if (t && !inspectionTypesValidos.has(t)) {
          invalidTypes.add(t)
        }
      })
      if (invalidTypes.size > 0) {
        erros.push(`Summary: Inspection Type inválido — ${Array.from(invalidTypes).join(', ')}`)
      }
    } else {
      erros.push("Summary: coluna 'Inspection Type' não encontrada")
    }
  }

  // ── Details ──
  if (dfD && dfD.length > 0) {
    const idc = 'ID' in dfD[0] ? 'ID' : Object.keys(dfD[0])[0]
    const dfDChk = dfD.filter(row => validSet.size === 0 || validSet.has(String(row[idc] || '').trim()))

    const pathCol = Object.keys(dfD[0]).find(c => c.toLowerCase() === 'path') ||
                    Object.keys(dfD[0]).find(c => (c.toLowerCase().includes('file') || c.toLowerCase().includes('image')) && !c.toLowerCase().includes('url'))
    const urlCol = Object.keys(dfD[0]).find(c => c.toLowerCase().includes('url'))

    if (pathCol) {
      const vazios = dfDChk.filter(row => row[pathCol] === null || row[pathCol] === undefined || String(row[pathCol]).trim() === '').length
      if (vazios > 0) {
        erros.push(`Details: ${vazios} linha(s) sem Path (${pathCol})`)
      }
    } else {
      avisos.push("Details: coluna de Path/File não identificada")
    }

    if (urlCol) {
      const vazios = dfDChk.filter(row => row[urlCol] === null || row[urlCol] === undefined || String(row[urlCol]).trim() === '').length
      if (vazios > 0) {
        erros.push(`Details: ${vazios} linha(s) sem URL (${urlCol})`)
      }
    } else {
      avisos.push("Details: coluna de URL não identificada")
    }

    const radCol = Object.keys(dfD[0]).find(c => c.toLowerCase().includes('radial') || c.toLowerCase().includes('distance'))
    if (radCol) {
      let naoNumerico = 0
      let outOfRange = 0
      dfDChk.forEach(row => {
        const valStr = String(row[radCol] || '').trim()
        if (valStr !== '') {
          const valNum = parseFloat(valStr)
          if (isNaN(valNum)) {
            naoNumerico++
          } else if (valNum > 200 || valNum < -3) {
            outOfRange++
          }
        }
      })
      if (naoNumerico > 0) {
        erros.push(`Details: ${naoNumerico} valor(es) não numérico(s) em Radial Distance`)
      }
      if (outOfRange > 0) {
        avisos.push(`Details: ${outOfRange} valor(es) de Radial Distance fora de [-3, 200] (fotos humanizadas/VISUAL) — serão corrigidos para 0 automaticamente.`)
      }
    } else {
      avisos.push("Details: coluna de Radial Distance não identificada")
    }
  }

  // ── Damages ──
  if (damagesContents.length === 0) {
    avisos.push("Nenhum arquivo de Damages carregado — confirme se não há registros de danos nesta inspeção.")
  }

  const coordPattern = /^(\[\d+,\s*\d+\],?\s*)+$/
  const allCoveredPhotos = new Set<string>()

  damagesContents.forEach(([nomeDam, contentDam]) => {
    const dfM = loadCsvRobust(contentDam, true)
    if (dfM && dfM.length > 0) {
      if ('Photo File Name' in dfM[0]) {
        const vazios = dfM.filter(row => row['Photo File Name'] === null || row['Photo File Name'] === undefined || String(row['Photo File Name']).trim() === '').length
        if (vazios > 0) {
          erros.push(`Damages (${nomeDam}): ${vazios} linha(s) sem Photo File Name`)
        }
        dfM.forEach(row => {
          const p = String(row['Photo File Name'] || '').trim()
          if (p) {
            allCoveredPhotos.add(cleanFilename(p))
          }
        })
      }
      if ('Coordinates' in dfM[0]) {
        let coordInvalidas = 0
        dfM.forEach(row => {
          const c = String(row['Coordinates'] || '').trim()
          if (c && !coordPattern.test(c)) {
            coordInvalidas++
          }
        })
        if (coordInvalidas > 0) {
          erros.push(`Damages (${nomeDam}): ${coordInvalidas} coordenada(s) com formato inválido`)
        }
      }
    }
  })

  // ── Cobertura de Damages por turbina ──
  if (damagesContents.length > 0 && dfD && dfD.length > 0 && allCoveredPhotos.size > 0) {
    const idc = 'ID' in dfD[0] ? 'ID' : Object.keys(dfD[0])[0]
    const pathCol = Object.keys(dfD[0]).find(c => c.toLowerCase() === 'path') ||
                    Object.keys(dfD[0]).find(c => (c.toLowerCase().includes('file') || c.toLowerCase().includes('image')) && !c.toLowerCase().includes('url'))
    const dfDChk = dfD.filter(row => validSet.size === 0 || validSet.has(String(row[idc] || '').trim()))

    if (pathCol) {
      const turbSet = new Set<string>()
      dfDChk.forEach(row => {
        const t = String(row[idc] || '').trim()
        if (t) turbSet.add(t)
      })

      Array.from(turbSet).sort().forEach(turbina => {
        const fotosTurbina = dfDChk
          .filter(row => String(row[idc] || '').trim() === turbina)
          .map(row => cleanFilename(String(row[pathCol] || '')))
          .filter(Boolean)

        const hasCovered = fotosTurbina.some(f => allCoveredPhotos.has(f))
        if (fotosTurbina.length > 0 && !hasCovered) {
          avisos.push(`Damages: ${turbina} — nenhum CSV de danos cobre as suas fotos`)
        }
      })
    }
  }

  return { is_valid: erros.length === 0, errors: erros, warnings: avisos }
}

export async function horizonGerarPacote(
  horizonPaths: string[],
  summaryPaths: string[],
  detailsPath: string,
  damagesPaths: string[],
  vinculosConfirmados: Record<string, string>,
  turbinasRemovidas: string[],
  turbinasHorizonRemovidas: string[]
): Promise<any> {
  try {
    const removidasSet = new Set(turbinasRemovidas)
    const horRemovidasSet = new Set(turbinasHorizonRemovidas)
    const vinculos = vinculosConfirmados

    const dfHor = mergeHorizonBases(horizonPaths)
    const dfAtwRaw = mergeAtwSummaries(summaryPaths)

    if (!dfHor || !dfAtwRaw) {
      return { success: false, error: 'Falha ao processar base Horizon ou Summary.' }
    }

    const { df: dfAtw } = deduplicateAtw(dfAtwRaw)
    const nomesHorizon = new Set(
      dfHor.map(r => String(r.Turbine || '').trim()).filter(Boolean)
    )

    // Auto-matches
    const horNormToName: Record<string, string> = {}
    nomesHorizon.forEach(t => {
      horNormToName[normalizar(t)] = t
    })

    const atwNamesAll = new Set(
      dfAtw.map(r => String(r.Turbine || '').trim()).filter(Boolean)
    )

    const autoHorToAtw: Record<string, string> = {}
    const atwNormSeen = new Set<string>()
    Array.from(atwNamesAll).sort().forEach(atwT => {
      const nt = normalizar(atwT)
      if (horNormToName[nt] && !atwNormSeen.has(nt)) {
        const horT = horNormToName[nt]
        if (!vinculos[horT]) {
          autoHorToAtw[horT] = atwT
        }
        atwNormSeen.add(nt)
      }
    })

    const allHorToAtw = { ...autoHorToAtw, ...vinculos }
    const atwParaHor: Record<string, string> = {}
    Object.entries(allHorToAtw).forEach(([k, v]) => {
      atwParaHor[v] = k
    })

    // Rebuild taskMap
    const taskMap: Record<string, any> = {}
    const cols = ['Horizon Task ID', 'Site'].filter(c => c in dfHor[0])
    if (cols.length > 0) {
      const uniqueTurbines = new Set(dfHor.map(r => String(r.Turbine || '').trim()).filter(Boolean))
      uniqueTurbines.forEach(t => {
        const matchedRow = dfHor.find(r => String(r.Turbine || '').trim() === t)
        if (matchedRow) {
          const entry: any = {}
          cols.forEach(c => { entry[c] = matchedRow[c] })
          taskMap[t] = entry
        }
      })
    }

    Object.entries(allHorToAtw).forEach(([th, ta]) => {
      if (taskMap[th]) {
        taskMap[ta] = taskMap[th]
      }
    })

    const nomesAtwVinculados = new Set(Object.values(allHorToAtw))
    const validSet = new Set([
      ...nomesHorizon,
      ...nomesAtwVinculados
    ].filter(x => !removidasSet.has(x)))

    const errosPos: string[] = []
    const zip = new JSZip()

    // 1. Summary Final
    let dfSummaryFinal: any[] | null = null
    const validSetHor = new Set([...nomesHorizon].filter(x => !removidasSet.has(x) && !horRemovidasSet.has(x)))
    const dfHorFilt = dfHor.filter(row => validSetHor.has(String(row.Turbine || '').trim()))

    const dateColAtw = Object.keys(dfAtw[0]).find(c => c.toLowerCase().includes('date') || c.toLowerCase().includes('data'))
    const typeColAtw = Object.keys(dfAtw[0]).find(c => c.toLowerCase().includes('inspection type'))

    const hasDateCol = dateColAtw || ('Inspection Date' in dfHor[0])
    const hasTypeCol = typeColAtw || ('Inspection Type' in dfHor[0])

    const atwDate: Record<string, string> = {}
    const atwType: Record<string, string> = {}

    dfAtw.forEach(row => {
      const t = String(row.Turbine || '').trim()
      if (t) {
        atwDate[t] = String(dateColAtw ? row[dateColAtw] || '' : '').trim()
        atwType[t] = String(typeColAtw ? row[typeColAtw] || '' : '').trim()
      }
    })

    const atwNormDate: Record<string, string> = {}
    const atwNormType: Record<string, string> = {}
    Object.keys(atwDate).forEach(t => {
      const nt = normalizar(t)
      if (!atwNormDate[nt]) {
        atwNormDate[nt] = atwDate[t]
        atwNormType[nt] = atwType[t] || ''
      }
    })

    const lookupVal = (
      tHor: string,
      dExact: Record<string, string>,
      dNorm: Record<string, string>
    ): string => {
      const resolved = vinculos[tHor] || tHor
      if (dExact[resolved] !== undefined && dExact[resolved] !== '') return dExact[resolved]
      if (dExact[tHor] !== undefined && dExact[tHor] !== '') return dExact[tHor]
      return dNorm[normalizar(tHor)] || ''
    }

    dfHorFilt.forEach(row => {
      const t = String(row.Turbine || '').trim()
      if (!row['ID']) {
        row['ID'] = t
      }
      if (hasDateCol) {
        const val = lookupVal(t, atwDate, atwNormDate)
        row['Inspection Date'] = parseDateToYyyyMmDd(val)
      }
      if (hasTypeCol) {
        row['Inspection Type'] = lookupVal(t, atwType, atwNormType)
      }
    })

    dfSummaryFinal = dfHorFilt
    zip.file("summary_final.csv", toCsv(dfHorFilt, ','))

    // 2. Details Final
    const contentDetails = fs.readFileSync(detailsPath, 'utf-8')
    let dfD = loadCsvRobust(contentDetails)
    let dfDetailsFinal: any[] | null = null
    const validPhotos = new Set<string>()

    if (dfD && dfD.length > 0) {
      const idc = 'ID' in dfD[0] ? 'ID' : Object.keys(dfD[0])[0]
      dfD = dfD.filter(row => validSet.has(String(row[idc] || '').trim()) || nomesAtwVinculados.has(String(row[idc] || '').trim()))

      dfD.forEach(row => {
        const x = String(row[idc] || '').trim()
        row[idc] = atwParaHor[x] || x
      })

      const pathCol = Object.keys(dfD[0]).find(c => c.toLowerCase() === 'path') ||
                      Object.keys(dfD[0]).find(c => (c.toLowerCase().includes('file') || c.toLowerCase().includes('image')) && !c.toLowerCase().includes('url')) ||
                      Object.keys(dfD[0]).find(c => c.toLowerCase().includes('url')) ||
                      Object.keys(dfD[0])[Object.keys(dfD[0]).length - 1]

      dfD.forEach(row => {
        const n = String(row[pathCol] || '')
        if (n) validPhotos.add(cleanFilename(n))
      })

      dfD.forEach(row => {
        const x = String(row[idc] || '').trim()
        row['Horizon Task ID'] = taskMap[x]?.['Horizon Task ID'] || ''
      })

      const radColDet = Object.keys(dfD[0]).find(c => c.toLowerCase().includes('radial') || c.toLowerCase().includes('distance'))
      let nRadCorrigidos = 0
      if (radColDet) {
        dfD.forEach(row => {
          const valStr = String(row[radColDet] || '').trim()
          if (valStr !== '') {
            const valNum = parseFloat(valStr)
            if (!isNaN(valNum) && (valNum > 200 || valNum < -3)) {
              row[radColDet] = '0'
              nRadCorrigidos++
            }
          }
        })
      }

      dfDetailsFinal = dfD
      zip.file("details_final.csv", toCsv(dfD, ';'))

      if (nRadCorrigidos > 0) {
        errosPos.push(`Details: ${nRadCorrigidos} valor(es) de Radial Distance fora de [-3, 200] corrigido(s) para 0 (fotos humanizadas/VISUAL) sem Z válido.`)
      }
    }

    // 3. Damages Final
    const coveredPhotosByTurbine: Record<string, Set<string>> = {}
    for (const dp of damagesPaths || []) {
      if (fs.existsSync(dp)) {
        const contentDam = fs.readFileSync(dp, 'utf-8')
        let dfM = loadCsvRobust(contentDam, true)
        if (dfM && dfM.length > 0 && 'Photo File Name' in dfM[0]) {
          dfM = dfM.filter(row => validPhotos.has(cleanFilename(String(row['Photo File Name'] || ''))))
          if (dfM.length > 0) {
            zip.file(path.basename(dp), toDamageCsv(dfM))
            dfM.forEach(row => {
              const p = String(row['Photo File Name'] || '').trim()
              if (p) {
                const fp = cleanFilename(p)
                if (!coveredPhotosByTurbine['__all__']) coveredPhotosByTurbine['__all__'] = new Set()
                coveredPhotosByTurbine['__all__'].add(fp)
              }
            })
          }
        }
      }
    }

    // Validation
    if (dfSummaryFinal) {
      for (const campo of ['Horizon Task ID', 'Inspection Date', 'Inspection Type']) {
        if (dfSummaryFinal.length > 0 && campo in dfSummaryFinal[0]) {
          const semValor = dfSummaryFinal.filter(row => {
            const val = String(row[campo] || '').trim()
            return !val || ['nat', 'nan', 'none', 'null'].includes(val.toLowerCase())
          })
          if (semValor.length > 0) {
            const turbinasProb = Array.from(new Set(semValor.map(row => String(row.Turbine || '').trim()))).sort().join(', ')
            errosPos.push(`Summary: ${campo} vazio em: ${turbinasProb}`)
          }
        } else {
          errosPos.push(`Summary: coluna '${campo}' ausente no resultado final`)
        }
      }
    }

    if (dfDetailsFinal) {
      const semTask = dfDetailsFinal.filter(row => !String(row['Horizon Task ID'] || '').trim())
      if (semTask.length > 0) {
        errosPos.push(`Details: Horizon Task ID vazio em ${semTask.length} linha(s)`)
      }

      if (damagesPaths && damagesPaths.length > 0) {
        const idcDet2 = 'ID' in dfDetailsFinal[0] ? 'ID' : Object.keys(dfDetailsFinal[0])[0]
        const pathColDet = Object.keys(dfDetailsFinal[0]).find(c => c.toLowerCase() === 'path') ||
                           Object.keys(dfDetailsFinal[0]).find(c => (c.toLowerCase().includes('file') || c.toLowerCase().includes('image')) && !c.toLowerCase().includes('url'))

        const allCovered = coveredPhotosByTurbine['__all__'] || new Set()
        if (pathColDet && allCovered.size > 0) {
          const uniqueTurbines = Array.from(new Set(
            dfDetailsFinal.map(row => String(row[idcDet2] || '').trim()).filter(Boolean)
          )).sort()

          uniqueTurbines.forEach(turbina => {
            const fotosT = dfDetailsFinal!
              .filter(row => String(row[idcDet2] || '').trim() === turbina)
              .map(row => cleanFilename(String(row[pathColDet] || '')))
              .filter(Boolean)

            const hasCovered = fotosT.some(f => allCovered.has(f))
            if (fotosT.length > 0 && !hasCovered) {
              errosPos.push(`Damages: ${turbina} — nenhum CSV de danos inclui as suas fotos no pacote`)
            }
          })
        }
      } else {
        errosPos.push("Nenhum arquivo de Damages foi incluído no pacote.")
      }
    }

    const outDir = path.join(path.dirname(summaryPaths[0]), "HORIZON_OUTPUT")
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true })
    }

    let siteName = ""
    if (dfAtw && dfAtw.length > 0 && 'Site' in dfAtw[0]) {
      const sites = Array.from(new Set(dfAtw.map(row => String(row.Site || '').trim()).filter(Boolean)))
      if (sites.length > 0) {
        siteName = sites[0].replace(/[\\/*?:"<>|]/g, "").replace(/\s+/g, "_")
      }
    }

    const zipName = siteName ? `${siteName}_horizon_package.zip` : "horizon_package.zip"
    const zipPath = path.join(outDir, zipName)

    const zipContent = await zip.generateAsync({ type: 'nodebuffer' })
    fs.writeFileSync(zipPath, zipContent)

    return {
      success: true,
      zip_path: zipPath,
      output_dir: outDir,
      erros_pos: errosPos
    }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

export async function horizonCorrigirDamagesDireto(paths: string[], siteName = "", webContents?: any): Promise<any> {
  const sendLog = (text: string, type = 'info') => {
    if (webContents) webContents.send('arthlog', { type, text })
  }

  const correctedFiles: string[] = []
  try {
    for (const pStr of paths) {
      if (!fs.existsSync(pStr)) continue
      const p = pStr

      const text = fs.readFileSync(p, 'utf-8')
      const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
      if (lines.length === 0) continue

      const firstLine = lines[0]
      const sep = firstLine.split(';').length > firstLine.split(',').length ? ';' : ','
      const headers = firstLine.split(sep).map(h => h.trim().replace(/['"]/g, ''))

      let coordsIdx = -1
      let dateIdx = -1
      headers.forEach((h, idx) => {
        if (h.toLowerCase() === 'coordinates') coordsIdx = idx
        else if (h.toLowerCase() === 'date') dateIdx = idx
      })

      if (coordsIdx === -1) {
        coordsIdx = headers.length - 1
      }

      const hasSite = headers.some(h => h.toLowerCase() === 'site')
      const hasTurbine = headers.some(h => h.toLowerCase() === 'turbine')
      const hasInspDate = headers.some(h => h.toLowerCase() === 'inspection date')

      const newHeaders = [...headers]
      if (!hasSite) newHeaders.push('Site')
      if (!hasTurbine) newHeaders.push('Turbine')
      if (!hasInspDate) newHeaders.push('Inspection Date')

      let guessedSite = siteName
      if (!hasSite && !guessedSite) {
        const parentFolder = path.basename(path.dirname(path.dirname(p)))
        guessedSite = parentFolder.replace(/^(complexo\s+eólico\s+|complexo\s+eolico\s+)/i, '').trim()
      }

      let turbineVal = ""
      if (!hasTurbine) {
        turbineVal = path.basename(p, path.extname(p)).replace(/_fixed$/i, '').trim()
      }

      const outputRows: string[][] = []
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i]
        let parts = line.split(sep)
        let rowData: string[] = []

        if (sep === ',' && parts.length > headers.length) {
          const extraParts = parts.length - headers.length
          const rowBefore = parts.slice(0, coordsIdx)
          const coordsParts = parts.slice(coordsIdx, coordsIdx + extraParts + 1)
          const rowAfter = parts.slice(coordsIdx + extraParts + 1)

          let coordsVal = coordsParts.join(',').trim().replace(/^['"]|['"]$/g, '')
          if (coordsVal.startsWith('[[') && coordsVal.endsWith(']]')) {
            coordsVal = coordsVal.substring(1, coordsVal.length - 1)
          }
          coordsVal = coordsVal.replace(/\s+/g, '')
          rowData = [...rowBefore, coordsVal, ...rowAfter]
        } else {
          rowData = parts.slice(0, headers.length).map(val => val.trim().replace(/^['"]|['"]$/g, ''))
          if (rowData.length > coordsIdx) {
            let cVal = rowData[coordsIdx]
            if (cVal.startsWith('[[') && cVal.endsWith(']]')) {
              cVal = cVal.substring(1, cVal.length - 1)
            }
            cVal = cVal.replace(/\s+/g, '')
            rowData[coordsIdx] = cVal
          }
        }

        while (rowData.length < headers.length) {
          rowData.push('')
        }

        if (!hasSite) rowData.push(guessedSite)
        if (!hasTurbine) rowData.push(turbineVal)
        if (!hasInspDate) {
          let dateVal = ""
          if (dateIdx !== -1 && dateIdx < rowData.length) {
            dateVal = rowData[dateIdx].trim()
          }
          rowData.push(dateVal)
        }

        outputRows.push(rowData)
      }

      const outName = `${path.basename(p, path.extname(p))}_fixed.csv`
      const outPath = path.join(path.dirname(p), outName)

      const csvLines = [newHeaders.join(',')]
      outputRows.forEach(row => {
        const escapedRow = row.map(cell => {
          if (cell.includes(',') || cell.includes('"') || cell.includes('\n')) {
            return `"${cell.replace(/"/g, '""')}"`
          }
          return cell
        })
        csvLines.push(escapedRow.join(','))
      })

      fs.writeFileSync(outPath, csvLines.join('\r\n'), 'utf-8')
      correctedFiles.push(outPath)
      sendLog(`✔ Higienizado: ${path.basename(p)} → ${outName}`, "success")
    }

    return { success: true, corrected_files: correctedFiles }
  } catch (err: any) {
    sendLog(`Erro ao higienizar damages: ${err.message}`, "error")
    return { success: false, error: err.message }
  }
}
