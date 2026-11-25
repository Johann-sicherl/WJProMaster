// WJGoldDiamond: gemas livres (J9a). Qualquer lapidação da biblioteca num ponto livre da joia:
// posição (θ ao longo do aro, lateral, altura da cintura sobre o aro ou relativa à cintura da gema
// central), orientação (giro no plano, inclinação, seguir a superfície), engaste próprio (garras
// com ponta bolinha/alongada/dupla, garras em V nas pontas da navete/gota/coração, ou inglesa) e
// simetria por gema. As hastes das garras descem até o apoio mais próximo (aro, ramo do aro
// dividido, fio de ornamento ou garra da gema central). Puro: interface, worker e testes em Node.
// Referencial local da gema: comprimento em x, coroa para +y, lateral em −z (como no resto).

import { contorno, dentroDoAro, LAPIDACOES, proporcoes, quilates, raioNaDirecao, ramo, secao, superficie, type DocJoia, type Gema, type GemaPosta, type Haste, type Lapidacao, type Montagem, type P2, type Referencial, type V3 } from "./regras";
import type { Simetria } from "./ornamento";

export type RefAltura = "aro" | "central";
export type PontaGarra = "bolinha" | "alongada" | "dupla";

export interface GemaLivre {
  id: string;
  nome: string;
  ativo: boolean;
  gema: Gema;
  /** posição: θ ao longo do aro (°, 0 = topo), lateral (mm, ao longo do dedo), altura da cintura (mm) */
  th: number;
  z: number;
  altura: number;
  /** "aro": altura sobre a superfície do aro; "central": relativa à cintura da gema central */
  refAltura: RefAltura;
  /** giro no plano (°; 0 = eixo longo ao longo do aro, 90 = ao longo do dedo) */
  giro: number;
  /** inclinação em torno do eixo curto (°; positivo baixa a ponta da frente) */
  inclinacao: number;
  /** eixo da gema na normal da superfície do aro (senão, de pé como a gema central) */
  seguir: boolean;
  engaste: "garras" | "inglesa";
  garras: number;
  diamGarra: number;
  pontaGarra: PontaGarra;
  /** garras em V protegendo as pontas (navete, gota, coração) */
  pontasV: boolean;
  /** garras laterais junto com as garras em V (0, 2 ou 4) */
  laterais: number;
  /** parede da inglesa (mm) */
  parede: number;
  simetria: Simetria;
}

/**
 * Gema livre posta (uma por cópia da simetria). Hastes = cápsulas (esfera nas duas pontas); nas juntas os
 * raios diferem um pouco (esferas concêntricas iguais seriam faces coincidentes na booleana).
 */
export interface LivrePosta {
  id: string;
  nome: string;
  copia: number;
  gema: GemaPosta;
  hastes: Haste[];
  tubo?: { yBase: number; yTopo: number; escala: number; escalaFuro: number };
  /** maior distância (mm) de uma haste até o apoio */
  folga: number;
}

type M3 = number[];
const RAD = Math.PI / 180;
/** Folga máxima (mm) entre a garra e o apoio sem aviso. */
export const APOIO_MAX = 1.5;
/** Pontas das lapidações pontudas (graus a partir do comprimento). */
const PONTAS: Partial<Record<Lapidacao, number[]>> = { navete: [0, 180], gota: [0], coracao: [0] };
export const temPontas = (l: Lapidacao) => !!PONTAS[l];

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const soma = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const comp = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: V3): V3 => mul(a, 1 / (comp(a) || 1));
const cruz = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
/** Matriz 3×3 (linhas) a partir das colunas. */
const colunas = (x: V3, y: V3, z: V3): M3 => [x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]];
const mm = (A: M3, B: M3): M3 => {
  const C = new Array(9).fill(0);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) C[3 * i + j] += A[3 * i + k] * B[3 * k + j];
  return C;
};
export const aplicar = (M: M3, v: V3): V3 => [M[0] * v[0] + M[1] * v[1] + M[2] * v[2], M[3] * v[0] + M[4] * v[1] + M[5] * v[2], M[6] * v[0] + M[7] * v[1] + M[8] * v[2]];
const transposta = (M: M3): M3 => [M[0], M[3], M[6], M[1], M[4], M[7], M[2], M[5], M[8]];
const rotY = (g: number): M3 => { const c = Math.cos(g), s = Math.sin(g); return [c, 0, s, 0, 1, 0, -s, 0, c]; };
const rotZ = (g: number): M3 => { const c = Math.cos(g), s = Math.sin(g); return [c, -s, 0, s, c, 0, 0, 0, 1]; };
const diag = (a: number, b: number, c: number): M3 => [a, 0, 0, 0, b, 0, 0, 0, c];

