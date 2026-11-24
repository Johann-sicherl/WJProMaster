// WJGoldDiamond: imagem de referência (J9b). A foto da joia fica só no arquivo .wjgd do Johann (nunca é
// enviada a serviço nenhum). Dois modos: fixa numa vista (Frente, Cima, Lado) com escala pela medida
// conhecida, ou "alinhar câmera à foto": 2–4 pares (ponto na foto ↔ ponto no modelo) e a câmera em
// perspectiva (posição, giro e campo de visão) é ajustada por mínimos quadrados (Levenberg–Marquardt) para
// casar a perspectiva da foto. Puro: interface e testes em Node.

import type { V3 } from "./regras";

export type P2 = [number, number];
export type VistaRef = "frente" | "cima" | "lado";

/** Câmera em perspectiva: posição, rotação mundo → câmera (linhas: direita, cima, para trás) e foco em px. */
export interface Camera { pos: V3; rot: number[]; f: number }

export interface ParRef { foto: P2; modelo: V3 }

export interface RefFoto {
  ativo: boolean;
  /** imagem (data URL JPEG, já reduzida) e tamanho em px */
  imagem: string;
  largura: number;
  altura: number;
  opacidade: number;
  /** por cima do modelo (semitransparente) ou por trás */
  frente: boolean;
  modo: "vista" | "camera";
  vista: VistaRef;
  /** mm por px (modo vista) */
  escala: number;
  /** px da foto que fica no ponto de referência (centro da gema central ou topo do aro) */
  cx: number;
  cy: number;
  /** deslocamento (mm) na vista e giro (°) da foto */
  dx: number;
  dy: number;
  giro: number;
  /** pares para alinhar a câmera e a câmera resolvida */
  pares: ParRef[];
  camera?: Camera;
}

const num = (v: unknown, p: number, a: number, b: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(b, Math.max(a, v)) : p);
const v3 = (v: unknown): V3 | null => (Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === "number" && Number.isFinite(x)) ? [v[0], v[1], v[2]] : null);
const p2 = (v: unknown): P2 | null => (Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === "number" && Number.isFinite(x)) ? [v[0], v[1]] : null);

/** Tamanho máximo da imagem guardada (lado maior, px) e do texto da imagem no arquivo. */
export const LADO_MAX = 1600;
const TEXTO_MAX = 4_000_000;

export function referenciaNova(imagem: string, largura: number, altura: number): RefFoto {
  return { ativo: true, imagem, largura, altura, opacidade: 0.5, frente: true, modo: "vista", vista: "cima", escala: 0.02, cx: largura / 2, cy: altura / 2, dx: 0, dy: 0, giro: 0, pares: [] };
}

/** Valida a referência lida do arquivo (sem imagem válida = nenhuma). */
export function validarReferencia(x: any): RefFoto | null {
  if (!x || typeof x !== "object" || typeof x.imagem !== "string" || !/^data:image\/(jpeg|png|webp);base64,/.test(x.imagem) || x.imagem.length > TEXTO_MAX) return null;
  const W = num(x.largura, 0, 1, 10000), H = num(x.altura, 0, 1, 10000);
  if (!(W > 1 && H > 1)) return null;
  const pares: ParRef[] = [];
  for (const q of Array.isArray(x.pares) ? x.pares.slice(0, 8) : []) {
    const f = p2(q?.foto), mo = v3(q?.modelo);
    if (f && mo) pares.push({ foto: f, modelo: mo });
  }
  const c = x.camera, pos = v3(c?.pos);
  const camera = pos && Array.isArray(c?.rot) && c.rot.length === 9 && c.rot.every((v: unknown) => typeof v === "number" && Number.isFinite(v)) && num(c?.f, 0, 1, 1e6) > 1 ? { pos, rot: c.rot.slice(), f: c.f } : undefined;
  return {
    ativo: x.ativo !== false, imagem: x.imagem, largura: W, altura: H, opacidade: num(x.opacidade, 0.5, 0.05, 1), frente: x.frente !== false,
    modo: x.modo === "camera" && camera ? "camera" : "vista", vista: (["frente", "cima", "lado"] as const).includes(x.vista) ? x.vista : "cima",
    escala: num(x.escala, 0.02, 1e-5, 10), cx: num(x.cx, W / 2, -W, 2 * W), cy: num(x.cy, H / 2, -H, 2 * H), dx: num(x.dx, 0, -100, 100), dy: num(x.dy, 0, -100, 100), giro: num(x.giro, 0, -360, 360),
    pares, ...(camera ? { camera } : {}),
  };
}

