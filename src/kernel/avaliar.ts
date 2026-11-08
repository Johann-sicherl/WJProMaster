// Aba Avaliar no kernel: medições exatas no B-Rep, propriedades de massa (com inércia)
// e verificação de geometria. Ver docs/funcional/avaliar.md.

import { getOC, measureArea, measureLength, measureShapeSurfaceProperties, measureShapeVolumeProperties, type Shape3D } from "replicad";
import type { Referencia, Vec3 } from "../model";
import { acharAresta, acharFace, assinaturaAresta, assinaturaFace } from "./topologia";

export interface LinhaMedida {
  rotulo: string;
  valor: string;
}

export interface ResultadoMedida {
  linhas: LinhaMedida[];
  /** Segmento da menor distância, para desenhar no viewport. */
  segmento?: [Vec3, Vec3];
}

type OC = Record<string, new (...a: unknown[]) => Record<string, (...a: unknown[]) => unknown>>;
const oc = () => getOC() as unknown as OC;
const mm = (v: number) => `${v.toLocaleString("pt-BR", { maximumFractionDigits: 3 })} mm`;
const graus = (v: number) => `${v.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}°`;
const xyz = (p: Vec3) => p.map((v) => v.toLocaleString("pt-BR", { maximumFractionDigits: 3 })).join("; ");
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const esc = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norma = (a: Vec3) => Math.hypot(...a);

interface Item {
  forma: unknown; // TopoDS_Shape
  ref: Referencia;
  pontoCentro?: Vec3;
  direcao?: Vec3; // normal de face plana ou direção de aresta reta
}

function itemDe(peca: Shape3D, r: Referencia): Item {
  if (r.tipo === "face") {
    const f = acharFace(peca, r.ass);
    const a = assinaturaFace(f);
    return { forma: f.wrapped, ref: r, pontoCentro: a.geom === "cilindro" ? a.pontoEixo : a.centro, direcao: a.normal };
  }
  if (r.tipo === "aresta") {
    const e = acharAresta(peca, r.ass);
    const a = assinaturaAresta(e);
    return { forma: e.wrapped, ref: r, pontoCentro: a.centro, direcao: a.geom === "linha" ? sub(a.b, a.a) : undefined };
  }
  if (r.tipo === "vertice") {
    const O = oc();
    const v = new O.BRepBuilderAPI_MakeVertex(new O.gp_Pnt(...r.p)).Vertex();
    return { forma: v, ref: r, pontoCentro: r.p };
  }
  throw new Error("Medir: escolha faces, arestas ou vértices.");
}

function descreverUm(peca: Shape3D, r: Referencia): LinhaMedida[] {
  if (r.tipo === "vertice") return [{ rotulo: "X; Y; Z", valor: xyz(r.p) }];
  if (r.tipo === "aresta") {
    const e = acharAresta(peca, r.ass);
    const a = assinaturaAresta(e);
    const out = [{ rotulo: "Comprimento", valor: mm(measureLength(e)) }];
    if (a.geom === "circulo" && a.raio !== undefined) {
      out.push({ rotulo: "Diâmetro", valor: mm(2 * a.raio) }, { rotulo: "Raio", valor: mm(a.raio) });
      if (a.centro) out.push({ rotulo: "Centro", valor: xyz(a.centro) });
    }
    return out;
  }
  if (r.tipo === "face") {
    const f = acharFace(peca, r.ass);
    const a = assinaturaFace(f);
    const perimetro = f.edges.reduce((s, e) => s + measureLength(e), 0);
    const out = [
      { rotulo: "Área", valor: `${measureArea(f).toLocaleString("pt-BR", { maximumFractionDigits: 3 })} mm²` },
      { rotulo: "Perímetro", valor: mm(perimetro) },
    ];
    if (a.geom === "cilindro" && a.raio !== undefined) out.push({ rotulo: "Diâmetro", valor: mm(2 * a.raio) });
    if (a.normal) out.push({ rotulo: "Normal", valor: xyz(a.normal) });
    return out;
  }
  return [];
}

