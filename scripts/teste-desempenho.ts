// Desempenho da reconstrução (P1, 24/11/2026: filete lento na Caixa 60×60 do Johann).
// 1) Kernel: esboço 60×60 → extrusão 12,5 → filete R6 nas 4 arestas verticais (e nas 4 bordas de cima),
//    com e sem prévia, abaixo do limite (folga larga para o CI: o normal aqui é 30–120 ms).
// 2) Prévia em duas partes: com `previaDepois` a peça sai sem o material removido, que vem depois por
//    `calcularPreviaAdiada` (igual ao calculado junto); reconstrução nova descarta a prévia antiga.
// 3) Cliente do kernel (Worker simulado): uma reconstrução no worker por vez, a mais nova substitui a que
//    esperava, o ✓ logo depois da prévia não reconstrói de novo (resultado pronto ou ainda em voo) e os
//    outros pedidos (medir…) continuam na ordem.
import opencascade from "replicad-opencascadejs";
import { setOC } from "replicad";
import { createRequire } from "node:module";
import { novaFeature, novoEsboco, type Feature, type Referencia } from "../src/model";
import { calcularPreviaAdiada, definirSolverEsboco, regenerar, temPreviaAdiada, type ResultadoRegeneracao } from "../src/kernel/regenerar";
import * as op from "../src/esboco/operacoes";
import { SolverEsboco } from "../src/esboco/solver";

const require = createRequire(import.meta.url);
setOC(await (opencascade as any)({ locateFile: () => require.resolve("replicad-opencascadejs/wasm") }));
definirSolverEsboco(await SolverEsboco.criar());

let falhas = 0;
function verdade(nome: string, v: boolean, extra = "") {
  if (!v) falhas++;
  console.log(`${v ? "ok  " : "FALHA"} ${nome}${extra ? ` — ${extra}` : ""}`);
}
const FOLGA = Number(process.env.FOLGA ?? 1);
/** Limite por reconstrução (ms): o tablet do Johann é ~4× mais lento; o CI, às vezes 3×. */
const LIMITE = 600 * FOLGA;

// ---------- 1. Caixa 60×60 ----------
const H = 12.5;
const base = novoEsboco(1, { tipo: "plano", plano: "XZ", deslocamento: 0 });
op.retangulo(base, op.ponto(base, { x: -30, y: -30 }), op.ponto(base, { x: 30, y: 30 }));
const ex = { ...novaFeature("extrusao", 1), esboco: base.id, profundidade: H } as Feature;
const r0 = regenerar([base, ex]);
const VOL = 60 * 60 * H;
verdade("caixa 60 × 60 × 12,5", Math.abs((r0.volume ?? 0) - VOL) < 1e-3, `${r0.volume}`);
const ref = (a: any): Referencia => ({ tipo: "aresta", ass: { geom: a.geom, meio: a.meio, a: a.a, b: a.b, comprimento: a.comprimento, ...(a.nome ? { nome: a.nome } : {}) } } as Referencia);
const arestas = r0.topologia!.arestas as any[];
const verticais = arestas.filter((a) => Math.abs(a.a[1] - a.b[1]) > 1).map(ref);
const deCima = arestas.filter((a) => Math.abs(a.a[1] - H) < 1e-6 && Math.abs(a.b[1] - H) < 1e-6).map(ref);
verdade("4 arestas verticais e 4 bordas de cima", verticais.length === 4 && deCima.length === 4, `${verticais.length}/${deCima.length}`);

