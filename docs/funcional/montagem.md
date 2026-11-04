# Montagem — ambiente de montagem (componentes e posicionamentos)

Formato de cada comando: **Nosso nome** (referência) → caixas do painel → campos e opções.
Status: ✅ existe · 🟡 parcial · M-A…M-E etapa do roteiro de montagem · ⏸ fora do escopo atual.
Mesmo caminho da Peça: painel de comando à esquerda com ✓/✕, canto de confirmação no viewport,
campos rosa que recebem o que se toca no modelo, Enter = OK, Esc = Cancelar, prévia ao vivo.

---

## Estado (29/10/2026)

✅ **Página própria** `cad/montagem/` (`src/montagem/`): mesma barra, faixa, árvore, painel de comando,
canto ✓/✕ e menu do botão direito/toque longo da peça. Novo → Montagem na peça abre esta página.
- **Modelo** `src/montagem/modelo.ts`: peças embutidas (uma por arquivo do cofre, atualizadas ao
  abrir), componentes com posição + rotação (quatérnio), posicionamentos.
- **Cena** `src/montagem/cena.ts`: as malhas dos componentes viram uma malha só no viewport (seleção,
  destaque e seção funcionam como na peça), com o mapa de qual componente é cada face/aresta/vértice.
- **Solver** `src/montagem/solver.ts`: resíduos geométricos por tipo; Levenberg–Marquardt com
  regularização mínima (o que já está certo não se mexe) e resíduos de direção em escala de
  comprimento; resolve em etapas (componentes presos ao que já está resolvido, depois todos juntos);
  50 componentes em cadeia ≈ 0,2 s. Graus de liberdade pelo espaço nulo do jacobiano; conflito vira
  erro no posicionamento. Testes: `scripts/teste-montagem.ts`.
- **Toque**: no Posicionar, o dedo sobre uma face escolhe a face (aresta/vértice só bem perto).
- **Lista de materiais** (Avaliar) com código/descrição do cartão do cofre e CSV.
- **M-C** (29/10/2026): padrão linear (1 ou 2 direções) e circular, espelhar (cópia), com as
  cópias seguindo a semente (no solver contam como fixas; `aplicarPadroes`); vista explodida
  (passos manuais e explosão automática, só exibição); interferência, massa da montagem e medir
  no kernel com os componentes posicionados (pedidos `interferencia`, `massaPecas`, `medirMontagem`).
- **WJPDM**: ao salvar, a tabela `referencias` recebe o que a montagem contém (aba Referências do
  arquivo no WJPDM: Contém / Onde é usado).

## 0. Conceitos

- **Arquivo de montagem** `.wjasm` (formato `wjasm`), aberto no próprio WJCAD (Novo → Montagem).
  Salva no cofre como as peças (GO-OUT/GO-IN, pasta escolhida no primeiro salvar).
- **Componente**: uma *instância* de uma peça (`.wjcad`) ou de outra montagem (submontagem,
  `.wjasm`, M-D). O mesmo arquivo pode entrar várias vezes: `Eixo<1>`, `Eixo<2>`.
  - **Origem do componente**: o arquivo do **cofre** (id do arquivo no WJPDM). A montagem guarda o
    id e também uma **cópia embutida** da peça (para abrir sem o cofre, em outro aparelho ou de um
    arquivo avulso). Ao abrir, se o cofre tem versão mais nova, o componente é atualizado e avisa.
  - **Configuração** da peça usada pela instância (peças com configurações).
  - **Transformação** (posição + rotação) em relação à origem da montagem.
  - **Fixo** (f) ou **flutuante**. O primeiro componente inserido fica fixo, com as origens
    coincidentes (como no CAD de referência).
  - **Oculto**, **suprimido** (fora da regeneração, da massa e da lista de materiais) e cor/
    transparência de exibição.
- **Graus de liberdade**: 6 por componente flutuante (3 translações + 3 rotações). Os
  **posicionamentos** (mates) tiram graus de liberdade. Prefixos na árvore:
  - (f) fixo;
  - (−) subdefinido (ainda se move);
  - sem prefixo: totalmente definido;
  - (+) superdefinido / posicionamento que não pode ser satisfeito (vermelho).
- **Planos e origem da montagem**: Frontal, Superior, Lateral e Origem, como na peça (Y para cima).

## 1. Interface

- **Abas de comando** da montagem: **Montagem**, **Avaliar** (medir, massa, interferência,
  vista de seção) e **Esboço** (esboço de layout na montagem — ⏸).
