import fs from 'fs'
import path from 'path'

export async function enviarVideosDrive(
  localTurbineFolder: string,
  driveTurbineFolder: string,
  dryRun: boolean,
  sender: Electron.WebContents
): Promise<any> {
  const sendLog = (text: string, type = 'info') => {
    if (sender) sender.send('arthlog', { type, text })
  }

  try {
    sendLog(`Iniciando sincronização de vídeos Arthfilm...`, 'info')
    sendLog(`Origem local (PC): ${localTurbineFolder}`, 'info')
    sendLog(`Destino (Google Drive): ${driveTurbineFolder}`, 'info')

    if (dryRun) {
      sendLog(`[DRY-RUN] Simulação ativa. Nenhum arquivo físico será alterado.`, 'warning')
    }

    if (!fs.existsSync(localTurbineFolder)) {
      sendLog(`Erro: Pasta de origem local não existe.`, 'error')
      return { success: false, error: 'Pasta de origem local não existe.' }
    }
    if (!fs.existsSync(driveTurbineFolder)) {
      sendLog(`Erro: Pasta de destino no Drive não existe.`, 'error')
      return { success: false, error: 'Pasta de destino no Drive não existe.' }
    }

    // 1. Escaneamento recursivo da pasta local à procura de pastas "360 watermark"
    sendLog(`Escaneando pasta local por diretórios '360 watermark'...`, 'info')
    const localWatermarkDirs: string[] = []

    function scanDir(dir: string) {
      const list = fs.readdirSync(dir, { withFileTypes: true })
      for (const entry of list) {
        const fullPath = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          const normName = entry.name.replace(/_/g, ' ').trim().toLowerCase()
          if (normName === '360 watermark') {
            localWatermarkDirs.push(fullPath)
          } else if (!entry.name.startsWith('.')) {
            scanDir(fullPath)
          }
        }
      }
    }

    scanDir(localTurbineFolder)
    sendLog(`Varredura finalizada. Localizada(s) ${localWatermarkDirs.length} pasta(s) '360 watermark'.`, 'info')

    if (localWatermarkDirs.length === 0) {
      sendLog(`Nenhuma pasta de vídeos '360 watermark' foi encontrada na turbina local.`, 'warning')
      return { success: true, copiedFolders: 0, copiedFiles: 0 }
    }

    let copiedFolders = 0
    let copiedFiles = 0

    // 2. Processar cada pasta mapeada
    for (const srcWatermark of localWatermarkDirs) {
      // Obter o caminho relativo a partir da raiz da turbina selecionada
      const relPath = path.relative(localTurbineFolder, srcWatermark)
      // Ex: BLADE 0342\360-03HRS\360 watermark -> divide em partes
      const parts = relPath.split(path.sep)
      // Remove o último elemento ('360 watermark') para obter o caminho da pá e horário
      const subpathParts = parts.slice(0, -1)
      const subpath = path.join(...subpathParts)

      // Caminho correspondente do Drive finalizando com "FINAL"
      const destFinalDir = path.join(driveTurbineFolder, subpath, 'FINAL')
      sendLog(`Mapeado: [${subpath}] ➔ Destino: [${destFinalDir}]`, 'info')

      // Ler subpastas de região (LE 3 horas, CE 3 horas etc)
      const regions = fs.readdirSync(srcWatermark, { withFileTypes: true })
      for (const reg of regions) {
        const srcRegPath = path.join(srcWatermark, reg.name)
        if (reg.isDirectory()) {
          const destRegPath = path.join(destFinalDir, reg.name)
          sendLog(`   ➡ Copiando região: ${reg.name}`, 'info')

          if (!dryRun) {
            fs.mkdirSync(destRegPath, { recursive: true })
          }

          const files = fs.readdirSync(srcRegPath, { withFileTypes: true })
          for (const file of files) {
            if (file.isFile()) {
              const srcFilePath = path.join(srcRegPath, file.name)
              const destFilePath = path.join(destRegPath, file.name)

              if (dryRun) {
                sendLog(`      [Dry-run] Copiaria arquivo: ${file.name}`, 'success')
                copiedFiles++
              } else {
                try {
                  fs.copyFileSync(srcFilePath, destFilePath)
                  sendLog(`      ✔ Copiado: ${file.name}`, 'success')
                  copiedFiles++
                } catch (copyErr: any) {
                  sendLog(`      ❌ Erro ao copiar ${file.name}: ${copyErr.message}`, 'error')
                }
              }
            }
          }
          copiedFolders++
        }
      }
    }

    sendLog(`\n=== PROCESSO FINALIZADO ===`, 'info')
    sendLog(`Total de pastas de regiões criadas/atualizadas: ${copiedFolders}`, 'success')
    sendLog(`Total de arquivos de vídeos copiados: ${copiedFiles}`, 'success')
    if (!dryRun) {
      sendLog(`Nota: O Google Drive para Computador sincronizará os novos arquivos em background.`, 'info')
    }

    return { success: true, copiedFolders, copiedFiles }
  } catch (err: any) {
    sendLog(`Erro crítico ao processar o upload de vídeos: ${err.message}`, 'error')
    return { success: false, error: err.message }
  }
}
