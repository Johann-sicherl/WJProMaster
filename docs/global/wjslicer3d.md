# WJSlicer3D — tempo de impressão e material para impressão 3D

Face do WJProMaster pedida pelo Johann em 08/11/2026: **fatiar objetos STL para impressão 3D**. Por
enquanto **sem G-code e sem envio para a impressora**: só a **estimativa prévia do tempo de impressão e
da quantidade de material**. Base funcional: um fatiador de código aberto de referência, com os perfis
das impressoras **Bambu Lab** e **Anycubic**. Sem configurações avançadas.

Página `slicer/`, código em `src/slicer/`, motor testado em Node (`scripts/teste-slicer.ts`, dentro do
`pnpm teste`). Não cria documento próprio: lê STL do cofre do WJPDM, do aparelho ou a peça aberta no
WJCAD.

## 1. Uso

1. **Abrir STL** → "STL do cofre (WJPDM)…" ou "STL do aparelho…". Pelo WJCAD: menu da Peça →
   **Estimar impressão 3D (WJSlicer3D)** (a peça vai inteira, em pé: o Y do WJCAD vira o Z da impressora).
2. A peça aparece na mesa da impressora (vermelha se não couber). **↻ X / ↻ Y / ↻ Z** giram 90°;
   **Melhor apoio** deita a peça na face plana maior (menos suporte, melhor aderência).
3. **Impressora** (Bambu Lab X1 Carbon, P1S, A1, A1 mini; Anycubic Kobra 2 Neo, Kobra 2 Pro, Kobra 3,
   Kobra 3 V2, Kobra 3 Max, Kobra S1, Kobra S1 Max) e **material** (PLA, PLA alta velocidade, PETG, ABS,
   ASA, TPU, conforme a máquina) com o **preço por kg** (lembrado por material).
4. **Ajustes**: altura da camada (0,08–0,28 mm), paredes, camadas de topo e fundo, preenchimento (%),
   suporte e borda (aba de 5 mm). "Padrão do perfil" volta aos valores de fábrica da impressora.
5. **Resultado** (recalcula sozinho a cada mudança, em segundo plano): tempo de impressão, material
   (g), filamento (m de 1,75 mm), custo, preparo típico e total, camadas, volume da peça e o
   **detalhamento por parte** (paredes, sólido, topo, pontes, esparso, suporte, borda, deslocamentos,
   espera para resfriar), com avisos (não cabe na mesa, malha aberta).
6. **Calibrar tempo…**: informa-se uma vez o tempo real (ou o do fatiador) de uma peça; o fator fica
   guardado para aquela impressora e passa a corrigir todas as estimativas dela.

Preferências (impressora, material, preços, ajustes, calibração) ficam no aparelho
(`localStorage["wjslicer:preferencias"]`).

## 2. Como a estimativa é feita (`src/slicer/fatiar.ts`)

Camada por camada, no plano do meio da camada (primeira camada com a altura do perfil):

1. **Corte da malha**: cada triângulo que cruza o plano dá um segmento; os segmentos se encadeiam pela
   aresta da malha em comum (laços = contornos e furos, com perímetro, área com sinal e ângulo de cada
   canto). O sentido de cada laço é decidido pela maioria das normais (triângulos-agulha não quebram o
   contorno); triângulos colapsados pela solda dos vértices são ignorados.
2. **Varredura por linhas** (par/ímpar): área exata da seção, comprimento médio das cordas (tamanho das
   linhas de preenchimento) e um **mapa de bits** da camada (grade de ≥ 0,25 mm, até 160 mil células).
3. Com os mapas das camadas vizinhas (operações de bits): **cascas de topo e fundo** (célula sólida se
   faltar material em alguma das N camadas acima/abaixo), **superfície de topo exposta**, **pontes**
   (sólido sem nada embaixo) e **suporte** (o que fica além da camada de baixo alargada pelo ângulo-limite
   do perfil desce até a mesa ou até a peça; corpo com linhas a 2,5 mm e 2 camadas de interface densa).
4. **Material**: paredes = perímetro × voltas × espaçamento; interior = sólido + esparso × densidade;
   volume = área × altura (o espaçamento já desconta o arredondamento do filete:
   `w − h·(1 − π/4)`). Massa = volume × densidade do material; comprimento de filamento de 1,75 mm.
