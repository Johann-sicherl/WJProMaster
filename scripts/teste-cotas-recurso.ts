// Cotas do recurso no modelo (duplo clique/duplo toque no corpo ou no recurso, pedido C4 do Johann,
// 15/11/2026): todo recurso com valores editáveis (PARAMETROS_RECURSO) precisa de um lugar para mostrar
// os rótulos — as faces dele na peça final ou, se ele não tiver faces próprias (corpo movido, escala,
// casca que recorta tudo…), o lugar de reserva calculado por `lugarDasCotas`. Também a relação com a
// aresta externa (linha sobre a aresta da peça no 2º esboço sobre a face) e a validação dos valores
// digitados no modelo (ΔX negativo aceito, profundidade zero recusada).
import opencascade from "replicad-opencascadejs";
import { setOC } from "replicad";
import { createRequire } from "node:module";
import { novaFeature, novoEsboco, type Feature, type FeatureEsboco, type FeatureExtrusao, type Referencia } from "../src/model";
import { definirSolverEsboco, regenerar } from "../src/kernel/regenerar";
import * as op from "../src/esboco/operacoes";
import { criarExterna, projetar } from "../src/esboco/externas";
import { referencial } from "../src/esboco/referencial";
import { SolverEsboco } from "../src/esboco/solver";
import { aplicarAutoModelo } from "../src/esboco/relacoesAuto";
import { PARAMETROS_RECURSO } from "../src/configuracoes";
import { valorAceito } from "../src/ui/esquemas";
import { lugarDasCotas } from "../src/cotasRecurso";

const require = createRequire(import.meta.url);
setOC(await (opencascade as any)({ locateFile: () => require.resolve("replicad-opencascadejs/wasm") }));
const solver = await SolverEsboco.criar();
definirSolverEsboco(solver);

let falhas = 0;
function verdade(nome: string, v: boolean, extra = "") {
  if (!v) falhas++;
  console.log(`${v ? "ok  " : "FALHA"} ${nome}${!v && extra ? ` — ${extra}` : ""}`);
}

function retangulo(w: number, h: number, plano: "XY" | "XZ" | "YZ" = "XY", cx = 0, cy = 0): FeatureEsboco {
  const e = novoEsboco(1, { tipo: "plano", plano, deslocamento: 0 });
  op.retangulo(e, op.ponto(e, { x: cx - w / 2, y: cy - h / 2 }), op.ponto(e, { x: cx + w / 2, y: cy + h / 2 }));
  return e;
}
const ext = (esb: FeatureEsboco, prof: number, mod: Partial<FeatureExtrusao> = {}): FeatureExtrusao => ({
  ...(novaFeature("extrusao", 1) as FeatureExtrusao), esboco: esb.id, profundidade: prof, ...mod,
});
const f = <T extends Feature["tipo"]>(tipo: T, o: object) => ({ ...(novaFeature(tipo, 1) as any), ...o }) as Feature;

// caixa 40 × 20 × 10 (Z) e as referências que os recursos usam
const base = retangulo(40, 20);
const bloco = ext(base, 10);
const r0 = regenerar([base, bloco]);
const topo0 = r0.topologia!;
const faceDe = (n: [number, number, number], perto: [number, number, number]): Referencia => {
  const fs = topo0.faces.filter((x) => x.normal && x.normal.every((v, i) => Math.abs(v - n[i]) < 1e-6));
  fs.sort((a, b) => Math.hypot(...a.centro.map((v, i) => v - perto[i])) - Math.hypot(...b.centro.map((v, i) => v - perto[i])));
  return { tipo: "face", ass: fs[0] };
};
const topo = faceDe([0, 0, 1], [0, 0, 10]);
const lados = [faceDe([1, 0, 0], [20, 0, 5]), faceDe([-1, 0, 0], [-20, 0, 5])];
const verticais = topo0.arestas.filter((a) => a.geom === "linha" && Math.abs(a.a[2] - a.b[2]) > 5).map((ass): Referencia => ({ tipo: "aresta", ass }));

// 2º esboço sobre a face de cima + ressalto (o caso do relato) e corte
const sobre = novoEsboco(2, { tipo: "face", origem: [0, 0, 10], normal: [0, 0, 1], eixoX: [1, 0, 0], face: topo.tipo === "face" ? topo.ass : undefined });
op.retangulo(sobre, op.ponto(sobre, { x: -5, y: -5 }), op.ponto(sobre, { x: 5, y: 5 }));
const ressalto = ext(sobre, 8);
const furoEsb = novoEsboco(3, { tipo: "face", origem: [0, 0, 10], normal: [0, 0, 1], eixoX: [1, 0, 0] });
op.circulo(furoEsb, op.ponto(furoEsb, { x: 14, y: 0 }), 2);
const corte = ext(furoEsb, 5, { operacao: "cortar", inverter: true });
const pos = novoEsboco(4, { tipo: "face", origem: [0, 0, 10], normal: [0, 0, 1], eixoX: [1, 0, 0] });
op.pontoSolto(pos, op.ponto(pos, { x: -14, y: 0 }));