/** Rotação do referencial de uma gema posta (matriz própria ou giro em Y seguido de Z). */
export function matrizRef(r: Referencial): M3 {
  return r.m ?? mm(rotZ(r.rz), rotY(r.ry));
}
/** Ponto local da gema → mundo. */
export const noMundo = (r: Referencial, l: V3): V3 => soma(r.p, aplicar(matrizRef(r), l));
/** Ponto do mundo → local da gema. */
export const noLocal = (r: Referencial, w: V3): V3 => aplicar(transposta(matrizRef(r)), sub(w, r.p));

/** Eixo e ângulo (graus) da rotação (para girar sólidos no kernel). */
export function eixoAngulo(M: M3): { eixo: V3; graus: number } {
  const tr = M[0] + M[4] + M[8];
  const c = Math.min(1, Math.max(-1, (tr - 1) / 2));
  const ang = Math.acos(c);
  if (ang < 1e-9) return { eixo: [0, 0, 1], graus: 0 };
  let eixo: V3 = [M[7] - M[5], M[2] - M[6], M[3] - M[1]];
  if (comp(eixo) < 1e-6) {
    // 180°: eixo pela diagonal de (M + I)/2
    const xx = Math.sqrt(Math.max(0, (M[0] + 1) / 2)), yy = Math.sqrt(Math.max(0, (M[4] + 1) / 2)), zz = Math.sqrt(Math.max(0, (M[8] + 1) / 2));
    eixo = xx >= yy && xx >= zz ? [xx, M[1] / (2 * xx), M[2] / (2 * xx)] : yy >= zz ? [M[1] / (2 * yy), yy, M[5] / (2 * yy)] : [M[2] / (2 * zz), M[5] / (2 * zz), zz];
  }
  return { eixo: unit(eixo), graus: ang / RAD };
}

export function gemaLivreNova(id: string, n: number, lap: Lapidacao = "navete"): GemaLivre {
  const L = LAPIDACOES[lap];
  const w = lap === "redonda" ? 1.5 : 1;
  return {
    id, nome: `Gema ${n}`, ativo: true, gema: { lapidacao: lap, material: "diamante", comprimento: Math.round(w * L.relacao * 100) / 100, largura: w },
    th: 25, z: 0, altura: 0.3, refAltura: "aro", giro: 0, inclinacao: 0, seguir: true,
    engaste: "garras", garras: temPontas(lap) ? 4 : L.garras, diamGarra: 0.6, pontaGarra: "bolinha", pontasV: temPontas(lap), laterais: 0, parede: 0.5, simetria: "nenhuma",
  };
}

// ---------------------------------------------------------------------------------------------
// lugar e orientação

const espelhos: Record<Simetria, [number, number][]> = { nenhuma: [[1, 1]], x: [[1, 1], [-1, 1]], y: [[1, 1], [1, -1]], xy: [[1, 1], [-1, 1], [1, -1], [-1, -1]] };

/** Normal da superfície externa do aro em (θ, v): radial inclinada pela declividade do perfil. */
function normalAro(a: DocJoia["aro"], th: number, v: number): V3 {
  const h = secao(a, th).w / 2, e = 0.02;
  const v0 = Math.max(-h + e, Math.min(h - e, v));
  const du = (superficie(a, th, v0 + e) - superficie(a, th, v0 - e)) / (2 * e);
  const N: V3 = [Math.sin(th), Math.cos(th), 0];
  return unit(sub(N, [0, 0, du]));
}

