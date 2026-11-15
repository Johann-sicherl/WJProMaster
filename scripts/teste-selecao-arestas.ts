// Seleção nos comandos: (1) caixa de seleção ativa (rosa) ao abrir e ao encher uma caixa de um item só
// (src/ui/caixasSelecao.ts, sobre os esquemas reais do painel); (2) seleção rápida do Filete/Chanfro
// (src/selecaoArestas.ts) sobre peças reais do kernel: arestas da face, do recurso (Corte), côncavas e
// convexas, com as bordas tangentes do filete fora das duas.
import opencascade from "replicad-opencascadejs";
import { setOC } from "replicad";
import { createRequire } from "node:module";
import { novaFeature, novoEsboco, type Feature, type FeatureEspelhar, type FeatureExtrusao, type FeatureFilete, type FeaturePadraoLinear, type FeaturePlanoRef, type Referencia } from "../src/model";
import { definirSolverEsboco, regenerar } from "../src/kernel/regenerar";
import * as op from "../src/esboco/operacoes";
import { SolverEsboco } from "../src/esboco/solver";
import { esquemaDe, type DadosEsquema } from "../src/ui/esquemas";
import { ajustarCampo, campoInicial, camposDeSelecao, proximoCampo } from "../src/ui/caixasSelecao";
import { convexidade, facesDasArestas, opcoesSelecaoRapida } from "../src/selecaoArestas";

const require = createRequire(import.meta.url);
setOC(await (opencascade as any)({ locateFile: () => require.resolve("replicad-opencascadejs/wasm") }));
definirSolverEsboco(await SolverEsboco.criar());

let falhas = 0;
function verdade(nome: string, v: boolean, extra = "") {
  if (!v) falhas++;
  console.log(`${v ? "ok  " : "FALHA"} ${nome}${!v && extra ? ` — ${extra}` : ""}`);
}

