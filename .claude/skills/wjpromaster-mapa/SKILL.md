---
name: wjpromaster-mapa
description: Mapa do código do WJProMaster (WJCAD, WJPDM, WJPlan, WJWrite, WJApresentation, WJCronProject, WJERP, WJTaskPlan, WJVideoMaker, WJCalcEng, WJGoldDiamond, WJFlow) — qual arquivo abrir para cada tipo de tarefa, onde está cada motor e teste, como validar no tablet e publicar. Usar ANTES de procurar com grep/find em qualquer tarefa de código ou documentação deste repositório, para ir direto aos arquivos certos e gastar menos contexto.
---

# Mapa do WJProMaster (consultar antes de explorar)

Objetivo: ir **direto** aos arquivos certos. Ler só o trecho necessário (`grep -n` + `sed -n a,bp`),
nunca o arquivo inteiro quando ele for grande (tamanhos abaixo). Regras de produto: `CLAUDE.md` (já
carregado) e `docs/global/regras.md` (fonte única das decisões). **Detalhes técnicos, stack, tabela das
faces, roteiro e observações: [tecnico.md](tecnico.md)** (ler só a seção da tarefa).

**Manter vivo no mesmo PR:** arquivo criado/renomeado/removido → linha aqui; decisão técnica, armadilha
ou fase entregue → `tecnico.md` (e `docs/global/regras.md` se for decisão do Johann). `scripts/teste-mapa.ts`
(no `pnpm teste` e no CI) falha se um arquivo de `src/` ou um teste ficar fora deste mapa.

## 1. Onde mexer, por tipo de pedido

