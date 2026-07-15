import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

const BASE_URL = "https://scheduler.arthnex.com/"
const HOMOLOG_URL = "https://scheduler-homolog.arthnex.com/"
const API_KEY = "22F9C68C-BC34-46A5-B10F-9E58759C7B95"

const HEADERS = {
  "Content-Type": "application/json",
  "x-api-key": API_KEY,
}

function getClientBase(useHomolog: boolean): string {
  return useHomolog ? HOMOLOG_URL : BASE_URL
}

export async function listarWorkorders(useHomolog = false): Promise<any[]> {
  const url = `${getClientBase(useHomolog)}get-active-workorders`
  const resp = await fetch(url, { headers: HEADERS })
  if (!resp.ok) throw new Error(`HTTP ${resp.status} on get-active-workorders`)
  return resp.json() as Promise<any[]>
}

export async function listarPasPendentes(workorderId: string, useHomolog = false): Promise<any[]> {
  const url = `${getClientBase(useHomolog)}get-blades-pending-by-wo-packages/${workorderId}`
  const resp = await fetch(url, { headers: HEADERS })
  if (!resp.ok) throw new Error(`HTTP ${resp.status} on get-blades-pending-by-wo-packages`)
  return resp.json() as Promise<any[]>
}

function detectarSeFoto360(caminhoImagem: string): boolean {
  try {
    if (!fs.existsSync(caminhoImagem)) return false
    const fd = fs.openSync(caminhoImagem, 'r')
    const buffer = Buffer.alloc(512 * 1024)
    const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0)
    fs.closeSync(fd)
    
    const slice = buffer.subarray(0, bytesRead)
    return slice.includes('GPano:ProjectionType')
  } catch {
    return false
  }
}

function lerDimensoesJpeg(caminhoImagem: string): { width: number; height: number } {
  const buffer = fs.readFileSync(caminhoImagem)
  let i = 0
  if (buffer[i] !== 0xFF || buffer[i + 1] !== 0xD8) {
    throw new Error('Not a valid JPEG')
  }
  i += 2
  while (i < buffer.length) {
    if (buffer[i] === 0xFF) {
      const marker = buffer[i + 1]
      if (marker === 0xC0 || marker === 0xC2) {
        const height = buffer.readUInt16BE(i + 5)
        const width = buffer.readUInt16BE(i + 7)
        return { width, height }
      }
      i += 2 + buffer.readUInt16BE(i + 2)
    } else {
      i++
    }
  }
  throw new Error('SOF marker not found')
}

function lerCsv(csvPath: string): Promise<Record<string, string>[]> {
  return new Promise((resolve, reject) => {
    try {
      const content = fs.readFileSync(csvPath, 'utf-8')
      const lines = content.split(/\r?\n/)
      if (lines.length === 0) {
        return resolve([])
      }
      
      const headerLine = lines[0].replace(/^\uFEFF/, '') // strip BOM
      const headers = headerLine.split(',').map(h => h.trim())
      
      const results: Record<string, string>[] = []
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim()
        if (!line) continue
        
        const values = line.split(',').map(v => v.trim())
        const row: Record<string, string> = {}
        headers.forEach((h, idx) => {
          row[h] = values[idx] || ''
        })
        results.push(row)
      }
      resolve(results)
    } catch (e) {
      reject(e)
    }
  })
}

function normalizarNomePa(name: string): string {
  return name.replace(/[_-]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase()
}

// Colunas que só existem no CSV de upload (photo_data já convertido pra formato Arthnex),
// o suficiente pra distinguir de outros CSVs do fluxo (telemetria, relatório de altitude,
// blade split etc.) sem precisar ler o arquivo inteiro — só a linha de cabeçalho.
const COLUNAS_CSV_UPLOAD = ['image_id', 'blade', 'region']

function lerCabecalhoCsv(csvPath: string): string[] {
  const fd = fs.openSync(csvPath, 'r')
  const buffer = Buffer.alloc(4096)
  const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0)
  fs.closeSync(fd)
  const primeiraLinha = buffer.subarray(0, bytesRead).toString('utf-8').split(/\r?\n/)[0]
  return primeiraLinha.replace(/^﻿/, '').split(',').map(h => h.trim().toLowerCase())
}

