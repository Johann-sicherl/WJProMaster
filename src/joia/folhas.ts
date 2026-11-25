// WJGoldDiamond: construtor "Folhas" (J9b). Folha paramétrica, sólido de fundição: contorno (lanceolada,
// oval, coração ou personalizado a partir de uma spline do esboço), comprimento, largura, ponta aguda ou
// arredondada, nervura central (vinco ou saliente), dobra ao longo da nervura, curvatura no comprimento,
// espessura constante (≥ mínimo da liga) e borda arredondada ou viva. Posição e orientação como as gemas
// livres (θ, lateral, altura, giro, inclinação, seguir a superfície, simetria). "Folha com pedra": a
// folha fica sob uma gema livre (a pedra assenta dentro dela e as garras se apoiam na folha).
// Referencial local: base (pecíolo) na origem, comprimento em +x, espessura em +y, largura em z.
// Puro: interface, worker e testes em Node.

import { lugarLivre, type GemaLivre } from "./gemasLivres";
import type { Simetria } from "./ornamento";
import { interpolar, orientar } from "./fios";
import type { Malha } from "./escultura";
import { proporcoes, type DocJoia, type Montagem, type V3 } from "./regras";

export type ContornoFolha = "lanceolada" | "oval" | "coracao" | "personalizada";

export interface Folha {
  id: string;
  nome: string;
  ativo: boolean;
  contorno: ContornoFolha;
  /** personalizado: meia-largura relativa (0–1) em estações iguais da base à ponta (vinda de uma spline do esboço) */
  perfil?: number[];
  comprimento: number;
  largura: number;
  ponta: "aguda" | "arredondada";
  nervura: "vinco" | "saliente" | "nenhuma";
  /** profundidade/altura da nervura (mm) */
  profNervura: number;
  /** dobra ao longo da nervura (°; positivo levanta as bordas) */
  dobra: number;
  /** curvatura no comprimento: quanto a ponta sobe (+) ou desce (−), mm */
  curvatura: number;
  espessura: number;
  borda: "arredondada" | "viva";
  /** lugar e orientação (como nas gemas livres) */
  th: number;
  z: number;
  altura: number;
  refAltura: "aro" | "central";
  giro: number;
  inclinacao: number;
  seguir: boolean;
  simetria: Simetria;
  /** folha com pedra: id da gema livre que assenta nela (o lugar vem da gema; `altura` = abaixo da cintura) */
  pedra?: string;
  /** raio de concordância próprio (mm; ausente = o global) */
  concordancia?: number;
}

/** Folha posta (uma por cópia da simetria): origem, rotação e pontos de apoio (meio da chapa) no mundo. */
export interface FolhaPosta { id: string; nome: string; copia: number; p: V3; M: number[]; apoios: V3[]; e: number; concordancia?: number }

type M3 = number[];
const RAD = Math.PI / 180;
const mm = (A: M3, B: M3): M3 => {
  const C = new Array(9).fill(0);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) C[3 * i + j] += A[3 * i + k] * B[3 * k + j];
  return C;
};
const diag = (a: number, b: number, c: number): M3 => [a, 0, 0, 0, b, 0, 0, 0, c];
const aplicar = (M: M3, v: V3): V3 => [M[0] * v[0] + M[1] * v[1] + M[2] * v[2], M[3] * v[0] + M[4] * v[1] + M[5] * v[2], M[6] * v[0] + M[7] * v[1] + M[8] * v[2]];
const espelhos: Record<Simetria, [number, number][]> = { nenhuma: [[1, 1]], x: [[1, 1], [-1, 1]], y: [[1, 1], [1, -1]], xy: [[1, 1], [-1, 1], [1, -1], [-1, -1]] };

export const CONTORNOS: [ContornoFolha, string][] = [["lanceolada", "Lanceolada"], ["oval", "Oval"], ["coracao", "Coração"], ["personalizada", "Personalizada (spline do esboço)"]];

