// WJCalcEng — Centro de gravidade em 2D (motor puro, testado em scripts/teste-calceng.ts).
// Figuras planas (retângulo, círculo, setor circular, polígono/triângulo), sólidas ou furos.
// A massa vem do material único (densidade × espessura × área) ou é informada por figura.
// Saída: área, massa, centroide e momentos de inércia de cada figura e do conjunto
// (teorema dos eixos paralelos), com a memória de cálculo. Unidades: mm, kg.

export interface Ponto {
  x: number;
  y: number;
}

interface FiguraBase {
  id: string;
  nome: string;
  /** Furo (área vazia): entra com área e massa negativas. */
  furo?: boolean;
  /** Massa informada (kg), usada no modo "massa por figura". */
  massa?: number;
}
export interface Retangulo extends FiguraBase {
  tipo: "retangulo";
  /** Canto inferior esquerdo. */
  x: number;
  y: number;
  /** Largura (em x) e altura (em y), > 0. */
  l: number;
  a: number;
}
export interface Circulo extends FiguraBase {
  tipo: "circulo";
  cx: number;
  cy: number;
  r: number;
}
export interface Setor extends FiguraBase {
  tipo: "setor";
  cx: number;
  cy: number;
  r: number;
  /** Ângulo inicial (graus, anti-horário a partir de +x). */
  a0: number;
  /** Abertura (graus, 0 < varre ≤ 360). 180 = semicírculo, 90 = quarto de círculo. */
  varre: number;
}
export interface Poligono extends FiguraBase {
  tipo: "poligono";
  pts: Ponto[];
}
export type Figura = Retangulo | Circulo | Setor | Poligono;

/** Ponto de uma figura para cotas: fig null = origem. "c" = centro; "v0".. = vértices; "p0"/"p1" = extremos do arco. */
export interface RefPonto {
  fig: string | null;
  p: string;
}
export type TipoCota = "horizontal" | "vertical" | "alinhada" | "raio" | "diametro";
export interface Cota {
  id: string;
  tipo: TipoCota;
  a: RefPonto;
  /** Segundo ponto (cotas de distância). */
  b?: RefPonto;
  valor: number;
  /** Dirigida = comanda a geometria; senão, só mostra a medida (referência). */
  dirigida: boolean;
  /** Afastamento da linha de cota (mm), com sinal. */
  desloc: number;
}

export type ModoMassa = "densidade" | "massa";
export interface Material {
  modo: ModoMassa;
  /** kg/m³ */
  densidade: number;
  /** mm */
  espessura: number;
}
export interface DocCg2d {
  figuras: Figura[];
  cotas: Cota[];
  material: Material;
}

/** Documento do WJCalcEng (.wjcalc): um módulo ativo e os dados de cada módulo. */
export interface DocCalc {
  versao: 1;
  nome: string;
  modulo: "cg2d";
  cg2d: DocCg2d;
}

export const docNovo = (): DocCalc => ({
  versao: 1,
  nome: "Cálculo",
  modulo: "cg2d",
  cg2d: { figuras: [], cotas: [], material: { modo: "densidade", densidade: 7850, espessura: 1 } },
});

const num = (v: unknown, padrao: number) => (typeof v === "number" && Number.isFinite(v) ? v : padrao);