function ehCsvDeUpload(csvPath: string): boolean {
  try {
    const headers = lerCabecalhoCsv(csvPath)
    return COLUNAS_CSV_UPLOAD.every(col => headers.includes(col))
  } catch {
    return false
  }
}

export function descobrirCsvsUpload(rootPath: string): string[] {
  const encontrados: string[] = []

  function scan(dir: string): void {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        scan(fullPath)
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.csv') && ehCsvDeUpload(fullPath)) {
        encontrados.push(fullPath)
      }
    }
  }

  scan(rootPath)
  return encontrados
}

async function processarUploadCsv(
  csvPath: string,
  rows: Record<string, string>[],
  workorderId: string,
  windbladeId: string,
  pSurface: string,
  collectDate: string,
  turbineId: string,
  useHomolog: boolean,
  sendLog: (text: string, type?: string) => void,
  sendProgress: (current: number, total: number) => void
): Promise<{ success: boolean; enviados: number; total: number; falhas: any[]; error?: string }> {
  try {
    const fotosDir = path.dirname(csvPath)
    const base = getClientBase(useHomolog)

    if (!rows || rows.length === 0) {
      return { success: false, enviados: 0, total: 0, falhas: [], error: "CSV vazio ou sem linhas válidas." }
    }

    const technology = pSurface === "internal" ? "Arthbot" : "Arthdrone"
    const payload: any[] = []
    const rowsByBasename: Record<string, any> = {}

    for (const row of rows) {
      const rowUuid = crypto.randomUUID()
      const baseName = path.basename(row.image_id)
      rowsByBasename[baseName] = row
      const caminhoFoto = path.join(fotosDir, row.image_id)
      
      let width = 0, height = 0
      try {
        const dims = lerDimensoesJpeg(caminhoFoto)
        width = dims.width
        height = dims.height
      } catch {
        // use 0, 0
      }

      const is360 = detectarSeFoto360(caminhoFoto)
      const itemPayload: any = {
        "type": "image/jpeg",
        "originalFilename": baseName,
        "location": row.distance_to_hub || "0",
        "name": rowUuid,
        "region": row.region || "",
        "serial": row.blade || "",
        "windblade_id": parseInt(windbladeId, 10),
        "workorder_id": workorderId,
        "width": width,
        "height": height,
        "date_image": collectDate,
        "pixelSize": row.mm_px || "0.0",
        "technology": technology,
        "upload_source": "Office",
      }
      if (is360) {
        itemPayload["is_360"] = true
      }
      payload.push(itemPayload)
    }

    sendLog(`Solicitando ${payload.length} URLs pré-assinadas...`, "info")
    
    const presignResp = await fetch(`${base}get-presign-urls-incremental`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify(payload)
    })
    if (!presignResp.ok) throw new Error(`HTTP ${presignResp.status} on get-presign-urls-incremental`)
    const presigns = await presignResp.json() as any[]

    if (!presigns || presigns.length === 0) {
      return { success: false, enviados: 0, total: 0, falhas: [], error: "Nenhuma foto retornada pelo servidor (já enviadas, ou nada a enviar)." }
    }

    await fetch(`${base}save-collect-date`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({
        workorder_id: workorderId,
        collect_date: collectDate,
        turbine_id: turbineId,
        windblade_id: parseInt(windbladeId, 10),
      })
    })

    const total = presigns.length
    let enviados = 0
    const falhas: any[] = []
    let queuePool: any[] = []

    for (let i = 0; i < total; i++) {
      const item = presigns[i]
      const row = rowsByBasename[item.originalFilename]
      const localName = row ? row.image_id : item.originalFilename
      const localPath = path.join(fotosDir, localName)

      try {
        const fileData = fs.readFileSync(localPath)
        const putResp = await fetch(item.url, {
          method: 'PUT',
          body: fileData,
          headers: {
            'Content-Type': 'image/jpeg',
            'Content-Disposition': 'inline'
          }
        })
        if (!putResp.ok) throw new Error(`PUT falhou (${putResp.status})`)
        
        enviados++
        queuePool.push({
          serial: item.serial,
          workorder_id: workorderId,
          windblade_id: parseInt(windbladeId, 10)
        })
      } catch (e: any) {
        falhas.push({ arquivo: localName, erro: e.message })
        sendLog(`Falha ao enviar ${localName}: ${e.message}`, "error")
      }

      sendProgress(i + 1, total)

      if (queuePool.length >= 30) {
        await fetch(`${base}update-galleries-urls-queue`, {
          method: 'POST',
          headers: HEADERS,
          body: JSON.stringify(queuePool)
        })
        queuePool = []
      }
    }

    if (queuePool.length > 0) {
      await fetch(`${base}update-galleries-urls-queue`, {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify(queuePool)
      })
    }

    sendLog(`Upload concluído: ${enviados}/${total} fotos enviadas.`, falhas.length === 0 ? "success" : "warn")
    return { success: true, enviados, total, falhas }
  } catch (err: any) {
    sendLog(`Erro no upload: ${err.message}`, "error")
    return { success: false, enviados: 0, total: 0, falhas: [], error: err.message }
  }
}

