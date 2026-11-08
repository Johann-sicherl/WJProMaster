// WJCalcEng — Centro de gravidade em 2D (motor puro, testado em scripts/teste-calceng.ts).
// O desenho é um esboço do WJCAD (mesmas entidades, relações e cotas). Cada REGIÃO fechada do
// esboço é uma figura: as regiões saem das curvas que não são de construção, ligadas pelas pontas
// (como as regiões de contorno de um CAD); figuras encostadas e linhas que dividem uma área formam
// regiões separadas; contorno dentro de contorno é furo (pode virar sólido). Integrais de área
// exatas pelo teorema de Green em cada trecho (linha, arco, elipse, Bézier) com Gauss-Legendre.
// Saída: CG de cada figura e do conjunto, momentos de inércia de área e de massa, memória de
// cálculo no método das figuras compostas. Unidades: mm, kg.

import type { FeatureEsboco } from "../model";
import { novoEsboco } from "../model";
import {
  angulo, areaAssinada, centroTresPontos, contornosDoTexto, dist, elipseDe, extremidades, intersecoes, mapaPontos, norm, pontoElipse, pontoNoPoligono,
  rot90, trechosDe, type Elipse2, type P2, type Trecho,
} from "../esboco/geometria";
import * as op from "../esboco/operacoes";
import type { Valores } from "./calculadoras";

export type { P2 };

// ---------------------------------------------------------------------------------------------
// documento

export type ModoMassa = "densidade" | "massa";
export interface Material {
  modo: ModoMassa;
  /** kg/m³ */
  densidade: number;
  /** mm */
  espessura: number;
}
/** O que o usuário define em cada região (pela chave da região). */
export interface DadosRegiao {
  nome: string;
  /** Força furo (true) ou sólido (false); ausente = pela posição (dentro de outra = furo). */
  furo?: boolean;
  /** Massa informada (kg), no modo "massa de cada figura". */
  massa?: number;
}
export interface DocCg2d {
  esboco: FeatureEsboco;
  regioes: Record<string, DadosRegiao>;
  material: Material;
}
/** Documento do WJCalcEng (.wjcalc). */
export interface DocCalc {
  versao: 2;
  nome: string;
  /** Calculadora aberta ("cg2d", "eq2", "cramer"…; catálogo em modulos.ts). */
  modulo: string;
  cg2d: DocCg2d;
  /** Valores digitados em cada uma das outras calculadoras (por id). */
  calcs?: Record<string, Valores>;
}

const SUPORTE = { tipo: "plano", plano: "XY", deslocamento: 0 } as const;

export function docNovo(): DocCalc {
  const esb = novoEsboco(1, { ...SUPORTE });
  esb.nome = "Esboço";
  return { versao: 2, nome: "Cálculo", modulo: "cg2d", cg2d: { esboco: esb, regioes: {}, material: { modo: "densidade", densidade: 7850, espessura: 1 } } };
}

const num = (v: unknown, padrao: number) => (typeof v === "number" && Number.isFinite(v) ? v : padrao);

/** Confere um documento lido (lança erro se não for do WJCalcEng). Arquivos da versão 1 são convertidos. */
export function validarDoc(d: unknown): DocCalc {
  const o = d as { versao?: number; nome?: string; cg2d?: Record<string, unknown> } | null;
  if (!o || typeof o !== "object" || !o.cg2d || typeof o.cg2d !== "object") throw new Error("Arquivo não é um cálculo do WJCalcEng.");
  const base = docNovo();
  const m = (o.cg2d.material ?? {}) as Partial<Material>;
  const material: Material = { modo: m.modo === "massa" ? "massa" : "densidade", densidade: Math.max(0, num(m.densidade, 7850)), espessura: Math.max(0, num(m.espessura, 1)) };
  const nome = String(o.nome ?? base.nome);
  if (o.versao !== 2) {
    if (!Array.isArray(o.cg2d.figuras)) throw new Error("Arquivo não é um cálculo do WJCalcEng.");
    return { ...base, nome, cg2d: { esboco: esbocoDaVersao1(o.cg2d.figuras as FiguraV1[]), regioes: {}, material } };
  }
  const e = o.cg2d.esboco as FeatureEsboco | undefined;
  if (!e || !Array.isArray(e.pontos) || !Array.isArray(e.geos) || !Array.isArray(e.restricoes)) throw new Error("Esboço do cálculo ilegível.");
  const regioes: Record<string, DadosRegiao> = {};
  for (const [k, v] of Object.entries((o.cg2d.regioes ?? {}) as Record<string, Partial<DadosRegiao>>)) {
    if (!v || typeof v !== "object") continue;
    const r: DadosRegiao = { nome: String(v.nome ?? "Figura") };
    if (typeof v.furo === "boolean") r.furo = v.furo;
    if (typeof v.massa === "number" && Number.isFinite(v.massa)) r.massa = v.massa;
    regioes[k] = r;
  }
  const doc: DocCalc = { versao: 2, nome, modulo: typeof (o as { modulo?: unknown }).modulo === "string" ? (o as { modulo: string }).modulo : "cg2d", cg2d: { esboco: { ...e, tipo: "esboco", suporte: { ...SUPORTE } }, regioes, material } };
  const calcs = (o as { calcs?: unknown }).calcs;
  if (calcs && typeof calcs === "object") doc.calcs = calcs as Record<string, Valores>;
  return doc;
}

