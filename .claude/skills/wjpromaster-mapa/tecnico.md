# WJProMaster — detalhes técnicos e decisões (movido do CLAUDE.md em 07/11/2026)

> Lido sob demanda (skill `wjpromaster-mapa`). Regras e decisões vigentes: `docs/global/regras.md`.
> Texto original do `CLAUDE.md`, sem cortes. Mudou algo técnico: atualizar aqui no mesmo PR.

## Objetivo

CAD paramétrico **próprio e simplificado** para rodar em **tablet Android** (navegador Chrome / PWA).
O fluxo de trabalho de CADs paramétricos comerciais serve de **inspiração funcional**
(esboço → feature → árvore de histórico), mas **nada é copiado**:

- Proibido: código, ícones, logos, cores de marca, nomes registrados (ex.: "FeatureManager",
  "CommandManager", "SOLIDWORKS"), formatos proprietários (.sldprt/.sldasm) e engenharia reversa.
- Permitido: conceitos genéricos de CAD (abas de comando, árvore de features, planos de referência,
  tríade de eixos, cotas e relações de esboço, chapa metálica com fator K).
- Ícones são desenhados por nós (SVG próprio). Nomes da UI são nossos, em português.
- Não versionar arquivos de instalação nem arquivos de terceiros.

## Stack atual (v0.1, já funcionando)

- Vite + TypeScript, sem framework de UI (DOM puro)
- Kernel B-Rep: OpenCascade via `replicad` + `replicad-opencascadejs`, rodando em Web Worker
  (`src/kernel/worker.ts`); lógica pura em `src/kernel/regenerar.ts` (testável em Node)
- Esboço (`src/esboco/`): solver PlaneGCS via `@salusoft89/planegcs` (WASM, LGPL) na thread da UI
  (resposta imediata ao arrastar); geometria/operações puras e testadas em `scripts/teste-esboco.ts`
- Visualização: Three.js (`src/viewport.ts`), **Y para cima** (Frontal = XY, Superior = XZ, Lateral = YZ;
  isométrica de (1, 1, 1)), render só quando algo muda. Arquivos até a versão 2 (Z para cima) são
  migrados ao abrir (`validarDocumento`)
- Modelo: lista de features serializada em JSON (`.wjcad`; abre `.jlscad` e `.cadt` antigos), em `src/model.ts`.
  **Importar STEP/STL**: abrir um `.step/.stp/.stl` cria peça com o recurso `importado` (arquivo em base64 no
  `.wjcad`, lido no kernel com `STEPControl_Reader`/`StlAPI_Reader` + costura; fica fora das fotografias do desfazer;
  STL acima de 10 000 triângulos = **corpo de malha** só exibido, `malha: true`, lido em `src/kernel/stl.ts`; ao abrir STL
  grande a janela "STL grande" oferece **simplificar** (`simplificarStl`, no worker) para virar sólido editável. Conteúdo importado
  > 1 MB vai ao kernel **uma vez** (depois só a assinatura, `PREFIXO_ENVIADO`; o kernel pede de novo se descartou).
  Listar faces/arestas de sólidos grandes: `listarTopo` (linear), não `forma.faces/edges` do replicad (quadrático)).
  **Montagem STEP** → `.wjasm` (`src/kernel/importar.ts` separa sólidos/instâncias; nomes pelo texto em
  `src/montagem/step.ts`; teste `scripts/teste-importar.ts`); a Peça repassa o arquivo à Montagem (`#importar-step`).
  **Montagem → Editar peça / cotas** (`docs/funcional/montagem.md` §2.12): cotas dos componentes editáveis na
  montagem (`src/montagem/cotas.ts`), Peça em contexto com a montagem transparente (`src/montagem/contexto.ts`,
  `cad/#editar-contexto`) e referências a outros componentes (`ctx` nas `Referencia`, marca "->" na árvore).
  **Edição direta** (Features → Edição direta ▾: Mover / Excluir / Substituir face, `src/kernel/edicaoDireta.ts`,
  `docs/funcional/features.md` §18): edita corpos sem árvore (STEP/STL); sem defeaturing no build, só casos garantidos
