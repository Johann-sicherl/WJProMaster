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

**Paredes da fatia M1 (27/11/2026, `paredes.ts`)** — tudo atrás de parâmetros do processo; **com os padrões o
resultado é idêntico ao de antes** (clássico, sem vãos, todas as paredes no topo, perímetro pequeno desligado):
- **Gerador de paredes**: *clássico* (curvas de nível de largura fixa, acima) ou **largura variável**. Na largura
  variável a espessura local T sai de um raio lançado de cada ponto da parede, na normal, até o outro lado da seção
  (exato, pelos segmentos do corte). Se T cabe menos que todas as paredes dos dois lados, a camada usa o nº de filetes
  cuja soma mais se aproxima de T e divide a sobra pelos filetes de dentro (**paredes na transição**; 1 = só o de
  dentro, as externas ficam com a largura nominal), entre a **largura mínima de parede** (85 % do bico) e ~2× a linha:
  os filetes cobrem a seção inteira, sem vão nem sobreposição. Nº ímpar de filetes = um **filete no meio** (no eixo da
  parte fina, esticado até a ponta); parte mais fina que o **tamanho mínimo de detalhe** (25 % do bico) não é impressa.
  **Ângulo de transição** (10°): lados que abrem mais que isso (cantos) não contam como parte fina; **filtro de
  transição** (1 mm): trecho mais curto que isso não troca o nº de filetes. Extrusão com largura variável = trechos de
  largura constante (pedaço novo quando a largura muda > 0,02 mm): material = largura × altura × comprimento de cada
  trecho, tempo pela velocidade limitada pela vazão volumétrica com a largura dele.
- **Preenchimento de vãos** (liga/desliga + velocidade): fresta no meio das paredes mais estreita que uma linha (e mais
  larga que o detalhe mínimo) vira um filete fino central, tipo de caminho próprio **"Preenchimento de vãos"** (tempo,
  material e cor na prévia); a fresta sai do preenchimento.
- **Só uma parede no topo** (+ limite): nas superfícies de topo (nada na camada de cima) só a parede externa; o topo
  sólido começa logo depois dela. Topo mais estreito que o limite (mm) fica com todas as paredes. **Só uma parede na 1ª
  camada** (opcional).
- **Perímetro pequeno**: laço de parede mais curto que o limite (mm; 0 = desligado) anda na velocidade de perímetro
  pequeno.

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
- `scripts/teste-paredes.ts` (Node, M1): com os padrões, cubo 20 mm, cilindro Ø20×20 e peça com balanço na P1S e no
  Kobra 3 com tempo e massa **idênticos** aos medidos antes da M1; pilha de filetes (soma = espessura, limites de
  largura); **placa de 0,9 mm** (clássico cobre ~82 % da seção; com vãos ou largura variável ~99 %, sem sobreposição;
  material ≈ volume × fluxo), **cunha de 3 → 0,5 mm**, **anel de 0,8 e de 0,5 mm** (filete único fechado no meio),
  caminhos dentro da peça e sem NaN; uma parede no topo (cubo e degrau, limite), uma parede na 1ª camada, perímetro
  pequeno; desempenho (M1 ligada ≈ 1,2× o clássico; esfera Ø40 com árvore em ~3 s).
- **Referências medidas pelo Johann**: tabela `REFERENCIAS` no teste (cubo e cilindro na P1S e no Kobra 3,
  peça com balanço na P1S; PLA, perfil padrão): **pendentes** — quando ele mandar os valores do fatiador de
  referência, o teste passa a exigir ±5 % de tempo e de massa.
- `scripts/roteiro-slicer.cjs` (tablet 1280×800, toque): STL do aparelho, cópias, segunda peça, Kobra 3 com
  árvore e giroide, **tela sem travar** (nenhuma tarefa longa na página acima de 200 ms durante o
  fatiamento), prévia das camadas, alvos ≥ 44 px, calibração, remover peça, preferências lembradas.

