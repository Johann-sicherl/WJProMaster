// WJGoldDiamond: fios avançados do ornamento (J9b) em malha. Perfil por fio (redondo, meia-cana,
// oval achatado, faca), largura/altura/inclinação variáveis por pontos de controle, torção (voltas ao
// longo do comprimento), fio trançado (dois fios torcidos um no outro) e subida livre em 3D até um apoio
// (garra, gema livre ou folha). A malha é unida ao resto da joia no manifold-3d (final.ts).
// Puro (sem kernel nem DOM): interface, worker e testes em Node.

import type { Malha } from "./escultura";
import type { Montagem, V3 } from "./regras";

export type PerfilFio = "redondo" | "meia-cana" | "oval" | "faca";
export const PERFIS_FIO: [PerfilFio, string][] = [["redondo", "Redondo"], ["meia-cana", "Meia-cana"], ["oval", "Oval achatado"], ["faca", "Faca"]];

/** Ponto de controle ao longo do fio: u (0–1), Ø/largura, altura da seção, altura sobre o aro e inclinação (°). */
export interface ControleFio { u: number; d: number; h?: number; a: number; i?: number }

/** Parte do fio que vira malha (fio avançado); `pts` do fio = centro da seção. */
export interface FioMalha {
  perfil: PerfilFio;
  larguras: number[];
  alturas: number[];
  /** inclinação da seção em torno do fio (rad) */
  incl: number[];
  /** direção "para cima" da seção (normal do aro) em cada ponto */
  up: V3[];
  /** voltas ao longo do comprimento */
  torcao: number;
  trancado: boolean;
  subirIni: boolean;
  subirFim: boolean;
  fechado: boolean;
  /** raio de concordância próprio (mm; ausente = o global) */
  concordancia?: number;
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const soma = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const comp = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: V3): V3 => mul(a, 1 / (comp(a) || 1));
const cruz = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Área exata da seção (mm²): redondo/oval = π·l·h/4, meia-cana (meia elipse) = π·l·h/4, faca (triângulo) = l·h/2. */
export function areaSecao(p: PerfilFio, l: number, h: number): number {
  return p === "faca" ? (l * h) / 2 : (Math.PI * l * h) / 4;
}

const areaPoli = (pts: [number, number][]) => {
  let s = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) s += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  return s / 2;
};

/**
 * Seção unitária (largura 1 × altura 1, centrada; x lateral, y para cima), anti-horária, com `k` pontos e a
 * mesma área da forma exata (o polígono é escalado: o volume do fio confere com seção × comprimento).
 */
export function secaoUnitaria(p: PerfilFio, k = 20): [number, number][] {
  let pts: [number, number][];
  if (p === "redondo" || p === "oval") pts = Array.from({ length: k }, (_, i) => [0.5 * Math.cos((2 * Math.PI * i) / k), 0.5 * Math.sin((2 * Math.PI * i) / k)]);
  else if (p === "meia-cana") {
    const nb = Math.max(2, Math.round(k / 4)), na = k - nb;
    pts = [];
    for (let i = 0; i < na; i++) { const t = (Math.PI * i) / (na - 1); pts.push([0.5 * Math.cos(t), -0.5 + Math.sin(t)]); }
    for (let i = 0; i < nb; i++) pts.push([-0.5 + (i + 0.5) / nb, -0.5]);
    // começa no canto direito da base: a ordem acima já é anti-horária (arco de 0 a π, base da esquerda para a direita)
  } else {
    // faca: base de largura 1 embaixo, aresta viva em cima (triângulo), pontos distribuídos no perímetro
    const v: [number, number][] = [[0.5, -0.5], [0, 0.5], [-0.5, -0.5]];
    const lados = v.map((a, i) => { const b = v[(i + 1) % 3]; return Math.hypot(b[0] - a[0], b[1] - a[1]); });
    const per = lados.reduce((x, y) => x + y, 0);
    pts = [];
    for (let i = 0; i < 3; i++) {
      const a = v[i], b = v[(i + 1) % 3], n = Math.max(1, Math.round((k * lados[i]) / per));
      for (let j = 0; j < n; j++) pts.push([a[0] + ((b[0] - a[0]) * j) / n, a[1] + ((b[1] - a[1]) * j) / n]);
    }
  }
  const alvo = areaSecao(p, 1, 1), s = Math.sqrt(alvo / Math.abs(areaPoli(pts)));
  return pts.map(([x, y]) => [x * s, y * s]);
}