- **Ambientes do WJCAD**: Peça em `cad/` (`src/main.ts`), **Montagem** em `cad/montagem/` (`src/montagem/`:
  modelo, cena junta, solver de posicionamentos, testados em `scripts/teste-montagem.ts`) e **Desenho** em
  `cad/desenho/` (`src/desenho/`: folha ABNT em SVG, vistas por projeção HLR no kernel em
  `src/kernel/projecao.ts`, testadas em `scripts/teste-desenho.ts`). Mesma interface (barra, faixa, árvore, painel de comando; peças comuns em
  `src/ui/basico.ts`). Arquivos `.wjasm`/`.wjdrw` no cofre (apps `asm`/`drw`); ao salvar, montagem e desenho gravam a
  tabela `referencias` do WJPDM (tipos `componente` e `desenho`). Especificação em `docs/funcional/montagem.md` e `desenho.md`.
- **Várias páginas** (Vite multi-page): `index.html` = **início do WJProMaster** (caixas de cada software,
  `src/inicio/`, leve: sem Three.js nem kernel; **⚙ Configurações do WJProMaster** no topo = perfil do dispositivo e
  cópias de todos os apps, `abrirCopias(…, mestre)` carregado só no toque), `cad/index.html` = **WJCAD** (`src/main.ts`) e uma página
  por face (seção "Outras faces"). O logo de cada app volta ao início. Em desenvolvimento: `/` é o início,
  `/cad/` é o WJCAD. Página nova: entrada em `vite.config.ts` (`rollupOptions.input`), em `PAGINAS` do
  `public/sw.js` e caixa em `src/inicio/inicio.ts`.
- PWA (manifest + `public/sw.js`). Hospedagem **em uso: GitHub Pages**
  (`https://johann-sicherl.github.io/WJProMaster/`; o GitHub Actions `.github/workflows/deploy.yml` roda
  check/teste/build e publica a cada merge no `main`). O kernel usa o build de **uma thread**
  (`replicad_single`), então não precisa de `crossOriginIsolated`. **Cloudflare Pages** fica para depois
  (kernel com várias threads via COOP/COEP em `public/_headers`, e servidor da G5); atenção: COOP
  `same-origin` quebra a janela de login do Google (Drive) — usar `same-origin-allow-popups` nesse dia.
  Origem autorizada no cliente OAuth do Google: `https://johann-sicherl.github.io`.
- Unidade: **mm** (sistema MMGS)

Gerenciador de pacotes: **pnpm** (não usar npm; segurança em `pnpm-workspace.yaml`:
scripts de instalação bloqueados exceto `onlyBuiltDependencies`, `minimumReleaseAge` de 3 dias).
Nova dependência só com justificativa, de projeto conhecido, e revisando o `pnpm-lock.yaml`.

Comandos: `pnpm dev` · `pnpm check` (tsc) · `pnpm teste` (kernel em Node) · `pnpm build`.
Antes de cada commit: `pnpm check && pnpm teste && pnpm build` devem passar.

## Outras faces (v1 locais, 25/10/2026)

Casca comum em `src/comum/` (`casca.ts`: barra superior, faixa de comandos por abas, status,
janelas, menus, desfazer por fotografias, autosave; `icones.ts`; `armazem.ts` = IndexedDB).
Motores puros testados em Node (`pnpm teste`). Estado detalhado no fim de cada `docs/global/<face>.md`.