**Precisão**: o caminho é gerado de verdade (paredes, linhas, ligações, deslocamentos), então material e
tempo seguem a geometria. Diferenças para o fatiador de referência que ainda podem pesar: emenda e
ordem exata dos caminhos (M2), padrões de fábrica da M1 (largura variável, vãos e uma parede no topo vêm
**desligados** até o Johann confirmar como o perfil dele está), suporte em árvore
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

**Multimaterial completo (fatia X1, 27/11/2026; motor e dados — a tela é da L1/L2)**. Parâmetros no processo (aba
Multimaterial e Suporte do esquema), todos com o padrão que deixa o resultado **idêntico** ao de antes:
- **Filamento por função** (0 = como hoje; 1–4 = esse filamento): **parede** (externa e internas) e **sólido interno** (0 = a cor
  pintada), **suporte** (corpo; a jangada ainda não existe) e **interface do suporte** (0 = o filamento que estiver no bico). O caminho
  de cada função sai na cor escolhida; a camada continua impressa cor por cor, começando pela cor do bico e terminando numa cor da
  camada de cima (a previsão conta a parede e o suporte/interface fixos). Ex.: parede na cor 2 e miolo na cor 1 = 1 troca por camada.
- **Torre de purga**: largura (da impressora), **borda** da torre (voltas na 1ª camada), **posição automática** (como hoje) ou **X/Y**
  do canto a partir da frente à esquerda da mesa (aviso, com a posição, se passar da borda ou encostar numa peça; arrastar na mesa é
  da tela), **ângulo de rotação** (a área ocupada vira a diagonal), **volume de purga na torre** por troca (linhas de purga dentro do
  anel, na cor que entra, com **espaçamento das linhas**, **espaço extra** e **fluxo extra**; se não couber, a torre **se alarga** e
  avisa). Sempre estável: camadas até a última com troca. **Tipo de parede (nervura), cone de estabilização e distância máxima de
  ponte** ficam guardados, ainda sem efeito (🔶, fatia X2).
- **Purgar no preenchimento / nos objetos / no suporte**: parte da purga de cada troca sai dentro do preenchimento esparso, de tudo
  o que a peça tem (objetos) ou do suporte **da cor que entra, naquela camada**; o aproveitado sai da purga desperdiçada (material e
  tempo de purga). Limite físico: nunca mais do que esse volume na camada nem mais do que a purga. "Nos objetos" vale para todas as
  peças (escolher a peça é da aba Objetos, O1: 🟡). Com purga no suporte, o suporte do bico sai logo depois da 1ª troca da camada.
- O resultado ganha `purgaAproveitadaMm3`, `torrePurgaMm3`, `torreLado`, `torreOcupa` e `torrePosicao`; o material de cada cor
  (g, m, R$) continua somando purga e torre e o orçamento recebe pelo mesmo caminho.
Teste: `scripts/teste-multimaterial.ts` (Node): 20 casos (cubo 20 mm sem pintura, 2 e 4 cores, só topo, só fundo, laterais; peça
com balanço e suporte normal/árvore; P1S e Kobra 3) idênticos à linha de base de antes da X1; parede na cor 2 (100 trocas em 100
camadas, cor 2 = paredes + 50 purgas); suporte na cor 3 e interface na cor 4 (trocas contadas à mão pelas camadas, material por cor);
torre (borda, giro, posição na mesa/fora dela/sobre a peça, volume, alargamento, fluxo extra, desligada); purga no preenchimento =
esparso da camada da troca (11,9 mm³ no cubo), nos objetos, no suporte e nunca acima da purga; projeto `.wjslc` com os campos; sem NaN.

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

## 6. Orçamento, biblioteca de custos e proposta comercial (16/11/2026)

Pedido do Johann: orçar com a **mesma conta da planilha MATRIZ_V01** (lida no Google Drive; o arquivo **não é versionado**,
é dado comercial), ter uma **biblioteca de custos** única no cofre e gerar a **proposta comercial** no WJWrite a partir do
modelo `PROPOSTA COMERCIAL GRAFIX.docx`.