- **Árvore** (à esquerda):
  - nome da montagem;
  - Planos e Origem;
  - componentes na ordem de inserção, com prefixo de estado, nome `Peça<n>`, configuração entre
    parênteses e ícone de peça/submontagem;
  - pasta **Posicionamentos** (cada um com ícone do tipo, nome automático
    "Coincidente1 (Eixo<1>, Base<1>)", estado e erro);
  - padrões de componentes;
  - **Vistas explodidas** (pasta em Avaliar ▸ Configurações de exibição no CAD de referência; aqui na
    própria árvore).
  - Expandir um componente mostra os recursos da peça (só leitura) e os posicionamentos dele.
- **Barra de contexto** ao tocar um componente: Mover, Girar, Posicionar, Fixar/Flutuar, Ocultar,
  Transparência, Isolar, Abrir peça, Substituir, Excluir.
- **Menu de contexto** (botão direito / toque longo): os mesmos itens + Selecionar outro.

## 2. Aba Montagem — comandos

### 2.1 Inserir componentes (Insert Components) — ✅
- **Caixa "Peça/Montagem a inserir"**:
  - **Documentos do cofre** (peças e montagens, mais recentes primeiro, com pesquisa) ✅ M-A;
  - **Documentos abertos/recentes** (a peça aberta antes no WJCAD) ✅ M-A;
  - **Procurar no aparelho** (`.wjcad`, `.jlscad`) ✅ M-A.
- **Miniatura** do componente escolhido.
- **Opções**:
  - **Iniciar comando ao criar nova montagem** (abre Inserir componentes no Novo → Montagem) ✅;
  - **Manter aberto** (📌) para inserir várias instâncias ✅.
- **Colocação**: toque no viewport coloca o componente nesse ponto (no plano de trabalho);
  ✓ sem toque coloca na origem. O **primeiro** componente fica **fixo na origem** ✅ M-A.

### 2.2 Posicionar (Mate) — ✅ padrão · M-C (avançados) · M-E (mecânicos)
- **Caixa "Seleções de posicionamento"**: campo rosa com as **duas entidades** (faces, arestas,
  vértices, planos e eixos dos componentes ou da montagem). Ao tocar a segunda entidade, o tipo
  mais provável já é sugerido e pré-visualizado.
- **Caixa "Posicionamentos padrão"** (Standard Mates):
  - **Coincidente** — plano–plano/face plana, aresta–face, vértice–face, vértice–vértice,
    vértice–aresta, eixo–eixo;
  - **Paralelo** — faces planas, planos, arestas lineares, eixos;
  - **Perpendicular** — faces planas, planos, arestas lineares, eixos;
  - **Tangente** — face cilíndrica/esférica com face plana ou outra cilíndrica;
  - **Concêntrico** — faces cilíndricas/cônicas, arestas circulares, eixos (alinha os eixos);
  - **Travar** (Lock) — mantém a posição relativa entre dois componentes;
  - **Distância** — planos/faces planas, ponto–plano, eixos paralelos; valor + **inverter
    dimensão**; com cilindros: **centro a centro**, **distância mínima**, **distância máxima**;
  - **Ângulo** — entre planos/arestas, valor + inverter, **eixo de referência** opcional.
- **Alinhamento**: **Alinhado** / **Antialinhado** (normais ou eixos no mesmo sentido ou opostos);
  botão **Inverter alinhamento** (também na barra flutuante do posicionamento).
- **Caixa "Posicionamentos avançados"** (Advanced Mates) — M-C:
  - **Simétrico** (2 entidades + plano de simetria);
  - **Largura** (Width) — centraliza entre duas faces;
  - **Limite de distância** e **Limite de ângulo** (mín./máx.);
  - **Linear/Linear acoplado** (relação de deslocamentos) ⏸;
  - **Caminho** (Path) ⏸.
- **Caixa "Posicionamentos mecânicos"** (Mechanical Mates) — M-E:
  - **Engrenagem** (relação de rotação entre dois eixos);
  - **Pinhão e cremalheira**;
  - **Parafuso** (rotação × avanço por volta);
  - **Dobradiça** (concêntrico + coincidente num só, com limite de ângulo opcional);
  - **Ranhura** (Slot) — pino num rasgo;
  - **Came** e **Junta universal** ⏸.
- **Caixa "Opções"**:
  - **Adicionar à pasta Posicionamentos** ✅ (sempre);
  - **Mostrar barra de posicionamento rápido** (caixinha flutuante com os tipos possíveis, perto
    do toque — como a caixinha de relações do esboço) M-B;
  - **Só para posicionar** (Use for positioning only): move o componente sem criar o
    posicionamento M-B.
