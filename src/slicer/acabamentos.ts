// WJSlicer3D: acabamentos da fatia M3 (código próprio; só a função foi estudada, nada copiado).
// - Compensação XY do contorno e dos furos, pé de elefante e polifuro: ajustes do campo de distância da camada
//   (positivo dentro). Cada célula sabe qual vazio está mais perto (o de fora da peça ou um furo); o contorno externo
//   anda `contorno` mm para fora, os furos `furo` mm para dentro do material, e um furo redondo vira polígono regular
//   (polifuro: o círculo inscrito é o furo, então o pino entra).
// - Fechar furos (modo de fatiamento): todo vazio da seção que não encosta na borda da grade vira cheio e os segmentos
//   dele saem do corte.
// - Pele felpuda: o laço de parede é amostrado a cada `distancia` mm e cada ponto sai da normal por um ruído (suave ou
//   aleatório, sempre o mesmo para a mesma peça) dentro de uma faixa de `espessura` mm centrada no caminho.
// Puro (sem DOM): testado em scripts/teste-acabamentos.ts.

import { celula, rotular, type Grade } from "./campo";
import { sorteio } from "./costura";

/** Vazios da seção: rótulo de cada célula de fora (0 = cheia) e quais rótulos encostam na borda da grade (o lado de fora). */
export function vaziosDaSecao(dentro: Uint8Array, g: Grade): { rot: Int32Array; n: number; externo: Uint8Array } {
  const N = g.cols * g.lins, fora = new Uint8Array(N);
  for (let q = 0; q < N; q++) fora[q] = dentro[q] ? 0 : 1;
  const r = rotular(fora, g);
  const externo = new Uint8Array(r.n + 1);
  const { cols, lins } = g;
  for (let i = 0; i < cols; i++) {
    externo[r.rot[i]] = 1;
    externo[r.rot[(lins - 1) * cols + i]] = 1;
  }
  for (let j = 0; j < lins; j++) {
    externo[r.rot[j * cols]] = 1;
    externo[r.rot[j * cols + cols - 1]] = 1;
  }
  externo[0] = 0;
  return { rot: r.rot, n: r.n, externo };
}

/**
 * Para cada célula, o vazio mais perto (rótulo de `rot`), por propagação em duas varreduras (distância de chanfro 1 / √2).
 * Basta para saber de que borda é cada célula; a distância exata continua sendo a do campo.
 */
export function vazioMaisPerto(rot: Int32Array, g: Grade): Int32Array {
  const { cols, lins } = g, N = cols * lins;
  const d = new Float32Array(N), r = Int32Array.from(rot);
  for (let q = 0; q < N; q++) d[q] = rot[q] ? 0 : Infinity;
  const D = Math.SQRT2;
  const relaxa = (q: number, p: number, w: number) => {
    if (d[p] + w < d[q]) {
      d[q] = d[p] + w;
      r[q] = r[p];
    }
  };
  for (let j = 0; j < lins; j++)
    for (let i = 0; i < cols; i++) {
      const q = j * cols + i;
      if (!d[q]) continue;
      if (i > 0) relaxa(q, q - 1, 1);
      if (j > 0) {
        relaxa(q, q - cols, 1);
        if (i > 0) relaxa(q, q - cols - 1, D);
        if (i + 1 < cols) relaxa(q, q - cols + 1, D);
      }
    }
  for (let j = lins - 1; j >= 0; j--)
    for (let i = cols - 1; i >= 0; i--) {
      const q = j * cols + i;
      if (!d[q]) continue;
      if (i + 1 < cols) relaxa(q, q + 1, 1);
      if (j + 1 < lins) {
        relaxa(q, q + cols, 1);
        if (i + 1 < cols) relaxa(q, q + cols + 1, D);
        if (i > 0) relaxa(q, q + cols - 1, D);
      }
    }
  return r;
}

/** Furo redondo achado na camada: centro, raio (mm) e lados do polifuro. */
export interface FuroRedondo {
  cx: number;
  cy: number;
  r: number;
  lados: number;
}

/** Lados do polifuro para o diâmetro `d` (mm): cerca de dois por milímetro, no mínimo 3. */
export const ladosPolifuro = (d: number) => Math.max(3, Math.round(2 * d));

/**
 * Furos redondos: para cada vazio interno, centro pelo centroide das células e raio pelas células junto à borda
 * (|p − c| − campo); é redondo se nenhuma delas fugir do raio médio mais que 3 % (+ 0,02 mm).
 */
