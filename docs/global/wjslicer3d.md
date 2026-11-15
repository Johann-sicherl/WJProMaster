# WJSlicer3D — orçamento de impressão 3D (tempo e material)

Face do WJProMaster pedida pelo Johann em 08/11/2026: **fatiar objetos STL para impressão 3D** e orçar
**tempo de impressão e material**. **Sem G-code e sem envio para a impressora.**

15/11/2026 (pedido do Johann): **só duas impressoras — Bambu Lab P1S e Anycubic Kobra 3** (bico 0,4 mm,
perfis de fábrica) — e o tempo passa a vir de um **fatiamento real feito com código nosso**, com meta de
**±5 % do fatiador de referência** nas mesmas configurações. O fatiador de referência é de código aberto
com licença AGPL: **nenhuma linha de código dele é copiada e o nome dele nunca aparece**; dele só se
usam os perfis de fábrica (arquivos de dados) como dado técnico de compatibilidade.

Página `slicer/`, código em `src/slicer/`, motor testado em Node (`scripts/teste-slicer.ts`, dentro do
`pnpm teste`) e roteiro no tablet (`scripts/roteiro-slicer.cjs`). Não cria documento próprio: lê STL do
cofre do WJPDM, do aparelho ou a peça aberta no WJCAD.

## 1. Uso

1. **Adicionar STL** (barra de cima ou "+ Peça" no cartão **Peças na mesa**) → "STL do cofre (WJPDM)…" ou
   "STL do aparelho…". Pelo WJCAD: menu da Peça → **Estimar impressão 3D (WJSlicer3D)** (a peça vai em pé:
   o Y do WJCAD vira o Z da impressora).
2. **Peças na mesa**: cada peça com as **cópias** (− n× +) e ✕ para tirar da mesa. A mesa **se organiza
   sozinha** (fileiras, da maior para a menor, 6 mm entre as peças; mais espaço com a borda). Tocar numa
   peça (na lista ou na mesa) a escolhe; **↻ X / ↻ Y / ↻ Z** e **Melhor apoio** agem na peça escolhida.
   Peça que não cabe ou passa da borda fica vermelha, com aviso.
3. **Impressora** (Bambu Lab P1S, Anycubic Kobra 3) e **material** (PLA, PLA alta velocidade, PETG, ABS,
   ASA, TPU) com o **preço por kg** (lembrado por material).
4. **Ajustes**: altura da camada (0,08–0,28 mm), paredes, camadas de topo e fundo, preenchimento (%),
   **padrão do preenchimento** (grade, linhas, linhas cruzadas, triângulos, cúbico, giroide, favo de mel),
   **suporte** (sem, normal, árvore), **borda** (aba de 5 mm) e **saia** (uma volta a 2 mm). "Padrão do
   perfil" volta aos valores de fábrica da impressora.
5. **Resultado** (recalcula sozinho a cada mudança, no worker): tempo de impressão, material (g),
   filamento (m de 1,75 mm), custo, preparo típico e total, camadas, volume das peças e o **tempo por tipo
   de caminho** (parede externa, paredes internas, sólido, topo, pontes, esparso, suporte, interface,
   borda e saia, deslocamentos/retrações/trocas de camada, desaceleração para resfriar), com o material
   de cada um.
6. **Prévia das camadas** (botão sobre a vista, depois de fatiar): deslizante (e − / +) escolhe a camada;
   os caminhos dela aparecem coloridos por tipo (legenda) e as peças, cortadas na altura da camada.
7. **Calibrar tempo…**: informa-se uma vez o tempo real (ou o do fatiador) de uma mesa; o fator fica
   guardado para aquela impressora e corrige todas as estimativas dela.

Preferências (impressora, material, preços, ajustes, calibração) ficam no aparelho
(`localStorage["wjslicer:preferencias"]`); impressora antiga que saiu da lista volta à P1S.

## 2. Como o fatiamento é feito (código próprio)

**Corte** (`caminhos.ts`, `fatiarMalha`): cada camada é cortada no plano do meio; os segmentos viram um
mapa dentro/fora numa **grade da peça** (célula ≥ 0,15 mm, até 200 mil células; mapas de todas as
camadas guardados em bits).

**Geometria da camada** (`campo.ts`): a seção vira um **campo de distância com sinal** (positivo dentro;
distância exata junto ao contorno e propagada em duas varreduras). Assim, sem operações booleanas de
polígonos (frágeis em malhas reais):
- **paredes** = curvas de nível do campo (marcha dos quadrados), já em laços com externo e furos;
  parede externa a ½ espaçamento da borda, internas a cada espaçamento; seção fina fica com menos paredes;
