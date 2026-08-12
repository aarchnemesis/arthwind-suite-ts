# Automação do Damage Report Entry (SNOW)

Módulo 24, `SnowAutomationModule.jsx` + `src/main/services/snowAutomation.ts`.

## O que faz

Lê a planilha já gerada pelo SNOW Processor (módulo 23, mesmo layout de
`OUTPUT_HEADERS` de `snowProcessor.ts`) e preenche automaticamente o
formulário "Create Damage Report Entry" na plataforma SNOW, linha por linha,
via navegador controlado (Playwright/Chromium).

## Sessão de login

Usa um perfil de navegador **persistente** (`launchPersistentContext`),
salvo em `%APPDATA%/ArthwindSuite/snow_browser_profile`. Login feito
manualmente uma vez (botão "Abrir p/ Login") continua valendo nas próximas
execuções — só precisa logar de novo quando a sessão expirar de verdade do
lado do ServiceNow, não a cada abertura do app.

## Widget dos campos — NÃO é `<select>` nativo

Confirmado via prints reais do formulário: os campos ("Blade serial number",
"Sub Component", "Failure Type", e a cascata Inside/Outside → Blade section
→ Blade sub-section → Blade area) são um combobox custom do ServiceNow:

1. Clica no campo pra abrir.
2. Aparece uma caixa de busca + lista de opções (com "-- None --" como
   primeiro item).
3. Digita pra filtrar (essencial em listas longas, tipo "Sub Component" com
   dezenas de itens "Accessoires - ...").
4. Clica na opção exata da lista.

`DamageEntryFiller.selectFromComboBox` (`snowAutomation.ts`) implementa esse
padrão via `getByLabel` (abrir o campo) + `getByRole('textbox').last()`
(caixa de busca, se aparecer) + `getByRole('option', { name, exact: true })`
(clicar na opção). **Ainda não testado contra o DOM real** — se
`getByRole('option', ...)` não achar nada, o widget provavelmente não expõe
role ARIA; troca por `page.locator('li', { hasText: optionText })` ou
`page.getByText(optionText, { exact: true })` como fallback. Rodar
`npx playwright codegen <url>` clicando manualmente nos campos é o jeito
mais rápido de confirmar/ajustar.

## Blade serial number — usar o serial completo

O combobox mostra o serial completo de 13 dígitos (ex.: `A1 811 0410 0115`),
não o Blade SN curto (`410`) usado internamente. `readDamageRows` já lê a
coluna A da planilha de saída do SNOW Processor, que já grava o
`fullBladeSerial` (via `getBladeInfo(bladeSn).serial`, `bladeSets.ts`) — não
precisa converter de novo aqui, só confirmar que a planilha usada tem esse
campo preenchido (depende do `blade_sets.json` ter a pá cadastrada).

## Cascata (Inside/Outside → Blade section → Blade sub-section → Blade area)

Cada campo só popula de verdade depois do anterior ser escolhido (visto nos
prints: aparecem como "-- None --"/"--None--" até o pai ser preenchido).
Parece ser filtragem client-side (rápida, sem round-trip de rede visível),
mas o código ainda espera o campo ficar visível/clicável antes de interagir
(sem `waitForTimeout` fixo).

## Fotos — nomenclatura sequencial obrigatória

O formulário avisa explicitamente: *"In case of a picture sequence, please
use numbers at attachment name begin (e.g.: 01_[Picture Name].jpg,
02_[Picture Name].jpg, etc.)"*. `uploadPhotos` já baixa e nomeia os arquivos
temporários como `01_...`, `02_...` etc. antes do upload — bate com a
exigência do cliente de múltiplas fotos por achado.

## Resiliência e Seletores com Fallback

- **Dropdowns Customizados (Combobox)**: `DamageEntryFiller.selectFromComboBox` agora conta com seletores em cascata de fallback:
  1. `getByRole('option', { name: optionText, exact: true })`
  2. `getByRole('option', { name: optionText })`
  3. `locator('li', { hasText: optionText })`
  4. `locator('div', { hasText: optionText })`
  5. `getByText(optionText, { exact: true })`
- **Navegação "Add Damage Entry"**: Localiza de forma resiliente usando seletores para botões, links ou elementos de texto (`/add damage entry|nova entrada|criar dano/i`).
- **Pós-Save**: Aguarda estado `networkidle` e confirmação antes de seguir para a próxima linha do lote.
- **Isolamento de Erros**: Cada linha do Excel roda em bloco isolado de `try/catch` — se um defeito falhar, o erro é registrado no log e o script segue para o próximo defeito sem parar o lote.
- **Faixa de Linhas**: É possível delimitar o intervalo de linhas a processar na UI (ex.: linhas 5 a 12) para retomar automações pausadas ou reprocessar falhas.

## Status da Implementação (v1.5.4)

- ✅ Módulo 24 (`SnowAutomationModule.jsx`) integrado na UI e registrado no `ModuleForm.jsx`.
- ✅ Backend em Playwright (`snowAutomation.ts`) com suporte a navegador persistente (`%APPDATA%/ArthwindSuite/snow_browser_profile`).
- ✅ Handlers IPC registrados em `src/main/index.ts` e expostos via `src/preload/index.ts`.
- ✅ Typecheck `node` e `web` passando com 0 erros.