| Face | Página | Código | Motor testado | Arquivo / dados |
|---|---|---|---|---|
| WJPlan | `planilha/` | `src/planilha/` | `src/formulas/` (`teste-formulas.ts`) | `.wjpl`, autosave `wjpl:documento` |
| WJWrite | `documento/` | `src/documento/` | — | `.wjdoc`, autosave `wjdoc:documento` |
| WJApresentation | `apresentacao/` | `src/apresentacao/` | — | `.wjapn`, autosave `wjapn:documento` |
| WJCronProject | `cronograma/` | `src/cronograma/` | `src/agenda/` (`teste-agenda.ts`) | `.wjcron`, XML MSPDI, autosave `wjcron:documento` |
| WJPDM | `pdm/` | `src/pdm/` | `src/pdm/regras.ts` (`teste-pdm.ts`) | IndexedDB `wjpdm`, cópia `.wjpdm` |
| WJERP | `erp/` | `src/erp/` | `src/erp/regras.ts` (`teste-erp.ts`) | IndexedDB `wjerp`, cópia `.wjerp` |
| WJTaskPlan | `tarefas/` | `src/tarefas/` | `src/tarefas/regras.ts` (`teste-tarefas.ts`) | IndexedDB `wjtaskplan`; `WJTaskPlan/tarefas.json` + `.csv` (pasta irmã do WJPDM nas cópias) |
| WJVideoMaker | `video/` (editor, V1) + `video/aparelho/` (V0) | `src/video/` | `src/video/projeto.ts`, `audio.ts`, `tempo.ts`, `capacidade.ts` (`teste-video.ts`) | `.wjvid` no cofre (app `video`, pasta "Vídeos"), autosave `wjvid:documento`; mídia importada do aparelho ou do WJPDM com cópia no OPFS (`wjvideo/midia/<id>`); exportação MP4 no Worker com a `mediabunny` (MPL-2.0), "Salvar no WJPDM" sem versões (`exportarComo(..., { semVersoes })`) |
| WJCalcEng | `calceng/` | `src/calceng/` | `src/calceng/cg2d.ts` (`teste-calceng.ts`) | `.wjcalc` (pasta Cálculos do cofre), autosave `wjcalc:documento`; calculadora 1 = centro de gravidade 2D: o desenho é o **esboço do WJCAD** (`EditorEsboco`, faixa Sketch, `Viewport.definir2D`), cada região fechada = figura; painel direito = massa única ou por figura, CG, inércia; demais calculadoras (álgebra, matrizes, física) em `src/calceng/calculadoras.ts` (campos + resolução passo a passo, `calcs[id]` no arquivo), catálogo e lupa em `modulos.ts` |
| WJGoldDiamond | `joia/` | `src/joia/` | `src/joia/regras.ts` + `geometria.ts` (`teste-joia.ts`) | `.wjgd` (pasta Joias do cofre), autosave `wjgd:documento`; construtores de joia (aro, cabeça, pavé, gravação, textura, fabricação, preço) no mesmo kernel OpenCascade, worker próprio |
| WJSlicer3D | `slicer/` | `src/slicer/` | `src/slicer/fatiar.ts`, `malha.ts`, `perfis.ts` (`teste-slicer.ts`) | sem documento: lê STL do cofre (pasta CAD), do aparelho ou do WJCAD (`transferir.ts`, chave `slicer:peca`, malha em Y para cima, soldada e posta em pé no worker); preferências em `localStorage["wjslicer:preferencias"]`; estimativa sem G-code: corte por laços (aresta da malha), varredura com mapa de bits por camada (cascas, pontes, suporte por operações de bits), planejador trapezoidal com jerk, Klipper a2d, vazão máxima, balanço e tempo mínimo de camada; perfis de fábrica 0,4 mm / 0,20 mm |
| WJFlow | `flow/` (+ `flow/aparelho/`) | `src/flow/` | `src/flow/lbm.ts`, `geometria.ts`, `estudo.ts` (`teste-flow.ts`) | `.wjflow` (estudo + peça), autosave IndexedDB `wjflow`; túnel de vento LBM D3Q19 em WebGPU |

Integrações já feitas: o WJPDM abre arquivos nos apps (grava o autosave do app; o WJCAD abre direto
com `cad/#abrir-autosave`) e faz check-in do documento aberto num app; o WJERP importa itens e
listas de materiais do cofre do WJPDM; o WJCAD manda a peça para o WJFlow (menu Arquivo → Abrir no
WJFlow), que é atalho de navegação: o WJCAD continua sem comandos de simulação; do mesmo jeito, menu → Estimar
impressão 3D manda a malha para o WJSlicer3D. Tudo local no aparelho até o servidor (G5/G7).

## Decisões de produto (definidas pelo Johann)