- **borda** = curvas de nível para fora (só os contornos externos);
- **preenchimento** = linhas e curvas do padrão **recortadas** pela região (campo ≥ fim das paredes −
  sobreposição de 15 %) e pela classe de cada célula;
- **ilhas** da camada (componentes ligados) para a ordem de impressão.

**Classes por célula** (pelas camadas vizinhas, em palavras de 32 bits): **ponte** (sem nada embaixo),
**topo** (sem nada em cima), **sólido** (falta material em alguma das N camadas de topo/fundo; espessura
mínima do perfil), **esparso**; área de esparso menor que 15 mm² vira sólido; primeira camada toda sólida.

**Padrões**: grade (2 direções, 45°/135°), linhas (uma direção, alterna), linhas cruzadas (blocos de
camadas alternando a direção), triângulos (3 direções), cúbico (3 direções que andam com a altura),
giroide (curva de nível da função do giroide; densidade pela medida do comprimento por área) e favo de mel
(ziguezague de hexágonos). O passo das linhas sai da densidade e do espaçamento.

**Ligação e ordem**: ilha por ilha (a mais perto primeiro): paredes de dentro para fora, depois o
preenchimento; as linhas são ligadas pela ponta mais próxima e, quando a ligação corre junto à parede
(até 20 mm no esparso), viram uma extrusão só (âncora); senão, deslocamento. Laços começam no ponto mais
perto do bico.

**Suporte** (`calcularSuportes`), de cima para baixo: o que a camada tem além da camada de baixo alargada
pelo **ângulo-limite** do perfil precisa de apoio; folga em Z (uma camada) e em XY; **interface** densa nas
camadas logo abaixo do contato (2 na P1S, 3 no Kobra 3). **Normal**: colunas que descem até a mesa ou até a
peça (Kobra 3: **só na mesa**, as colunas que encostam na peça saem inteiras), corpo em linhas no vão do
perfil. **Árvore**: um galho por bloco de 5 mm de contato, que desce engrossando, se aproxima do vizinho e
se junta, desvia da peça (e termina sobre ela se não tiver como desviar); cada galho é impresso como
parede(s) circular(es) (duas acima do diâmetro de parede dupla).

**Tempo** (`planejador.ts`), movimento a movimento, como o firmware:
- trapézio de velocidade com a **aceleração de cada recurso** (parede externa, interna, topo, sólido,
  esparso, ponte, primeira camada, deslocamento), limitada pela máquina;
- **jerk por eixo** nas junções (e por recurso no Kobra 3), passadas para trás e para a frente (frear a
  tempo para o próximo canto), partida e parada na velocidade segura do jerk;
- Kobra 3 (Klipper): "acelerar até desacelerar" de 50 %;
- **vazão volumétrica máxima** do material limita a velocidade de cada caminho;
- **paredes em balanço** desaceleram por faixa (25/50/75/100 % da largura fora da camada de baixo) e
  ponte na velocidade de ponte;
- **deslocamentos** com retração (só acima de 1 mm e fora do preenchimento), limpeza, levantamento do Z
  (Kobra 3 só acima de 0,3 mm) e **troca de camada**;
- **tempo mínimo de camada** do material: a extrusão desacelera até o mínimo do perfil (sem espera parada).
O **preparo** (aquecer, nivelar, purgar) é um valor típico por máquina, mostrado à parte.

**Material**: cada extrusão = comprimento × espaçamento (largura menos o arredondamento do filete) ×
altura × fluxo do recurso (topo, ponte) × fluxo do filamento; massa pela densidade; filamento de 1,75 mm.

**Várias peças** (`fatiar.ts`): cada peça é fatiada uma vez; camada por camada, as cópias são percorridas
na ordem de proximidade do bico (camadas até a peça mais alta). Os caminhos de cada camada ficam no
worker para a prévia.

## 3. Perfis (`src/slicer/perfis.ts`)

Conferidos em 15/11/2026 nos arquivos de dados de fábrica (herança resolvida), processo "0,20 mm padrão":