- **Edição**: tocar um posicionamento na árvore e "Editar" reabre o painel; os valores de
  distância/ângulo aparecem no modelo e aceitam edição no lugar (`=expressão`).
- **Erros**: posicionamento que não pode ser satisfeito fica **vermelho** com a mensagem
  ("conflita com Coincidente2: as faces já estão paralelas a 10 mm").

### 2.3 Mover componente (Move Component) — ✅
- **Arrastar** no viewport (dedo/caneta/mouse): componente flutuante se move no plano da tela,
  respeitando os posicionamentos (os graus de liberdade restantes) M-B.
- **Fora do comando** (como nos CADs profissionais) ✅ 04/11/2026: **mouse (botão esquerdo) ou caneta**
  arrastando um componente flutuante o movem; clique sem arrastar seleciona; caneta parada abre o
  menu do componente; o **dedo** continua girando a vista (no tablet, mover com o dedo = comando Mover).
  Vale também para componentes de **malha (STL)**, escolhidos pelo triângulo tocado.
- **Caixa "Mover"**:
  - Arraste livre ✅ M-A;
  - **Ao longo de entidade** (aresta/eixo) M-B;
  - **Por delta XYZ** (ΔX, ΔY, ΔZ) ✅ M-A;
  - **Para posição XYZ** (origem do componente vai para X, Y, Z) ✅ M-A.
- **Caixa "Girar"** (também comando próprio, Rotate Component):
  - **Livre** (arrastar gira em torno do centro do componente) ✅ M-A;
  - **Em torno de entidade** (eixo/aresta) M-B;
  - **Por delta XYZ** (ΔRx, ΔRy, ΔRz em graus) ✅ M-A.
- **Caixa "Opções"**: Padrão · **Detecção de colisão** (para ao encostar) M-C · Arrasto físico ⏸.
- Componente **fixo** não se move (aviso: "Flutue o componente para movê-lo").

### 2.4 Fixar / Flutuar — ✅
- Menu do componente. Fixar grava a posição atual; flutuar libera os 6 graus de liberdade.

### 2.5 Padrão linear de componentes (Linear Component Pattern) — ✅ (pular instâncias ⏸)
- Direção 1 (aresta/eixo/face) + espaçamento + instâncias; Direção 2 opcional; **Componentes
  a repetir**; **Instâncias a pular**. As cópias seguem o componente semente.

### 2.6 Padrão circular de componentes — ✅ (pular instâncias ⏸)
- Eixo + ângulo (espaçamento igual ou total) + instâncias; componentes a repetir; pular.

### 2.7 Padrão orientado pelo padrão da peça (Pattern Driven) — ⏸

### 2.8 Espelhar componentes (Mirror Components) — ✅ cópia (versão oposta ⏸)
- Plano de espelho + componentes. Cada um: **cópia** (mesma peça, reposicionada) ou **versão
  espelhada** (peça nova, oposta — ⏸).

### 2.9 Ocultar / mostrar, transparência, isolar — ✅ (transparência ⏸)
- Ocultar/mostrar componente; **Mostrar todos**; **Transparência** do componente; **Isolar**
  (mostra só os selecionados até sair).

### 2.10 Vista explodida (Exploded View) — ✅ (girar no passo, reordenar, animação e linhas de explosão ⏸)
- **Passos de explosão** (lista, editável, reordenável):
  - componentes do passo;
  - direção (eixo X/Y/Z da montagem, aresta, eixo ou normal de face) + **distância**;
  - **girar** em torno de um eixo (ângulo) opcional.
- **Explodir automaticamente** (afasta os componentes pela caixa delimitadora) M-C.
- **Explodir / Recolher** (com animação) e **linhas de explosão** (tracejado entre a posição
  montada e a explodida) M-C.
- A vista explodida é usada pelo **Desenho** (vista explodida com balões).

### 2.11 Substituir componentes (Replace Components) — M-D
- Troca o arquivo de uma ou todas as instâncias; os posicionamentos são reaplicados pelas
  entidades mais parecidas (assinaturas), com lista de posicionamentos perdidos.

### 2.12 Editar a peça / Abrir peça — ✅
- **Abrir peça** abre o componente no ambiente de Peça (mesma janela; ao salvar volta para a
  montagem, que se atualiza). Peça alterada na montagem e ainda não salva: pergunta e grava antes.
