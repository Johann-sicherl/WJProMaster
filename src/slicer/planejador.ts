// WJSlicer3D: planejador de movimento (código próprio) — o tempo que a máquina leva para cumprir o
// caminho da ferramenta, como o firmware: cada movimento é um trapézio de velocidade (acelera, anda,
// freia) com a aceleração do recurso; nas junções a velocidade fica limitada pelo jerk de cada eixo
// (mudança instantânea de velocidade permitida) e pelas passadas para trás e para a frente (frear a
// tempo para o próximo canto). Retração, levantamento do Z e trocas de camada param a máquina.
// No fim da camada, o tempo mínimo de camada do material desacelera a extrusão para resfriar.
// Puro: testado em scripts/teste-slicer.ts.

export type Parte =
  | "paredeExt" | "paredeInt" | "solido" | "topo" | "ponte" | "esparso" | "suporte" | "interface" | "borda" | "troca" | "torre" | "deslocamento" | "resfriamento";
export const PARTES: Parte[] = ["paredeExt", "paredeInt", "solido", "topo", "ponte", "esparso", "suporte", "interface", "borda", "troca", "torre", "deslocamento", "resfriamento"];
export const NOMES_PARTES: Record<Parte, string> = {
  paredeExt: "Parede externa", paredeInt: "Paredes internas", solido: "Preenchimento sólido", topo: "Superfície de topo", ponte: "Pontes (sobre o vazio)",
  esparso: "Preenchimento esparso", suporte: "Suporte", interface: "Interface do suporte", borda: "Borda e saia", troca: "Trocas de cor (tempo e purga)", torre: "Torre de purga",
  deslocamento: "Deslocamentos, retrações e trocas de camada", resfriamento: "Desaceleração para resfriar",
};
const IDX = Object.fromEntries(PARTES.map((p, i) => [p, i])) as Record<Parte, number>;

/**
 * Tempo para percorrer `L` mm entrando a `v0` e saindo a `v1`, com velocidade de cruzeiro `v` e
 * aceleração `a` (trapézio; triângulo quando a linha é curta). `a2d` (firmware Klipper): pseudo-
 * aceleração "acelerar até desacelerar" que limita o pico de velocidade das linhas curtas.
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

/** Velocidade máxima de passagem entre as direções (ux, uy) e (wx, wy) com jerk `j` por eixo. */
export function velJuncao(ux: number, uy: number, wx: number, wy: number, j: number): number {
  const m = Math.max(Math.abs(wx - ux), Math.abs(wy - uy));
  return m < 1e-9 ? Infinity : j / m;
}

export interface LimitesMaquina {
  aMax: number;
  vMax: number;
  jerk: number;
  /** fração "acelerar até desacelerar" (Klipper); 0 = não */
  aceleraDesacelera: number;
}

class Vetor {
  d = new Float64Array(1024);
  n = 0;
  push(x: number) {
    if (this.n === this.d.length) {
      const nd = new Float64Array(this.d.length * 2);
      nd.set(this.d);
      this.d = nd;
    }
    this.d[this.n++] = x;
  }
}

export class Planejador {
  /** tempo (s) e volume (mm³) acumulados por parte em toda a impressão */
  readonly tempo = new Float64Array(PARTES.length);
  readonly volume = new Float64Array(PARTES.length);
  /** tempo de cada camada (s), já com a desaceleração para resfriar */
  readonly tempoCamadas: number[] = [];
  x = 0;
  y = 0;
  // movimentos do bloco atual (entre paradas)
  private L = new Vetor();
  private ux = new Vetor();
  private uy = new Vetor();
  private v = new Vetor();
  private a = new Vetor();
  private j = new Vetor();
  private p = new Vetor();
  // camada atual: tempo por parte e extrusões (tempo e velocidade) para o tempo mínimo de camada
  private camada = new Float64Array(PARTES.length);
  private tExt = new Vetor();
  private vExt = new Vetor();

  constructor(private lim: LimitesMaquina) {}

  /** Põe o bico em (x, y) sem gastar tempo (início da impressão). */
  posicionar(x: number, y: number) {
    this.x = x;
    this.y = y;
  }