/** Valores interpolados (Hermite monótono) nos pontos de controle, para cada u em `us`. */
export function interpolar(ctrl: { u: number; v: number }[], us: number[]): number[] {
  const c = [...ctrl].sort((a, b) => a.u - b.u);
  if (!c.length) return us.map(() => 0);
  if (c.length === 1) return us.map(() => c[0].v);
  const n = c.length, dl: number[] = [], m: number[] = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) dl.push((c[i + 1].v - c[i].v) / Math.max(1e-9, c[i + 1].u - c[i].u));
  m[0] = dl[0];
  m[n - 1] = dl[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = dl[i - 1] * dl[i] <= 0 ? 0 : (dl[i - 1] + dl[i]) / 2;
  // Fritsch–Carlson: sem passar do valor dos vizinhos
  for (let i = 0; i < n - 1; i++) {
    if (dl[i] === 0) { m[i] = m[i + 1] = 0; continue; }
    const a = m[i] / dl[i], b = m[i + 1] / dl[i], q = a * a + b * b;
    if (q > 9) { const t = 3 / Math.sqrt(q); m[i] = t * a * dl[i]; m[i + 1] = t * b * dl[i]; }
  }
  return us.map((u) => {
    if (u <= c[0].u) return c[0].v;
    if (u >= c[n - 1].u) return c[n - 1].v;
    let k = 0;
    while (k < n - 2 && u > c[k + 1].u) k++;
    const h = c[k + 1].u - c[k].u, t = (u - c[k].u) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * c[k].v + (t3 - 2 * t2 + t) * h * m[k] + (-2 * t3 + 3 * t2) * c[k + 1].v + (t3 - t2) * h * m[k + 1];
  });
}

/** Comprimento acumulado da polilinha. */
export function acumulado(pts: V3[]): number[] {
  const a = [0];
  for (let i = 1; i < pts.length; i++) a.push(a[i - 1] + comp(sub(pts[i], pts[i - 1])));
  return a;
}

/** Referenciais (tangente, lateral, para cima) ao longo do caminho; "para cima" = normal do aro projetada. */
function referenciais(pts: V3[], up: V3[], fechado: boolean): { T: V3; L: V3; U: V3 }[] {
  const n = pts.length, out: { T: V3; L: V3; U: V3 }[] = [];
  let U0: V3 | null = null;
  for (let i = 0; i < n; i++) {
    const a = fechado ? pts[(i - 1 + n - 1) % (n - 1)] : pts[Math.max(0, i - 1)];
    const b = fechado ? pts[(i + 1) % (n - 1)] : pts[Math.min(n - 1, i + 1)];
    const T = unit(sub(b, a));
    let U = sub(up[i], mul(T, dot(up[i], T)));
    // fio quase vertical (sobe na direção da normal): transporta o "para cima" anterior
    if (comp(U) < 0.25 && U0) U = sub(U0, mul(T, dot(U0, T)));
    if (comp(U) < 1e-6) U = Math.abs(T[0]) < 0.9 ? cruz(T, [1, 0, 0]) : cruz(T, [0, 1, 0]);
    U = unit(U);
    U0 = U;
    out.push({ T, U, L: cruz(U, T) });
  }
  return out;
}