- **Cotas dos componentes na montagem** ✅ (03/11/2026, `src/montagem/cotas.ts`):
  - **duplo clique numa face** de um componente mostra as cotas do recurso da peça que criou a
    face (cotas dos esboços dele + D1, R, espessura…), sobre o componente e na posição dele;
  - **árvore**: a seta ▸ do componente mostra a árvore de recursos da peça (esboços aninhados no
    recurso que os usa); duplo clique (ou toque longo → Mostrar cotas) num recurso mostra as cotas;
  - tocar uma cota edita no lugar (aceita "=expressão"); a peça muda em **todas as instâncias**,
    com equações e configuração ativa da peça, esboços que acompanham a peça, posicionamentos
    resolvidos de novo e um passo de desfazer (Ctrl+Z volta);
  - a peça fica **"alterada (salve)"** na árvore; a atualização pelo cofre ao abrir não a
    sobrescreve. **💾 da montagem** pergunta "Salvar também as peças alteradas?": OK grava cada
    uma no arquivo dela no cofre (GO-OUT automático, nome mantido, sem trocar o vínculo da página
    da Peça; travada por outra pessoa: não grava e avisa); Cancelar salva só a montagem (as
    alterações ficam nela, ainda marcadas).
- **Editar peça** (em contexto) ✅ (03/11/2026, `src/montagem/contexto.ts`): menu do componente →
  **Editar peça** abre a peça no ambiente de Peça com o **resto da montagem em volta,
  transparente**, na posição certa (sistema da peça = posição do componente; as outras instâncias
  da mesma peça acompanham a edição ao vivo). Botões no topo: **Voltar à montagem** (leva a peça:
  todas as instâncias, peça "alterada") e **Montagem** (mostrar/ocultar o contexto). **💾** em
  contexto volta e salva a montagem (com a pergunta das peças alteradas). Recarregar a página
  continua em contexto, com a edição. Abrir outro documento pergunta antes de sair do contexto.
  A montagem passa pelo IndexedDB (`src/comum/transferir.ts`: "contexto" / "contexto-volta").
- **Referências a outros componentes** ✅ (03/11/2026) — em **Editar peça**, os componentes em volta
  podem ser tocados (a peça na frente tem prioridade):
  - **plano do esboço** numa face plana de outro componente;
  - **Converter entidades** de arestas, vértices ou de uma face inteira de outro componente;
  - **Condição final** "Até a superfície / Deslocamento da superfície / Até o vértice" e **Início
    (De)** com face plana ou vértice de outro componente (o rótulo mostra `Face<1>@Placa<1>`).
  - A referência guarda a geometria (no sistema da peça) e de qual componente veio (`ctx`): o
    kernel usa essa geometria e **nunca** a procura na própria peça (`planoDeRef`/`eixoDeRef`/
    `pontoDeRef`; o plano do esboço não "acompanha" faces da peça). **Ao entrar em contexto** as
    referências se atualizam com a posição/forma atual do componente (`atualizarRefsDeContexto`;
    mudança = peça "alterada"); **peça aberta sozinha** usa a última geometria guardada.
  - Árvore: **"->"** no recurso que usa outro componente; **"->?"** fora do contexto (Peça aberta
    sozinha, ou componente que não está na montagem). Outra instância da própria peça não pode ser
    referência (laço). Furo assistido só em face da própria peça.
  - Não aceitam outro componente (por enquanto): filete/chanfro, casca, faces/arestas de chapa e
    a pré-seleção no modelo — esses recursos precisam da geometria da própria peça.

### 2.13 Importar montagem STEP — ✅ (01/11/2026)
- **Abrir arquivo do aparelho** na Montagem aceita `.step/.stp` de qualquer CAD (do CAD comercial:
  exportar STEP AP214). Abrir um STEP de montagem na **Peça** pergunta se vai para a Montagem
  (o arquivo segue pelo IndexedDB, `src/comum/transferir.ts`).
- Kernel (`src/kernel/importar.ts`): cada sólido vira um componente na posição do arquivo;
  instâncias da mesma peça (geometria compartilhada no STEP) viram **a mesma peça** (Pino<1>,
  Pino<2>…); instância espelhada ou com escala vira peça própria. Submontagens são achatadas
  (todos os componentes no nível de cima). Cada peça embutida tem o recurso **Corpo importado**.
