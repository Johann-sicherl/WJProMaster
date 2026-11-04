// Curva de interseção e Entidades de silhueta do esboço, calculadas sobre a malha exibida da peça
// (sólidos e corpos de malha STL da mesma forma): o plano do esboço corta os triângulos, ou as
// arestas onde a malha "vira de lado" vistas na normal do plano formam o contorno. As polilinhas
// são simplificadas (Douglas-Peucker) e laços quase circulares viram círculos.
// Funções puras, testadas em scripts/teste-esboco.ts.

import type { Vec3 } from "../model";
import type { Referencial } from "./referencial";

export interface P2 {
  x: number;
  y: number;
}

/** Polilinha no plano do esboço; `fechada` quando volta ao início. */
export interface Polilinha {
  pts: P2[];
  fechada: boolean;
}

export type EntidadePlano =
  | { tipo: "linha"; a: P2; b: P2 }
  | { tipo: "circulo"; c: P2; r: number };

const esc = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function noPlano(r: Referencial, x: number, y: number, z: number): P2 {
  const dx = x - r.origem[0], dy = y - r.origem[1], dz = z - r.origem[2];
  return { x: dx * r.x[0] + dy * r.x[1] + dz * r.x[2], y: dx * r.y[0] + dy * r.y[1] + dz * r.y[2] };
}

/** Encadeia segmentos soltos pelas pontas (pontas quantizadas em `tol`). */
export function encadear(segs: [P2, P2][], tol: number): Polilinha[] {
  const q = (p: P2) => `${Math.round(p.x / tol)},${Math.round(p.y / tol)}`;
  const porPonta = new Map<string, number[]>();
  const vistos = new Set<string>();
  const unicos: [P2, P2][] = [];
  for (const s of segs) {
    const ka = q(s[0]), kb = q(s[1]);
    if (ka === kb) continue; // segmento que some na projeção
    const k = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
    if (vistos.has(k)) continue; // repetido (ex.: arestas de cima e de baixo projetam igual)
    vistos.add(k);
    const i = unicos.push(s) - 1;
    for (const kk of [ka, kb]) {
      const l = porPonta.get(kk);
      if (l) l.push(i);
      else porPonta.set(kk, [i]);
    }
  }
  const usado = new Uint8Array(unicos.length);
  const out: Polilinha[] = [];
  const proximo = (ponta: P2): P2 | null => {
    for (const j of porPonta.get(q(ponta)) ?? []) {
      if (usado[j]) continue;
      usado[j] = 1;
      const [a, b] = unicos[j];
      return q(a) === q(ponta) ? b : a;
    }
    return null;
  };
  for (let i = 0; i < unicos.length; i++) {
    if (usado[i]) continue;
    usado[i] = 1;
    const pts = [unicos[i][0], unicos[i][1]];
    for (let p = proximo(pts[pts.length - 1]); p; p = proximo(pts[pts.length - 1])) pts.push(p);
    for (let p = proximo(pts[0]); p; p = proximo(pts[0])) pts.unshift(p);
    const fechada = pts.length > 3 && q(pts[0]) === q(pts[pts.length - 1]);
    if (fechada) pts.pop();
    out.push({ pts, fechada });
  }
  return out;
}

/** Curva de interseção: onde o plano do esboço corta os triângulos da malha. */
export function cortarMalha(pos: ArrayLike<number>, idx: ArrayLike<number> | null, r: Referencial, tol: number): Polilinha[] {
  const n = r.normal, d0 = esc(r.origem, n);
  const nt = idx ? idx.length / 3 : pos.length / 9;
  const segs: [P2, P2][] = [];
  const v = (t: number, k: number) => (idx ? idx[t * 3 + k] : t * 3 + k);
  for (let t = 0; t < nt; t++) {
    const P: Vec3[] = [0, 1, 2].map((k) => { const i = v(t, k) * 3; return [pos[i], pos[i + 1], pos[i + 2]] as Vec3; });
    const d = P.map((p) => esc(p, n) - d0);
    const lado = d.map((x) => (Math.abs(x) < tol * 1e-3 ? 0 : x > 0 ? 1 : -1));
    if (lado.every((s) => s === 0)) continue; // triângulo no próprio plano: não é corte
    const pts: P2[] = [];
    for (let k = 0; k < 3; k++) {
      const a = k, b = (k + 1) % 3;
      if (lado[a] === 0) pts.push(noPlano(r, ...P[a]));
      if (lado[a] * lado[b] < 0) {
        const s = d[a] / (d[a] - d[b]);
        pts.push(noPlano(r, P[a][0] + (P[b][0] - P[a][0]) * s, P[a][1] + (P[b][1] - P[a][1]) * s, P[a][2] + (P[b][2] - P[a][2]) * s));
      }
    }
    if (pts.length === 2) segs.push([pts[0], pts[1]]);
  }
  return encadear(segs, tol);
}

