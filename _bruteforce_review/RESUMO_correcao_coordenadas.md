# Correção do posicionamento de polígonos — SNOW Processor (Arthwind Suite)

## Problema

Os polígonos desenhados sobre as fotos (a partir da coluna `Polygon Data/Coordinates` do
export Arthnex) apareciam fora do lugar e/ou com tamanho errado em boa parte dos defeitos
— mesmo em fotos "flat" (GoPro), que aparentam não ter nada a ver com projeção de câmera
360.

## Causa raiz

A coordenada bruta do Excel **não é** um pixel direto da foto baixada (5568×4176). Ela é
sempre uma coordenada **equirretangular** — a mesma lógica de câmera virtual que o Arthnex
usa internamente (`resolveCamera` / `toCameraRay` / `clipToFrame`, arquivo
`equirect-pinhole.ts` que vocês já usam) — só que aplicada com uma resolução de origem
fixa de **3840×1920 (4K, 2:1)**, independente da foto final ser um recorte pinhole
(fotos "360", Location ≥ 11m) ou uma foto de fato flat tirada por GoPro à parte perto da
raiz (Location < 11m).

Ou seja: existem **duas fontes de foto diferentes** nesse fluxo:

| Faixa (Location no Excel) | Origem da foto | Coordenada do Excel |
|---|---|---|
| < 11 m | GoPro separada (robô não alcança a raiz) | Pixel nativo 1:1 da própria foto |
| ≥ 11 m | Recorte pinhole gerado pelo Arthnex a partir da câmera 360 do robô | Equirretangular bruta, fonte 3840×1920 |

Confirmamos essa separação (com um corte limpo, sem nenhum ponto de dado entre 10,4 m e
30,5 m) calibrando contra **85 defeitos reais de 3 turbinas diferentes**, extraindo
automaticamente a posição real do polígono a partir da própria imagem marcada que o
Arthnex embute no relatório em PDF (cor do contorno varia por severidade — verde
`#0FB55A` = sev. 1, dourado `#FFC000` = sev. 2, laranja `#CC6600` = sev. 3), e comparando
contra a coordenada crua do Excel.

## Solução aplicada

Reaproveitamos a **mesma função** que vocês já usam pra fotos 360
(`equirectPolygonToPinhole`, em `polygonUtils.ts` — porte 1:1 de `equirect-pinhole.ts`),
só que agora ela também é usada no fluxo "flat", com resolução de origem fixa:

```ts
const SRC_W = 3840
const SRC_H = 1920

if (locationM < 11) {
  // GoPro da raiz — coordenada já é pixel nativo, só escala pra foto real
  pixelPoints = points.map(p => ({
    x: p.x * (width / 5568),
    y: Math.abs(p.y) * (height / 4176),
  }))
} else {
  // Recorte pinhole do robô 360 — projeta a coordenada equirretangular bruta
  const equirectPoints = points.map(p => ({ x: p.x, y: Math.abs(p.y) }))
  const projected = equirectPolygonToPinhole(equirectPoints, SRC_W, SRC_H)
  pixelPoints = projected.map(p => ({
    x: p.x * (width / 5568),
    y: p.y * (height / 4176),
  }))
}
```

`equirectPolygonToPinhole` sempre projeta pro espaço 5568×4176; escalamos pro tamanho
real da foto baixada só por segurança (quase sempre já é exatamente 5568×4176).

## Validação

- 85 pontos de calibração (VSR05-06, VSR07-04, VSR22-02), extraídos automaticamente do
  PDF do relatório.
- Busca de parâmetro (`srcWidth`/`srcHeight`) por grid search, minimizando o erro entre
  o centro do polígono projetado e o centro medido na imagem de referência.
- Melhor resultado: `srcWidth=3840, srcHeight=1920` → erro mediano de **~25px num frame
  de 5568px (~0,5%)**.
- Conferido visualmente em vários casos (incluindo os que geraram o desvio reportado no
  INC do cliente) — polígono bate exatamente com a posição mostrada no Arthnex.

## Observação / dúvida em aberto pro time do Arthnex

Não sabemos ao certo **por que** a coordenada equirretangular usa uma fonte fixa de
3840×1920 mesmo quando a foto final não é um panorama — se é porque a câmera de captura
sempre grava nessa resolução internamente (independente do recorte final exibido), ou se
é uma constante fixa do pipeline de vocês. Também não confirmamos se esse "corte" de 11m
entre GoPro-da-raiz e câmera-360-do-robô é um valor fixo/documentado do lado de vocês, ou
se varia por modelo de pá/turbina — pra nós foi só o que bateu com os dados que tínhamos
na mão. Se puderem confirmar os dois pontos, ajuda a blindar isso pra novos casos que a
gente ainda não viu.
