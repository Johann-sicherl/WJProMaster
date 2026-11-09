// WJSlicer3D: motor de estimativa. Fatia a malha em camadas e calcula o tempo de impressão e o
// material sem gerar G-code. Puro (sem DOM): roda no worker e em Node (scripts/teste-slicer.ts).
//
// Como funciona, camada por camada:
// 1. Corte da malha pelo plano do meio da camada: cada triângulo que cruza o plano dá um segmento,
//    orientado pela normal do triângulo (sentido anti-horário nos contornos externos). Os segmentos
//    se encadeiam pela aresta da malha em comum: saem os laços (contornos e furos), com perímetro,
//    área com sinal e o ângulo de cada canto.
// 2. Varredura por linhas (par/ímpar) do mesmo corte: área exata da seção e um mapa de bits da
//    camada numa grade. Os mapas das camadas vizinhas dão, com operações de bits, as cascas de topo e
//    fundo (sólidas), a superfície de topo exposta e as regiões que pedem suporte (ângulo-limite).
// 3. Material: paredes = perímetro × voltas; o interior se divide em sólido e esparso (× densidade);
//    volume = área × altura da camada (a largura da linha já desconta o arredondamento do filete).
// 4. Tempo: cada movimento segue um planejador como o do firmware — trapézio de velocidade com a
//    aceleração do recurso e velocidade de canto pelo ângulo da junção (jerk); a velocidade fica
//    limitada pela vazão volumétrica máxima do material; camadas rápidas demais desaceleram para
//    resfriar (tempo mínimo de camada); deslocamentos com retração e levantamento do Z.

import type { Maquina, Material, Processo } from "./perfis";

export interface Ajustes {
  altura: number;
  paredes: number;
  topo: number;
  fundo: number;
  /** 0–1 */
  preenchimento: number;
  suporte: boolean;
  borda: boolean;
}

export const ajustesPadrao = (p: Processo): Ajustes => ({
  altura: p.altura, paredes: p.paredes, topo: p.topo, fundo: p.fundo, preenchimento: p.preenchimento, suporte: false, borda: false,
});

/** Malha já na posição de impressão (Z para cima): 3 números por vértice, 3 índices por triângulo. */
export interface MalhaImpressao {
  pos: Float32Array;
  tri: Uint32Array;
}

export type Parte = "paredeExt" | "paredeInt" | "solido" | "topo" | "ponte" | "esparso" | "suporte" | "borda" | "deslocamento" | "resfriamento";
export const NOMES_PARTES: Record<Parte, string> = {
  paredeExt: "Parede externa", paredeInt: "Paredes internas", solido: "Preenchimento sólido", topo: "Superfície de topo", ponte: "Pontes (sobre o vazio)",
  esparso: "Preenchimento esparso", suporte: "Suporte", borda: "Borda (aba)", deslocamento: "Deslocamentos e retrações", resfriamento: "Espera para resfriar",
};

export interface Resultado {
  camadas: number;
  dimensoes: [number, number, number];
  /** volume da peça (mm³) pela malha; null se ela não for fechada */
  volumePeca: number | null;
  /** filamento gasto */
  volumeMm3: number;
  comprimentoM: number;
  massaG: number;
  custo: number;
  /** tempo de impressão (s), sem o preparo */
  tempoS: number;
  /** preparo típico da máquina (aquecer, nivelar, purgar) */
  preparoS: number;
  partes: Record<Parte, { tempo: number; volume: number }>;
  avisos: string[];
}

const DIAMETRO_FILAMENTO = 1.75;
/** distância entre linhas do suporte (mm) e da interface (camadas logo abaixo da peça) */
const ESPACO_SUPORTE = 2.5, ESPACO_INTERFACE = 0.5, CAMADAS_INTERFACE = 2, LINHA_SUPORTE = 0.4;
/** borda (aba) de 5 mm em volta da primeira camada */
const LARGURA_BORDA = 5;
/** "acelerar até desacelerar" do Klipper (fração da aceleração) */
const KLIPPER_A2D = 0.5;
/** limite de células da grade por camada (memória do tablet: 1 bit por célula) */
const MAX_CELULAS = 160_000;

/** Distância entre centros de linhas vizinhas: o filete tem as pontas arredondadas. */
export const espacamento = (w: number, h: number) => w - h * (1 - Math.PI / 4);

/**
 * Tempo para percorrer `L` mm entrando a `v0` e saindo a `v1`, com velocidade de cruzeiro `v` e
 * aceleração `a` (trapézio; triângulo quando a linha é curta). `a2d` (Klipper): pseudoaceleração
 * que limita o pico de velocidade das linhas curtas.
 */