/**
 * Entidades de silhueta: contorno da peça vista na normal do plano. Os triângulos projetados são
 * pintados numa grade (até `res` células no lado maior) e a borda da região pintada vira polilinha
 * — o contorno externo e os vazados que atravessam a peça, sem as arestas internas (robusto a
 * malhas com falhas). Precisão: uma célula (o resultado passa depois por `entidadesDe`).
 */
export function silhuetaMalha(pos: ArrayLike<number>, idx: ArrayLike<number> | null, r: Referencial, _tol: number, res = 2048): Polilinha[] {
  const nv = pos.length / 3;
  const u = new Float64Array(nv), v = new Float64Array(nv);
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (let i = 0; i < nv; i++) {
    const p = noPlano(r, pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
    u[i] = p.x;
    v[i] = p.y;
    if (p.x < u0) u0 = p.x;
    if (p.x > u1) u1 = p.x;
    if (p.y < v0) v0 = p.y;
    if (p.y > v1) v1 = p.y;
  }
  if (!(u1 > u0) && !(v1 > v0)) return [];
  const cel = Math.max(u1 - u0, v1 - v0) / res;
  // grade com uma célula de folga em volta
  const W = Math.ceil((u1 - u0) / cel) + 3, H = Math.ceil((v1 - v0) / cel) + 3;
  const ox = u0 - cel, oy = v0 - cel;
  const g = new Uint8Array(W * H);
  const nt = idx ? idx.length / 3 : nv / 3;
  for (let t = 0; t < nt; t++) {
    const a = idx ? idx[t * 3] : t * 3, b = idx ? idx[t * 3 + 1] : t * 3 + 1, c = idx ? idx[t * 3 + 2] : t * 3 + 2;
    const ax = (u[a] - ox) / cel, ay = (v[a] - oy) / cel, bx = (u[b] - ox) / cel, by = (v[b] - oy) / cel, cx = (u[c] - ox) / cel, cy = (v[c] - oy) / cel;
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    // triângulo menor que uma célula (ou visto de perfil): marca a célula do centro
    const mx = Math.floor((ax + bx + cx) / 3), my = Math.floor((ay + by + cy) / 3);
    if (Math.abs(area) < 1e-12) {
      // de perfil: marca as células ao longo das arestas (paredes finas vistas de lado)
      for (const [x0, y0, x1, y1] of [[ax, ay, bx, by], [bx, by, cx, cy]]) {
        const n = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))) + 1;
        for (let k = 0; k <= n; k++) g[Math.floor(y0 + ((y1 - y0) * k) / n) * W + Math.floor(x0 + ((x1 - x0) * k) / n)] = 1;
      }
      continue;
    }
    g[my * W + mx] = 1;
    const s = area > 0 ? 1 : -1;
    const xa = Math.max(0, Math.floor(Math.min(ax, bx, cx))), xb = Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx)));
    const ya = Math.max(0, Math.floor(Math.min(ay, by, cy))), yb = Math.min(H - 1, Math.ceil(Math.max(ay, by, cy)));
    for (let y = ya; y <= yb; y++) {
      const py = y + 0.5;
      for (let x = xa; x <= xb; x++) {
        const px = x + 0.5;
        const e0 = ((bx - ax) * (py - ay) - (by - ay) * (px - ax)) * s;
        const e1 = ((cx - bx) * (py - by) - (cy - by) * (px - bx)) * s;
        const e2 = ((ax - cx) * (py - cy) - (ay - cy) * (px - cx)) * s;
        if (e0 >= 0 && e1 >= 0 && e2 >= 0) g[y * W + x] = 1;
      }
    }
  }
  // fecha furinhos de uma célula (triângulos que faltam no arquivo, frestas de triangulação)
  const f = g.slice();
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x;
    if (!g[i] && g[i - 1] + g[i + 1] + g[i - W] + g[i + W] >= 3) f[i] = 1;
  }
  // borda: lado de célula entre pintada e vazia (em coordenadas da grade, pontas inteiras)
  const segs: [P2, P2][] = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const a = f[y * W + x];
    if (x + 1 < W && a !== f[y * W + x + 1]) segs.push([{ x: x + 1, y }, { x: x + 1, y: y + 1 }]);
    if (y + 1 < H && a !== f[(y + 1) * W + x]) segs.push([{ x, y: y + 1 }, { x: x + 1, y: y + 1 }]);
  }
  const polis = encadear(segs, 0.5);
  // de volta ao plano; laços minúsculos (sujeira de poucas células) saem
  const out: Polilinha[] = [];
  for (const p of polis) {
    let ar = 0;
    for (let k = 0; k < p.pts.length; k++) {
      const q = p.pts[k], w = p.pts[(k + 1) % p.pts.length];
      ar += q.x * w.y - w.x * q.y;
    }
    if (Math.abs(ar) / 2 < 12) continue;
    out.push({ fechada: p.fechada, pts: p.pts.map((q) => ({ x: ox + q.x * cel, y: oy + q.y * cel })) });
  }
  return out;
}

