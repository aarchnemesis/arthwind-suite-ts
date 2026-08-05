# Resumo — Correção do posicionamento de polígonos (SNOW Processor)

## O problema

No módulo SNOW Processor do Arthwind Suite, os polígonos desenhados sobre as fotos dos
defeitos (a partir da coluna `Polygon Data/Coordinates` do export do Arthnex) apareciam
**fora do lugar ou com tamanho errado** em boa parte dos casos — inclusive em fotos
"flat" (GoPro), que a princípio pareciam não ter nada a ver com projeção de câmera 360.
Isso está diretamente ligado à reclamação formal que o cliente (Nordex) mandou sobre a
qualidade dos relatórios SNOW ("Findings are not highlighted are marked in the image").

## O que foi investigado (em ordem)

1. **Heurística antiga por tamanho de caixa (Casos 1/2/3):** o código original tentava
   adivinhar, pelo tamanho do polígono, se a coordenada vinha de um canvas de preview
   pequeno ou já era pixel nativo — e aplicava uma correção de escala/deslocamento
   condicional. Provamos que essa heurística está errada por construção: o tamanho do
   polígono reflete o **tamanho do defeito**, não o espaço de coordenadas de origem.

2. **Fix do fluxo 360 (fotos panorâmicas de verdade):** corrigimos um erro de sinal na
   fórmula de projeção de câmera (`phi`/`centerPitch` invertidos em relação à referência
   original do Arthnex) e migramos o processamento de imagem de Jimp pra sharp
   (performance).

3. **"Sempre nativo 1:1":** tentamos assumir que a coordenada do Excel já era pixel
   direto da foto — bateu em alguns testes manuais, mas quebrou outros (confirmamos por
   engano visual: a textura repetitiva da pá nos fez validar posições erradas como
   certas).

4. **Calibração em escala, com dado real:** em vez de continuar validando caso a caso,
   escrevemos um pipeline que extrai automaticamente a imagem **já marcada
   corretamente** que o próprio Arthnex embute no relatório em PDF, detecta a posição do
   contorno por cor (varia por severidade), e cruza com a coordenada crua do Excel —
   gerando um dataset de calibração de **85 defeitos reais**, em 3 turbinas diferentes
   (VSR05-06, VSR07-04, VSR22-02).

## Causa raiz confirmada

A coordenada bruta do Excel **nunca é** um pixel direto da foto final. Ela é sempre uma
coordenada **equirretangular** — a mesma lógica de câmera virtual que o Arthnex usa
internamente (`resolveCamera`/`toCameraRay`/`clipToFrame`) — só que com uma resolução de
origem fixa de **3840×1920 (4K, 2:1)**.

Só que existem **duas fontes de foto diferentes** nesse fluxo, que precisam de
tratamento diferente:

| Faixa (Location no Excel) | Origem da foto | Coordenada do Excel |
|---|---|---|
| < 11 m (perto da raiz) | GoPro separada — o robô não alcança essa faixa | Pixel nativo 1:1 da própria foto |
| ≥ 11 m | Recorte pinhole gerado pelo Arthnex a partir da câmera 360 do robô | Equirretangular bruta, fonte 3840×1920 |

Achamos esse corte de 11m cruzando a distância de cada defeito com o resultado da
calibração — o ajuste ficou perfeito de um lado e de outro, com um vazio real nos dados
entre 10,4m e 30,5m (nenhum ponto ambíguo na fronteira).

## Solução aplicada

Reaproveitamos a mesma função de projeção que já existia pro fluxo 360 puro
(`equirectPolygonToPinhole`), agora também usada no fluxo "flat", escolhendo o caminho
certo pela distância do defeito (`Location(m)` < 11 → nativo; ≥ 11 → projeção
equirretangular com fonte 3840×1920).

## Validação

- 85 pontos de calibração, extraídos automaticamente de 3 relatórios em PDF reais.
- Erro mediano de ~25px num frame de 5568px (~0,5%) — praticamente pixel-perfeito.
- Conferido visualmente em vários casos, incluindo os que geraram a reclamação do
  cliente — bate exatamente com a posição mostrada no Arthnex.

## Status atual

Correção aplicada e testada. Um resumo técnico mais detalhado (com o código da fórmula)
já foi separado pra passar pro dev original da função equirect-pinhole, com duas
perguntas em aberto pro time do Arthnex: (1) por que a fonte equirretangular é sempre
3840×1920 mesmo quando a foto final não é um panorama, e (2) se o corte de 11m entre
GoPro-da-raiz e câmera-360-do-robô é um valor fixo/documentado do lado deles, ou varia
por modelo de pá/turbina.