| Pedido sobre… | Abrir primeiro | Especificação |
|---|---|---|
| Comando de Features (extrusão, filete, padrão, furo…) | `src/ui/esquemas.ts` (painel campo a campo) → `src/kernel/regenerar.ts` (geometria, 3 000 l) → `src/model.ts` (tipo do recurso) | `docs/funcional/features.md` |
| Varredura / loft / curvas 3D / recursos do menu Inserir | `src/kernel/varredura.ts`, `loft.ts`, `curvas.ts`, `recursosExtras.ts` | `features.md` §13, §15 |
| Furo assistido (tabelas ISO) | `src/kernel/furos.ts` | `features.md` |
| Edição direta (mover/excluir/substituir face) | `src/kernel/edicaoDireta.ts` | `features.md` §18 |
| Esboço: ferramenta, encaixe, seleção, arrasto | `src/esboco/editor.ts` (2 800 l) | `docs/funcional/sketch.md` |
| Esboço: relações automáticas (H/V, colinear, paralela, perpendicular, coincidente ao soltar o arraste) | `src/esboco/relacoesAuto.ts` (puro) → chamado pelo `editor.ts`; chave em `PrefsCad.relacoesAuto` | `sketch.md` §2 |
| Esboço: entidades compostas, aparar, offset, espelhar | `src/esboco/operacoes.ts` + `geometria.ts` | `sketch.md` |
| Cotas/relações do esboço, solver | `src/esboco/cotas.ts`, `solver.ts` (PlaneGCS, `aplicarValorGradual`) · teclado-calculadora das cotas `src/ui/tecladoCota.ts` | `sketch.md` |
| Camada 3D do esboço, referencial do plano | `src/esboco/visual.ts`, `src/esboco/referencial.ts` | — |
| Painel do esboço (definição, opções) | `src/esboco/painel.ts` | `sketch.md` |
| Escala 1:1 / calibrar tela | `src/esboco/escalaReal.ts` | `sketch.md` §7 |
| Converter entidades / interseção / silhueta / texto | `src/esboco/externas.ts`, `malhaPlano.ts`, `texto.ts`, `fontesTexto.ts`, `opentype.d.ts` | `sketch.md` |
| Chapa metálica, planificar, DXF | `src/kernel/chapa.ts`, `src/kernel/dxf.ts` | `docs/funcional/chapa.md` |
| Avaliar (medir, massa, seção, análises) | `src/kernel/avaliar.ts` (exato) · `src/analises.ts` (sobre a malha) | `docs/funcional/avaliar.md` |
| Imagens → modelo 3D (fotos das vistas, casco visual) | `src/imagem3d/casco.ts` (silhueta, medidas, escultura, superfície, STL), `worker.ts`, `main.ts`, `imagem3d.css` · página `cad/imagem3d/` | `docs/global/cad.md` §5 |
| Importar STEP/STL, cores do STEP | `src/kernel/importar.ts`, `stl.ts`, `coresStep.ts`, `coresImportadas.ts` | `CLAUDE.md` (Modelo) |
| Seleção de faces/arestas, referências persistentes | `src/kernel/topologia.ts`, `facesRecurso.ts` | — |
| Vista 3D, câmera, mouse/toque no modelo | `src/viewport.ts` (1 600 l) | `regras.md` §3 |
| ⚙ Configurações do WJCAD (Peça, Montagem, Desenho): seções, opções do aparelho, roda do mouse | tela `src/ui/configuracoesCad.ts` (itens por seção) · preferências puras e contas do zoom `src/ui/preferenciasCad.ts` (`jlscad:interface`) | `regras.md` §6 |
| Peça: barra, árvore, menus, atalhos, abrir/salvar | `src/main.ts` (5 000 l — sempre buscar por `grep -n`) | `regras.md` §4 |
| Abas e botões de comando | `src/comandos.ts` · ícones `src/icones.ts` | — |
| Painel de comando ✓/✕ genérico | `src/ui/formulario.ts` | — |
| Peças de UI de Montagem/Desenho, árvore ajustável, ícone do recurso, cotas sobre o modelo | `src/ui/basico.ts`, `src/ui/lateral.ts`, `src/ui/iconeRecurso.ts`, `src/ui/cotasModelo.ts` | — |
| Aparência (cor) | `src/aparencia.ts`, `src/ui/editorCor.ts` | `regras.md` §6 |
| Configurações / equações / pai-filho | `src/configuracoes.ts`, `src/equacoes.ts`, `src/dependencias.ts` | — |
| Montagem (mates, arrastar, cotas, contexto, STEP) | `src/montagem/main.ts` (2 700 l), `solver.ts`, `modelo.ts`, `cena.ts`, `cotas.ts`, `contexto.ts`, `step.ts` | `docs/funcional/montagem.md` |
| Desenho (folha ABNT, vistas, cotas) | `src/desenho/main.ts` (2 800 l), `modelo.ts`, `anotacoes.ts` · projeção `src/kernel/projecao.ts` | `docs/funcional/desenho.md` |
| Kernel/worker, mensagens entre UI e kernel | `src/kernel/worker.ts`, `src/kernel/cliente.ts` | — |
| Cofre: salvar, explorador, GO-OUT/GO-IN, faixa "Cofre:" | `src/comum/cofre.ts` (1 200 l) | `regras.md` §5 |
| Cópias (aparelho, pasta, pendrive) e sincronia | `src/comum/repositorios.ts`, `src/pdm/sincronia.ts` | `regras.md` §5.2 |
| Google Drive | `src/comum/drive.ts` | `regras.md` §5.3 |
| WJPDM (app) | `src/pdm/main.ts`, regras puras `src/pdm/regras.ts` | `docs/global/pdm.md` |
| Casca comum dos apps (barra, faixa, janelas, desfazer, autosave) | `src/comum/casca.ts`, `icones.ts`, `armazem.ts`, `janelas.ts` | — |
| Arquivo grande passado entre páginas · diagnóstico do aparelho | `src/comum/transferir.ts`, `src/comum/diagnostico.ts` | — |
| Atualização/versão/offline | `src/comum/atualizacao.ts`, `public/sw.js`, `vite.config.ts` (plugin `offline`), `src/versao.d.ts` | `regras.md` §8 |
| Página inicial / ⚙ Configurações | `src/inicio/inicio.ts` | — |
| WJPlan | `src/planilha/main.ts`, `grade.ts` (canvas), `formatar.ts` · motor de fórmulas `src/formulas/`: `sintaxe.ts`, `avaliar.ts`, `funcoes.ts`, `conversao.ts`, `pasta.ts`, `tipos.ts` | `docs/global/planilha.md` |
| WJWrite | `src/documento/main.ts` | `docs/global/documentos.md` |
| WJApresentation | `src/apresentacao/main.ts` | `docs/global/apresentacoes.md` |
| WJCronProject | `src/cronograma/main.ts` · motor `src/agenda/agenda.ts` | `docs/global/cronograma.md` |
| WJERP | `src/erp/main.ts` · regras `src/erp/regras.ts` | `docs/global/erp.md` |
| WJTaskPlan | `src/tarefas/main.ts`, `regras.ts`, `escrita.ts`, `copias.ts` | `docs/global/taskplan.md` |
| WJVideoMaker (editor) | interface `src/video/main.ts` (biblioteca, linha do tempo, propriedades, exportar) + `video.css` · motor puro `src/video/projeto.ts` (clipes, cortes, velocidade, textos, plano de quadros, taxa) · desenho do quadro `desenho.ts` (prévia = exportação) · prévia `previa.ts` · mídias no OPFS `midias.ts` · exportação MP4 no Worker `exportar-worker.ts` (mediabunny) · áudio 48 kHz/velocidade `audio.ts` · tempo `tempo.ts` | `docs/global/wjvideomaker.md` §16 |
| WJVideoMaker (teste do aparelho, V0) | `src/video/aparelho.ts`, `aparelho-worker.ts`, `aparelho.css`, `capacidade.ts` | `docs/global/wjvideomaker.md` §8 |
| WJCalcEng | `src/calceng/main.ts` · motor `src/calceng/cg2d.ts` · calculadoras por matéria e busca `src/calceng/modulos.ts` · álgebra, matrizes e física (campos + passos) `src/calceng/calculadoras.ts` · expressões (ler, simplificar, texto/HTML/LaTeX) `src/calceng/expressao.ts` · derivada, integrais e editor de equações `src/calceng/calculo.ts` | `docs/global/wjcalceng.md` |
| WJGoldDiamond (joias) | `src/joia/main.ts`, `vista.ts`, `malhaGema.ts`, `worker.ts` · motor `src/joia/regras.ts` · ornamentos (esboço → fios) `src/joia/ornamento.ts` + editor `src/joia/editorOrnamento.ts` (esboço do WJCAD, import dinâmico) · escultura em malha `src/joia/escultura.ts` (pincéis, icosfera) + união de malhas `src/joia/uniao.ts` (`manifold-3d`) · sólido `src/joia/geometria.ts` (booleana `segura`, `fioSolido`) | `docs/global/wjgolddiamond.md` |
| WJSlicer3D (tempo e material de impressão 3D) | `src/slicer/main.ts` (tela), `vista.ts` (mesa 3D), `worker.ts`, `slicer.css` · motor `src/slicer/fatiar.ts` (fatiamento, cascas, suporte, planejador de velocidade) · perfis das impressoras e materiais `src/slicer/perfis.ts` · STL, giro e apoio `src/slicer/malha.ts` | `docs/global/wjslicer3d.md` |
| WJFlow | `src/flow/main.ts`, `gpu.ts` (WebGPU), `lbm.ts`, `geometria.ts`, `estudo.ts`, `campo.ts`, `vista3d.ts`, `aparelho.ts`, workers `cpu-worker.ts`, `pos-worker.ts`, `preparo-worker.ts` | `docs/global/wjflow.md` |
| Integrações entre faces | — | `docs/global/integracoes.md` |
| Central de eficiência (aprimorar pedidos, conferir entregas, registro de custo e acerto) | — | `docs/global/central.md` |
| Status geral do CAD / lacunas priorizadas | — | `docs/funcional/README.md`, `referencia-introducao.md` |