export function folhaNova(id: string, n: number, contorno: ContornoFolha = "lanceolada"): Folha {
  return {
    id, nome: `Folha ${n}`, ativo: true, contorno, comprimento: 3, largura: 1.4, ponta: "aguda", nervura: "vinco", profNervura: 0.12, dobra: 20, curvatura: -0.3,
    espessura: 0.6, borda: "arredondada", th: 30, z: 0, altura: -0.25, refAltura: "aro", giro: 0, inclinacao: 0, seguir: true, simetria: "nenhuma",
  };
}

// ---------------------------------------------------------------------------------------------
// contorno: meia-largura relativa f(s), s = 0 na base e 1 na ponta, máximo 1

const cacheNorm = new Map<string, number>();

/** Meia-largura relativa (0–1) do contorno na estação s. */
export function larguraRelativa(f: Pick<Folha, "contorno" | "ponta" | "perfil">, s: number): number {
  const bruta = (x: number) => {
    const pt = f.ponta === "aguda" ? 1 : 0.5, y = Math.max(0, 1 - x), b = Math.max(0, x);
    switch (f.contorno) {
      case "oval": return b ** 0.5 * y ** (f.ponta === "aguda" ? 0.85 : 0.5);
      case "coracao": return b ** 0.3 * y ** pt * (1 + 1.6 * y * y);
      case "personalizada": {
        const p = f.perfil?.length ? f.perfil : [0, 0.8, 1, 0.8, 0];
        return Math.max(0, interpolar(p.map((v, i) => ({ u: i / (p.length - 1), v })), [x])[0]);
      }
      default: return b ** 0.6 * y ** pt;
    }
  };
  const k = `${f.contorno}|${f.ponta}|${f.perfil?.join(",") ?? ""}`;
  let mx = cacheNorm.get(k);
  if (mx === undefined) {
    mx = 0;
    for (let i = 0; i <= 400; i++) mx = Math.max(mx, bruta(i / 400));
    cacheNorm.set(k, mx || 1);
  }
  return Math.min(1, bruta(s) / (mx || 1));
}

/** Contorno personalizado a partir de uma curva desenhada (pontos em qualquer posição): meia-largura em 9 estações. */
export function perfilDeCurva(pts: { x: number; y: number }[]): { perfil: number[]; comprimento: number; largura: number } | null {
  if (pts.length < 3) return null;
  // eixo principal = direção dos dois pontos mais afastados
  let a = pts[0], b = pts[1], dmax = 0;
  for (const p of pts) for (const q of pts) { const d = Math.hypot(p.x - q.x, p.y - q.y); if (d > dmax) { dmax = d; a = p; b = q; } }
  if (dmax < 0.2) return null;
  const ux = (b.x - a.x) / dmax, uy = (b.y - a.y) / dmax;
  const N = 9, meia = new Array(N).fill(0);
  for (const p of pts) {
    const s = ((p.x - a.x) * ux + (p.y - a.y) * uy) / dmax, t = Math.abs(-(p.x - a.x) * uy + (p.y - a.y) * ux);
    const i = Math.round(Math.min(1, Math.max(0, s)) * (N - 1));
    meia[i] = Math.max(meia[i], t);
  }
  // estações sem ponto: média das vizinhas; pontas fechadas
  for (let i = 1; i < N - 1; i++) if (!meia[i]) meia[i] = (meia[i - 1] + (meia[i + 1] || meia[i - 1])) / 2;
  meia[0] = 0;
  meia[N - 1] = 0;
  const mx = Math.max(...meia);
  if (!(mx > 0.05)) return null;
  return { perfil: meia.map((v) => Math.round((v / mx) * 1000) / 1000), comprimento: Math.round(dmax * 100) / 100, largura: Math.round(2 * mx * 100) / 100 };
}

// ---------------------------------------------------------------------------------------------
// malha local da folha

