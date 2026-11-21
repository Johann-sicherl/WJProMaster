// Gerador paramétrico da biblioteca de fixação: cada peça sai como um Documento WJCAD comum (esboços +
// extrusões/revoluções), regenerado pelo kernel. Convenção de posição (vale para todas as famílias, é o que
// a Montagem usa para encaixar):
//   · o EIXO da peça é o eixo Y; o plano XZ (y = 0) é o apoio: cabeça, porca e arruela ficam em y ≥ 0
//     e a haste desce em y ≤ 0 (a ponta fica em y = −comprimento); pinos e rebites sem cabeça: y ∈ [−L, 0].
//   · escareado: o topo da cabeça é o plano y = 0 (rente à superfície) e o cone desce.
// Puro (sem DOM): testado em scripts/teste-biblioteca.ts. Comportamento: docs/funcional/biblioteca.md.

import {
  documentoVazio, novaFeature, novoEsboco, type Documento, type Feature, type FeatureEsboco, type FeatureExtrusao, type FeatureRevolucao, type FeatureRosca,
  type Referencia,
} from "../model";
import * as op from "../esboco/operacoes";
import { diametroNominal, familiaPorId, PASSO_GROSSO, PASSOS_FINOS, type Cotas, type Familia } from "./dados";

export interface Pedido {
  familia: string;
  tam: string;
  /** só nas famílias com comprimento (mm) */
  comprimento?: number;
  /** passo fino (mm); ausente = passo grosso */
  passo?: number;
  /** rosca modelada de verdade (padrão: cosmética) */
  roscaReal?: boolean;
}

export interface Resultado {
  doc: Documento;
  familia: Familia;
  nome: string;
  descricao: string;
  /** diâmetro nominal (mm) e passo usado (0 = sem rosca) */
  d: number;
  passo: number;
}

/** raio do círculo que passa pelos vértices de um sextavado com largura entre faces s */
const raioVertice = (s: number) => s / Math.sqrt(3);

export const passoGrosso = (tam: string) => PASSO_GROSSO[tam] ?? 0;
export const passosFinos = (tam: string) => PASSOS_FINOS[tam] ?? [];

/** Nome padronizado: "Parafuso ISO 4762 M6x20", fino: "Parafuso ISO 4762 M8x1x30", sem comprimento: "Porca ISO 4032 M8". */
export function nomePadrao(f: Familia, tam: string, comprimento?: number, passo?: number): string {
  const fino = passo && passo !== passoGrosso(tam);
  const med = `${tam}${fino ? `x${num(passo!)}` : ""}${f.comprimento && comprimento !== undefined ? `x${num(comprimento)}` : ""}`;
  return `${f.nome} ${f.norma} ${med}`;
}
const num = (v: number) => String(Math.round(v * 1000) / 1000).replace(".", ",");

/** Descrição curta para a lista de materiais. */
export function descricaoDe(f: Familia, tam: string, comprimento?: number, passo?: number): string {
  const fino = passo && passo !== passoGrosso(tam);
  const base = `${f.nome} ${f.tipo.toLowerCase()} ${tam}${fino ? ` (passo fino ${num(passo!)})` : ""}`;
  return f.comprimento && comprimento !== undefined ? `${base}, comprimento ${num(comprimento)} mm, ${f.norma}` : `${base}, ${f.norma}`;
}

/** Comprimentos do padrão para o tamanho (a lista comercial entre o mínimo e o máximo). */
export function comprimentosDoPadrao(f: Familia, tam: string, lista: number[]): number[] {
  const t = f.tamanhos.find((x) => x.tam === tam);
  if (!t || t.lmin === undefined || t.lmax === undefined) return [];
  return lista.filter((l) => l >= t.lmin! && l <= t.lmax!);
}

// ---------- ferramentas de montagem das features ----------

class Construtor {
  features: Feature[] = [];
  private n = 0;
  private ne = 0;

  esboco(plano: "XY" | "XZ", deslocamento: number, desenhar: (e: FeatureEsboco) => void): FeatureEsboco {
    const e = novoEsboco(++this.ne, { tipo: "plano", plano, deslocamento });
    desenhar(e);
    this.features.push(e);
    return e;
  }