  /**
   * Movimento em linha reta até (x, y) com velocidade `v`, aceleração `a` e jerk `j` (0 = o da
   * máquina), atribuído à parte `parte`; `vol` = material extrudado (mm³; 0 = deslocamento).
   */
  mover(x: number, y: number, v: number, a: number, j: number, parte: Parte, vol: number) {
    const dx = x - this.x, dy = y - this.y, L = Math.hypot(dx, dy);
    if (L < 1e-6) return;
    this.L.push(L);
    this.ux.push(dx / L);
    this.uy.push(dy / L);
    this.v.push(Math.min(v, this.lim.vMax));
    this.a.push(Math.min(a, this.lim.aMax));
    this.j.push(j > 0 ? j : this.lim.jerk);
    this.p.push(IDX[parte]);
    this.x = x;
    this.y = y;
    if (vol > 0) this.volume[IDX[parte]] += vol;
  }

  /** Parada com tempo próprio (retração, levantamento do Z, troca de camada): fecha o bloco. */
  parar(t: number, parte: Parte = "deslocamento") {
    this.planejar();
    this.camada[IDX[parte]] += t;
  }

  /** Planeja o bloco atual: velocidades de junção, passadas para trás e para a frente, trapézios. */
  private planejar() {
    const n = this.L.n;
    if (!n) return;
    const L = this.L.d, ux = this.ux.d, uy = this.uy.d, v = this.v.d, a = this.a.d, j = this.j.d, p = this.p.d;
    // entrada máxima de cada movimento; a saída do último é a velocidade segura de parada
    const ent = new Float64Array(n + 1);
    const seguro = (k: number) => Math.min(v[k], j[k] / Math.max(Math.abs(ux[k]), Math.abs(uy[k]), 1e-9));
    ent[0] = seguro(0);
    for (let k = 1; k < n; k++) ent[k] = Math.min(v[k - 1], v[k], velJuncao(ux[k - 1], uy[k - 1], ux[k], uy[k], j[k]));
    ent[n] = seguro(n - 1);
    for (let k = n - 1; k >= 0; k--) ent[k] = Math.min(ent[k], Math.sqrt(ent[k + 1] * ent[k + 1] + 2 * a[k] * L[k]));
    for (let k = 0; k < n; k++) ent[k + 1] = Math.min(ent[k + 1], Math.sqrt(ent[k] * ent[k] + 2 * a[k] * L[k]));
    const fa = this.lim.aceleraDesacelera;
    for (let k = 0; k < n; k++) {
      const t = tempoTrapezio(L[k], ent[k], ent[k + 1], v[k], a[k], fa > 0 ? a[k] * fa : 0);
      this.camada[p[k]] += t;
      if (p[k] !== IDX.deslocamento) {
        this.tExt.push(t);
        this.vExt.push(v[k]);
      }
    }
    this.L.n = this.ux.n = this.uy.n = this.v.n = this.a.n = this.j.n = this.p.n = 0;
  }

  /**
   * Fecha a camada: se ela levou menos que `tMin` s, a extrusão desacelera para o plástico resfriar
   * (sem passar abaixo de `vMin` mm/s); o acréscimo vai para "resfriamento". Devolve o tempo da camada.
   */
  fecharCamada(tMin: number, vMin: number): number {
    this.planejar();
    let total = 0;
    for (let k = 0; k < PARTES.length; k++) total += this.camada[k];
    if (tMin > 0 && total < tMin && this.tExt.n) {
      const t = this.tExt.d, vv = this.vExt.d, n = this.tExt.n;
      let ext = 0;
      for (let k = 0; k < n; k++) ext += t[k];
      const lento = (f: number) => {
        let s = 0;
        for (let k = 0; k < n; k++) s += t[k] * Math.max(1, Math.min(f, vv[k] / vMin));
        return s;
      };
      const outros = total - ext;
      let lo = 1, hi = 1;
      while (hi < 1e4 && lento(hi) + outros < tMin) hi *= 2;
      if (lento(hi) + outros <= tMin) lo = hi;
      else
        for (let it = 0; it < 40; it++) {
          const m = (lo + hi) / 2;
          if (lento(m) + outros < tMin) lo = m;
          else hi = m;
        }
      const extra = lento(lo) - ext;
      this.camada[IDX.resfriamento] += extra;
      total += extra;
    }
    for (let k = 0; k < PARTES.length; k++) this.tempo[k] += this.camada[k];
    this.camada.fill(0);
    this.tExt.n = this.vExt.n = 0;
    this.tempoCamadas.push(total);
    return total;
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