// ---------- 1. caixa ativa ----------
const dados = { esbocosAntes: [], recursosAntes: [], sistemasAntes: [] } as unknown as DadosEsquema;
const campos = (f: Feature, aba?: string) => camposDeSelecao(esquemaDe(f, dados), f, aba);
const face: Referencia = { tipo: "face", ass: { geom: "plano", centro: [0, 0, 100], area: 1, normal: [0, 0, 1] } };
const aresta: Referencia = { tipo: "aresta", ass: { geom: "linha", meio: [0, 0, 0], a: [-1, 0, 0], b: [1, 0, 0], comprimento: 2 } };
{
  const fil = novaFeature("filete", 1) as FeatureFilete;
  verdade("Filete sem pré-seleção: a caixa das arestas abre ativa", campoInicial(campos(fil), fil)?.cam === "itens");
  fil.itens = [aresta];
  verdade("Filete com aresta pré-selecionada: a caixa (vários itens) continua ativa", campoInicial(campos(fil), fil)?.cam === undefined || campoInicial(campos(fil), fil) === null);
  const ch = novaFeature("chanfro", 1) as Feature;
  verdade("Chanfro sem pré-seleção: a caixa das arestas abre ativa", campoInicial(campos(ch), ch)?.cam === "itens");

  const pl = { ...(novaFeature("planoRef", 1) as FeaturePlanoRef), ref1: { tipo: "plano", id: "XZ" } as Referencia };
  verdade("Plano sem pré-seleção: a 1ª referência (padrão Superior) abre ativa", campoInicial(campos(pl), pl, ["ref1"])?.cam === "ref1");
  verdade("Plano com face pré-selecionada: nenhuma caixa vazia → nenhuma ativa", campoInicial(campos({ ...pl, ref1: face }), { ...pl, ref1: face }) === null);
  const medio = { ...pl, modo: "medio" as const, ref1: face };
  verdade("Plano médio: com a 1ª cheia, a 2ª referência abre ativa", campoInicial(campos(medio), medio)?.cam === "ref2");
  const medio2 = { ...pl, modo: "medio" as const, ref1: undefined as unknown as Referencia };
  verdade("Plano médio vazio: começa pela 1ª", campoInicial(campos(medio2), medio2)?.cam === "ref1");
  medio2.ref1 = face;
  verdade("Plano médio: encher a 1ª passa a vez para a 2ª", proximoCampo(campos(medio2), medio2, "ref1")?.cam === "ref2");
  (medio2 as FeaturePlanoRef).ref2 = face;
  verdade("Plano médio: encher a 2ª (todas cheias) → nenhuma ativa", proximoCampo(campos(medio2), medio2, "ref2") === null);

  const esp = { ...(novaFeature("espelhar", 1) as FeatureEspelhar), plano: { tipo: "plano", id: "YZ" } as Referencia };
  verdade("Espelhar sem pré-seleção: o plano (padrão Direito) abre ativo", campoInicial(campos(esp), esp, ["plano"])?.cam === "plano");
  verdade("Espelhar com face pré-selecionada: nada ativo", campoInicial(campos({ ...esp, plano: face }), { ...esp, plano: face }) === null);

  const pad = novaFeature("padraoLinear", 1) as FeaturePadraoLinear;
  verdade("Padrão linear: a direção 1 abre ativa", campoInicial(campos(pad), pad)?.cam === "dir1.ref");
  pad.dir1.ref = aresta;
  verdade("Padrão linear: Direção 2 desligada não recebe a vez", proximoCampo(campos(pad), pad, "dir1.ref") === null);
  pad.dir2.ativa = true;
  verdade("Padrão linear: com a Direção 2 ligada, encher a 1 passa a vez para a 2", proximoCampo(campos(pad), pad, "dir1.ref")?.cam === "dir2.ref");

  const pc = novaFeature("padraoCircular", 1) as Feature;
  verdade("Padrão circular: o eixo abre ativo", campoInicial(campos(pc), pc)?.cam === "eixo");

  const furo = novaFeature("furo", 1) as Feature;
  const cf = campos(furo, "Tipo");
  verdade("Furo (aba Tipo, condição Passante): sem caixa vazia escondida ativa", campoInicial(cf, furo) === null || cf.length > 0);

  // caixa que aparece vazia (Plano: Distância → Plano médio) fica ativa; desativada pelo usuário não volta
  const pl2 = { ...(novaFeature("planoRef", 1) as FeaturePlanoRef), ref1: face };
  let aj = ajustarCampo(campos(pl2), pl2, null);
  verdade("Plano (Distância, 1ª cheia): nada ativo", aj.campo === null);
  pl2.modo = "medio";
  aj = ajustarCampo(campos(pl2), pl2, null, aj.vazias);
  verdade("trocar para Plano médio: a 2ª referência aparece vazia e fica ativa", aj.campo?.cam === "ref2");
  aj = ajustarCampo(campos(pl2), pl2, null, aj.vazias);
  verdade("desativada pelo usuário (tocou a caixa): não volta sozinha", aj.campo === null);
  pl2.modo = "deslocamento";
  aj = ajustarCampo(campos(pl2), pl2, { cam: "ref2", aceita: [], multiplo: false }, aj.vazias);
  verdade("a caixa ativa sumiu (volta a Distância): nenhuma vazia → nada ativo", aj.campo === null);
  pl2.ref1 = undefined as unknown as Referencia;
  aj = ajustarCampo(campos(pl2), pl2, null, aj.vazias);
  verdade("tirar o item da 1ª com ×: ela esvazia e fica ativa", aj.campo?.cam === "ref1");

  // pré-seleção: a próxima vazia depois da que foi cheia, voltando ao começo se preciso
  const lista = [{ cam: "a", aceita: [], multiplo: false }, { cam: "b", aceita: [], multiplo: false }, { cam: "c", aceita: [], multiplo: false }];
  verdade("próxima vazia depois da atual", proximoCampo(lista, { a: 1, c: 1 }, "a")?.cam === "b");
  verdade("sem vazia depois, volta para a 1ª vazia antes", proximoCampo(lista, { b: 1, c: 1 }, "c")?.cam === "a");
}

