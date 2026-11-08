// WJGoldDiamond: ornamentos desenhados (filigrana, volutas, galerias, pontas com bolinha).
// Cada ornamento é um esboço do WJCAD na "vista de cima do aro": x = ao longo do aro (0 = topo),
// y = largura (eixo Z). Cada entidade que não é de construção vira um FIO de perfil redondo
// (Ø inicial/final, altura inicial/final sobre o aro); cada PONTO vira uma conta (bolinha) ou uma
// pedrinha em inglesa. Simetria espelha o desenho; "envolver" dobra o desenho sobre o aro.
// Puro (sem kernel): roda na interface, no worker e nos testes em Node.

import type { FeatureEsboco } from "../model";
import { amostrar, mapaPontos, ORIGEM, type P2 as Q2 } from "../esboco/geometria";
import type { V3 } from "./regras";

export type Simetria = "nenhuma" | "x" | "y" | "xy";
export interface FioCfg { d0?: number; d1?: number; a0?: number; a1?: number }
export interface PontoCfg { tipo: "conta" | "inglesa"; d: number; material: string }
export interface Ornamento {
  id: string;
  nome: string;
  ativo: boolean;
  esboco: FeatureEsboco;
  /** altura do fio sobre a superfície do aro (mm; negativa afunda no aro) */
  altura: number;
  /** Ø padrão dos fios (mm) */
  diametro: number;
  simetria: Simetria;
  /** dobra o desenho sobre o aro (senão fica num plano tangente ao topo) */
  envolver: boolean;
  /** bolinha (Ø × 1,3) nas pontas soltas dos fios */
  pontas: boolean;
  fios: Record<string, FioCfg>;
  pontos: Record<string, PontoCfg>;
}

export interface Fio { pts: V3[]; raios: number[]; bolinhaIni: boolean; bolinhaFim: boolean }
export interface PontoOrn { p: V3; th: number; z: number; base: number; tipo: "conta" | "inglesa"; d: number; material: string }
export interface Ornamentacao { fios: Fio[]; pontos: PontoOrn[]; avisos: string[] }

const espelhos: Record<Simetria, [number, number][]> = {
  nenhuma: [[1, 1]],
  x: [[1, 1], [-1, 1]],
  y: [[1, 1], [1, -1]],
  xy: [[1, 1], [-1, 1], [1, -1], [-1, -1]],
};

/** Polilinha reamostrada por comprimento de arco (n pontos) e o comprimento total. */
export function reamostrar(pl: Q2[], n: number): { pts: Q2[]; L: number } {
  const acum = [0];
  for (let i = 1; i < pl.length; i++) acum.push(acum[i - 1] + Math.hypot(pl[i].x - pl[i - 1].x, pl[i].y - pl[i - 1].y));
  const L = acum[acum.length - 1];
  const pts: Q2[] = [];
  let k = 0;
  for (let i = 0; i < n; i++) {
    const s = (L * i) / (n - 1);
    while (k < pl.length - 2 && acum[k + 1] < s) k++;
    const seg = acum[k + 1] - acum[k] || 1;
    const t = Math.min(1, Math.max(0, (s - acum[k]) / seg));
    pts.push({ x: pl[k].x + (pl[k + 1].x - pl[k].x) * t, y: pl[k].y + (pl[k + 1].y - pl[k].y) * t });
  }
  return { pts, L };
}

/** Mesma curva (em qualquer sentido ou ponto de partida, como nos círculos espelhados): mesmos pontos. */
const iguais = (a: Q2[], b: Q2[], tol = 1e-3) =>
  a.length === b.length && a.every((p) => b.some((q) => Math.hypot(p.x - q.x, p.y - q.y) < tol)) && b.every((p) => a.some((q) => Math.hypot(p.x - q.x, p.y - q.y) < tol));

/**
 * Converte os ornamentos em fios e pontos 3D. `t(θ)` = espessura do aro no ângulo θ (mm a partir
 * do Ø interno). O desenho é dobrado com o raio do topo (R + t(0) + altura): o comprimento
 * desenhado no topo é o comprimento real sobre o aro.
 */