export function furosRedondos(campo: Float32Array, rot: Int32Array, perto: Int32Array, externo: Uint8Array, n: number, g: Grade): (FuroRedondo | null)[] {
  const { cols, c } = g, N = cols * g.lins;
  const sx = new Float64Array(n + 1), sy = new Float64Array(n + 1), cnt = new Float64Array(n + 1);
  for (let q = 0; q < N; q++) {
    const k = rot[q];
    if (!k || externo[k]) continue;
    sx[k] += g.x0 + ((q % cols) + 0.5) * c;
    sy[k] += g.y0 + (Math.floor(q / cols) + 0.5) * c;
    cnt[k]++;
  }
  const soma = new Float64Array(n + 1), soma2 = new Float64Array(n + 1), m = new Float64Array(n + 1);
  const est = (q: number, k: number) => {
    const x = g.x0 + ((q % cols) + 0.5) * c, y = g.y0 + (Math.floor(q / cols) + 0.5) * c;
    return Math.hypot(x - sx[k] / cnt[k], y - sy[k] / cnt[k]) - campo[q];
  };
  for (let q = 0; q < N; q++) {
    const k = perto[q];
    if (!k || externo[k] || cnt[k] < 4 || Math.abs(campo[q]) > 1.5 * c) continue;
    const r = est(q, k);
    soma[k] += r;
    soma2[k] += r * r;
    m[k]++;
  }
  const media = Array.from({ length: n + 1 }, (_, k) => (m[k] ? soma[k] / m[k] : 0));
  const desvio = new Float64Array(n + 1);
  for (let q = 0; q < N; q++) {
    const k = perto[q];
    if (!k || externo[k] || cnt[k] < 4 || Math.abs(campo[q]) > 1.5 * c) continue;
    desvio[k] = Math.max(desvio[k], Math.abs(est(q, k) - media[k]));
  }
  return Array.from({ length: n + 1 }, (_, k) => {
    if (!k || externo[k] || m[k] < 8) return null;
    const r = media[k];
    if (r < 0.3 || desvio[k] > 0.03 * r + 0.02) return null;
    return { cx: sx[k] / cnt[k], cy: sy[k] / cnt[k], r, lados: ladosPolifuro(2 * r) };
  });
}

/** Campo do polifuro em (x, y): positivo no material; o polígono regular tem o círculo inscrito de raio `f.r` (um lado virado para +X). */
export function campoPolifuro(f: FuroRedondo, x: number, y: number): number {
  const dx = x - f.cx, dy = y - f.cy;
  const passo = (2 * Math.PI) / f.lados;
  // lado mais perto da direção do ponto: as normais dos lados ficam em k·passo
  const a = Math.atan2(dy, dx);
  const k = Math.round(a / passo);
  let melhor = -Infinity;
  for (const kk of [k - 1, k, k + 1]) melhor = Math.max(melhor, dx * Math.cos(kk * passo) + dy * Math.sin(kk * passo));
  return melhor - f.r;
}

export interface OpcoesCampo {
  /** mm que o contorno externo anda para fora (+) ou para dentro (−) */
  contorno: number;
  /** mm que os furos crescem (+) ou encolhem (−) */
  furo: number;
  polifuro: boolean;
}

/** Algum ajuste do campo para fazer? */
export const ajustaCampo = (o: OpcoesCampo) => o.contorno !== 0 || o.furo !== 0 || o.polifuro;

/**
 * Campo ajustado pela compensação XY e pelo polifuro (novo array; o original não muda). Devolve também os furos redondos
 * que viraram polifuro (para os testes e a prévia).
 */
export function ajustarCampo(campo: Float32Array, dentro: Uint8Array, g: Grade, o: OpcoesCampo): { campo: Float32Array; polifuros: FuroRedondo[] } {
  const { rot, n, externo } = vaziosDaSecao(dentro, g);
  const perto = vazioMaisPerto(rot, g);
  const redondos = o.polifuro ? furosRedondos(campo, rot, perto, externo, n, g) : [];
  const saida = new Float32Array(campo.length);
  const { cols, c } = g;
  for (let q = 0; q < campo.length; q++) {
    const k = perto[q];
    if (!k || externo[k]) {
      saida[q] = campo[q] + o.contorno;
      continue;
    }
    const f = redondos[k];
    if (f) saida[q] = campoPolifuro(f, g.x0 + ((q % cols) + 0.5) * c, g.y0 + (Math.floor(q / cols) + 0.5) * c) - o.furo;
    else saida[q] = campo[q] - o.furo;
  }
  return { campo: saida, polifuros: redondos.filter((f): f is FuroRedondo => !!f) };
}

/**
 * Fechar furos: os vazios internos de `dentro` viram cheios (no próprio mapa) e os segmentos deles saem do corte (o meio de
 * cada segmento junto a um furo). `cores` (um por segmento) é filtrado junto. Devolve os segmentos que ficam.
 */