## 2. Testes (Node, sem DOM) — `pnpm teste` roda todos

Rodar só o teste da área enquanto trabalha (`pnpm exec tsx scripts/teste-<x>.ts`) e o conjunto inteiro antes do commit.

| Teste | Cobre |
|---|---|
| `teste-kernel.ts`, `teste-recursos.ts` | regeneração, features, chapa (kernel em Node) |
| `teste-esboco.ts` | geometria e operações do esboço (inclui filete/chanfro em canto unido por Coincidente) |
| `teste-relacoes-auto.ts` | relações automáticas do esboço: candidatas, sem redundância/conflito, arrastar e soltar |
| `teste-importar.ts` | STEP/STL, montagem STEP |
| `teste-imagem3d.ts` | gerador imagens → 3D (silhueta, medidas, casco, faces, STL) |
| `teste-montagem.ts` / `teste-desenho.ts` | solver de mates / projeção e desenho |
| `teste-pdm.ts`, `teste-sincronia.ts`, `teste-drive.ts` | regras do cofre, sincronia das cópias, Drive simulado |
| `teste-formulas.ts`, `teste-agenda.ts`, `teste-erp.ts`, `teste-tarefas.ts`, `teste-video.ts`, `teste-flow.ts`, `teste-calceng.ts`, `teste-joia.ts`, `teste-slicer.ts` | motores das outras faces |
| `teste-configuracoes.ts` | preferências do WJCAD: passo e sentido do zoom da roda (vista 3D e folha do Desenho) |
| `teste-mapa.ts` | este mapa em dia com `src/` e `scripts/` |
| `estresse-*.{ts,cjs}`, `roteiro-ui.cjs`, `roteiro-aviso-conexoes.cjs`, `roteiro-cotas.cjs`, `roteiro-configuracoes.cjs`, `roteiro-relacoes-auto.cjs`, `roteiro-esboco-peca.cjs`, `roteiro-ferramenta-ok.cjs` | estresse e roteiros de interface com Playwright (não entram no `pnpm teste`); o do aviso confere a faixa "Cofre:" e o "Não mostrar de novo" em todas as páginas; o das cotas, teclado-calculadora, cota angular, arraste com a Cota ativa e ✕ de recurso novo; o das configurações, a ⚙ e a roda do mouse nos três ambientes (computador, tablet, celular); o das relações automáticas, prévia do símbolo, arrastar e soltar (Coincidente/origem), filete no canto unido por relação, chave e Ctrl; o do esboço sobre a peça, cota até a aresta sem linha (referência oculta e migração), prioridade do esboço com alternância para a peça e caixa no Espelhar/Deslocar/Padrões (dedo, caneta e mouse); o do ✓/✕ da ferramenta, ✓/✕ no painel, Esc seguro, canto Sair/Descartar e cota que reabre (dedo, caneta, mouse, duplo clique) |