export function ornamentar(orns: Ornamento[], R: number, t: (th: number) => number): Ornamentacao {
  const fios: Fio[] = [], pontos: PontoOrn[] = [], avisos: string[] = [];
  for (const o of orns) {
    if (!o.ativo) continue;
    const mp = mapaPontos(o.esboco);
    mp.set(ORIGEM, { x: 0, y: 0 });
    const Rref = R + t(0) + o.altura;
    const no3d = (x: number, y: number, alt: number, r: number): { p: V3; th: number; base: number } => {
      if (!o.envolver) {
        const base = R + t(0);
        return { p: [x, base + alt + r, y], th: Math.atan2(x, base), base };
      }
      const th = x / Rref, base = R + t(th), rc = base + alt + r;
      return { p: [rc * Math.sin(th), rc * Math.cos(th), y], th, base };
    };
    // extremidades usadas por mais de uma entidade: junta, sem bolinha
    const usos = new Map<string, number>();
    for (const g of o.esboco.geos) {
      if (g.construcao || g.tipo === "ponto" || g.tipo === "texto") continue;
      for (const id of "p1" in g ? [g.p1, g.p2] : "ini" in g ? [g.ini, g.fim] : g.tipo === "spline" ? [g.pontos[0], g.pontos[g.pontos.length - 1]] : [])
        usos.set(id, (usos.get(id) ?? 0) + 1);
    }
    const solta = (id: string | undefined) => !!id && (usos.get(id) ?? 0) <= 1;
    for (const g of o.esboco.geos) {
      if (g.construcao || g.tipo === "texto") continue;
      if (g.tipo === "ponto") {
        const q = mp.get(g.p);
        if (!q) continue;
        const c: PontoCfg = o.pontos[g.p] ?? { tipo: "conta", d: Math.round(o.diametro * 1.6 * 100) / 100, material: "diamante" };
        const ja: Q2[] = [];
        for (const [sx, sy] of espelhos[o.simetria]) {
          const x = q.x * sx, y = q.y * sy;
          if (ja.some((p) => Math.hypot(p.x - x, p.y - y) < 1e-3)) continue;
          ja.push({ x, y });
          const r = c.tipo === "conta" ? c.d / 2 : 0;
          const m = no3d(x, y, o.altura, r);
          pontos.push({ p: m.p, th: m.th, z: y, base: m.base, tipo: c.tipo, d: c.d, material: c.material });
        }
        continue;
      }
      const pl = amostrar(g, mp, Math.PI / 36);
      if (pl.length < 2) continue;
      const cfg = o.fios[g.id] ?? {};
      const d0 = cfg.d0 ?? o.diametro, d1 = cfg.d1 ?? d0, a0 = cfg.a0 ?? o.altura, a1 = cfg.a1 ?? a0;
      const ext: [string | undefined, string | undefined] = "p1" in g ? [g.p1, g.p2] : "ini" in g ? [g.ini, g.fim] : g.tipo === "spline" ? [g.pontos[0], g.pontos[g.pontos.length - 1]] : [undefined, undefined];
      const fechado = Math.hypot(pl[0].x - pl[pl.length - 1].x, pl[0].y - pl[pl.length - 1].y) < 1e-6;
      const feitos: Q2[][] = [];
      for (const [sx, sy] of espelhos[o.simetria]) {
        const m2 = pl.map((p) => ({ x: p.x * sx, y: p.y * sy }));
        if (feitos.some((f) => iguais(f, m2))) continue;
        feitos.push(m2);
        let L0 = 0;
        for (let i = 1; i < m2.length; i++) L0 += Math.hypot(m2[i].x - m2[i - 1].x, m2[i].y - m2[i - 1].y);
        const n = Math.max(4, Math.min(160, Math.ceil(L0 / (Math.min(d0, d1) * 0.6)) + 1));
        const { pts } = reamostrar(m2, n);
        const fio: Fio = { pts: [], raios: [], bolinhaIni: !fechado && o.pontas && solta(ext[0]), bolinhaFim: !fechado && o.pontas && solta(ext[1]) };
        pts.forEach((p, i) => {
          const u = i / (pts.length - 1);
          const r = (d0 + (d1 - d0) * u) / 2;
          fio.pts.push(no3d(p.x, p.y, a0 + (a1 - a0) * u, r).p);
          fio.raios.push(r);
        });
        if (fechado) fio.pts[fio.pts.length - 1] = fio.pts[0];
        fios.push(fio);
      }
    }
  }
  // curvas fechadas demais para a espessura do fio (o fio dobraria sobre si mesmo)
  let apertadas = 0;
  for (const f of fios) {
    for (let i = 1; i + 1 < f.pts.length; i++) {
      const a = f.pts[i - 1], b = f.pts[i], c = f.pts[i + 1];
      const ab = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]), bc = Math.hypot(c[0] - b[0], c[1] - b[1], c[2] - b[2]), ac = Math.hypot(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
      const s = (ab + bc + ac) / 2, area = Math.sqrt(Math.max(0, s * (s - ab) * (s - bc) * (s - ac)));
      const rc = area > 1e-12 ? (ab * bc * ac) / (4 * area) : Infinity;
      if (rc < f.raios[i] * 1.05) { apertadas++; break; }
    }
  }
  if (apertadas) avisos.push(`${apertadas} fio(s) com curva mais fechada que o próprio raio: abra a curva ou afine o fio.`);
  return { fios, pontos, avisos };
}

