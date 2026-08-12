# Profile Depth (%) a partir da coordenada do polígono

Branch: `feature/pd-from-coordinate`

## Contexto

Hoje o SNOW Processor calcula o Profile Depth (PD) com um valor fixo por
região (`SnowMappings.getProfile`, `snowProcessor.ts:90-96`):

```ts
if (s === 'LE') return 0
if (s === 'CE') return 50
if (s === 'TE') return 100
```

Start e End sempre saem com o mesmo valor (`snowProcessor.ts:704-705`). O
cliente passou uma especificação própria (imagem "profile depth% by section")
com faixas de PD% por posição estrutural — bem mais granular que 0/50/100:

| Finding | Section | Position | PD Start % | PD End % |
|---|---|---|---|---|
| 1 | Section 1 | PS, LE core panel edge | 0% | 5% |
| 2 | Section 1 | PS, core panel transition to MG | 10% | 15% |
| 3 | Section 1 | SS, core panel transition to MG | 10% | 15% |
| 4 | Section 2 | PS, core panel transition to TEG | 55% | 60% |
| 5 | Section 2 | SS, core panel transition to MG | 40% | 45% |
| 6 | Section 2 | SS, core panel transition to TEG | 55% | 60% |
| 7 | Section 1 and 2 | MSW | 30% | 30% |

(MG = Main Girder, TEG = TE Girder, MSW = Main Shear Web, TSW = TE Shear Web
— nomenclatura interna do cliente, indica quando muda o material de núcleo
da casca: espuma PET → madeira balsa.)

## Ideia

A coordenada bruta do polígono (`Polygon Data/Coordinates` do Excel) já vive
no mesmo espaço equirretangular usado pra corrigir a posição dos polígonos
nas fotos (fonte fixa 3840×1920, validada com 85 pontos de calibração — ver
`RESUMO_correcao_coordenadas.md`). Dá pra extrair um ângulo (yaw) direto do
`x` do centro do polígono:

```ts
theta = ((x / 3840) * 2 - 1) * 180   // graus, -180..180
```

Esse ângulo, cruzado com Section (LE/CE) + Side (SS/PS), permite inferir em
qual zona da tabela do cliente o defeito cai — em vez do valor fixo por
região.

**Limitação confirmada**: `x=0`/`x=3840` é a borda da bolha (emenda das duas
lentes fisheye), `x=1920` (yaw=0) é a coluna central. Ainda não confirmamos
se yaw=0 coincide com algum marco físico da pá (ex.: a marcação 0° física) —
não impede o uso pra esse propósito (só precisamos do ângulo RELATIVO entre
defeitos, não de um zero absoluto com significado físico).

**Restrição importante**: Location(m) < 11 → foto GoPro fixa da raiz, a
coordenada é pixel nativo, **não** equirretangular — o ângulo não pode ser
calculado nesses casos. Cai no valor fixo antigo por região.

## Calibração — pontos de referência reais

Extraídos de `ATW-2024-0063-2-NAWP-LAGOA DOS VENTOS-VSR05-06.xlsx` (aba
Report), cruzados com PD confirmado pelo cliente/submissão SNOW aprovada:

| Blade | Loc(m) | Section | Side | Componente | PD (cliente) | Centro X | θ (graus) | Utilizável? |
|---|---|---|---|---|---|---|---|---|
| 377 | 9.5 | LE (S1) | LE→SS* | SHELL | 0 | — | — | ❌ GoPro (<11m), coordenada não-equirect |
| 377 | 36.3 | LE (S1) | SS | SHELL | 10 | 3039 | **~104.9°** | ✅ |
| 404 | 31.1 | LE (S1) | SS | SHELL | 10 | 3007.25 | **~101.9°** | ✅ |
| 408 | 54.3 | LE (S1) | SS | SHELL | 10 | 3420.75 | **~140.7°** | ✅ |
| 377 | 10.4 | CE (S2) | N/A→SS* | TE WEB (TSW) | 55 | — | — | ❌ GoPro (<11m) |
| 377 | 41.6 | CE (S2) | SS | SHELL | 55 | 2362.75 | **~41.5°** | ✅ |
| 408 | 53.2 | CE (S2) | PS | SHELL | 55 | 2767 | **~79.4°** | ✅ |

\* `getBladeArea` já usa esse default: qualquer `side` que não seja
explicitamente `PS` cai em `SS`.

**Achado importante (SS vs PS)**: os dois pontos PD=55 (θ≈41.5° e θ≈79.4°) são
bem diferentes entre si — mas um é SS e o outro é PS. SS e PS ficam em lados
opostos do perfil, então **a conversão ângulo→PD precisa ser separada por
Side** (uma curva pra SS, outra pra PS), nunca uma única função contínua.