/** Superfície média: altura (y) em (x ao longo, z na largura). */
function meio(f: Folha, s: number, z: number, W: number): number {
  // dobra arredondada (raio ≥ espessura) e nervura larga o bastante: a face de baixo, deslocada pela normal,
  // nunca dobra sobre si mesma (curvatura da superfície média sempre menor que 1/espessura)
  const c = Math.max(f.espessura, 0.15 * f.largura);
  let y = f.curvatura * s * s + (Math.sqrt(z * z + c * c) - c) * Math.tan((f.dobra * RAD) / 2);
  if (f.nervura !== "nenhuma") {
    const larg = Math.max(0.08, 0.14 * f.largura, 1.2 * Math.sqrt(2 * f.profNervura * f.espessura)), fade = Math.min(1, 4 * s, 4 * (1 - s));
    y += (f.nervura === "vinco" ? -1 : 1) * f.profNervura * Math.exp(-((z / larg) ** 2)) * fade;
  }
  void W;
  return y;
}

/** Ponto j (de K, múltiplo de 4) da seção em estádio: semicírculos de raio r nas bordas e retas de ±a. */
function estadio(a: number, r: number, j: number, K: number): [number, number] {
  const nl = Math.max(1, Math.round(K / 5)), na = K / 2 - nl; // pontos por arco (com as pontas) e por reta (internos)
  const k = j % (K / 2), lado = j < K / 2 ? 1 : -1;
  if (k < na) {
    const al = -Math.PI / 2 + (Math.PI * k) / (na - 1);
    return [lado * (a + r * Math.cos(al)), lado * r * Math.sin(al)];
  }
  const t = (k - na + 1) / (nl + 1);
  return [lado * (a - 2 * a * t), lado * r];
}

/**
 * Malha local fechada da folha: estações ao longo do comprimento (mais juntas nas pontas), seção de
 * espessura constante deslocada pela normal da superfície média (borda arredondada = meio círculo de
 * raio e/2; viva = quase reta) e um polo em cada ponta (sem triângulos degenerados).
 */
export function malhaFolha(f: Folha, NS = 36, K = 24): Malha {
  const L = f.comprimento, r = f.espessura / 2, viva = f.borda === "viva";
  const pos: number[] = [], tri: number[] = [];
  const P = (s: number, z: number): V3 => [s * L, meio(f, s, z, 0), z];
  const normal = (s: number, z: number): V3 => {
    const h = 1e-3, dx = (meio(f, Math.min(1, s + h / L), z, 0) - meio(f, Math.max(0, s - h / L), z, 0)) / (2 * h);
    const dz = (meio(f, s, z + h, 0) - meio(f, s, z - h, 0)) / (2 * h);
    const n: V3 = [-dx, 1, -dz], k = Math.hypot(...n);
    return [n[0] / k, n[1] / k, n[2] / k];
  };
  const aneis: number[] = [];
  for (let i = 1; i < NS; i++) {
    const s = (1 - Math.cos((Math.PI * i) / NS)) / 2;
    const W = Math.max(r * 1.02, (f.largura / 2) * larguraRelativa(f, s));
    const a = W - r; // meia largura da parte reta
    aneis.push(pos.length / 3);
    for (let j = 0; j < K; j++) {
      // ponto da seção (z lateral, y espessura) antes de seguir a superfície
      let z: number, y: number;
      if (viva) {
        const phi = (2 * Math.PI * j) / K, c = Math.cos(phi), sn = Math.sin(phi);
        z = W * Math.sign(c) * Math.abs(c) ** 0.2;
        y = r * Math.sign(sn) * Math.abs(sn) ** 0.2;
      } else [z, y] = estadio(a, r, j, K);
      const zc = Math.max(-a, Math.min(a, z));
      const m = P(s, zc), n = normal(s, zc);
      const p: V3 = [m[0] + n[0] * y, m[1] + n[1] * y + 0, m[2] + n[2] * y + (z - zc)];
      pos.push(p[0], p[1], p[2]);
    }
  }
  const nA = aneis.length;
  for (let i = 0; i < nA - 1; i++)
    for (let j = 0; j < K; j++) {
      const a = aneis[i] + j, b = aneis[i] + ((j + 1) % K), c = aneis[i + 1] + j, d = aneis[i + 1] + ((j + 1) % K);
      tri.push(a, c, d, a, d, b);
    }
  // polos (base e ponta): meia espessura além do primeiro/último anel
  const base = P(0, 0), ponta = P(1, 0);
  const pb = pos.length / 3;
  pos.push(base[0] - r, base[1], base[2]);
  const pp = pos.length / 3;
  pos.push(ponta[0] + r, ponta[1], ponta[2]);
  for (let j = 0; j < K; j++) {
    tri.push(pb, aneis[0] + j, aneis[0] + ((j + 1) % K));
    tri.push(pp, aneis[nA - 1] + ((j + 1) % K), aneis[nA - 1] + j);
  }
  return orientar({ pos: new Float32Array(pos), tri: new Uint32Array(tri) });
}

