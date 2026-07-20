import fs from 'fs'
import path from 'path'

export async function substituirVideos360(
  outputFolder: string,
  targetFolder: string,
  dryRun: boolean,
  sender: Electron.WebContents
): Promise<any> {
  const sendLog = (text: string, type = 'info') => {
    if (sender) sender.send('arthlog', { type, text })
  }

  try {
    sendLog(`Iniciando substituição de vídeos...`, 'info')
    sendLog(`Origem (Insta360 Studio): ${outputFolder}`, 'info')
    sendLog(`Destino (Turbinas 360): ${targetFolder}`, 'info')
    if (dryRun) {
      sendLog(`[DRY-RUN] Simulação ativa. Nenhum arquivo será gravado físico.`, 'warning')
    }

    if (!fs.existsSync(outputFolder)) {
      sendLog(`Erro: Pasta de origem não existe.`, 'error')
      return { success: false, error: 'Pasta de origem não existe.' }
    }
    if (!fs.existsSync(targetFolder)) {
      sendLog(`Erro: Pasta de destino não existe.`, 'error')
      return { success: false, error: 'Pasta de destino não existe.' }
    }

    // 1. Mapear todos os arquivos da pasta de origem (Insta360 Output)
    sendLog(`Escaneando pasta de origem...`, 'info')
    const sourceMap = new Map<string, string>()

    // Varredura permanece síncrona (só lista nomes, não abre/copia arquivo nenhum — rápido
    // mesmo com muitas pastas). O que precisa ser assíncrono é a CÓPIA em si (passo 2).
    function scanSource(dir: string) {
      const entries = fs.readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          scanSource(fullPath)
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.mp4')) {
          sourceMap.set(entry.name.toLowerCase(), fullPath)
        }
      }
    }

    scanSource(outputFolder)
    sendLog(`Escaneamento da origem concluído: ${sourceMap.size} vídeo(s) MP4 mapeado(s).`, 'info')

    // 2. Escanear a pasta de destino (Turbinas) e substituir se encontrar paridade.
    // Primeiro monta a lista de arquivos-alvo (rápido, só readdirSync), DEPOIS copia cada
    // um de forma assíncrona (fs.promises.copyFile) — antes era fs.copyFileSync dentro da
    // própria varredura recursiva, 100% síncrono. Com poucos vídeos pequenos isso passava
    // despercebido, mas com muitos vídeos grandes (ex.: 146 renderizados de uma vez no
    // Insta360 Studio) travava o processo principal do Electron por todo o tempo da cópia,
    // sem reportar nenhum progresso — o app ficava sem responder a nada, parecendo travado.
    sendLog(`Buscando vídeos correspondentes nas pastas das turbinas...`, 'info')
    let totalFound = 0
    let totalReplaced = 0

    type TargetMatch = { fullPath: string; srcPath: string; name: string; locationStr: string }
    const matches: TargetMatch[] = []

    function scanTarget(dir: string) {
      const entries = fs.readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          scanTarget(fullPath)
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.mp4')) {
          const lName = entry.name.toLowerCase()
          if (sourceMap.has(lName)) {
            // Ex.: D:\360\VSR06-06\BLADE 535\360-03HRS\video.mp4 -> VSR06-06 ➔ BLADE 535 ➔ 360-03HRS
            const relative = path.relative(targetFolder, fullPath)
            const parts = relative.split(path.sep)
            matches.push({ fullPath, srcPath: sourceMap.get(lName)!, name: entry.name, locationStr: parts.slice(0, -1).join(' ➔ ') })
          }
        }
      }
    }

    scanTarget(targetFolder)
    totalFound = matches.length
    sendLog(`${totalFound} vídeo(s) correspondente(s) encontrado(s).`, 'info')

    for (let i = 0; i < matches.length; i++) {
      const { fullPath, srcPath, name, locationStr } = matches[i]
      if (i % 5 === 0 || i === matches.length - 1) {
        sender.send('arthprogress', { current: i + 1, total: matches.length })
      }
      if (dryRun) {
        sendLog(`[Dry-run] Encontrado: ${name} em [${locationStr}]`, 'success')
        totalReplaced++
      } else {
        try {
          await fs.promises.copyFile(srcPath, fullPath)
          sendLog(`✔ Substituído: ${name} em [${locationStr}]`, 'success')
          totalReplaced++
        } catch (err: any) {
          sendLog(`❌ Erro ao copiar ${name}: ${err.message}`, 'error')
        }
      }
    }

    sendLog(`\n=== PROCESSAMENTO CONCLUÍDO ===`, 'info')
    sendLog(`Total de vídeos correspondentes encontrados: ${totalFound}`, 'info')
    sendLog(`Total de vídeos substituídos: ${totalReplaced}`, 'success')

    return { success: true, totalFound, totalReplaced }
  } catch (err: any) {
    sendLog(`Erro crítico durante o processamento: ${err.message}`, 'error')
    return { success: false, error: err.message }
  }
}