export function tempoTrapezio(L: number, v0: number, v1: number, v: number, a: number, a2d = 0): number {
  if (L <= 0) return 0;
  if (a2d > 0) v = Math.min(v, Math.sqrt((v0 * v0 + v1 * v1) / 2 + a2d * L));
  v0 = Math.min(v0, v);
  v1 = Math.min(v1, v);
  const d1 = (v * v - v0 * v0) / (2 * a), d2 = (v * v - v1 * v1) / (2 * a);
  if (d1 + d2 <= L) return (v - v0) / a + (v - v1) / a + (L - d1 - d2) / v;
  const vp = Math.max(v0, v1, Math.sqrt(Math.max(0, (2 * a * L + v0 * v0 + v1 * v1) / 2)));
  return (vp - v0) / a + (vp - v1) / a;
}

/** Velocidade de passagem num canto que vira `ang` radianos (0 = reto), pela variação permitida `jerk`. */
export const velCanto = (ang: number, v: number, jerk: number) => {
  const s = Math.sin(Math.abs(ang) / 2);
  return s < 1e-6 ? v : Math.min(v, jerk / (2 * s));
};

/**
 * Tempo de um laço fechado (segmentos `L` e ângulo de virada no fim de cada um), com o planejador
 * de duas passadas (para trás e para a frente) que limita a velocidade nas junções. `vSeg`: limite
 * de cada segmento (parede em balanço); `a2d`: ver tempoTrapezio.
 */
export function tempoLaco(L: ArrayLike<number>, ang: ArrayLike<number>, n: number, v: number, a: number, jerk: number, vSeg?: ArrayLike<number>, a2d = 0): number {
  if (!n) return 0;
  const vs = (k: number) => (vSeg ? Math.min(v, vSeg[k]) : v);
  const vj = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const vk = Math.min(vs(k), vs((k + 1) % n));
    vj[k] = velCanto(ang[k], vk, jerk);
  }
  for (let volta = 0; volta < 2; volta++) {
    for (let k = n - 1; k >= 0; k--) {
      const prox = (k + 1) % n;
      vj[k] = Math.min(vj[k], Math.sqrt(vj[prox] * vj[prox] + 2 * a * L[prox]));
    }
    for (let k = 0; k < n; k++) {
      const ant = (k + n - 1) % n;
      vj[k] = Math.min(vj[k], Math.sqrt(vj[ant] * vj[ant] + 2 * a * L[k]));
    }
  }
  let t = 0;
  for (let k = 0; k < n; k++) t += tempoTrapezio(L[k], vj[(k + n - 1) % n], vj[k], vs(k), a, a2d);
  return t;
}

/** Tempo de `total` mm de linhas retas de `L` mm em zigue-zague (curva de 90° em cada ponta). */
function tempoLinhas(total: number, L: number, v: number, a: number, jerk: number, a2d = 0): number {
  if (total <= 0) return 0;
  L = Math.max(0.5, Math.min(L, total));
  const vc = velCanto(Math.PI / 2, v, jerk);
  return (total / L) * tempoTrapezio(L, vc, vc, v, a, a2d);
}

const contarBits = (x: number) => {
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
};
const contar = (b: Uint32Array) => {
  let s = 0;
  for (let i = 0; i < b.length; i++) if (b[i]) s += contarBits(b[i]);
  return s;
};

/** Volume com sinal pela divergência; null se alguma aresta não tiver exatamente dois triângulos. */
export function volumeMalha(m: MalhaImpressao): number | null {
  const { pos: p, tri } = m;
  const nv = p.length / 3;
  const arestas = new Map<number, number>();
  let v = 0;
  for (let t = 0; t < tri.length; t += 3) {
    const a = tri[t], b = tri[t + 1], c = tri[t + 2];
    if (a === b || b === c || a === c) continue; // colapsado pela solda dos vértices
    const ax = p[a * 3], ay = p[a * 3 + 1], az = p[a * 3 + 2];
    const bx = p[b * 3], by = p[b * 3 + 1], bz = p[b * 3 + 2];
    const cx = p[c * 3], cy = p[c * 3 + 1], cz = p[c * 3 + 2];
    v += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
    for (const [i, j] of [[a, b], [b, c], [c, a]]) {
      const k = i < j ? i * nv + j : j * nv + i;
      arestas.set(k, (arestas.get(k) ?? 0) + 1);
    }
  }
  for (const n of arestas.values()) if (n !== 2) return null;
  return Math.abs(v);
}

