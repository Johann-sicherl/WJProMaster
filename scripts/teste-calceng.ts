// Teste do WJCalcEng em Node: centro de gravidade em 2D a partir de esboços do WJCAD (regiões
// fechadas, furos por aninhamento, figuras encostadas, linha que divide, arcos, elipse, spline),
// contra as fórmulas de tabela; modo massa por figura; inércia de massa; arquivo da versão 1.
import { calcular, calcularDoc, docNovo, integraisPoligono, nomearRegioes, regioesDoEsboco, validarDoc, type DocCg2d } from "../src/calceng/cg2d";
import * as op from "../src/esboco/operacoes";
import { buscarCalculadoras, MATERIAS } from "../src/calceng/modulos";
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

if (falhas) {
  console.error(`\n${falhas} falha(s) no WJCalcEng`);
  process.exit(1);
}
console.log("\nWJCalcEng: centro de gravidade 2D ok");