/** Centro (cintura) e rotação da gema livre sem simetria. `yCentral` = altura da cintura da central. */
export function lugarLivre(d: DocJoia, R: number, g: GemaLivre, yCentral: number | null): { p: V3; M: M3 } {
  const a = d.aro, th = g.th * RAD;
  let B: M3;
  if (g.seguir) {
    const T: V3 = [Math.cos(th), -Math.sin(th), 0];
    const n = normalAro(a, th, g.z);
    B = colunas(T, n, cruz(T, n));
  } else B = diag(1, 1, 1);
  const M = mm(B, mm(rotY(g.giro * RAD), rotZ(-g.inclinacao * RAD)));
  let p: V3;
  if (g.refAltura === "central" && yCentral !== null && Math.abs(g.th) <= 75) {
    const Y = yCentral + g.altura;
    p = [Y * Math.tan(th), Y, g.z];
  } else {
    const h = secao(a, th).w / 2;
    const r = R + superficie(a, th, Math.max(-h, Math.min(h, g.z))) + g.altura;
    p = [r * Math.sin(th), r * Math.cos(th), g.z];
  }
  return { p, M };
}

// ---------------------------------------------------------------------------------------------
// apoio das hastes

interface Apoio { ponto: V3; folga: number }

function pontoNoSegmento(q: V3, a: V3, b: V3): V3 {
  const ab = sub(b, a), L2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2;
  const t = L2 > 1e-12 ? Math.max(0, Math.min(1, ((q[0] - a[0]) * ab[0] + (q[1] - a[1]) * ab[1] + (q[2] - a[2]) * ab[2]) / L2)) : 0;
  return soma(a, mul(ab, t));
}

/** Apoio mais próximo de q: superfície do aro (fora do vão do aro dividido), fios de ornamento e garras da central. */
export function apoioMaisProximo(d: DocJoia, m: Montagem, q: V3): Apoio {
  const a = d.aro, R = m.R;
  const th = Math.atan2(q[0], q[1]);
  const h = secao(a, th).w / 2;
  // ponto do topo do aro mais perto: z no mundo e v no referencial do aro inteiro (o ramo é o aro deslocado)
  let z = Math.max(-h + 0.15, Math.min(h - 0.15, q[2])), v = z;
  const rm = ramo(a, th);
  if (rm) {
    const sg = q[2] < 0 ? -1 : 1, lim = Math.max(0, rm.meia - 0.12);
    const dz = Math.max(-lim, Math.min(lim, Math.abs(q[2]) - rm.centro));
    z = sg * (rm.centro + dz);
    v = sg * ((rm.hw + h) / 2 + dz);
  }
  const rs = R + superficie(a, th, v);
  const s: V3 = [rs * Math.sin(th), rs * Math.cos(th), z];
  const fundo = Math.min(0.25, secao(a, th).t / 3);
  let melhor: Apoio = { ponto: [(rs - fundo) * Math.sin(th), (rs - fundo) * Math.cos(th), z], folga: dentroDoAro(a, R, q) ? 0 : comp(sub(q, s)) };
  for (const f of m.orn.fios)
    for (let i = 0; i < f.pts.length; i++) {
      const folga = Math.max(0, comp(sub(q, f.pts[i])) - f.raios[i]);
      if (folga < melhor.folga) melhor = { ponto: f.pts[i], folga };
    }
  // folhas (J9b): a chapa é apoio (folha com pedra: as garras descem na folha)
  for (const fl of m.folhas)
    for (const p of fl.apoios) {
      const folga = Math.max(0, comp(sub(q, p)) - fl.e / 2);
      if (folga < melhor.folga) melhor = { ponto: p, folga };
    }
  for (const g of m.garras) {
    const c = pontoNoSegmento(q, g.base, g.topo);
    const folga = Math.max(0, comp(sub(q, c)) - g.r);
    if (folga < melhor.folga) melhor = { ponto: c, folga };
  }
  return melhor;
}

// ---------------------------------------------------------------------------------------------
// engaste (no local da gema, depois levado ao mundo)

/** Ângulos (graus) das garras laterais entre as pontas. */
function angulosLaterais(pontas: number[], n: number): number[] {
  if (n <= 0) return [];
  if (pontas.length === 2) {
    const k = Math.max(1, Math.round(n / 2));
    const lado = Array.from({ length: k }, (_, j) => (180 * (j + 1)) / (k + 1));
    return [...lado, ...lado.map((x) => 360 - x)];
  }
  return Array.from({ length: n }, (_, j) => pontas[0] + (360 * (j + 1)) / (n + 1));
}