/** Figuras da versão 1 (antes do esboço do WJCAD) viram entidades de esboço. */
type FiguraV1 =
  | { tipo: "retangulo"; x: number; y: number; l: number; a: number }
  | { tipo: "circulo"; cx: number; cy: number; r: number }
  | { tipo: "setor"; cx: number; cy: number; r: number; a0: number; varre: number }
  | { tipo: "poligono"; pts: P2[] };
function esbocoDaVersao1(figs: FiguraV1[]): FeatureEsboco {
  const esb = docNovo().cg2d.esboco;
  const RAD = Math.PI / 180;
  for (const f of figs) {
    if (!f || typeof f !== "object") continue;
    if (f.tipo === "retangulo") op.retangulo(esb, op.ponto(esb, { x: f.x, y: f.y }), op.ponto(esb, { x: f.x + f.l, y: f.y + f.a }));
    else if (f.tipo === "circulo") op.circulo(esb, op.ponto(esb, { x: f.cx, y: f.cy }), f.r);
    else if (f.tipo === "setor") {
      const c = op.ponto(esb, { x: f.cx, y: f.cy });
      if (f.varre >= 360) {
        op.circulo(esb, c, f.r);
        continue;
      }
      const ini = op.ponto(esb, { x: f.cx + f.r * Math.cos(f.a0 * RAD), y: f.cy + f.r * Math.sin(f.a0 * RAD) });
      const fim = op.ponto(esb, { x: f.cx + f.r * Math.cos((f.a0 + f.varre) * RAD), y: f.cy + f.r * Math.sin((f.a0 + f.varre) * RAD) });
      op.arco(esb, c, ini, fim);
      if (Math.abs(f.varre - 180) < 1e-9) op.linha(esb, fim, ini);
      else {
        op.linha(esb, c, ini);
        op.linha(esb, fim, c);
      }
    } else if (f.tipo === "poligono" && Array.isArray(f.pts) && f.pts.length >= 3) {
      const ids = f.pts.map((p) => op.ponto(esb, p));
      ids.forEach((id, i) => op.linha(esb, id, ids[(i + 1) % ids.length]));
    }
  }
  return esb;
}

// ---------------------------------------------------------------------------------------------
// integrais de área pelo teorema de Green

/** A, Qx = ∫y dA, Qy = ∫x dA, Ixx = ∫y² dA, Iyy = ∫x² dA, Ixy = ∫xy dA (eixos da origem). */
export interface Integrais {
  A: number;
  Qx: number;
  Qy: number;
  Ixx: number;
  Iyy: number;
  Ixy: number;
}
const zero = (): Integrais => ({ A: 0, Qx: 0, Qy: 0, Ixx: 0, Iyy: 0, Ixy: 0 });
const somar = (a: Integrais, b: Integrais, k = 1): Integrais => ({ A: a.A + k * b.A, Qx: a.Qx + k * b.Qx, Qy: a.Qy + k * b.Qy, Ixx: a.Ixx + k * b.Ixx, Iyy: a.Iyy + k * b.Iyy, Ixy: a.Ixy + k * b.Ixy });

/** Curva paramétrica em t ∈ [0, 1], dividida em `partes` para a quadratura. */
interface Curva {
  p: (t: number) => P2;
  d: (t: number) => P2;
  partes: number;
}

const PARTE_ANG = Math.PI / 8;

