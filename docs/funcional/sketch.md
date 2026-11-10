# Sketch — esboço

Status: ✅ existe · 🟡 parcial · F3/F4/F5 fase · ⏸ fora do escopo.
"Painel" = painel do comando (substitui a árvore). Hoje o painel do esboço fica à direita (🟡).

---

## 0. Cabeçalho do Sketch e subfunções (definido pelo Johann, 24/10/2026) — 🟡

✅ Cabeçalhos de Features e Sketch com menus ▾ (botão = última subfunção usada; "em breve" nas
pendentes). ✅ Linha / Linha de centro / Linha de ponto médio · Retângulo de canto / pelo centro /
de canto por 3 pontos / pelo centro por 3 pontos / Paralelogramo · Rasgo reto / reto pelo centro /
em arco por 3 pontos / em arco pelo centro · Círculo / perimetral · Arco pelo centro / tangente /
3 pontos · Filete / Chanfro de esboço · Aparar / Estender · Converter entidades (aresta/vértice da
peça vira geometria fixa do esboço) · Padrão linear / circular de esboço · Exibir/Excluir relações ·
painéis completos de Polígono, Aparar, Offset, Espelhar e Padrões (abaixo).
✅ Elipse · Elipse parcial · Parábola · Texto.
✅ (04/11/2026) **Entidades de silhueta** e **Curva de interseção** (`src/esboco/malhaPlano.ts`), um toque
no menu Converter ▾ (abre o esboço se preciso). Calculadas sobre a malha exibida da peça, então valem
para **sólidos e corpos de malha (STL)**:
- Curva de interseção: o plano do esboço corta os triângulos; segmentos encadeados.
- Silhueta: triângulos projetados numa grade de até 2048 células no lado maior e borda da região
  traçada (contorno externo e vazados que atravessam a peça, sem arestas internas; furinhos de uma
  célula fechados). Precisão de 1,5 célula (ex.: 0,18 mm numa peça de 240 mm).
- Polilinhas simplificadas (Douglas-Peucker); laços circulares viram círculos; acima de 3 000
  entidades a tolerância engrossa. Viram linhas e círculos normais do esboço (sem vínculo com o modelo).
- Solver: entidades sem relação nem cota são livres sem teste um a um (com milhares de entidades o
  cálculo de "livres" levava ~1 min; agora milissegundos).
Pendentes: Esboço 3D, Spline de estilo, Curva por equação, Cônica.

Botões com **menu ▾** (o botão executa a última subfunção usada; a seta abre a lista):

| Botão | Subfunções |
|---|---|
| Esboço ▾ | Esboço · Esboço 3D |
| Cota ▾ | Cota inteligente |
| Linha ▾ | Linha · Linha de centro · Linha de ponto médio |
| Retângulo ▾ | De canto · Pelo centro · De canto por 3 pontos · Pelo centro por 3 pontos · Paralelogramo |
| Rasgo ▾ | Reto · Reto pelo centro · Em arco por 3 pontos · Em arco pelo centro |
| Círculo ▾ | Círculo · Círculo perimetral |
| Arco ▾ | Pelo centro · Tangente · 3 pontos |
| Polígono | — |
| Spline ▾ | Spline · Spline de estilo · Curva por equação |
| Elipse ▾ | Elipse · Elipse parcial · Parábola · Cônica |
| Filete ▾ | Filete de esboço · Chanfro de esboço |
| Texto | — |
| Ponto | — |
| Aparar ▾ | Aparar entidades · Estender entidades |
| Converter ▾ | Converter entidades · Entidades de silhueta · Curva de interseção |
| Offset | — |
| Espelhar | — |
| Padrão ▾ | Padrão linear de esboço · Padrão circular de esboço |
| Relações ▾ | Exibir/Excluir relações · Adicionar relação |

**Painel Polígono** — Opções: Para construção. Parâmetros: nº de lados · Círculo inscrito /
circunscrito · Centro X · Centro Y · Diâmetro do círculo · Ângulo · botão **Novo polígono**.

**Painel Texto de esboço** — Curvas (seleção; o texto segue a curva) · Texto (caixa) · Negrito ·
Itálico · Girar · Alinhar à esquerda / centro / direita / justificado · Inverter vertical /
horizontal · Largura (%) · Espaçamento (%) · Usar fonte do documento · Fonte…

**Painel Aparar** — Mensagem de instrução · Opções: Aparar potente (riscar) · Canto · Aparar
dentro · Aparar fora · Aparar até o mais próximo · Manter entidades aparadas como construção ·
Ignorar aparar geometria de construção.

**Painel Offset** — Distância · Adicionar cotas ✓ · Inverter · Selecionar cadeia ✓ · Bidirecional ·
Tampar extremidades (Arcos / Linhas) · Geometria de construção: Base · Offset.

