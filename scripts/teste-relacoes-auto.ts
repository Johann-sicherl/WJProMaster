// Teste em Node das relações automáticas do esboço (src/esboco/relacoesAuto.ts): qual relação a linha
// nova ganha (H/V, colinear, paralela, perpendicular, ±1°), sem redundância nem conflito, e o
// Coincidente / "sobre a curva" ao soltar um ponto arrastado.
import { novoEsboco, type FeatureEsboco } from "../src/model";
import { SolverEsboco } from "../src/esboco/solver";
import * as op from "../src/esboco/operacoes";
import { ORIGEM } from "../src/esboco/geometria";
import { alvoDoArraste, aplicarAutoLinha, candidatosLinha, LINHA_NOVA, tentarRelacao } from "../src/esboco/relacoesAuto";

const solver = await SolverEsboco.criar();
let falhas = 0;
function verdade(nome: string, v: boolean) {
  if (!v) falhas++;
  console.log(`${v ? "ok  " : "FALHA"} ${nome}`);
}
const plano = () => novoEsboco(1, { tipo: "plano", plano: "XY", deslocamento: 0 });
const rad = (g: number) => (g * Math.PI) / 180;
const polar = (r: number, g: number) => ({ x: r * Math.cos(rad(g)), y: r * Math.sin(rad(g)) });
/** Linha nova de a até b (pontos novos ou existentes), como o editor faz ao soltar. */
function linhaNova(e: FeatureEsboco, a: { x: number; y: number } | string, b: { x: number; y: number } | string) {
  const pa = typeof a === "string" ? a : op.ponto(e, a);
  const pb = typeof b === "string" ? b : op.ponto(e, b);
  return op.linha(e, pa, pb);
}
const tipos = (e: FeatureEsboco) => e.restricoes.map((r) => r.tipo).sort().join(",");
const TOL = 1.5; // raio de encaixe em mm

// 1. Quase horizontal (0,6°) → Horizontal; 2° fora → nada
{
  const e = plano();
  const l = linhaNova(e, { x: 10, y: 10 }, { x: 10 + 40 * Math.cos(rad(0.6)), y: 10 + 40 * Math.sin(rad(0.6)) });
  const gl0 = solver.resolver(e).gl;
  const c = aplicarAutoLinha(e, solver, l.id, TOL);
  const r = solver.resolver(e);
  verdade("linha a 0,6° ganha Horizontal e perde 1 grau de liberdade", c?.r.tipo === "horizontal" && r.gl === gl0 - 1 && !r.redundantes.length);
  const e2 = plano();
  const l2 = linhaNova(e2, { x: 0, y: 5 }, polar(40, 2));
  verdade("linha a 2° não ganha relação (tolerância ±1°)", !aplicarAutoLinha(e2, solver, l2.id, TOL) && !e2.restricoes.length);
  const e3 = plano();
  const l3 = linhaNova(e3, { x: 3, y: 0 }, { x: 3.4, y: 50 });
  verdade("linha quase vertical (0,46°) ganha Vertical", aplicarAutoLinha(e3, solver, l3.id, TOL)?.r.tipo === "vertical");
}

// 2. Paralela a uma linha inclinada existente (30° e 30,5°)
{
  const e = plano();
  linhaNova(e, { x: 0, y: 0 }, polar(50, 30));
  const l = linhaNova(e, { x: 20, y: -10 }, { x: 20 + polar(40, 30.5).x, y: -10 + polar(40, 30.5).y });
  const c = aplicarAutoLinha(e, solver, l.id, TOL);
  verdade("linha a 30,5° perto de outra a 30° ganha Paralela", c?.r.tipo === "paralelo" && tipos(e) === "paralelo");
}

// 3. Colinear com uma linha solta na mesma reta (dentro do raio de encaixe)
{
  const e = plano();
  const base = linhaNova(e, { x: 0, y: 0 }, polar(30, 20));
  const a = polar(45, 20), b = polar(80, 20.3);
  const l = linhaNova(e, { x: a.x, y: a.y + 0.3 }, b);
  const c = aplicarAutoLinha(e, solver, l.id, TOL);
  verdade("linha na mesma reta de outra (solta) ganha Colinear", c?.r.tipo === "colinear" && c.ref === base.id);
  const r = solver.resolver(e);
  verdade("colinear resolve sem redundância", r.ok && !r.redundantes.length && !r.conflitantes.length);
}