export async function uploadMultiplasCsv(
  csvPaths: string[],
  workorderId: string,
  pSurface: string,
  collectDate: string,
  useHomolog = false,
  webContents?: any
): Promise<any> {
  const sendLog = (text: string, type = 'info') => {
    if (webContents) webContents.send('arthlog', { type, text })
  }
  const sendProgress = (current: number, total: number) => {
    if (webContents) webContents.send('arthprogress', { current, total })
  }
  const sendFileProgress = (fileIndex: number, fileTotal: number, fileName: string) => {
    if (webContents) webContents.send('arthnex_batch_progress', { fileIndex, fileTotal, fileName })
  }

  const resultados: any[] = []
  let totalEnviados = 0
  let totalFotos = 0
  let arquivosComFalha = 0

  try {
    sendLog(`Buscando pás pendentes da workorder para casar com os CSVs...`, 'info')
    const blades = await listarPasPendentes(workorderId, useHomolog)
    const bladesPorNome: Record<string, any> = {}
    for (const b of blades) {
      bladesPorNome[normalizarNomePa(b.blade)] = b
    }

    for (let i = 0; i < csvPaths.length; i++) {
      const csvPath = csvPaths[i]
      const fileName = path.basename(csvPath)
      sendFileProgress(i + 1, csvPaths.length, fileName)
      sendLog(`\n=== Arquivo ${i + 1}/${csvPaths.length}: ${fileName} ===`, 'info')

      let rows: Record<string, string>[]
      try {
        rows = await lerCsv(csvPath)
      } catch (e: any) {
        sendLog(`Falha ao ler ${fileName}: ${e.message}`, 'error')
        resultados.push({ arquivo: fileName, success: false, error: e.message })
        arquivosComFalha++
        continue
      }

      const bladeSerial = rows[0]?.blade || ''
      const matched = bladesPorNome[normalizarNomePa(bladeSerial)]

      if (!bladeSerial || !matched) {
        sendLog(`⚠ Pá '${bladeSerial || '(vazio)'}' do CSV '${fileName}' não foi encontrada entre as pás pendentes desta workorder. Pulando...`, 'warning')
        resultados.push({ arquivo: fileName, success: false, error: `Pá '${bladeSerial}' não encontrada na workorder` })
        arquivosComFalha++
        continue
      }

      sendLog(`   Pá detectada: ${bladeSerial} ➔ ${matched.blade} (${matched.turbine})`, 'info')

      const r = await processarUploadCsv(
        csvPath, rows, workorderId, String(matched.id), pSurface, collectDate, String(matched.turbine_id), useHomolog,
        sendLog, sendProgress
      )

      resultados.push({ arquivo: fileName, blade: matched.blade, turbine: matched.turbine, ...r })
      if (r.success) {
        totalEnviados += r.enviados
        totalFotos += r.total
        if (r.falhas.length > 0) arquivosComFalha++
      } else {
        arquivosComFalha++
      }
    }

    sendLog(`\n=== LOTE FINALIZADO ===`, 'info')
    sendLog(`Arquivos processados: ${csvPaths.length}, com falha: ${arquivosComFalha}`, arquivosComFalha === 0 ? 'success' : 'warn')
    sendLog(`Total de fotos enviadas: ${totalEnviados}/${totalFotos}`, 'success')

    return { success: true, resultados, totalEnviados, totalFotos, arquivosComFalha }
  } catch (err: any) {
    sendLog(`Erro crítico no upload em lote: ${err.message}`, 'error')
    return { success: false, error: err.message, resultados }
  }
}