**A conta da MATRIZ (conferida nas fórmulas): o lucro é MARKUP sobre o custo, não margem.**
- custo bruto da mesa = matéria-prima (g ÷ 1000 × R$/kg) + energia (kW × R$/kWh × h; 630 W × R$ 1,16 = R$ 0,7308/h) +
  desgaste da máquina (R$ 1,00/h × h);
- preço = custo × fator; faixas da matriz: **Variável 1,8 · Mínimo escala 2,5 · Mínimo 3 · Médio escala 3,5 · Médio 4 ·
  Máximo escala 5 · Máximo 6 · Máximo hyper 8 · Máximo ultra hyper 10** (fator 1,8 = lucro de 80 % sobre o custo);
- preço de 1 unidade = arredondado **para cima** (centavos) de preço da mesa ÷ unidades por mesa; valor do pedido = preço
  de 1 unidade × quantidade; lucro bruto = arredondado para cima de (preço − custo) por mesa; **lucro líquido = bruto − 30 %**
  ("oferta", editável); lucro total = líquido × quantidade ÷ unidades por mesa; valor da hora = preço da mesa ÷ horas da mesa;
  dias de produção = horas ÷ 20 h por dia; conversor de horas (dias × 24 + horas);
- a coluna "PORCENT. LUCRO" da planilha divide o líquido pelo preço da faixa **Variável** (célula fixa `$E$9`): é replicada
  na tabela de faixas, com o rótulo "% matriz". Nos totais aparecem o **markup** (sobre o custo) e a **margem** (sobre o preço).

**Biblioteca de custos** (botão no topo): item = **categoria** (Material comprado, Mão de obra H-H, Serviço, Filamento,
Máquina) + nome + unidade (kg, h, un, m…) + **custo por unidade** + **lucro padrão %** (markup). **Incluir, editar,
duplicar, desativar/reativar e buscar** (sem acento; por nome, categoria, unidade ou código). De fábrica: os preços médios da
planilha (PLA nacional 90, PLA importado 139, ABS 75, TPU 135, PETG 100, resina 149 R$/kg), energia e desgaste da máquina e
os exemplos do Johann (Chumbo 60 R$/kg 0 %; H-H Modelagem 30 R$/h 0 %; Ímã 10×4 R$ 5/un 30 %). **Um arquivo só no cofre**,
`Biblioteca de custos.wjcus` na pasta Impressão 3D, publicado e sem GO-OUT: igual em todos os aparelhos (a mais recente vence;
aparelho sem cópia usa a do cofre). **WJERP**: "Importar do WJERP" traz os itens que têm código e custo (custo padrão ou
preço) como Material comprado, atualiza pelo código e mantém o lucro dos que já existem (novos entram com lucro 0 %).

**Orçamento** (botão no topo; vale para o pedido inteiro): linhas **da impressão** (uma de filamento por cor usada, com a
massa que inclui purga e torre; energia e desgaste da máquina, com as horas calibradas) e **"+ Item da biblioteca"** com a
quantidade (custo = quantidade × custo por unidade). Cada linha mostra **custo, lucro % editável ali mesmo (começa no padrão
do item) e preço**; "Trocar" muda o item da linha. **Totais**: custo, lucro bruto (R$), markup e margem (%), lucro líquido,
preço de 1 unidade e **preço final**. Campos do pedido como na MATRIZ: quantidade pedida, unidades por mesa, oferta (30 %),
horas de impressão por dia; mesas, horas totais, dias e valor da hora; **tabela das 9 faixas** (com "Usar" para pôr o lucro
da faixa em todas as linhas) e conversor de horas. **Os valores ficam gravados no orçamento**: mudar ou desativar o item na
biblioteca não muda orçamento antigo. O orçamento vai no projeto `.wjslc` e fica no aparelho; as linhas da impressão se
atualizam a cada fatiada (preservando lucro e item editados), "Atualizar da impressão" traz de volta as que foram tiradas.

