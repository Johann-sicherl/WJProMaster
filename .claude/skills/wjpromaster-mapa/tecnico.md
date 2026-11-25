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
| WJCalcEng | `calceng/` | `src/calceng/` | `src/calceng/cg2d.ts` (`teste-calceng.ts`) | `.wjcalc` (pasta Cálculos do cofre), autosave `wjcalc:documento`; calculadora 1 = centro de gravidade 2D: o desenho é o **esboço do WJCAD** (`EditorEsboco`, faixa Sketch, `Viewport.definir2D`), cada região fechada = figura; painel direito = massa única ou por figura, CG, inércia; demais calculadoras (álgebra, matrizes, física) em `src/calceng/calculadoras.ts` (campos + resolução passo a passo, `calcs[id]` no arquivo), catálogo e lupa em `modulos.ts`; cálculo simbólico próprio (sem biblioteca: os passos são o objetivo) em `expressao.ts` (racionais exatos, simplificação canônica, impressão texto/HTML/LaTeX) e `calculo.ts` (derivada com regras, integral com tabela/substituição/partes/frações parciais, **primitiva sempre conferida derivando**); campo `tipo: "expressao"` com prévia e teclado matemático |
| WJGoldDiamond | `joia/` | `src/joia/` | `src/joia/regras.ts` + `gemasLivres.ts` + `geometria.ts` (`teste-joia.ts`) | `.wjgd` (pasta Joias do cofre), autosave `wjgd:documento`; construtores de joia (aro, cabeça, pavé, gravação, textura, fabricação, preço) no mesmo kernel OpenCascade, worker próprio |
| WJSlicer3D | `slicer/` | `src/slicer/` | `fatiar.ts`, `caminhos.ts`, `campo.ts`, `planejador.ts`, `malha.ts`, `perfis.ts`, `orcamento.ts`, `proposta.ts` (`teste-slicer.ts`, `teste-orcamento.ts`; tablet: `roteiro-slicer.cjs`, `roteiro-orcamento.cjs`) | sem documento: lê STL do cofre (pasta CAD), do aparelho ou do WJCAD (`transferir.ts`, chave `slicer:peca`, malha em Y para cima, soldada e posta em pé no worker); preferências em `localStorage["wjslicer:preferencias"]` (impressora fora da lista volta à P1S; suporte antigo sim/não vira o tipo do perfil). Fatiamento real próprio, sem G-code (15/11/2026): cada camada vira **campo de distância com sinal numa grade** (célula ≥ 0,15 mm, ≤ 200 mil células, mapas em bits ≤ 48 MB) → paredes = curvas de nível (marcha dos quadrados), preenchimento = linhas/curvas recortadas pelo campo e pelas classes das células (topo/fundo pelas N camadas vizinhas em palavras de 32 bits, ponte, esparso pequeno vira sólido), âncoras junto às paredes; suporte por mapas (ângulo-limite, folgas Z/XY, interface, só na mesa) ou galhos de árvore; planejador com jerk por eixo, passadas para trás/frente, a2d do Klipper, tempo mínimo de camada desacelerando a extrusão. **Cores (16/11/2026)**: pintura por triângulo (0–3), cor de cada célula da camada = trecho pintado mais perto (duas varreduras em chanfro), faces horizontais pintadas semeiam as camadas de topo/fundo só além de `paredes×largura+0,3 mm` da parede (a borda segue as laterais); caminhos cortados onde a cor muda e agrupados por cor (começa pela ferramenta do bico, termina numa cor da camada de cima); troca = tempo + purga/vazão (parte `troca`), torre = anel de estabilização até a última camada com troca (parte `torre`); material por cor com densidade e R$/kg do filamento (o 1º segue "Impressora e material"). Vista com malha **sem índice** (cor por triângulo; `faceIndex` = triângulo); caneta/mouse pintam num listener de captura no contêiner (antes do OrbitControls), dedo navega. Projeto `.wjslc` (face `slicer` do cofre, pasta "Impressão 3D") guarda a malha em binário gzip dentro do JSON; abrir do cofre passa pelo `localStorage["wjslc:documento"]` + `#abrir-autosave` (limite ~5 MB do navegador: projetos enormes não abrem por esse caminho). Valores de fábrica da troca (purga 280/250 mm³, 35/50 s) são estimativas típicas a confirmar. **Armadilha**: no laço do campo, funções internas que alteram variáveis capturadas deixam o V8 10× mais lento (laço escrito sem elas); plano de corte do Three.js fica nas coordenadas do mundo (Y para cima) **Orçamento (S3, 16/11/2026)**: contas da MATRIZ_V01 em `orcamento.ts` — lucro é **markup sobre o custo** (preço = custo × fator; 1,8 = 80 %), `ARREDONDAR.PARA.CIMA` em 2 casas (`subir2`, com arredondamento a 1e-6 contra ruído de ponto flutuante), lucro bruto por mesa, líquido = bruto − 30 % ("oferta"), dias = horas ÷ 20, "% matriz" = líquido ÷ preço da faixa Variável (referência fixa `$E$9` da planilha: replicado e rotulado). Conferido contra a planilha recalculada no LibreOffice (openpyxl muda E1/E2/E3/J2/E5; `soffice --headless --convert-to xlsx`). **Todas as linhas guardam os valores** (custo, lucro, unidade, nome): mudar/desativar item na biblioteca não mexe em orçamento feito. Linhas da impressão têm `chave` (`fil:<cor>`, `maq:energia`, `maq:desgaste`): `sincronizarImpressao` só atualiza a quantidade (e traz de volta as tiradas com `restaurar`). Orçamento no projeto `.wjslc` (`config.orcamento`) e em `localStorage["wjslicer:orcamento"]`. **Biblioteca = um arquivo `Biblioteca de custos.wjcus` em Impressão 3D** (`lerArquivoFixo`/`gravarArquivoFixo` em `cofre.ts`: publicado, sem GO-OUT, substitui sem versões; extensão **fora** de `EXT_DA_FACE`/`APPS` de propósito, senão abrir a biblioteca como projeto ligaria o arquivo ao app e o próximo salvar de projeto a sobrescreveria); cópia em `localStorage["wjslicer:biblioteca"]`; **a mais recente (campo `mod`) vence e aparelho sem cópia tem `mod` vazio, então o cofre vence** (bug pego no roteiro: a de fábrica, "mais nova", sobrescrevia o cofre). WJERP: `importarDoErp` lê a loja `itens` do banco `wjerp` (só abre se o banco existir) e atualiza pelo `codigo`. Proposta: `proposta.ts` gera `.wjdoc` (HTML) no modelo do .docx do Johann, salvo em Documentos › Propostas (`gravarArquivoFixo`, nome repetido vira versão); imagens só `data:image/(png|jpeg)`; vista isométrica = `isometrica.ts` (WebGL fora da tela, JPEG); vistas do WJCAD: `Viewport.capturarVista()` (JPEG sobre branco, antes da tríade) → `deixar("slicer:vistas")` (lista acumulada). **DOCX**: `src/documento/docx.ts` — zip "armazenado" próprio (CRC-32), `gerarDocx(blocos)` puro, `htmlParaBlocos(HTML)` no navegador; validado abrindo no LibreOffice (PDF). A janela do cofre/diálogo do `casca.janela` tem z-index 40: telas cheias do orçamento ficam em 30 |
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
- **Perfil de dispositivo** escolhido na janela inicial (Celular / Tablet / Computador; trocar na
  ⚙ Configurações → Dispositivo): cada perfil mostra só as adaptações do seu operador. Celular: ícones
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
  **GO-IN com comentário** (10/11/2026): `janelaGoIn` (comentário + manter) → `goInLocal` (versão criada na
  hora; devolve `sincronia`, a publicação nas cópias) ou `goIn` (espera tudo, WJPDM); `goInComJanela`
  junta janela + `antes` (salvar o que está na tela; a sincronia desse salvar fica adiada, `sincroniaAdiada`).
  **Abrir no WJCAD** (`abrirArquivoNoApp` → `perguntarModoDeAbrir`, regra pura `modoDeAbrir`): GO-OUT ou
  consulta; em consulta, `salvarNoCofre` das faces `cad/asm/drw` pede o GO-OUT antes. Montagem: situação
  de cada peça em cache (`situacaoNoCofre`, atualizado por `aoMudarCofre`) para o menu abrir na hora;
  painel com `opcoes.componentes`. **Armadilha (GO-IN travado, 10/11/2026)**: a renovação do Google no
  `pointerup` (`sincroniaAutomatica`) e o clique do GO-IN pediam a janela juntos; o Google responde a um só
  e a promessa do outro nunca terminava, prendendo a fila de sincronia e o painel esmaecido. Agora
  `pedirAcesso` é `pedidoUnico` (um pedido por vez, prazo de 2 min, desiste 4 s depois de o app voltar ao
  foco sem resposta) e a sincronia espera a renovação no máximo 150 s (`comPrazo`). Roteiros:
  `scripts/roteiro-cofre-goin.cjs [primeiro|nenhum|normal]` e `scripts/roteiro-cofre-montagem.cjs`.
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
- **O cofre manda nas cópias** (15/11/2026, decisão do Johann: ele não mexe mais no Drive à mão; saiu o
  `src/pdm/espelho.ts` dos #122/#125 — `lerEspelho`, aviso "Cofre atualizado pelo Drive", "Mudanças no Drive"):
  `gravarVisiveis(i, lerBlob)` regrava os visíveis como o cofre está. Ficou do #122: no Drive, pastas e
  "(versões)" **pelo id guardado** (`pastas.json` formato 2; o antigo é migrado), mover/renomear por PATCH
  (`colocar`), **nada de DELETE** (lixeira do Drive, blobs também). `RepositorioPasta` só compara com o
  `visiveis.json` (sem varrer o disco).
- **Zerar cofre** (15/11/2026): `Indice.cofre = {id, zeradoEm}` (`indiceZerado`); `escolherIdentidade` dá a vitória ao
  zerar mais recente; índices de outra identidade ficam fora da mescla e a cópia recebe o índice novo (blobs
  apagados pela limpeza normal, visíveis pela lixeira/remoção) → `ResultadoSincronia.zeradas`. Banco do
  aparelho guarda a identidade em `meta/identidade` e **recusa** índice de identidade mais antiga
  (`ERRO_COFRE_ZERADO`, a sincronia para: sincronia de outra janela iniciada antes do zerar não traz o antigo de
  volta). Índice nulo (cópia nova) nunca conta como zerada. `zerarCofre()` em `cofre.ts` (na fila, dentro do
  toque) e evento `EVENTO_ZERADO` (WJPDM recarrega e avisa). Vínculos `wjpdm:vinculo:*` são esquecidos.
- **Importar pasta/arquivos** (15/11/2026): plano puro em `src/pdm/importar.ts` (`planejarImportacao`: pastas
  reaproveitadas pelo nome, repetidos contados e decididos numa escolha só; `registroImportado`: v1 publicada
  ou versão seguinte; mídia substituída troca o conteúdo). `Arquivo.midia` tira a pasta "(versões)" em
  `visiveisDoIndice`. Pasta pelo `showDirectoryPicker` (não entra em .wjpdm/"(versões)"; conta como 1
  ignorado) ou `<input webkitdirectory>`.
- **Login do Google** (15/11/2026): trava `wjgoogle:trava` (dono = id da janela, 120 s), token válido de outra
  janela dispensa a janela, quem chega com a trava ocupada espera o evento `storage`; `login_hint` com
  `wjgoogle:conta` (lida de `drive/v3/about` depois do 1º token) e `prompt: "none"` (falhou → `wjgoogle:interacao`
  e a próxima abre normal); renovação automática do primeiro toque: 1 a cada 10 min entre todas as janelas
  (`wjgoogle:ultimaAuto`); registro `wjgoogle:aberturas` (200) → WJPDM › Ferramentas › Login do Google.
  **Armadilha do Drive simulado**: conteúdo vs. metadados se distingue pelo caminho `/upload/`, não pelo
  Content-Type (o índice é JSON).
- **Arquivo órfão** (12/11/2026): `mesclar` deixa a exclusão de uma pasta vencer sem olhar os arquivos postos
  nela em outra cópia (corrida entre aparelhos, ou versão antiga do app): o arquivo ficava com `pasta` de id
  inexistente — `caminhoDoArquivo` cai na raiz (Drive o publicava lá) e o WJPDM, que lista por `a.pasta === id`,
  não o mostrava. `sincronizar` chama `recuperarOrfaos` depois da mescla e do espelho: leva para "Recuperados"
  (id fixo `recuperados` ou pasta de raiz com esse nome), histórico, `ResultadoSincronia.recuperados` → `resumo`.
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
Referências a faces/arestas: **nome persistente** pela história (15/11/2026, `src/kernel/nomes.ts`): a extrusão
registra, a cada reconstrução, a superfície de cada face da ferramenta com o nome `<recurso>:<entidade|inicio|fim|fim2>`
(laterais casadas com as linhas/arcos do esboço pela geometria; tampas pela posição na normal); a face da peça
que está sobre essa superfície (mesmo plano/cilindro, centro dentro da caixa da face gerada) é a do nome — vale
depois de booleanas sem precisar do histórico do OpenCascade. Aresta = par ordenado de nomes das faces vizinhas
(`arestasDaFace`). `acharFace`/`acharAresta` (`topologia.ts`) usam o nome só se a peça foi feita NESTA
reconstrução (`RegistroNomes.conhece`: o registro é global e outra peça teria ids iguais); senão a assinatura.
Achada a referência, a assinatura guardada é atualizada no lugar (nome novo + geometria) e anotada
(`alteradas`, com o JSON de antes); `atualizacoesDoDocumento` devolve os caminhos e a interface grava só se o
documento ainda tiver o valor de antes (`aplicarAtualizacoes` em `main.ts`). Esboço com referências do modelo:
`acompanharExternas` resolve no kernel (solver PlaneGCS carregado no worker; `definirSolverEsboco` nos testes),
movendo a referência em passos de ~2 mm a partir da posição ANTIGA (partir da nova espelha a cota sem sinal);
com isso a interface não refaz as externas pela topologia final (`externasNoKernel`).

## Observações técnicas

- **Pedido C4 (15/11/2026): cotas do recurso, calculadora em todo campo e linha sobre a aresta da peça.**
  **Armadilha corrigida**: Mover corpo e Escala refazem todas as faces; o `RastreadorFaces` as dava ao recurso
  que move (ou a ninguém, na Escala) e o duplo toque no corpo mostrava só ΔX, nunca o D1 da extrusão. Agora o
  recurso põe o movimento em `ctx.transporte` e `rastreador.transportar` acrescenta a cada recurso anterior as
  cópias movidas das faces dele (as originais ficam: corpos que não se moveram; limite de 20 000 faces × cópias).
  Rótulos sem faces próprias não somem mais em silêncio: `lugarDasCotas` (`src/cotasRecurso.ts`) tem reservas
  (esboço — a extrusão vai na ponta —, referência, itens usados, meio da peça) e o aviso diz quem ficou sem lugar.
  Valor digitado no modelo segue o **campo do painel** (`limitesDoCampo` lê `min`/`max` de `esquemaDe`; instâncias
  inteiras ≥ 1). Calculadora: `src/comum/calculadora.ts`; em modo automático o campo é **envolvido** com o botão
  (`.calc-envolve`, ocupa a célula da grade; botão solto quebrava grades) e o passo "− campo +" fica de fora (não
  cabe); o botão abre no **pointerup** (sobre a vista 3D o toque não vira `click`); a calculadora fica em
  `z-index: 10000` (abria atrás das janelas). Linha sobre a aresta: `aplicarAutoModelo`/`previaLinhaSobreModelo`
  em `relacoesAuto.ts` (puros), arestas projetadas em cache no editor (`arestasDoModelo`).

- **Caixa de seleção ativa e seleção rápida de arestas** (15/11/2026): `campoInicial` (primeira caixa vazia; sem
  vazia, a 1ª de um item só listada em `comPadrao` — o valor de fábrica posto por `criarRecurso`, ex.: Superior do
  Plano, Direito do Espelhar) e `proximoCampo` (próxima vazia depois da cheia, depois volta ao começo) em
  `src/ui/caixasSelecao.ts`; pulam aba fechada, caixa escondida e caixa opcional desmarcada. Seleção rápida do
  Filete/Chanfro em `src/selecaoArestas.ts`, **sem kernel**: vizinhança face↔aresta por `topologia.arestasDaFace`,
  corpo por vizinhança, côncava/convexa pela malha da vista (normal dos vértices sobre a aresta + centro do
  triângulo mais próximo de cada face; tangente < 5° fica de fora), em cache por malha. As opções viram
  referências **no toque** (a prévia muda a topologia logo depois) e deixam de fora as arestas das faces do
  próprio recurso em edição (só existem na prévia). **Armadilha corrigida**: o `RastreadorFaces` media a face
  curva nova contra o **sólido** anterior (ponto dentro do sólido = distância 0) e a face do filete / a parede do
  furo do Corte passava por "recortada" (sem dono em `facesPorRecurso`); agora mede contra as **faces** antigas
  (`makeCompound` de **cópias** — o replicad apaga as faces que recebe).

- **WJTaskPlan: prazo da etapa ≤ prazo da tarefa** (10/11/2026, `src/tarefas/regras.ts`): `adicionarEtapa`,
  `prazoEtapa` e `mudarPrazoTarefa` recusam o conflito sem `escolha` (`EscolhaPrazo`: "trazer" as etapas para o
  prazo da tarefa / "estender" a tarefa até `maiorPrazoEtapas`); `conflitoPrazos` simula a mudança pedida e dá
  afetadas + prazo da tarefa + maior prazo para o alerta; `resolverPrazos` corrige o dado já errado (nunca
  corrigido na carga nem na `mesclar`). A interface (`main.ts`: `escolherPrazo`, um alerta só para tarefa,
  etapa e selo; `corrigirPrazos`) só pergunta; a janela da tarefa usa um rascunho `ComEtapas` com as mesmas
  funções. **Ordem das etapas**: `ordenarEtapas` (estável; sem prazo no fim; etapa que mudou de data vai para o
  fim do grupo da nova data) roda em toda mudança de data, em `validarBase` e em `mesclar` sem mexer em
  `atualizado`; `moverEtapa`/`podeMoverEtapa` só trocam dentro do mesmo grupo de data. Etapas feitas não saem
  do lugar.
  **Armadilha**: `<input type="date">` no computador dispara `change` com ano parcial ("0002-…") enquanto se
  digita — a janela da tarefa só confere o prazo com ano ≥ 1900 (`dataCompleta`) e confere de novo no OK.
- **Mesclar / fusão** (10/11/2026, `src/kernel/regenerar.ts`): toda união de "mesclar" passa por `fundir()`
  (`aplicar` e Espelhar corpo). A fusão comum do OpenCascade já une face com face; só quando a ferramenta
  sobra solta (mais corpos que antes) tenta `BRepAlgoAPI_Fuse` com `SetFuzzyValue(FOLGA_NUMERICA = 0,001 mm)`
  e aceita se o volume não mudar. Depois de cada recurso de `mesclaNaPeca`, se o nº de sólidos subiu,
  `avisoCorpoSeparado` mede a distância (`BRepExtrema_DistShapeShape`, até 12 corpos) e grava em
  `ResultadoRegeneracao.avisos` (não é erro; árvore `.com-aviso`, painel `.prop-aviso`, status "N avisos").
  **Armadilha** (TAMPA_JANELA do Johann, modelo de teste `scripts/modelos/tampa-janela.wjcad`): plano a partir
  de face com origem no centro da face anda quando a face muda e leva junto o perfil sem relações (0,033 mm
  de folga → corpo separado). Planos novos: `origemFixa`.
- **✓/✕ da ferramenta do esboço** (10/11/2026, `editor.ts` `confirmarFerramenta`/`cancelarFerramenta`, barra
  `.esb-ferr-barra` em `painel.ts`): `definirFerramenta` guarda `JSON.stringify(esb)` ao trocar de ferramenta
  (mudar só o tipo não reinicia); o ✕ restaura no mesmo objeto (`Object.assign`, o `doc` continua apontando
  para ele) e grava passo de desfazer. `COMANDOS_SELECAO` decide Esc = ✕. Canto da vista: classe
  `modo-esboco` em `#canto-confirmacao` (`rotularCantoConfirmacao` em `main.ts`). **Armadilha:** o 1º toque
  numa cota refaz a etiqueta, então o `dblclick` do navegador nunca chega: o duplo toque é medido por tempo
  (`ultimoToqueCota`, 450 ms).

- **Referência oculta do esboço** (10/11/2026, `src/esboco/externas.ts`): `GeoEsboco.oculta` marca a geometria
  externa criada para cota, linha de espelho ou direção de padrão (`criarExterna(..., true)`). Fica fora de
  `visual.ts` (traço e pontos), `achar`/`encaixar` do editor, `idsNaSelecao`, relações automáticas, lista de
  relações (o "fixo" dela) e perfil (`encontrarLacos`, `cadeiaAberta`, chapa). **Armadilha:** oculta e
  visível nunca se reaproveitam (`externaExistente(..., oculta)`): selecionar a aresta para relação revelaria a
  referência da cota. Esboço antigo: `ocultarRefsDeCota` ao abrir no editor. `achar` dá prioridade ao que não é
  externo; `toqueSelecionar` alterna esboço ↔ peça no toque repetido; `caixaNoComando` liga a caixa no
  Espelhar/Deslocar/Padrões. `window.__cad.editor()` (só em dev) expõe o editor aos roteiros.
- **Relações automáticas do esboço** (10/11/2026, `src/esboco/relacoesAuto.ts`): a prévia (símbolo no cursor)
  usa só geometria, a cada movimento; ao soltar, `tentarRelacao` resolve com e sem a relação e só a mantém se
  o grau de liberdade cair sem conflito nem redundância nova (senão desfaz e devolve as posições). Colinear
  com linha ligada é redundante no PlaneGCS (o ponto comum já está na reta): vira Paralela. **Armadilha:** os
  objetos de `mapaPontos` são os pontos vivos do esboço (com `id`); espalhar um deles num arrasto
  (`{ id, ...ponto }`) troca o id e arrasta o ponto errado — copiar só `x`/`y`.
- **Canto do filete/chanfro por grupo** (10/11/2026, `operacoes.ts` `grupoCoincidente`): o canto é o conjunto
  de pontos ligados por Coincidente ponto-ponto; ao aplicar, só as pontas das duas linhas são unificadas
  (`unificarCanto`), e a coincidência com a origem continua relação (o canto virtual segue preso nela).

- **⚙ Configurações do WJCAD** (`src/ui/configuracoesCad.ts`): itens declarativos por seção (`itensDaSecao`:
  escolha, interruptor, passo, botão, nota) e um adaptador por ambiente (`ler`/`mudar`/extras). A Peça grava
  no objeto `prefs` dela (senão o próximo `salvarPrefs` apagaria a mudança); Montagem e Desenho usam
  `gravarPrefsCad` (junta campos, não apaga os da Peça). Outras janelas seguem pelo evento `storage`
  (`aoMudarPrefsCad`); a Peça só reaplica a interface se dispositivo/toque longo/caixa mudaram (não refaz o
  painel do comando à toa). Opção nova = um item na seção certa.
- **Roda do mouse** (`src/ui/preferenciasCad.ts`): 1 clique = 100 px de `deltaY` (linha ×16, página ×100). Vista
  3D: `OrbitControls.zoomSpeed = ln(1 − passo)/ln(0,95)` (5 % = 1, o comportamento antigo) e o sentido invertido
  troca o sinal em `_customWheelEvent` (sobrescrito na instância, em `viewport.ts`; conferir ao atualizar o
  three). Ctrl + roda (pinça do touchpad) não inverte. Folha do Desenho: `ampliacaoDaRoda`. A escala 1:1 desliga
  `enableZoom`. Roteiro de navegador: `scripts/roteiro-configuracoes.cjs`.

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
- **Dividir com regiões (10/11/2026)**: `cortarPorFaces` em `regenerar.ts` usa um `BRepAlgoAPI_Splitter` só (todas as
  faces de corte de uma vez) e confere a soma dos volumes (o par intersect/cut com prisma no sólido facetado de STL
  devolvia lascas de 0,0007 mm³ sem erro). Regiões casadas por assinatura em `casarRegioes` (um para um, tolerância
  0,5·∛V); desmarcadas do mesmo corpo original são unidas com `fundir`. As malhas das regiões (destaque do painel)
  saem só na prévia (`ctx.previa`) e **antes** do `makeCompound`, que apaga as formas de entrada.
- **STL → sólido**: o STL do Johann (HeadPhones Holder, 16 286 triângulos, fechado) vira sólido válido em 12 s na forma
  exata; simplificado para 10 000 fica **inválido** (+2 % de volume, corte perde metade). Por isso a janela "STL grande"
  e o "Converter em sólido" do Dividir oferecem a forma exata (até `LIMITE_SOLIDO_EXATO` = 50 000) e o kernel avisa
  sólido de STL inválido (`BRepCheck_Analyzer`). Tempos nessa peça (Node): reconstruir só o importado ≈ 8,6 s (malha
  e topologia de 14 784 faces); Mover corpo 16 s → 2,3 s e Dividir ≈ 3,6 s depois do índice por plano no
  rastreador de faces (`facesRecurso.ts`) e do plano da face sem `f.center`.
- **Gemas livres (WJGoldDiamond J9a, 21/11/2026)**: hastes = **cápsulas por revolução** (`capsulaRev`, um sólido
  só) com raios levemente diferentes nas juntas (esferas concêntricas iguais = faces coincidentes): a união das
  garras do modelo caiu de 10,6 para 3,9 s. Assento das gemas livres em **polígono de 16 lados** (plano × cilindro é
  analítico; spline × cilindro não): corte 7,4 → 4,0 s. Cortar as garras à parte e unir depois ficou **pior** (54 s:
  as faces do assento ficam no mesmo plano no corpo e na garra). Lascas soltas do corte (< 0,5 mm³) saem em
  `semLascas`. Aro dividido com **afastamento**: cunha do topo cortada + loft do meio perfil de cada lado
  (recuado 0,01 mm, passando 3° para dentro do aro). Modelo "Anel folhas com oval": 22,5 s em Node, ~26 s no
  navegador do teste (prévia na hora).
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

## Escala real 1:1 na vista 3D (21/11/2026)
- Câmera ortográfica com frustum em pixels: `camera.zoom` = px CSS por mm; escala real = `zoom = lerPxPorMm()`.
  `Viewport.travarEscala(px, plano, giroLivre)`: no esboço `giroLivre=false` (sem giro); na vista 3D `true` (só zoom travado).
  Guarda `zoomAntesEscala` e volta a ele ao soltar. `aplicarEscalaReal()` (main.ts) decide esboço × vista 3D; `sairEsboco`
  chama de novo. Estado 3D em `sessionStorage` (por janela), declarado logo após `new Viewport` (evita TDZ).
- `enquadrar()` travado na vista 3D só recentra (último ponto tocado via raycast no `pointerup` curto, senão centro da peça).


## Biblioteca de componentes de fixação (21/11/2026, pedido C2)

- Código em `src/biblioteca/` (puro, sem DOM exceto `painel.ts`): `dados.ts` (tabelas; `conferencia` "norma" ou "aproximada"),
  `gerar.ts` (Documento WJCAD por forma; `Construtor` de extrusões no plano XZ e revoluções no XY em torno do eixo Y),
  `encaixe.ts` (furos, entrada, pose, mates, furos iguais, comprimento sugerido), `busca.ts`, `painel.ts`, `cofre.ts`.
  Ligação na Montagem: `abrirBiblioteca`, `tocarFuroBiblioteca`, `encaixarNoFuro` em `src/montagem/main.ts`.
- Convenção: **eixo Y**, apoio em y = 0 (cabeça/porca/arruela em +Y, haste em −Y). Os mates usam o eixo `Y` e o plano `XZ` de
  referência da peça (`{tipo:"eixo",id:"Y"}`, `{tipo:"plano",id:"XZ"}`): "alinhado" na coincidência (o +Y do fixador = normal da face de apoio).
- **Armadilhas**: (1) o índice de uma face na malha é a **posição da trinca** em `malha.faces` (início, quantidade, id) — não o terceiro
  valor; (2) "furo" = cilindro com a normal da malha apontando para o eixo (a assinatura da face não diz se é côncava); (3) o primeiro
  componente da montagem entra **fixo** — o solver move o fixador; (4) rosca real vem do recurso `rosca` com a face descrita pela
  geometria (cilindro Ø d), sem regenerar antes; (5) `gravarArquivoFixo` aceita `cartao` para o cartão do cofre já nascer preenchido;
  (6) só arruelas e porcas empilham (`propriedades.grupo`): a cabeça do parafuso não.
- Roteiro de tablet: `scripts/roteiro-biblioteca.cjs` — a montagem de teste precisa de **GO-OUT** gravado no arquivo, senão o app abre a
  pergunta "GO-OUT ou consulta" e o roteiro espera para sempre.

## Gerador de engrenagens (25/11/2026, pedido C3)

- Motor puro `src/biblioteca/engrenagens.ts` (geometria, contornos como `Trecho[]` = curva por pontos exatos / linha / arco, pares,
  `poseDoPar` com `quatDeBase`), sólido `src/kernel/engrenagem.ts` (`solidoEngrenagem`), painel `painelEngrenagens.ts` (caixas do
  `formulario.ts`, usadas no recurso da Peça e na aba da Montagem), cofre `pecaDeEngrenagem`. Recurso `engrenagem` em `model.ts`
  (`ParamEngrenagem` achatado no recurso; `PARAM_ENGRENAGEM_PADRAO`).
- **Armadilhas**: (1) `makeBSplineApproximation` com grau até 6 desvia ~5 µm entre os pontos; **grau 3** com 24 pontos dá nanômetros;
  (2) arestas retas/arcos são ligadas às **pontas reais** das B-splines (senão `assembleWire` dá "disconnected wire");
  (3) `twistExtrude` do replicad não aceita sentido: torção própria com `makeHelix(..., lefthand)` como espinha auxiliar
  (hélice à direita = θ diminui ao subir em +Y); (4) booleanas com centenas de faces helicoidais custam 5–10 s: interna = face com furo
  (`addHolesInFace`) ou cascas + `makeSolid`; sem-fim = seção em espiral de Arquimedes torcida; (5) varredura com lei de escala
  (`complexExtrude`) aproxima as superfícies (espessura 1 % menor): cônica por **loft regrado**; (6) no Tredgold o ângulo desenvolvido
  vai de −passo até 2π·cos δ: desenrolar o `atan2` pelo ponto anterior; (7) medir espessura por casca fina ∩ sólido precisa de altura ≥ 1 mm
  (fatia de 0,02 mm erra 1 %); (8) `shape.rotate/translate/intersect` do replicad apagam o original: `clone()` antes de reusar.
- Montagem: com a aba Engrenagens aberta, o toque no modelo marca/desmarca componentes (até 2); o par fica preso por **Travar** (refs
  `{tipo:"eixo",id:"Y"}` das duas peças, `rel` = pose relativa). `window.__asm.selecionar(ids)` (só em DEV) para o roteiro.
