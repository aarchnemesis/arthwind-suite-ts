# Arthwind Suite (Electron) v1.6.0

Plataforma integrada em Electron, React e TypeScript para automação de **S&R** (Sort & Remove) em inspeções de aerogeradores com drones DJI, processamento Horizon, operações Arthbot/Arthnex, automação SNOW e ferramentas de vídeo 360°. Otimiza o fluxo entre coleta de campo e plataformas de laudo: organiza fotos, corrige Z zerado, recupera fotos perdidas, separa pás misturadas, converte CSVs, empacota submissões e preenche formulários de dano automaticamente.

**Evolução da Arthwind Suite original (Python + PyWebView) — mesma proposta, agora em Electron nativo, com o SNOW Processor/Automation como frente mais recente de desenvolvimento.**

Desenvolvida para uso interno, com foco em precisão e velocidade. Modular, bilíngue (PT-BR/EN), com interface gráfica nativa via Electron + React.

---

## Status

- **Versão:** 1.6.0
- **Interface:** GUI nativa (Electron + React)
- **Uso principal:** Windows 10/11 64-bit
- **Binário Windows:** instalador NSIS gerado por `npm run build:win` (`dist/arthwind-suite-ts-<versão>-setup.exe`)

---

## Como usar (usuário final)

1. Baixe/receba o instalador `arthwind-suite-ts-<versão>-setup.exe`
2. Execute o instalador (one-click)
3. A interface abre diretamente
4. Selecione o módulo desejado na barra lateral agrupada por categoria
5. Clique nos campos para selecionar arquivos/pastas
6. Configure opções pertinentes e clique para executar

---

## Módulos Principais

### Arthdrone (Fluxo S&R e Correções)
- **1 — Organizar Imagens S&R:** Lê o CSV da plataforma e organiza as fotos em `OUTPUT/Blade/Region`.
- **10 — Gerar CSV S&R via JSON:** Lê o JSON do drone e gera um CSV pronto pro Módulo 1, pulando o Image Uploader.
- **2 — Processar JSON do Drone:** Lê o JSON do drone e gera CSVs padronizados pro Image Uploader.
- **3 — Organizar Fotos via JSON:** Cria as pastas A/B/C e move as fotos brutas pro lugar exato baseado no mapa do JSON do drone.
- **11 — Recriar CSV via GPS:** Reconstrói o CSV do Módulo 1 direto da pasta de fotos, suportando até três pás simultaneamente — define os lados manualmente quando o JSON está corrompido ou indisponível.
- **6 — Dividir Voo (Blade Split):** Procura quebras de tempo longas (drone pousou/trocou bateria) e permite realocar a metade pra um novo Serial Number.
- **7 — Restaurar Alturas (Z=0):** Lê um CSV da plataforma com erros esporádicos de Location=0 e recalcula só as fotos afetadas usando o GPS.
- **8 — Recuperar Fotos Perdidas:** Escaneia o SD Card atrás de pulos de numeração sequencial e reconstrói os dados perdidos usando as fotos limítrofes como âncora via GPS real.

### Arthbot (Inspeções Internas Arthnex)
- **12 — Gerar CSV Arthnex (Upload Interno):** Gera o CSV no formato da plataforma pra inspeções internas — Turbine e Blade SN detectados pelo nome dos arquivos; aceita pasta de uma pá ou do aerogerador inteiro (1 CSV por pá automaticamente).
- **13 — Padronizar GoPro para Arthnex:** Lê o padrão `{parque}--{blade}--{região}_{location}_...` do nome do arquivo e renomeia pro formato da plataforma.
- **15 — Calibrar Z GoPro RAW:** Avança o Z em 500mm por posição, suporta fotos pareadas (0°/45°) até um limite, e gera as fotos renomeadas no padrão Arthnex prontas pra upload.

