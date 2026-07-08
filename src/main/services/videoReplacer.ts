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

    // 2. Escanear a pasta de destino (Turbinas) e substituir se encontrar paridade
    sendLog(`Buscando vídeos correspondentes nas pastas das turbinas...`, 'info')
    let totalFound = 0
    let totalReplaced = 0

    function processTarget(dir: string) {
      const entries = fs.readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          processTarget(fullPath)
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.mp4')) {
          const lName = entry.name.toLowerCase()
          if (sourceMap.has(lName)) {
            const srcPath = sourceMap.get(lName)!
            totalFound++
            
            // Obter informações do caminho da turbina para um log mais limpo
            // Ex: D:\360\VSR06-06\BLADE 535\360-03HRS\video.mp4
            // Queremos mostrar: VSR06-06 -> BLADE 535 -> 360-03HRS
            const relative = path.relative(targetFolder, fullPath)
            const parts = relative.split(path.sep)
            const locationStr = parts.slice(0, -1).join(' ➔ ')
            
            if (dryRun) {
              sendLog(`[Dry-run] Encontrado: ${entry.name} em [${locationStr}]`, 'success')
              totalReplaced++
            } else {
              try {
                fs.copyFileSync(srcPath, fullPath)
                sendLog(`✔ Substituído: ${entry.name} em [${locationStr}]`, 'success')
                totalReplaced++
              } catch (err: any) {
                sendLog(`❌ Erro ao copiar ${entry.name}: ${err.message}`, 'error')
              }
            }
          }
        }
      }
    }

    processTarget(targetFolder)

    sendLog(`\n=== PROCESSAMENTO CONCLUÍDO ===`, 'info')
    sendLog(`Total de vídeos correspondentes encontrados: ${totalFound}`, 'info')
    sendLog(`Total de vídeos substituídos: ${totalReplaced}`, 'success')

    return { success: true, totalFound, totalReplaced }
  } catch (err: any) {
    sendLog(`Erro crítico durante o processamento: ${err.message}`, 'error')
    return { success: false, error: err.message }
  }
}