export function fecharFuros(seg: Float64Array, cores: number[] | null, dentro: Uint8Array, g: Grade): { seg: Float64Array; cores: number[] | null } {
  const { rot, externo } = vaziosDaSecao(dentro, g);
  let algum = false;
  for (let q = 0; q < dentro.length; q++)
    if (rot[q] && !externo[rot[q]]) {
      dentro[q] = 1;
      algum = true;
    }
  if (!algum) return { seg, cores };
  const perto = vazioMaisPerto(rot, g);
  const fica: number[] = [], cs: number[] | null = cores ? [] : null;
  for (let s = 0; s < seg.length / 4; s++) {
    const q = celula(g, (seg[s * 4] + seg[s * 4 + 2]) / 2, (seg[s * 4 + 1] + seg[s * 4 + 3]) / 2);
    const k = q >= 0 ? perto[q] : 0;
    if (k && !externo[k]) continue;
    fica.push(seg[s * 4], seg[s * 4 + 1], seg[s * 4 + 2], seg[s * 4 + 3]);
    if (cs && cores) cs.push(cores[s]);
  }
  return { seg: Float64Array.from(fica), cores: cs };
}

// ---------- pele felpuda ----------

/** Ruído suave em 3D (valor em nós de uma grade de lado 1, interpolação suave), entre −1 e 1; sempre o mesmo para o mesmo ponto. */
export function ruidoSuave(x: number, y: number, z: number, semente: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const fx = x - xi, fy = y - yi, fz = z - zi;
  const s = (t: number) => t * t * (3 - 2 * t);
  const u = s(fx), v = s(fy), w = s(fz);
  const no = (i: number, j: number, k: number) => {
    let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(k, 2147483647) ^ Math.imul(semente, 1274126177);
    h = Math.imul(h ^ (h >>> 13), 1103515245);
    return (((h ^ (h >>> 16)) >>> 0) / 4294967295) * 2 - 1;
  };
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  return l(
    l(l(no(xi, yi, zi), no(xi + 1, yi, zi), u), l(no(xi, yi + 1, zi), no(xi + 1, yi + 1, zi), u), v),
    l(l(no(xi, yi, zi + 1), no(xi + 1, yi, zi + 1), u), l(no(xi, yi + 1, zi + 1), no(xi + 1, yi + 1, zi + 1), u), v),
    w,
  );
}

export interface OpcoesPele {
  espessura: number;
  distancia: number;
  ruido: "perlin" | "aleatorio";
  /** altura do meio da camada (o ruído suave muda com ela) e semente da camada (o aleatório) */
  z: number;
  semente: number;
}

/**
 * Laço (ou caminho aberto) com a pele felpuda: pontos a cada `distancia` mm ao longo do caminho, cada um afastado na normal
 * por até ±espessura/2. O material fica à esquerda do sentido (laço externo anti-horário, furo horário), então "para fora" é
 * a direita; o sinal do ruído decide o lado.
 */
export function peleFelpuda(pts: Float64Array, fechado: boolean, o: OpcoesPele): Float64Array {
  const np = pts.length / 2;
  if (np < 2 || o.espessura <= 0) return pts;
  const d = Math.max(0.05, o.distancia > 0 ? o.distancia : 0.8);
  const meia = o.espessura / 2;
  const rnd = sorteio(o.semente);
  const escala = 1 / Math.max(0.25, 2 * d);
  const desloc = (x: number, y: number) => (o.ruido === "aleatorio" ? rnd() * 2 - 1 : ruidoSuave(x * escala, y * escala, o.z * escala, o.semente));
  const out: number[] = [];
  const passos = fechado ? np : np - 1;
  for (let a = 0; a < passos; a++) {
    const b = (a + 1) % np;
    const ax = pts[a * 2], ay = pts[a * 2 + 1], bx = pts[b * 2], by = pts[b * 2 + 1];
    const L = Math.hypot(bx - ax, by - ay);
    if (L < 1e-9) continue;
    const tx = (bx - ax) / L, ty = (by - ay) / L;
    // normal para fora (à direita do sentido); o vértice do laço fica (os cantos não são cortados) e o lado é dividido por igual
    const nx = ty, ny = -tx;
    const m = Math.max(1, Math.round(L / d));
    for (let s = a === 0 && !fechado ? 1 : 0; s < m; s++) {
      const x = ax + (tx * L * s) / m, y = ay + (ty * L * s) / m, r = desloc(x, y) * meia;
      out.push(x + nx * r, y + ny * r);
    }
    if (a === 0 && !fechado) out.unshift(ax, ay);
  }
  if (!fechado) out.push(pts[np * 2 - 2], pts[np * 2 - 1]);
  return out.length >= (fechado ? 6 : 4) ? Float64Array.from(out) : pts;
}