// ---------- 1. todo recurso com valores tem onde mostrar as cotas ----------
const casos: [string, Feature[]][] = [
  ["extrusão (base)", [base, bloco]],
  ["extrusão sobre a face (ressalto)", [base, bloco, sobre, ressalto]],
  ["corte", [base, bloco, furoEsb, corte]],
  ["revolução", (() => {
    const e = novoEsboco(5, { tipo: "plano", plano: "XY", deslocamento: 0 });
    op.retangulo(e, op.ponto(e, { x: 5, y: 0 }), op.ponto(e, { x: 10, y: 10 }));
    const l = op.linha(e, op.ponto(e, { x: 0, y: 0 }), op.ponto(e, { x: 0, y: 10 }), true);
    return [e, f("revolucao", { esboco: e.id, angulo: 270, eixo: { tipo: "linhaEsboco", esboco: e.id, geo: l.id } })];
  })()],
  ["filete", [base, bloco, f("filete", { raio: 2, itens: verticais })]],
  ["chanfro", [base, bloco, f("chanfro", { distancia: 1, itens: verticais })]],
  ["casca", [base, bloco, f("casca", { espessura: 1, faces: [topo] })]],
  ["inclinação", [base, bloco, f("inclinacao", { angulo: 3, faces: lados, planoNeutro: { tipo: "plano", id: "XY" } })]],
  ["mover face", [base, bloco, f("moverFace", { distancia: 2, faces: [topo] })]],
  ["domo", [base, bloco, f("domo", { altura: 3, faces: [topo] })]],
  ["escala", [base, bloco, f("escala", { fator: 1.5 })]],
  ["mover corpo", [base, bloco, f("moverCorpo", { dx: -20 })]],
  ["furo", [base, bloco, pos, f("furo", { esboco: pos.id, tamanho: "M6", tipoFuro: "simples", condicao: { tipo: "passante", profundidade: 10, anguloPonta: 118 } })]],
  ["furo cego", [base, bloco, pos, f("furo", { esboco: pos.id, tamanho: "M6", tipoFuro: "simples", condicao: { tipo: "cego", profundidade: 6, anguloPonta: 118 } })]],
  ["padrão linear", [base, bloco, furoEsb, corte, f("padraoLinear", { recursos: [corte.id], dir1: { ref: { tipo: "eixo", id: "X" }, inverter: true, espacamento: 8, instancias: 3 } })]],
  ["padrão circular", [base, bloco, furoEsb, corte, f("padraoCircular", { recursos: [corte.id], eixo: { tipo: "eixo", id: "Z" }, instancias: 2, angulo: 360, igual: true })]],
  ["plano de referência", [base, bloco, f("planoRef", { id: "pl", ref1: { tipo: "plano", id: "XY" }, distancia: 25 })]],
];
for (const [nome, feats] of casos) {
  const r = regenerar(feats);
  verdade(`${nome}: sem erros`, !r.erros.length, r.erros.map((e) => e.mensagem).join(" | "));
  // todos os recursos com valores (inclusive os anteriores, que podem ter perdido as faces para este)
  for (const g of feats) {
    if (!PARAMETROS_RECURSO[g.tipo]?.length) continue;
    const lugar = lugarDasCotas(g, feats, r.facesPorRecurso, r.referencias, (fs) => (fs.length ? [0, 0, 0] : null));
    verdade(`${nome} → ${g.nome}: tem onde mostrar as cotas (${lugar?.origem ?? "nenhum"})`, !!lugar);
  }
}
// a extrusão base não perde o lugar quando um recurso depois dela fica com as faces dela
{
  const feats = [base, bloco, f("moverCorpo", { dx: -20 })];
  const r = regenerar(feats);
  const lugar = lugarDasCotas(bloco, feats, r.facesPorRecurso, r.referencias, () => null)!;
  verdade("mover corpo depois: D1 da extrusão vai para a ponta da extrusão (esboço + profundidade)", lugar?.origem === "esboço" && Math.abs(lugar.pos[2] - 10) < 1e-6, JSON.stringify(lugar));
}

// a causa do relato: depois do Mover corpo (e da Escala) as faces continuam da extrusão que as criou
for (const [nome, mov] of [["mover corpo ΔX = −20", f("moverCorpo", { dx: -20 })], ["mover corpo girando 30° em Z", f("moverCorpo", { rz: 30, dy: 5 })], ["escala 1,5", f("escala", { fator: 1.5 })], ["mover corpo com 2 cópias", f("moverCorpo", { dx: 50, copiar: true, copias: 2 })]] as [string, Feature][]) {
  const r = regenerar([base, bloco, mov]);
  const nB = r.facesPorRecurso[bloco.id]?.length ?? 0, nM = r.facesPorRecurso[mov.id]?.length ?? 0;
  const total = r.topologia!.faces.length;
  verdade(`${nome}: as ${total} faces continuam da Extrusão1 (extrusão ${nB}, movimento ${nM})`, nB === total && nM === 0);
}