/** Confere e completa um documento lido de arquivo (lança erro se não for do WJCalcEng). */
export function validarDoc(d: unknown): DocCalc {
  const o = d as Partial<DocCalc> | null;
  if (!o || typeof o !== "object" || !o.cg2d || !Array.isArray(o.cg2d.figuras)) throw new Error("Arquivo não é um cálculo do WJCalcEng.");
  const base = docNovo();
  const m = o.cg2d.material ?? base.cg2d.material;
  const figuras: Figura[] = [];
  for (const f of o.cg2d.figuras as Figura[]) {
    if (!f || typeof f !== "object" || typeof f.id !== "string") continue;
    const comum: FiguraBase = { id: f.id, nome: String(f.nome ?? "Figura") };
    if (f.furo) comum.furo = true;
    if (typeof f.massa === "number" && Number.isFinite(f.massa)) comum.massa = f.massa;
    if (f.tipo === "retangulo") figuras.push({ ...comum, tipo: "retangulo", x: num(f.x, 0), y: num(f.y, 0), l: Math.abs(num(f.l, 10)), a: Math.abs(num(f.a, 10)) });
    else if (f.tipo === "circulo") figuras.push({ ...comum, tipo: "circulo", cx: num(f.cx, 0), cy: num(f.cy, 0), r: Math.abs(num(f.r, 10)) });
    else if (f.tipo === "setor") figuras.push({ ...comum, tipo: "setor", cx: num(f.cx, 0), cy: num(f.cy, 0), r: Math.abs(num(f.r, 10)), a0: num(f.a0, 0), varre: Math.min(360, Math.max(1e-6, num(f.varre, 180))) });
    else if (f.tipo === "poligono" && Array.isArray(f.pts) && f.pts.length >= 3) figuras.push({ ...comum, tipo: "poligono", pts: f.pts.map((p) => ({ x: num(p?.x, 0), y: num(p?.y, 0) })) });
  }
  const ids = new Set(figuras.map((f) => f.id));
  const refOk = (r: RefPonto | undefined) => !!r && (r.fig === null || ids.has(r.fig)) && typeof r.p === "string";
  const cotas = (Array.isArray(o.cg2d.cotas) ? o.cg2d.cotas : []).filter((c) => c && refOk(c.a) && (c.tipo === "raio" || c.tipo === "diametro" || refOk(c.b))).map((c) => ({
    id: String(c.id), tipo: c.tipo, a: c.a, b: c.b, valor: num(c.valor, 0), dirigida: c.dirigida !== false, desloc: num(c.desloc, 10),
  }));
  return {
    versao: 1,
    nome: String(o.nome ?? base.nome),
    modulo: "cg2d",
    cg2d: {
      figuras,
      cotas,
      material: { modo: m.modo === "massa" ? "massa" : "densidade", densidade: Math.max(0, num(m.densidade, 7850)), espessura: Math.max(0, num(m.espessura, 1)) },
    },
  };
}

// ---------------------------------------------------------------------------------------------
// integrais de área em relação à origem

/** Integrais de área (sinal sempre positivo): A, Qx = ∫y dA, Qy = ∫x dA, Ixx = ∫y² dA, Iyy = ∫x² dA, Ixy = ∫xy dA. */
export interface Integrais {
  A: number;
  Qx: number;
  Qy: number;
  Ixx: number;
  Iyy: number;
  Ixy: number;
}

/** Vértices de um retângulo, anti-horário a partir do canto inferior esquerdo. */
export const verticesRet = (r: Retangulo): Ponto[] => [
  { x: r.x, y: r.y },
  { x: r.x + r.l, y: r.y },
  { x: r.x + r.l, y: r.y + r.a },
  { x: r.x, y: r.y + r.a },
];

/** Polígono simples (fórmula de Green), qualquer sentido. */
export function integraisPoligono(pts: Ponto[]): Integrais {
  let A = 0, Qx = 0, Qy = 0, Ixx = 0, Iyy = 0, Ixy = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    const c = p.x * q.y - q.x * p.y;
    A += c;
    Qy += (p.x + q.x) * c;
    Qx += (p.y + q.y) * c;
    Iyy += (p.x * p.x + p.x * q.x + q.x * q.x) * c;
    Ixx += (p.y * p.y + p.y * q.y + q.y * q.y) * c;
    Ixy += (p.x * q.y + 2 * p.x * p.y + 2 * q.x * q.y + q.x * p.y) * c;
  }
  const s = A < 0 ? -1 : 1;
  return { A: (s * A) / 2, Qx: (s * Qx) / 6, Qy: (s * Qy) / 6, Ixx: (s * Ixx) / 12, Iyy: (s * Iyy) / 12, Ixy: (s * Ixy) / 24 };
}