| | P1S | Kobra 3 |
|---|---|---|
| Paredes / topo / fundo | 2 / 5 (1 mm) / 3 | 2 / 5 (1 mm) / 3 (0,6 mm) |
| Preenchimento | 15 % grade | 15 % linhas cruzadas |
| Velocidades (mm/s) ext/int/esparso/sólido/topo/1ª camada | 200/300/270/250/200/50 (preench. 105) | 130/200/300/130/130/45 |
| Ponte / deslocamento | 50 / 500 | 30 / 350 |
| Acelerações (mm/s²) ext/int/topo/esparso/1ª/desloc. | 5000/10000/2000/10000/500/10000 | 5000/6000/2000/5000/500/15000 |
| Máquina: aceleração, velocidade, jerk | 20000, 500, 9 | 15000, 600, 20 (por recurso 9–15) |
| Retração / Z | 0,8 mm a 30 mm/s, levanta 0,4 | 1 mm a 60 mm/s, levanta 0,4 acima de 0,3 mm |
| Suporte | árvore, 30°, folga 0,2/0,35 | árvore, 40°, folga 0,25/0,25, só na mesa |
| PLA: densidade, fluxo, vazão, camada mínima | 1,26; 0,98; 21 mm³/s; 4 s | 1,24; 0,96; 12 mm³/s; 8 s |

## 4. Validação

- `scripts/teste-slicer.ts` (Node): campo de distância e contornos (quadrado deslocado para dentro e para
  fora, anel com furo, recorte de linha), planejador (trapézio, jerk, tempo mínimo de camada), **cubo de 20
  mm** (100 camadas; 100 % ≈ volume × fluxo; padrão ≈ conta à mão; parede externa = laço × camadas),
  **cilindro Ø20 × 20**, **peça com balanço** (ponte sem suporte; suporte normal com interface e em árvore;
  rampa a 60° sem suporte), os sete padrões (densidade de 20 %), TPU limitado pela vazão, várias peças (4
  cópias = 4 × material, organizar dentro da mesa, avisos de mesa), borda e saia, STL, giro e apoio,
  perfis. Esfera de Ø40 com árvore fatiada em ~2 s no Node.
- **Referências medidas pelo Johann**: tabela `REFERENCIAS` no teste (cubo e cilindro na P1S e no Kobra 3,
  peça com balanço na P1S; PLA, perfil padrão): **pendentes** — quando ele mandar os valores do fatiador de
  referência, o teste passa a exigir ±5 % de tempo e de massa.
- `scripts/roteiro-slicer.cjs` (tablet 1280×800, toque): STL do aparelho, cópias, segunda peça, Kobra 3 com
  árvore e giroide, **tela sem travar** (nenhuma tarefa longa na página acima de 200 ms durante o
  fatiamento), prévia das camadas, alvos ≥ 44 px, calibração, remover peça, preferências lembradas.

**Precisão**: o caminho é gerado de verdade (paredes, linhas, ligações, deslocamentos), então material e
tempo seguem a geometria. Diferenças para o fatiador de referência que ainda podem pesar: emenda e
ordem exata dos caminhos, preenchimento de vãos estreitos, "uma parede só no topo", suporte em árvore
(algoritmo próprio, mais simples) e a borda automática (aqui é liga/desliga). A **calibração** com uma
impressão real deixa o tempo fiel para a impressora do dia a dia.

## 5. Cores: pintura, trocas e projeto (16/11/2026)

Pedido do Johann: pintar a peça com **até 4 cores** (P1S e Kobra 3, um sistema de 4 filamentos cada) e
somar o custo das trocas ao material e ao tempo.

**Pintar** (cartão "Cores e pintura" → **Pintar**; peça escolhida, ou a tocada): **Pincel** (tamanho em mm),
**Balde (face)** (a face plana tocada), **Balde (região)** (tudo o que está ligado e tem a mesma cor),
**Por ângulo** (espalha até uma aresta mais viva que o ângulo escolhido, 2–90°), **Corpo inteiro** (um corpo
de uma peça multicorpo: o do WJCAD ou um STL com vários corpos) e **Borracha** (volta à cor 1). **Caneta
(ou botão esquerdo do mouse) pinta; o dedo gira e aproxima a vista.** **Desfazer** (até 40 passos) e
**Limpar pintura**. Esfera sob a caneta mostra o tamanho do pincel. Peça sem pintura = tudo na cor 1.