- **Tema claro** (fundo claro no viewport e painéis). Vista sempre em **projeção ortográfica**
  (sem perspectiva/ponto de fuga).
- **Início limpo:** o app abre sem documento (só Novo/Abrir e recentes); **Novo** abre a janela de
  escolha do ambiente (por enquanto só **Peça**).
- **Nome:** **WJCAD** (face do WJProMaster; antes JLSCAD); arquivo de peça **`.wjcad`** (abre também
  `.jlscad` e `.cadt` dos nomes antigos). Chaves internas (`jlscad:` no localStorage, cache `jlscad-`)
  ficam como estão para não perder o autosave e as preferências de quem já usa.
- **Perfil de dispositivo** escolhido na janela inicial (Celular / Tablet / Computador; trocar em
  Ferramentas → Dispositivo): cada perfil mostra só as adaptações do seu operador. Celular: ícones
  sem texto, árvore/painéis em gaveta, dedo desenha. Tablet: caneta + dedo, alvos ≥ 44 px, lupa.
  Computador: botões compactos, mouse e atalhos. Classe `disp-*` no `body`.
- **Cofre único (WJPDM):** todo arquivo de todos os apps vive no cofre do WJPDM (`src/comum/cofre.ts`).
  **O primeiro salvar** (💾/Ctrl+S) abre o **explorador do cofre** (estilo explorador de arquivos:
  Voltar, Pasta acima, caminho clicável, Nova pasta, pastas **e** arquivos em detalhes, duplo clique/toque
  entra na pasta ou escolhe o arquivo; o mesmo explorador serve para Abrir do cofre e para escolher peça/
  modelo; `explorarCofre` em `src/comum/cofre.ts`) e **já publica a versão 1** no dispositivo, no pendrive e no Drive (GO-IN automático; o
  arquivo segue em GO-OUT com quem salvou). **Todo salvar vai também para todas as cópias** (06/11/2026:
  cópia de trabalho e arquivo nunca publicado no índice interno `.wjpdm`, para abrir em qualquer aparelho;
  a mensagem diz onde chegou). **GO-IN** (sem comentário: é só a cópia) cria a versão e publica: os
  **arquivos visíveis** do pendrive e do Drive só mostram o que passou por GO-IN (`vistaPublicada` só nos
  visíveis; o índice e os conteúdos vão inteiros); no WJPDM há
  **GO-IN da pasta** inteira (com as subpastas). Nas três cópias, ao lado de cada arquivo fica a pasta
  `<nome> (versões)/<nome> v<n>[ rev X].<ext>` com uma cópia de cada GO-IN (`visiveisDoIndice`); o app
  mostra só os arquivos. Arquivos antigos `soLocal` ("só no dispositivo") continuam até o GO-IN. Aba **Cofre** na lateral direita de cada app
  (`instalarPainelCofre`): dados da peça (pasta, estado, revisão, versão, GO-OUT), GO-OUT / GO-IN /
  Desfazer GO-OUT e "Meus arquivos em GO-OUT" (todos os apps) com GO-IN por item ou dos marcados.
  O cofre tem até três cópias além do banco do aparelho: **pendrive** (WJPDM/ na raiz), **Google
  Drive** e **pasta padrão do dispositivo** (mesma estrutura nas três). Ao salvar/publicar e **a cada
  abertura de um app** (`sincronizarAoAbrir`, também na página inicial e no WJTaskPlan, sem pedir permissão;
  ao terminar aparece a **faixa "Cofre:"** com a situação de Google Drive, pasta do dispositivo e pendrive
  — `situacaoDasCopias()`; tudo certo some sozinha; cópia que precisa de toque deixa **"Conectar agora"**,
  e um toque iguala o cofre e as tarefas; depois, tentativas automáticas a cada 5 min / ao voltar a internet ou ao app, e o acesso do Google é renovado sozinho no primeiro toque quando falta < 10 min — `sincroniaAutomatica`), as cópias se igualam
  (`src/pdm/sincronia.ts`, testes em `scripts/teste-sincronia.ts`): o que falta é copiado; registro
  alterado em duas: **a mais recente vence** e a outra vai para a lixeira; exclusões propagam pela
  lixeira (30 dias). Estrutura na cópia: `WJPDM/<pastas>/<arquivo>` legível + `WJPDM/.wjpdm/`
  (índice e versões). **Google Drive** (`src/comum/drive.ts`, teste com Drive simulado em
  `scripts/teste-drive.ts`): login do Google no navegador (token de 1 h, renovado no toque ao salvar),
  escopo `drive.file`, cliente OAuth `751073631393-8tmbb…` do projeto `wjpromaster`; o cofre fica em
  Meu Drive/WJPDM (arquivos atualizados no lugar: o Drive guarda as revisões). Chave secreta não é usada.
  WJERP não é arquivo: banco local + cópia `ERP/WJERP.wjerp` no cofre; banco de verdade na G5.