export function medir(peca: Shape3D | null, refs: Referencia[]): ResultadoMedida {
  if (!refs.length) return { linhas: [{ rotulo: "Medir", valor: "Toque faces, arestas ou vértices" }] };
  // pontos tocados na superfície (corpo de malha STL, ou sem sólido): conta direta, sem o kernel
  if (refs.every((r) => r.tipo === "vertice")) {
    const ps = refs.slice(0, 2).map((r) => (r as Extract<Referencia, { tipo: "vertice" }>).p);
    if (ps.length === 1) return { linhas: [{ rotulo: "X; Y; Z", valor: xyz(ps[0]) }] };
    const d = sub(ps[1], ps[0]);
    return { linhas: [{ rotulo: "Distância", valor: mm(norma(d)) }, { rotulo: "ΔX; ΔY; ΔZ", valor: xyz(d.map(Math.abs) as Vec3) }], segmento: [ps[0], ps[1]] };
  }
  if (!peca) throw new Error("Não há peça sólida para medir faces/arestas (num corpo de malha STL, toque pontos da superfície).");
  if (refs.length === 1) return { linhas: descreverUm(peca, refs[0]) };
  const [a, b] = refs.slice(0, 2).map((r) => itemDe(peca, r));
  const O = oc();
  const dss = new O.BRepExtrema_DistShapeShape();
  dss.LoadS1(a.forma);
  dss.LoadS2(b.forma);
  dss.Perform();
  const d = dss.Value() as number;
  const p1 = dss.PointOnShape1(1) as { X(): number; Y(): number; Z(): number };
  const p2 = dss.PointOnShape2(1) as { X(): number; Y(): number; Z(): number };
  const q1: Vec3 = [p1.X(), p1.Y(), p1.Z()], q2: Vec3 = [p2.X(), p2.Y(), p2.Z()];
  const linhas: LinhaMedida[] = [{ rotulo: "Distância mínima", valor: mm(d) }];
  const delta = sub(q2, q1);
  linhas.push({ rotulo: "ΔX; ΔY; ΔZ", valor: xyz(delta.map(Math.abs) as Vec3) });
  if (a.pontoCentro && b.pontoCentro && (a.ref.tipo !== "face" || !a.direcao || b.ref.tipo === "vertice")) {
    linhas.push({ rotulo: "Centro a centro", valor: mm(norma(sub(b.pontoCentro, a.pontoCentro))) });
  }
  if (a.direcao && b.direcao) {
    const c = Math.abs(esc(a.direcao, b.direcao)) / (norma(a.direcao) * norma(b.direcao));
    const ang = (Math.acos(Math.min(1, c)) * 180) / Math.PI;
    linhas.push({ rotulo: "Ângulo", valor: graus(ang) });
    if (ang < 1e-6 && a.ref.tipo === "face" && b.ref.tipo === "face") linhas.push({ rotulo: "Distância normal", valor: mm(Math.abs(esc(sub(b.pontoCentro!, a.pontoCentro!), a.direcao)) / norma(a.direcao)) });
  }
  return { linhas, segmento: [q1, q2] };
}

// ---------- propriedades de massa ----------

export interface PropriedadesMassa {
  volume: number; // mm³
  area: number; // mm²
  centro: Vec3;
  /** Tensor de inércia no centro de massa, densidade 1 (mm⁵): [Ixx, Iyy, Izz, Ixy, Ixz, Iyz] (Ixy = −∫xy). */
  inercia: [number, number, number, number, number, number];
  principais: [number, number, number];
  eixos: [Vec3, Vec3, Vec3];
}

/** Malha triangular (corpo de malha STL): vértices e triângulos. */
export interface MalhaMassa {
  vertices: Float32Array;
  triangulos: Uint32Array;
  volume: number | null;
}

/**
 * Propriedades de massa de corpos de malha fechados (STL): volume, área, centro e inércia pela
 * soma dos tetraedros (origem, a, b, c) de cada triângulo — covariância det/120·(aaᵀ+bbᵀ+ccᵀ+ssᵀ).
 */
