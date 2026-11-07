# WJProMaster — contexto para o Claude

> **Ecossistema WJProMaster** (nome oficial do conjunto, definido pelo Johann). Faces:
> **WJCAD** (este app, antigo JLSCAD), **WJPDM** (diretório/cofre do WJCAD), **WJPlan**
> (planilhas), **WJWrite** (documentos), **WJApresentation** (apresentações), **WJCronProject**
> (cronogramas), **WJCalcEng** (cálculos de engenharia do curso; `docs/global/wjcalceng.md`), **WJERP** (ERP SaaS ligado ao WJPDM/WJCAD), **WJFlow** (escoamento de ar nas
> peças do WJCAD; `docs/global/wjflow.md`), **WJTaskPlan** (tarefas em pastas, escritas à mão;
> `docs/global/taskplan.md`) e **WJVideoMaker** (edição de vídeo e fotos; especificação em
> `docs/global/wjvideomaker.md`; por enquanto só o teste do aparelho, V0). Tudo roda no **celular, tablet e
> notebook/computador**. Visão, arquitetura (monorepo), roteiro **G0–G8** e especificação de cada
> face estão em **`docs/global/`**; o prompt de trabalho está em `docs/global/prompt-mestre.md`.
> Até a fase G0 (monorepo), tudo fica neste repositório: o WJCAD (descrito abaixo) e as primeiras
> versões locais das outras faces (tabela em `.claude/skills/wjpromaster-mapa/tecnico.md`). As regras de inspiração sem
> cópia valem para todas as faces: nomes registrados de terceiros ficam proibidos na UI;
> importar e exportar formatos abertos é permitido. Os nomes das faces são decisão do Johann
> (WJWord → WJWrite e WJAirFlow → WJFlow em 28/10/2026; notas de marca em `docs/global/README.md` §6).

> **Regras consolidadas: `docs/global/regras.md` — ler antes de cada tarefa** (fonte única de tudo o
> que já foi decidido: como trabalhar, aparelhos, interface, cofre, explorador, CAD, outras faces).
> Não deduzir além dele; na dúvida, perguntar. Mudou uma regra: atualizar o arquivo no mesmo PR.

## Regras 001 (definidas pelo Johann, 26/10/2026 — valem sempre)

1. **Postura de otimização e melhor experiência de uso (UX):** propor o caminho mais simples,
   rápido e leve para o usuário e para o código.
2. **Discordar quando fizer sentido:** se um pedido não tiver lógica operacional ou impactar
   muito o projeto (desempenho, arquitetura, manutenção), dizer isso claramente, explicar o
   motivo e propor uma alternativa antes de implementar.
3. **Perguntar quando houver dúvida** real de requisito, em vez de supor.
4. **Cautela e precisão:** validar cada mudança (testes, build, verificação no navegador quando
   for interface) e relatar o resultado com fidelidade.
5. **Eficiência e desempenho** em tudo: código enxuto, sem trabalho desnecessário na thread da UI,
   sem dependências supérfluas.
6. **Publicação até o fim, sem trabalho manual do Johann:** depois de `pnpm check && pnpm teste &&
   pnpm build`, fazer commit, push, abrir o PR para `main`, acompanhar o CI, corrigir o que falhar
   e **fazer o merge** quando estiver verde (isso publica no GitHub Pages e no Cloudflare Pages).
   Ele não deve precisar entrar no GitHub nem no Cloudflare. Só parar para perguntar se algo
   exigir decisão dele ou acesso que a sessão não tem.
7. **Menor trabalho possível para o Johann acessar as atualizações** (04/11/2026): toda entrega pronta
   é publicada na hora (PR → merge → deploy conferido), sem esperar pedido; ele só abre o app e toca
   "Atualizar". Entregas são testadas simulando o **tablet** (toque, 1280×800, perfil Tablet).
8. **Tudo em português**, inclusive as descrições dos comandos que o Claude executa.
9. **Aprimorar todo pedido antes de agir** (07/11/2026): a cada mensagem do Johann, a primeira coisa
   da resposta é um bloco curto **"Pedido aprimorado"** (até ~8 linhas): objetivo em uma frase;
   escopo (o que entra e o que fica de fora); arquivos/especificação envolvidos (pela skill
   `wjpromaster-mapa`); critério de pronto (como será validado, inclusive no tablet); riscos ou
   alternativa melhor (regra 2). Depois **repensar em cima do pedido aprimorado** — se ele mostrar
   um caminho mais simples, uma contradição com `regras.md` ou uma dúvida real, ajustar o plano ou
   perguntar (regra 3) — e só então executar o pedido aprimorado. Pergunta simples ou conversa:
   uma linha só basta.
10. **Skill `wjpromaster-mapa` sempre** (`.claude/skills/wjpromaster-mapa/`): em toda tarefa de código
   ou documentação, invocar a skill **antes** de procurar com grep/find e ir direto aos arquivos do mapa
   (`SKILL.md`); detalhes técnicos, stack, tabela das faces, roteiro e observações ficam em `tecnico.md`
   (ler só a seção da tarefa). **Manter a skill viva no mesmo PR**: arquivo criado, renomeado ou removido
   → linha no mapa; decisão técnica nova, armadilha descoberta ou fase entregue → `tecnico.md` (e
   `docs/global/regras.md` se for decisão do Johann). A conferência `scripts/teste-mapa.ts` (dentro do
   `pnpm teste` e do CI) falha se um arquivo de `src/` ou um teste ficar fora do mapa ou se o mapa citar
   arquivo que não existe.

Responda sempre em **português (Brasil)**. O dono do projeto é o Johann, engenheiro mecânico
que usa CAD paramétrico profissionalmente; trate-o como usuário avançado de CAD.
Ele prefere receber **arquivos/blocos de código completos** após cada mudança, não diffs parciais.


## Essencial (o resto em `.claude/skills/wjpromaster-mapa/tecnico.md`)

- Vite + TypeScript, DOM puro; kernel OpenCascade (`replicad`) em Web Worker; esboço com PlaneGCS;
  Three.js com **Y para cima** e projeção ortográfica; várias páginas (início `/`, WJCAD `/cad/`, uma por face).
- **pnpm** (nunca npm). Comandos: `pnpm dev` · `pnpm check` · `pnpm teste` · `pnpm build`. Antes de cada
  commit: `pnpm check && pnpm teste && pnpm build`.
- Publicação: merge no `main` → GitHub Actions → `https://johann-sicherl.github.io/WJProMaster/`.
- Fase atual: Fases 1–3 entregues, quase toda a 5 antecipada, núcleo da 4 (Sheet Metal) entregue;
  pendências e estado em `docs/funcional/README.md` e no fim de cada `docs/global/<face>.md`.