function engaste(d: DocJoia, m: Montagem, g: GemaLivre, ref: Referencial): Omit<LivrePosta, "id" | "nome" | "copia" | "gema"> {
  const gm = g.gema, pr = proporcoes(gm), cont = contorno(gm.lapidacao, gm.comprimento, gm.largura);
  const hastes: Haste[] = [];
  let folga = 0;
  const W = (l: V3) => noMundo(ref, l);
  /** haste do joelho até o apoio mais próximo (raio 4 % maior: a esfera do joelho não coincide com a de cima) */
  const desce = (kLocal: V3, r: number) => {
    const k = W(kLocal);
    const ap = apoioMaisProximo(d, m, k);
    folga = Math.max(folga, ap.folga);
    hastes.push({ base: ap.ponto, topo: k, r: r * 1.04 });
  };
  const dirL = (phi: number, r: number, y: number): V3 => [Math.cos(phi) * r, y, -Math.sin(phi) * r];
  const pontoCont = (phi: number): P2 => { const r = raioNaDirecao(cont, phi); return [Math.cos(phi) * r, Math.sin(phi) * r]; };
  if (g.engaste === "inglesa") {
    const rMed = Math.min(gm.comprimento, gm.largura) / 2;
    const tubo = { yBase: -pr.pavilhao * 0.75, yTopo: pr.cintura + pr.coroa * 0.4, escala: 1 + g.parede / rMed, escalaFuro: 0.8 };
    desce([0, tubo.yBase + 0.1, 0], Math.max(0.3, g.parede * 0.8));
    return { hastes, tubo, folga };
  }
  const dg = g.diamGarra, r = dg / 2;
  const yTopo = pr.cintura + pr.coroa * 0.55, yJoelho = -pr.pavilhao * 0.3, kPav = 1 - 0.3 * (1 - pr.culaca);
  const garra = (phi: number) => {
    const rc = raioNaDirecao(cont, phi);
    const lados = g.pontaGarra === "dupla" ? [-0.6 * dg, 0.6 * dg] : [0];
    for (const dl of lados) {
      const off: V3 = [-Math.sin(phi) * dl, 0, -Math.cos(phi) * dl];
      const topo = soma(dirL(phi, rc + dg * 0.25, yTopo), off);
      const joelho = soma(dirL(phi, rc * kPav + dg * 0.3, yJoelho), off);
      hastes.push({ base: W(joelho), topo: W(topo), r });
      if (g.pontaGarra === "alongada") {
        const p0 = soma(dirL(phi, rc + dg * 0.55, yTopo + dg * 0.1), off), p1 = soma(dirL(phi, rc - dg * 0.45, yTopo + dg * 0.1), off);
        hastes.push({ base: W(p0), topo: W(p1), r: dg * 0.48 });
      }
      desce(joelho, r);
    }
  };
  const pontas = g.pontasV ? PONTAS[gm.lapidacao] : undefined;
  if (pontas) {
    for (const pt of pontas) {
      const ph = pt * RAD;
      const T0 = pontoCont(ph);
      // flancos: pontos do contorno a ~0,9·Ø da ponta, dos dois lados (o V abraça a ponta)
      let dl = 2 * RAD;
      while (dl < 80 * RAD && Math.hypot(pontoCont(ph + dl)[0] - T0[0], pontoCont(ph + dl)[1] - T0[1]) < 0.9 * dg) dl += RAD;
      const dir: P2 = [Math.cos(ph), Math.sin(ph)];
      const apice: V3 = [T0[0] + dir[0] * dg * 0.45, yTopo - dg * 0.15, -(T0[1] + dir[1] * dg * 0.45)];
      for (const s of [-1, 1]) {
        const F = pontoCont(ph + s * dl), nF = Math.hypot(F[0], F[1]) || 1;
        const flanco: V3 = [F[0] + (F[0] / nF) * dg * 0.25, yTopo, -(F[1] + (F[1] / nF) * dg * 0.25)];
        // braços do V com raios um pouco diferentes (as esferas do ápice não coincidem; nunca abaixo do Ø pedido)
        hastes.push({ base: W(apice), topo: W(flanco), r: r * (s < 0 ? 1.02 : 1.06) });
      }
      const rp = Math.hypot(T0[0], T0[1]);
      const joelho: V3 = [dir[0] * (rp * kPav + dg * 0.3), yJoelho, -dir[1] * (rp * kPav + dg * 0.3)];
      hastes.push({ base: W(joelho), topo: W(apice), r });
      desce(joelho, r);
    }
    for (const a of angulosLaterais(pontas, Math.round(g.laterais))) garra(a * RAD);
  } else {
    const n = Math.max(2, Math.round(g.garras)), a0 = LAPIDACOES[gm.lapidacao].anguloGarra;
    for (let k = 0; k < n; k++) garra((a0 + (360 * k) / n) * RAD);
  }
  return { hastes, folga };
}