/** Volume esperado (mm³) da folha plana pela integral da seção (estádio: 4·r·(W − r) + π·r²). */
export function volumeEsperado(f: Folha): number {
  const r = f.espessura / 2, N = 2000;
  let v = 0;
  for (let i = 0; i < N; i++) {
    const s = (i + 0.5) / N, W = Math.max(r * 1.02, (f.largura / 2) * larguraRelativa(f, s));
    v += (f.borda === "viva" ? 4 * W * r * 0.94 : 4 * r * (W - r) + Math.PI * r * r) / N;
  }
  return v * f.comprimento;
}

/** Malha da folha no mundo (rotação M, origem p). */
export function malhaNoMundo(local: Malha, p: V3, M: number[]): Malha {
  const pos = new Float32Array(local.pos.length);
  for (let i = 0; i < pos.length; i += 3) {
    const w = aplicar(M, [local.pos[i], local.pos[i + 1], local.pos[i + 2]]);
    pos[i] = w[0] + p[0]; pos[i + 1] = w[1] + p[1]; pos[i + 2] = w[2] + p[2];
  }
  return { pos, tri: local.tri };
}

// ---------------------------------------------------------------------------------------------
// lugar na joia

/** Põe as folhas (com as cópias da simetria) na montagem. Roda antes das gemas livres (as garras se apoiam nas folhas). */
export function posicionarFolhas(d: DocJoia, m: Montagem) {
  m.folhas = [];
  if (!d.folhasAtivo) return;
  const yCentral = m.cabeca ? m.cabeca.ref.p[1] : null;
  for (const f of d.folhas) {
    if (!f.ativo) continue;
    // folha com pedra: o lugar vem da gema livre (mesmas cópias da simetria dela)
    const gl = f.pedra ? d.gemasLivres.find((g) => g.id === f.pedra && g.ativo) : undefined;
    const fonte = gl ?? (f as unknown as GemaLivre);
    const { p, M } = lugarLivre(d, m.R, fonte, yCentral);
    let Mf = M, pf = p;
    if (gl) {
      // folha centrada sob a gema, no eixo do comprimento da gema, `altura` abaixo da cintura
      const pr = proporcoes(gl.gema);
      const off = aplicar(M, [-f.comprimento / 2, f.altura - pr.pavilhao * 0.55 - 0 * pr.cintura, 0]);
      pf = [p[0] + off[0], p[1] + off[1], p[2] + off[2]];
      Mf = M;
    }
    const sim = gl ? gl.simetria : f.simetria;
    const feitos: V3[] = [];
    let copia = 0;
    for (const [sx, sz] of espelhos[sim]) {
      const p2: V3 = [pf[0] * sx, pf[1], pf[2] * sz];
      if (feitos.some((q) => Math.hypot(q[0] - p2[0], q[1] - p2[1], q[2] - p2[2]) < 1e-3)) continue;
      feitos.push(p2);
      const S = diag(sx, 1, sz);
      const M2 = sx * sz < 0 ? mm(mm(S, Mf), diag(1, 1, -1)) : mm(S, Mf);
      const apoios: V3[] = [];
      for (const s of [0.08, 0.22, 0.36, 0.5, 0.64, 0.78, 0.92])
        for (const t of [-0.6, -0.3, 0, 0.3, 0.6]) {
          const W = (f.largura / 2) * larguraRelativa(f, s);
          const l: V3 = [s * f.comprimento, meio(f, s, t * W, 0), t * W];
          const w = aplicar(M2, l);
          apoios.push([w[0] + p2[0], w[1] + p2[1], w[2] + p2[2]]);
        }
      m.folhas.push({ id: f.id, nome: f.nome, copia: copia++, p: p2, M: M2, apoios, e: f.espessura, concordancia: f.concordancia });
    }
  }
}