/** Caixa da malha. */
export function caixa(pos: Float32Array): { min: [number, number, number]; max: [number, number, number] } {
  const min: [number, number, number] = [Infinity, Infinity, Infinity], max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3)
    for (let k = 0; k < 3; k++) {
      const x = pos[i + k];
      if (x < min[k]) min[k] = x;
      if (x > max[k]) max[k] = x;
    }
  return { min, max };
}

interface Camada {
  /** área da seção (mm²) e perímetro de todos os laços (mm) */
  area: number;
  perimetro: number;
  ilhas: number;
  furos: number;
  /** comprimento médio das cordas da seção (mm): tamanho típico das linhas de preenchimento */
  corda: number;
  /** tempo de uma volta de parede nos contornos, na velocidade da parede externa e da interna */
  tExt: number;
  tInt: number;
  /** diagonal da caixa da seção (deslocamentos entre ilhas) */
  diag: number;
  /** perímetro só dos contornos externos (borda) */
  perimetroExt: number;
  bits: Uint32Array;
}

/**
 * Estima tempo e material da malha na máquina e no material escolhidos.
 * `progresso` recebe de 0 a 1 (o worker repassa à tela).
 */
export function estimar(m: MalhaImpressao, maq: Maquina, mat: Material, aj: Ajustes, progresso?: (f: number) => void): Resultado {
  const pr = maq.processo;
  const { pos, tri } = m;
  const nt = tri.length / 3;
  const nv = pos.length / 3;
  const avisos: string[] = [];
  if (!nt) throw new Error("A malha não tem triângulos.");
  const { min, max } = caixa(pos);
  const dims: [number, number, number] = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const H = dims[2];
  if (H <= 0) throw new Error("A peça não tem altura (malha plana).");
  if (dims[0] > maq.mesa[0] + 1e-6 || dims[1] > maq.mesa[1] + 1e-6) avisos.push(`A peça (${dims[0].toFixed(0)} × ${dims[1].toFixed(0)} mm) não cabe na mesa de ${maq.mesa[0]} × ${maq.mesa[1]} mm.`);
  if (H > maq.alturaMax + 1e-6) avisos.push(`A peça tem ${H.toFixed(0)} mm de altura; a máquina imprime até ${maq.alturaMax} mm.`);

  const h = aj.altura, h1 = pr.alturaPrimeira;
  const n = H <= h1 ? 1 : 1 + Math.ceil((H - h1) / h - 1e-6);
  const plano = (i: number) => min[2] + (i === 0 ? h1 / 2 : h1 + (i - 1) * h + h / 2);
  const alturaDe = (i: number) => (i === 0 ? h1 : h);
  const topoN = Math.max(aj.topo, Math.ceil(pr.topoMm / h - 1e-6) * (aj.topo > 0 ? 1 : 0));
  const fundoN = Math.max(aj.fundo, Math.ceil(pr.fundoMm / h - 1e-6) * (aj.fundo > 0 ? 1 : 0));

  // grade das camadas
  const area0 = (dims[0] + 2) * (dims[1] + 2);
  const c = Math.max(0.25, Math.sqrt(area0 / MAX_CELULAS));
  const x0 = min[0] - c, y0 = min[1] - c;
  const cols = Math.ceil((dims[0] + 2 * c) / c) + 1, linhas = Math.ceil((dims[1] + 2 * c) / c) + 1;
  const ppl = Math.ceil(cols / 32); // palavras por linha da grade
  const tamBits = ppl * linhas;

  // triângulos ordenados pelo Z mínimo (varredura com lista de ativos)
  const zmin = new Float32Array(nt), zmax = new Float32Array(nt);
  for (let t = 0; t < nt; t++) {
    const a = pos[tri[t * 3] * 3 + 2], b = pos[tri[t * 3 + 1] * 3 + 2], cc = pos[tri[t * 3 + 2] * 3 + 2];
    zmin[t] = Math.min(a, b, cc);
    zmax[t] = Math.max(a, b, cc);
  }
  const ordem = Uint32Array.from({ length: nt }, (_, i) => i).sort((a, b) => zmin[a] - zmin[b]);
  let proximo = 0;
  let ativos: number[] = [];

  // segmentos da camada (reaproveitados)
  let cap = 1024;
  let sx1 = new Float64Array(cap), sy1 = new Float64Array(cap), sx2 = new Float64Array(cap), sy2 = new Float64Array(cap);
  let kIni = new Float64Array(cap), kFim = new Float64Array(cap), voto = new Float64Array(cap), balanco = new Float64Array(cap);
  const crescer = () => {
    cap *= 2;
    const g = (v: Float64Array) => {
      const nv2 = new Float64Array(cap);
      nv2.set(v);
      return nv2;
    };
    sx1 = g(sx1); sy1 = g(sy1); sx2 = g(sx2); sy2 = g(sy2); kIni = g(kIni); kFim = g(kFim); voto = g(voto); balanco = g(balanco);
  };
  const chave = (i: number, j: number) => (i < j ? i * nv + j : j * nv + i);

  const vExt = (i: number) => Math.min(i === 0 ? pr.vPrimeira : pr.vParedeExt, maq.vMax);
  const vInt = (i: number) => Math.min(i === 0 ? pr.vPrimeira : pr.vParedeInt, maq.vMax);
  const lim = (a: number) => Math.min(a, maq.aMax);
  const a2d = (a: number) => (maq.klipper ? a * KLIPPER_A2D : 0);
  /** velocidade da parede externa pelo quanto ela sai da camada de baixo (fração da largura) */
  const velBalanco = (grau: number) => {
    if (grau <= 0) return Infinity;
    const faixa = grau > 1 ? -1 : Math.min(3, Math.ceil(grau * 4) - 1);
    const v = faixa < 0 ? pr.vPonte : pr.vBalanco[faixa];
    return v > 0 ? v : Infinity;
  };
  /** velocidade limitada pela vazão volumétrica do material */
  const vVazao = (v: number, w: number, hh: number) => Math.min(v, mat.vazaoMax / (espacamento(w, hh) * hh));

  const camadas: Camada[] = new Array(n);
  const Lseg: number[] = [], Aseg: number[] = [], Dx: number[] = [], Dy: number[] = [], Vb: number[] = [];
  for (let i = 0; i < n; i++) {
    const z = plano(i);
    while (proximo < nt && zmin[ordem[proximo]] <= z) ativos.push(ordem[proximo++]);
    ativos = ativos.filter((t) => zmax[t] > z);
    // corte
    let ns = 0;
    for (const t of ativos) {
      const ia = tri[t * 3], ib = tri[t * 3 + 1], ic = tri[t * 3 + 2];
      if (ia === ib || ib === ic || ia === ic) continue; // triângulo colapsado pela solda dos vértices
      const za = pos[ia * 3 + 2], zb = pos[ib * 3 + 2], zc = pos[ic * 3 + 2];
      const sa = za > z, sb = zb > z, sc = zc > z;
      if (sa === sb && sb === sc) continue;
      let px = 0, py = 0, qx = 0, qy = 0, kp = 0, kq = 0, achados = 0;
      const corta = (u: number, w: number, zu: number, zw: number) => {
        const f = (z - zu) / (zw - zu);
        const x = pos[u * 3] + (pos[w * 3] - pos[u * 3]) * f, y = pos[u * 3 + 1] + (pos[w * 3 + 1] - pos[u * 3 + 1]) * f;
        if (achados++ === 0) {
          px = x; py = y; kp = chave(u, w);
        } else {
          qx = x; qy = y; kq = chave(u, w);
        }
      };
      if (sa !== sb) corta(ia, ib, za, zb);
      if (sb !== sc) corta(ib, ic, zb, zc);
      if (sc !== sa) corta(ic, ia, zc, za);
      if (achados !== 2) continue;
      // normal do triângulo: o segmento anda com o material à esquerda
      const ux = pos[ib * 3] - pos[ia * 3], uy = pos[ib * 3 + 1] - pos[ia * 3 + 1], uz = pos[ib * 3 + 2] - pos[ia * 3 + 2];
      const wx = pos[ic * 3] - pos[ia * 3], wy = pos[ic * 3 + 1] - pos[ia * 3 + 1], wz = pos[ic * 3 + 2] - pos[ia * 3 + 2];
      const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
      if (kp === kq) continue;
      if (ns >= cap) crescer();
      // voto do sentido: +1 se o segmento como gravado anda com o material à esquerda, pesado pelo
      // quanto a normal é horizontal (triângulos-agulha quase não votam)
      const nn = Math.hypot(nx, ny, nz) || 1;
      const nxy = Math.hypot(nx, ny);
      voto[ns] = (((qx - px) * -ny + (qy - py) * nx) >= 0 ? 1 : -1) * (nxy / nn);
      // face virada para baixo: a parede avança tanβ × altura além da camada de baixo
      balanco[ns] = nz < 0 && nxy > 0 ? Math.min(1e3, -nz / nxy) : 0;
      sx1[ns] = px; sy1[ns] = py; sx2[ns] = qx; sy2[ns] = qy; kIni[ns] = kp; kFim[ns] = kq;
      ns++;
    }

    // laços: cada aresta da malha cortada liga dois segmentos; percorre a cadeia e decide o
    // sentido do laço pela maioria dos votos (não depende de cada triângulo isolado)
    const par1 = new Map<number, number>(), par2 = new Map<number, number>();
    for (let s = 0; s < ns; s++)
      for (const k of [kIni[s], kFim[s]]) {
        if (par1.has(k)) par2.set(k, s);
        else par1.set(k, s);
      }
    const outro = (k: number, s: number) => {
      const a = par1.get(k);
      return a === s ? par2.get(k) : a;
    };
    const visto = new Uint8Array(ns);
    let perimetro = 0, perimetroExt = 0, ilhas = 0, furos = 0, tExt = 0, tInt = 0;
    let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
    const hh = alturaDe(i);
    const wE = i === 0 ? pr.lPrimeira : pr.lParedeExt, wI = i === 0 ? pr.lPrimeira : pr.lParedeInt;
    const ve = vVazao(vExt(i), wE, hh), vi = vVazao(vInt(i), wI, hh);
    const ae = lim(i === 0 ? pr.aPrimeira : pr.aParedeExt), ai = lim(i === 0 ? pr.aPrimeira : pr.aParedeInt);
    for (let s0 = 0; s0 < ns; s0++) {
      if (visto[s0]) continue;
      Lseg.length = 0;
      Dx.length = 0;
      Dy.length = 0;
      Vb.length = 0;
      let s = s0, frente = true, area2 = 0, comp = 0, votos = 0, fechado = false;
      for (;;) {
        visto[s] = 1;
        const ax = frente ? sx1[s] : sx2[s], ay = frente ? sy1[s] : sy2[s];
        const qx = frente ? sx2[s] : sx1[s], qy = frente ? sy2[s] : sy1[s];
        const dx = qx - ax, dy = qy - ay;
        const L = Math.hypot(dx, dy);
        area2 += ax * qy - qx * ay;
        comp += L;
        votos += (frente ? 1 : -1) * voto[s] * L;
        if (ax < bx0) bx0 = ax;
        if (ax > bx1) bx1 = ax;
        if (ay < by0) by0 = ay;
        if (ay > by1) by1 = ay;
        if (L > 1e-9) {
          Lseg.push(L);
          Dx.push(dx);
          Dy.push(dy);
          Vb.push(i === 0 ? Infinity : velBalanco((balanco[s] * hh) / wE));
        }
        const saida: number = frente ? kFim[s] : kIni[s];
        const prox: number | undefined = outro(saida, s);
        if (prox === s0) fechado = true;
        if (prox === undefined || visto[prox]) break;
        frente = kIni[prox] === saida;
        s = prox;
      }
      if (votos < 0) area2 = -area2; // percorrido no sentido contrário ao do material
      // ângulo de virada no fim de cada segmento (contorno aberto: volta inteira na ponta)
      const nl = Lseg.length;
      Aseg.length = nl;
      for (let k = 0; k < nl; k++) {
        const j = k + 1 < nl ? k + 1 : fechado ? 0 : -1;
        Aseg[k] = j < 0 ? Math.PI : Math.atan2(Dx[k] * Dy[j] - Dy[k] * Dx[j], Dx[k] * Dx[j] + Dy[k] * Dy[j]);
      }
      if (comp < 1e-6) continue;
      perimetro += comp;
      if (area2 >= 0) {
        ilhas++;
        perimetroExt += comp;
      } else furos++;
      tExt += tempoLaco(Lseg, Aseg, Lseg.length, ve, ae, maq.jerk, Vb, a2d(ae));
      tInt += tempoLaco(Lseg, Aseg, Lseg.length, vi, ai, maq.jerk, undefined, a2d(ai));
    }

    // varredura por linhas: área exata, cordas e mapa de bits
    const contagem = new Int32Array(linhas + 1);
    const faixa = (s: number): [number, number] => {
      const lo = Math.min(sy1[s], sy2[s]), hi = Math.max(sy1[s], sy2[s]);
      return [Math.max(0, Math.ceil((lo - y0) / c - 0.5)), Math.min(linhas - 1, Math.ceil((hi - y0) / c - 0.5) - 1)];
    };
    for (let s = 0; s < ns; s++) {
      const [r0, r1] = faixa(s);
      for (let r = r0; r <= r1; r++) contagem[r + 1]++;
    }
    for (let r = 0; r < linhas; r++) contagem[r + 1] += contagem[r];
    const xs = new Float64Array(contagem[linhas]);
    const enc = contagem.slice(0, linhas);
    for (let s = 0; s < ns; s++) {
      const [r0, r1] = faixa(s);
      for (let r = r0; r <= r1; r++) {
        const yc = y0 + (r + 0.5) * c;
        xs[enc[r]++] = sx1[s] + ((yc - sy1[s]) * (sx2[s] - sx1[s])) / (sy2[s] - sy1[s]);
      }
    }
    const bits = new Uint32Array(tamBits);
    let area = 0, cordas = 0, somaCordas = 0;
    for (let r = 0; r < linhas; r++) {
      const fila = xs.subarray(contagem[r], contagem[r + 1]).sort();
      for (let k = 0; k + 1 < fila.length; k += 2) {
        const xa = fila[k], xb = fila[k + 1];
        if (xb <= xa) continue;
        area += (xb - xa) * c;
        cordas++;
        somaCordas += xb - xa;
        const c0 = Math.max(0, Math.ceil((xa - x0) / c - 0.5)), c1 = Math.min(cols - 1, Math.ceil((xb - x0) / c - 0.5) - 1);
        for (let k2 = c0; k2 <= c1; k2++) bits[r * ppl + (k2 >>> 5)] |= 1 << (k2 & 31);
      }
    }
    camadas[i] = {
      area, perimetro, ilhas, furos, corda: cordas ? somaCordas / cordas : 0, tExt, tInt,
      diag: Number.isFinite(bx0) ? Math.hypot(bx1 - bx0, by1 - by0) : 0, perimetroExt, bits,
    };
    if (progresso && i % 16 === 0) progresso((0.75 * i) / n);
  }

  // ---------- segunda passada: regiões, material e tempo ----------
  const partes = Object.fromEntries(Object.keys(NOMES_PARTES).map((k) => [k, { tempo: 0, volume: 0 }])) as Resultado["partes"];
  const janela = new Uint32Array(tamBits);
  const vazio = new Uint32Array(tamBits);
  const bitsDe = (j: number) => (j < 0 || j >= n ? vazio : camadas[j].bits);
  const aD = lim(pr.aDeslocamento), vD = Math.min(pr.vDeslocamento, maq.vMax);
  const tRetracao = 2 * (maq.retracao / maq.vRetracao) + (maq.zHop > 0 ? (2 * maq.zHop) / maq.vZ : 0);

  // suporte: de cima para baixo, guardando a área por camada
  const supArea = new Float64Array(n), supInterface = new Float64Array(n);
  if (aj.suporte && n > 1) {
    const deslocLim = h / Math.tan((pr.anguloSuporte * Math.PI) / 180);
    const raio = Math.min(4, Math.max(0, Math.floor(deslocLim / c)));
    let S = new Uint32Array(tamBits);
    const dil = new Uint32Array(tamBits), aux = new Uint32Array(tamBits);
    const O = new Uint32Array(tamBits);
    const ultimas: Uint32Array[] = [];
    for (let i = n - 2; i >= 0; i--) {
      // a camada de baixo, alargada pelo ângulo-limite, apoia a de cima
      dil.set(camadas[i].bits);
      for (let r = 0; r < raio; r++) dilatar(dil, aux, ppl, linhas);
      const B1 = camadas[i + 1].bits, B = camadas[i].bits;
      for (let k = 0; k < tamBits; k++) O[k] = B1[k] & ~dil[k];
      ultimas.unshift(O.slice());
      if (ultimas.length > CAMADAS_INTERFACE) ultimas.pop();
      const novo = new Uint32Array(tamBits);
      let inter = 0;
      for (let k = 0; k < tamBits; k++) {
        novo[k] = (S[k] | O[k]) & ~B[k];
        let oi = 0;
        for (const u of ultimas) oi |= u[k];
        const ik = novo[k] & oi;
        if (ik) inter += contarBits(ik);
      }
      S = novo;
      supArea[i] = contar(S) * c * c;
      supInterface[i] = inter * c * c;
      if (progresso && i % 32 === 0) progresso(0.75 + (0.1 * (n - i)) / n);
    }
  }

  for (let i = 0; i < n; i++) {
    const cam = camadas[i];
    const hh = alturaDe(i);
    const B = cam.bits;
    // cascas: a célula é sólida se faltar material em alguma das camadas da janela (fundo..topo)
    janela.set(B);
    for (let j = i - fundoN; j <= i + topoN; j++) {
      if (j === i) continue;
      const Bj = bitsDe(j);
      for (let k = 0; k < tamBits; k++) janela[k] &= Bj[k];
    }
    const acima = bitsDe(i + 1), abaixo = i > 0 ? bitsDe(i - 1) : B;
    let nB = 0, nSol = 0, nTopo = 0, nPonte = 0;
    for (let k = 0; k < tamBits; k++) {
      const b = B[k];
      if (!b) continue;
      nB += contarBits(b);
      const s = b & ~janela[k];
      if (s) nSol += contarBits(s);
      const t = b & ~acima[k];
      if (t) nTopo += contarBits(t);
      const pt = b & ~abaixo[k];
      if (pt) nPonte += contarBits(pt);
    }
    const fSol = topoN + fundoN === 0 ? 0 : nB ? nSol / nB : 1;
    const fTopo = nB ? Math.min(fSol, nTopo / nB) : 0;

    // paredes
    const wE = i === 0 ? pr.lPrimeira : pr.lParedeExt, wI = i === 0 ? pr.lPrimeira : pr.lParedeInt;
    const sE = espacamento(wE, hh), sI = espacamento(wI, hh);
    const voltas = Math.max(1, aj.paredes);
    const larguraParedes = sE + (voltas - 1) * sI;
    const aParedes = cam.perimetro * larguraParedes;
    const fParede = aParedes > cam.area && aParedes > 0 ? cam.area / aParedes : 1; // seção fina: menos voltas
    const volExt = cam.perimetro * sE * hh * fParede, volInt = cam.perimetro * (voltas - 1) * sI * hh * fParede;
    let tCam = 0, lCam = 0;
    const soma = (p: Parte, t: number, v: number, comp: number) => {
      partes[p].tempo += t;
      partes[p].volume += v;
      tCam += t;
      lCam += comp;
    };
    soma("paredeExt", cam.tExt * fParede, volExt, cam.perimetro * fParede);
    soma("paredeInt", cam.tInt * (voltas - 1) * fParede, volInt, cam.perimetro * (voltas - 1) * fParede);

    // interior
    const interior = Math.max(0, cam.area - aParedes * fParede);
    const corda = Math.max(1, cam.corda - 2 * larguraParedes);
    // ponte: sólido sem nada embaixo (vai devagar, como a ponte do perfil)
    const fPonte = nB ? Math.min(nPonte / nB, fSol - fTopo) : 0;
    const aTopo = interior * fTopo, aPonte = interior * fPonte, aSolido = interior * (fSol - fTopo - fPonte), aEsparso = interior * (1 - fSol);
    const preencher = (p: Parte, area: number, dens: number, w: number, v: number, a: number) => {
      if (area <= 0 || dens <= 0) return;
      const sp = espacamento(w, hh);
      const comp = (area * dens) / sp;
      soma(p, tempoLinhas(comp, corda, vVazao(Math.min(v, maq.vMax), w, hh), lim(a), maq.jerk, a2d(lim(a))), area * dens * hh, comp);
    };
    if (i === 0) {
      preencher("solido", aSolido + aTopo, 1, pr.lPrimeira, pr.vPrimeiraPreench, pr.aPrimeira);
      preencher("esparso", aEsparso, aj.preenchimento, pr.lPrimeira, pr.vPrimeiraPreench, pr.aPrimeira);
    } else {
      preencher("topo", aTopo, 1, pr.lSolido, pr.vTopo, pr.aTopo);
      preencher("ponte", aPonte, 1, pr.lSolido, pr.vPonte, pr.aPadrao);
      preencher("solido", aSolido, 1, pr.lSolido, pr.vSolido, pr.aPadrao);
      preencher("esparso", aEsparso, aj.preenchimento, pr.lEsparso, pr.vEsparso, pr.aEsparso);
    }

    // suporte (corpo esparso + interface densa logo abaixo da peça)
    if (supArea[i] > 0) {
      const dCorpo = LINHA_SUPORTE / (LINHA_SUPORTE + ESPACO_SUPORTE), dInter = LINHA_SUPORTE / (LINHA_SUPORTE + ESPACO_INTERFACE);
      const sp = espacamento(LINHA_SUPORTE, hh);
      const vol = (supArea[i] - supInterface[i]) * dCorpo * hh + supInterface[i] * dInter * hh;
      const comp = vol / (sp * hh);
      const vS = vVazao(Math.min(i === 0 ? pr.vPrimeira : pr.vSuporte, maq.vMax), LINHA_SUPORTE, hh);
      soma("suporte", tempoLinhas(comp, Math.min(20, Math.sqrt(supArea[i])), vS, lim(pr.aPadrao), maq.jerk), vol, comp);
    }

    // borda (aba) na primeira camada
    if (i === 0 && aj.borda && cam.perimetroExt > 0) {
      const sp = espacamento(pr.lPrimeira, hh);
      const m2 = Math.ceil(LARGURA_BORDA / sp);
      const comp = m2 * cam.perimetroExt + Math.PI * sp * m2 * (m2 + 1) * Math.max(1, cam.ilhas);
      soma("borda", tempoLinhas(comp, comp / (m2 * Math.max(1, cam.ilhas)), vVazao(Math.min(pr.vPrimeira, maq.vMax), pr.lPrimeira, hh), lim(pr.aPrimeira), maq.jerk), comp * sp * hh, comp);
    }

    // deslocamentos: até cada contorno, para o preenchimento de cada ilha, entre ilhas e troca de camada
    let tDesl = 0;
    if (cam.area > 0 || cam.perimetro > 0) {
      const ilhas = Math.max(1, cam.ilhas);
      const dentro = Math.min(30, 0.5 * Math.sqrt(cam.area / ilhas) + 2);
      const entre = ilhas > 1 ? cam.diag / 2 : dentro;
      const movimentos = cam.furos + ilhas * (voltas > 1 ? 2 : 1) + (interior > 0 ? ilhas : 0);
      tDesl += movimentos * (tempoTrapezio(dentro, 0, 0, vD, aD) + tRetracao) + ilhas * tempoTrapezio(entre, 0, 0, vD, aD);
    }
    tDesl += tRetracao / 2 + hh / maq.vZ; // troca de camada
    partes.deslocamento.tempo += tDesl;

    // tempo mínimo de camada: desacelera a extrusão para o plástico resfriar
    if (lCam > 0 && tCam + tDesl < mat.tempoCamada) {
      const alvo = Math.max(tCam, Math.min(mat.tempoCamada - tDesl, lCam / mat.vMinResfriar));
      partes.resfriamento.tempo += alvo - tCam;
    }
    if (progresso && i % 32 === 0) progresso(0.85 + (0.15 * i) / n);
  }

  const volumeMm3 = Object.values(partes).reduce((s, p) => s + p.volume, 0);
  const tempoS = Object.values(partes).reduce((s, p) => s + p.tempo, 0);
  const secao = Math.PI * (DIAMETRO_FILAMENTO / 2) ** 2;
  const massaG = (volumeMm3 / 1000) * mat.densidade;
  const volumePeca = volumeMalha(m);
  if (volumePeca === null) avisos.push("A malha tem aberturas (não é fechada): a estimativa pode ficar imprecisa.");
  progresso?.(1);
  return {
    camadas: n, dimensoes: dims, volumePeca, volumeMm3, comprimentoM: volumeMm3 / secao / 1000, massaG,
    custo: (massaG / 1000) * mat.precoKg, tempoS, preparoS: maq.preparoMin * 60, partes, avisos,
  };
}

/** Alarga o mapa de bits uma célula (vizinhos em cruz). `aux` é área de trabalho do mesmo tamanho. */
function dilatar(b: Uint32Array, aux: Uint32Array, ppl: number, linhas: number) {
  aux.set(b);
  for (let r = 0; r < linhas; r++) {
    const o = r * ppl;
    for (let w = 0; w < ppl; w++) {
      const v = aux[o + w];
      let x = v | (v << 1) | (v >>> 1);
      if (w > 0) x |= aux[o + w - 1] >>> 31;
      if (w + 1 < ppl) x |= aux[o + w + 1] << 31;
      if (r > 0) x |= aux[o - ppl + w];
      if (r + 1 < linhas) x |= aux[o + ppl + w];
      b[o + w] = x;
    }
  }
}

/** Formata segundos como "2 h 05 min" ou "12 min 30 s". */
export function formatarTempo(s: number): string {
  s = Math.round(s);
  const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
  if (hh) return `${hh} h ${String(mm).padStart(2, "0")} min`;
  if (mm) return `${mm} min ${String(ss).padStart(2, "0")} s`;
  return `${ss} s`;
}