**Proposta comercial** (botão "Gerar proposta" no orçamento): formulário com emissor e data, cliente (nome/empresa, endereço,
bairro, cidade, telefone), produto (descritivo, dimensões, cores, material, obs.), forma de pagamento, prazo e local de entrega;
**itens = peças da mesa** (nome, quantidade, preço de 1 un; o valor do orçamento é rateado pelo volume, em centavos, e a tela
avisa a diferença para o preço final se o preço for mexido) com as **imagens de cada item: vista isométrica automática** (gerada
da própria peça, com as cores pintadas) **e as vistas escolhidas no WJCAD** (menu do WJCAD → **"Guardar esta vista para a
proposta"**, que acumula as vistas; aparecem na proposta para marcar). Logotipo/QR do emissor opcional, guardado só no aparelho.
"Gerar proposta no WJWrite" grava `Proposta comercial - <cliente>.wjdoc` no cofre (**Documentos › Propostas**) no modelo do
documento do Johann (Proposta comercial; Dados do Cliente; Informações do Produto / Serviço; Custo de Investimento; Entrega do
Pedido; Imagens do Pedido com "N x item (R$ valor)" e "(R$ 20,00 – Cada)") e oferece **Abrir no WJWrite** e **Exportar DOCX**.
No WJWrite: **PDF** (botão PDF = imprimir/salvar em PDF) e **DOCX** (botão DOCX ou menu Exibir).

**Peças**: do WJCAD (menu → Estimar impressão 3D) ou STL do cofre/aparelho, como antes.

**Testes**: `scripts/teste-orcamento.ts` (Node): **as contas da matriz em 3 casos** — 650 g/26 h/1 un (a própria planilha),
120 g/5,5 h/12 un em 4 por mesa e 1,83 kg PLA importado/61,75 h/7 un em 3 por mesa — comparando custo da mesa, mesas, dias e as
9 faixas coluna a coluna (preço de 1 un, lucro bruto, líquido, % matriz, valor do pedido, lucro total, valor/hora) com os
valores obtidos **recalculando a planilha original no LibreOffice** com as mesmas entradas; lucro por linha, linhas da
impressão, valores gravados, biblioteca (incluir/editar/duplicar/desativar/buscar/arquivo/WJERP), rateio, proposta e DOCX
(zip, CRC-32, XML). `scripts/roteiro-orcamento.cjs` (tablet 1280×800, toque): do STL à proposta — biblioteca (os 5 verbos, vinda
do cofre depois de limpar o aparelho), orçamento (item da biblioteca, lucro por linha, faixa, orçamento antigo não muda, alvos
≥ 44 px), vista guardada no WJCAD, proposta salva no cofre, aberta no WJWrite, DOCX (zip válido, LibreOffice abre).

**Limites conhecidos**: o planejamento de impressão da aba "Planilha1" da matriz (grade de dias × horas) não foi trazido (não
faz parte do cálculo de preço); PDF sai pelo "imprimir/salvar em PDF" do WJWrite (sem gerador próprio); itens novos do WJERP
entram com lucro 0 % (o WJERP não tem esse dado).

## 7. Decisões

- Nome da face: **WJSlicer3D** (pedido do Johann: "WJ Slicer 3D").
- **Só P1S e Kobra 3** (15/11/2026). Nomes das impressoras só na lista de máquinas, como dado técnico; o
  nome do fatiador de referência **nunca** aparece.
- Fatiamento **com código próprio** (15/11/2026): proibido copiar código do fatiador de referência (AGPL).
- Sem G-code e sem envio para a impressora (decisão do Johann, 08/11/2026; reafirmada em 15/11/2026).
- Sem documento próprio: o STL vem do cofre (pasta CAD), do aparelho ou do WJCAD.

## 8. Estado e próximos passos

- S1 (08/11/2026): estimativa por camadas, perfis Bambu Lab e Anycubic. **Substituída** pela S2.
- **S2 (15/11/2026, entregue)**: fatiamento real, P1S e Kobra 3, padrões, suporte normal e árvore, saia,
  várias peças, prévia das camadas, tempo por tipo de caminho.
- **S2.1 (16/11/2026, entregue)**: pintura de até 4 cores, trocas/purga/torre no orçamento, filamentos editáveis e projeto `.wjslc` no cofre.
- **S3 (16/11/2026, entregue)**: biblioteca de custos no cofre, orçamento com a conta da MATRIZ_V01, proposta comercial no WJWrite (PDF e DOCX).
- **X1 (27/11/2026, entregue; sem tela)**: multimaterial no motor — filamento por função, torre de purga completa (borda, posição,
  giro, volume de purga, linhas, alargamento) e purga aproveitada no preenchimento/objetos/suporte (§5). Falta: a tela (L1/L2), arrastar a
  torre na mesa (T1), nervura/cone/distância de ponte e a matriz de purga por par de cores (X2).
- Pendente do Johann: valores de referência medidos (tabela do teste) e uma impressão multicolorida medida (purga e tempo da troca).
- Possíveis (só se ele pedir): outros bicos (0,2/0,6/0,8), borda automática, arrastar a peça na mesa à mão.
- **Layout de fatiador completo (pedido de 26/11/2026)**: abas Preparar/Prévia/Bancada, barra lateral Impressora/Filamento/Processo com
  as seis abas (Qualidade, Resistência, Velocidade, Suporte, Multimaterial, Outros), aba Objetos e barra de ferramentas: inventário,
  arquitetura e fatias L/M/S/X/O/T em **`docs/global/wjslicer3d-layout.md`** (decisões pendentes na §7 dele).
- **L0 do novo layout (26/11/2026, entregue; sem mudança visual)**: `src/slicer/esquema.ts` (tabela de todos os parâmetros do
  `Processo` e os de impressora/filamento da §3, com aba, grupo, tipo, unidade, mín/máx, nível, estado e "visível se"; 🔶 entram com
  valor neutro sem mexer no motor; ⚪/⛔ entram **ocultos**), `camadas.ts` (sistema → usuário → projeto → objeto → faixa de Z;
  `resolver()`, `diferencas()`, `aplicarDiferencas()`; 9 perfis de sistema por impressora) e `perfisUsuario.ts` (`Perfis do usuário.wjprf` no
  cofre, junção pela mais recente, exclusão propagada). O worker obtém o `Processo` por `resolver()`; o projeto `.wjslc` (versão 2) grava
  **só as diferenças sobre o 0,20 mm Padrão** (`config.perfil`, mais `ajustes` para app antigo) e o antigo abre igual. Regra dos perfis de
  sistema: 0,20 Padrão = `Processo` de fábrica; os outros mudam só a altura, mantêm a 1ª camada em 0,20 mm e sobem topo/fundo para manter a
  mesma espessura em mm; velocidades, acelerações e fluxos iguais (os "Alta qualidade" = o normal da mesma altura até o Johann mandar
  valores). Cubo 20 mm e cilindro Ø20×20 na P1S e no Kobra 3: tempo e massa idênticos aos de antes (`teste-esquema.ts`).
- **M1 do novo layout (27/11/2026, entregue; motor, sem tela nova)**: `src/slicer/paredes.ts` — gerador de paredes **largura
  variável** (espessura local por raio, pilha de filetes, filete do meio no eixo, ângulo/filtro/paredes na transição, largura
  mínima e detalhe mínimo), **preenchimento de vãos** (parte própria "Preenchimento de vãos" no tempo, no material e na legenda da
  prévia), **só uma parede no topo** (+ limite) e **na 1ª camada**, **perímetro pequeno** (limite + velocidade). Campos do esquema
  passaram a ✅ (origem `processo`). Padrões = comportamento de antes (valores idênticos no teste). Precisão conferida **só
  geometricamente** (cobertura da seção, volume × fluxo): a tabela `REFERENCIAS` continua vazia. Pendente do Johann: valores de
  referência e dizer se o perfil dele usa largura variável / vãos / uma parede no topo (para mudar o padrão do perfil de sistema).