**Como a pintura vira camadas** (`cores.ts`): cada célula da seção fica com a cor do trecho pintado mais
perto (paredes cortadas pela camada); faces horizontais pintadas (topo e fundo) valem para as camadas de
topo/fundo no miolo, e as paredes seguem as laterais. Cada caminho é cortado onde a cor muda e a camada é
impressa **cor por cor**: começa pela cor que já está no bico e termina numa cor presente na camada de
cima (o mínimo de trocas: uma por cor além da primeira). Suporte, interface, borda e saia usam a cor que
estiver no bico.

**Custo da troca** (cartão "Custo das trocas de cor", por impressora, editável; "Padrão de fábrica" volta):
- **trocas**: número total, camadas com troca e o máximo por camada;
- **purga** por troca (mm³; de fábrica P1S 280, Kobra 3 250; é do filamento que entra) — **valores típicos
  do sistema de 4 filamentos, a confirmar com uma impressão medida**;
- **tempo da troca** (s; P1S 35, Kobra 3 50) + purga ÷ vazão de purga (9 e 8 mm³/s);
- **torre de purga** (liga/desliga; lado de 35 mm): anel de estabilização em todas as camadas até a última
  com troca (a purga cai dentro dela); aviso se não couber ao lado das peças. Sem torre, a purga continua
  (cai fora da peça).
Tudo entra no tempo (partes "Trocas de cor" e "Torre de purga") e no material de cada cor (g, m e R$).

**Cores e filamentos** (cartão, no projeto): 4 filamentos com **cor, nome, material e R$/kg** (o 1º usa o
material e o preço de "Impressora e material"); a densidade e o preço de cada cor entram no orçamento.
Estrutura pronta para a **biblioteca de custos (S3)**. Fluxo e vazão do bico seguem o material da cor 1.

**Projeto** (`.wjslc`, face `slicer` do cofre, pasta "Impressão 3D"): **Salvar projeto** / **Abrir projeto**
(no topo, e a aba **Cofre** com GO-OUT/GO-IN) guardam as peças (malha na posição de impressão, cópias e a cor de
cada triângulo), filamentos, trocas editadas, impressora, material e ajustes (`projeto.ts`; malha em binário
gzip dentro do JSON). Abrir do WJPDM leva ao WJSlicer3D com o projeto.

**Testes**: `scripts/teste-slicer.ts` (Node): topologia, balde por face/região/ângulo, pincel, borracha, corpo
inteiro; cubo de 20 mm com **2 cores (1 troca)**, **4 cores em faixas (3 trocas)**, **4 cores nas laterais (300
trocas = 3 por camada)**, só o topo e só o fundo, purga/tempo/torre editáveis, Kobra 3, material por cor, duas
peças, projeto salvo e lido. `scripts/roteiro-slicer-cores.cjs` (tablet, caneta simulada pelo CDP): caneta
pinta e dedo não, ferramentas, desfazer, filamentos e trocas editáveis, alvos ≥ 44 px, salvar no cofre e
reabrir. **Pendente**: medir uma impressão multicolorida para ajustar purga/tempo de fábrica; roteiro com a
caneta física do TCL.

## 6. Decisões

- Nome da face: **WJSlicer3D** (pedido do Johann: "WJ Slicer 3D").
- **Só P1S e Kobra 3** (15/11/2026). Nomes das impressoras só na lista de máquinas, como dado técnico; o
  nome do fatiador de referência **nunca** aparece.
- Fatiamento **com código próprio** (15/11/2026): proibido copiar código do fatiador de referência (AGPL).
- Sem G-code e sem envio para a impressora (decisão do Johann, 08/11/2026; reafirmada em 15/11/2026).
- Sem documento próprio: o STL vem do cofre (pasta CAD), do aparelho ou do WJCAD.

## 7. Estado e próximos passos

- S1 (08/11/2026): estimativa por camadas, perfis Bambu Lab e Anycubic. **Substituída** pela S2.
- **S2 (15/11/2026, entregue)**: fatiamento real, P1S e Kobra 3, padrões, suporte normal e árvore, saia,
  várias peças, prévia das camadas, tempo por tipo de caminho.
- **S2.1 (16/11/2026, entregue)**: pintura de até 4 cores, trocas/purga/torre no orçamento, filamentos editáveis e projeto `.wjslc` no cofre.
- Pendente do Johann: valores de referência medidos (tabela do teste) e uma impressão multicolorida medida (purga e tempo da troca).
- Possíveis (só se ele pedir): outros bicos (0,2/0,6/0,8), "uma parede só no topo", preenchimento de vãos,
  borda automática, arrastar a peça na mesa à mão.