**Falso alarme investigado e descartado (LE/S1 SS)**: em determinado ponto,
um dos 3 pontos de referência SS em Section 1 (blade 404, Loc 31.1) foi
associado por engano a PD 40 e a Section 2 — o que, combinado aos outros 2
pontos SS/Section1 (PD10 em ângulos bem diferentes, 104.9° e 140.7°),
sugeria uma inconsistência grave (chegou a se cogitar hipótese de torção
aerodinâmica da pá mudando a relação ângulo↔PD ao longo do DF). Corrigido:
o blade 404/Loc31.1 é Section 1, e o PD correto é 10 — os 3 pontos SS/S1
concordam perfeitamente (PD10, independente do ângulo dentro da faixa
101.9°-140.7°), confirmando o modelo original: Section 1/SS realmente só
tem 1 zona possível, sem depender de ângulo.

**Pestana do LE (contexto físico, ainda sem uso direto no código)**: a
"pestana" é a costura de colagem do bordo de ataque na fábrica — fica
dobrada pra dentro da pá e passa a fazer parte da casca SS. Por isso,
qualquer defeito com `Side=LE` no Excel (ao invés de SS/PS explícito) cai
fisicamente em território SS (~PD10) — já é o comportamento do código hoje
(`isPS` só é `true` quando `Side==='PS'` explicitamente; qualquer outro
valor, incluindo `LE`, cai no bucket SS). Logo depois da pestana, do outro
lado, começa a casca PS — é ali que a zona "PS, LE core panel edge" (0-5%)
da tabela do cliente começa. Section 1/PS continua **sem nenhuma referência
real confirmada** (o ponto PD40 que motivou a investigação da pestana foi,
na verdade, um SS/Section1 mal identificado — ver item acima).

## Cobertura de dados por Section/Side (o que dá e o que não dá pra calibrar)

**Busca por mais referências (outras turbinas) — sem mudança**: procurado
mais amostragem além de VSR05-06 pra tentar fechar Section 1/PS e a zona MG
de Section 2/SS. Não apareceu nada novo: defeitos reais se repetem quase
sempre nos mesmos pontos estruturais (~99% das ocorrências), então a
amostragem não cresce só por olhar mais turbinas — os casos abaixo marcados
como "não resolvido"/"parcialmente resolvido" tendem a **permanecer assim
por bastante tempo**, não é falta de esforço de busca. Se/quando aparecer um
defeito real numa dessas zonas raras, basta adicionar a âncora em
`PD_ANCHORS` — o código já está pronto pra isso.

- **Section 1 (LE) / SS**: só existe 1 zona possível na tabela do cliente
  (`SS, transition to MG`, 10-15%) — não precisa escolher entre zonas. 3
  referências reais independentes confirmam PD10 em ângulos bem diferentes
  (101.9°, 104.9°, 140.7°). **Resolvido**, com boa margem de confiança.
- **Section 1 (LE) / PS**: 2 zonas possíveis (edge 0-5%, →MG 10-15%) — **zero
  referências reais**, e busca adicional em outras turbinas não trouxe
  nenhuma. **Não resolvido, provavelmente por um bom tempo** — mantém o
  valor antigo (região fixa) até aparecer um defeito real nessa zona.
- **Section 2 (CE) / PS**: só existe 1 zona (`transition to TEG`, 55-60%) —
  não precisa escolher. Referência real confirma (~79°, PD55). **Resolvido**:
  todo defeito PS em Section 2 usa PD 55, independente de subcomponente
  (TSW incluso — não tem entrada própria na tabela).
- **Section 2 (CE) / SS**: 2 zonas possíveis (→MG 40-45%, →TEG 55-60%). Só 1
  referência real calibrada (a zona TEG, ~41.5°, PD55) — a zona MG não tem
  âncora angular própria, e busca adicional não trouxe uma. **Parcialmente
  resolvido, estável nesse estado**: sem uma segunda referência real, não dá
  pra escolher por proximidade angular de verdade — usa a única zona
  validada (55) como padrão pra esse lado também, mesmo princípio de
  arredondamento já aceito pra essa região.
- **MSW** (Main Shear Web / componente "MAIN WEB"): fixo em 30%, não importa
  Section nem ângulo (Finding 7 da tabela). **Resolvido**, sem calibração
  necessária.
- **TSW** (TE Shear Web / componente "TE WEB"): sem entrada própria na
  tabela do cliente — usa a mesma zona que o Side normal indicaria (não tem
  regra especial).
- **Section 3 (TE)**: fora de escopo, "não trabalhamos" — mantém o valor
  antigo (100).

## Decisão de precisão

Cliente confirmou que não precisa ser exato, só representar "mais ou menos"
o valor de Depth que eles trabalham — por isso os casos parcialmente
resolvidos acima (Section 1/PS, Section 2/SS-MG) usam a aproximação mais
razoável disponível em vez de bloquear a feature esperando calibração
perfeita. Ficam marcados com TODO no código pra quando surgir mais dado de
referência real.

## Implementação

`SnowMappings.getProfileFromCoordinates(section, side, component,
coordinatesJson, locationM)` — novo método, mantém `getProfile` intacto como
fallback (Location < 11m, polígono inválido, ou Section 3/TE).

Profile Depth Start e End continuam saindo com o mesmo valor (simplificação
já existente antes desta mudança — a tabela do cliente dá faixas Start/End
diferentes por zona, mas abrir isso é escopo futuro, não necessário agora
dado que a precisão não é exigida).