  /** Extrusão de um perfil no plano XZ a partir de y: para cima (+Y) ou, com `baixo`, para baixo. */
  extrusao(y: number, desenhar: (e: FeatureEsboco) => void, prof: number, o: { baixo?: boolean; cortar?: boolean; nome?: string } = {}) {
    const e = this.esboco("XZ", y, desenhar);
    const x = { ...(novaFeature("extrusao", ++this.n) as FeatureExtrusao), esboco: e.id, profundidade: prof, inverter: !!o.baixo, operacao: o.cortar ? "cortar" : "adicionar" } as FeatureExtrusao;
    if (o.nome) x.nome = o.nome;
    this.features.push(x);
    return x;
  }

  /** Extrusão (+Z) de um perfil no plano XY a partir de z (asas da porca borboleta). */
  extrusaoXY(z: number, desenhar: (e: FeatureEsboco) => void, prof: number, nome: string) {
    const e = this.esboco("XY", z, desenhar);
    const x = { ...(novaFeature("extrusao", ++this.n) as FeatureExtrusao), esboco: e.id, plano: "XY", profundidade: prof, nome } as FeatureExtrusao;
    this.features.push(x);
    return x;
  }

  /** Revolução de um perfil desenhado no plano XY (x = raio, y = eixo) em torno do eixo Y. */
  revolucao(desenhar: (e: FeatureEsboco) => void, o: { cortar?: boolean; nome?: string } = {}) {
    const e = this.esboco("XY", 0, desenhar);
    const r = {
      ...(novaFeature("revolucao", ++this.n) as FeatureRevolucao), esboco: e.id, plano: "XY", angulo: 360,
      eixo: { tipo: "eixo", id: "Y" } as Referencia, operacao: o.cortar ? "cortar" : "adicionar",
    } as FeatureRevolucao;
    if (o.nome) r.nome = o.nome;
    this.features.push(r);
    return r;
  }
}

type P2 = [number, number];

/** Polígono fechado por linhas retas (pontos em sequência). */
function poligonoFechado(e: FeatureEsboco, pts: P2[]) {
  const ids = pts.map(([x, y]) => op.ponto(e, { x, y }));
  for (let i = 0; i < ids.length; i++) op.linha(e, ids[i], ids[(i + 1) % ids.length]);
}

/** Sextavado no plano do esboço (centrado na origem), com largura entre faces `s`. */
function sextavado(e: FeatureEsboco, s: number, rotacaoGraus = 0) {
  const c = op.ponto(e, { x: 0, y: 0 });
  const R = raioVertice(s);
  const a = (rotacaoGraus * Math.PI) / 180;
  op.poligono(e, c, { x: R * Math.cos(a), y: R * Math.sin(a) }, 6, false);
  // o círculo de construção do polígono não entra no perfil (é construção)
}

function circuloCentro(e: FeatureEsboco, r: number) {
  op.circulo(e, op.ponto(e, { x: 0, y: 0 }), r);
}

/**
 * Perfil de revolução com trechos retos e arcos por 3 pontos: `seg` = [ponto, passagem?]; o trecho
 * entre o ponto anterior e este é um arco quando há passagem. Fecha no primeiro ponto (reta).
 */
function perfilComArcos(e: FeatureEsboco, seg: { p: P2; via?: P2 }[]) {
  const ids = seg.map((s) => op.ponto(e, { x: s.p[0], y: s.p[1] }));
  for (let i = 0; i < seg.length; i++) {
    const j = (i + 1) % seg.length;
    const via = j === 0 ? undefined : seg[j].via;
    if (via) op.arcoTresPontos(e, ids[i], ids[j], { x: via[0], y: via[1] });
    else op.linha(e, ids[i], ids[j]);
  }
}

/**
 * Calota esférica (cabeça abaulada) de raio de base `a` e altura `k`: arco de (a, y0) até x = xFim
 * (0 = o topo). Devolve um ponto no meio do arco (`via`) e a altura do fim (`fim`).
 */
function calota(a: number, k: number, y0: number, xFim = 0): { via: P2; fim: number } {
  const R = (a * a + k * k) / (2 * k);
  const cy = y0 + k - R;
  const a1 = Math.atan2(y0 - cy, a);
  const a2 = Math.acos(Math.min(1, xFim / R));
  const am = (a1 + a2) / 2;
  return { via: [R * Math.cos(am), cy + R * Math.sin(am)], fim: cy + R * Math.sin(a2) };
}
const viaDaCalota = (a: number, k: number, y0: number): P2 => calota(a, k, y0).via;