// ---------- 2. valor digitado no modelo: conforme o campo ----------
const nf = (tipo: Feature["tipo"]) => novaFeature(tipo, 1) as Feature;
verdade("ΔX = −20 aceito no Mover corpo", valorAceito(nf("moverCorpo"), "dx", -20));
verdade("Ângulo Z = −45 aceito no Mover corpo", valorAceito(nf("moverCorpo"), "rz", -45));
verdade("D1 = 0 recusado na extrusão", !valorAceito(nf("extrusao"), "profundidade", 0));
verdade("D1 = −5 recusado na extrusão", !valorAceito(nf("extrusao"), "profundidade", -5));
verdade("D1 = 12,5 aceito na extrusão", valorAceito(nf("extrusao"), "profundidade", 12.5));
verdade("instâncias = 0 recusado", !valorAceito(nf("padraoLinear"), "dir1.instancias", 0));
verdade("instâncias = 2,5 recusado (contagem)", !valorAceito(nf("padraoCircular"), "instancias", 2.5));
verdade("distância do plano pode ser negativa (o painel aceita)", valorAceito(nf("planoRef"), "distancia", -10));
verdade("inclinação: o painel pede ≥ 0,1° (negativa recusada)", !valorAceito(nf("inclinacao"), "angulo", -3));
verdade("ângulo da revolução até 360°", valorAceito(nf("revolucao"), "angulo", 360) && !valorAceito(nf("revolucao"), "angulo", 361));
verdade("NaN recusado", !valorAceito(nf("moverCorpo"), "dx", NaN));

// ---------- 3. linha sobre a aresta da peça no esboço sobre a face: relação com a referência ----------
{
  const r = regenerar([base, bloco]);
  const e = novoEsboco(6, { tipo: "face", origem: [0, 0, 10], normal: [0, 0, 1], eixoX: [1, 0, 0] });
  const refEsb = referencial(e.suporte);
  const arestas = r.topologia!.arestas.filter((a) => a.geom === "linha").map((ass) => ({ ref: { tipo: "aresta", ass } as Referencia }))
    .flatMap((c) => {
      const proj = projetar(c.ref, refEsb);
      return proj?.tipo === "linha" ? [{ ...c, proj }] : [];
    });
  // linha solta um pouco ao lado da borda y = 10 (sem encaixe nas pontas)
  const l = op.linha(e, op.ponto(e, { x: -12, y: 10.2 }), op.ponto(e, { x: 8, y: 10.1 }));
  const criadas = aplicarAutoModelo(e, solver, [l.id], arestas, 0.5, criarExterna);
  const ext1 = e.geos.find((g) => g.externa);
  verdade("linha sobre a aresta: cria a referência e Colinear com ela", criadas === 1 && !!ext1 && e.restricoes.some((x) => x.tipo === "colinear" && [x.a, x.b].includes(l.id) && [x.a, x.b].includes(ext1!.id)),
    e.restricoes.map((x) => `${x.tipo}:${x.a}/${x.b}`).join(" "));
  const res = solver.resolver(e);
  verdade("linha foi para a aresta (y = 10) sem conflito", res.ok && !res.conflitantes.length && [l.p1, l.p2].every((id) => Math.abs(e.pontos.find((q) => q.id === id)!.y - 10) < 1e-6));
  // repetir não duplica nem superdefine
  const antes = e.restricoes.length;
  aplicarAutoModelo(e, solver, [l.id], arestas, 0.5, criarExterna);
  verdade("de novo na mesma linha: nada redundante", e.restricoes.length === antes);
  // linha com as duas pontas já presas na aresta: nada a acrescentar (nunca superdefinir)
  const m = op.linha(e, op.ponto(e, { x: 20, y: -6 }), op.ponto(e, { x: 20, y: 6 }));
  const g2 = criarExterna(e, arestas.find((c) => Math.abs(c.proj.a.x - 20) < 1e-6 && Math.abs(c.proj.b.x - 20) < 1e-6)!.proj, arestas.find((c) => Math.abs(c.proj.a.x - 20) < 1e-6 && Math.abs(c.proj.b.x - 20) < 1e-6)!.ref);
  op.restringir(e, { tipo: "coincidente", a: m.p1, b: g2.id });
  op.restringir(e, { tipo: "coincidente", a: m.p2, b: g2.id });
  const n0 = e.restricoes.length;
  aplicarAutoModelo(e, solver, [m.id], arestas, 0.5, criarExterna);
  const r2 = solver.resolver(e);
  verdade("pontas já presas: nenhuma relação a mais, sem conflito nem redundância", e.restricoes.length === n0 && r2.ok && !r2.conflitantes.length && !r2.redundantes.length);
  // longe da aresta: nada
  const k = op.linha(e, op.ponto(e, { x: -5, y: 0 }), op.ponto(e, { x: 5, y: 0.1 }));
  verdade("linha longe das arestas: nenhuma relação com a peça", aplicarAutoModelo(e, solver, [k.id], arestas, 0.5, criarExterna) === 0);
}

console.log(falhas ? `\n${falhas} FALHA(S)` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