### Ferramentas
- **19 — Arthnex Uploader:** Sobe fotos pro Arthnex via CSV + URLs pré-assinadas (mesma API do Image Uploader oficial), corrigindo o nome enviado ao servidor quando o caminho da foto tem subpastas.
- **4 — Converter Delimitador de CSV:** Ajusta o separador (`;` → `,`) pra manter o arquivo compatível com o Excel.
- **5 — Gerar Relatório de Altitudes:** Lê o EXIF das fotos brutas e gera a tabela milimétrica usando a raiz como Marco Zero.
- **14 — Vincular Fotos a CSV:** Cruza fotos renomeadas pela plataforma com o CSV original, recriando as fotos originais prontas pro Módulo 1.
- **17 — Auditar Planilha Smartsheet:** Audita a planilha do Smartsheet, cruza campanhas e acha escapes/recoletas de inspeção de pás.
- **20 — Substituir Vídeos Insta360:** Varre a pasta de destino em busca de vídeos e os substitui pelos correspondentes (mesmo nome) exportados do Insta360 Studio.
- **21 — Enviar Vídeos Arthfilm para o Drive:** Varre a pasta local da turbina e envia os vídeos de `360 watermark` pra subpasta `FINAL` equivalente no Google Drive.

### Plataforma do Cliente (Horizon & SNOW)
- **16 — Horizon Processor:** Valida nomenclatura, verifica requisitos e gera o pacote ZIP pra submissão na plataforma Horizon.
- **23 — SNOW Processor:** Converte planilhas de inspeção interna/externa pro formato padrão do ServiceNow, baixa as fotos e desenha os polígonos de dano.
- **24 — Automação SNOW (Damage Entry):** Preenche automaticamente o formulário "Create Damage Report Entry" no ServiceNow a partir da planilha gerada pelo Módulo 23 — auditoria ao vivo pra nunca duplicar entrada, categorias independentes (Defeitos/Blanks/Vídeos), retentativa automática, fila overnight de múltiplas turbinas e Modo Auditoria (dry run). Documentação completa em [`docs/snow-automation.md`](docs/snow-automation.md); existe também uma versão standalone (CLI, sem Electron) pro time de dev.

### Suporte
- **9 — Documentação:** Guias interativos de como operar cada módulo sem erros.

---

## Limitações e Red Flags

- **GPS:** depende do EXIF das fotos DJI — neblina ou falha do drone pode zerar a altitude
- **Match de nomes:** case-insensitive, mas extensões diferentes (ex: `.jpg` vs `.JPG`) podem causar falhas em alguns sistemas — verifique antes
- **mm/px:** não calculado automaticamente — valor vem do JSON ou do CSV exportado da plataforma
- **Automação SNOW (Módulo 24):** depende do DOM atual do ServiceNow — mudanças na plataforma do cliente podem quebrar seletores; sessão de login fica salva num perfil de navegador Chromium persistente local (`%APPDATA%/ArthwindSuite/snow_browser_profile`)
- **Sharp (processamento de imagem):** binário nativo — instalação/build precisa ser feita na mesma plataforma/arquitetura de destino

---

Ver [`docs/snow-automation.md`](docs/snow-automation.md) pro histórico detalhado de bugs e decisões de design do módulo SNOW.

---

Desenvolvido por Pedro Oliveira ([@aarchnemesis](https://github.com/aarchnemesis))
Última atualização: Agosto 2026

### ⚠️ Windows — Erro ao abrir em ambientes corporativos

Se ao executar o instalador aparecer aviso do SmartScreen ou erro de runtime, o Windows pode ter bloqueado os arquivos por segurança. Desbloqueie manualmente via PowerShell na pasta do instalador:

```powershell
Get-ChildItem -Recurse | Unblock-File
```

## Recommended IDE Setup

- [VSCode](https://code.visualstudio.com/) + [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) + [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)

## Project Setup (desenvolvimento)

### Install

```bash
$ npm install
```

### Development

```bash
$ npm run dev
```

### Build

```bash
# For windows
$ npm run build:win

# For macOS
$ npm run build:mac

# For Linux
$ npm run build:linux
```