/** Esboço novo de ornamento com as guias (construção, fixas): bordas do aro e caixa da gema central. */
export function esbocoNovoOrnamento(id: string, larguraAro: number, gema: { comprimento: number; largura: number } | null, comprimento: number): FeatureEsboco {
  const esb: FeatureEsboco = { id, tipo: "esboco", nome: "Ornamento", suprimida: false, suporte: { tipo: "plano", plano: "XY", deslocamento: 0 }, pontos: [], geos: [], restricoes: [] };
  let n = 0;
  const ponto = (x: number, y: number) => {
    const pid = `guia-p${n++}`;
    esb.pontos.push({ id: pid, x, y });
    esb.restricoes.push({ id: `guia-f${n}`, tipo: "fixo", a: pid, x, y });
    return pid;
  };
  const linha = (x1: number, y1: number, x2: number, y2: number) => esb.geos.push({ id: `guia-g${n++}`, tipo: "linha", p1: ponto(x1, y1), p2: ponto(x2, y2), construcao: true });
  const h = larguraAro / 2, L = comprimento / 2;
  linha(-L, h, L, h);
  linha(-L, -h, L, -h);
  if (gema) {
    const a = gema.comprimento / 2, b = gema.largura / 2;
    linha(-a, -b, a, -b);
    linha(a, -b, a, b);
    linha(a, b, -a, b);
    linha(-a, b, -a, -b);
  }
  return esb;
}

/**
 * Exemplo "vintage" (moldura em pipa em volta da gema oval norte-sul, volutas nos ombros, bolinhas
 * nas pontas e pedrinhas em inglesa nas laterais). Coordenadas do desenho: x ao longo do aro, y na
 * largura; o primeiro quadrante é espelhado nos outros três.
 */
export function ornamentoVintage(id: string, larguraAro: number): Ornamento {
  const esb = esbocoNovoOrnamento(`${id}-esb`, larguraAro, { comprimento: 6, largura: 8 }, 26);
  let n = 0;
  const pt = (x: number, y: number) => {
    const pid = `${id}-p${n++}`;
    esb.pontos.push({ id: pid, x, y });
    return pid;
  };
  const spline = (pts: [number, number][]) => {
    const gid = `${id}-g${n++}`;
    esb.geos.push({ id: gid, tipo: "spline", pontos: pts.map(([x, y]) => pt(x, y)) });
    return gid;
  };
  const fios: Record<string, FioCfg> = {};
  // moldura em volta da gema, na altura da galeria (encosta nas garras)
  const moldura = spline([[0, 4.55], [1.75, 4.05], [3.05, 2.6], [3.55, 0]]);
  fios[moldura] = { a0: 1.3, a1: 1.3, d0: 0.75 };
  // arestas da pipa: da ponta norte descem até o ombro do aro
  const pipa = spline([[0, 6.4], [1.6, 4.9], [3.3, 3.4], [4.6, 1.6], [5.4, 0.3]]);
  fios[pipa] = { a0: 1.1, a1: 0.05, d0: 0.7, d1: 0.85 };
  // braço interno da pipa (volta para a moldura)
  const braco = spline([[0.9, 5.4], [2.4, 4.5], [3.7, 3.2]]);
  fios[braco] = { a0: 1.2, a1: 0.9, d0: 0.55, d1: 0.65 };
  // voluta do ombro: sai da moldura e enrola sobre o aro
  const voluta = spline([[3.6, 0.6], [5.0, 1.9], [6.8, 1.9], [7.7, 1.1], [7.3, 0.35], [6.6, 0.7]]);
  fios[voluta] = { a0: 0.9, a1: 0.05, d0: 0.75, d1: 0.6 };
  // ponta norte (bolinha) e pedrinha lateral em inglesa
  const norte = pt(0, 6.9);
  esb.geos.push({ id: `${id}-g${n++}`, tipo: "ponto", p: norte });
  const lateral = pt(9.4, 0);
  esb.geos.push({ id: `${id}-g${n++}`, tipo: "ponto", p: lateral });
  return {
    id, nome: "Filigrana", ativo: true, esboco: esb, altura: 0.05, diametro: 0.7, simetria: "xy", envolver: true, pontas: true, fios,
    pontos: { [norte]: { tipo: "conta", d: 1.1, material: "diamante" }, [lateral]: { tipo: "inglesa", d: 1.6, material: "diamante" } },
  };
}