/** Setor circular de raio r centrado em (cx, cy), de θ1 a θ2 (radianos, θ2 > θ1). */
export function integraisSetor(cx: number, cy: number, r: number, t1: number, t2: number): Integrais {
  const d = t2 - t1, r3 = r ** 3 / 3, r4 = r ** 4 / 8;
  // em relação ao centro
  const A = (r * r * d) / 2;
  const Qu = r3 * (Math.sin(t2) - Math.sin(t1)); // ∫u dA
  const Qv = r3 * (Math.cos(t1) - Math.cos(t2)); // ∫v dA
  const s2 = Math.sin(2 * t2) - Math.sin(2 * t1);
  const Ivv = r4 * (d - s2 / 2); // ∫v²
  const Iuu = r4 * (d + s2 / 2); // ∫u²
  const Iuv = r4 * (Math.sin(t2) ** 2 - Math.sin(t1) ** 2);
  // translada para a origem: x = u + cx, y = v + cy
  return {
    A,
    Qx: Qv + cy * A,
    Qy: Qu + cx * A,
    Ixx: Ivv + 2 * cy * Qv + cy * cy * A,
    Iyy: Iuu + 2 * cx * Qu + cx * cx * A,
    Ixy: Iuv + cx * Qv + cy * Qu + cx * cy * A,
  };
}

const RAD = Math.PI / 180;

export function integraisDe(f: Figura): Integrais {
  switch (f.tipo) {
    case "retangulo":
      return integraisPoligono(verticesRet(f));
    case "circulo":
      return integraisSetor(f.cx, f.cy, f.r, 0, 2 * Math.PI);
    case "setor":
      return integraisSetor(f.cx, f.cy, f.r, f.a0 * RAD, (f.a0 + f.varre) * RAD);
    case "poligono":
      return integraisPoligono(f.pts);
  }
}

// ---------------------------------------------------------------------------------------------
// resultados

export interface ResultadoFigura {
  id: string;
  nome: string;
  furo: boolean;
  /** Área com sinal (mm²; negativa no furo). */
  A: number;
  /** Massa com sinal (kg; negativa no furo). NaN = não informada. */
  m: number;
  /** Centroide (= CG da figura, material uniforme). */
  x: number;
  y: number;
  /** Momentos de inércia de área em relação aos eixos do próprio centroide (mm⁴, com o sinal da área). */
  Ix: number;
  Iy: number;
  Ixy: number;
}

export interface Inercia {
  Ix: number;
  Iy: number;
  Ixy: number;
  /** Polar (Ix + Iy). */
  J: number;
  /** Principais e ângulo do eixo principal 1 (graus, a partir de +x). */
  I1: number;
  I2: number;
  theta: number;
}

export interface ResultadoCg {
  figuras: ResultadoFigura[];
  /** Área líquida (mm²). */
  A: number;
  /** Centroide geométrico do conjunto. */
  centroide: Ponto | null;
  /** Massa total (kg); NaN se faltar a massa de alguma figura. */
  m: number;
  /** Centro de gravidade (média ponderada pela massa). */
  cg: Ponto | null;
  /** Inércia de área nos eixos centroidais do conjunto (mm⁴). */
  areaCentroide: Inercia | null;
  /** Inércia de área nos eixos da origem (mm⁴). */
  areaOrigem: Inercia | null;
  /** Inércia de massa da placa fina nos eixos pelo CG (kg·mm²; Iz = polar, perpendicular ao plano). */
  massaCg: (Inercia & { Iz: number }) | null;
  avisos: string[];
}

export function principais(Ix: number, Iy: number, Ixy: number): Inercia {
  const med = (Ix + Iy) / 2, raio = Math.hypot((Ix - Iy) / 2, Ixy);
  let theta = (0.5 * Math.atan2(-2 * Ixy, Ix - Iy)) / RAD;
  if (Math.abs(theta) < 1e-9) theta = 0;
  return { Ix, Iy, Ixy, J: Ix + Iy, I1: med + raio, I2: med - raio, theta };
}

/** Massa (kg) de uma área (mm²) no material único. */
export const massaDoMaterial = (A: number, mat: Material) => mat.densidade * mat.espessura * A * 1e-9;

