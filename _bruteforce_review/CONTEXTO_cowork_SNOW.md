# Contexto — Trabalho no módulo SNOW Processor (Arthwind Suite)

## 1. Resumo — Correção do posicionamento de polígonos

**Problema:** os polígonos desenhados sobre as fotos dos defeitos (a partir da coluna
`Polygon Data/Coordinates` do export Arthnex) apareciam fora do lugar ou com tamanho
errado em boa parte dos casos, inclusive em fotos "flat" (GoPro). Isso está diretamente
ligado à reclamação formal do cliente (Nordex) sobre a qualidade dos relatórios SNOW
("Findings are not highlighted are marked in the image").

**Causa raiz:** a coordenada bruta do Excel nunca é um pixel direto da foto final — é
sempre uma coordenada **equirretangular**, a mesma lógica de câmera virtual que o
Arthnex usa internamente (`resolveCamera`/`toCameraRay`/`clipToFrame`), com uma
resolução de origem fixa de **3840×1920 (4K, 2:1)**. Existem duas fontes de foto
diferentes que precisam de tratamento diferente:

| Faixa (Location no Excel) | Origem da foto | Coordenada do Excel |
|---|---|---|
| < 11 m (perto da raiz) | GoPro separada — o robô não alcança essa faixa | Pixel nativo 1:1 |
| ≥ 11 m | Recorte pinhole do robô 360 | Equirretangular bruta, fonte 3840×1920 |

**Como chegamos lá:** testamos primeiro uma heurística por tamanho de bounding box
(errada — o tamanho do polígono reflete o tamanho do defeito, não o espaço de
coordenadas), depois "sempre nativo 1:1" (também errado, validação visual enganosa pela
textura repetitiva da pá). A virada foi construir um pipeline que extrai
automaticamente, do próprio relatório em PDF do Arthnex, a imagem **já marcada
corretamente**, detecta a posição do contorno por cor, e cruza com a coordenada crua —
gerando **85 pontos de calibração reais** (3 turbinas: VSR05-06, VSR07-04, VSR22-02).
Com esse dataset, ajustamos os parâmetros da projeção de câmera até achar
`srcWidth=3840, srcHeight=1920` como a configuração que bate (erro mediano ~25px num
frame de 5568px, ~0,5%) — e o corte de 11m entre os dois tipos de foto.

**Status:** corrigido e validado. Resumo técnico com o código da fórmula já foi
separado pra passar pro dev original da função (`equirect-pinhole.ts`), com duas
perguntas em aberto pro time do Arthnex (por que a fonte é sempre 3840×1920, e se o
corte de 11m é documentado do lado deles ou variável por modelo de pá/turbina).

## 2. Linha do tempo — todas as ações no módulo SNOW

1. **Migração de performance:** Jimp → sharp no processamento de imagem (decode/encode
   nativo em vez de JS puro), paralelização do Stage 2 (marcação de fotos) com pool de
   workers — antes rodava sequencial, um núcleo só.
2. **Fix do sinal na projeção 360:** correção de `phi`/`centerPitch` invertidos na
   fórmula de câmera equirretangular (fluxo de panorama puro).
3. **Remoção da heurística antiga (Casos 1/2/3):** substituída pela projeção de câmera
   calibrada (ver seção 1).
4. **Descoberta e correção do corte de 11m** (GoPro da raiz vs. câmera 360 do robô).
5. **Set Number automatizado:** antes o campo saía sempre como `Set N/A` na Damage
   Description. Agora consulta uma tabela local (`blade_sets.json`, seedada a partir da
   lista LDV de 208 pás, guardada em `%APPDATA%\ArthwindSuite\`) e resolve o Set real
   pelo Blade SN (casando pelos 4 dígitos do meio do serial completo — confirmado que
   Set = 4 últimos dígitos do serial).
6. **Arredondamento de DF pra 1 casa decimal:** SNOW rejeitava valores com mais casas
   (ex.: `54.135`). `DF distance - Start/End` agora sempre sai com 1 dígito após o
   ponto, e vírgula decimal é normalizada pra ponto na leitura do Excel de origem.
7. **Limpeza da UI do SNOW Processor:** removida a "info box" descritiva e o bloco
   "Regras de Automação" (conteúdo gerado por outra IA, sem função real) — ficaram só
   os campos de input (planilha, pasta de destino) e o botão de executar.
8. **Checagem cruzada com o procedimento oficial** (`ATW-QC-153_Procedimento de
   cadastro para Plataforma SNOW`): confirmado que toda a parte de *conversão de dados*
   (Failure Type De/Para, Section/Profile Depth/Blade area, filtro de severidade 0,
   nomenclatura de fotos, 5 registros "Blank Image", Set Number) já está coberta pelo
   SNOW Tool e bate com o procedimento.

## 3. O que ainda é manual (gaps identificados, fora do escopo atual)

1. **Vídeos 360°** — baixar do drive, renomear (`B(SN)_S1_PS_DF<início>_DF<fim>.mp4`,
   4 por pá) e cadastrar na plataforma. Nomenclatura muito parecida com a das fotos —
   automatizável com pouco esforço se for prioridade.
2. **Daily Activity Report (DAR)** — planilha operacional baixada da própria
   plataforma SNOW, preenchida com dados que hoje vêm do Arthnex (tela Operations).
   Zero automação hoje.
3. **Cadastro em si na plataforma SNOW** — formulário de inspeção, Damage Report Entry
   por defeito, Set Optional Fields, anexar foto/vídeo. É 100% manual hoje (sem API/
   importação em lote conhecida do lado do SNOW) — candidato a automação via RPA de
   navegador, ainda não iniciado.
4. **Conferência com o Smartsheet "NAWP - Controle Upload API SNOW"** — hoje é
   comparação visual manual; daria pra automatizar com acesso programático ao
   Smartsheet (o app já tem um token de API do Smartsheet configurado, usado hoje só
   no módulo de Auditoria de Workflow).

## 4. Contexto adicional (cliente)

O cliente (Nordex, contato Subramanian Maharajan) apontou formalmente, em dois INCs
(3034375 e 3034368), os seguintes desvios recorrentes: DF fora da instrução, descrição
de dano incorreta, achados não marcados na imagem (resolvido — seção 1), poucas fotos
por achado (pedem mínimo de 3, hoje geramos 2), imagens não comprimidas, DAMs faltando/
duplicados, e número de série de pá incompleto (deveria ser os 13 dígitos completos).
Rodolfo (diretor) já perguntou ao cliente se as 7 turbinas enviadas antes desse
feedback precisam ser reenviadas — ainda sem resposta confirmada na thread.