// ---------- construção por forma ----------

function haste(b: Construtor, d: number, L: number) {
  b.extrusao(0, (e) => circuloCentro(e, d / 2), L, { baixo: true, nome: "Haste" });
}

function construir(b: Construtor, f: Familia, c: Cotas, d: number, L: number, tam: string) {
  switch (f.forma) {
    case "sextavado": {
      b.extrusao(0, (e) => sextavado(e, c.s), c.k, { nome: "Cabeça" });
      haste(b, d, L);
      return;
    }
    case "allen": {
      b.extrusao(0, (e) => circuloCentro(e, c.dk / 2), c.k, { nome: "Cabeça" });
      haste(b, d, L);
      b.extrusao(c.k, (e) => sextavado(e, c.s), c.t, { baixo: true, cortar: true, nome: "Sextavado interno" });
      return;
    }
    case "escareado": {
      // topo em y = 0: cone de dk (em y = 0) até d (em y = −k), depois a haste até −L (L inclui a cabeça)
      b.revolucao((e) => poligonoFechado(e, [[0, 0], [c.dk / 2, 0], [d / 2, -c.k], [d / 2, -L], [0, -L]]), { nome: "Cabeça e haste" });
      b.extrusao(0, (e) => sextavado(e, c.s), c.t, { baixo: true, cortar: true, nome: "Sextavado interno" });
      return;
    }
    case "abaulado": {
      const a = c.dk / 2;
      b.revolucao((e) => perfilComArcos(e, [{ p: [0, 0] }, { p: [a, 0] }, { p: [0, c.k], via: viaDaCalota(a, c.k, 0) }]), { nome: "Cabeça" });
      haste(b, d, L);
      b.extrusao(c.k, (e) => sextavado(e, c.s), Math.min(c.t, c.k * 0.9), { baixo: true, cortar: true, nome: "Sextavado interno" });
      return;
    }
    case "prisioneiro": {
      haste(b, d, L);
      return;
    }
    case "semCabeca": {
      b.extrusao(0, (e) => circuloCentro(e, d / 2), L, { baixo: true, nome: "Corpo" });
      b.extrusao(0, (e) => sextavado(e, c.s), c.t, { baixo: true, cortar: true, nome: "Sextavado interno" });
      return;
    }
    case "porcaSextavada": {
      b.extrusao(0, (e) => sextavado(e, c.s), c.m, { nome: "Corpo" });
      b.extrusao(0, (e) => circuloCentro(e, furoDaPorca(d, tam) / 2), c.m, { cortar: true, nome: "Furo" });
      return;
    }
    case "porcaAutotravante": {
      const hx = c.m * 0.75;
      b.extrusao(0, (e) => sextavado(e, c.s), hx, { nome: "Corpo" });
      b.extrusao(hx, (e) => circuloCentro(e, c.s * 0.46), c.m - hx, { nome: "Anel de náilon" });
      b.extrusao(0, (e) => circuloCentro(e, furoDaPorca(d, tam) / 2), c.m, { cortar: true, nome: "Furo" });
      return;
    }
    case "porcaCastelo": {
      const hx = c.m * 0.6;
      b.extrusao(0, (e) => sextavado(e, c.s), hx, { nome: "Corpo" });
      b.extrusao(hx, (e) => circuloCentro(e, c.s * 0.5), c.m - hx, { nome: "Coroa" });
      for (let k = 0; k < 3; k++) {
        const a = (k * Math.PI) / 3, L2 = c.s;
        const ux = Math.cos(a), uy = Math.sin(a), vx = -uy, vy = ux, w = c.n / 2;
        b.extrusao(c.m, (e) => poligonoFechado(e, [
          [-ux * L2 + vx * w, -uy * L2 + vy * w], [ux * L2 + vx * w, uy * L2 + vy * w], [ux * L2 - vx * w, uy * L2 - vy * w], [-ux * L2 - vx * w, -uy * L2 - vy * w],
        ]), (c.m - hx) * 0.8, { baixo: true, cortar: true, nome: `Fenda ${k + 1}` });
      }
      b.extrusao(0, (e) => circuloCentro(e, furoDaPorca(d, tam) / 2), c.m, { cortar: true, nome: "Furo" });
      return;
    }
    case "porcaBorboleta": {
      b.extrusao(0, (e) => circuloCentro(e, c.dc / 2), c.hc, { nome: "Cubo" });
      const x0 = c.dc / 2 - 0.5, x1 = c.e / 2, esp = Math.max(1.5, d * 0.4);
      for (const lado of [1, -1]) {
        b.extrusaoXY(-esp / 2, (e) => poligonoFechado(e, [[lado * x0, 0], [lado * x1, 0], [lado * x1, c.h], [lado * (x1 - (x1 - x0) * 0.35), c.h], [lado * x0, c.hc]]), esp, `Asa ${lado > 0 ? 1 : 2}`);
      }
      b.extrusao(0, (e) => circuloCentro(e, furoDaPorca(d, tam) / 2), c.hc, { cortar: true, nome: "Furo" });
      return;
    }
    case "arruelaLisa": {
      anel(b, c.d1, c.d2, c.h);
      return;
    }
    case "arruelaPressao": {
      anel(b, c.d1, c.d2, c.s * 2);
      // fenda da mola
      b.extrusao(0, (e) => poligonoFechado(e, [[c.d1 / 2 - 0.5, -c.s * 0.25], [c.d2 / 2 + 0.5, -c.s * 0.25], [c.d2 / 2 + 0.5, c.s * 0.25], [c.d1 / 2 - 0.5, c.s * 0.25]]), c.s * 2, { cortar: true, nome: "Fenda" });
      return;
    }
    case "arruelaDentada": {
      anel(b, c.d1, c.d2, c.s);
      return;
    }
    case "rebiteRepuxo": {
      // um perfil só: corpo oco (furo f) com a cabeça abaulada de Ø dk
      const a = c.dk / 2, fr = c.f / 2, v = calota(a, c.k, 0, fr);
      b.revolucao((e) => perfilComArcos(e, [{ p: [fr, -L] }, { p: [d / 2, -L] }, { p: [d / 2, 0] }, { p: [a, 0] }, { p: [fr, v.fim], via: v.via }]), { nome: "Rebite" });
      return;
    }
    case "rebiteMacico": {
      const a = c.dk / 2;
      b.revolucao((e) => perfilComArcos(e, [{ p: [0, 0] }, { p: [a, 0] }, { p: [0, c.k], via: viaDaCalota(a, c.k, 0) }]), { nome: "Cabeça" });
      haste(b, d, L);
      return;
    }
    case "pinoElastico": {
      b.revolucao((e) => poligonoFechado(e, [[d / 2 - c.s, 0], [d / 2, 0], [d / 2, -L], [d / 2 - c.s, -L]]), { nome: "Tubo" });
      b.extrusao(0, (e) => poligonoFechado(e, [[d / 2 - c.s - 0.1, -0.15], [d / 2 + 0.1, -0.15], [d / 2 + 0.1, 0.15], [d / 2 - c.s - 0.1, 0.15]]), L, { baixo: true, cortar: true, nome: "Fenda" });
      return;
    }
    case "pinoCilindrico": {
      b.extrusao(0, (e) => circuloCentro(e, d / 2), L, { baixo: true, nome: "Pino" });
      return;
    }
  }
}