// ---------------------------------------------------------------------------------------------
// escala pela medida e foto fixa numa vista

/** mm por px a partir de dois toques na foto e a medida real entre eles. */
export function escalaPorMedida(a: P2, b: P2, mm: number): number {
  const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (!(d > 0.5) || !(mm > 0)) throw new Error("Toque em dois pontos diferentes da foto e digite a medida (mm).");
  return mm / d;
}

/** Eixos da tela (direita, cima) no mundo de cada vista, como a vista 3D mostra. */
export const EIXOS_VISTA: Record<VistaRef, { direita: V3; cima: V3; olho: V3 }> = {
  frente: { direita: [1, 0, 0], cima: [0, 1, 0], olho: [0, 0, 1] },
  cima: { direita: [1, 0, 0], cima: [0, 0, -1], olho: [0, 1, 0] },
  lado: { direita: [0, 0, -1], cima: [0, 1, 0], olho: [1, 0, 0] },
};

/** Pixel da foto → coordenadas (mm) no plano da vista, relativas ao ponto de referência. */
export function fotoNoPlano(r: RefFoto, u: number, v: number): P2 {
  const g = (r.giro * Math.PI) / 180, c = Math.cos(g), s = Math.sin(g);
  const x = (u - r.cx) * r.escala, y = -(v - r.cy) * r.escala;
  return [x * c - y * s + r.dx, x * s + y * c + r.dy];
}

/** Cantos da foto (sup. esq., sup. dir., inf. dir., inf. esq.) no mundo, no plano da vista que passa por `ref`. */
export function cantosNoMundo(r: RefFoto, ref: V3, profundidade = 0): V3[] {
  const e = EIXOS_VISTA[r.vista];
  return ([[0, 0], [r.largura, 0], [r.largura, r.altura], [0, r.altura]] as P2[]).map(([u, v]) => {
    const [a, b] = fotoNoPlano(r, u, v);
    return [0, 1, 2].map((k) => ref[k] + a * e.direita[k] + b * e.cima[k] - profundidade * e.olho[k]) as V3;
  });
}

/**
 * Foto no esboço do ornamento (decalque): o esboço é a vista de cima do aro (x ao longo do aro, y na largura
 * = Z). Devolve o pixel → (x, y) do esboço; a foto é tratada como vista de cima com a mesma escala.
 */
export function fotoNoEsboco(r: RefFoto, u: number, v: number): P2 {
  const [a, b] = fotoNoPlano(r, u, v);
  return [a, -b];
}

// ---------------------------------------------------------------------------------------------
// câmera alinhada à foto

type M3 = number[];
const mm3 = (A: M3, B: M3): M3 => {
  const C = new Array(9).fill(0);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) C[3 * i + j] += A[3 * i + k] * B[3 * k + j];
  return C;
};
const ap = (M: M3, v: V3): V3 => [M[0] * v[0] + M[1] * v[1] + M[2] * v[2], M[3] * v[0] + M[4] * v[1] + M[5] * v[2], M[6] * v[0] + M[7] * v[1] + M[8] * v[2]];

/** Rotação de Rodrigues (vetor de rotação → matriz). */
export function rodrigues(w: V3): M3 {
  const t = Math.hypot(...w);
  if (t < 1e-12) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const [x, y, z] = [w[0] / t, w[1] / t, w[2] / t], c = Math.cos(t), s = Math.sin(t), C = 1 - c;
  return [c + x * x * C, x * y * C - z * s, x * z * C + y * s, y * x * C + z * s, c + y * y * C, y * z * C - x * s, z * x * C - y * s, z * y * C + x * s, c + z * z * C];
}

/** Ângulo (°) entre duas rotações. */
export function anguloEntre(A: M3, B: M3): number {
  const At = [A[0], A[3], A[6], A[1], A[4], A[7], A[2], A[5], A[8]];
  const M = mm3(At, B), tr = M[0] + M[4] + M[8];
  return (Math.acos(Math.min(1, Math.max(-1, (tr - 1) / 2))) * 180) / Math.PI;
}