- **WJPDM:** check-out/check-in se chamam **GO-OUT / GO-IN** na interface (código mantém `checkout`).
  **Fluxo de trabalho editável** (um só por cofre, `meta.fluxo`; de fábrica: Protótipo / Pré-série /
  Série × em desenvolvimento / em produção / em revisão + Obsoleto; revisão por fase com prefixo
  P1 → 01 → A). "Em revisão" = fora da produção e do desenvolvimento (travado).
- **Sem gestos de mouse/caneta** (guia radial com botão direito + arrastar): o Johann não quer.
- **Entrada:** caneta (S Pen) **e** dedo. Caneta desenha no esboço; dedo navega (1 dedo orbita,
  2 dedos zoom/pan). Sem caneta, o dedo também esboça, com snaps maiores e lupa de precisão.
- **Também precisa funcionar no computador** (Chrome/Edge com mouse e teclado), com o mouse dos CADs
  profissionais: esquerdo seleciona/desenha, **meio gira** (Ctrl + meio arrasta), roda aproxima no
  cursor, **direito abre o menu de contexto**. Atalhos: Ctrl+1…8 vistas, Espaço orientação, F
  enquadrar, S barra de atalhos, Ctrl+B reconstruir, Enter/Esc OK/Cancelar, Ctrl+Z/Y/S; no esboço
  L, R, C, A, S, P, T, D, O, M, V, Delete.
- **Interação (fluxo de CAD profissional):** selecionar faces/arestas no modelo mostra a barra de
  contexto; comandos abrem o **painel de comando à esquerda** (no lugar da árvore) com ✓/✕ e o
  **canto de confirmação** no viewport; campos rosa recebem a geometria tocada; esboços consumidos
  ficam aninhados no recurso; barra de retrocesso na árvore.
- **Só quatro áreas de comando:** **Features**, **Sketch**, **Sheet Metal** e **Avaliar**
  (medir, propriedades de massa, vista de seção, análises). Nada de superfícies, soldas, moldes,
  simulação etc.
- **Fluxo e comportamento o mais próximos possível do SOLIDWORKS** (referência profissional do
  Johann): mesmos painéis de comando, campos, opções, condições finais, mouse e atalhos.
  Continua proibido copiar ícones, cores da marca, logotipos, textos e nomes registrados.
  A especificação campo a campo de cada comando está em **`docs/funcional/`** — consultar antes de
  implementar qualquer comando e atualizar o status (✅/🟡/fase) ao entregar.
  O Johann forneceu o guia introdutório oficial do CAD de referência (PDF no Drive dele, **não
  versionar**); a comparação e as lacunas priorizadas estão em `docs/funcional/referencia-introducao.md`
  — usar como base para os próximos pedidos.
- Layout de referência (genérico de CAD): barra superior com menus/ações rápidas → linha de ícones
  da aba ativa → abas Features / Sketch / Sheet Metal / Avaliar; árvore à esquerda com planos Frontal,
  Superior, Lateral, Origem e features; barra de vistas flutuante no topo do viewport;
  tríade de eixos no canto inferior esquerdo; barra de status embaixo (unidades, estado).
  Tudo adaptado a toque (alvos ≥ 44 px).

## Roteiro (uma fase por vez, cada uma utilizável no tablet)

1. **Interface nova** — tema claro; abas Features / Sketch / Sheet Metal com ícones próprios;
   árvore com planos e origem; barra de vistas; tríade; barra de status.
