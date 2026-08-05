import fs from 'fs'
import path from 'path'

export interface BatchStitchResult {
  success: boolean
  count: number
  files: string[]
  error?: string
}

/**
 * Gera um arquivo .insprj pré-configurado com perfil de alta velocidade:
 * - ai_stitch="0"        → Costura por calibração de modelo (rápida), sem Optical Flow AI
 * - optical_flow_stitching="0" → Sem fluxo óptico (lento)
 * - projection="64"      → Equirretangular 2:1 (formato padrão 360 esférico)
 * - image_fusion="1"     → Fusão de imagem ativa
 */
export function generateInsprjPreset(videoPath: string, outputPath?: string): string {
  const videoP = path.resolve(videoPath)
  const folderStr = path.dirname(videoP).replace(/\\/g, '/')
  const fileName = path.basename(videoP)
  const baseName = path.basename(videoP, path.extname(videoP)) // strip .mp4 / .insv
  const outPath = outputPath || path.join(path.dirname(videoP), `${baseName}.insprj`)

  const now = new Date()
  const creationStamp = Math.floor(now.getTime() / 1000)
  const dateFmt = now.toISOString().replace('T', ' ').slice(0, 19).replace(/-/g, '.')

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<project version="2.0.0">
    <meta app="Insta360 Studio 5.9.10" creation_time="${creationStamp}" version="5.9.10"/>
    <file_group cloud_file_set_offset="1" cloud_media_id="${folderStr}/${fileName}" count="1" folder="${folderStr}" image_type="0" is_cloud_file="0" type="video_normal">
        <file name="${fileName}"/>
    </file_group>
    <schemes default="Clip1">
        <scheme app_data_id="" app_data_mode="" app_data_ratio="" app_data_source="" app_data_types="" creation="${dateFmt}" has_deeptrack_user_added="0" has_deeptrack_user_edited="0" has_headtrack_keyframe_user_added="0" has_headtrack_keyframe_user_edited="0" has_keyframe_user_added="0" has_keyframe_user_edited="0" id="Clip1" last_edit_time="${dateFmt}" load_hight_data="0">
            <preference duration="0" favourite="0" last_trim_edit_time="${creationStamp}000" ratio_height="9" ratio_width="16" shell_corrected="0" trim_end="0" trim_start="0">
                <rendering accessory="0" ai_raw="0" alpha="0" blend_angle="0" camera_movement="0" fov="1.3089969158172607" projection="64" roll="0" stabilization="1" yaw="0">
                    <play_rate/>
                </rendering>
                <optimization>
                    <stitching ai_stitch="0" dynamic_stitching="0" image_fusion="1" optical_flow_stitching="0"/>
                </optimization>
            </preference>
        </scheme>
    </schemes>
</project>
`

  fs.writeFileSync(outPath, xml, 'utf-8')
  return outPath
}

/**
 * Escaneia recursivamente um diretório raiz (ex: D:\360\28.07.2026) em busca de
 * vídeos brutos (.mp4 e .insv) e gera arquivos .insprj pré-configurados ao lado de cada vídeo.
 * Ignora vídeos já processados (_stitched.mp4 / _WATERMARKED.mp4 / _stabilized.mp4).
 */
export async function batchStitchDirectory(
  rootDir: string,
  mode: 'insprj' | 'ffmpeg' = 'insprj',
  sender?: Electron.WebContents
): Promise<BatchStitchResult> {
  const sendLog = (message: string, type = 'info') => {
    if (sender) {
      sender.send('batch_stitch_log', { message, type })
    }
  }

  if (!fs.existsSync(rootDir)) {
    return { success: false, count: 0, files: [], error: `Diretorio nao encontrado: ${rootDir}` }
  }

  sendLog(`Escaneando videos 360 brutos em: ${rootDir}`)

  // Coleta recursiva de arquivos
  const rawFiles: string[] = []

  const walk = (dir: string) => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(fullPath)
      } else if (entry.isFile()) {
        const lower = entry.name.toLowerCase()
        if (lower.endsWith('.insv')) {
          rawFiles.push(fullPath)
        } else if (
          lower.endsWith('.mp4') &&
          !lower.includes('_stitched') &&
          !lower.includes('_watermarked') &&
          !lower.includes('_stabilized')
        ) {
          rawFiles.push(fullPath)
        }
      }
    }
  }

  walk(rootDir)

  sendLog(`Encontrados ${rawFiles.length} arquivos brutos 360.`)

  if (rawFiles.length === 0) {
    return { success: true, count: 0, files: [] }
  }

  const processed: string[] = []

  if (mode === 'insprj') {
    sendLog(`Gerando projetos Insta360 (.insprj) com perfil de alta velocidade (H.264, sem Optical Flow AI)...`)
    for (let i = 0; i < rawFiles.length; i++) {
      const videoPath = rawFiles[i]
      try {
        const insprjPath = generateInsprjPreset(videoPath)
        processed.push(insprjPath)
        sendLog(`  [${i + 1}/${rawFiles.length}] Projeto gerado: ${path.basename(insprjPath)}`, 'success')
      } catch (err: any) {
        sendLog(`  [${i + 1}/${rawFiles.length}] Erro ao gerar projeto para ${path.basename(videoPath)}: ${err.message}`, 'error')
      }
    }

    sendLog(`Concluido! ${processed.length} projetos .insprj gerados com sucesso.`, 'success')
    sendLog(`Abra o Insta360 Studio e carregue os projetos para renderizacao em lote com H.264.`, 'info')
  }

  return {
    success: true,
    count: processed.length,
    files: processed
  }
}