/** Tamanho de uma célula da silhueta (tolerância natural para simplificar o contorno). */
export function celulaSilhueta(pos: ArrayLike<number>, r: Referencial, res = 2048): number {
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (let i = 0; i < pos.length; i += 3) {
    const p = noPlano(r, pos[i], pos[i + 1], pos[i + 2]);
    u0 = Math.min(u0, p.x); u1 = Math.max(u1, p.x); v0 = Math.min(v0, p.y); v1 = Math.max(v1, p.y);
  }
  return Math.max(u1 - u0, v1 - v0) / res;
}

/** Douglas-Peucker numa polilinha aberta. */
function dp(pts: P2[], tol: number): P2[] {
  if (pts.length < 3) return pts;
  const manter = new Uint8Array(pts.length);
  manter[0] = manter[pts.length - 1] = 1;
  const pilha: [number, number][] = [[0, pts.length - 1]];
  while (pilha.length) {
    const [i, j] = pilha.pop()!;
    const a = pts[i], b = pts[j];
    const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy);
    let m = -1, dm = tol;
    for (let k = i + 1; k < j; k++) {
      const d = L > 0 ? Math.abs((pts[k].x - a.x) * dy - (pts[k].y - a.y) * dx) / L : Math.hypot(pts[k].x - a.x, pts[k].y - a.y);
      if (d > dm) { dm = d; m = k; }
    }
    if (m > 0) {
      manter[m] = 1;
      pilha.push([i, m], [m, j]);
    }
  }
  return pts.filter((_, k) => manter[k]);
}

/** Círculo que passa pelos pontos (todos a até `tol` dele), ou null. */
function circuloDe(pts: P2[], tol: number): { c: P2; r: number } | null {
  if (pts.length < 8) return null;
  const c = { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length };
  const rs = pts.map((p) => Math.hypot(p.x - c.x, p.y - c.y));
  const r = rs.reduce((s, x) => s + x, 0) / rs.length;
  return r > tol && rs.every((x) => Math.abs(x - r) <= Math.max(tol, r * 0.01)) ? { c, r } : null;
}

/** Polilinhas → entidades do esboço (linhas; laços circulares viram círculos). */
export function entidadesDe(polis: Polilinha[], tol: number): EntidadePlano[] {
  const out: EntidadePlano[] = [];
  for (const p of polis) {
    if (p.fechada) {
      const c = circuloDe(p.pts, tol);
      if (c) {
        out.push({ tipo: "circulo", c: c.c, r: c.r });
        continue;
      }
    }
    // laço fechado: simplifica partindo do ponto mais distante do primeiro (as duas metades)
    let pts = p.pts;
    if (p.fechada) {
      let k = 0, dm = -1;
      pts.forEach((q, i) => { const d = Math.hypot(q.x - pts[0].x, q.y - pts[0].y); if (d > dm) { dm = d; k = i; } });
      const s = [...dp(pts.slice(0, k + 1), tol), ...dp([...pts.slice(k), pts[0]], tol).slice(1)];
      pts = s;
    } else pts = dp(pts, tol);
    for (let i = 0; i + 1 < pts.length; i++) out.push({ tipo: "linha", a: pts[i], b: pts[i + 1] });
  }
  return out;
}