2. **Sketch real** — linha, retângulo, círculo, arco, rasgo, polígono, spline, aparar, offset,
   espelhar; cotas e relações (coincidente, horizontal, vertical, paralelo, perpendicular,
   tangente, igual, concêntrico, fixo) com solver **PlaneGCS** (WASM, LGPL); esboçar em plano ou
   em face selecionada; indicação de esboço sub/totalmente definido.
3. **Features** — extrusão/revolução a partir do esboço (cego, até a próxima, passante, plano médio);
   seleção de faces/arestas no viewport; filete/chanfro só nas arestas escolhidas;
   padrão linear, padrão circular, espelhar; casca; nervura; furo assistido
   (passante, escareado, rebaixado, rosca métrica); por último varredura e loft.
4. **Sheet Metal** (implementação própria, o kernel não tem) — flange base a partir de esboço;
   flange de aresta; dobra por esboço; tabela material/espessura com fator K e raio de dobra;
   alívios de dobra e de canto; planificação e exportação **DXF** para corte.
5. **Avaliar** — medir (distâncias, ângulos, raios, XYZ, mín./máx.), propriedades de massa
   (com material e densidade), propriedades de seção, vista de seção, verificar geometria,
   análises de inclinação, espessura, zebra e curvatura, tempo de reconstrução por recurso.
   Medir, propriedades de massa e vista de seção podem ser antecipados se forem úteis antes.

Fase atual: Fases 1, 2 e 3 entregues (e quase toda a Fase 5 antecipada); **Fase 4** (Sheet Metal)
com o núcleo entregue (flange base, aba, flange de aresta, bainha, corte, planificar, DXF; modelo
próprio em `src/kernel/chapa.ts`). Canto automático entre abas vizinhas ✅. Árvore com "Chapa metálica" e "Padrão planificado" ✅, dobra esboçada, junta e flange de meia-esquadria ✅,
cantos (fechar canto, alívio de canto, quebrar canto) ✅. Desdobrar/dobrar (cortes atravessando dobras) e converter em chapa (com rasgos) ✅. Pendentes da Fase 4: inserir dobras (sólido com casca), margem/dedução de dobra por tabela. Pendentes da Fase 3: filete variável/de face, furo avançado.
Pendente da Fase 5: propriedades de seção. Estado detalhado em `docs/funcional/README.md`.
Referências a faces/arestas são por assinatura geométrica (`src/kernel/topologia.ts`): reencontra
a entidade mais parecida após regenerar; mudanças grandes na peça podem trocar a referência.

## Observações técnicas

- Erros do OpenCascade chegam como `WebAssembly.Exception` sem texto: traduzir para mensagem útil
  e marcar a feature com erro na árvore, sem interromper a regeneração das demais.
- Manter o kernel fora da thread da UI. Regenerações antigas são descartadas (`seq`).
- **Imagens → 3D (fase 1)**: casco visual em `src/imagem3d/casco.ts` — fração coberta 0–255 na grade (não binária) + surface nets = superfície sub-voxel sem tabelas de marching cubes; a grade inteira é `Uint8Array` (48 M pontos no máximo) e a superfície é feita em duas camadas de índices por vez. `simplificarStl` (agrupamento) custa mais que gerar: só usar se a malha passou mais de 8% do pedido.
- **Exportar como "Salvar como"** (`exportarComo` em `src/comum/cofre.ts`): o explorador do cofre aceita `tipos` (seletor "Salvar como tipo" troca extensão e filtro), `dispositivo` (botão "No dispositivo": baixa) e `substituir` (nome repetido vira versão seguinte). Abre em `pastaDoDocumento(app)`. O conteúdo só é gerado depois da escolha. No Playwright, download com nome acentuado aparece como `download` (só no teste).
- `vite.config.ts`: `base` vem de `BASE_PATH` (padrão `/`, Cloudflare); o workflow do GitHub Pages usa `/<nome do repositório>/`.
- **Versão** ao lado do WJProMaster na página inicial e do nome de cada app (`%WJ_VERSAO%` no HTML, `__VERSAO__` no código): `<version do package.json>.<GITHUB_RUN_NUMBER>`
  (`__VERSAO__` em `vite.config.ts`; em desenvolvimento termina em `.dev`). O último número sobe sozinho a cada
  publicação; os três primeiros só mudam editando `version` no `package.json` (entregas grandes).