function curvaArco(c: P2, r: number, a0: number, varre: number): Curva {
  return {
    p: (t) => ({ x: c.x + r * Math.cos(a0 + varre * t), y: c.y + r * Math.sin(a0 + varre * t) }),
    d: (t) => ({ x: -r * varre * Math.sin(a0 + varre * t), y: r * varre * Math.cos(a0 + varre * t) }),
    partes: Math.max(1, Math.ceil(Math.abs(varre) / PARTE_ANG)),
  };
}
function curvaElipse(e: Elipse2, t0: number, t1: number): Curva {
  const v = rot90(e.u), k = t1 - t0;
  return {
    p: (t) => pontoElipse(e, t0 + k * t),
    d: (t) => {
      const s = t0 + k * t;
      return { x: k * (-e.a * Math.sin(s) * e.u.x + e.b * Math.cos(s) * v.x), y: k * (-e.a * Math.sin(s) * e.u.y + e.b * Math.cos(s) * v.y) };
    },
    partes: Math.max(1, Math.ceil(Math.abs(k) / PARTE_ANG)),
  };
}

function curvaDoTrecho(t: Trecho): Curva {
  switch (t.tipo) {
    case "linha": {
      const { a, b } = t;
      return { p: (s) => ({ x: a.x + (b.x - a.x) * s, y: a.y + (b.y - a.y) * s }), d: () => ({ x: b.x - a.x, y: b.y - a.y }), partes: 1 };
    }
    case "arco": {
      const c = centroTresPontos(t.a, t.meio, t.b);
      if (!c) return curvaDoTrecho({ tipo: "linha", a: t.a, b: t.b });
      const a0 = angulo(c, t.a);
      const ccw = norm(angulo(c, t.b) - a0) || 2 * Math.PI;
      // sentido: o que passa pelo ponto do meio
      const varre = norm(angulo(c, t.meio) - a0) < ccw ? ccw : ccw - 2 * Math.PI;
      return curvaArco(c, dist(c, t.a), a0, varre);
    }
    case "elipse":
      return curvaElipse(t.e, t.t0, t.t1);
    case "quad": {
      const { a, c1, b } = t;
      return {
        p: (s) => {
          const u = 1 - s;
          return { x: u * u * a.x + 2 * u * s * c1.x + s * s * b.x, y: u * u * a.y + 2 * u * s * c1.y + s * s * b.y };
        },
        d: (s) => ({ x: 2 * (1 - s) * (c1.x - a.x) + 2 * s * (b.x - c1.x), y: 2 * (1 - s) * (c1.y - a.y) + 2 * s * (b.y - c1.y) }),
        partes: 1,
      };
    }
    case "bezier": {
      const { a, c1, c2, b } = t;
      return {
        p: (s) => {
          const u = 1 - s;
          const k0 = u * u * u, k1 = 3 * u * u * s, k2 = 3 * u * s * s, k3 = s * s * s;
          return { x: k0 * a.x + k1 * c1.x + k2 * c2.x + k3 * b.x, y: k0 * a.y + k1 * c1.y + k2 * c2.y + k3 * b.y };
        },
        d: (s) => {
          const u = 1 - s;
          return {
            x: 3 * u * u * (c1.x - a.x) + 6 * u * s * (c2.x - c1.x) + 3 * s * s * (b.x - c2.x),
            y: 3 * u * u * (c1.y - a.y) + 6 * u * s * (c2.y - c1.y) + 3 * s * s * (b.y - c2.y),
          };
        },
        partes: 1,
      };
    }
  }
}

// Gauss-Legendre de 8 pontos: exata para polinômios até o grau 15 (Bézier) e, por partes de
// 22,5°, com erro desprezível para arcos e elipses.
const GL_X = [-0.9602898564975363, -0.7966664774136267, -0.525532409916329, -0.1834346424956498, 0.1834346424956498, 0.525532409916329, 0.7966664774136267, 0.9602898564975363];
const GL_W = [0.1012285362903763, 0.2223810344533745, 0.3137066458778873, 0.362683783378362, 0.362683783378362, 0.3137066458778873, 0.2223810344533745, 0.1012285362903763];

/** Integrais de área do contorno fechado formado pelas curvas (anti-horário = área positiva). */
function integrarCurvas(cs: Curva[]): Integrais {
  const r = zero();
  for (const c of cs) {
    for (let k = 0; k < c.partes; k++) {
      const t0 = k / c.partes, h = 1 / c.partes;
      for (let i = 0; i < 8; i++) {
        const t = t0 + (h * (GL_X[i] + 1)) / 2, w = (GL_W[i] * h) / 2;
        const { x, y } = c.p(t), d = c.d(t);
        // Green: ∬∂M/∂x dA = ∮M dy; ∬-∂L/∂y dA = ∮L dx
        r.A += w * x * d.y;
        r.Qy += (w * x * x * d.y) / 2;
        r.Qx -= (w * y * y * d.x) / 2;
        r.Iyy += (w * x * x * x * d.y) / 3;
        r.Ixx -= (w * y * y * y * d.x) / 3;
        r.Ixy += (w * x * x * y * d.y) / 2;
      }
    }
  }
  return r;
}