export function calcular(doc: DocCg2d): ResultadoCg {
  const avisos: string[] = [];
  const figuras: ResultadoFigura[] = [];
  const ints: Integrais[] = [];
  for (const f of doc.figuras) {
    const I = integraisDe(f);
    if (!(I.A > 1e-12)) {
      avisos.push(`${f.nome}: área nula (ignorada).`);
      continue;
    }
    const s = f.furo ? -1 : 1;
    const x = I.Qy / I.A, y = I.Qx / I.A;
    const m = doc.material.modo === "densidade" ? massaDoMaterial(I.A, doc.material) : typeof f.massa === "number" && f.massa >= 0 ? f.massa : NaN;
    figuras.push({
      id: f.id, nome: f.nome, furo: !!f.furo, A: s * I.A, m: s * m, x, y,
      Ix: s * (I.Ixx - I.A * y * y), Iy: s * (I.Iyy - I.A * x * x), Ixy: s * (I.Ixy - I.A * x * y),
    });
    ints.push(I);
  }
  const vazio: ResultadoCg = { figuras, A: 0, centroide: null, m: NaN, cg: null, areaCentroide: null, areaOrigem: null, massaCg: null, avisos };
  if (!figuras.length) return vazio;
  const A = figuras.reduce((s, f) => s + f.A, 0);
  if (!(A > 1e-9)) {
    avisos.push("A área líquida é zero ou negativa: os furos são maiores que as figuras sólidas.");
    return { ...vazio, A };
  }
  const centroide = { x: figuras.reduce((s, f) => s + f.A * f.x, 0) / A, y: figuras.reduce((s, f) => s + f.A * f.y, 0) / A };
  const soma = (fn: (f: ResultadoFigura) => number) => figuras.reduce((s, f) => s + fn(f), 0);
  const areaCentroide = principais(
    soma((f) => f.Ix + f.A * (f.y - centroide.y) ** 2),
    soma((f) => f.Iy + f.A * (f.x - centroide.x) ** 2),
    soma((f) => f.Ixy + f.A * (f.x - centroide.x) * (f.y - centroide.y)),
  );
  const areaOrigem = principais(soma((f) => f.Ix + f.A * f.y * f.y), soma((f) => f.Iy + f.A * f.x * f.x), soma((f) => f.Ixy + f.A * f.x * f.y));

  let m = soma((f) => f.m);
  let cg: Ponto | null = null;
  let massaCg: ResultadoCg["massaCg"] = null;
  const faltam = figuras.filter((f) => Number.isNaN(f.m));
  if (faltam.length) {
    avisos.push(`Falta a massa de: ${faltam.map((f) => f.nome).join(", ")}.`);
    m = NaN;
  } else if (!(m > 1e-15)) {
    avisos.push(doc.material.modo === "densidade" ? "Massa total zero: confira a densidade e a espessura." : "A massa total é zero ou negativa.");
  } else {
    cg = { x: soma((f) => f.m * f.x) / m, y: soma((f) => f.m * f.y) / m };
    // massa distribuída uniformemente em cada figura: densidade superficial σ = m/A
    const sig = (f: ResultadoFigura) => f.m / f.A;
    const p = principais(
      soma((f) => sig(f) * f.Ix + f.m * (f.y - cg!.y) ** 2),
      soma((f) => sig(f) * f.Iy + f.m * (f.x - cg!.x) ** 2),
      soma((f) => sig(f) * f.Ixy + f.m * (f.x - cg!.x) * (f.y - cg!.y)),
    );
    massaCg = { ...p, Iz: p.J };
  }
  return { figuras, A, centroide, m, cg, areaCentroide, areaOrigem, massaCg, avisos };
}

// ---------------------------------------------------------------------------------------------
// pontos das figuras e cotas

const ORIGEM: Ponto = { x: 0, y: 0 };