## 3. Validar no navegador (tablet simulado)

1. `pnpm dev --port 5199 --strictPort` em segundo plano (início em `/`, WJCAD em `/cad/`, demais em `/<pagina>/`).
2. Playwright do ambiente (`require("playwright")`, `chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] })`):
   viewport 1280×800, `hasTouch: true`, `isMobile: true`, e antes de abrir
   `localStorage.setItem("jlscad:interface", JSON.stringify({ dispositivo: "tablet", caixaFlutuante: false }))`.
3. Modelo pronto: `scripts/roteiro-ui.cjs [computador|tablet|celular]` (localizadores da faixa/abas, espera do
   "Reconstruindo", leitura do volume no rodapé). Na Peça, `window.__cad.doc()` expõe o documento.
4. Capturas para o Johann: `deviceScaleFactor: 2`; capturas só para conferência: 1.

## 4. Publicar (regra 6) — sequência sem pausa

`git fetch origin main` + mesclar `origin/main` no ramo (outras sessões publicam ao mesmo tempo, `regras.md`
regra 16) → `pnpm check && pnpm teste && pnpm build` → commit em português → `git push -u origin <branch>` →
PR para `main` (ferramentas `mcp__github__*`) → esperar **"Verificar PR"** verde (`verificar.yml`: check,
teste, build sobre o PR juntado com o `main`) → corrigir → merge **pelo número devolvido ao criar o PR**, com
`expectedHeadSha` → acompanhar `deploy.yml` → conferir `https://johann-sicherl.github.io/WJProMaster/`.

## 5. Armadilhas já conhecidas

- Página nova: entrada em `vite.config.ts` (`rollupOptions.input`), em `PAGINAS` do `public/sw.js` e caixa em `src/inicio/inicio.ts`.
- Erro do OpenCascade = `WebAssembly.Exception` sem texto: traduzir e marcar a feature com erro, sem parar as outras.
- Sólidos grandes: listar faces/arestas com `listarTopo` (linear), não `forma.faces/edges` do replicad (quadrático).
- Conteúdo importado > 1 MB vai ao kernel uma vez (`PREFIXO_ENVIADO`); fora das fotografias do desfazer.
- Y para cima (Frontal = XY, Superior = XZ, Lateral = YZ); arquivos até a versão 2 são migrados em `validarDocumento`.
- Chaves `jlscad:` (localStorage) e cache `jlscad-` não mudam de nome. Versão do cache do `sw.js` não se edita à mão.
- Autosave por janela: `chave@<id>` (id em `window.name`) + a chave comum usada para passar documento entre apps (`#abrir-autosave`).
- COOP `same-origin` quebra o login do Google: usar `same-origin-allow-popups` quando for para o Cloudflare.
- Elemento com o atributo `hidden` e `display` próprio no CSS continua visível (e pode tapar toques): acrescentar `.classe[hidden] { display: none; }`.
- Malha do WJCAD (`ultimaMalha`) tem cada face B-Rep triangulada à parte (vértices repetidos nas bordas): soldar antes de cortar/encadear (o WJSlicer3D passa pelo leitor de STL).
- Comando novo: o recurso entra no documento antes do painel; a fotografia do ✕ (`abrirComando`) é o documento **sem** ele (senão cancelar deixa o recurso com erro).
- Selos de relação (H, V…) ficam no meio da linha e roubavam o toque da Cota: só aceitam toque em Selecionar/Exibir relações.
- `direction: rtl` para "rolar" texto à direita embaralha símbolos e unidade (bidi): usar flex com `justify-content: flex-end` e `overflow: hidden`.
- Cota de distância entre linhas não tem sinal: um salto grande de outra cota pode "espelhar" a espessura (perfil do Johann 80 → 30). Mudar cota sempre por `aplicarValorGradual` (2ª tentativa fina se cruzar), nunca `valor = x` + um `resolver`.
- Nunca o nome de produto de terceiros na interface; o fluxo segue o CAD de referência, os nomes são nossos.