const filete = (itens: Referencia[], raio: number) => ({ ...novaFeature("filete", 2), raio, itens } as Feature);
const medir = (fs: Feature[], previa?: string, previaDepois?: boolean) => {
  let melhor = Infinity, r: ResultadoRegeneracao | null = null;
  for (let i = 0; i < 3; i++) {
    const t = performance.now();
    r = regenerar(fs, 0.05, { previa, previaDepois });
    melhor = Math.min(melhor, performance.now() - t);
  }
  return { ms: melhor, r: r! };
};
for (const [nome, itens] of [["verticais", verticais], ["bordas de cima", deCima]] as const) {
  const f = filete(itens, 6);
  const sem = medir([base, ex, f]);
  const com = medir([base, ex, f], f.id);
  const vol = nome === "verticais" ? VOL - 4 * (36 - 9 * Math.PI) * H : null;
  verdade(`filete R6 (${nome}) sem erro${vol ? " e volume = caixa − 4 cantos" : ""}`, !sem.r.erros.length && (!vol || Math.abs((sem.r.volume ?? 0) - vol) < 0.5), `${sem.r.volume} ${JSON.stringify(sem.r.erros)}`);
  verdade(`filete R6 (${nome}): reconstrução ${sem.ms.toFixed(0)} ms ≤ ${LIMITE}`, sem.ms <= LIMITE);
  verdade(`filete R6 (${nome}) com prévia: ${com.ms.toFixed(0)} ms ≤ ${LIMITE}`, com.ms <= LIMITE && !!com.r.previaRemovido?.triangulos.length);
  const e = sem.r.etapas!;
  verdade(`filete R6 (${nome}): etapas medidas (recursos ${e.recursos.toFixed(0)} · malha ${e.malha.toFixed(0)} · topologia ${e.topologia.toFixed(0)} ms)`, e.recursos > 0 && e.malha >= 0 && e.topologia >= 0);
}
{
  const f = { ...novaFeature("chanfro", 2), distancia: 1, itens: deCima } as Feature;
  const c = medir([base, ex, f], f.id);
  verdade(`chanfro 1 nas bordas de cima com prévia: ${c.ms.toFixed(0)} ms ≤ ${LIMITE}, volume certo`, c.ms <= LIMITE && Math.abs((c.r.volume ?? 0) - (VOL - 4 * 0.5 * 60)) < 2 /* cantos em esquadria: +4 × 1/3 mm³ */, `${c.r.volume}`);
}

// ---------- 2. Prévia em duas partes ----------
{
  const f = filete(verticais, 6);
  const junto = regenerar([base, ex, f], 0.05, { previa: f.id });
  const r = regenerar([base, ex, f], 0.05, { previa: f.id, previaDepois: true });
  verdade("previaDepois: a peça sai sem o material removido (e com a mesma malha)", r.previaRemovido === undefined && r.malha!.triangulos.length === junto.malha!.triangulos.length);
  verdade("previaDepois: há prévia esperando", temPreviaAdiada());
  const pr = calcularPreviaAdiada();
  verdade("material removido calculado depois = o calculado junto", !!pr && pr.triangulos.length === junto.previaRemovido!.triangulos.length, `${pr?.triangulos.length} × ${junto.previaRemovido?.triangulos.length}`);
  verdade("depois de calculada, não fica prévia esperando", !temPreviaAdiada() && calcularPreviaAdiada() === null);
  regenerar([base, ex, f], 0.05, { previa: f.id, previaDepois: true });
  regenerar([base, ex, f]);
  verdade("reconstrução nova descarta a prévia antiga", !temPreviaAdiada());
}