function massaDaMalha(malhas: MalhaMassa[]): PropriedadesMassa {
  if (malhas.some((m) => m.volume === null)) throw new Error("O corpo de malha (STL) não é fechado: sem volume não há propriedades de massa (simplifique ou corrija o STL).");
  let V = 0, area = 0;
  const cm: Vec3 = [0, 0, 0];
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const m of malhas) {
    const v = m.vertices, t = m.triangulos;
    for (let i = 0; i < t.length; i += 3) {
      const a: Vec3 = [v[t[i] * 3], v[t[i] * 3 + 1], v[t[i] * 3 + 2]];
      const b: Vec3 = [v[t[i + 1] * 3], v[t[i + 1] * 3 + 1], v[t[i + 1] * 3 + 2]];
      const c: Vec3 = [v[t[i + 2] * 3], v[t[i + 2] * 3 + 1], v[t[i + 2] * 3 + 2]];
      const n: Vec3 = [(b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]), (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])];
      area += norma(n) / 2;
      const det = esc(a, [b[1] * c[2] - b[2] * c[1], b[2] * c[0] - b[0] * c[2], b[0] * c[1] - b[1] * c[0]]);
      V += det / 6;
      for (let k = 0; k < 3; k++) cm[k] += (det / 24) * (a[k] + b[k] + c[k]);
      const s: Vec3 = [a[0] + b[0] + c[0], a[1] + b[1] + c[1], a[2] + b[2] + c[2]];
      for (let p = 0; p < 3; p++) for (let q = 0; q < 3; q++) C[p][q] += (det / 120) * (a[p] * a[q] + b[p] * b[q] + c[p] * c[q] + s[p] * s[q]);
    }
  }
  // malha orientada para dentro: inverte o sinal de tudo
  const sg = V < 0 ? -1 : 1;
  V *= sg;
  const centro = cm.map((x) => (x * sg) / V) as Vec3;
  // momentos no centro: C' = C − V·c·cᵀ; tensor J = tr(C')·I − C'
  const Cc = C.map((r, p) => r.map((x, q) => x * sg - V * centro[p] * centro[q]));
  const tr = Cc[0][0] + Cc[1][1] + Cc[2][2];
  const J = Cc.map((r, p) => r.map((x, q) => (p === q ? tr - x : -x)));
  const { valores, vetores } = autovalores(J);
  return {
    volume: V, area, centro,
    inercia: [J[0][0], J[1][1], J[2][2], J[0][1], J[0][2], J[1][2]],
    principais: valores as [number, number, number],
    eixos: vetores as [Vec3, Vec3, Vec3],
  };
}

export function massa(peca: Shape3D | null, malhas: MalhaMassa[] = []): PropriedadesMassa {
  if (!peca && malhas.length) return massaDaMalha(malhas);
  if (!peca) throw new Error("Não há peça.");
  const props = measureShapeVolumeProperties(peca) as unknown as {
    volume: number; centerOfMass: Vec3; wrapped: { MomentOfInertia(a: unknown): number };
  };
  const c = props.centerOfMass;
  const O = oc();
  const I = (d: Vec3) => {
    const n = norma(d);
    return props.wrapped.MomentOfInertia(new O.gp_Ax1(new O.gp_Pnt(...c), new O.gp_Dir(d[0] / n, d[1] / n, d[2] / n)));
  };
  const ixx = I([1, 0, 0]), iyy = I([0, 1, 0]), izz = I([0, 0, 1]);
  // produtos de inércia a partir de eixos diagonais: I(u) = uᵀ J u
  const ixy = I([1, 1, 0]) - (ixx + iyy) / 2;
  const ixz = I([1, 0, 1]) - (ixx + izz) / 2;
  const iyz = I([0, 1, 1]) - (iyy + izz) / 2;
  const { valores, vetores } = autovalores([[ixx, ixy, ixz], [ixy, iyy, iyz], [ixz, iyz, izz]]);
  return {
    volume: props.volume,
    area: measureArea(peca),
    centro: c,
    inercia: [ixx, iyy, izz, ixy, ixz, iyz],
    principais: valores as [number, number, number],
    eixos: vetores as [Vec3, Vec3, Vec3],
  };
}