/** Furo da porca = diâmetro menor da rosca (D1 = d − 1,0825 P). */
function furoDaPorca(d: number, tam: string, passo = passoGrosso(tam)): number {
  return d - 1.0825 * passo;
}

function anel(b: Construtor, d1: number, d2: number, h: number) {
  b.revolucao((e) => poligonoFechado(e, [[d1 / 2, 0], [d2 / 2, 0], [d2 / 2, h], [d1 / 2, h]]), { nome: "Anel" });
}

/** Altura acima do plano de apoio (y = 0): o que o próximo item da pilha (porca sobre arruela, arruela sobre porca…) precisa pular. */
export function alturaDeApoio(f: Familia, c: Cotas): number {
  switch (f.forma) {
    case "sextavado": case "allen": case "abaulado": case "rebiteMacico": case "rebiteRepuxo": return c.k;
    case "porcaSextavada": case "porcaAutotravante": case "porcaCastelo": return c.m;
    case "porcaBorboleta": return c.h;
    case "arruelaLisa": return c.h;
    case "arruelaPressao": return c.s * 2;
    case "arruelaDentada": return c.s;
    default: return 0;
  }
}

// ---------- API ----------

/** Gera a peça (documento WJCAD). Dá erro com mensagem clara se o pedido não existe na tabela. */
export function gerarPeca(p: Pedido): Resultado {
  const f = familiaPorId(p.familia);
  if (!f) throw new Error(`Família desconhecida: ${p.familia}.`);
  const t = f.tamanhos.find((x) => x.tam === p.tam);
  if (!t) throw new Error(`${f.nome} ${f.norma}: o tamanho ${p.tam} não existe na norma.`);
  let L = p.comprimento;
  if (f.comprimento) {
    if (!(L !== undefined && L > 0)) throw new Error(`${f.nome} ${f.norma}: informe o comprimento.`);
    if (t.lmin !== undefined && t.lmax !== undefined && (L < t.lmin || L > t.lmax)) {
      throw new Error(`${f.nome} ${f.norma} ${p.tam}: comprimento de ${num(t.lmin)} a ${num(t.lmax)} mm no padrão.`);
    }
  }
  const d = diametroNominal(p.tam);
  const passo = f.roscado ? p.passo ?? passoGrosso(p.tam) : 0;
  const b = new Construtor();
  construir(b, f, t.cotas, d, L ?? 0, p.tam);
  const roscaReal = !!p.roscaReal && suportaRoscaReal(f);
  if (roscaReal) acrescentarRoscaReal(b, f, t.cotas, d, L ?? 0, passo);
  const nome = nomePadrao(f, p.tam, L, passo || undefined);
  const doc: Documento = { ...documentoVazio(), nome, features: b.features, material: f.material };
  const descricao = descricaoDe(f, p.tam, L, passo || undefined);
  doc.propriedades = {
    norma: f.norma, descricao, material: f.material, tamanho: p.tam, ...(L !== undefined && f.comprimento ? { comprimento: String(L) } : {}),
    ...(passo ? { passo: String(passo), rosca: roscaReal ? "real" : "cosmética" } : {}), conferencia: f.conferencia,
    apoio: String(alturaDeApoio(f, t.cotas)), grupo: f.grupo, biblioteca: f.id,
  };
  return { doc, familia: f, nome, descricao, d, passo };
}