/** Pontos notáveis de uma figura (para cotas e ajuste). */
export function pontosDe(f: Figura): Record<string, Ponto> {
  switch (f.tipo) {
    case "retangulo": {
      const v = verticesRet(f);
      return { v0: v[0], v1: v[1], v2: v[2], v3: v[3], c: { x: f.x + f.l / 2, y: f.y + f.a / 2 } };
    }
    case "circulo":
      return { c: { x: f.cx, y: f.cy } };
    case "setor":
      return {
        c: { x: f.cx, y: f.cy },
        p0: { x: f.cx + f.r * Math.cos(f.a0 * RAD), y: f.cy + f.r * Math.sin(f.a0 * RAD) },
        p1: { x: f.cx + f.r * Math.cos((f.a0 + f.varre) * RAD), y: f.cy + f.r * Math.sin((f.a0 + f.varre) * RAD) },
      };
    case "poligono":
      return Object.fromEntries(f.pts.map((p, i) => [`v${i}`, { ...p }]));
  }
}

export function posicao(doc: DocCg2d, r: RefPonto): Ponto | null {
  if (r.fig === null) return ORIGEM;
  const f = doc.figuras.find((x) => x.id === r.fig);
  return f ? pontosDe(f)[r.p] ?? null : null;
}

/** Translada a figura. */
export function transladar(f: Figura, dx: number, dy: number) {
  if (f.tipo === "retangulo") {
    f.x += dx;
    f.y += dy;
  } else if (f.tipo === "poligono") {
    for (const p of f.pts) {
      p.x += dx;
      p.y += dy;
    }
  } else {
    f.cx += dx;
    f.cy += dy;
  }
}

/** Leva um ponto da figura até `alvo` deformando-a (vértice) ou transladando-a (centro). */
export function moverPonto(f: Figura, p: string, alvo: Ponto) {
  const atual = pontosDe(f)[p];
  if (!atual) return;
  if (p === "c") return transladar(f, alvo.x - atual.x, alvo.y - atual.y);
  if (f.tipo === "retangulo") {
    // o canto oposto fica parado
    const k = Number(p.slice(1));
    const op = verticesRet(f)[(k + 2) % 4];
    f.x = Math.min(op.x, alvo.x);
    f.y = Math.min(op.y, alvo.y);
    f.l = Math.abs(alvo.x - op.x);
    f.a = Math.abs(alvo.y - op.y);
  } else if (f.tipo === "poligono") {
    const k = Number(p.slice(1));
    if (f.pts[k]) f.pts[k] = { ...alvo };
  } else if (f.tipo === "setor") {
    const r = Math.hypot(alvo.x - f.cx, alvo.y - f.cy);
    if (r < 1e-9) return;
    const ang = Math.atan2(alvo.y - f.cy, alvo.x - f.cx) / RAD;
    f.r = r;
    if (p === "p0") {
      const fim = f.a0 + f.varre;
      f.a0 = ang;
      f.varre = ((((fim - ang) % 360) + 360) % 360) || 360;
    } else f.varre = ((((ang - f.a0) % 360) + 360) % 360) || 360;
  }
}

/** Medida atual de uma cota (mm). */
export function medir(doc: DocCg2d, c: Cota): number {
  if (c.tipo === "raio" || c.tipo === "diametro") {
    const f = doc.figuras.find((x) => x.id === c.a.fig);
    const r = f && (f.tipo === "circulo" || f.tipo === "setor") ? f.r : NaN;
    return c.tipo === "raio" ? r : 2 * r;
  }
  const pa = posicao(doc, c.a), pb = c.b ? posicao(doc, c.b) : null;
  if (!pa || !pb) return NaN;
  if (c.tipo === "horizontal") return Math.abs(pb.x - pa.x);
  if (c.tipo === "vertical") return Math.abs(pb.y - pa.y);
  return Math.hypot(pb.x - pa.x, pb.y - pa.y);
}