// ---------- 2. seleção rápida de arestas ----------
function caixa(prof = 100) {
  const esb = novoEsboco(1, { tipo: "plano", plano: "XY", deslocamento: 0 });
  op.retangulo(esb, op.ponto(esb, { x: -40, y: -50 }), op.ponto(esb, { x: 40, y: 50 }));
  const ex = { ...(novaFeature("extrusao", 1) as FeatureExtrusao), esboco: esb.id, profundidade: prof };
  return [esb, ex] as Feature[];
}
function contagem(r: ReturnType<typeof regenerar>) {
  const viz = facesDasArestas(r.topologia!);
  const c = { convexa: 0, concava: 0, tangente: 0, indefinida: 0 };
  r.topologia!.arestas.forEach((_, i) => {
    if (viz[i].length === 2) c[convexidade(r.malha!, r.topologia!, i, viz)]++;
  });
  return c;
}
const recursos = (feats: Feature[], r: ReturnType<typeof regenerar>) =>
  feats.filter((f) => f.tipo !== "esboco" && r.facesPorRecurso[f.id]?.length).map((f): [string, string, number[]] => [f.id, f.nome, r.facesPorRecurso[f.id]]);

{
  const feats = caixa();
  const r = regenerar(feats);
  const c = contagem(r);
  verdade(`caixa: 12 arestas convexas, nenhuma côncava (${JSON.stringify(c)})`, c.convexa === 12 && c.concava === 0);
  const topo = r.topologia!;
  const cima = topo.arestas.findIndex((a) => a.geom === "linha" && a.a[2] > 99.9 && a.b[2] > 99.9);
  const ops = opcoesSelecaoRapida({ malha: r.malha!, topo, aresta: cima, facesPorRecurso: recursos(feats, r), rotuloFace: (f) => (topo.faces[f].geom === "plano" ? "face plana" : "face") });
  const porId = Object.fromEntries(ops.map((o) => [o.id.split(":")[0] === "face" ? `face${ops.indexOf(o)}` : o.id.split(":")[0], o]));
  verdade("aresta de cima: duas opções de face com 4 arestas cada", ops.filter((o) => o.id.startsWith("face:")).every((o) => o.arestas.length === 4) && ops.filter((o) => o.id.startsWith("face:")).length === 2);
  verdade("faces com o mesmo nome ganham número (face plana 1 / 2)", ops.filter((o) => o.id.startsWith("face:")).map((o) => o.rotulo).join("|") === "Arestas da face plana 1|Arestas da face plana 2");
  const fTopo = ops.find((o) => o.id.startsWith("face:") && o.arestas.every((a) => topo.arestas[a].a[2] > 99.9 && topo.arestas[a].b[2] > 99.9));
  verdade("a face de cima junta as 4 bordas de cima", !!fTopo);
  verdade("arestas do recurso: a extrusão tem as 12", porId.recurso?.arestas.length === 12 && porId.recurso.rotulo === "Arestas do Extrusão1");
  verdade("todas as convexas = 12; côncavas não aparecem (vazia)", porId.convexas?.arestas.length === 12 && !porId.concavas);
}

{
  // bolsão 20×20×10 no topo (Corte): 4 bordas convexas a mais, 8 côncavas (4 verticais + 4 do fundo)
  const feats = caixa();
  const esb2 = novoEsboco(2, { tipo: "plano", plano: "XY", deslocamento: 100 });
  op.retangulo(esb2, op.ponto(esb2, { x: -10, y: -10 }), op.ponto(esb2, { x: 10, y: 10 }));
  const corte = { ...(novaFeature("extrusao", 2) as FeatureExtrusao), nome: "Corte1", esboco: esb2.id, profundidade: 10, operacao: "cortar" as const, inverter: true };
  feats.push(esb2, corte);
  const r = regenerar(feats);
  verdade("bolsão: sem erros", !r.erros.length, r.erros.map((e) => e.mensagem).join(" | "));
  const c = contagem(r);
  verdade(`bolsão: 16 convexas e 8 côncavas (${JSON.stringify(c)})`, c.convexa === 16 && c.concava === 8);
  const topo = r.topologia!;
  const fundo = topo.arestas.findIndex((a) => a.geom === "linha" && Math.abs(a.a[2] - 90) < 1e-6 && Math.abs(a.b[2] - 90) < 1e-6);
  const ops = opcoesSelecaoRapida({ malha: r.malha!, topo, aresta: fundo, facesPorRecurso: recursos(feats, r) });
  const rec = ops.find((o) => o.id.startsWith("recurso:"));
  verdade(`aresta do fundo do bolsão: "Arestas do Corte1" com as 12 do bolsão (${rec?.rotulo} ${rec?.arestas.length})`, rec?.rotulo === "Arestas do Corte1" && rec.arestas.length === 12);
  verdade("côncavas a partir do fundo: as 8 do bolsão", ops.find((o) => o.id === "concavas")?.arestas.length === 8);
  // a prévia do próprio filete fica de fora: excluir as faces do bolsão tira as arestas delas
  const semBolsao = opcoesSelecaoRapida({ malha: r.malha!, topo, aresta: topo.arestas.findIndex((a) => a.a[2] < 1e-6 && a.b[2] < 1e-6), facesPorRecurso: recursos(feats, r), facesExcluidas: new Set(r.facesPorRecurso[corte.id]) });
  verdade("faces excluídas (prévia do filete): côncavas somem, convexas = 12", !semBolsao.some((o) => o.id === "concavas") && semBolsao.find((o) => o.id === "convexas")?.arestas.length === 12);
}