// ---------------------------------------------------------------------------------------------
// colisões

/** Ponto do mundo dentro do volume (aproximado) da gema posta. */
export function dentroDaGema(g: GemaPosta, q: V3, folga = 0): boolean {
  const pr = proporcoes(g.gema);
  const l = noLocal(g.ref, q);
  if (l[1] < -pr.pavilhao * 0.7 || l[1] > pr.cintura + pr.coroa * 0.5) return false;
  const s = (l[1] < 0 ? 1 - (-l[1] / pr.pavilhao) * (1 - pr.culaca) : 1) + folga / Math.max(0.3, Math.min(g.gema.comprimento, g.gema.largura) / 2);
  const x = l[0] / s, y = -l[2] / s;
  const cont = contorno(g.gema.lapidacao, g.gema.comprimento, g.gema.largura, 32);
  let dentro = false;
  for (let i = 0, j = cont.length - 1; i < cont.length; j = i++) {
    const [xi, yi] = cont[i], [xj, yj] = cont[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) dentro = !dentro;
  }
  return dentro;
}

/** Pontos de amostra da gema (cintura e centro) no mundo. */
function amostras(g: GemaPosta): V3[] {
  const pr = proporcoes(g.gema);
  const pts = contorno(g.gema.lapidacao, g.gema.comprimento, g.gema.largura, 24).map(([x, y]) => noMundo(g.ref, [x * 0.97, pr.cintura / 2, -y * 0.97]));
  pts.push(noMundo(g.ref, [0, pr.cintura / 2, 0]), noMundo(g.ref, [0, -pr.pavilhao * 0.4, 0]));
  return pts;
}

export const gemasColidem = (a: GemaPosta, b: GemaPosta) => amostras(a).some((q) => dentroDaGema(b, q)) || amostras(b).some((q) => dentroDaGema(a, q));

/** Distância do segmento ao ponto. */
const distSeg = (q: V3, h: Haste) => comp(sub(q, pontoNoSegmento(q, h.base, h.topo)));

// ---------------------------------------------------------------------------------------------
// montagem

/** Põe as gemas livres (com as cópias da simetria), garras, apoios e avisos na montagem. */
export function posicionarLivres(d: DocJoia, m: Montagem) {
  if (!d.gemasLivresAtivo) return;
  const yCentral = m.cabeca ? m.cabeca.ref.p[1] : null;
  for (const g of d.gemasLivres) {
    if (!g.ativo) continue;
    const { p, M } = lugarLivre(d, m.R, g, yCentral);
    const feitos: V3[] = [];
    let copia = 0, folga = 0;
    for (const [sx, sz] of espelhos[g.simetria]) {
      const p2: V3 = [p[0] * sx, p[1], p[2] * sz];
      if (feitos.some((q) => comp(sub(q, p2)) < 1e-3)) continue;
      feitos.push(p2);
      const S = diag(sx, 1, sz);
      // reflexão: S·M·(lateral invertida) continua sendo rotação (as lapidações são simétricas no eixo lateral)
      const M2 = sx * sz < 0 ? mm(mm(S, M), diag(1, 1, -1)) : mm(S, M);
      const gp: GemaPosta = { gema: g.gema, ref: { p: p2, rz: 0, ry: 0, m: M2 }, passagem: g.engaste === "garras" ? "coroa" : "reta", ct: quilates(g.gema) };
      const e = engaste(d, m, g, gp.ref);
      folga = Math.max(folga, e.folga);
      m.livres.push({ id: g.id, nome: g.nome, copia: copia++, gema: gp, ...e });
      // gema enterrada no aro
      if (dentroDoAro(d.aro, m.R, p2)) m.avisos.push(`${g.nome}: a cintura fica dentro do aro (suba a altura).`);
    }
    if (folga > 3 * APOIO_MAX) m.avisos.push(`${g.nome}: gema fora do metal (apoio mais próximo a ${folga.toFixed(1)} mm); aproxime do aro ou de um fio.`);
    else if (folga > APOIO_MAX) m.avisos.push(`${g.nome}: garra sem apoio a até ${APOIO_MAX.toLocaleString("pt-BR")} mm (falta ${folga.toFixed(2).replace(".", ",")} mm até o aro ou um fio).`);
  }
  // colisões: gema × gema (livres, central, pavé, pedrinhas) e gema × garra da central
  const outras: { nome: string; g: GemaPosta }[] = [
    ...(m.cabeca ? [{ nome: "gema central", g: m.cabeca }] : []),
    ...m.pave.map((g) => ({ nome: "pavé", g })),
    ...m.gemasOrn.map((x) => ({ nome: "pedrinha do ornamento", g: x.gema })),
  ];
  const ja = new Set<string>();
  const avisar = (t: string) => { if (!ja.has(t)) { ja.add(t); m.avisos.push(t); } };
  m.livres.forEach((a, i) => {
    for (const o of outras) if (gemasColidem(a.gema, o.g)) avisar(`${a.nome} colide com a ${o.nome}.`);
    for (const b of m.livres.slice(i + 1)) if (gemasColidem(a.gema, b.gema)) avisar(a.id === b.id ? `${a.nome} colide com a própria cópia da simetria.` : `${a.nome} colide com ${b.nome}.`);
    const pts = amostras(a.gema);
    if (m.garras.some((h) => pts.some((q) => distSeg(q, h) < h.r - 0.02))) avisar(`${a.nome} colide com uma garra da gema central.`);
  });
}