/** Integrais de um polígono (vértices em qualquer sentido; área sempre positiva). */
export function integraisPoligono(pts: P2[]): Integrais {
  const I = integrarCurvas(pts.map((a, i) => curvaDoTrecho({ tipo: "linha", a, b: pts[(i + 1) % pts.length] })));
  return I.A < 0 ? somar(zero(), I, -1) : I;
}
/** Integrais de um círculo. */
export const integraisCirculo = (c: P2, r: number) => integrarCurvas([curvaArco(c, r, 0, 2 * Math.PI)]);

function amostrarCurvas(cs: Curva[]): P2[] {
  const out: P2[] = [];
  for (const c of cs) {
    const n = Math.max(2, c.partes * 16);
    for (let i = 0; i < n; i++) out.push(c.p(i / n));
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// regiões do esboço

export interface Regiao {
  /** Identidade estável: as entidades do contorno. */
  chave: string;
  /** Integrais do contorno externo (área cheia, sem descontar o que está dentro). */
  contorno: Integrais;
  /** Integrais líquidas (contorno menos as regiões de dentro). */
  liquida: Integrais;
  poligono: P2[];
  /** 0 = externa; 1 = dentro de outra (furo por padrão); 2 = ilha num furo… */
  profundidade: number;
  /** Índice da região que a contém diretamente (-1 = nenhuma). */
  pai: number;
}

interface MeiaAresta {
  de: number;
  para: number;
  curva: Curva;
  geo: string;
  ang: number;
  usada: boolean;
}

/** Trecho [t0, t1] de uma curva (t1 pode passar de 1 nas curvas periódicas: círculo, elipse). */
function subCurva(c: Curva, t0: number, t1: number): Curva {
  const k = t1 - t0;
  return { p: (t) => c.p(t0 + k * t), d: (t) => { const v = c.d(t0 + k * t); return { x: v.x * k, y: v.y * k }; }, partes: Math.max(1, Math.ceil(c.partes * Math.abs(k))) };
}
const inverter = (c: Curva): Curva => ({ p: (t) => c.p(1 - t), d: (t) => { const v = c.d(1 - t); return { x: -v.x, y: -v.y }; }, partes: c.partes });

/** Parâmetro do ponto q sobre a curva (null se não estiver nela). */
function parametroNaCurva(c: Curva, q: P2, tol: number): number | null {
  const n = 24 * c.partes;
  let t = 0, dm = Infinity;
  for (let i = 0; i <= n; i++) {
    const p = c.p(i / n), d = Math.hypot(p.x - q.x, p.y - q.y);
    if (d < dm) {
      dm = d;
      t = i / n;
    }
  }
  for (let k = 0; k < 30; k++) {
    const p = c.p(t), d = c.d(t), dd = d.x * d.x + d.y * d.y;
    if (dd < 1e-30) break;
    const passo = ((p.x - q.x) * d.x + (p.y - q.y) * d.y) / dd;
    t = Math.min(1, Math.max(0, t - passo));
    if (Math.abs(passo) < 1e-15) break;
  }
  return dist(c.p(t), q) < tol ? t : null;
}

/** Ponto interior de um polígono anti-horário (um pouco à esquerda do meio da aresta mais longa). */
function pontoInterior(pol: P2[]): P2 {
  let melhor = 0, lmax = -1;
  for (let i = 0; i < pol.length; i++) {
    const l = dist(pol[i], pol[(i + 1) % pol.length]);
    if (l > lmax) {
      lmax = l;
      melhor = i;
    }
  }
  const a = pol[melhor], b = pol[(melhor + 1) % pol.length];
  const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const n = { x: -(b.y - a.y) / (lmax || 1), y: (b.x - a.x) / (lmax || 1) };
  const tam = Math.sqrt(Math.abs(areaAssinada(pol))) || 1;
  for (const k of [1e-4, 1e-3, 1e-2, 1e-1]) {
    const p = { x: m.x + n.x * k * tam, y: m.y + n.y * k * tam };
    if (pontoNoPoligono(p, pol)) return p;
  }
  return m;
}

const positiva = (I: Integrais, pol: P2[]) => (I.A < 0 ? { I: somar(zero(), I, -1), pol: pol.reverse() } : { I, pol });

/**
 * Regiões fechadas do esboço (entidades de construção, pontos e referências ficam de fora). As
 * curvas são cortadas onde se tocam ou se cruzam (ponta sobre outra curva, cruzamento de linhas,
 * arcos e círculos): figuras sobrepostas e linhas que dividem uma área formam regiões sozinhas.
 */
export function regioesDoEsboco(esb: Pick<FeatureEsboco, "pontos" | "geos">): { regioes: Regiao[]; avisos: string[] } {
  const avisos: string[] = [];
  const pts = mapaPontos(esb);
  const geos = esb.geos.filter((g) => !g.construcao && g.tipo !== "ponto" && !g.externa);
  const faces: { chave: string; I: Integrais; pol: P2[] }[] = [];

  // curvas de cada entidade: abertas (pontas) ou fechadas (círculo, elipse, spline fechada)
  const cadeias: { geo: string; curvas: Curva[]; fechada: boolean }[] = [];
  let escala = 1;
  for (const g of geos) {
    if (g.tipo === "circulo") cadeias.push({ geo: g.id, curvas: [curvaArco(pts.get(g.c)!, g.r, 0, 2 * Math.PI)], fechada: true });
    else if (g.tipo === "elipse") cadeias.push({ geo: g.id, curvas: [curvaElipse(elipseDe(g, pts), 0, 2 * Math.PI)], fechada: true });
    else if (g.tipo === "texto") {
      contornosDoTexto(g, pts).forEach((ts, i) => {
        const cs = ts.map(curvaDoTrecho);
        const r = positiva(integrarCurvas(cs), amostrarCurvas(cs));
        faces.push({ chave: `${g.id}#${i}`, ...r });
      });
    } else {
      const e = extremidades(g);
      const cs = trechosDe(g, pts, false).map(curvaDoTrecho);
      if (!e || !cs.length) continue;
      if (dist(pts.get(e[0])!, pts.get(e[1])!) < 1e-9) {
        // spline fechada sobre si mesma: contorno próprio
        const r = positiva(integrarCurvas(cs), amostrarCurvas(cs));
        if (r.I.A > 1e-12) faces.push({ chave: g.id, ...r });
        continue;
      }
      cadeias.push({ geo: g.id, curvas: cs, fechada: false });
    }
  }
  for (const p of pts.values()) escala = Math.max(escala, Math.abs(p.x), Math.abs(p.y));
  const tol = 1e-7 * escala;

  // pontos de corte: pontas de todas as curvas e cruzamentos entre elas
  const cortes: P2[] = [];
  for (const c of cadeias) if (!c.fechada) cortes.push(c.curvas[0].p(0), c.curvas[c.curvas.length - 1].p(1));
  for (let i = 0; i < geos.length; i++) for (let j = i + 1; j < geos.length; j++) cortes.push(...intersecoes(geos[i], geos[j], pts));

  // nós por posição e meias-arestas (cada pedaço de curva entre dois nós, nos dois sentidos)
  const nos: P2[] = [];
  const noDe = (p: P2) => {
    let i = nos.findIndex((n) => dist(n, p) < tol * 10);
    if (i < 0) {
      nos.push(p);
      i = nos.length - 1;
    }
    return i;
  };
  const meias: MeiaAresta[] = [];
  const direcao = (c: Curva) => {
    const a = c.p(0), b = c.p(1e-5 / c.partes);
    return Math.atan2(b.y - a.y, b.x - a.x);
  };
  const aresta = (geo: string, c: Curva) => {
    const a = noDe(c.p(0)), b = noDe(c.p(1));
    // trecho sobreposto a outro já existente (ex.: corda deitada sobre a borda): fica só um
    const meio = c.p(0.5);
    if (meias.some((h) => h.de === a && h.para === b && dist(h.curva.p(0.5), meio) < tol * 10)) return;
    if (a === b && dist(c.p(0.5), c.p(0)) < tol * 10) return;
    const v = inverter(c);
    meias.push({ de: a, para: b, curva: c, geo, ang: direcao(c), usada: false });
    meias.push({ de: b, para: a, curva: v, geo, ang: direcao(v), usada: false });
  };
  for (const cad of cadeias) {
    if (cad.fechada) {
      const c = cad.curvas[0];
      const ts = [...new Set(cortes.map((q) => parametroNaCurva(c, q, tol * 10)).filter((t): t is number => t !== null).map((t) => (t >= 1 - 1e-12 ? 0 : t)))].sort((a, b) => a - b);
      const unicos = ts.filter((t, i) => i === 0 || t - ts[i - 1] > 1e-9);
      if (!unicos.length) {
        faces.push({ chave: cad.geo, ...positiva(integrarCurvas([c]), amostrarCurvas([c])) });
        continue;
      }
      // curva periódica: os pedaços dão a volta (o último passa de 1)
      unicos.forEach((t, i) => aresta(cad.geo, subCurva(c, t, i + 1 < unicos.length ? unicos[i + 1] : unicos[0] + 1)));
      continue;
    }
    for (const c of cad.curvas) {
      const ts = cortes.map((q) => parametroNaCurva(c, q, tol * 10)).filter((t): t is number => t !== null && t > 1e-9 && t < 1 - 1e-9).sort((a, b) => a - b);
      const lim = [0, ...ts.filter((t, i) => i === 0 || t - ts[i - 1] > 1e-9), 1];
      for (let i = 0; i + 1 < lim.length; i++) aresta(cad.geo, lim.length === 2 ? c : subCurva(c, lim[i], lim[i + 1]));
    }
  }
  // as pontas de uma mesma entidade com vários trechos (spline) também viram nós: tudo bem

  // saídas de cada nó em ordem anti-horária
  const saidas = new Map<number, number[]>();
  meias.forEach((h, i) => saidas.set(h.de, [...(saidas.get(h.de) ?? []), i]));
  for (const l of saidas.values()) l.sort((i, j) => meias[i].ang - meias[j].ang);
  const gemea = (i: number) => (i % 2 === 0 ? i + 1 : i - 1);
  // percorre as faces mantendo a face à esquerda: em cada nó, a saída logo depois da gêmea no sentido horário
  for (let i0 = 0; i0 < meias.length; i0++) {
    if (meias[i0].usada) continue;
    const ciclo: number[] = [];
    let i = i0;
    for (let passos = 0; passos <= meias.length && !meias[i].usada; passos++) {
      meias[i].usada = true;
      ciclo.push(i);
      const l = saidas.get(meias[i].para)!;
      const k = l.indexOf(gemea(i));
      i = l[(k - 1 + l.length) % l.length];
    }
    const cs = ciclo.map((k) => meias[k].curva);
    const I = integrarCurvas(cs);
    // positiva = região limitada; negativa = lado de fora de um conjunto de curvas
    if (I.A > 1e-9 * escala * escala) faces.push({ chave: [...new Set(ciclo.map((k) => meias[k].geo))].sort().join("+"), I, pol: amostrarCurvas(cs) });
  }
  if (geos.some((g) => g.tipo === "spline" || g.tipo === "elipse" || g.tipo === "arcoElipse" || g.tipo === "parabola") && geos.length > 1) {
    // cruzamentos de splines e cônicas não são cortados sozinhos
    const pols = faces.map((f) => f.pol);
    const cruzam = pols.some((a, i) => pols.some((b, j) => j > i && a.some((p) => pontoNoPoligono(p, b)) && b.some((p) => !pontoNoPoligono(p, a)) && a.some((p) => !pontoNoPoligono(p, b))));
    if (cruzam) avisos.push("Há contornos com spline, elipse ou parábola que se cruzam: use Aparar no cruzamento para separar as regiões.");
  }

  // aninhamento: quem está dentro de quem
  const amostras = faces.map((f) => pontoInterior(f.pol));
  const regioes: Regiao[] = faces.map((f, i) => {
    const pais = faces.map((_, j) => j).filter((j) => j !== i && faces[j].I.A > f.I.A && pontoNoPoligono(amostras[i], faces[j].pol));
    const pai = pais.sort((a, b) => faces[a].I.A - faces[b].I.A)[0] ?? -1;
    return { chave: f.chave, contorno: f.I, liquida: f.I, poligono: f.pol, profundidade: pais.length, pai };
  });
  for (let i = 0; i < regioes.length; i++) {
    const p = regioes[i].pai;
    if (p >= 0) regioes[p].liquida = somar(regioes[p].liquida, regioes[i].contorno, -1);
  }
  // chaves repetidas (mesma entidade em duas regiões) ganham sufixo
  const vistas = new Map<string, number>();
  for (const r of regioes) {
    const n = vistas.get(r.chave) ?? 0;
    vistas.set(r.chave, n + 1);
    if (n) r.chave += `#${n}`;
  }
  return { regioes, avisos };
}

// ---------------------------------------------------------------------------------------------
// cálculo

export interface Inercia {
  Ix: number;
  Iy: number;
  Ixy: number;
  /** Polar (Ix + Iy). */
  J: number;
  I1: number;
  I2: number;
  /** Ângulo do eixo principal 1 (graus, a partir de +x). */
  theta: number;
}

/** Linha da memória de cálculo (figura composta: contorno cheio + recortes com sinal −). */
export interface LinhaCg {
  nome: string;
  /** Região de origem. */
  chave: string;
  recorte: boolean;
  A: number;
  m: number;
  x: number;
  y: number;
  /** Momentos de área nos eixos do próprio centroide (com o sinal da área). */
  Ix: number;
  Iy: number;
  Ixy: number;
}

export interface FiguraCg {
  chave: string;
  nome: string;
  furo: boolean;
  /** Furo por estar dentro de outra (padrão). */
  furoPadrao: boolean;
  profundidade: number;
  /** Área líquida e o centroide dela (CG da figura). */
  A: number;
  m: number;
  x: number;
  y: number;
  Ix: number;
  Iy: number;
  Ixy: number;
  poligono: P2[];
}

export interface ResultadoCg {
  figuras: FiguraCg[];
  linhas: LinhaCg[];
  A: number;
  centroide: P2 | null;
  m: number;
  cg: P2 | null;
  areaCentroide: Inercia | null;
  areaOrigem: Inercia | null;
  /** Placa fina; Iz = polar, perpendicular ao plano, pelo CG (kg·mm²). */
  massaCg: (Inercia & { Iz: number }) | null;
  avisos: string[];
}

const RAD = Math.PI / 180;
const limpo = (v: number, escala: number) => (Math.abs(v) <= 1e-12 * Math.abs(escala) ? 0 : v);

export function principais(Ix: number, Iy: number, Ixy: number): Inercia {
  Ixy = limpo(Ixy, Math.abs(Ix) + Math.abs(Iy));
  const med = (Ix + Iy) / 2, raio = Math.hypot((Ix - Iy) / 2, Ixy);
  let theta = (0.5 * Math.atan2(-2 * Ixy, Ix - Iy)) / RAD;
  if (Math.abs(theta) < 1e-9) theta = 0;
  if (theta <= -90 + 1e-9) theta += 180; // ângulo em (−90°, 90°]
  return { Ix, Iy, Ixy, J: Ix + Iy, I1: med + raio, I2: med - raio, theta };
}

/** Centroide e momentos próprios de integrais (área positiva). */
function proprios(I: Integrais) {
  const x = limpo(I.Qy / I.A, Math.sqrt(Math.abs(I.A)) + Math.abs(I.Qy / I.A));
  const y = limpo(I.Qx / I.A, Math.sqrt(Math.abs(I.A)) + Math.abs(I.Qx / I.A));
  return { x, y, Ix: I.Ixx - I.A * y * y, Iy: I.Iyy - I.A * x * x, Ixy: limpo(I.Ixy - I.A * x * y, I.Ixx + I.Iyy) };
}

/** Massa (kg) de uma área (mm²) no material único. */
export const massaDoMaterial = (A: number, mat: Material) => mat.densidade * mat.espessura * A * 1e-9;

/** Nome padrão das regiões novas ("Figura 1", "Figura 2"…), guardado em `dados`. */
export function nomearRegioes(regioes: Regiao[], dados: Record<string, DadosRegiao>) {
  const usados = new Set(Object.values(dados).map((d) => d.nome));
  let n = 1;
  for (const r of [...regioes].sort((a, b) => b.liquida.A - a.liquida.A)) {
    if (dados[r.chave]) continue;
    while (usados.has(`Figura ${n}`)) n++;
    dados[r.chave] = { nome: `Figura ${n}` };
    usados.add(`Figura ${n}`);
  }
}

export function calcular(regioes: Regiao[], dados: Record<string, DadosRegiao>, mat: Material, avisosRegioes: string[] = []): ResultadoCg {
  const avisos = [...avisosRegioes];
  const nome = (r: Regiao) => dados[r.chave]?.nome ?? "Figura";
  const furoDe = (r: Regiao) => dados[r.chave]?.furo ?? r.profundidade % 2 === 1;
  const figuras: FiguraCg[] = [];
  const linhas: LinhaCg[] = [];
  const faltam: string[] = [];
  regioes.forEach((r, i) => {
    const furo = furoDe(r);
    const A = r.liquida.A;
    const pr = A > 1e-12 ? proprios(r.liquida) : { x: NaN, y: NaN, Ix: 0, Iy: 0, Ixy: 0 };
    let m = 0;
    if (!furo) {
      if (mat.modo === "densidade") m = massaDoMaterial(A, mat);
      else {
        const dm = dados[r.chave]?.massa;
        m = typeof dm === "number" && dm >= 0 ? dm : NaN;
        if (Number.isNaN(m)) faltam.push(nome(r));
      }
    }
    figuras.push({ chave: r.chave, nome: nome(r), furo, furoPadrao: r.profundidade % 2 === 1, profundidade: r.profundidade, A, m, ...pr, poligono: r.poligono });
    if (furo) return;
    if (!(A > 1e-12)) {
      avisos.push(`${nome(r)}: área nula.`);
      return;
    }
    // método das figuras compostas: contorno cheio (+) e cada região de dentro recortada (−)
    const sigma = m / A;
    const pc = proprios(r.contorno);
    linhas.push({ nome: nome(r), chave: r.chave, recorte: false, A: r.contorno.A, m: sigma * r.contorno.A, ...pc });
    regioes.forEach((f) => {
      if (f.pai !== i) return;
      const pf = proprios(f.contorno);
      linhas.push({
        nome: `${nome(f)} (${furoDe(f) ? "furo" : "recorte"})`, chave: f.chave, recorte: true,
        A: -f.contorno.A, m: -sigma * f.contorno.A, x: pf.x, y: pf.y, Ix: -pf.Ix, Iy: -pf.Iy, Ixy: -pf.Ixy,
      });
    });
  });
  const vazio: ResultadoCg = { figuras, linhas, A: 0, centroide: null, m: NaN, cg: null, areaCentroide: null, areaOrigem: null, massaCg: null, avisos };
  if (!linhas.length) {
    if (!regioes.length) avisos.push("Desenhe um contorno fechado (as curvas precisam se ligar pelas pontas).");
    return vazio;
  }
  const soma = (fn: (l: LinhaCg) => number) => linhas.reduce((s, l) => s + fn(l), 0);
  const A = soma((l) => l.A);
  if (!(A > 1e-12)) return { ...vazio, A };
  const centroide = { x: soma((l) => l.A * l.x) / A, y: soma((l) => l.A * l.y) / A };
  const areaCentroide = principais(
    soma((l) => l.Ix + l.A * (l.y - centroide.y) ** 2),
    soma((l) => l.Iy + l.A * (l.x - centroide.x) ** 2),
    soma((l) => l.Ixy + l.A * (l.x - centroide.x) * (l.y - centroide.y)),
  );
  const areaOrigem = principais(soma((l) => l.Ix + l.A * l.y * l.y), soma((l) => l.Iy + l.A * l.x * l.x), soma((l) => l.Ixy + l.A * l.x * l.y));
  let m = soma((l) => l.m);
  let cg: P2 | null = null;
  let massaCg: ResultadoCg["massaCg"] = null;
  if (faltam.length) {
    avisos.push(`Falta a massa de: ${faltam.join(", ")}.`);
    m = NaN;
  } else if (!(m > 1e-15)) {
    avisos.push(mat.modo === "densidade" ? "Massa total zero: confira a densidade e a espessura." : "A massa total é zero.");
  } else {
    const c = { x: soma((l) => l.m * l.x) / m, y: soma((l) => l.m * l.y) / m };
    cg = c;
    // massa uniforme em cada figura: densidade superficial σ = m/A
    const sig = (l: LinhaCg) => (l.A ? l.m / l.A : 0);
    const p = principais(
      soma((l) => sig(l) * l.Ix + l.m * (l.y - c.y) ** 2),
      soma((l) => sig(l) * l.Iy + l.m * (l.x - c.x) ** 2),
      soma((l) => sig(l) * l.Ixy + l.m * (l.x - c.x) * (l.y - c.y)),
    );
    massaCg = { ...p, Iz: p.J };
  }
  return { figuras, linhas, A, centroide, m, cg, areaCentroide, areaOrigem, massaCg, avisos };
}

/** Atalho: regiões do esboço + nomes + cálculo. */
export function calcularDoc(d: DocCg2d): ResultadoCg & { regioes: Regiao[] } {
  const { regioes, avisos } = regioesDoEsboco(d.esboco);
  nomearRegioes(regioes, d.regioes);
  return { ...calcular(regioes, d.regioes, d.material, avisos), regioes };
}