// ---------- 3. Cliente do kernel com Worker simulado ----------
type Msg = { tipo: string; seq: number; previa?: string; features?: Feature[] };
const postadas: Msg[] = [];
let trabalhador: { onmessage: ((ev: { data: unknown }) => void) | null } | null = null;
(globalThis as any).Worker = class {
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  constructor() {
    trabalhador = this;
  }
  postMessage(m: Msg) {
    postadas.push(m);
  }
};
const { ClienteKernel } = await import("../src/kernel/cliente");
const recebidos: { r: ResultadoRegeneracao; ms: number }[] = [];
const cli = new ClienteKernel((r, ms) => recebidos.push({ r, ms }));
const responder = (d: unknown) => trabalhador!.onmessage!({ data: d });
responder({ tipo: "pronto" });
const esperar = () => new Promise((ok) => setTimeout(ok, 0));
const resultado = (n: number) => ({ ...r0, volume: n, previaRemovido: { vertices: new Float32Array(), normais: new Float32Array(), triangulos: new Uint32Array([0, 1, 2]), arestas: new Float32Array() } }) as ResultadoRegeneracao;
const doc = (raio: number) => [base, ex, { ...filete(verticais, raio), id: "fil" } as Feature];
{
  cli.regenerar(doc(1), false, "fil");
  cli.regenerar(doc(2), false, "fil");
  cli.regenerar(doc(3), false, "fil");
  const regs = () => postadas.filter((m) => m.tipo === "regenerar");
  verdade("três toques seguidos: só o 1º vai ao worker enquanto ele trabalha", regs().length === 1);
  responder({ tipo: "regenerado", seq: regs()[0].seq, resultado: resultado(1), ms: 5 });
  verdade("a volta do 1º (antigo) não aparece; o 2º foi descartado e o 3º vai ao worker", recebidos.length === 0 && regs().length === 2 && (regs()[1].features![2] as { raio: number }).raio === 3);
  verdade("contagem: 2 ao worker, 2 descartadas (o 2º na fila e a volta do 1º)", cli.contagem.enviadas === 2 && cli.contagem.descartadas === 2, JSON.stringify(cli.contagem));
  responder({ tipo: "regenerado", seq: regs()[1].seq, resultado: resultado(3), ms: 7 });
  verdade("a volta do 3º aparece", recebidos.length === 1 && recebidos[0].r.volume === 3);
  // ✓: o mesmo documento sem prévia → resultado pronto, sem reconstruir
  cli.regenerar(doc(3), false);
  await esperar();
  verdade("✓ logo depois da prévia: nada vai ao worker e a peça vem sem o material removido", regs().length === 2 && recebidos.length === 2 && recebidos[1].r.volume === 3 && recebidos[1].r.previaRemovido === null && cli.contagem.reaproveitadas === 1);
  // documento diferente: reconstrói
  cli.regenerar(doc(4), false);
  verdade("documento mudou: vai ao worker", regs().length === 3);
  responder({ tipo: "regenerado", seq: regs()[2].seq, resultado: resultado(4), ms: 3 });
  // ✓ com a prévia ainda no worker: a volta dela é a final (sem reconstruir de novo)
  cli.regenerar(doc(5), false, "fil");
  cli.regenerar(doc(5), false);
  verdade("✓ com a prévia em voo: não manda outra", regs().length === 4);
  responder({ tipo: "regenerado", seq: regs()[3].seq, resultado: resultado(5), ms: 4 });
  const ult = recebidos[recebidos.length - 1];
  verdade("a volta da prévia em voo vale como peça final, sem o vermelho", ult.r.volume === 5 && ult.r.previaRemovido === null);
  // a prévia vermelha que chega depois de um ✓ é ignorada
  let vermelhas = 0;
  cli.aoPrevia = () => vermelhas++;
  responder({ tipo: "previa", seq: regs()[3].seq, malha: null, ms: 1 });
  verdade("prévia vermelha de um recurso já confirmado não aparece", vermelhas === 0);
  // prévia vermelha da reconstrução atual aparece
  cli.regenerar(doc(6), false, "fil");
  responder({ tipo: "regenerado", seq: regs()[4].seq, resultado: resultado(6), ms: 4 });
  responder({ tipo: "previa", seq: regs()[4].seq, malha: null, ms: 1 });
  verdade("prévia vermelha da reconstrução atual aparece", vermelhas === 1);
  // pedido de medida durante a reconstrução: espera a volta dela (ordem mantida)
  cli.regenerar(doc(7), false, "fil");
  const medida = cli.medir([]);
  verdade("medir durante a reconstrução espera na fila", !postadas.some((m) => m.tipo === "medir"));
  responder({ tipo: "regenerado", seq: regs()[5].seq, resultado: resultado(7), ms: 4 });
  const pm = postadas.find((m) => m.tipo === "medir")!;
  verdade("medir vai ao worker depois da volta", !!pm);
  responder({ tipo: "resposta", seq: pm.seq, dados: { ok: 1 } });
  verdade("a resposta da medida chega", ((await medida) as { ok: number }).ok === 1);
  // erro na reconstrução em voo não trava a fila
  cli.regenerar(doc(8), false, "fil");
  cli.regenerar(doc(9), false, "fil");
  responder({ tipo: "erro", seq: regs()[6].seq, mensagem: "falhou" });
  verdade("erro na reconstrução em voo: a seguinte vai ao worker", regs().length === 8);
}

console.log(falhas ? `\n${falhas} FALHA(S)` : "\nDesempenho: tudo certo");
process.exit(falhas ? 1 : 0);