/** Tubo pela polilinha: seção (unitária) escalada por largura/altura e girada pelo ângulo em cada ponto. */
export function tubo(pts: V3[], up: V3[], larguras: number[], alturas: number[], angs: number[], perfil: PerfilFio, fechado: boolean, k = 20): Malha {
  const sec = secaoUnitaria(perfil, k);
  const n = pts.length, nAneis = fechado ? n - 1 : n, R = referenciais(pts, up, fechado);
  const pos: number[] = [];
  for (let i = 0; i < nAneis; i++) {
    const { L, U } = R[i], c = Math.cos(angs[i]), s = Math.sin(angs[i]);
    for (const [x0, y0] of sec) {
      const x = x0 * larguras[i], y = y0 * alturas[i];
      const xr = x * c - y * s, yr = x * s + y * c;
      const p = soma(pts[i], soma(mul(L, xr), mul(U, yr)));
      pos.push(p[0], p[1], p[2]);
    }
  }
  const K = sec.length, tri: number[] = [];
  const anel = (i: number, j: number) => ((i % nAneis) * K + (j % K));
  for (let i = 0; i < (fechado ? nAneis : nAneis - 1); i++) {
    // fechado com torção que não fecha a volta: o último anel liga ao primeiro com o deslocamento mais curto
    let off = 0;
    if (fechado && i === nAneis - 1) {
      let melhor = Infinity;
      for (let o = 0; o < K; o++) {
        let dsum = 0;
        for (let j = 0; j < K; j += Math.max(1, K >> 2)) {
          const a = 3 * anel(i, j), b = 3 * anel(0, j + o);
          dsum += Math.hypot(pos[a] - pos[b], pos[a + 1] - pos[b + 1], pos[a + 2] - pos[b + 2]);
        }
        if (dsum < melhor) { melhor = dsum; off = o; }
      }
    }
    for (let j = 0; j < K; j++) {
      const a = anel(i, j), b = anel(i, j + 1), c = i + 1 === nAneis ? anel(0, j + off) : anel(i + 1, j), d = i + 1 === nAneis ? anel(0, j + 1 + off) : anel(i + 1, j + 1);
      tri.push(a, b, d, a, d, c);
    }
  }
  if (!fechado) {
    // tampas planas (centro de cada ponta)
    for (const [i, inv] of [[0, true], [nAneis - 1, false]] as [number, boolean][]) {
      const c = pos.length / 3;
      let cx = 0, cy = 0, cz = 0;
      for (let j = 0; j < K; j++) { cx += pos[3 * anel(i, j)]; cy += pos[3 * anel(i, j) + 1]; cz += pos[3 * anel(i, j) + 2]; }
      pos.push(cx / K, cy / K, cz / K);
      for (let j = 0; j < K; j++) inv ? tri.push(c, anel(i, j + 1), anel(i, j)) : tri.push(c, anel(i, j), anel(i, j + 1));
    }
  }
  return orientar({ pos: new Float32Array(pos), tri: new Uint32Array(tri) });
}

/** Volume com sinal da malha fechada (mm³). */
export function volumeComSinal(m: Malha): number {
  let v = 0;
  const p = m.pos;
  for (let i = 0; i < m.tri.length; i += 3) {
    const a = 3 * m.tri[i], b = 3 * m.tri[i + 1], c = 3 * m.tri[i + 2];
    v += p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
  }
  return v / 6;
}

/** Normais para fora (volume positivo): inverte os triângulos se precisar. */
export function orientar(m: Malha): Malha {
  if (volumeComSinal(m) >= 0) return m;
  const t = m.tri;
  for (let i = 0; i < t.length; i += 3) { const x = t[i + 1]; t[i + 1] = t[i + 2]; t[i + 2] = x; }
  return m;
}

/** Esfera (icosfera nível 2, 162 vértices) com centro e raio. */
export function esferaMalha(c: V3, r: number, base: Malha): Malha {
  const pos = new Float32Array(base.pos.length);
  for (let i = 0; i < pos.length; i += 3) { pos[i] = c[0] + base.pos[i] * r; pos[i + 1] = c[1] + base.pos[i + 1] * r; pos[i + 2] = c[2] + base.pos[i + 2] * r; }
  return { pos, tri: base.tri };
}

/**
 * Malhas do fio avançado (um tubo, ou dois no trançado) e esferas das pontas (perfil redondo).
 * `esfera` = icosfera unitária (passada de fora para não depender da escultura aqui).
 */
