# Regras do WJProMaster — o que já foi decidido (fonte única)

> Ler **antes de cada tarefa**. Tudo aqui foi decidido pelo Johann (dono do projeto, engenheiro
> mecânico, usuário avançado de CAD) ou já está entregue e testado. Não deduzir além disto: se um
> pedido não estiver coberto, **perguntar** (regra 3). Quando uma regra mudar, atualizar este arquivo
> no mesmo PR. Detalhes campo a campo dos comandos do CAD ficam em `docs/funcional/`; a visão e o
> roteiro de cada face, em `docs/global/<face>.md`.
>
> Última consolidação: 12/11/2026 (mudanças feitas à mão no Drive/pendrive aplicadas sozinhas no cofre, só com aviso; arquivo sem pasta vai para "Recuperados"; mudanças feitas fora do app no Drive e no pendrive; antes, 10/11/2026: cofre no WJCAD, GO-IN com comentário, abrir com GO-OUT ou consulta).

## 1. Como trabalhar (Regras 001 e seguintes)

1. **Otimização e melhor UX**: propor o caminho mais simples, rápido e leve para o usuário e para o código.
2. **Discordar quando fizer sentido**: pedido sem lógica operacional ou que pese no projeto (desempenho,
   arquitetura, manutenção) → dizer claramente, explicar e propor alternativa antes de implementar.
3. **Perguntar quando houver dúvida real** de requisito, em vez de supor.
4. **Cautela e precisão**: validar cada mudança (testes, build, navegador quando for interface) e relatar
   o resultado com fidelidade (inclusive o que falhou ou não foi testado).
5. **Eficiência e desempenho**: código enxuto, nada pesado na thread da UI, sem dependências supérfluas.
6. **Publicação até o fim, sem trabalho manual do Johann**: `pnpm check && pnpm teste && pnpm build` →
   commit → push → PR para `main` → acompanhar → corrigir → **merge** → conferir o deploy do GitHub Pages.
   Ele não entra no GitHub nem no Cloudflare. Só parar para perguntar se algo exigir decisão dele ou acesso
   que a sessão não tem.
7. **Menor trabalho possível para ele acessar as atualizações** (04/11/2026): toda entrega pronta é
   publicada na hora, sem esperar pedido; ele só abre o app e toca **"Atualizar"** (faixa de versão nova).
8. **Tudo em português (Brasil)**: respostas, interface, documentação, mensagens de commit e as
   descrições dos comandos que o Claude executa (04/11/2026).
9. **Simular o tablet nas entregas** (03/11/2026): testes de navegador com Playwright em 1280×800,
   `hasTouch`, `isMobile` e perfil `{ dispositivo: "tablet" }` em `localStorage["jlscad:interface"]`
   (toque com `tap`/eventos de ponteiro `touch`/`pen`). Interface de computador testada também quando o
   recurso for de mouse.
10. **Resposta ao fim de cada entrega** (10/11/2026): resumo curto (o que entrou, como usar, pendências) e
    o link do PR; **código completo só quando ele pedir** (aí o arquivo/bloco inteiro, não diff parcial).
    O código fica completo no PR; imprimir no chat gasta tokens sem acrescentar qualidade.
11. Gerenciador **pnpm** (nunca npm); dependência nova só com justificativa, de projeto conhecido,
    revisando o `pnpm-lock.yaml` (`minimumReleaseAge` de 3 dias, scripts de instalação bloqueados).
12. Segurança: nunca usar nem versionar a chave secreta do cliente OAuth do Google; nunca force-push;
    o PDF do guia do CAD de referência fica só no Drive dele (não versionar); arquivos de instalação e de
    terceiros não entram no repositório.
13. **Aprimorar todo pedido antes de agir** (07/11/2026): a resposta começa com um bloco curto
    **"Pedido aprimorado"** (objetivo, escopo, arquivos/especificação, critério de pronto, riscos ou
    alternativa melhor); depois o Claude repensa em cima dele (caminho mais simples? contradiz estas
    regras? dúvida real?) e só então executa. Pergunta simples: uma linha basta.
14. **Mapa do código** (07/11/2026): skill `wjpromaster-mapa` em `.claude/skills/` — `SKILL.md` (qual
    arquivo abrir por tipo de pedido, testes, validação no tablet, publicação, armadilhas) e `tecnico.md`
    (detalhes técnicos que saíram do `CLAUDE.md`). O mapa é injetado no início de toda sessão pelo gancho
    `SessionStart` (`.claude/settings.json`, 10/11/2026); sem ele no contexto, invocar a skill antes de explorar. Manter viva
    no mesmo PR; `scripts/teste-mapa.ts` (no `pnpm teste` e no CI) barra arquivo de `src/` ou teste fora
    do mapa e caminho citado que não existe.