/** Zonas ocupadas pelas gemas livres (centro θ e meia abertura, graus) para ocar e texturas. */
export function zonasLivres(m: Montagem): [number, number][] {
  return m.livres.map((l) => {
    const p = l.gema.ref.p, r = Math.hypot(p[0], p[1]) || 1;
    return [Math.atan2(p[0], p[1]) / RAD, ((Math.max(l.gema.gema.comprimento, l.gema.gema.largura) / 2 + 1) / r) / RAD] as [number, number];
  });
}

/** Valida uma gema livre lida do arquivo (campos fora da faixa voltam ao limite). */
export function validarLivre(x: any, i: number, gema: (v: unknown, p: Gema) => Gema): GemaLivre {
  const n = gemaLivreNova(typeof x?.id === "string" ? x.id : `g${i}`, i + 1, x?.gema?.lapidacao in LAPIDACOES ? x.gema.lapidacao : "navete");
  const num = (v: unknown, p: number, a: number, b: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(b, Math.max(a, v)) : p);
  const um = <T extends string>(v: unknown, ops: readonly T[], p: T): T => (ops.includes(v as T) ? (v as T) : p);
  const g = gema(x?.gema, n.gema);
  if (g.lapidacao === "redonda") g.comprimento = g.largura;
  return {
    id: n.id, nome: typeof x?.nome === "string" && x.nome.trim() ? x.nome.slice(0, 40) : n.nome, ativo: x?.ativo !== false, gema: g,
    th: num(x?.th, n.th, -180, 180), z: num(x?.z, 0, -20, 20), altura: num(x?.altura, n.altura, -10, 15), refAltura: um(x?.refAltura, ["aro", "central"] as const, "aro"),
    giro: num(x?.giro, 0, -360, 360), inclinacao: num(x?.inclinacao, 0, -90, 90), seguir: x?.seguir !== false,
    engaste: um(x?.engaste, ["garras", "inglesa"] as const, "garras"), garras: Math.round(num(x?.garras, n.garras, 2, 8)), diamGarra: num(x?.diamGarra, n.diamGarra, 0.3, 3),
    pontaGarra: um(x?.pontaGarra, ["bolinha", "alongada", "dupla"] as const, "bolinha"), pontasV: typeof x?.pontasV === "boolean" ? x.pontasV && temPontas(g.lapidacao) : temPontas(g.lapidacao),
    laterais: Math.round(num(x?.laterais, 0, 0, 4)), parede: num(x?.parede, 0.5, 0.2, 3), simetria: um(x?.simetria, ["nenhuma", "x", "y", "xy"] as const, "nenhuma"),
  };
}