**Painel Espelhar** — Mensagem ("selecione as entidades e uma linha do esboço, aresta linear do
modelo, plano ou face plana") · Entidades a espelhar (seleção) · Copiar ✓ · Espelhar em relação a
(seleção).

**Painel Padrão linear de esboço** — Direção 1: direção (eixo X padrão; linha/aresta) · espaçamento ·
Cotar espaçamento X · nº de instâncias · Exibir nº de instâncias ✓ · ângulo · Fixar direção do eixo X ✓.
Direção 2: direção (eixo Y) · espaçamento · Cotar espaçamento Y · nº de instâncias (1 = desligada) ·
Exibir nº de instâncias · ângulo (90°) · Cotar ângulo entre eixos. Entidades a padronizar (seleção) ·
Instâncias a pular.

**Painel Padrão circular de esboço** — Parâmetros: centro (seleção de ponto; origem padrão) ·
Centro X · Centro Y · ângulo total (360°) · Espaçamento igual ✓ · Cotar raio · Cotar espaçamento
angular · nº de instâncias · Exibir nº de instâncias ✓ · Raio · Ângulo do arco. Entidades a
padronizar (seleção) · Instâncias a pular.

Pontos de atenção: **Cônica** geral não existe no solver (PlaneGCS tem elipse, arco de elipse e parábola);
**Esboço 3D** e **Spline de estilo** são os maiores — por último.

## 1. Entrar, sair e ambiente

| Função | Comportamento | Status |
|---|---|---|
| Esboço | em plano de referência ✅, face plana ✅, plano criado (F3) | 🟡 |
| Vista normal ao entrar | gira para normal ao plano ✅; ao sair volta à vista anterior | 🟡 |
| Sair do esboço | botão na aba ✅, canto da vista **Sair do esboço / Descartar lado a lado** com ícone e dica próprios (10/11/2026) ✅ | 🟡 |
| ✓/✕ da ferramenta | **(10/11/2026, pedido do Johann)** toda ferramenta do esboço ativa mostra ✓ e ✕ lado a lado no canto superior direito do painel lateral (≥ 44 px no tablet) ✅. **✓** (Enter) conclui e sai; nos comandos com seleção (Espelhar, Filete, Deslocar, Padrões) aplica. **✕** sai desfazendo o que foi feito na ferramenta desde que abriu (um passo de desfazer: Ctrl+Z traz de volta); nos comandos com seleção, cancela sem aplicar. **Esc seguro** (decisão do Johann): nas ferramentas de desenho o 1º Esc cancela a etapa e o 2º sai mantendo o desenho; nos comandos com seleção Esc = ✕ | ✅ |
| Editar esboço | painel do esboço ✅, menu de contexto, duplo clique | 🟡 |
| Editar plano do esboço | trocar plano/face de suporte mantendo a geometria | F3 |
| Esboço 3D | — | ⏸ |
| Barra de status | coordenadas X/Y do cursor, estado (Sub/Totalmente/Superdefinido) ✅ | 🟡 |
| Cores | azul = livre ✅, preto = definido ✅, vermelho = conflito ✅, construção tracejada ✅ | ✅ |
| Contornos sombreados | regiões fechadas preenchidas (mostra o que vira perfil) | ✅ |
| Grade e encaixe | exibir grade, espaçamento maior/menor, escala automática, encaixar na grade | F3 |
| Encaixes rápidos | ponto ✅, ponto médio ✅, sobre curva ✅, H/V ✅; centro, quadrante, interseção, tangente, perpendicular, paralelo, comprimento | 🟡 |
| Linhas de inferência | pontilhadas alinhando com pontos existentes (H/V a distância) | F3 |
| Relações automáticas | ✅ (10/11/2026, pedido do Johann) — ver detalhes abaixo | ✅ |
| Opções do esboço | relações automáticas ✅ (⚙ Configurações → Esboço); resolver automaticamente, detectar superdefinição | 🟡 |

**Relações automáticas ("magnetismo")** ✅ (10/11/2026) — `src/esboco/relacoesAuto.ts`, teste `scripts/teste-relacoes-auto.ts`:
- **Ao desenhar** (como antes): terminar num ponto reaproveita o ponto; sobre curva/eixo → Coincidente (sobre);
  ponto médio → Ponto médio; aresta/vértice da peça → referência do modelo.
- **Linha nova** ganha **uma** relação de direção, na ordem **Colinear** (mesma reta de outra linha solta, dentro
  do raio de encaixe) › **Horizontal/Vertical** › **Paralela** (a mais alinhada; empate: a mais perto) ›
  **Perpendicular** (só com linha ligada a ela, no canto). Tolerância **±1°** (o encaixe H/V de ±4° continua
  posicionando o ponto). Continuação de uma linha ganha Paralela (a Colinear seria redundante no ponto comum).
- **Arrastar um ponto e soltar** sobre outro ponto (ou a origem) → **Coincidente**; sobre linha/arco/curva →
  **Coincidente (sobre a curva)**. O ponto encaixa no alvo enquanto arrasta. Não contam: a própria entidade,
  pontos já coincidentes com ele e os eixos.
- **Símbolo antes de soltar**: na dica do cursor (verde, ex.: "∥ Paralela") e um selo verde tracejado na
  entidade de referência.
- **Nunca redundante nem em conflito**: cada relação passa pelo solver antes de ficar — precisa tirar grau de
  liberdade sem criar conflito nem redundância; senão é descartada (e as posições voltam). Esboço já em
  conflito não ganha relação automática.
- **Ligadas por padrão**; interruptor **"Relações automáticas"** em ⚙ Configurações → Esboço (`PrefsCad.relacoesAuto`,
  `jlscad:interface`; vale também no WJCalcEng e nos ornamentos do WJGoldDiamond). Desligadas, o encaixe só
  posiciona (o ponto existente continua sendo reaproveitado para a cadeia seguir ligada).
- **Segurar Ctrl** suprime no gesto (desenhar ou arrastar), como nos CADs profissionais; o símbolo some na hora.
- **Desfazer (Ctrl+Z)**: a linha e a relação automática dela saem no mesmo passo; o arraste e o Coincidente
  criado ao soltar também.
- Pendente (F3): linhas de inferência pontilhadas, Tangente automática em arcos, relações automáticas nas
  outras entidades (retângulo já nasce com H/V).

## 2. Entidades

Todos os painéis de entidade têm, além dos campos abaixo:
**Relações existentes** (lista + estado) · **Adicionar relações** (botões aplicáveis) ·
**Opções**: Para construção · **Parâmetros** numéricos editáveis (coordenadas).

### Linha — ✅ (painel 🟡)
- **Orientação**: Como esboçada ✅ · Horizontal · Vertical · Ângulo
- **Opções**: Para construção ✅ · Comprimento infinito · Linha de ponto médio
- **Parâmetros**: comprimento, ângulo
- **Parâmetros adicionais**: X/Y inicial, X/Y final, ΔX, ΔY
- Encadeamento ✅, terminar com duplo toque/Esc ✅, transição para **arco tangente** ao voltar
  o cursor ao último ponto (F3)
- Variantes: **Linha de centro** (construção) ✅ via opção · **Linha de ponto médio** F3

### Retângulo — ✅ (canto, centro, 3 pontos inclinado)
- **Tipo**: De canto ✅ · Central · 3 pontos de canto · 3 pontos central · Paralelogramo
- **Opções**: Para construção ✅ · **Adicionar linhas de construção**: dos cantos / dos pontos médios
- **Parâmetros**: X/Y de cada um dos 4 cantos e do centro

### Rasgo (Slot) — ✅ (reto, reto pelo centro) / demais pendentes
- **Tipo**: Reto ✅ · Reto pelo centro · Em arco 3 pontos · Em arco pelo centro
- **Opções**: Adicionar cotas · **Cota**: centro a centro / total · Para construção ✅
- **Parâmetros**: centro X/Y, comprimento, largura, ângulo

### Círculo — ✅ (centro, perimetral)
- **Tipo**: Pelo centro ✅ · Perimetral (3 pontos)
- **Parâmetros**: centro X/Y, raio

### Arco — ✅ (3 pontos, centro-pontas, tangente)
- **Tipo**: Centro-pontas · Tangente · 3 pontos ✅
- **Parâmetros**: centro X/Y, início X/Y, fim X/Y, raio, ângulo

### Polígono — ✅
- **Opções**: Para construção ✅
- **Parâmetros**: nº de lados ✅ · **Círculo inscrito / circunscrito** ✅ ambos ·
  centro X/Y ✅ · diâmetro ✅ · ângulo ✅ (editam o último polígono criado) · botão **Novo polígono** ✅

### Spline — ✅ (passagem por pontos)
- **Opções**: Para construção ✅ · Exibir pente de curvatura · Manter continuidade interna
- **Parâmetros por ponto**: nº do ponto, X/Y, peso de tangência 1/2, direção radial/polar da
  tangência, **tangência acionadora**, redefinir alça / todas, **Relaxar spline**, **Proporcional**
- Spline fechada ✅ (tocando no primeiro ponto)
- **Spline de estilo** (grau 3/5/7, polígono de controle) ⏸ · **Spline de equação**
  (explícita y=f(x) / paramétrica x(t),y(t), t1, t2, travar extremidades) ⏸ · **Ajustar spline** ⏸

### Elipse, elipse parcial, parábola — ✅ · cônica — ⏸
- **Elipse**: centro → ponta do eixo maior → eixo menor. Cria os **eixos maior e menor como linhas
  de construção** presas à curva (solver PlaneGCS): cotar o comprimento de cada eixo dá os
  diâmetros; relação horizontal/vertical ou cota de ângulo no eixo maior dá a orientação.
- **Elipse parcial**: centro → eixo maior → eixo menor e início → fim (anti-horário).
- **Parábola**: foco → vértice → início → fim. Vira Bézier quadrática exata no kernel.
- Ponto sobre a curva (coincidente), tangência numa ponta comum, copiar/girar/mover, espelhar e
  padrões ✅; arrastar a curva move a peça inteira, arrastar as pontas dos eixos muda tamanho e giro.
- Perfil exato no kernel (elipse/arco de elipse e parábola do OpenCascade) ✅; na varredura a
  elipse é aproximada por B-spline.
- Pendentes: painel de parâmetros (centro, raios, ângulos), aparar/estender elipse e parábola
  (hoje aparar apaga a curva inteira), offset delas; **cônica** (rho) não existe no PlaneGCS.

### Ponto — ✅
Parâmetros: X/Y.

### Texto de esboço — ✅
- Tocar no desenho posiciona o início do texto (um ponto de construção, que pode ser cotado).
- **Curvas** ✅: linha (corre ao longo dela), arco (por cima, legível) ou círculo (começa embaixo;
  centralizado fica no topo); o texto acompanha a curva quando o esboço muda. × solta o texto.
- **Texto** ✅ (atualiza enquanto digita) · **Negrito** · **Itálico** · **Alinhar** à esquerda / ao
  centro / à direita / **justificado** (preenche a curva) ✅
- **Altura das letras** (altura das maiúsculas, mm) · **Girar** · **Inverter vertical / horizontal** ·
  **Largura** (%) · **Espaçamento** (%) ✅
- **Fonte**: Noto Sans (SIL OFL 1.1), embutida e offline ✅. Outras fontes / "usar fonte do
  documento": ⏸ (dá para acrescentar outra família OFL do @fontsource no futuro).
- Letras ficam gravadas como contornos no arquivo; furos das letras (A, o, 8) saem certos;
  "Editar texto" no painel de seleção reabre o painel; copiar, girar, espelhar e padrões levam
  as letras junto ✅. Aparar apaga o texto inteiro. Texto em várias linhas ⏸.

## 3. Ferramentas

### Filete de esboço — ✅
- Entidades a filetar (cantos/vértices) · raio · **Manter cantos com restrição** ·
  **Cotar cada filete** · filetes iguais
- **Entidades a filetar** ✅ (10/11/2026, pedido do Johann): os cantos tocados entram na caixa (rosa) do painel
  e um toque em **Aplicar filetes (N)** faz todos; **Filetes iguais** (padrão) liga os arcos com relação de
  igualdade e uma cota R só — mudar essa cota muda todos os filetes do grupo; desligado, cada um com a sua
  cota. Tocar de novo num canto tira da caixa; o × limpa.
- **Manter cantos com restrição** ✅ (10/11/2026, filete e chanfro): o canto vira **canto virtual** (ponto de
  construção na interseção das duas linhas); relações e cotas do canto (origem, distâncias) continuam nele e
  as cotas de comprimento das linhas passam a medir do canto virtual — mudar o raio não move o perfil.
- **Canto unido por relação** ✅ (10/11/2026, erro relatado pelo Johann): duas linhas desenhadas separadas e
  unidas depois por **Coincidente** entre as pontas (inclusive com o canto preso à origem por outra
  Coincidente) são aceitas como canto, tocando qualquer um dos pontos (ou a origem). Ao aplicar, as duas
  pontas viram um ponto só (o canto virtual) e as outras relações continuam (o canto segue na origem). Vale
  também para o chanfro. Antes: "Esse ponto não é um canto entre duas linhas."
### Chanfro de esboço — ✅ (distância igual)
- Ângulo-distância · Distância-distância · Distâncias iguais; D1, D2, ângulo

### Offset de entidades — ✅
- Distância ✅ · **Adicionar cotas** ✅ (uma por lado) · **Inverter** ✅
- **Selecionar cadeia** ✅ (desligado: entidade por entidade) · **Bidirecional** ✅ ·
  **Tampar extremidades** (arcos / linhas) ✅
- **Geometria de construção**: geometria base / geometria do offset ✅
- Pré-visualização tracejada antes de aplicar ✅

### Converter entidades (projetar arestas do modelo) — 🟡
- ✅ Tocar aresta ou vértice da peça no esboço (Selecionar) cria a **referência do modelo**:
  geometria de construção fixa, em roxo, projetada no plano; "Alternar construção" a torna perfil.
- ✅ Encaixe das ferramentas de desenho em **vértice do modelo** e **sobre aresta do modelo**.
- ✅ Ao abrir o esboço, as referências acompanham a peça atual (entidade mais parecida).
- ✅ **Face inteira**: com Converter, tocar uma face da peça converte todas as arestas dela
  (contorno externo e furos) de uma vez, projetadas no plano do esboço (as perpendiculares ao plano
  ficam de fora).
- Pendente: esboços de uma vez · Selecionar cadeia · círculos inclinados (projetam como elipse)

### Interseção de curvas — ⏸
### Segmento (dividir em N partes com pontos) — ⏸

### Aparar entidades — ✅
- **Opções**: Aparar potente (arrastar riscando; um toque também apara) ✅ · Canto (duas linhas) ✅ ·
  Aparar dentro ✅ · Aparar fora ✅ (dois limites, depois as entidades; linhas e arcos) ·
  **Aparar até o mais próximo** ✅
- **Manter entidades aparadas como construção** ✅ · Ignorar aparar geometria de construção ✅
- **Prévia**: ao passar o cursor/caneta, o trecho que vai sair fica em vermelho (potente e mais
  próximo) ✅; o corte aparece na hora, inclusive enquanto se risca ✅
- Pendente: canto entre linha e arco; aparar potente estendendo ao arrastar pela ponta

### Estender entidades — ✅
- Prévia tracejada da ponta até onde a linha vai encontrar outra entidade ✅
### Dividir entidades (ponto de divisão) — ✅ (08/11/2026: linha e arco no ponto tocado, partes colineares / mesmo raio; grupo Aparar)

### Mover / Copiar / Girar / Dimensionar / Esticar — ✅ mover, copiar, girar; demais pendentes
- Entidades · **Manter relações** · Copiar
- Mover/Copiar: De-Para (ponto base) / X-Y (ΔX, ΔY), repetir
- Girar: centro de rotação, ângulo
- Dimensionar: ponto base, fator de escala, copiar (nº)
- Esticar: entidades, ponto base/ΔXY

### Espelhar entidades — ✅
- Entidades a espelhar ✅ (campo de seleção; **caixa de seleção** ✅ 10/11/2026, ver Seleção múltipla) · **Copiar** ✅ · **Espelhar em relação a** ✅
  (linha do esboço, eixo ou aresta reta da peça) · relações de simetria ✅ · pré-visualização ✅
- Pendente: plano/face como espelho
- **Espelhamento dinâmico** ✅ (Espelhar ▾ → Espelhamento dinâmico): escolher a linha de centro (ou
  eixo); tudo o que se desenha aparece espelhado, com relações de simetria; aviso no painel com
  "Desligar"

### Padrão linear de esboço — ✅
- **Direção 1/2** ✅: direção (eixo, linha do esboço ou aresta da peça), inverter, espaçamento,
  **cotar espaçamento X/Y** (cota entre a semente e a 2ª instância), nº de instâncias, ângulo
- Entidades a padronizar ✅ · Instâncias a pular ✅ ("3, 2-2") · pré-visualização ✅
- Pendente: cotar ângulo entre eixos; instâncias amarradas entre si por relações

### Padrão circular de esboço — ✅
- Centro (ponto do esboço ou X/Y; origem padrão) ✅, inverter ✅, ângulo ✅, **espaçamento igual** ✅,
  nº de instâncias ✅, raio e ângulo do arco (leitura) ✅, cotar raio ✅
- Entidades ✅ · Instâncias a pular ✅ · pré-visualização ✅
- Pendente: cotar espaçamento angular; editar raio/ângulo do arco

### Outras — ⏸
Bloco (criar, inserir, editar, explodir) · Imagem de esboço · Linha de deslocamento (jog) ·
Fazer trajetória · Reparar esboço · **Verificar esboço para recurso** (F3: tipo de contorno
esperado × encontrado — hoje o erro aparece na feature ✅)

### Totalmente definir esboço — F3
- **Relações a aplicar** (todas / selecionadas) · **Cotas**: referência horizontal e vertical
  (origem por padrão), esquema: base / cadeia / coordenada; posição acima/abaixo, esquerda/direita

### Alternar construção — ✅

## 4. Cotas

### Cota inteligente — ✅
- Aceita **arestas e vértices da peça** ✅ — ex.: centro do círculo até a aresta da face onde está o
  esboço. **10/11/2026 (pedido do Johann):** a cota fica **presa direto à aresta/vértice da peça**, sem
  criar linha no esboço: a referência é **oculta** (`oculta` na geometria externa) — não aparece, não se
  seleciona, não encaixa, não recebe relação automática e **nunca entra no perfil** (contorno, perfil
  aberto, até o próximo). Continua acompanhando a aresta quando a peça muda (assinatura geométrica) e sai
  sozinha quando a cota é apagada. O mesmo vale para a aresta usada como linha de espelho e como direção
  dos padrões. Selecionar a mesma aresta (para relação) cria outra referência, visível; a da cota segue
  oculta. **Esboços antigos**: ao abrir, a linha de referência usada **só por cotas** (sem relação nem
  geometria ligada) vira oculta automaticamente — a cota continua, a linha some (`ocultarRefsDeCota`,
  testado em `teste-esboco` com extrusão e corte até o próximo).
- **Distanciador automático** ✅: enquanto posiciona, a cota segue o cursor (prévia) e a linha de
  cota vai sozinha para a distância padrão da geometria; mais longe encaixa em múltiplos dessa
  distância (cotas paralelas igualmente espaçadas); entre as linhas de chamada o número fica
  centrado. O mesmo vale ao arrastar uma cota existente.
O tipo depende do que se seleciona e de **onde se solta o número**:

| Seleção | Cota | Status |
|---|---|---|
| Linha | comprimento (alinhada) | ✅ |
| Linha + posição fora do vão | horizontal/vertical da linha | F3 |
| 2 pontos | alinhada · horizontal · vertical (pela posição) | ✅ |
| Ponto + linha | distância perpendicular | ✅ |
| 2 linhas paralelas | distância | ✅ |
| 2 linhas não paralelas | ângulo (setor pela posição) | ✅ |
| Círculo | diâmetro | ✅ |
| Arco | raio | ✅ |
| Arco + Shift / opção | comprimento do arco | F3 |
| Círculo + círculo | centro a centro ✅ · mín/máx (Shift) F3 | 🟡 |
| Linha de centro + entidade | cota de diâmetro "por revolução" (dobro) | F3 |

Outros tipos — F3/⏸: horizontal/vertical dedicadas, linha de base, cadeia, coordenadas (ordinate),
chanfro.

### Diálogo "Modificar" (ao criar e ao editar) — 🟡
- **Reabrir a cota** ✅ (10/11/2026, correção): tocar/clicar (dedo, caneta ou mouse) numa cota existente abre a
  caixa com o valor atual com a **Cota** ou a **Selecionar** ativa (antes, só com Selecionar: com a Cota o
  toque não abria). **Duplo clique / duplo toque** abre com qualquer ferramenta. Com a caixa aberta, Enter
  (mesmo sem foco, teclado do tablet) aplica.
- **Teclado-calculadora** ✅ (09/11/2026, pedido do Johann; 10/11/2026: **abre pelo botão com símbolo de
  calculadora** na caixa do valor, não sozinho): a caixa da cota (número + 🖩 + ✓) aparece ao criar ou editar
  qualquer cota — no tablet/celular sem foco (o teclado do sistema não sobe sozinho), no computador já
  selecionada; a calculadora abre ao lado do número (sem cobri-lo); visor que não sobe o teclado do sistema; **normal** (algarismos, vírgula,
  ±, + − × ÷, parênteses) ↔ **científico** (sen/cos/tan em graus e inversas, √, x², xʸ, π, log, ln),
  lembrado por aparelho; resultado ao vivo; teclado físico vale (Enter/Esc); tocar fora aplica
  (`src/ui/tecladoCota.ts`). O valor atual vem selecionado: o 1º algarismo troca, um operador continua dele.
- Cota angular ✅ (09/11/2026): o arco fica **no setor do ângulo cotado**, com setas, extensão até o texto e
  linhas de chamada (linhas quase paralelas não desenham mais o setor suplementar atravessando a tela).
- Mudar o valor leva a cota em **passos** (o solver acompanha) e, se o contorno passar a se cruzar, avisa;
  com a **Cota ativa, arrastar uma linha/ponto move a geometria** (desfaz o cruzamento sem trocar de
  ferramenta). Selos de relação (H, V…) só recebem toque em Selecionar/Exibir relações.
- Valor ✅ · aceita **expressão** ✅ (`20/2`) · **variável global** / equação ✅ (`=nome`)
- ✓ salvar ✅ · ✕ cancelar ✅ (Esc) · **Reconstruir** · setas ± com incremento · inverter sentido ·
  marcar para desenho

### Painel da cota — 🟡
**Aba Valor**
- Estilo de cota (favoritos) ⏸
- **Tolerância/Precisão**: tipo (nenhuma, básica, bilateral, limite, simétrica, mín, máx, ajuste),
  valores, nº de casas (F5 junto com Avaliar/desenho)
- **Valor primário**: nome (`D1@Esboço1`), valor ✅, **Acionadora/Acionada** ✅ ("cota de referência")
- Texto da cota (prefixo/sufixo) ⏸ · unidade dupla ⏸
**Aba Linhas de chamada** — F3 (visual)
- Setas: fora/dentro/inteligente · estilo de seta · raio/diâmetro/linear · chamada curvada ·
  quebrar linhas · posição do texto
**Aba Outros** — ⏸ (fonte, camada, substituir unidades)

## 5. Relações

### Lista de relações e combinações válidas

| Relação | Seleções aceitas | Status |
|---|---|---|
| Horizontal | 1+ linhas · 2+ pontos | ✅ |
| Vertical | 1+ linhas · 2+ pontos | ✅ |
| Colinear | 2+ linhas | ✅ (2) |
| Coradial | 2+ arcos/círculos (mesmo centro e raio) | F3 |
| Perpendicular | 2 linhas | ✅ |
| Paralela | 2+ linhas | ✅ |
| Paralela HV (3D) | — | ⏸ |
| Tangente | linha+arco/círculo · arco+arco · spline+linha/arco | ✅ (sem spline) |
| Concêntrica | 2+ arcos/círculos · ponto+arco | ✅ (arco/círculo) |
| Ponto médio | ponto + linha | ✅ |
| Interseção | 2 linhas + 1 ponto | F3 |
| Coincidente | ponto + linha/arco/círculo · ponto + ponto | ✅ |
| Igual | 2+ linhas · 2+ arcos/círculos | ✅ |
| Simétrica | linha de centro + 2 pontos/linhas/arcos | ✅ (2 pontos) |
| Fixa | qualquer entidade | ✅ |
| Perfurar (pierce) | ponto + curva fora do plano | ⏸ |
| Mesclar pontos | 2 pontos (vira 1) | ✅ (encaixe) |
| Em arestas do modelo / no ponto do modelo | referências externas | ✅ (via referência do modelo) |

### Seleção múltipla — ✅ (29/10/2026)
Botão **Selecionar ▾** na aba Sketch (a seta escolhe o modo; o botão repete o último):
- **Selecionar (toque e caixa)** (V): toque seleciona/desmarca; arrastar no vazio faz a **caixa** —
  da esquerda para a direita, só o que fica todo dentro; da direita para a esquerda, também o que
  cruza a borda (como nos CADs profissionais). Com o dedo (sem caneta), arrastar no vazio continua
  girando a vista.
- **Seleção por traço**: risque com a caneta; tudo o que o traço **encostar** (tolerância do toque)
  entra na seleção. O dedo também risca neste modo.
- **Seleção por laço**: contorne uma forma livre; o que ficar **todo dentro** entra na seleção.
- **Selecionar tudo** (Ctrl+A): todas as entidades do esboço.
- Os gestos **somam** à seleção (bom para a caneta, sem Ctrl); tocar no vazio limpa. Ao terminar,
  abre a caixinha de relações aplicáveis. Função pura `idsNaSelecao` (testada em `teste-esboco`).
- **Caixa dentro dos comandos** ✅ (10/11/2026, pedido do Johann): no **Espelhar** (campo Entidades),
  **Deslocar (offset)**, **Padrão linear** e **Padrão circular** (campo Entidades), arrastar no vazio com
  caneta ou mouse faz a mesma caixa (mesmas regras e mesmo visual) e enche a lista do comando; tocar
  uma entidade continua pondo/tirando uma a uma. Só curvas do esboço entram (o eixo do espelho fica de
  fora). Com o dedo, arrastar no vazio gira a vista, como no Selecionar.
- **Prioridade do esboço sobre a peça** ✅ (10/11/2026, pedido do Johann): dentro da tolerância do toque,
  linhas, arcos e pontos do esboço **sempre vencem** as arestas/vértices da peça (e as referências da peça
  já trazidas ao esboço). A peça só é pega se não houver entidade do esboço ali, ou no Converter entidades.
  Vale para caneta, mouse e dedo (com caneta em uso, o toque curto do dedo também seleciona).
  **Tocar de novo no mesmo lugar** (com a entidade selecionada) troca para a aresta/vértice da peça que
  está embaixo; mais um toque volta para a entidade do esboço.

### Caixinha de relações no ponteiro — ✅
- Ao selecionar entidades (Selecionar), abre ao lado do ponteiro uma caixinha com os **símbolos**
  das relações aplicáveis (H, V, ∥, ⊥, =, ⫽, T, ◎, ½, ⇹, ◉, ⚲); toque aplica. Some ao limpar a seleção.

### Adicionar relação (painel) — ✅ (via menu)
- **Entidades selecionadas** (lista) ✅
- **Relações existentes** (lista + estado) ✅
- **Adicionar relações**: só as aplicáveis à seleção ✅
- Opção **Para construção** e **Fixar** no mesmo painel F3

### Exibir/Excluir relações — ✅
- **Filtro** ✅: Todas no esboço · Superdefinindo / redundantes · Externas (peça) · Fixas ·
  Entidades selecionadas (tocar entidades no desenho filtra por elas)
- **Informações** ✅: estado de cada relação (Satisfeita · Superdefinindo · Redundante); tocar a
  relação destaca as entidades envolvidas
- Excluir ✅ · Excluir todas (do filtro) ✅ · Desfazer (Ctrl+Z) ✅ · Substituir entidade ⏸
- Selos de relação no desenho ✅ (mostrar/ocultar ✅)

## 6. Entrada (tablet e computador) — ✅

- Caneta desenha; dedo navega; sem caneta o dedo desenha com encaixes maiores e **lupa** ✅
- Computador: botão esquerdo desenha/seleciona, **meio gira** (Ctrl + meio arrasta), roda aproxima
  no cursor, **direito abre o menu de contexto** ✅
- Atalhos ✅: L linha · R retângulo · C círculo · A arco · S spline · P polígono · T aparar ·
  D cota · O offset · M espelhar · V selecionar · Enter conclui · Esc cancela · Delete exclui
- Tecla S → barra de atalhos ✅ · menu de contexto do botão direito ✅
- Gestos de mouse/caneta (guia radial): **fora do projeto** (decisão do Johann)
  (ver `referencia-introducao.md` §7)

## 7. Escala real 1:1 (desenhar em tamanho real no tablet) — ✅ (05/11/2026)

Função própria do WJCAD (pedido do Johann): com uma régua sobre a tela, um traço de 50 mm com a
caneta vira uma linha de 50 mm no esboço; splines, arcos e qualquer ferramenta saem em 1:1.

- Aba **Sketch → Escala 1:1 ▾**:
  - **Escala real 1:1** (liga/desliga, fica pressionado; a escolha vale para os próximos esboços):
    no esboço, a vista olha o plano de frente e fica **travada em tamanho real** (1 mm na tela = 1 mm
    no esboço). Sem zoom (pinça, roda, Enquadrar só centraliza) e sem girar (tríade/vistas voltam a
    olhar o plano de frente); **um dedo ou o botão do meio arrastam a vista** para alcançar outra
    região. Barra de status: "· Escala real 1:1". Sair do esboço solta a vista.
  - **Calibrar escala da tela…**: o navegador não informa o tamanho físico da tela (nem o PPI), então a
    calibração é feita uma vez por aparelho:
    - **Automática pela ficha do aparelho** (05/11/2026): o Chrome do Android informa o modelo
      (`userAgentData.getHighEntropyValues(["model"])`); para os modelos da tabela `FICHAS`
      (`src/esboco/escalaReal.ts`: **TCL TAB A1 Plus 9445X — 12,2", 2400×1600**, o tablet do Johann;
      Samsung Galaxy Tab S6 Lite, S8, S9, S9+, S9 FE), pixels por mm = pixels CSS do lado maior ÷ mm do
      lado maior (da diagonal e da resolução), conferindo antes que a resolução informada pelo navegador
      bate com a ficha (±3%) e a proporção (±2%). Ligar a escala real num aparelho conhecido calibra
      sozinho, sem janela; a janela de calibração mostra "Aparelho reconhecido" com "Usar a ficha do
      aparelho". Modelo fora da lista ou dados que não batem: um dos dois jeitos abaixo.
    - **Medidas da tela** (recomendado, 05/11/2026, ideia do Johann): página branca em tela cheia com as
      **bordas da área acesa marcadas** e as setas **Lado A (horizontal ↔)** e **Lado B (vertical ↕)**;
      **tocar e segurar** (caneta ou dedo) ou "Informar medidas" abre o pop-up: Lado A e/ou Lado B em mm
      (área acesa, sem a moldura) ou a diagonal em polegadas (ficha técnica). O campo em foco acende a
      borda do lado medido. Com os dois lados, o app **confere a proporção** com a da tela (desvio > 1,5%
      = medida errada, ex.: com a moldura → avisa e não aceita). O app já sabe quantos pixels a tela tem
      (`screen`/tela cheia): pixels por mm = pixels do lado ÷ mm do lado (`pxPorMmDasMedidas`).
    - **Régua** (também para conferir): régua de 100 mm (50 mm em tela estreita) desenhada na tela;
      encostar uma régua de verdade e ajustar com − / + (0,1 mm), a barra, ou digitar quanto a barra
      mediu ("Corrigir").
    Guardado em `localStorage["jlscad:pxPorMm"]` (pixels CSS por mm). Ligar a escala real sem
    calibração abre a calibração antes.
- Código: `src/esboco/escalaReal.ts` (calibração), `Viewport.travarEscala` (zoom = px/mm da
  calibração, controles só de pan), `alternarEscalaReal`/`aplicarEscalaReal` em `src/main.ts`.
- Encaixes e relações automáticas continuam valendo (ex.: horizontal); as medidas seguem o traço.

## 8. Contorno que cruza a si mesmo — ✅ (07/11/2026)

- Um contorno fechado que cruza a si mesmo (ex.: spline que volta quase em cima de uma linha e passa
  décimos de mm para o outro lado) não vira sólido válido. Antes, o sólido saía sem as tampas e a peça
  aparecia "oca" na tela; agora o recurso fica com **erro na árvore**, com o ponto: "O contorno do esboço
  cruza a si mesmo perto de (x; y) mm…", e o esboço mostra um **✕ vermelho** no ponto do cruzamento.
  Ajustar a curva (arrastar o ponto da spline, aparar a linha) resolve.
- Código: `cruzamentoDoLaco` (`src/esboco/geometria.ts`, sobre o polígono amostrado das curvas); aviso em
  `desenhoDoEsboco` (kernel) e marca em `src/esboco/visual.ts`. Teste em `teste-recursos.ts` com a
  geometria da peça do Johann.