// 4. Perpendicular só com linha ligada (canto); solta e longe não ganha perpendicular
{
  const e = plano();
  const L1 = linhaNova(e, { x: 0, y: 0 }, polar(40, 30));
  const l = linhaNova(e, L1.p2, { x: polar(40, 30).x + polar(25, 120.6).x, y: polar(40, 30).y + polar(25, 120.6).y });
  const c = aplicarAutoLinha(e, solver, l.id, TOL);
  verdade("linha ligada a outra a 90,6° ganha Perpendicular", c?.r.tipo === "perpendicular");
  const e2 = plano();
  linhaNova(e2, { x: 0, y: 0 }, polar(40, 30));
  const l2 = linhaNova(e2, { x: 100, y: 100 }, { x: 100 + polar(25, 120.6).x, y: 100 + polar(25, 120.6).y });
  verdade("linha solta a 90,6° de outra não ganha Perpendicular", !aplicarAutoLinha(e2, solver, l2.id, TOL));
}

// 5. Retângulo desenhado linha a linha: H, V, H e a última fecha com V (4 relações, 4 graus livres, sem redundância)
{
  const e = plano();
  const p = [op.ponto(e, { x: 0.2, y: 0.1 }), op.ponto(e, { x: 60, y: 0.3 }), op.ponto(e, { x: 60.4, y: 40 }), op.ponto(e, { x: 0.3, y: 40.2 })];
  const criadas = p.map((a, i) => aplicarAutoLinha(e, solver, op.linha(e, a, p[(i + 1) % 4]).id, TOL)?.r.tipo);
  const r = solver.resolver(e);
  verdade(`retângulo à mão: H, V, H, V (${criadas.join(", ")})`, criadas.join(",") === "horizontal,vertical,horizontal,vertical");
  verdade("retângulo à mão: 4 graus de liberdade e nenhuma redundância", r.gl === 4 && !r.redundantes.length && !r.conflitantes.length);
}

// 6. Nunca redundante: linha entre dois pontos fixos na mesma altura não ganha H (não tiraria grau de liberdade)
{
  const e = plano();
  const a = op.ponto(e, { x: 0, y: 10 }), b = op.ponto(e, { x: 50, y: 10 });
  op.restringir(e, { tipo: "fixo", a, x: 0, y: 10 });
  op.restringir(e, { tipo: "fixo", a: b, x: 50, y: 10 });
  const l = op.linha(e, a, b);
  const n0 = e.restricoes.length;
  verdade("linha entre pontos fixos: H recusada (redundante)", !aplicarAutoLinha(e, solver, l.id, TOL) && e.restricoes.length === n0);
  const r = solver.resolver(e);
  verdade("…e o esboço segue sem redundância", r.ok && !r.redundantes.length);
  // já tem H: a candidata H repetida é recusada
  const e2 = plano();
  const l2 = linhaNova(e2, { x: 0, y: 0 }, { x: 30, y: 0 });
  op.restringir(e2, { tipo: "horizontal", a: l2.id });
  verdade("linha que já é Horizontal não ganha outra H", !aplicarAutoLinha(e2, solver, l2.id, TOL) && e2.restricoes.length === 1);
}

// 7. Colinear com linha ligada vira Paralela (colinear seria redundante no ponto comum)
{
  const e = plano();
  const L1 = linhaNova(e, { x: 0, y: 0 }, polar(30, 25));
  const fim = polar(30, 25);
  const l = linhaNova(e, L1.p2, { x: fim.x + polar(20, 25.4).x, y: fim.y + polar(20, 25.4).y });
  const cs = candidatosLinha(e, fim, { x: fim.x + polar(20, 25.4).x, y: fim.y + polar(20, 25.4).y }, { pontas: [L1.p2], ignorar: l.id, tol: TOL });
  verdade("continuação de uma linha: Colinear não é proposta (já ligada)", !cs.some((c) => c.r.tipo === "colinear"));
  verdade("continuação de uma linha ganha Paralela", aplicarAutoLinha(e, solver, l.id, TOL)?.r.tipo === "paralelo");
}

// 8. Prévia: candidata com o marcador da linha nova (antes de existir)
{
  const e = plano();
  const c = candidatosLinha(e, { x: 0, y: 0 }, { x: 40, y: 0.2 }, { tol: TOL })[0];
  verdade("prévia: H proposta para a linha ainda não criada", c?.r.tipo === "horizontal" && (c.r as { a: string }).a === LINHA_NOVA);
}