- Offline: **cache primeiro também nas páginas** (abrir não espera a rede; versão nova pela faixa). O build gera `precache.json` (todos os arquivos) e carimba a versão do cache no `sw.js`
  (plugin `offline` em `vite.config.ts`). O service worker guarda na instalação só as páginas e os
  arquivos pequenos; o kernel `.wasm` (~23 MB, 7 MB comprimido) é guardado quando o WJCAD termina de
  carregá-lo (mensagem `guardar`, reaproveitando o cache HTTP: nada é baixado duas vezes). Não editar
  a versão do cache à mão. Versão nova publicada com o app aberto: faixa "Versão nova do WJProMaster disponível → Atualizar"
  (`src/comum/atualizacao.ts`, `registrarComAtualizacao` em todas as páginas; confere ao voltar para o app e a cada 30 min).
- **Várias janelas** (`src/comum/janelas.ts`): com um documento aberto, abrir/criar outro (peça, montagem, desenho, do
  cofre ou do aparelho) vai para uma janela nova. Salvamento automático e vínculo com o cofre ficam por janela
  (`chave@<id>`, id em `window.name`) além da chave comum (usada para passar documento entre apps, `#abrir-autosave`).
  Montagem e desenho se atualizam do cofre ao voltar para a janela (`visibilitychange`). Planos padrão começam ocultos.
- **Booleanas do OpenCascade (aprendido no WJGoldDiamond)**: usar `BRepAlgoAPI_*` com `SetArguments/SetTools`
  (várias ferramentas de uma vez, podem se cruzar) e conferir o resultado pelo volume (`segura` em
  `src/joia/geometria.ts`); compostos sobrepostos e a simplificação do replicad quebram sólidos sem erro.
  Evitar **arestas exatamente coincidentes** (ponta de tubo = esfera, tubo espelhado encostando no eixo, plano
  passando por aresta do perfil): aparar 0,6·r ou folgar 0,02 mm deixa 3–5× mais rápido e correto.
  Superfícies analíticas (toro, cilindro, plano) são bem mais rápidas que B-spline (loft) nos cortes.
  Fio de Ø variável: varredura com `Law_Linear` (`genericSweep` com `law`), não loft (autointercepta em voltas fechadas).
- **Malha × B-Rep (WJGoldDiamond J8)**: escultura fica em malha; para peso/área/STL a joia do OpenCascade é
  tesselada (`mesh`, tol. 0,01 mm; volume ~0,5 % abaixo do exato), soldada (`Mesh.merge`) e unida no
  `manifold-3d` (centenas de ms). Não unir malha densa no OpenCascade (milhares de faces = minutos).
  `manifold-3d` entra com `overrides` no `pnpm-workspace.yaml` cortando as dependências do editor CAD do pacote
  (gltf-transform, sharp, esbuild-wasm…): só `manifold.js` + `manifold.wasm` são usados.
- **WJVideoMaker — armadilhas (08/11/2026):** o `AudioSampleSource` da `mediabunny` exige taxa e canais
  constantes (a opção `transform` não aceita taxas que mudam): todo áudio passa pelo `Reamostrador`
  (`src/video/audio.ts`, 48 kHz estéreo, com a velocidade). O Chromium de testes recusa nome com acento
  no OPFS (`TypeMismatchError`): gravar com nome interno ASCII e renomear o `File` ao entregar. No
  Playwright, um toque logo depois de um arraste com o dedo (< ~0,5 s) não gera `click` (Chrome móvel):
  pausar no roteiro. Guardar `FileSystemDirectoryHandle` do OPFS no IndexedDB derruba o Chromium de
  testes (no tablet funciona). Carregar a `mediabunny` de dois caminhos na mesma página dá aviso de
  "carregada duas vezes": nos testes, gerar/conferir mídia numa aba à parte.