5. **Tempo**, como o planejador do firmware:
   - trapézio de velocidade em cada segmento com a aceleração de cada recurso (parede externa, interna,
     topo, esparso, primeira camada, deslocamento), limitada pela máquina;
   - **velocidade de canto** pelo ângulo da junção (jerk do perfil), com passadas para trás e para a
     frente (linhas curtas não chegam à velocidade);
   - firmware **Klipper** (Anycubic, menos o Kobra 2 Neo): "acelerar até desacelerar" de 50%;
   - **vazão volumétrica máxima** do material limita a velocidade (ex.: TPU 3,2–3,6 mm³/s);
   - **parede externa em balanço** desacelera por faixa (até 25/50/75/100% da largura fora da camada
     de baixo, pela inclinação da face) e as **pontes** vão na velocidade de ponte;
   - **tempo mínimo de camada** do material (desacelera para resfriar, até a velocidade mínima);
   - deslocamentos com retração, levantamento do Z e troca de camada.
   O **preparo** (aquecer, nivelar, purgar) é um valor típico por máquina, mostrado à parte.

## 3. Perfis (`src/slicer/perfis.ts`)

Valores dos perfis de fábrica abertos (JSON) do fatiador de referência, **bico de 0,4 mm e processo
"0,20 mm padrão"** de cada máquina, resolvida a herança dos arquivos: alturas, paredes, cascas
(camadas e espessura mínima), larguras de linha, velocidades, acelerações, velocidades de balanço e
ponte, ângulo do suporte; da máquina: mesa, altura útil, aceleração e velocidade máximas, jerk,
firmware, velocidade do Z, retração e levantamento do Z; dos filamentos de cada máquina: densidade,
vazão volumétrica máxima e tempo mínimo de camada. Só dados técnicos de compatibilidade: nenhum
código, texto ou ícone copiado.

## 4. Validação (08/11/2026)

- `scripts/teste-slicer.ts` (Node): planejador (trapézio, triângulo, laços com cantos), cubo de 20 mm
  (100 camadas; 100% de preenchimento = 8 000 mm³ = volume da peça; padrão = conta à mão de paredes +
  cascas + 15%), tubo com furo, cubo de 60 mm (mais preenchimento = mais tempo e massa), TPU limitado
  pela vazão, tempo mínimo de camada numa peça pequena, ponte com suporte (só o vão recebe suporte),
  borda, aviso de mesa pequena, leitura de STL binário, giro e apoio na mesa.
- Peça de calibração de referência (barco de teste, 225 mil triângulos), perfil padrão, PLA, sem
  suporte: X1 Carbon/P1S **26 min, 12,4 g**; A1/A1 mini 31 min; Kobra 3 33 min, 10,6 g; Kobra 2 Neo
  45 min. Cálculo em ~1 s no computador (worker; a tela não trava).
- Tablet simulado (1280×800, toque, perfil tablet): abrir pelo menu, trocar impressora, suporte,
  paredes, girar, melhor apoio, calibrar, preferências lembradas; WJCAD → WJSlicer3D com a peça em pé.

**Precisão**: a estimativa não gera o caminho real da ferramenta (sem G-code), então fica
aproximada. O material costuma ficar perto do valor do fatiador; o tempo pode variar mais em peças
com muitos detalhes. Para a impressora do dia a dia, a **calibração** com uma impressão real deixa o
tempo fiel.

## 5. Decisões

- Nome da face: **WJSlicer3D** (pedido do Johann: "WJ Slicer 3D").
- Nomes das **impressoras** (marca e modelo) aparecem na lista de máquinas como dado técnico de
  compatibilidade, como os formatos de arquivo; o nome do fatiador de referência **nunca** aparece na
  interface.
- Sem G-code e sem envio para a impressora **por enquanto** (decisão do Johann, 08/11/2026).
- Sem documento próprio: o STL vem do cofre (pasta CAD), do aparelho ou do WJCAD.

## 6. Próximos passos possíveis (só se o Johann pedir)

- S2: várias peças na mesa (placa) e cópias; perfis 0,2/0,6/0,8 mm de bico; padrões de preenchimento
  (giroide, favo) com o tempo próprio de cada um; suporte em árvore.
- S3: G-code e envio para a impressora (rede local), se ele quiser.