/** Valida uma folha lida do arquivo (campos fora da faixa voltam ao limite). */
export function validarFolha(x: any, i: number): Folha {
  const n = folhaNova(typeof x?.id === "string" ? x.id : `f${i}`, i + 1);
  const num = (v: unknown, p: number, a: number, b: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(b, Math.max(a, v)) : p);
  const um = <T extends string>(v: unknown, ops: readonly T[], p: T): T => (ops.includes(v as T) ? (v as T) : p);
  const perfil = Array.isArray(x?.perfil) ? x.perfil.slice(0, 33).map((v: unknown) => num(v, 0, 0, 1)) : undefined;
  return {
    id: n.id, nome: typeof x?.nome === "string" && x.nome.trim() ? x.nome.slice(0, 40) : n.nome, ativo: x?.ativo !== false,
    contorno: um(x?.contorno, ["lanceolada", "oval", "coracao", "personalizada"] as const, "lanceolada"), ...(perfil && perfil.length >= 3 ? { perfil } : {}),
    comprimento: num(x?.comprimento, n.comprimento, 0.5, 30), largura: num(x?.largura, n.largura, 0.3, 20), ponta: um(x?.ponta, ["aguda", "arredondada"] as const, "aguda"),
    nervura: um(x?.nervura, ["vinco", "saliente", "nenhuma"] as const, "vinco"), profNervura: num(x?.profNervura, n.profNervura, 0, 1),
    dobra: num(x?.dobra, n.dobra, -120, 120), curvatura: num(x?.curvatura, n.curvatura, -10, 10), espessura: num(x?.espessura, n.espessura, 0.2, 3),
    borda: um(x?.borda, ["arredondada", "viva"] as const, "arredondada"),
    th: num(x?.th, n.th, -180, 180), z: num(x?.z, 0, -20, 20), altura: num(x?.altura, n.altura, -10, 15), refAltura: um(x?.refAltura, ["aro", "central"] as const, "aro"),
    giro: num(x?.giro, 0, -360, 360), inclinacao: num(x?.inclinacao, 0, -90, 90), seguir: x?.seguir !== false, simetria: um(x?.simetria, ["nenhuma", "x", "y", "xy"] as const, "nenhuma"),
    ...(typeof x?.pedra === "string" && x.pedra ? { pedra: x.pedra } : {}),
    ...(typeof x?.concordancia === "number" && Number.isFinite(x.concordancia) ? { concordancia: Math.min(2, Math.max(0, x.concordancia)) } : {}),
  };
}

/** Zonas ocupadas pelas folhas (centro θ e meia abertura, graus) para ocar e texturas. */
export function zonasFolhas(m: Montagem): [number, number][] {
  return m.folhas.map((f) => {
    const xs = f.apoios.map((p) => Math.atan2(p[0], p[1]) / RAD);
    const r = Math.hypot(f.p[0], f.p[1]) || 1;
    return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.max(...xs) - Math.min(...xs)) / 2 + (1 / r) / RAD] as [number, number];
  });
}