/** Câmera olhando de `olho` para `alvo` com `cima` aproximado. */
export function olharPara(olho: V3, alvo: V3, cima: V3 = [0, 1, 0]): M3 {
  const tras = norm(sub3(olho, alvo));
  let dir = cruz3(cima, tras);
  if (Math.hypot(...dir) < 1e-6) dir = cruz3([0, 0, 1], tras);
  dir = norm(dir);
  const up = cruz3(tras, dir);
  return [...dir, ...up, ...tras];
}
const sub3 = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cruz3 = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => { const k = Math.hypot(...a) || 1; return [a[0] / k, a[1] / k, a[2] / k]; };

/** Projeta um ponto do mundo na foto (px; v para baixo). Atrás da câmera: null. */
export function projetar(c: Camera, W: number, H: number, X: V3): P2 | null {
  const q = ap(c.rot, sub3(X, c.pos));
  if (-q[2] <= 1e-9) return null;
  return [W / 2 + (c.f * q[0]) / -q[2], H / 2 - (c.f * q[1]) / -q[2]];
}

/** Erro médio quadrático (px) da câmera nos pares. */
export function erroPx(c: Camera, W: number, H: number, pares: ParRef[]): number {
  let s = 0;
  for (const p of pares) {
    const q = projetar(c, W, H, p.modelo);
    s += q ? (q[0] - p.foto[0]) ** 2 + (q[1] - p.foto[1]) ** 2 : 1e8;
  }
  return Math.sqrt(s / Math.max(1, pares.length));
}

/** Resolve o sistema linear (eliminação de Gauss com pivô). */
function resolver(A: number[][], b: number[]): number[] | null {
  const n = b.length, M = A.map((l, i) => [...l, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-14) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const k = M[r][c] / M[c][c];
      for (let j = c; j <= n; j++) M[r][j] -= k * M[c][j];
    }
  }
  return M.map((l, i) => l[n] / l[i]);
}

/**
 * Levenberg–Marquardt a partir de uma câmera: parâmetros = posição (3), giro pequeno no referencial da
 * câmera (3) e log do foco; `livres` escolhe quais mudam (2 pares: posição e giro em torno do eixo de visão;
 * 3 pares: posição e giro; 4 ou mais: tudo).
 */
function ajustar(c0: Camera, W: number, H: number, pares: ParRef[], livres: number[], iter = 200): { c: Camera; erro: number } {
  let c = { pos: [...c0.pos] as V3, rot: c0.rot.slice(), f: c0.f };
  const camDe = (base: Camera, p: number[]): Camera => ({
    pos: [base.pos[0] + p[0], base.pos[1] + p[1], base.pos[2] + p[2]],
    rot: mm3(rodrigues([p[3], p[4], p[5]]), base.rot),
    f: base.f * Math.exp(p[6]),
  });
  const res = (cam: Camera) => {
    const r: number[] = [];
    for (const p of pares) {
      const q = projetar(cam, W, H, p.modelo);
      if (!q) { r.push(1e4, 1e4); continue; }
      r.push(q[0] - p.foto[0], q[1] - p.foto[1]);
    }
    return r;
  };
  const custo = (r: number[]) => r.reduce((s, x) => s + x * x, 0);
  let r = res(c), e = custo(r), lambda = 1e-3;
  const escalaPos = Math.max(1, Math.hypot(...c.pos)) * 1e-6;
  for (let it = 0; it < iter; it++) {
    // jacobiano numérico só nas colunas livres
    const J: number[][] = r.map(() => []);
    for (const k of livres) {
      const h = k < 3 ? escalaPos : 1e-6;
      const p = [0, 0, 0, 0, 0, 0, 0];
      p[k] = h;
      const rk = res(camDe(c, p));
      for (let i = 0; i < r.length; i++) J[i].push((rk[i] - r[i]) / h);
    }
    const n = livres.length;
    const A = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => J.reduce((s, l) => s + l[i] * l[j], 0)));
    const g = Array.from({ length: n }, (_, i) => -J.reduce((s, l, k) => s + l[i] * r[k], 0));
    let melhorou = false;
    for (let tent = 0; tent < 12; tent++) {
      const Ad = A.map((l, i) => l.map((v, j) => (i === j ? v * (1 + lambda) + 1e-12 : v)));
      const d = resolver(Ad, g);
      if (!d) { lambda *= 10; continue; }
      const p = [0, 0, 0, 0, 0, 0, 0];
      livres.forEach((k, i) => (p[k] = d[i]));
      const cn = camDe(c, p), rn = res(cn), en = custo(rn);
      if (en < e) {
        c = cn; r = rn;
        const queda = e - en;
        e = en;
        lambda = Math.max(1e-12, lambda / 5);
        melhorou = true;
        if (queda < 1e-14 * (1 + e)) it = iter;
        break;
      }
      lambda *= 8;
    }
    if (!melhorou || e < 1e-16) break;
  }
  return { c, erro: Math.sqrt(e / Math.max(1, pares.length)) };
}

