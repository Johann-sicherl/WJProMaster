// Teste do WJCalcEng em Node: centro de gravidade em 2D (centroides e momentos de inércia das
// figuras básicas contra as fórmulas de tabela, figuras compostas com furo, modo massa por
// figura, inércia de massa da placa) e cotas dirigidas.
import {
  aplicarCotas, calcular, contem, docNovo, integraisDe, medir, validarDoc,
  type Cota, type DocCg2d, type Figura,
} from "../src/calceng/cg2d";

let falhas = 0;
function igual(nome: string, obtido: unknown, esperado: unknown, tol = 1e-6) {
  const ok = typeof esperado === "number" && typeof obtido === "number" ? Math.abs(obtido - esperado) <= tol * Math.max(1, Math.abs(esperado)) : String(obtido) === String(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "ok  " : "FALHA"} ${nome}: ${String(obtido)}${ok ? "" : ` (esperado ${String(esperado)})`}`);
}
const doc = (figuras: Figura[], cotas: Cota[] = [], modo: "densidade" | "massa" = "densidade"): DocCg2d => ({ figuras, cotas, material: { modo, densidade: 7850, espessura: 10 } });
const PI = Math.PI;

// --- retângulo 100 × 50 ---
{
  const r = calcular(doc([{ id: "r", nome: "R", tipo: "retangulo", x: 0, y: 0, l: 100, a: 50 }]));
  const f = r.figuras[0];
  igual("retângulo: área", f.A, 5000);
  igual("retângulo: x̄", f.x, 50);
  igual("retângulo: ȳ", f.y, 25);
  igual("retângulo: Ix' = b·h³/12", f.Ix, (100 * 50 ** 3) / 12);
  igual("retângulo: Iy' = h·b³/12", f.Iy, (50 * 100 ** 3) / 12);
  igual("retângulo: Ixy' = 0", f.Ixy, 0);
  igual("retângulo: massa = ρ·t·A", r.m, 7850 * 10 * 5000 * 1e-9);
  igual("retângulo: Ix na origem = b·h³/3", r.areaOrigem!.Ix, (100 * 50 ** 3) / 3);
  // placa: Iz = m(b² + h²)/12
  igual("retângulo: Iz de massa (placa)", r.massaCg!.Iz, (r.m * (100 ** 2 + 50 ** 2)) / 12);
}

// --- círculo, semicírculo e quarto de círculo (r = 10) ---
{
  const c = calcular(doc([{ id: "c", nome: "C", tipo: "circulo", cx: 5, cy: -3, r: 10 }])).figuras[0];
  igual("círculo: área", c.A, PI * 100);
  igual("círculo: centro", `${c.x.toFixed(9)} ${c.y.toFixed(9)}`, "5.000000000 -3.000000000");
  igual("círculo: I = π·r⁴/4", c.Ix, (PI * 1e4) / 4);
  igual("círculo: Iy = Ix", c.Iy, (PI * 1e4) / 4);
  const s = calcular(doc([{ id: "s", nome: "S", tipo: "setor", cx: 0, cy: 0, r: 10, a0: 0, varre: 180 }])).figuras[0];
  igual("semicírculo: área", s.A, (PI * 100) / 2);
  igual("semicírculo: ȳ = 4r/3π", s.y, 40 / (3 * PI));
  igual("semicírculo: x̄ = 0", s.x, 0);
  igual("semicírculo: Ix' = (π/8 − 8/9π)·r⁴", s.Ix, (PI / 8 - 8 / (9 * PI)) * 1e4);
  igual("semicírculo: Iy' = π·r⁴/8", s.Iy, (PI * 1e4) / 8);
  const q = calcular(doc([{ id: "q", nome: "Q", tipo: "setor", cx: 0, cy: 0, r: 10, a0: 0, varre: 90 }])).figuras[0];
  igual("quarto de círculo: x̄ = 4r/3π", q.x, 40 / (3 * PI));
  igual("quarto de círculo: ȳ = 4r/3π", q.y, 40 / (3 * PI));
  igual("quarto de círculo: Ix (origem) = π·r⁴/16", integraisDe({ id: "q", nome: "Q", tipo: "setor", cx: 0, cy: 0, r: 10, a0: 0, varre: 90 }).Ixx, (PI * 1e4) / 16);
}

// --- triângulo retângulo b = 30, h = 60 (polígono, sentido horário também) ---
{
  const t = calcular(doc([{ id: "t", nome: "T", tipo: "poligono", pts: [{ x: 0, y: 0 }, { x: 0, y: 60 }, { x: 30, y: 0 }] }])).figuras[0];
  igual("triângulo: área", t.A, 900);
  igual("triângulo: x̄ = b/3", t.x, 10);
  igual("triângulo: ȳ = h/3", t.y, 20);
  igual("triângulo: Ix' = b·h³/36", t.Ix, (30 * 60 ** 3) / 36);
  igual("triângulo: Iy' = h·b³/36", t.Iy, (60 * 30 ** 3) / 36);
  igual("triângulo: Ixy' = −b²h²/72", t.Ixy, -(30 ** 2 * 60 ** 2) / 72);
}

// --- chapa 100 × 100 com furo Ø40 fora do centro ---
{
  const r = calcular(doc([
    { id: "a", nome: "Chapa", tipo: "retangulo", x: 0, y: 0, l: 100, a: 100 },
    { id: "b", nome: "Furo", tipo: "circulo", cx: 70, cy: 50, r: 20, furo: true },
  ]));
  const Af = PI * 400, A = 1e4 - Af;
  igual("composto: área líquida", r.A, A);
  igual("composto: X = ΣA·x/ΣA", r.cg!.x, (1e4 * 50 - Af * 70) / A);
  igual("composto: Y = 50", r.cg!.y, 50);
  igual("composto: furo tem área negativa", r.figuras[1].A, -Af);
  const Xc = r.centroide!.x;
  const IyEsperado = 1e8 / 12 + 1e4 * (50 - Xc) ** 2 - ((PI * 20 ** 4) / 4 + Af * (70 - Xc) ** 2);
  igual("composto: Iy (eixos paralelos)", r.areaCentroide!.Iy, IyEsperado);
  igual("composto: Ix = b·h³/12 − π·r⁴/4", r.areaCentroide!.Ix, 1e8 / 12 - (PI * 20 ** 4) / 4);
}

// --- modo massa por figura ---
{
  const r = calcular(doc([
    { id: "a", nome: "A", tipo: "retangulo", x: 0, y: 0, l: 10, a: 10, massa: 2 },
    { id: "b", nome: "B", tipo: "circulo", cx: 40, cy: 5, r: 5, massa: 1 },
  ], [], "massa"));
  igual("massa: total", r.m, 3);
  igual("massa: X = Σm·x/Σm", r.cg!.x, (2 * 5 + 1 * 40) / 3);
  igual("massa: Y", r.cg!.y, 5);
  igual("massa: centroide de área é outro", r.centroide!.x, (100 * 5 + 25 * PI * 40) / (100 + 25 * PI));
  igual("massa: Iz pelo CG", r.massaCg!.Iz, (2 * 200) / 12 + 2 * (5 - r.cg!.x) ** 2 + (1 * 25) / 2 + 1 * (40 - r.cg!.x) ** 2);
  const falta = calcular(doc([{ id: "a", nome: "A", tipo: "retangulo", x: 0, y: 0, l: 10, a: 10 }], [], "massa"));
  igual("massa: sem massa informada não há CG", falta.cg, null);
  igual("massa: aviso", falta.avisos.join(), "Falta a massa de: A.");
}

// --- eixos principais (retângulo girado 30°) ---
{
  const c = Math.cos(PI / 6), s = Math.sin(PI / 6);
  const pts = [[0, 0], [60, 0], [60, 20], [0, 20]].map(([x, y]) => ({ x: x * c - y * s, y: x * s + y * c }));
  const r = calcular(doc([{ id: "p", nome: "P", tipo: "poligono", pts }]));
  igual("principais: I1 = b·h³ maior", r.areaCentroide!.I1, (20 * 60 ** 3) / 12);
  igual("principais: I2", r.areaCentroide!.I2, (60 * 20 ** 3) / 12);
  igual("principais: ângulo do eixo de I1", Math.abs(r.areaCentroide!.theta), 60, 1e-6);
}

// --- cotas dirigidas ---
{
  const d = doc([
    { id: "r", nome: "R", tipo: "retangulo", x: 0, y: 0, l: 40, a: 20 },
    { id: "c", nome: "C", tipo: "circulo", cx: 37, cy: 12, r: 3 },
  ], [
    { id: "1", tipo: "horizontal", a: { fig: null, p: "o" }, b: { fig: "c", p: "c" }, valor: 50, dirigida: true, desloc: 10 },
    { id: "2", tipo: "vertical", a: { fig: "r", p: "v0" }, b: { fig: "c", p: "c" }, valor: 30, dirigida: true, desloc: 10 },
    { id: "3", tipo: "horizontal", a: { fig: "r", p: "v0" }, b: { fig: "r", p: "v1" }, valor: 80, dirigida: true, desloc: 10 },
    { id: "4", tipo: "diametro", a: { fig: "c", p: "c" }, valor: 12, dirigida: true, desloc: 10 },
    { id: "5", tipo: "alinhada", a: { fig: "r", p: "v2" }, b: { fig: "c", p: "c" }, valor: 0, dirigida: false, desloc: 10 },
  ]);
  const conflito = aplicarCotas(d);
  const c = d.figuras[1] as Extract<Figura, { tipo: "circulo" }>;
  const r = d.figuras[0] as Extract<Figura, { tipo: "retangulo" }>;
  igual("cota: origem → centro (horizontal 50)", c.cx, 50);
  igual("cota: canto → centro (vertical 30)", c.cy, 30);
  igual("cota na mesma figura muda a largura", r.l, 80);
  igual("cota de diâmetro muda o raio", c.r, 6);
  igual("cota de referência acompanha a medida", d.cotas[4].valor, Math.hypot(80 - 50, 20 - 30));
  igual("sem conflito", conflito.size, 0);
  // o retângulo anda: o círculo cotado a partir dele acompanha (vertical), a cota da origem segura x
  r.y = 5;
  aplicarCotas(d);
  igual("cota segue a figura de referência", c.cy, 35);
  igual("medir vertical", medir(d, d.cotas[1]), 30);
  // duas cotas incompatíveis
  d.cotas.push({ id: "6", tipo: "horizontal", a: { fig: null, p: "o" }, b: { fig: "c", p: "c" }, valor: 70, dirigida: true, desloc: 10 });
  igual("conflito detectado (a cota mais nova vale)", [...aplicarCotas(d)].join(), "1");
}

// --- seleção e arquivo ---
{
  igual("contém: dentro do semicírculo", contem({ id: "s", nome: "S", tipo: "setor", cx: 0, cy: 0, r: 10, a0: 0, varre: 180 }, { x: 1, y: 5 }), true);
  igual("contém: fora do semicírculo", contem({ id: "s", nome: "S", tipo: "setor", cx: 0, cy: 0, r: 10, a0: 0, varre: 180 }, { x: 1, y: -5 }), false);
  igual("contém: triângulo", contem({ id: "t", nome: "T", tipo: "poligono", pts: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }] }, { x: 6, y: 6 }), false);
  const novo = docNovo();
  novo.cg2d.figuras.push({ id: "x", nome: "X", tipo: "circulo", cx: 1, cy: 2, r: 3 });
  const lido = validarDoc(JSON.parse(JSON.stringify(novo)));
  igual("arquivo: ida e volta", JSON.stringify(lido), JSON.stringify(novo));
  let erro = "";
  try {
    validarDoc({ formato: "outro" });
  } catch (z) {
    erro = (z as Error).message;
  }
  igual("arquivo inválido recusado", /não é um cálculo/.test(erro), true);
}

if (falhas) {
  console.error(`\n${falhas} falha(s) no WJCalcEng`);
  process.exit(1);
}
console.log("\nWJCalcEng: centro de gravidade 2D ok");