15. **Qualidade acima de economia** (08/11/2026): qualidade e aprimoramento do software com o menor risco
    possível, tudo coberto por testes, boa experiência de uso e assertividade. Não se corta leitura de
    regras, testes nem validação para poupar tokens: este arquivo é lido inteiro a cada tarefa e a skill
    do mapa é invocada sempre; a economia vem só de ir direto ao arquivo certo.
16. **Várias sessões ao mesmo tempo** (08/11/2026): o Johann trabalha com vários chats no mesmo projeto.
    É seguro com estas regras (auditoria de 08/11: PRs #53–#92 sem nenhuma perda entre sessões):
    - **Um ramo por sessão**; nunca empurrar para o ramo de outra sessão nem mexer em PR aberto dela.
    - **Começar do `main` mais novo** (`git fetch origin main` e criar/atualizar o ramo a partir dele) e,
      **antes do PR, mesclar o `origin/main` de novo** e repetir `pnpm check && pnpm teste && pnpm build`.
    - Arquivos que todas as sessões editam (`regras.md`, `CLAUDE.md`, `README.md`, skill do mapa,
      `vite.config.ts`, `public/sw.js`, `package.json`, `src/inicio/inicio.ts`, `ChaveApp` em
      `src/comum/cofre.ts`): **só edições pontuais sobre a versão recém-baixada**, nunca reescrever o arquivo
      inteiro de uma cópia lida antes. Conflito: juntar as duas versões, nunca descartar a da outra sessão.
    - **PR só é mesclado com a verificação "Verificar PR" verde** (`.github/workflows/verificar.yml`: check,
      teste e build sobre o PR já juntado com o `main` atual) e **pelo número devolvido ao criar o PR**,
      com `expectedHeadSha` (nunca supor o número).
    - O `teste-mapa` barra página fora do Vite/`sw.js` e teste fora do `pnpm teste` (entrada apagada ao
      juntar trabalhos).

## 2. Inspiração sem cópia (vale para todas as faces)

- O fluxo e o comportamento do CAD seguem **o mais perto possível do SOLIDWORKS** (referência profissional
  do Johann): mesmos painéis, campos, opções, condições finais, mouse e atalhos.
- **Proibido**: código, ícones, logos, cores de marca, textos e nomes registrados de terceiros na UI
  (ex.: "FeatureManager", "CommandManager", "SOLIDWORKS", "Word"), formatos proprietários
  (.sldprt/.sldasm/.docx como formato nativo) e engenharia reversa.
- **Permitido**: conceitos genéricos (árvore, planos, tríade, cotas, relações, fator K…) e
  importar/exportar formatos abertos (STEP, STL, DXF, PDF, HTML, Markdown, CSV, XML MSPDI).
- Ícones: SVG próprios. Nomes da UI: nossos, em português.
- Nomes das faces são decisão do Johann (tabela no `CLAUDE.md`).

## 3. Aparelhos e entrada

- Roda em **celular, tablet (Android, Chrome/PWA) e computador**. Perfil escolhido na janela inicial
  (no WJCAD, trocar na ⚙ Configurações → Dispositivo; ⚙ Configurações na página inicial). Classe `disp-*` no `body`.
  - Celular: ícones sem texto, árvore/painéis em gaveta, dedo desenha.
  - Tablet: caneta + dedo, **alvos ≥ 44 px**, lupa de precisão.
  - Computador: botões compactos, mouse e atalhos.
- **Caneta desenha, dedo navega** (1 dedo orbita, 2 dedos zoom/pan). Sem caneta, o dedo também esboça.
- Mouse como nos CADs profissionais: esquerdo seleciona/desenha, **meio gira** (Ctrl+meio arrasta), roda
  aproxima no cursor, **direito abre o menu de contexto**. **Roda configurável** (10/11/2026, WJCAD):
  sentido ("Rolar para a frente aproxima" = padrão / "afasta") e **passo por clique de 2 % a 50 %,
  padrão 5 %, um valor só para Peça, Montagem e Desenho** (decisão do Johann: o Desenho, que dava ~14 %,
  passou a seguir o mesmo passo). No esboço em Escala 1:1 o zoom continua travado.
- **Toque longo** (0,6 s, configurável) de dedo ou caneta = botão direito (menu de contexto).
- **Sem gestos de mouse/caneta** (guia radial): o Johann não quer.
- Atalhos: Ctrl+1…8 vistas, Espaço orientação, F enquadrar, S barra de atalhos, Ctrl+B reconstruir,
  Enter/Esc OK/Cancelar, Ctrl+Z/Y/S; no esboço L, R, C, A, S, P, T, D, O, M, V, Delete.
- **Duplo clique = duplo toque** (dois toques no mesmo item em até ~0,45 s), em listas e no modelo.

## 4. Interface comum

- **Tema claro**. Vista sempre **ortográfica** (sem perspectiva). Y para cima no CAD.
- Layout: barra superior → faixa de ícones da aba → abas; árvore à esquerda; barra de vistas flutuante;
  tríade no canto inferior esquerdo; barra de status embaixo.
- **Árvore ajustável** em Peça, Montagem e Desenho: arrastar a borda alarga; botão recolhe/expande
  (lembra a largura).
- Fluxo de CAD profissional: selecionar faces/arestas mostra a **barra de contexto**; comandos abrem o
  **painel de comando à esquerda** (no lugar da árvore) com ✓/✕ e o **canto de confirmação** no viewport;
  campos rosa recebem a geometria tocada; esboços consumidos ficam aninhados no recurso; barra de
  retrocesso.
- **Planos padrão começam ocultos** em todos os ambientes (olho fechado na árvore; na Montagem a pasta
  "Planos e origem" tem olho para mostrar/ocultar tudo).
- **Início limpo**: o app abre sem documento (Novo/Abrir e recentes). Novo abre a escolha do ambiente.
- **Várias janelas** (04/11/2026): com um documento aberto, abrir/criar outro (peça, montagem, desenho,
  do cofre ou do aparelho) vai para uma **janela nova**; a atual não fecha. Salvamento automático e
  vínculo com o cofre são **por janela** (`chave@<id>`, id em `window.name`), além da chave comum.
  Montagem e desenho se atualizam do cofre ao voltar para a janela.
- Versão nova publicada com o app aberto: faixa "Versão nova do WJProMaster disponível → Atualizar".
- Número da versão ao lado do nome de cada app: `<package.json version>.<número da publicação>`.

## 5. Cofre (WJPDM) — onde ficam os arquivos de todos os apps

### 5.1 Salvar, GO-OUT, GO-IN
- **Todo arquivo de todo app vive no cofre do WJPDM** (`src/comum/cofre.ts`). Check-out/check-in se
  chamam **GO-OUT / GO-IN** na interface.
- **Primeiro salvar** (💾/Ctrl+S) de um documento: abre o **explorador do cofre** (§5.4) para escolher a
  pasta e o nome; o arquivo **já publica a versão 1** no dispositivo, no pendrive e no Google Drive (GO-IN
  automático) e segue em GO-OUT com quem salvou.
- **Todo salvar vai para todas as cópias** (06/11/2026, garantia pedida pelo Johann: o que se salva no
  computador abre no tablet e vice-versa): a cópia de trabalho em GO-OUT (e o arquivo nunca publicado)
  vai para o dispositivo, a pasta do dispositivo, o pendrive e o Google Drive, no **índice interno do cofre**
  (`WJPDM/.wjpdm`). Os **arquivos visíveis** do pendrive e do Drive (`WJPDM/<pastas>/<arquivo>` e as pastas
  "(versões)") **continuam mudando só no GO-IN** — o GO-IN é a publicação e cria a versão. No WJPDM há
  GO-IN da pasta inteira (com subpastas).
- Depois de salvar, a mensagem diz **onde o arquivo chegou** ("Chegou em: este aparelho, Pasta do
  dispositivo, Google Drive…"); se uma cópia ficou de fora ("⚠ Ainda NÃO chegou em: Google Drive"), a faixa
  "Cofre:" fica à vista e a sincronia automática tenta de novo sozinha. O explorador "Abrir do cofre"
  sincroniza ao abrir e atualiza a lista quando chegam arquivos de outro aparelho.
- Aba **Cofre** na lateral direita de cada app: dados do documento (pasta, estado, revisão, versão, GO-OUT),
  GO-OUT / GO-IN / Desfazer GO-OUT, as últimas versões com os comentários e "Meus arquivos em GO-OUT"
  (todos os apps) com GO-IN por item ou dos marcados. Terminado o GO-IN, o painel **volta na hora** com os
  botões do novo estado (a publicação nas cópias segue e a mensagem se atualiza); erro → mensagem clara e
  botões de volta.
- **GO-IN com comentário** (10/11/2026, mudança de decisão do Johann: antes era "GO-IN sem comentário"):
  janela com **comentário opcional** sobre o que foi feito e **"Manter em GO-OUT"**; o comentário vai para a
  versão criada e aparece no histórico de versões (painel Cofre e WJPDM). GO-IN dos marcados (e da pasta,
  no WJPDM): **um comentário para todos**.
- **Abrir no WJCAD pergunta** (10/11/2026): abrir arquivo do cofre na Peça, Montagem ou Desenho → a mesma
  janela: **"Abrir com GO-OUT (para editar)"** ou **"Abrir só para consulta"**. Já em GO-OUT com você: não
  pergunta. Em GO-OUT com outra pessoa: avisa e abre só para consulta. **Só para consulta: dá para olhar,
  mas salvar pede o GO-OUT antes.**
- **Montagem: cofre por componente** (10/11/2026): GO-OUT, GO-IN (com comentário) e Desfazer GO-OUT da
  montagem principal e de cada peça separadamente, pelo menu do componente (botão direito / toque longo) e
  no painel Cofre (a montagem e suas peças, cada uma com estado e botões). **Desfazer GO-OUT** descarta o que
  não foi publicado e volta à última versão, **pedindo confirmação**.
- **Fluxo de trabalho editável** (um por cofre; de fábrica: Protótipo / Pré-série / Série × em
  desenvolvimento / em produção / em revisão + Obsoleto; revisão por fase P1 → 01 → A). "Em revisão" =
  travado.

### 5.2 Cópias e sincronia
- Além do banco do aparelho, até três cópias com a **mesma estrutura** (`WJPDM/<pastas>/<arquivo>` legível
  + `WJPDM/.wjpdm/` com índice e versões; ao lado de cada arquivo, `<nome> (versões)/<nome> v<n>[ rev X].<ext>`):
  **pasta padrão do dispositivo**, **pendrive** e **Google Drive** (Meu Drive/WJPDM, escopo `drive.file`).
- Regras da sincronia (`src/pdm/sincronia.ts`): o que falta é copiado; registro alterado em duas cópias →
  **a alteração mais recente vence** e a outra vai para a lixeira; exclusões propagam pela lixeira (30 dias).
- **Pastas** (também as vazias) vão para todas as cópias. **Criar pasta** no explorador ou no WJPDM
  sincroniza na hora (05/11/2026); se o acesso ao Google tiver vencido, a janela do Google abre no toque
  de "Criar".
- **Mudanças feitas fora do app são aplicadas sozinhas** (12/11/2026, decisão do Johann: "o que eu fizer à mão
  no Drive é o modelo atual do cofre"; substitui a janela "Mudanças feitas fora do app" com Trazer/Desfazer):
  ao abrir qualquer app e a cada sincronia, renomear/mover/excluir feitos **direto** no Drive, no pendrive ou
  na pasta do dispositivo, nos arquivos e pastas **que o app criou** (Drive: pela identidade/id; pendrive e
  pasta: pelo conteúdo), entram **sozinhos** no índice do cofre, **sem janela de perguntas, só com aviso**:
  renomear/mover → Renomear/Mover com histórico "Renomeado/Movido no Drive"; excluído → **lixeira do cofre**
  (30 dias, versões preservadas), nunca destruído. Aviso único ao terminar: **"Cofre atualizado pelo Drive: N
  movidos, N renomeados, N para a lixeira"** com **"Ver detalhes"**.
  - **Exceções** (o app desfaz na cópia e avisa o motivo): arquivo em **GO-OUT com qualquer pessoa**; arquivo em
    estado **"não excluir"** (ex.: Série em produção) não é excluído.
  - **Fora do alcance (`drive.file`)**: pasta criada à mão e arquivo novo posto à mão não são vistos. Arquivo do
    cofre movido para pasta criada à mão: aviso **"crie a pasta pelo WJPDM"**; o arquivo fica onde estava no
    índice. Arquivos novos continuam entrando por **"Adicionar"**.
  - **Nunca aceito de fora**: `WJPDM/.wjpdm` (o app recria o que faltar), pastas "(versões)" (o app regrava) e
    **conteúdo editado fora do app** (ignorado: a cópia do cofre manda; com aviso).
  - Pasta excluída à mão só sai do cofre vazia (nenhum órfão novo). Mudou no app e fora ao mesmo tempo: **a mais
    recente vence**, a outra vai para a lixeira do cofre.
  - **Sem pastas duplicadas**: pasta procurada **pelo id guardado**, não pelo nome; remoção no Drive **sempre
    pela lixeira dele (trashed), nunca DELETE**.
- **Arquivo sem pasta vai para "Recuperados"** (12/11/2026, pedido do Johann): arquivo cuja pasta não existe
  mais no cofre (pasta excluída numa cópia enquanto ele entrava nela em outra) é levado a cada sincronia para a
  pasta **"Recuperados"** (raiz, visível no WJPDM), com histórico "Pasta original não encontrada", e a
  mensagem da sincronia avisa quantos. Nenhum arquivo fica invisível no WJPDM nem solto na raiz do Drive.
- **Reorganizar no WJPDM** (12/11/2026): Mover pasta inteira (menu da pasta) e mover vários arquivos marcados
  de uma vez (caixinhas / Ctrl+clique).

### 5.3 Ao abrir qualquer app (05/11/2026)
- Cada abertura ou recarregar de qualquer página (apps, página inicial, WJTaskPlan) **sincroniza o cofre**
  sem pedir nada e mostra a **faixa "Cofre:"** no topo com a situação de cada cópia:
  **Google Drive · Pasta do dispositivo · Pendrive** — ✓ conectado e igual / ! precisa de um toque /
  ✕ não encontrado ou sem internet / — não configurado.
- Tudo certo: a faixa some sozinha (5 s). Cópia configurada que ficou de fora (login do Google vencido,
  pendrive sem permissão ou desconectado): a faixa fica com **"Conectar agora"** (um toque libera e
  iguala tudo) e **"Cópias…"** (configurar). Nenhuma cópia configurada: aviso amarelo de que os arquivos
  estão só no navegador.
- **Tentativas automáticas** (05/11/2026), sem botão: a cada 5 min com o app visível, ao voltar a
  internet, ao voltar para o app e depois de cada salvar. A faixa volta se aparecer problema e some quando
  resolve.
- **"Não mostrar de novo"** (08/11/2026; 09/11/2026: vale em **todos os apps e na página inicial**): botão
  na faixa "Cofre:". A escolha é **por aparelho** (`wjpdm:semAvisoConexoes`, mesma origem para todas as
  páginas): dispensada em qualquer app ou no início, a faixa não aparece mais em nenhum, nem ao abrir nem
  ao salvar. A mensagem de cada salvar continua dizendo onde o arquivo chegou. Religa em **Cópias do cofre**
  (botão do cofre em cada app ou ⚙ Configurações do início): "Mostrar o aviso de conexões".
- O acesso do Google vale 1 h e o navegador só deixa abrir a janela do Google durante um gesto do usuário:
  ele é **renovado sozinho no primeiro toque/tecla** no app quando falta menos de 10 min (ou já venceu) —
  a janela do Google pisca e fecha, sem botão. Sem nenhum toque (app parado/fechado) só com servidor
  próprio guardando o token de renovação (G5); a chave secreta nunca vai no app.

### 5.4 Explorador do cofre — salvar, abrir e escolher (05/11/2026)
- **Uma tela no estilo do explorador de arquivos do sistema** (não uma árvore em cascata), em todos os
  apps: Salvar no cofre, Abrir do cofre, Inserir peça (Peça e Montagem: "Procurar no cofre…"), modelo do
  Desenho ("Procurar no cofre…").
- Barra: **← Voltar**, **↑ Pasta acima**, **caminho clicável** (Cofre › CAD › …) e **+ Nova pasta**
  (nome digitado na própria tela).
- Lista em **detalhes**: **pastas e arquivos** da pasta atual (Nome, Modificado, Tipo; marca de GO-OUT e
  "só no dispositivo"). **Um toque/clique seleciona; duplo clique/duplo toque entra na pasta (tela nova)
  ou abre/escolhe o arquivo.** Teclado: Enter abre, setas movem, Backspace sobe.
- Rodapé: **Nome do arquivo** (salvar; tocar num arquivo usa o nome dele) e **Tipo** (arquivos deste app ou
  "Todos os arquivos"). Nome já existente na pasta: pergunta e salva como "nome (2)".
- Abre na **última pasta usada no app** (senão na pasta da face: CAD, Documentos, Planilhas…).

## 6. WJCAD (Peça, Montagem, Desenho)

- **⚙ Configurações do WJCAD** (10/11/2026): engrenagem no canto direito da barra superior da Peça, da
  Montagem e do Desenho (e "Ferramentas → Configurações…" no menu) abre uma tela à parte, por seções:
  **Dispositivo** (perfil, toque longo, caixa flutuante), **Mouse e zoom**, **Esboço** (escala real 1:1,
  calibrar a tela, **Relações automáticas**), **Exibição** (estilo da vista 3D) e **Cofre**
  (atalho para Cópias do cofre). Vale na hora, guardado por aparelho, e as outras janelas abertas seguem a
  mudança. O item antigo "Ferramentas → Dispositivo" saiu (a janela de dispositivo só aparece na primeira
  vez). A ⚙ da página inicial continua como está.
- Só quatro áreas de comando: **Features, Sketch, Sheet Metal e Avaliar**. Nada de superfícies, soldas,
  moldes, simulação (o WJFlow é app separado).
- Especificação campo a campo e status em `docs/funcional/` (consultar antes de implementar; atualizar
  ✅/🟡/fase ao entregar). Lacunas priorizadas em `docs/funcional/referencia-introducao.md`.
- Referências a faces/arestas/corpos por **assinatura geométrica** (reencontra a mais parecida após
  reconstruir).
- **Importar**: STEP/STP/STL criam o recurso `importado`. STL com mais de 10 000 triângulos = **corpo de
  malha** (só exibido; janela "STL grande" oferece simplificar para sólido e, até 50 000 triângulos, **sólido na
  forma exata**, sem simplificar — 10/11/2026: simplificar pode abrir a malha e os cortes perderem material).
  Montagem STEP → `.wjasm`.
- **Dividir com corpos resultantes** (10/11/2026, pedido do Johann, como no CAD de referência): o plano corta em
  regiões (várias, se cruzar a peça várias vezes); a lista no painel destaca cada região ao tocar e marca quais viram
  corpos separados (as desmarcadas ficam juntas); a escolha fica no recurso por assinatura. Corpo de malha: o painel
  oferece "Converter em sólido" (forma exata ou simplificado).
- **STEP AP214/AP242 abre com as cores do arquivo** (04/11/2026), na Peça e na Montagem.
- **Cotas do esboço com teclado-calculadora** (09/11/2026; 10/11/2026: **abre pelo botão com símbolo de
  calculadora** na caixa do valor da cota): pequena calculadora ao lado da cota (normal ↔ científica,
  trigonometria em graus), sem subir o teclado do sistema.
- **Filete de esboço** (10/11/2026): cantos vão para a caixa **"Entidades a filetar"** e são aplicados juntos,
  por padrão **iguais** (uma cota R controla todos); o canto tirado vira **canto virtual** (relações e cotas
  continuam nele: mudar o raio não move o perfil). Vale também para o chanfro de esboço.
- **Relações automáticas no esboço** (10/11/2026): ao desenhar e arrastar, como nos CADs profissionais —
  soltar um ponto sobre outro ponto/curva cria Coincidente; linha nova ganha Colinear, Horizontal/Vertical,
  Paralela ou Perpendicular (com linha ligada), tolerância ±1° e o raio de encaixe; o símbolo aparece antes
  de soltar; **nunca** relação redundante ou que superdefina (o solver confere). **Ligadas por padrão**,
  chave em ⚙ Configurações → Esboço; **segurar Ctrl** suprime no momento. Ctrl+Z tira a linha com as relações
  dela. Filete/chanfro de esboço aceitam canto unido por Coincidente (inclusive preso à origem).
- **Esboço sobre a peça** (10/11/2026): **cota até aresta/vértice da peça não cria linha no esboço** (referência
  oculta, nunca entra no perfil; esboços antigos ocultam sozinhos a linha usada só por cota); **o esboço vence a
  peça na seleção** (tocar de novo no mesmo lugar alterna para a aresta da peça embaixo); **caixa de seleção** no
  Espelhar, Deslocar e Padrões, com as mesmas regras do Selecionar.
- **Mesclar = um corpo quando se tocam por face** (10/11/2026): sobreposição ou face com face vira um corpo
  em todos os recursos com mesclar. A fusão **cola só ruído numérico (≤ 0,001 mm)**; folga real ou contato só
  por aresta/ponto fica como corpo separado, com **aviso** no recurso dizendo a folga (não esconder folgas).
  **Planos novos** a partir de face têm **origem fixa** (projeção da origem da peça), para o esboço não andar
  quando a face muda; planos antigos ficam como estão. Esboço avisa (sem bloquear) entidade **< 0,5 mm**.
- **✓/✕ de cada ferramenta do esboço** (10/11/2026): lado a lado no canto superior direito do painel
  lateral; ✓ (Enter) conclui/aplica e sai; ✕ sai desfazendo o que foi feito na ferramenta (comandos com
  seleção: cancela sem aplicar). **Esc seguro**: nas ferramentas de desenho o Esc só sai mantendo o desenho
  (como no CAD de referência; só o botão ✕ desfaz); nos comandos com seleção Esc = ✕. O par do canto da vista
  é **Sair do esboço / Descartar** (esboço inteiro), lado a lado e com ícone próprio. Tocar numa cota abre a
  caixa do valor com a Cota ou a Selecionar ativa; duplo clique/toque abre com qualquer ferramenta.
- **✕ num recurso novo** (09/11/2026): cancelar não deixa o recurso (nem recurso com erro) na árvore; o
  esboço volta a ficar solto.
- **Exportar = "Salvar como"** (07/11/2026): botão **Exportar** logo depois do 💾 Salvar (e no menu
  Arquivo); nada de STEP/STL no canto superior. Abre o **mesmo explorador do primeiro salvar**, já **na
  pasta onde a peça está no cofre** (peça ainda não salva: última pasta usada), com nome sugerido,
  **"Salvar como tipo"** (STEP ou STL; lembra o último) e o botão **No dispositivo** (baixa em Downloads).
  No cofre o arquivo exportado entra **publicado, sem GO-OUT**; nome repetido na pasta **substitui** e
  vira a versão seguinte (a anterior fica no histórico).
- **Aparência (cor)** (04/11/2026): painel com Aplicar em **Face / Corpo / Peça** (Peça) ou
  **Componente (nesta montagem) / Peça (documento)** (Montagem); paleta, cor do sistema, RGB ou HSV,
  hexadecimal, Remover aparência, prévia, desfazer. A face vence o corpo, que vence a peça, que vence o
  material. "Usar as cores do arquivo importado" liga/desliga. Estados de exibição: pendente.
- **Multicorpo**: pasta "Corpos sólidos"; menu do corpo pelo botão direito ou toque longo (dedo/caneta).
- **Escala real 1:1 no esboço** (05/11/2026): aba Sketch → Escala 1:1 ▾ (liga/desliga + Calibrar escala da
  tela…). Aparelho conhecido (tablet do Johann: **TCL TAB A1 Plus 9445X, 12,2", 2400×1600**) calibra sozinho pela ficha da tela; senão, calibração uma vez por aparelho pelas **medidas da área acesa da tela** (tela cheia com bordas marcadas, toque longo abre o pop-up dos lados A/B ou diagonal; proporção conferida) ou com régua; no esboço a vista fica de frente para o plano, travada
  em tamanho real (sem zoom nem rotação; dedo/meio arrastam). Traço da caneta = medida real. Detalhes em
  `docs/funcional/sketch.md` §7.
- **Montagem** (04/11/2026): fora de comando, **mouse (esquerdo) ou caneta arrastam o componente
  flutuante**; clique sem arrastar seleciona; caneta parada abre o menu; **o dedo gira a vista** (mover com
  o dedo = comando Mover componente). Componente fixo não se move por arraste. Componentes de malha (STL)
  são selecionáveis e arrastáveis.
- Medir e propriedades de massa funcionam em corpos importados (STEP e malha STL).
- Arquivo `.wjcad` (abre `.jlscad`/`.cadt`). Chaves internas `jlscad:` ficam como estão.

## 7. Outras faces

- **WJWrite** (04/11/2026): **folhas separadas na tela, como num processador de texto**: cada página é uma
  folha com vão entre elas; o parágrafo continua na folha seguinte **linha a linha**; cabeçalho, rodapé e
  "Página X de Y" em cada folha; quebra de página manual leva o texto à folha seguinte. Pendente:
  viúvas/órfãs e "manter com o próximo".
- **WJVideoMaker** (05/11/2026): nova face de edição de vídeo e fotos, inspirada funcionalmente num
  editor de vídeo de consumo avançado (nome do produto de referência nunca na UI; predefinições de
  exportação sem nomes de redes sociais). Mídia do Google Drive (seletor do Google, mantendo o escopo
  `drive.file`), pasta do dispositivo, pendrive e galeria. Especificação e roteiro V0–V6 em
  `docs/global/wjvideomaker.md`. Decisões: **todos os arquivos no cofre do WJPDM** (06/11/2026,
  "use a mesma pasta do WJPDM, centralize todos os arquivos lá": projetos, vídeos, fotos, áudios e
  exportações; importar copia para o cofre; vídeo/foto/áudio entra como **arquivo de mídia**: uma
  cópia só por lugar, sem versões nem duplicata no banco do aparelho), **1080p** no tablet (4K só no computador), exportação no cofre **sem versões**, extensão
  `.wjvid`, pasta "Vídeos". V0 (teste do aparelho, `video/aparelho/`) entregue e medido no TCL: até 1080p por hardware,
  2 vídeos 1080p simultâneos, 4K com proxy, exportação MP4 H.264 + AAC (≈ 1,4 min por minuto).
  **08/11/2026 (Johann): "apenas um editor de vídeo"** — cortar, reduzir o tempo, acelerar e reduzir o
  vídeo, juntar vídeo com imagem, texto sobre imagens e vídeos; **os arquivos vêm do próprio aparelho
  ou do WJPDM** (nada de analisar pastas; o seletor do Google Drive foi dispensado). **V1 entregue**
  (editor em `video/`): importar do aparelho/WJPDM, pista magnética de vídeos e fotos + pista de textos,
  dividir/aparar/mover/excluir, velocidade 0,1×–10× e "duração na linha do tempo", texto arrastável no
  vídeo, exportar MP4 (resolução, qualidade ou tamanho máximo) para o aparelho, Compartilhar ou o
  WJPDM (reexportar com o mesmo nome substitui, sem versões), projeto `.wjvid` no cofre.
- **WJCalcEng** (07/11/2026): face para guardar as formas de calcular do curso de engenharia do Johann.
  Uma calculadora por módulo; a primeira é o **centro de gravidade em 2D**. **O desenho é o esboço do
  WJCAD** (07/11/2026: "exatamente igual ao Sketch do CAD 3D, com os mesmos recursos e relações com os
  objetos e com a origem"): o mesmo editor, faixa Sketch, painel à esquerda, relações, cotas e solver,
  numa vista só 2D. A diferença é o **painel lateral direito**: **massa única** (um material: densidade
  × espessura) **ou massa de cada figura**, com o CG de cada figura (região fechada; contorno dentro de
  outro = furo) e do conjunto, momentos de inércia de área e de massa e memória de cálculo. Calculadoras **organizadas por matéria** com **lupa de pesquisa** no seletor (07/11/2026). **Todas as
  calculadoras pedidas entregues (08/11/2026)**, sempre com a **resolução passo a passo**: equações de 1º
  e 2º grau, sistemas, inequações, matrizes 3×3 por Cramer e Gauss, multiplicação de matrizes, leis de
  Newton, plano inclinado, atrito e trabalho. **10/11/2026: derivada, integral indefinida e definida**
  (simbólicas, com a regra de cada passo; primitiva sempre conferida derivando — resposta errada não
  aparece) e a **escrita de equações**: fórmula formatada enquanto se digita, **teclado matemático** e o
  **Editor de equações** (texto/LaTeX). Detalhes em `docs/global/wjcalceng.md`.
- **WJGoldDiamond** (07/11/2026): face de **modelagem 3D de joias** (nome do Johann). Construtores
  paramétricos no mesmo kernel do WJCAD: aro por tamanho (BR/ISO/EUA), perfis e afunilado, cabeça
  "gema primeiro" (garras ou inglesa), pavé (graduado, fileiras, eternidade, contas ou trilho),
  gravação interna/externa, torção, facetado/frisos, ocar, contração e canais de fundição, ficha
  técnica e preço. Booleanas sempre conferidas pelo volume (`segura`). Arquivo `.wjgd`, pasta "Joias".
  Detalhes e roteiro (J8: escultura, halo, brinco/pingente) em `docs/global/wjgolddiamond.md`.
  08/11/2026 (J7, pedido do Johann: "modelar o anel do jeito que eu preciso", não só predefinições):
  **ornamentos desenhados com o esboço do WJCAD** viram fios envolvidos no aro (Ø e altura por fio,
  simetria, pontos = bolinha ou pedrinha em inglesa), ponta da garra (bolinha/alongada/dupla) e aro dividido.
  08/11/2026 (J8, pedido do Johann): **escultura livre em malha** unida à joia (pincéis com a caneta, dedo
  navega; peso e STL pela união de malhas `manifold-3d`).
- **WJSlicer3D** (08/11/2026): face para **fatiar STL para impressão 3D**, por enquanto **só a estimativa
  de tempo de impressão e de material** (g, m, custo): **sem G-code e sem envio para a impressora**, sem
  configurações avançadas. Base funcional: um fatiador de código aberto e os perfis de fábrica das
  impressoras **Bambu Lab e Anycubic** (bico 0,4 mm, 0,20 mm padrão). Os nomes das impressoras aparecem
  só na lista de máquinas, como dado técnico de compatibilidade; o nome do fatiador de referência nunca
  aparece. STL do cofre, do aparelho ou do WJCAD (menu → Estimar impressão 3D). Ajustes básicos:
  camada, paredes, topo/fundo, preenchimento, suporte, borda; calibração do tempo por impressora.
  Detalhes em `docs/global/wjslicer3d.md`.
- **WJTaskPlan — prazo da etapa ≤ prazo da tarefa** (10/11/2026; tarefa sem prazo = etapas sem limite):
  calendário da etapa limitado ao prazo da tarefa; data depois dele ou antecipar o prazo da tarefa avisa as etapas que passariam
  (com os nomes); dado já errado (antigo ou da sincronia) **não é alterado sozinho**: fica marcado e se corrige
  com um toque. **Alerta de mão dupla** (10/11/2026): todo conflito (prazo da tarefa, prazo da etapa ou selo
  do dado errado) lista as etapas afetadas e oferece **"Trazer as etapas para dd/mm (prazo da tarefa)"**,
  **"Usar dd/mm na tarefa (maior prazo entre as etapas)"** ou Cancelar. **Etapas sempre em ordem crescente
  de prazo** (reordenam sozinhas ao criar ou mudar a data; empate mantém a ordem manual; sem prazo no fim);
  a seta ↑ só move dentro da mesma data; etapas feitas ficam no lugar delas. Regra nas funções puras
  (`src/tarefas/regras.ts`), a interface só pergunta. Detalhes em `docs/global/taskplan.md`.
- Especificação e estado de cada face: `docs/global/<face>.md`.

## 8. Hospedagem, versão e offline

- Hospedagem em uso: **GitHub Pages** (`https://johann-sicherl.github.io/WJProMaster/`), publicada pelo
  GitHub Actions a cada merge no `main` (check, teste, build). Cloudflare Pages fica para depois.
- Kernel de uma thread (`replicad_single`): não precisa de `crossOriginIsolated`.
- Offline: service worker com precache; o kernel `.wasm` é guardado quando o WJCAD termina de carregá-lo.
  **Páginas e arquivos vêm do cache primeiro** (06/11/2026): abrir não espera a rede (Wi-Fi sem internet
  deixava o app pendurado); versão nova continua chegando pela faixa "Atualizar". Chamadas ao Google Drive
  têm limite de tempo (15 s; envio 2 min): rede pendurada não trava a sincronia nem o salvar.

## 9. Pendências que dependem do Johann

- PORTA_CANETA (exportação com arestas não-manifold, extrusão que não funde, corpo que some no corte):
  aguardando o ZIP com o STL original e o `.wjcad`.
- Estados de exibição (aparência por estado): ainda não pedido para implementar.
- **Imagem → modelo 3D**: **fase 1 entregue (08/11/2026)** — gerador próprio por silhuetas (casco
  visual), offline, no tablet; fotos com **fundo liso sempre** (decisão do Johann). Página `cad/imagem3d/`
  (Peça → menu → "Imagens → modelo 3D"). Fase 2 (acabamento por IA num servidor com GPU) fica para a
  **G5**. Detalhes em `docs/global/cad.md` §5.