/** Direções de partida (26: faces, arestas e cantos do cubo). */
const DIRECOES: V3[] = (() => {
  const out: V3[] = [];
  for (const x of [-1, 0, 1]) for (const y of [-1, 0, 1]) for (const z of [-1, 0, 1]) if (x || y || z) out.push(norm([x, y, z]));
  return out;
})();

/**
 * Câmera que casa a perspectiva da foto com 2–4 (ou mais) pares. `atual` = câmera de partida (a da vista):
 * com 2 pares só a posição e o giro em torno do eixo de visão mudam; com 3, posição e giro; com 4 ou mais,
 * também o campo de visão, partindo de várias direções (fica a de menor erro, na frente da câmera).
 */
export function alinharCamera(pares: ParRef[], W: number, H: number, atual?: Camera): { camera: Camera; erro: number } {
  if (pares.length < 2) throw new Error("Marque pelo menos 2 pares de pontos (foto ↔ modelo).");
  const ctr: V3 = [0, 1, 2].map((k) => pares.reduce((s, p) => s + p.modelo[k], 0) / pares.length) as V3;
  let sm = 0, sp = 0;
  for (const a of pares) for (const b of pares) {
    sm = Math.max(sm, Math.hypot(a.modelo[0] - b.modelo[0], a.modelo[1] - b.modelo[1], a.modelo[2] - b.modelo[2]));
    sp = Math.max(sp, Math.hypot(a.foto[0] - b.foto[0], a.foto[1] - b.foto[1]));
  }
  if (!(sm > 1e-6) || !(sp > 0.5)) throw new Error("Os pontos marcados estão juntos demais.");
  const f0 = atual?.f ?? Math.max(W, H);
  const dist = (f0 * sm) / sp;
  const n = pares.length;
  const livres = n === 2 ? [0, 1, 2, 5] : n === 3 ? [0, 1, 2, 3, 4, 5] : [0, 1, 2, 3, 4, 5, 6];
  const partidas: Camera[] = [];
  if (atual) {
    // mesma direção de visão da vista atual, à distância que dá o tamanho da foto
    const tras: V3 = [atual.rot[6], atual.rot[7], atual.rot[8]];
    partidas.push({ pos: [ctr[0] + tras[0] * dist, ctr[1] + tras[1] * dist, ctr[2] + tras[2] * dist], rot: atual.rot.slice(), f: f0 });
  }
  if (n >= 3 || !atual)
    for (const dirc of DIRECOES)
      for (const giro of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
        const pos: V3 = [ctr[0] + dirc[0] * dist, ctr[1] + dirc[1] * dist, ctr[2] + dirc[2] * dist];
        const cima: V3 = Math.abs(dirc[1]) > 0.9 ? [0, 0, -1] : [0, 1, 0];
        partidas.push({ pos, rot: mm3(rodrigues([0, 0, giro]), olharPara(pos, ctr, cima)), f: f0 });
      }
  let melhor: { c: Camera; erro: number } | null = null;
  for (const c0 of partidas) {
    // primeiro posição e giro com o foco fixo; depois tudo
    let r = ajustar(c0, W, H, pares, livres.filter((k) => k !== 6), 60);
    if (livres.includes(6)) r = ajustar(r.c, W, H, pares, livres, 200);
    if (pares.some((p) => !projetar(r.c, W, H, p.modelo))) continue;
    if (!melhor || r.erro < melhor.erro - 1e-9) melhor = r;
    if (melhor.erro < 1e-6) break;
  }
  if (!melhor) throw new Error("Não foi possível alinhar a câmera com esses pontos.");
  return { camera: melhor.c, erro: melhor.erro };
}

/** Campo de visão vertical (°) da câmera para a foto de altura H px. */
export const campoVisao = (c: Camera, H: number) => (2 * Math.atan(H / 2 / c.f) * 180) / Math.PI;