// 9. Arrastar e soltar: ponto sobre ponto → Coincidente; sobre linha → sobre a curva; a própria linha não conta
{
  const e = plano();
  const L1 = linhaNova(e, { x: 0, y: 0 }, { x: 40, y: 0 });
  const L2 = linhaNova(e, { x: 50, y: 20 }, { x: 70, y: 40 });
  op.restringir(e, { tipo: "horizontal", a: L1.id });
  // arrasta a ponta L2.p1 até perto de L1.p2
  const alvo = alvoDoArraste(e, L2.p1, { x: 40.6, y: 0.4 }, TOL);
  verdade("soltar perto de outra ponta: Coincidente com ela", alvo?.r.tipo === "coincidente" && (alvo.r as { b: string }).b === L1.p2 && alvo.p?.x === 40);
  verdade("alvo devolve só a posição (sem o id do ponto alvo, que trocaria o ponto arrastado)", !!alvo?.p && !("id" in alvo.p));
  // durante o arraste o ponto já fica encaixado no alvo (o editor resolve com ele puxado para lá)
  solver.resolver(e, { pontos: [{ ...alvo!.p!, id: L2.p1 }] });
  verdade("…e o solver aceita", !!alvo && !!tentarRelacao(e, solver, alvo.r));
  const pts = new Map(e.pontos.map((q) => [q.id, q]));
  verdade("…e as pontas ficam juntas", Math.hypot(pts.get(L2.p1)!.x - pts.get(L1.p2)!.x, pts.get(L2.p1)!.y - pts.get(L1.p2)!.y) < 1e-6);
  const sobre = alvoDoArraste(e, L2.p2, { x: 20, y: 0.5 }, TOL);
  verdade("soltar sobre uma linha: Sobre a curva", sobre?.r.tipo === "coincidente" && (sobre.r as { b: string }).b === L1.id && sobre.rotulo === "Sobre a curva");
  verdade("a outra ponta da própria linha não é alvo", alvoDoArraste(e, L2.p2, { x: 40, y: 0 }, TOL)?.ref !== L2.p1);
  verdade("perto da origem: Coincidente com a origem", alvoDoArraste(e, L2.p2, { x: 0.3, y: -0.2 }, 0.1) === null
    && alvoDoArraste(plano(), "x", { x: 0.3, y: -0.2 }, TOL)?.ref === ORIGEM);
  verdade("ponto já coincidente não é alvo de novo", alvoDoArraste(e, L2.p1, { x: 40, y: 0 }, TOL)?.ref !== L1.p2);
}

// 10. Conflito: soltar um ponto fixo sobre outro ponto fixo é recusado e nada se mexe
{
  const e = plano();
  const a = op.ponto(e, { x: 0, y: 0 }), b = op.ponto(e, { x: 1, y: 0 });
  op.linha(e, a, op.ponto(e, { x: -10, y: 5 }));
  op.linha(e, b, op.ponto(e, { x: 10, y: 5 }));
  op.restringir(e, { tipo: "fixo", a, x: 0, y: 0 });
  op.restringir(e, { tipo: "fixo", a: b, x: 1, y: 0 });
  solver.resolver(e);
  const antes = JSON.stringify(e.pontos);
  const n0 = e.restricoes.length;
  verdade("Coincidente entre dois pontos fixos: recusado (conflito)", !tentarRelacao(e, solver, { tipo: "coincidente", a, b }) && e.restricoes.length === n0);
  verdade("…e as posições voltam como estavam", JSON.stringify(e.pontos) === antes);
}

// 11. Desfazer: a linha e a relação automática dela saem juntas (mesmo passo)
{
  const e = plano();
  const foto = JSON.stringify(e);
  const l = linhaNova(e, { x: 0, y: 3 }, { x: 30, y: 3.2 });
  aplicarAutoLinha(e, solver, l.id, TOL);
  const desfeito = JSON.parse(foto) as FeatureEsboco;
  verdade("desfazer o passo leva a linha e a relação automática", e.restricoes.length === 1 && !desfeito.geos.length && !desfeito.restricoes.length);
}

console.log(falhas ? `\n${falhas} falha(s) nas relações automáticas` : "\nrelações automáticas: tudo certo");
if (falhas) process.exit(1);