- Nomes das peças e do conjunto vêm do texto do STEP (`src/montagem/step.ts`: árvore
  NEXT_ASSEMBLY_USAGE_OCCURRENCE, escapes `\X2\`). Só são usados se a quantidade de cada peça
  confere com o que o kernel achou; senão ficam Peça1, Peça2… (nunca um nome trocado).
- Todos os componentes entram **fixos** e sem posicionamentos (o STEP não traz as relações):
  flutue o que quiser mover e posicione. Teste: `scripts/teste-importar.ts`.
- STEP/STL com o **Inserir componentes** aberto entra como uma peça só.
- Peça só com **corpo de malha** (STL grande, ex.: escaneamento 3D) entra na montagem para ser vista
  e movida (centro pela caixa dos pontos); sem faces/arestas para posicionar nem medir (01/11/2026).

### 2.14 Nova peça na montagem (Insert New Part) — ⏸

### 2.15 Submontagens — M-D
- Inserir uma montagem como componente; **dissolver** e **formar submontagem** ⏸.

## 3. Aba Avaliar (na montagem)

- **Medir** (entre entidades de componentes diferentes) — ✅ (exato no B-Rep, componentes posicionados).
- **Propriedades de massa da montagem** — soma de cada componente com o seu material
  (massa, volume, centro de massa; momentos ⏸) — ✅.
- **Detecção de interferência** (Interference Detection) — ✅ montagem inteira, lista com volumes, tocar destaca o par (opções ⏸):
  - **Componentes selecionados** (vazio = montagem inteira) → **Calcular**;
  - **Resultados**: lista de pares com o volume de cada interferência; tocar destaca em vermelho;
  - **Opções**: tratar coincidência como interferência · ignorar componentes ocultos;
  - **Componentes sem interferência**: mostrar opaco/transparente/oculto.
- **Verificação de folga** (Clearance) — ⏸.
- **Vista de seção** (como na peça) — M-C.
- **Lista de materiais** (só leitura no ambiente de montagem; a tabela de verdade fica no
  Desenho): nº do item, código, descrição, quantidade; **somente nível superior** / **só peças**
  / **recuada**; exportar CSV, mandar para o WJPlan e para a estrutura do item no WJERP — M-C.

## 4. Solver dos posicionamentos — ✅

- Cada componente flutuante tem 6 graus de liberdade; o solver ajusta posição e rotação para
  satisfazer todos os posicionamentos (mínimos quadrados, a partir da posição atual, com o
  componente arrastado como referência).
- Componentes fixos e o "chão" (origem da montagem) não se movem.
- Estado: subdefinido (−), totalmente definido, superdefinido (+) / com erro (vermelho).
- Arrastar um componente com posicionamentos: ele desliza só nos graus de liberdade livres
  (o solver roda a cada movimento, na thread da interface: alvo < 16 ms com 50 componentes).

## 5. Referências e o cofre (WJPDM)

- Cada componente referencia um **arquivo do cofre** (`arquivo`), a **versão** usada (ou
  "última") e a **configuração**. A montagem guarda também a cópia embutida da peça.
- **Tabela de referências** do WJPDM (ver `docs/global/pdm.md`): ao salvar a montagem, o cofre
  registra quem ela contém (filho, quantidade, configuração). O WJPDM mostra **Contém** e
  **Onde é usado** ✅ com M-A.
- **GO-IN da montagem** avisa quando há componentes em GO-OUT (alterados e ainda não publicados)
  e oferece o GO-IN deles junto — M-D.
- **WJERP**: a lista de materiais vira a estrutura (BOM) do item da montagem — ✅ (Importar do
  WJPDM, pela tabela de referências; o item da montagem e os das peças precisam estar ligados aos
  arquivos no cartão).

## 6. Atalhos (computador)

- Mesmos da peça (vistas, F enquadrar, Ctrl+Z/Y/S, Enter/Esc).
- Montagem: **I** Inserir componentes, **M** Posicionar, **Shift+arrastar** girar componente,
  **Delete** excluir componente/posicionamento, **H** ocultar/mostrar.

## 7. Roteiro da montagem

| Etapa | Conteúdo | Status |
|---|---|---|
| M-A | arquivo `.wjasm`, Novo → Montagem, inserir componentes (cofre/aparelho/aberta), primeiro fixo, árvore, mover/girar (arraste, delta, posição), fixar/flutuar, ocultar/isolar, abrir peça (e voltar, a montagem se atualiza do cofre), referências no WJPDM | ✅ 29/10/2026 |
| M-B | posicionamentos padrão (coincidente, paralelo, perpendicular, tangente, concêntrico, travar, distância, ângulo), alinhamento, solver, graus de liberdade, arrastar respeitando posicionamentos, barra rápida | ✅ 29/10/2026 (ao longo de entidade / em torno de entidade: M-C) |
| M-C | padrões e espelhar componentes, vista explodida, interferência, massa da montagem, medir | ✅ 29/10/2026 (vista de seção, BOM para WJPlan/WJERP e posicionamentos avançados ficam para M-D) |
| M-D | submontagens, substituir componentes, GO-IN com componentes | — |
| M-E | posicionamentos mecânicos (engrenagem, pinhão e cremalheira, parafuso, dobradiça, ranhura) | — |