/** Rosca modelada só nos parafusos com haste externa (nas porcas a rosca fica cosmética). */
export const suportaRoscaReal = (f: Familia) => ["sextavado", "allen", "escareado", "abaulado", "prisioneiro", "semCabeca"].includes(f.forma);

/**
 * Rosca modelada (recurso "rosca": sulco ISO em V na haste). A face da haste é descrita pela geometria
 * (cilindro de Ø d do eixo Y) — não precisa regenerar a peça antes. Rosca total nos parafusos de rosca
 * total (ISO 4017, prisioneiro, sem cabeça); nos demais, comprimento de rosca b = 2d + 6 (ISO 888).
 */
function acrescentarRoscaReal(b: Construtor, f: Familia, c: Cotas, d: number, L: number, passo: number) {
  const topoHaste = f.forma === "escareado" ? -c.k : 0;
  const haste = L + topoHaste; // comprimento livre da haste
  const total = ["sextavado", "prisioneiro", "semCabeca"].includes(f.forma);
  const rosca = total ? haste : Math.min(haste, 2 * d + 6);
  const r = d / 2;
  const face: Referencia = { tipo: "face", ass: { geom: "cilindro", centro: [0, topoHaste - haste / 2, 0], area: 2 * Math.PI * r * haste, eixo: [0, 1, 0], pontoEixo: [0, 0, 0], raio: r } };
  b.features.push({ ...(novaFeature("rosca", 1) as FeatureRosca), face, tamanho: `M${String(d).replace(".", ",")}`, passo, comprimento: rosca, esquerda: false, inverter: false } as FeatureRosca);
}

/** Propriedades de massa para a lista de materiais: g a partir do volume (mm³) e do material. */
export function massaEmGramas(volumeMm3: number, densidadeGcm3: number): number {
  return (volumeMm3 * densidadeGcm3) / 1000;
}

