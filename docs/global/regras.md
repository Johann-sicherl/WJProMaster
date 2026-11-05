# Regras do WJProMaster — o que já foi decidido (fonte única)

> Ler **antes de cada tarefa**. Tudo aqui foi decidido pelo Johann (dono do projeto, engenheiro
> mecânico, usuário avançado de CAD) ou já está entregue e testado. Não deduzir além disto: se um
> pedido não estiver coberto, **perguntar** (regra 3). Quando uma regra mudar, atualizar este arquivo
> no mesmo PR. Detalhes campo a campo dos comandos do CAD ficam em `docs/funcional/`; a visão e o
> roteiro de cada face, em `docs/global/<face>.md`.
>
> Última consolidação: 05/11/2026.

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
10. Ele prefere receber **arquivos/blocos de código completos** quando pedir código, não diffs parciais.
11. Gerenciador **pnpm** (nunca npm); dependência nova só com justificativa, de projeto conhecido,
    revisando o `pnpm-lock.yaml` (`minimumReleaseAge` de 3 dias, scripts de instalação bloqueados).
12. Segurança: nunca usar nem versionar a chave secreta do cliente OAuth do Google; nunca force-push;
    o PDF do guia do CAD de referência fica só no Drive dele (não versionar); arquivos de instalação e de
    terceiros não entram no repositório.

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
  (Ferramentas → Dispositivo; ⚙ Configurações na página inicial). Classe `disp-*` no `body`.
  - Celular: ícones sem texto, árvore/painéis em gaveta, dedo desenha.
  - Tablet: caneta + dedo, **alvos ≥ 44 px**, lupa de precisão.
  - Computador: botões compactos, mouse e atalhos.
- **Caneta desenha, dedo navega** (1 dedo orbita, 2 dedos zoom/pan). Sem caneta, o dedo também esboça.
- Mouse como nos CADs profissionais: esquerdo seleciona/desenha, **meio gira** (Ctrl+meio arrasta), roda
  aproxima no cursor, **direito abre o menu de contexto**.
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
- **Salvamentos seguintes gravam só no dispositivo** (banco do app + pasta padrão do dispositivo): é a
  cópia de trabalho em GO-OUT. **O pendrive e o Drive só recebem o que passou por GO-IN** (cada GO-IN cria
  a versão). No WJPDM há GO-IN da pasta inteira (com subpastas).
- Aba **Cofre** na lateral direita de cada app: dados do documento (pasta, estado, revisão, versão, GO-OUT),
  GO-OUT / GO-IN / Desfazer GO-OUT e "Meus arquivos em GO-OUT" (todos os apps) com GO-IN por item ou dos
  marcados.
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

- Só quatro áreas de comando: **Features, Sketch, Sheet Metal e Avaliar**. Nada de superfícies, soldas,
  moldes, simulação (o WJFlow é app separado).
- Especificação campo a campo e status em `docs/funcional/` (consultar antes de implementar; atualizar
  ✅/🟡/fase ao entregar). Lacunas priorizadas em `docs/funcional/referencia-introducao.md`.
- Referências a faces/arestas/corpos por **assinatura geométrica** (reencontra a mais parecida após
  reconstruir).
- **Importar**: STEP/STP/STL criam o recurso `importado`. STL com mais de 10 000 triângulos = **corpo de
  malha** (só exibido; janela "STL grande" oferece simplificar para sólido). Montagem STEP → `.wjasm`.
- **STEP AP214/AP242 abre com as cores do arquivo** (04/11/2026), na Peça e na Montagem.
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
  `docs/global/wjvideomaker.md`. Decisões (05/11/2026): mídia **fora do cofre** (o `.wjvid` guarda
  vínculos), **1080p** no tablet (4K só no computador), exportação no cofre **sem versões**, extensão
  `.wjvid`, pasta "Vídeos". V0 (teste do aparelho, `video/aparelho/`) entregue e medido no TCL: até 1080p por hardware,
  2 vídeos 1080p simultâneos, 4K com proxy, exportação MP4 H.264 + AAC (≈ 1,4 min por minuto).
- Especificação e estado de cada face: `docs/global/<face>.md`.

## 8. Hospedagem, versão e offline

- Hospedagem em uso: **GitHub Pages** (`https://johann-sicherl.github.io/WJProMaster/`), publicada pelo
  GitHub Actions a cada merge no `main` (check, teste, build). Cloudflare Pages fica para depois.
- Kernel de uma thread (`replicad_single`): não precisa de `crossOriginIsolated`.
- Offline: service worker com precache; o kernel `.wasm` é guardado quando o WJCAD termina de carregá-lo.

## 9. Pendências que dependem do Johann

- PORTA_CANETA (exportação com arestas não-manifold, extrusão que não funde, corpo que some no corte):
  aguardando o ZIP com o STL original e o `.wjcad`.
- Estados de exibição (aparência por estado): ainda não pedido para implementar.
- WJVideoMaker: teste de pasta/pendrive com vídeos de verdade no TCL (o desempenho já foi medido,
  §8 de `docs/global/wjvideomaker.md`) e a chave de API do seletor do Google Drive (passos no §14).