/** Propriedades de seção de uma face plana (momentos de área, mm⁴). */
export interface PropriedadesSecao {
  area: number;
  centroide: Vec3;
  normal: Vec3;
  /** eixos do plano usados (u, v): os globais quando a face é paralela a um plano principal */
  u: Vec3;
  v: Vec3;
  nomeU: string;
  nomeV: string;
  /** no centroide: Iu = ∫v² dA (em torno do eixo u), Iv = ∫u² dA, Iuv = ∫uv dA, J = Iu + Iv */
  Iu: number;
  Iv: number;
  Iuv: number;
  J: number;
  /** principais (I1 ≥ I2) e ângulo do eixo 1 a partir de u, no sentido de u para v */
  I1: number;
  I2: number;
  angulo: number;
  /** módulos de resistência elásticos: I / distância à fibra mais afastada */
  Wu: number;
  Wv: number;
  /** raios de giração */
  ku: number;
  kv: number;
}

/**
 * Propriedades de seção (Section Properties) de uma face plana: área, centroide, momentos de
 * inércia de área no centroide (eixos do plano e principais), polar, raios de giração e módulos
 * de resistência — o que se usa para dimensionar vigas e perfis.
 */
export function propriedadesSecao(peca: Shape3D | null, r: Referencia): PropriedadesSecao {
  if (!peca) throw new Error("Não há peça.");
  if (r.tipo !== "face") throw new Error("Propriedades de seção: toque numa face plana.");
  const f = acharFace(peca, r.ass);
  const a = assinaturaFace(f);
  if (a.geom !== "plano" || !a.normal) throw new Error("Propriedades de seção: a face precisa ser plana.");
  const n = a.normal.map((x) => x / norma(a.normal!)) as Vec3;
  const props = measureShapeSurfaceProperties(f) as unknown as { area: number; centerOfMass: Vec3; wrapped: { MomentOfInertia(a: unknown): number } };
  const A = props.area, c = props.centerOfMass;
  // eixos do plano: os globais quando a face é paralela a um plano principal (Y para cima)
  const X: Vec3 = [1, 0, 0], Y: Vec3 = [0, 1, 0], Z: Vec3 = [0, 0, 1];
  let u: Vec3, v: Vec3, nomeU: string, nomeV: string;
  if (Math.abs(Math.abs(n[2]) - 1) < 1e-6) [u, v, nomeU, nomeV] = [X, Y, "X", "Y"];
  else if (Math.abs(Math.abs(n[1]) - 1) < 1e-6) [u, v, nomeU, nomeV] = [X, Z, "X", "Z"];
  else if (Math.abs(Math.abs(n[0]) - 1) < 1e-6) [u, v, nomeU, nomeV] = [Z, Y, "Z", "Y"];
  else {
    const t: Vec3 = Math.abs(n[1]) < 0.9 ? Y : X;
    const w: Vec3 = [t[1] * n[2] - t[2] * n[1], t[2] * n[0] - t[0] * n[2], t[0] * n[1] - t[1] * n[0]];
    const lw = norma(w);
    v = w.map((x) => x / lw) as Vec3;
    u = [v[1] * n[2] - v[2] * n[1], v[2] * n[0] - v[0] * n[2], v[0] * n[1] - v[1] * n[0]];
    nomeU = "u";
    nomeV = "v";
  }
  const O = oc();
  const I = (d: Vec3) => props.wrapped.MomentOfInertia(new O.gp_Ax1(new O.gp_Pnt(...c), new O.gp_Dir(...d)));
  const Iu = I(u), Iv = I(v), J = I(n);
  const diag = I([(u[0] + v[0]) / Math.SQRT2, (u[1] + v[1]) / Math.SQRT2, (u[2] + v[2]) / Math.SQRT2]);
  // ∫(u−v)²/2 dA = diag → ∫uv = (Iu + Iv)/2 − diag (Iu = ∫v², Iv = ∫u²)
  const Iuv = (Iu + Iv) / 2 - diag;
  const m = (Iu + Iv) / 2, rr = Math.hypot((Iu - Iv) / 2, Iuv);
  const angulo = (0.5 * Math.atan2(-2 * Iuv, Iu - Iv) * 180) / Math.PI;
  // fibra mais afastada: maior distância do centroide aos vértices/pontos das arestas, em u e em v
  let du = 0, dv = 0;
  for (const e of f.edges)
    for (let k = 0; k <= 16; k++) {
      const p = e.pointAt(k / 16).toTuple() as Vec3;
      const d = sub(p, c);
      du = Math.max(du, Math.abs(esc(d, u)));
      dv = Math.max(dv, Math.abs(esc(d, v)));
    }
  return {
    area: A, centroide: c, normal: n, u, v, nomeU, nomeV, Iu, Iv, Iuv, J, I1: m + rr, I2: m - rr, angulo,
    Wu: dv > 0 ? Iu / dv : 0, Wv: du > 0 ? Iv / du : 0, ku: Math.sqrt(Iu / A), kv: Math.sqrt(Iv / A),
  };
}