{
  // furo passante Ø20 (corte de círculo): os dois círculos são convexos; a costura do cilindro não conta
  const feats = caixa();
  const esb2 = novoEsboco(2, { tipo: "plano", plano: "XY", deslocamento: 100 });
  op.circulo(esb2, op.ponto(esb2, { x: 0, y: 0 }), 10);
  const corte = { ...(novaFeature("extrusao", 2) as FeatureExtrusao), nome: "Corte1", esboco: esb2.id, profundidade: 100, operacao: "cortar" as const, inverter: true };
  feats.push(esb2, corte);
  const r = regenerar(feats);
  verdade("furo passante: sem erros", !r.erros.length, r.erros.map((e) => e.mensagem).join(" | "));
  const c = contagem(r);
  verdade(`furo passante: 14 convexas (12 + 2 círculos), nenhuma côncava (${JSON.stringify(c)})`, c.convexa === 14 && c.concava === 0);
  const topo = r.topologia!;
  const circ = topo.arestas.findIndex((a) => a.geom === "circulo");
  const rec = opcoesSelecaoRapida({ malha: r.malha!, topo, aresta: circ, facesPorRecurso: recursos(feats, r) }).find((o) => o.id.startsWith("recurso:"));
  verdade(`círculo do furo: "Arestas do Corte1" = os 2 círculos (parede curva do Corte atribuída a ele) (${rec?.rotulo} ${rec?.arestas.length})`, rec?.rotulo === "Arestas do Corte1" && rec.arestas.length === 2);
}

{
  // filete R5 numa borda de cima: as duas bordas do filete são tangentes (nem côncava nem convexa)
  const feats = caixa();
  const r0 = regenerar(feats);
  const borda = r0.topologia!.arestas.find((a) => a.geom === "linha" && a.a[2] > 99.9 && a.b[2] > 99.9)!;
  const fil = { ...(novaFeature("filete", 1) as FeatureFilete), raio: 5, itens: [{ tipo: "aresta", ass: { ...borda } } as Referencia] };
  feats.push(fil);
  const r = regenerar(feats);
  const c = contagem(r);
  verdade(`filete: 2 bordas tangentes, nenhuma côncava (${JSON.stringify(c)})`, c.tangente === 2 && c.concava === 0);
  const topo = r.topologia!;
  // a prévia do filete: as arestas das faces dele não entram em nenhuma opção
  const fFil = new Set(r.facesPorRecurso[fil.id]);
  const outra = topo.arestas.findIndex((a, i) => a.geom === "linha" && a.a[2] < 1e-6 && a.b[2] < 1e-6 && !facesDasArestas(topo)[i].some((f) => fFil.has(f)));
  const ops = opcoesSelecaoRapida({ malha: r.malha!, topo, aresta: outra, facesPorRecurso: recursos(feats, r), facesExcluidas: fFil });
  const viz = facesDasArestas(topo);
  verdade("com a prévia do filete excluída, nenhuma opção traz aresta das faces dele", ops.every((o) => o.arestas.every((a) => viz[a].every((f) => !fFil.has(f)))));
  verdade("a face do filete fica com o Filete (para a prévia sair da seleção rápida)", fFil.size === 1);
  verdade("e a extrusão oferece só as 11 arestas que não tocam o filete", ops.find((o) => o.id.startsWith("recurso:"))?.arestas.length === 11);
}

if (falhas) {
  console.error(`\n${falhas} falha(s) na seleção dos comandos.`);
  process.exit(1);
}
console.log("\nSeleção dos comandos: tudo certo.");