/** Aplica uma cota dirigida (move o ponto b; se b for a origem, move o ponto a). */
function aplicarCota(doc: DocCg2d, c: Cota) {
  const fig = (id: string | null) => doc.figuras.find((x) => x.id === id);
  if (c.tipo === "raio" || c.tipo === "diametro") {
    const f = fig(c.a.fig);
    if (f && (f.tipo === "circulo" || f.tipo === "setor") && c.valor > 0) f.r = c.tipo === "raio" ? c.valor : c.valor / 2;
    return;
  }
  if (!c.b) return;
  let a = c.a, b = c.b;
  if (b.fig === null) [a, b] = [b, a];
  const fb = fig(b.fig);
  const pa = posicao(doc, a), pb = posicao(doc, b);
  if (!fb || !pa || !pb) return;
  let alvo: Ponto;
  if (c.tipo === "horizontal") alvo = { x: pa.x + (pb.x - pa.x < 0 ? -1 : 1) * c.valor, y: pb.y };
  else if (c.tipo === "vertical") alvo = { x: pb.x, y: pa.y + (pb.y - pa.y < 0 ? -1 : 1) * c.valor };
  else {
    const d = Math.hypot(pb.x - pa.x, pb.y - pa.y);
    const u = d > 1e-12 ? { x: (pb.x - pa.x) / d, y: (pb.y - pa.y) / d } : { x: 1, y: 0 };
    alvo = { x: pa.x + u.x * c.valor, y: pa.y + u.y * c.valor };
  }
  if (a.fig !== null && a.fig === b.fig) moverPonto(fb, b.p, alvo);
  else transladar(fb, alvo.x - pb.x, alvo.y - pb.y);
}

/**
 * Aplica as cotas dirigidas na ordem em que foram criadas (algumas passadas, para cotas que
 * dependem de outras); as de referência só atualizam o valor. Devolve os ids das cotas que não
 * puderam ser satisfeitas juntas (conflito).
 */
export function aplicarCotas(doc: DocCg2d): Set<string> {
  const dirigidas = doc.cotas.filter((c) => c.dirigida);
  for (let passo = 0; passo < 4; passo++) {
    for (const c of dirigidas) aplicarCota(doc, c);
    if (dirigidas.every((c) => Math.abs(medir(doc, c) - c.valor) < 1e-6)) break;
  }
  const conflito = new Set<string>();
  for (const c of doc.cotas) {
    const v = medir(doc, c);
    if (!c.dirigida) c.valor = Number.isFinite(v) ? v : c.valor;
    else if (!(Math.abs(v - c.valor) < 1e-6)) conflito.add(c.id);
  }
  return conflito;
}

/** Tipo automático de uma cota pela direção dos dois pontos. */
export function tipoAutomatico(pa: Ponto, pb: Ponto): TipoCota {
  const dx = Math.abs(pb.x - pa.x), dy = Math.abs(pb.y - pa.y);
  if (dy <= dx * Math.tan(10 * RAD)) return "horizontal";
  if (dx <= dy * Math.tan(10 * RAD)) return "vertical";
  return "alinhada";
}

/** Remove a figura e as cotas que dependem dela. */
export function excluirFigura(doc: DocCg2d, id: string) {
  doc.figuras = doc.figuras.filter((f) => f.id !== id);
  doc.cotas = doc.cotas.filter((c) => c.a.fig !== id && c.b?.fig !== id);
}

// ---------------------------------------------------------------------------------------------
// teste de pertença (seleção na tela)

export function contem(f: Figura, p: Ponto): boolean {
  if (f.tipo === "retangulo") return p.x >= f.x && p.x <= f.x + f.l && p.y >= f.y && p.y <= f.y + f.a;
  if (f.tipo === "circulo") return Math.hypot(p.x - f.cx, p.y - f.cy) <= f.r;
  if (f.tipo === "setor") {
    const d = Math.hypot(p.x - f.cx, p.y - f.cy);
    if (d > f.r) return false;
    if (f.varre >= 360 || d < 1e-12) return true;
    const ang = ((((Math.atan2(p.y - f.cy, p.x - f.cx) / RAD - f.a0) % 360) + 360) % 360);
    return ang <= f.varre;
  }
  let dentro = false;
  const v = f.pts;
  for (let i = 0, j = v.length - 1; i < v.length; j = i++) {
    if (v[i].y > p.y !== v[j].y > p.y && p.x < ((v[j].x - v[i].x) * (p.y - v[i].y)) / (v[j].y - v[i].y) + v[i].x) dentro = !dentro;
  }
  return dentro;
}

/** Nome do tipo para a interface. */
export const NOME_TIPO: Record<Figura["tipo"], string> = { retangulo: "Retângulo", circulo: "Círculo", setor: "Setor circular", poligono: "Polígono" };
