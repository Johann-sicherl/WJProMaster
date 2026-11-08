// Teste do WJCalcEng em Node: centro de gravidade em 2D a partir de esboços do WJCAD (regiões
// fechadas, furos por aninhamento, figuras encostadas, linha que divide, arcos, elipse, spline),
// contra as fórmulas de tabela; modo massa por figura; inércia de massa; arquivo da versão 1.
import { calcular, calcularDoc, docNovo, integraisPoligono, nomearRegioes, regioesDoEsboco, validarDoc, type DocCg2d } from "../src/calceng/cg2d";
import * as op from "../src/esboco/operacoes";
import { buscarCalculadoras, MATERIAS } from "../src/calceng/modulos";
import { CALCULADORAS, fracao, valoresDe, type Valores } from "../src/calceng/calculadoras";
import type { FeatureEsboco } from "../src/model";

let falhas = 0;
function igual(nome: string, obtido: unknown, esperado: unknown, tol = 1e-9) {
  const ok = typeof esperado === "number" && typeof obtido === "number" ? Math.abs(obtido - esperado) <= tol * Math.max(1, Math.abs(esperado)) : String(obtido) === String(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "ok  " : "FALHA"} ${nome}: ${String(obtido)}${ok ? "" : ` (esperado ${String(esperado)})`}`);
}
const PI = Math.PI;
const novo = (): DocCg2d => ({ ...docNovo().cg2d, material: { modo: "densidade", densidade: 7850, espessura: 10 } });
const P = (e: FeatureEsboco, x: number, y: number) => op.ponto(e, { x, y });
const ret = (e: FeatureEsboco, x0: number, y0: number, x1: number, y1: number) => op.retangulo(e, P(e, x0, y0), P(e, x1, y1));
function poli(e: FeatureEsboco, pts: [number, number][]) {
  const ids = pts.map(([x, y]) => P(e, x, y));
  ids.forEach((id, i) => op.linha(e, id, ids[(i + 1) % ids.length]));
  return ids;
}

// --- retângulo 100 × 50 ---
{
  const d = novo();
  ret(d.esboco, 0, 0, 100, 50);
  const r = calcularDoc(d);
  const f = r.figuras[0];
  igual("retângulo: uma região", r.figuras.length, 1);
  igual("retângulo: área", f.A, 5000);
  igual("retângulo: x̄", f.x, 50);
  igual("retângulo: ȳ", f.y, 25);
  igual("retângulo: Ix' = b·h³/12", f.Ix, (100 * 50 ** 3) / 12);
  igual("retângulo: Iy' = h·b³/12", f.Iy, (50 * 100 ** 3) / 12);
  igual("retângulo: Ixy' = 0", f.Ixy, 0);
  igual("retângulo: massa = ρ·t·A", r.m, 7850 * 10 * 5000 * 1e-9);
  igual("retângulo: Ix na origem = b·h³/3", r.areaOrigem!.Ix, (100 * 50 ** 3) / 3);
  igual("retângulo: Iz de massa (placa)", r.massaCg!.Iz, (r.m * (100 ** 2 + 50 ** 2)) / 12);
  igual("retângulo: nome padrão", f.nome, "Figura 1");
}

// --- círculo, semicírculo (arco + linha), quarto de círculo ---
{
  const d = novo();
  op.circulo(d.esboco, P(d.esboco, 5, -3), 10);
  const c = calcularDoc(d).figuras[0];
  igual("círculo: área", c.A, PI * 100);
  igual("círculo: centro x", c.x, 5);
  igual("círculo: centro y", c.y, -3);
  igual("círculo: I = π·r⁴/4", c.Ix, (PI * 1e4) / 4);

  const s = novo();
  const ini = P(s.esboco, 10, 0), fim = P(s.esboco, -10, 0);
  op.arco(s.esboco, P(s.esboco, 0, 0), ini, fim);
  op.linha(s.esboco, fim, ini);
  const fs = calcularDoc(s).figuras[0];
  igual("semicírculo: área", fs.A, (PI * 100) / 2);
  igual("semicírculo: ȳ = 4r/3π", fs.y, 40 / (3 * PI));
  igual("semicírculo: x̄ = 0", fs.x, 0);
  igual("semicírculo: Ix' = (π/8 − 8/9π)·r⁴", fs.Ix, (PI / 8 - 8 / (9 * PI)) * 1e4);
  igual("semicírculo: Iy' = π·r⁴/8", fs.Iy, (PI * 1e4) / 8);

  const q = novo();
  const o = P(q.esboco, 0, 0), a = P(q.esboco, 10, 0), b = P(q.esboco, 0, 10);
  op.linha(q.esboco, o, a);
  op.arco(q.esboco, o, a, b);
  op.linha(q.esboco, b, o);
  const fq = calcularDoc(q).figuras[0];
  igual("quarto de círculo: x̄ = 4r/3π", fq.x, 40 / (3 * PI));
  igual("quarto de círculo: ȳ = 4r/3π", fq.y, 40 / (3 * PI));
  igual("quarto de círculo: Ix (origem) = π·r⁴/16", fq.Ix + fq.A * fq.y ** 2, (PI * 1e4) / 16);
}

// --- triângulo retângulo b = 30, h = 60 ---
{
  const d = novo();
  poli(d.esboco, [[0, 0], [0, 60], [30, 0]]);
  const t = calcularDoc(d).figuras[0];
  igual("triângulo: área", t.A, 900);
  igual("triângulo: x̄ = b/3", t.x, 10);
  igual("triângulo: ȳ = h/3", t.y, 20);
  igual("triângulo: Ix' = b·h³/36", t.Ix, (30 * 60 ** 3) / 36);
  igual("triângulo: Ixy' = −b²h²/72", t.Ixy, -(30 ** 2 * 60 ** 2) / 72);
}

// --- chapa 100 × 100 com furo Ø40 fora do centro: o círculo de dentro é furo ---
{
  const d = novo();
  ret(d.esboco, 0, 0, 100, 100);
  op.circulo(d.esboco, P(d.esboco, 70, 50), 20);
  const r = calcularDoc(d);
  const Af = PI * 400, A = 1e4 - Af;
  igual("furo: duas regiões", r.figuras.length, 2);
  igual("furo: o círculo é furo", r.figuras.find((f) => f.A < 2000)!.furo, true);
  igual("furo: área líquida", r.A, A);
  igual("furo: X = ΣA·x/ΣA", r.cg!.x, (1e4 * 50 - Af * 70) / A);
  igual("furo: Y = 50", r.cg!.y, 50);
  igual("furo: memória com chapa (+) e furo (−)", r.linhas.map((l) => Math.sign(l.A)).join(), "1,-1");
  igual("furo: Ix = b·h³/12 − π·r⁴/4", r.areaCentroide!.Ix, 1e8 / 12 - (PI * 20 ** 4) / 4);
  // o círculo vira sólido (peça encaixada): volta a área cheia
  const chaveFuro = r.figuras.find((f) => f.furo)!.chave;
  d.regioes[chaveFuro].furo = false;
  const r2 = calcularDoc(d);
  igual("furo → sólido: área cheia", r2.A, 1e4);
  igual("furo → sólido: X = 50", r2.cg!.x, 50);
}

// --- figuras encostadas (retângulo + triângulo com vértices em comum) e linha que divide ---
{
  const d = novo();
  const e = d.esboco;
  const a = P(e, 0, 0), b = P(e, 120, 0), c = P(e, 120, 80), dd = P(e, 0, 80), t = P(e, 180, 0);
  op.linha(e, a, b);
  op.linha(e, b, c);
  op.linha(e, c, dd);
  op.linha(e, dd, a);
  op.linha(e, b, t);
  op.linha(e, t, c);
  const r = calcularDoc(d);
  igual("encostadas: duas regiões", r.figuras.length, 2);
  igual("encostadas: áreas", r.figuras.map((f) => Math.round(f.A)).sort((x, y) => x - y).join(), "2400,9600");
  igual("encostadas: X", r.cg!.x, (9600 * 60 + 2400 * 140) / 12000);
  igual("encostadas: nenhuma é furo", r.figuras.some((f) => f.furo), false);

  const s = novo();
  ret(s.esboco, 0, 0, 100, 40);
  op.linha(s.esboco, P(s.esboco, 30, 0), P(s.esboco, 30, 40));
  const rs = calcularDoc(s);
  igual("linha com as pontas nas bordas divide o retângulo", rs.figuras.map((f) => Math.round(f.A)).sort((x, y) => x - y).join(), "1200,2800");
  igual("dividido: X igual ao inteiro", rs.cg!.x, 50);
  // círculo atravessando a borda: vira três regiões, área = união
  const u = novo();
  ret(u.esboco, 0, 0, 100, 100);
  op.circulo(u.esboco, P(u.esboco, 100, 50), 20);
  const ru = calcularDoc(u);
  igual("círculo sobre a borda: três regiões", ru.figuras.length, 3);
  igual("círculo sobre a borda: área da união", ru.A, 1e4 + (PI * 400) / 2);
  igual("círculo sobre a borda: X da união", ru.cg!.x, (1e4 * 50 + (PI * 200) * (100 + 80 / (3 * PI))) / (1e4 + PI * 200));
}

// --- elipse e spline fechada ---
{
  const d = novo();
  const e = d.esboco;
  const c = P(e, 10, 20);
  e.geos.push({ id: "el", tipo: "elipse", c, m1: P(e, 40, 20), n1: P(e, 10, 30) } as FeatureEsboco["geos"][number]);
  const f = calcularDoc(d).figuras[0];
  igual("elipse: área = π·a·b", f.A, PI * 30 * 10);
  igual("elipse: Ix' = π·a·b³/4", f.Ix, (PI * 30 * 1000) / 4);
  igual("elipse: Iy' = π·a³·b/4", f.Iy, (PI * 27000 * 10) / 4);
  // spline: a quadratura de Green coincide com o polígono bem fino da mesma curva
  const s = novo();
  const ids = [[0, 0], [50, -10], [80, 30], [40, 60], [0, 0]].map(([x, y]) => P(s.esboco, x, y));
  ids[4] = ids[0];
  op.spline(s.esboco, ids);
  const rs = regioesDoEsboco(s.esboco).regioes;
  igual("spline fechada: uma região", rs.length, 1);
  igual("spline fechada: área como o polígono amostrado", rs[0].contorno.A, integraisPoligono(rs[0].poligono).A, 5e-3);
}

// --- modo massa por figura ---
{
  const d = novo();
  d.material.modo = "massa";
  ret(d.esboco, 0, 0, 10, 10);
  op.circulo(d.esboco, P(d.esboco, 40, 5), 5);
  const { regioes } = regioesDoEsboco(d.esboco);
  nomearRegioes(regioes, d.regioes);
  const falta = calcular(regioes, d.regioes, d.material);
  igual("massa: sem massa não há CG", falta.cg, null);
  igual("massa: aviso", /Falta a massa/.test(falta.avisos.join()), true);
  for (const r of regioes) d.regioes[r.chave].massa = r.liquida.A > 90 ? 2 : 1;
  const r = calcularDoc(d);
  igual("massa: total", r.m, 3);
  igual("massa: X = Σm·x/Σm", r.cg!.x, (2 * 5 + 1 * 40) / 3);
  igual("massa: centroide de área é outro", r.centroide!.x, (100 * 5 + 25 * PI * 40) / (100 + 25 * PI));
  igual("massa: Iz pelo CG", r.massaCg!.Iz, (2 * 200) / 12 + 2 * (5 - r.cg!.x) ** 2 + (1 * 25) / 2 + 1 * (40 - r.cg!.x) ** 2);
}

// --- arquivo: ida e volta e conversão da versão 1 ---
{
  const d = docNovo();
  ret(d.cg2d.esboco, 0, 0, 10, 10);
  const lido = validarDoc(JSON.parse(JSON.stringify(d)));
  igual("arquivo: ida e volta", JSON.stringify(lido), JSON.stringify(d));
  const v1 = validarDoc({ versao: 1, nome: "Antigo", modulo: "cg2d", cg2d: { figuras: [{ tipo: "retangulo", x: 0, y: 0, l: 100, a: 50 }, { tipo: "setor", cx: 50, cy: 50, r: 20, a0: 0, varre: 180 }], cotas: [], material: { modo: "densidade", densidade: 7850, espessura: 1 } } });
  const r = calcularDoc(v1.cg2d);
  igual("versão 1: vira esboço com duas regiões", r.figuras.length, 2);
  igual("versão 1: área total", r.A, 5000 + (PI * 400) / 2);
  let erro = "";
  try {
    validarDoc({ formato: "outro" });
  } catch (z) {
    erro = (z as Error).message;
  }
  igual("arquivo inválido recusado", /não é um cálculo/.test(erro), true);
}

// --- catálogo por matéria e busca da lupa ---
{
  const nomes = (t: string) => buscarCalculadoras(t).flatMap((m) => m.calculadoras.map((c) => c.id)).join();
  igual("busca vazia: as quatro matérias", buscarCalculadoras("").length, 4);
  igual("busca sem acento acha 'Equação do 2º grau'", nomes("equacao 2"), "eq2");
  igual("busca por palavra-chave (bhaskara)", nomes("Bhaskara"), "eq2");
  igual("busca por 'centroide'", nomes("centróide"), "cg2d");
  igual("busca por 3x3 acha Cramer e Gauss", nomes("3x3"), "cramer,gauss,mult");
  igual("busca pelo nome da matéria", nomes("dinâmica"), "newton,plano,atrito,trabalho");
  igual("busca sem resultado", buscarCalculadoras("xyzw").length, 0);
  igual("todas as calculadoras pedidas no catálogo", MATERIAS.flatMap((m) => m.calculadoras).length, 12);
}

// --- calculadoras de álgebra, matrizes e física ---
{
  const R = (id: string, v: Valores = {}) => CALCULADORAS[id].resolver({ ...valoresDe(CALCULADORAS[id]), ...v });
  igual("fração 2,5 = 5/2", fracao(2.5), "5/2");
  igual("fração de 1/3", fracao(-1 / 3), "−1/3");
  igual("fração de π: nenhuma", fracao(Math.PI), null);
  igual("1º grau: 2x + 3 = 11 → x = 4", R("eq1").numeros.x, 4);
  igual("1º grau: 3x − 1 = x + 4 → x = 5/2", R("eq1", { a: 3, b: -1, c: 1, d: 4 }).numeros.x, 2.5);
  igual("1º grau: 0x = 0 → ℝ", R("eq1", { a: 1, b: 1, c: 1, d: 1 }).textos.solucao, "R");
  igual("1º grau: 0x = 3 → ∅", R("eq1", { a: 1, b: 1, c: 1, d: 4 }).textos.solucao, "vazio");
  const e2 = R("eq2");
  igual("2º grau: x² − 5x + 6 → Δ = 1", e2.numeros.delta, 1);
  igual("2º grau: raízes 2 e 3", `${e2.numeros.x1} ${e2.numeros.x2}`, "2 3");
  igual("2º grau: vértice (2,5; −0,25)", `${e2.numeros.xv} ${e2.numeros.yv}`, "2.5 -0.25");
  igual("2º grau: Δ < 0 → complexas −1 ± 2i", (() => { const x = R("eq2", { a: 1, b: 2, c: 5 }).numeros; return `${x.re} ${x.im}`; })(), "-1 2");
  igual("2º grau: raiz dupla", R("eq2", { a: 1, b: -4, c: 4 }).numeros.x1, 2);
  igual("2º grau com a = 0 vira 1º grau", R("eq2", { a: 0, b: 2, c: -8 }).numeros.x, 4);
  const sis = R("sistemas");
  igual("sistema 3×3: x, y, z = 1, 2, 3", [sis.numeros.x, sis.numeros.y, sis.numeros.z].map((x) => Math.round(x * 1e9) / 1e9).join(), "1,2,3");
  igual("sistema SPI", R("sistemas", { m: [[1, 1, 2], [2, 2, 4]] }).textos.tipo, "SPI");
  igual("sistema SI", R("sistemas", { m: [[1, 1, 2], [1, 1, 5]] }).textos.tipo, "SI");
  const s4 = R("sistemas", { m: [[1, 0, 0, 1, 2], [0, 2, 0, 0, 4], [0, 0, 3, 0, 9], [1, 1, 1, 0, 6]] }).numeros;
  igual("sistema 4×4", [s4["x₁"], s4["x₂"], s4["x₃"], s4["x₄"]].map((x) => Math.round(x * 1e9) / 1e9).join(), "1,2,3,1");
  const cr = R("cramer");
  igual("Cramer: D = −1", cr.numeros.D, -1);
  igual("Cramer: x, y, z = 2, 3, −1", [cr.numeros.x, cr.numeros.y, cr.numeros.z].map((x) => Math.round(x * 1e9) / 1e9).join(), "2,3,-1");
  igual("Cramer: D = 0 → SI", R("cramer", { m: [[1, 1, 1, 1], [2, 2, 2, 5], [1, 0, 1, 1]] }).textos.tipo, "SI");
  const ga = R("gauss");
  igual("Gauss: x, y, z = 2, 3, −1", [ga.numeros.x, ga.numeros.y, ga.numeros.z].map((x) => Math.round(x * 1e9) / 1e9).join(), "2,3,-1");
  igual("Gauss com pivô zero (troca de linha)", (() => { const x = R("gauss", { m: [[0, 1, 1, 5], [1, 0, 1, 4], [1, 1, 0, 3]] }).numeros; return [x.x, x.y, x.z].map((q) => Math.round(q * 1e9) / 1e9).join(); })(), "1,2,3");
  const mu = R("mult").numeros;
  igual("multiplicação (2×3)·(3×2)", [mu.c11, mu.c12, mu.c21, mu.c22].join(), "58,64,139,154");
  igual("multiplicação com dimensões erradas", R("mult", { A: [[1, 2]], B: [[1, 2]] }).avisos.length, 1);
  igual("inequação x² − 5x + 6 < 0", R("inequacoes").textos.solucao, "]2; 3[");
  igual("inequação x² − 5x + 6 ≥ 0", R("inequacoes", { op: ">=" }).textos.solucao, "]−∞; 2] ∪ [3; +∞[");
  igual("inequação −2x + 4 > 0 (1º grau, inverte)", R("inequacoes", { grau: "1", op: ">", a: -2, b: 4, c: 0 }).textos.solucao, "]−∞; 2[");
  igual("inequação x² + 1 < 0 → ∅", R("inequacoes", { a: 1, b: 0, c: 1 }).textos.solucao, "∅");
  igual("inequação (x−2)² > 0", R("inequacoes", { op: ">", a: 1, b: -4, c: 4 }).textos.solucao, "ℝ − {2}");
  igual("Newton: a = F/m = 5", R("newton", { calc: "a", F: 50, m: 10 }).numeros.a, 5);
  igual("Newton: F = m·a", R("newton", { calc: "F", m: 3, a: 4 }).numeros.F, 12);
  const fr = R("newton", { modo: "forcas", m: 10 }).numeros;
  igual("Newton: resultante 3-4-5 → 50 N", fr.R, 50);
  igual("Newton: a = 5 m/s²", fr.a, 5);
  const pl = R("plano").numeros;
  igual("plano: P∥ = m·g·sen 30°", pl.Px, 10 * 9.81 * 0.5);
  igual("plano: escorrega (tg 30° > 0,3)", pl.move, 1);
  igual("plano: a = g(sen θ − μc cos θ)", pl.a, 9.81 * (0.5 - 0.2 * Math.cos(Math.PI / 6)));
  igual("plano: parado com μe = 0,7", R("plano", { us: 0.7 }).numeros.move, 0);
  igual("plano: ângulo crítico", R("plano", { us: 1 }).numeros.thetaC, 45);
  const at = R("atrito").numeros;
  igual("atrito: 60 N > 49,05 N → move", at.move, 1);
  igual("atrito: a = (60 − 0,4·98,1)/10", at.a, (60 - 0.4 * 98.1) / 10);
  igual("atrito: força inclinada reduz a normal", R("atrito", { th: 30 }).numeros.N, 98.1 - 30);
  igual("trabalho: F·d", R("trabalho").numeros.W, 500);
  igual("trabalho: 60° → metade", R("trabalho", { th: 60 }).numeros.W, 250);
  igual("trabalho: ΔEc", R("trabalho", { modo: "cinetica" }).numeros.W, 100);
  igual("trabalho do peso na subida", R("trabalho", { modo: "peso" }).numeros.W, -2 * 9.81 * 5);
  igual("todas as calculadoras do catálogo existem", MATERIAS.flatMap((m) => m.calculadoras).every((c) => c.id === "cg2d" || CALCULADORAS[c.id]), true);
}

if (falhas) {
  console.error(`\n${falhas} falha(s) no WJCalcEng`);
  process.exit(1);
}
console.log("\nWJCalcEng: centro de gravidade 2D ok");