/** Autovalores/vetores de matriz 3×3 simétrica (Jacobi), em ordem crescente. */
function autovalores(m: number[][]): { valores: number[]; vetores: Vec3[] } {
  const a = m.map((r) => r.slice());
  const v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let it = 0; it < 50; it++) {
    let p = 0, q = 1;
    for (const [i, j] of [[0, 1], [0, 2], [1, 2]]) if (Math.abs(a[i][j]) > Math.abs(a[p][q])) [p, q] = [i, j];
    if (Math.abs(a[p][q]) < 1e-12 * (Math.abs(a[0][0]) + Math.abs(a[1][1]) + Math.abs(a[2][2]) + 1e-30)) break;
    const th = 0.5 * Math.atan2(2 * a[p][q], a[q][q] - a[p][p]);
    const c = Math.cos(th), s = Math.sin(th);
    for (let k = 0; k < 3; k++) {
      const akp = a[k][p], akq = a[k][q];
      a[k][p] = c * akp - s * akq;
      a[k][q] = s * akp + c * akq;
    }
    for (let k = 0; k < 3; k++) {
      const apk = a[p][k], aqk = a[q][k];
      a[p][k] = c * apk - s * aqk;
      a[q][k] = s * apk + c * aqk;
    }
    for (let k = 0; k < 3; k++) {
      const vkp = v[k][p], vkq = v[k][q];
      v[k][p] = c * vkp - s * vkq;
      v[k][q] = s * vkp + c * vkq;
    }
  }
  const ordem = [0, 1, 2].sort((i, j) => a[i][i] - a[j][j]);
  return { valores: ordem.map((i) => a[i][i]), vetores: ordem.map((i) => [v[0][i], v[1][i], v[2][i]] as Vec3) };
}

// ---------- verificar ----------

export interface ResultadoVerificacao {
  valida: boolean;
  faces: number;
  arestas: number;
  arestasCurtas: number;
  menorAresta: number;
  menorFace: number;
}

export function verificar(peca: Shape3D | null, limiteCurta = 0.01): ResultadoVerificacao {
  if (!peca) throw new Error("Não há peça.");
  const O = oc();
  const an = new O.BRepCheck_Analyzer(peca.wrapped, true, false, false);
  const valida = an.IsValid(peca.wrapped) as boolean;
  const comps = peca.edges.map((e) => measureLength(e));
  const areas = peca.faces.map((f) => measureArea(f));
  return {
    valida,
    faces: areas.length,
    arestas: comps.length,
    arestasCurtas: comps.filter((c) => c < limiteCurta).length,
    menorAresta: Math.min(...comps),
    menorFace: Math.min(...areas),
  };
}