export function malhasFio(f: { pts: V3[]; raios: number[]; bolinhaIni: boolean; bolinhaFim: boolean; malha?: FioMalha }, esfera: Malha): Malha[] {
  const fm = f.malha!;
  const n = f.pts.length, s = acumulado(f.pts), L = s[n - 1] || 1;
  const voltas = fm.fechado ? Math.round(fm.torcao) : fm.torcao;
  const ang = s.map((x, i) => fm.incl[i] + (2 * Math.PI * voltas * x) / L);
  const out: Malha[] = [];
  if (fm.trancado) {
    // dois fios redondos de Ø = largura, centros afastados 0,84·Ø (se sobrepõem: peça única), girando em volta do caminho
    const R = referenciais(f.pts, fm.up, fm.fechado);
    for (const fase of [0, Math.PI]) {
      const pts = f.pts.map((p, i) => {
        const c = 0.42 * fm.larguras[i], a = ang[i] + fase;
        return soma(p, soma(mul(R[i].L, c * Math.cos(a)), mul(R[i].U, c * Math.sin(a))));
      });
      if (fm.fechado) pts[n - 1] = pts[0];
      out.push(tubo(pts, fm.up, fm.larguras, fm.larguras, ang.map(() => 0), "redondo", fm.fechado, 14));
      if (!fm.fechado) for (const i of [0, n - 1]) out.push(esferaMalha(pts[i], fm.larguras[i] / 2, esfera));
    }
    return out;
  }
  const redondo = fm.perfil === "redondo";
  // redondo: girar a seção não muda nada (a torção só vale para os outros perfis e para o trançado)
  out.push(tubo(f.pts, fm.up, fm.larguras, redondo ? fm.larguras : fm.alturas, redondo ? ang.map(() => 0) : ang, fm.perfil, fm.fechado, redondo ? 16 : 20));
  if (!fm.fechado && redondo) {
    if (!fm.subirIni) out.push(esferaMalha(f.pts[0], (fm.larguras[0] / 2) * (f.bolinhaIni ? 1.3 : 1), esfera));
    if (!fm.subirFim) out.push(esferaMalha(f.pts[n - 1], (fm.larguras[n - 1] / 2) * (f.bolinhaFim ? 1.3 : 1), esfera));
  }
  return out;
}

/** Amostras por volta de torção: devolve quantos pontos o fio precisa (no mínimo `n`). */
export const pontosParaTorcao = (n: number, voltas: number, trancado: boolean) => Math.max(n, Math.ceil(Math.abs(voltas) * (trancado ? 40 : 48)) + 1);

/**
 * Subida livre em 3D: a ponta do fio vai até o apoio (alvo) com encaixe; o trecho final (até 40 % do fio ou
 * 3 mm) sai da superfície e sobe numa curva suave. Altera `pts` e `up` no lugar.
 */
export function subirAte(pts: V3[], up: V3[], fim: boolean, alvo: V3) {
  const n = pts.length;
  const ord = fim ? pts : [...pts].reverse();
  const s = acumulado(ord), L = s[n - 1];
  const trecho = Math.min(0.4 * L, 3), s0 = L - trecho;
  const d = sub(alvo, ord[n - 1]);
  for (let i = 0; i < n; i++) {
    if (s[i] <= s0) continue;
    const t = (s[i] - s0) / trecho, w = t * t * (3 - 2 * t);
    ord[i] = soma(ord[i], mul(d, w));
  }
  const res = fim ? ord : ord.reverse();
  for (let i = 0; i < n; i++) pts[i] = res[i];
  void up;
}

const pontoNoSegmento = (q: V3, a: V3, b: V3): V3 => {
  const ab = sub(b, a), L2 = dot(ab, ab);
  const t = L2 > 1e-12 ? Math.max(0, Math.min(1, dot(sub(q, a), ab) / L2)) : 0;
  return soma(a, mul(ab, t));
};

/** Distância máxima (mm) da ponta do fio até o apoio procurado na subida livre. */
export const ALCANCE_SUBIDA = 4;

/**
 * Fios que sobem livres: cada ponta marcada vai até o apoio mais próximo (garra da central, haste de gema
 * livre ou folha) a até 4 mm; sem apoio, fica na superfície com aviso.
 */
export function encaixarFios(m: Montagem) {
  let sem = 0;
  for (const f of m.orn.fios) {
    const fm = f.malha;
    if (!fm || !(fm.subirIni || fm.subirFim)) continue;
    for (const fim of [false, true]) {
      if (fim ? !fm.subirFim : !fm.subirIni) continue;
      const q = f.pts[fim ? f.pts.length - 1 : 0];
      let alvo: V3 | null = null, dist = ALCANCE_SUBIDA;
      const ver = (p: V3) => { const d = comp(sub(p, q)); if (d < dist) { dist = d; alvo = p; } };
      for (const g of m.garras) ver(pontoNoSegmento(q, g.base, g.topo));
      for (const l of m.livres) for (const h of l.hastes) ver(pontoNoSegmento(q, h.base, h.topo));
      for (const fl of m.folhas) for (const p of fl.apoios) ver(p);
      if (alvo) subirAte(f.pts, fm.up, fim, alvo);
      else sem++;
    }
  }
  if (sem) m.avisos.push(`${sem} ponta(s) de fio marcadas para subir não acharam garra, gema ou folha a até ${ALCANCE_SUBIDA} mm.`);
}
