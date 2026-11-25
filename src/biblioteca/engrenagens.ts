// Gerador de engrenagens (puro, sem DOM nem kernel): grandezas calculadas (diâmetros primitivo/externo/raiz,
// base, passo, espessura), perfil evolvente EXATO no plano transversal (pontos da própria curva, que o kernel
// passa por uma B-spline de desvio < 0,1 µm), cremalheira, pares (distância entre centros com deslocamento de
// perfil, razão, grau de recobrimento, compatibilidade) e a posição do par na Montagem com engrenamento correto.
// Convenção da peça (a mesma da biblioteca de fixação): eixo = Y; face de referência em y = 0, dentes em
// y ∈ [0, b]; cubo em y < 0. No plano transversal (x, z), o ângulo θ vai de +X para +Z; o dente 0 fica
// centrado em θ = 0 (+X). Hélice à direita: o dente gira para θ menor ao subir em Y (parafuso à direita).
// Testado em scripts/teste-engrenagens.ts. Comportamento: docs/funcional/biblioteca.md §Engrenagens.

import { PARAM_ENGRENAGEM_PADRAO, documentoVazio, novoId, type Documento, type FeatureEngrenagem, type ParamEngrenagem, type TipoEngrenagem, type Vec3 } from "../model";
import { inverter, multQuat, quatEixoAngulo, type Quat, type Transformacao } from "../montagem/modelo";

export type P2 = [number, number];

export const ROTULO_TIPO: Record<TipoEngrenagem, string> = {
  reta: "Dentes retos",
  helicoidal: "Helicoidal",
  cremalheira: "Cremalheira",
  conica: "Cônica (dentes retos)",
  semFim: "Sem-fim",
  coroa: "Coroa (para sem-fim)",
  interna: "Interna (anel)",
};
export const TIPOS_ENGRENAGEM = Object.keys(ROTULO_TIPO) as TipoEngrenagem[];

const rad = (g: number) => (g * Math.PI) / 180;
const graus = (r: number) => (r * 180) / Math.PI;
/** função evolvente: inv(α) = tan α − α */
export const inv = (a: number) => Math.tan(a) - a;
/** α tal que inv(α) = v (Newton; v ≥ 0) */
export function invInversa(v: number): number {
  let a = Math.cbrt(3 * v); // inv(α) ≈ α³/3 para α pequeno
  for (let i = 0; i < 40; i++) {
    const t = Math.tan(a);
    const d = (t - a - v) / (t * t);
    a -= d;
    if (Math.abs(d) < 1e-15) break;
  }
  return a;
}

/** Parâmetros completos (os ausentes vêm dos valores de fábrica). */
export const paramCompleto = (p: Partial<ParamEngrenagem>): ParamEngrenagem => ({ ...PARAM_ENGRENAGEM_PADRAO, ...p });

/** Tem hélice (dentes inclinados)? */
export const temHelice = (p: ParamEngrenagem) =>
  p.tipoEngrenagem === "coroa" || ((p.tipoEngrenagem === "helicoidal" || p.tipoEngrenagem === "interna" || p.tipoEngrenagem === "cremalheira") && p.helice > 0);

/** Sem-fim: ângulo de avanço γ = atan(z1/q). */
export const anguloAvanco = (entradas: number, q: number) => Math.atan(entradas / q);

export interface Geometria {
  tipo: TipoEngrenagem;
  /** módulos normal e transversal; ângulos de pressão normal e transversal (rad); hélice β (rad) */
  mn: number;
  mt: number;
  an: number;
  at: number;
  beta: number;
  /** +1 à direita, −1 à esquerda */
  mao: 1 | -1;
  z: number;
  x: number;
  /** raios primitivo, de base, externo (da ponta) e de raiz; na interna: ra = raio da ponta (dentro), rf = do fundo (fora) */
  r: number;
  rb: number;
  ra: number;
  rf: number;
  /** espessura transversal do dente no primitivo (arco) e passo transversal */
  st: number;
  pt: number;
  /** cônica: ângulo primitivo δ e geratriz Re */
  delta?: number;
  Re?: number;
  /** sem-fim: γ, passo axial e avanço */
  gama?: number;
  pz?: number;
  avanco?: number;
  /** interna: raio externo do aro */
  raio_aro?: number;
}

/** Grandezas calculadas. Erros de entrada viram mensagem clara (Error). */
export function geometria(p0: Partial<ParamEngrenagem>): Geometria {
  const p = paramCompleto(p0);
  const t = p.tipoEngrenagem;
  if (!(p.modulo > 0)) throw new Error("O módulo deve ser maior que zero.");
  if (!(p.angPressao > 0 && p.angPressao < 45)) throw new Error("Ângulo de pressão entre 0° e 45°.");
  if (!(p.largura > 0)) throw new Error(t === "semFim" ? "O comprimento do sem-fim deve ser maior que zero." : "A largura deve ser maior que zero.");
  const z = Math.round(p.dentes);
  if (t === "semFim") {
    if (!(z >= 1 && z <= 8)) throw new Error("Sem-fim: de 1 a 8 entradas.");
  } else if (t !== "cremalheira") {
    if (!(z >= (t === "interna" ? 12 : 4))) throw new Error(t === "interna" ? "Interna: no mínimo 12 dentes." : "No mínimo 4 dentes.");
    if (z > 400) throw new Error("No máximo 400 dentes.");
  }
  const mao: 1 | -1 = p.sentido === "esquerda" ? -1 : 1;
  const an = rad(p.angPressao);
  if (t === "semFim" || t === "coroa") {
    if (!(p.coefDiametro >= 4 && p.coefDiametro <= 30)) throw new Error("Coeficiente de diâmetro q de 4 a 30.");
    const z1 = t === "semFim" ? z : Math.round(p.entradas);
    if (!(z1 >= 1 && z1 <= 8)) throw new Error("Entradas do sem-fim: de 1 a 8.");
    const gama = anguloAvanco(z1, p.coefDiametro);
    const m = p.modulo; // axial do sem-fim = transversal da coroa
    if (t === "semFim") {
      const r = (p.coefDiametro * m) / 2;
      return { tipo: t, mn: m * Math.cos(gama), mt: m, an, at: an, beta: gama, mao, z, x: 0, r, rb: r, ra: r + m, rf: r - 1.2 * m, st: (Math.PI * m) / 2, pt: Math.PI * m, gama, pz: Math.PI * m, avanco: z * Math.PI * m };
    }
    // coroa: helicoidal com β = γ (mesmo sentido do sem-fim), perfil transversal = perfil axial do sem-fim
    const r = (z * m) / 2, x = p.deslocamento;
    const g: Geometria = { tipo: t, mn: m * Math.cos(gama), mt: m, an: Math.atan(Math.tan(an) * Math.cos(gama)), at: an, beta: gama, mao, z, x, r, rb: r * Math.cos(an), ra: r + m * (1 + x), rf: r - m * (1.2 - x), st: m * (Math.PI / 2 + 2 * x * Math.tan(an)), pt: Math.PI * m, gama };
    return conferirDente(g);
  }
  if (t === "helicoidal" && !(p.helice > 0)) throw new Error("Helicoidal: informe o ângulo de hélice β (> 0°).");
  const beta = temHelice(p) ? rad(p.helice) : 0;
  if (!(beta >= 0 && beta <= rad(45))) throw new Error("Ângulo de hélice de 0° a 45°.");
  const mn = p.modulo, mt = mn / Math.cos(beta), at = Math.atan(Math.tan(an) / Math.cos(beta));
  const x = t === "cremalheira" ? 0 : p.deslocamento;
  if (Math.abs(x) > 1.5) throw new Error("Deslocamento de perfil x entre −1,5 e 1,5.");
  const st = mt * (Math.PI / 2 + 2 * x * Math.tan(an));
  if (t === "cremalheira") {
    if (!(p.comprimento >= 2 * Math.PI * mt)) throw new Error("Cremalheira: comprimento de pelo menos 2 passos.");
    if (!(p.altura > 2.25 * mn)) throw new Error(`Cremalheira: altura total maior que a do dente (${fmt(2.25 * mn)} mm).`);
    return { tipo: t, mn, mt, an, at, beta, mao, z: 0, x: 0, r: Infinity, rb: Infinity, ra: mn, rf: -1.25 * mn, st, pt: Math.PI * mt };
  }
  const r = (z * mt) / 2;
  if (t === "interna") {
    // ISO 21771 com z negativo: |da| = d − 2m(1 + x), |df| = d + 2m(1,25 − x); x > 0 engrossa o dente interno
    const ra = r - mn * (1 + x), rf = r + mn * (1.25 - x);
    const raio_aro = p.aro > 0 ? p.aro / 2 : rf + 3 * mn;
    if (raio_aro <= rf + 0.5 * mn) throw new Error(`Interna: o Ø externo do aro deve passar de ${fmt(2 * rf + mn)} mm.`);
    return { tipo: t, mn, mt, an, at, beta, mao, z, x, r, rb: r * Math.cos(at), ra, rf, st, pt: Math.PI * mt, raio_aro };
  }
  const g: Geometria = { tipo: t, mn, mt, an, at, beta, mao, z, x, r, rb: r * Math.cos(at), ra: r + mn * (1 + x), rf: r - mn * (1.25 - x), st, pt: Math.PI * mt };
  if (t === "conica") {
    const z2 = Math.round(p.dentesPar);
    if (!(z2 >= 4)) throw new Error("Cônica: informe os dentes da outra engrenagem (≥ 4).");
    const S = rad(p.anguloEixos);
    if (!(S > rad(10) && S < rad(170))) throw new Error("Cônica: ângulo entre eixos de 10° a 170°.");
    const delta = Math.atan2(Math.sin(S), z2 / z + Math.cos(S));
    const Re = r / Math.sin(delta);
    if (p.largura > Re / 2) throw new Error(`Cônica: largura até Re/2 (${fmt(Re / 2)} mm); recomendado até Re/3 (${fmt(Re / 3)} mm).`);
    g.delta = delta;
    g.Re = Re;
  }
  return conferirDente(g);
}

/** Dente pontudo ou raiz que cruza o vizinho = erro claro. */
function conferirDente(g: Geometria): Geometria {
  if (g.rf <= 0) throw new Error("Dentes de menos para este módulo: o fundo do dente passa do centro.");
  const psiA = meioAngulo(g, g.ra);
  if (!(psiA > 0)) throw new Error("Dente pontudo: reduza o deslocamento de perfil x (ou aumente os dentes).");
  if (meioAngulo(g, Math.max(g.rb, g.rf)) >= Math.PI / g.z) throw new Error("Os dentes se encostam na raiz: reduza o deslocamento de perfil x.");
  return g;
}

/** Metade do ângulo do dente no raio ρ (ρ ≥ rb): ψ(ρ) = s/(2r) + inv αt − inv αρ. */
export function meioAngulo(g: Pick<Geometria, "st" | "r" | "rb" | "at">, rho: number, st = g.st): number {
  const ar = Math.acos(Math.min(1, g.rb / rho));
  return st / (2 * g.r) + inv(g.at) - inv(ar);
}

/** Espessura do dente (arco) no raio ρ. */
export const espessuraNoRaio = (g: Geometria, rho: number) => 2 * rho * meioAngulo(g, Math.max(rho, g.rb));

/** Deslocamento mínimo para não haver adelgaçamento (rebaixo na raiz): x_min = 1 − z·sin²αt / (2 cos β). */
export const deslocamentoMinimo = (g: Geometria) => 1 - ((g.delta ? g.z / Math.cos(g.delta) : g.z) * Math.sin(g.at) ** 2) / (2 * Math.cos(g.beta));

// ---------- perfil transversal ----------

export type Trecho =
  /** curva exata dada por pontos (flanco evolvente; no sem-fim, espiral de Arquimedes) */
  | { t: "curva"; pts: P2[] }
  | { t: "linha"; a: P2; b: P2 }
  /** arco de centro na origem, raio r, de θ0 a θ1 (crescente) */
  | { t: "arco"; r: number; a0: number; a1: number };

const polar = (rho: number, th: number): P2 => [rho * Math.cos(th), rho * Math.sin(th)];

/** Pontos exatos da evolvente do flanco: lado −1 (direito, θ = −ψ) ou +1 (esquerdo), de ρ0 a ρ1. */
export function pontosEvolvente(g: Pick<Geometria, "st" | "r" | "rb" | "at">, centro: number, lado: 1 | -1, rho0: number, rho1: number, n = 24, st = g.st): P2[] {
  const out: P2[] = [];
  // distribuição pelo ângulo de rolamento (mais pontos perto da base, onde a curvatura é maior)
  const t0 = Math.sqrt(Math.max(0, (rho0 / g.rb) ** 2 - 1)), t1 = Math.sqrt(Math.max(0, (rho1 / g.rb) ** 2 - 1));
  for (let i = 0; i <= n; i++) {
    const tr = t0 + ((t1 - t0) * i) / n;
    const rho = i === 0 ? rho0 : i === n ? rho1 : g.rb * Math.sqrt(1 + tr * tr);
    out.push(polar(rho, centro + lado * meioAngulo(g, rho, st)));
  }
  return out;
}

/**
 * Contorno fechado (anti-horário) de uma roda dentada externa: z dentes com flancos evolventes entre
 * max(rb, rf) e ra, ponta em arco (ra), raiz em arco (rf) e, se rf < rb, trecho radial até a base.
 * `st` = espessura transversal no primitivo; `fase` = ângulo do centro do dente 0.
 */
export function contornoDentado(g: Pick<Geometria, "r" | "rb" | "at" | "z">, ra: number, rf: number, st: number, fase = 0, n = 24, dentes = g.z): Trecho[] {
  const gg = { ...g, st };
  const z = dentes, passo = (2 * Math.PI) / g.z;
  const pe = Math.max(g.rb, rf);
  const psiP = meioAngulo(gg, pe), psiA = meioAngulo(gg, ra);
  const out: Trecho[] = [];
  for (let k = 0; k < z; k++) {
    const c = fase + k * passo;
    // raiz: do flanco esquerdo do dente anterior até o flanco direito deste
    out.push({ t: "arco", r: rf, a0: c - passo + psiP, a1: c - psiP });
    if (rf < g.rb) out.push({ t: "linha", a: polar(rf, c - psiP), b: polar(pe, c - psiP) });
    out.push({ t: "curva", pts: pontosEvolvente(gg, c, -1, pe, ra, n) });
    out.push({ t: "arco", r: ra, a0: c - psiA, a1: c + psiA });
    out.push({ t: "curva", pts: pontosEvolvente(gg, c, 1, pe, ra, n).reverse() });
    if (rf < g.rb) out.push({ t: "linha", a: polar(pe, c + psiP), b: polar(rf, c + psiP) });
  }
  return out;
}

/**
 * Seção transversal do sem-fim ZA (perfil axial reto): a meia largura axial do filete no raio ρ é
 * w(ρ) = pz/4 − (ρ − r)·tan α e o movimento de parafuso leva isso ao ângulo Δ(ρ) = 2π·w(ρ)/avanço — linear em
 * ρ: os flancos da seção são espirais de Arquimedes (exatas). O sem-fim é essa seção extrudada com torção
 * de 2π por avanço. Filete da entrada 0 centrado em θ = 0.
 */
export function contornoSemFim(g: Geometria, n = 16): Trecho[] {
  const z1 = g.z, passo = (2 * Math.PI) / z1, ta = Math.tan(g.at);
  const delta = (rho: number) => (2 * Math.PI * (g.pz! / 4 - (rho - g.r) * ta)) / g.avanco!;
  const flanco = (c: number, lado: 1 | -1): P2[] => {
    const out: P2[] = [];
    for (let i = 0; i <= n; i++) {
      const rho = g.rf + ((g.ra - g.rf) * i) / n;
      out.push(polar(rho, c + lado * delta(rho)));
    }
    return out;
  };
  const out: Trecho[] = [];
  for (let k = 0; k < z1; k++) {
    const c = k * passo;
    out.push({ t: "arco", r: g.rf, a0: c - passo + delta(g.rf), a1: c - delta(g.rf) });
    out.push({ t: "curva", pts: flanco(c, -1) });
    out.push({ t: "arco", r: g.ra, a0: c - delta(g.ra), a1: c + delta(g.ra) });
    out.push({ t: "curva", pts: flanco(c, 1).reverse() });
  }
  return out;
}

/**
 * Cônica de dentes retos pelo método de Tredgold: o perfil da ponta maior fica no cone complementar e,
 * desenvolvido, é a evolvente da engrenagem virtual (rv = r/cos δ, zv = z/cos δ). Cada ponto desse perfil
 * é projetado pelo vértice do cone primitivo no plano y = 0 (face maior plana); os flancos do sólido são as
 * retas que passam pelo vértice (o kernel liga este contorno ao mesmo contorno escalado para o vértice).
 * No primitivo a projeção não muda nada: espessura = π·m/2 + 2x·m·tan α.
 */
/** Raio na face maior plana (y = 0) do ponto do cone complementar à distância ρ do ápice dele. */
export function raioNaFaceConica(g: Geometria, rho: number): number {
  const cd = Math.cos(g.delta!), sd = Math.sin(g.delta!), rv = g.r / cd, H = g.Re! * cd;
  return (H / (H - (rho - rv) * sd)) * rho * cd;
}

export function contornoConica(g: Geometria, n = 24): Trecho[] {
  const cd = Math.cos(g.delta!);
  const rv = g.r / cd;
  const gv = { r: rv, rb: rv * Math.cos(g.at), at: g.at, z: g.z / cd };
  const rav = rv + g.mn * (1 + g.x), rfv = rv - g.mn * (1.25 - g.x);
  // (ρ, φ) desenvolvidos → ponto do cone complementar (ápice no eixo, em y = −rv·sen δ) → projeção em y = 0
  const raioProj = (rho: number) => raioNaFaceConica(g, rho);
  // ângulo desenvolvido contínuo (a volta toda vale 2π·cos δ < 2π: sem atan2 cru, que "dobraria" a volta)
  let ultimo = 0;
  const mapa = ([x, z]: P2): P2 => {
    let fi = Math.atan2(z, x);
    fi += 2 * Math.PI * Math.round((ultimo - fi) / (2 * Math.PI));
    ultimo = fi;
    const th = fi / cd, rr = raioProj(Math.hypot(x, z));
    return [rr * Math.cos(th), rr * Math.sin(th)];
  };
  return contornoDentado(gv, rav, rfv, g.st, 0, n, g.z).map((t): Trecho => {
    if (t.t === "curva") return { t: "curva", pts: t.pts.map(mapa) };
    if (t.t === "linha") return { t: "linha", a: mapa(t.a), b: mapa(t.b) };
    ultimo = t.a1;
    return { t: "arco", r: raioProj(t.r), a0: t.a0 / cd, a1: t.a1 / cd };
  });
}

/** Contorno transversal da engrenagem (externa) ou do vão da interna (o furo dentado que sai do aro). */
export function contornoTransversal(g: Geometria, n = 24): Trecho[] {
  if (g.tipo === "semFim") return contornoSemFim(g, n);
  if (g.tipo === "conica") return contornoConica(g, n);
  if (g.tipo === "interna") {
    // o furo é uma roda "externa" cujos dentes são os vãos da interna: ponta = fundo da interna (rf),
    // raiz = ponta da interna (ra), espessura = passo − espessura do dente interno; meio passo de fase
    // deixa o dente interno 0 em θ = 0
    return contornoDentado(g, g.rf, g.ra, g.pt - g.st, Math.PI / g.z, n);
  }
  return contornoDentado(g, g.ra, g.rf, g.st, 0, n);
}

/** Pontos densos do contorno (para área e conferências). */
export function poligonoDoContorno(trechos: Trecho[], passoArco = 0.02): P2[] {
  const out: P2[] = [];
  for (const tr of trechos) {
    if (tr.t === "curva") out.push(...tr.pts.slice(0, -1));
    else if (tr.t === "linha") out.push(tr.a);
    else {
      const n = Math.max(2, Math.ceil((tr.a1 - tr.a0) / passoArco));
      for (let i = 0; i < n; i++) out.push(polar(tr.r, tr.a0 + ((tr.a1 - tr.a0) * i) / n));
    }
  }
  return out;
}

export function areaPoligono(p: P2[]): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % p.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

/**
 * Perfil da cremalheira no plano (x ao longo da cremalheira, z para as pontas): linha primitiva em z = 0,
 * ponta em z = +ha, fundo em z = −hf, costas em z = ha − altura; dente centrado em x = 0 (e a cada passo).
 * Cobre [x0, x1] (o kernel recorta). Polígono anti-horário.
 */
export function perfilCremalheira(g: Geometria, altura: number, x0: number, x1: number): P2[] {
  const ha = g.mn, hf = 1.25 * g.mn, ta = Math.tan(g.at), s2 = g.st / 2;
  const cantos: number[] = [];
  const k0 = Math.floor(x0 / g.pt) - 1, k1 = Math.ceil(x1 / g.pt) + 1;
  for (let k = k0; k <= k1; k++) {
    const c = k * g.pt;
    cantos.push(c - s2 - hf * ta, c - s2 + ha * ta, c + s2 - ha * ta, c + s2 + hf * ta);
  }
  const alturaEm = (x: number) => {
    const c = Math.round(x / g.pt) * g.pt;
    const d = Math.abs(x - c);
    return Math.max(-hf, Math.min(ha, (s2 - d) / ta));
  };
  const xs = [x0, ...cantos.filter((c) => c > x0 && c < x1), x1];
  const topo: P2[] = xs.map((x) => [x, alturaEm(x)]);
  const fundo = ha - altura;
  // anti-horário no plano (x, z): costas da esquerda para a direita, depois o topo da direita para a esquerda
  return [[x0, fundo], [x1, fundo], ...topo.reverse()];
}

// ---------- rasgo de chaveta (DIN 6885 forma A) ----------

/** [Ø do eixo acima de, até], largura b, altura h, profundidade no cubo t2. */
const DIN6885: [number, number, number, number, number][] = [
  [6, 8, 2, 2, 1.0], [8, 10, 3, 3, 1.4], [10, 12, 4, 4, 1.8], [12, 17, 5, 5, 2.3], [17, 22, 6, 6, 2.8],
  [22, 30, 8, 7, 3.3], [30, 38, 10, 8, 3.3], [38, 44, 12, 8, 3.3], [44, 50, 14, 9, 3.8], [50, 58, 16, 10, 4.3],
  [58, 65, 18, 11, 4.4], [65, 75, 20, 12, 4.9], [75, 85, 22, 14, 5.4], [85, 95, 25, 14, 5.4], [95, 110, 28, 16, 6.4],
  [110, 130, 32, 18, 7.4], [130, 150, 36, 20, 8.4],
];

/** Chaveta DIN 6885 para o Ø do furo: largura b, altura h e profundidade no cubo t2 (null = fora da tabela). */
export function chavetaDIN6885(furo: number): { b: number; h: number; t2: number } | null {
  const l = DIN6885.find(([a, b]) => furo > a && furo <= b);
  return l ? { b: l[2], h: l[3], t2: l[4] } : null;
}

// ---------- valores mostrados ----------

const fmt = (v: number, casas = 3) => (Number.isFinite(v) ? v.toLocaleString("pt-BR", { maximumFractionDigits: casas }) : "—");

export interface Valor {
  rotulo: string;
  valor: string;
}

/** Tabela de valores calculados (painel e propriedades da peça). */
export function valoresCalculados(p0: Partial<ParamEngrenagem>): { valores: Valor[]; avisos: string[] } {
  const p = paramCompleto(p0);
  const g = geometria(p);
  const v: Valor[] = [];
  const avisos: string[] = [];
  const add = (rotulo: string, valor: number, un = "mm") => v.push({ rotulo, valor: `${fmt(valor)}${un ? ` ${un}` : ""}` });
  if (g.tipo === "semFim") {
    add("Diâmetro primitivo d1", 2 * g.r);
    add("Diâmetro externo da1", 2 * g.ra);
    add("Diâmetro de raiz df1", 2 * g.rf);
    add("Ângulo de avanço γ", graus(g.gama!), "°");
    add("Passo axial pz", g.pz!);
    add("Avanço (z1·pz)", g.avanco!);
    add("Módulo normal", g.mn);
    return { valores: v, avisos };
  }
  if (g.tipo === "cremalheira") {
    add("Passo transversal", g.pt);
    add("Altura do dente (1 + 1,25)·m", 2.25 * g.mn);
    add("Espessura no primitivo", g.st);
    add("Nº de dentes no comprimento", Math.floor(p.comprimento / g.pt), "");
    if (g.beta) add("Módulo transversal", g.mt);
    add("Avanço por volta de um pinhão de z dentes", g.pt, "mm × z");
    return { valores: v, avisos };
  }
  add("Diâmetro primitivo d", 2 * g.r);
  if (g.tipo === "interna") {
    add("Diâmetro da ponta (interno) da", 2 * g.ra);
    add("Diâmetro de raiz (fundo) df", 2 * g.rf);
    add("Diâmetro externo do aro", 2 * g.raio_aro!);
  } else {
    add("Diâmetro externo da", 2 * g.ra);
    add("Diâmetro de raiz df", 2 * g.rf);
  }
  add("Diâmetro de base db", 2 * g.rb);
  add("Passo transversal pt", g.pt);
  add("Espessura do dente no primitivo", g.st);
  if (g.beta) {
    add("Módulo transversal mt", g.mt);
    add("Ângulo de pressão transversal αt", graus(g.at), "°");
    if (g.tipo === "coroa") add("Ângulo de hélice β (= avanço γ do sem-fim)", graus(g.beta), "°");
  }
  if (g.tipo === "conica") {
    add("Ângulo primitivo δ", graus(g.delta!), "°");
    add("Geratriz Re", g.Re!);
    add("Ø externo teórico (cone complementar) da", 2 * g.r + 2 * g.mn * (1 + g.x) * Math.cos(g.delta!));
    add("Ø externo na face maior plana do modelo", 2 * raioNaFaceConica(g, g.r / Math.cos(g.delta!) + g.mn * (1 + g.x)));
    add("Dentes da engrenagem virtual zv = z/cos δ", g.z / Math.cos(g.delta!), "");
  }
  if (g.tipo !== "interna") {
    const sa = espessuraNoRaio(g, g.ra);
    add("Espessura na ponta", sa);
    if (sa < 0.25 * g.mn) avisos.push(`Ponta fina (${fmt(sa)} mm < 0,25·m): reduza o deslocamento x.`);
    const xmin = deslocamentoMinimo(g);
    if (g.tipo !== "coroa" && g.x < xmin - 1e-9) avisos.push(`Com ${g.z} dentes há adelgaçamento (rebaixo) na raiz: use x ≥ ${fmt(xmin, 2)} (o perfil desenhado não mostra o rebaixo).`);
  } else if (g.ra < g.rb) avisos.push("A ponta da interna fica dentro do círculo de base: aumente os dentes ou o deslocamento x.");
  if (p.furo > 0) {
    const ch = p.chaveta ? chavetaDIN6885(p.furo) : null;
    if (p.chaveta && !ch) avisos.push(`Sem chaveta DIN 6885 para Ø${fmt(p.furo)} (tabela de 6 a 150 mm).`);
    if (ch) v.push({ rotulo: "Chaveta DIN 6885", valor: `${ch.b} × ${ch.h} (t2 = ${fmt(ch.t2)} mm)` });
    const limite = g.tipo === "interna" ? 0 : g.tipo === "conica" ? g.rf * (1 - p.largura / g.Re!) : g.rf;
    if (g.tipo !== "interna" && p.furo / 2 + (ch?.t2 ?? 0) > limite - g.mn) avisos.push("Furo/rasgo muito perto da raiz dos dentes (parede menor que 1 módulo).");
  }
  return { valores: v, avisos };
}

// ---------- pares ----------

export interface Par {
  /** distância entre centros (eixos paralelos), entre eixo e linha primitiva (cremalheira) ou entre eixos (sem-fim) */
  distancia: number;
  /** razão de transmissão i = n1/n2 = z2/z1 (rotação da 1ª ÷ da 2ª; sem-fim: z = entradas; cremalheira: avanço por volta, mm) */
  razao: number;
  descricao: string;
  /** ângulo de pressão de funcionamento (rad) e grau de recobrimento, quando se aplicam */
  alfaW?: number;
  recobrimento?: number;
  avisos: string[];
}

const ehCilindrica = (t: TipoEngrenagem) => t === "reta" || t === "helicoidal";

/** Confere se as duas formam par e calcula distância entre centros e razão. Erro = mensagem clara. */
export function calcularPar(p1: Partial<ParamEngrenagem>, p2: Partial<ParamEngrenagem>): Par {
  const a = paramCompleto(p1), b = paramCompleto(p2);
  const g1 = geometria(a), g2 = geometria(b);
  const t1 = a.tipoEngrenagem, t2 = b.tipoEngrenagem;
  const avisos: string[] = [];
  const mesmo = (x: number, y: number) => Math.abs(x - y) < 1e-9;
  const conferirModulo = () => {
    if (!mesmo(g1.mn, g2.mn)) throw new Error(`Módulos diferentes (${fmt(g1.mn)} e ${fmt(g2.mn)}): não engrenam.`);
    if (!mesmo(g1.an, g2.an)) throw new Error("Ângulos de pressão diferentes: não engrenam.");
  };
  // ordem canônica dos pares mistos
  if ((t2 === "cremalheira" && ehCilindrica(t1)) || (t2 === "interna" && ehCilindrica(t1)) || (t1 === "semFim" && t2 === "coroa")) {
    const r = calcularPar(b, a);
    return { ...r, razao: t2 === "cremalheira" ? r.razao : 1 / r.razao };
  }
  if (ehCilindrica(t1) && ehCilindrica(t2)) {
    conferirModulo();
    if (!mesmo(g1.beta, g2.beta)) throw new Error("Ângulos de hélice diferentes: não engrenam (eixos paralelos).");
    if (g1.beta && g1.mao === g2.mao) throw new Error("Helicoidais externas de eixos paralelos: uma à direita e a outra à esquerda.");
    const zs = g1.z + g2.z;
    const aw = invInversa(inv(g1.at) + (2 * Math.tan(g1.an) * (g1.x + g2.x)) / zs);
    const dist = (zs * g1.mt * Math.cos(g1.at)) / (2 * Math.cos(aw));
    const eps = (Math.sqrt(g1.ra ** 2 - g1.rb ** 2) + Math.sqrt(g2.ra ** 2 - g2.rb ** 2) - dist * Math.sin(aw)) / (Math.PI * g1.mt * Math.cos(g1.at));
    if (eps < 1.1) avisos.push(`Grau de recobrimento baixo (${fmt(eps, 2)} < 1,1).`);
    return { distancia: dist, razao: g2.z / g1.z, descricao: "Externas de eixos paralelos", alfaW: aw, recobrimento: eps, avisos };
  }
  if (t1 === "interna" && ehCilindrica(t2)) {
    conferirModulo();
    if (!mesmo(g1.beta, g2.beta)) throw new Error("Ângulos de hélice diferentes: não engrenam.");
    if (g1.beta && g1.mao !== g2.mao) throw new Error("Par interno helicoidal: as duas com a hélice no mesmo sentido.");
    const dz = g1.z - g2.z;
    if (dz < 10) throw new Error(`Interna e pinhão: diferença de dentes de pelo menos 10 (agora ${dz}).`);
    const aw = invInversa(inv(g1.at) - (2 * Math.tan(g1.an) * (g1.x + g2.x)) / dz);
    const dist = (dz * g1.mt * Math.cos(g1.at)) / (2 * Math.cos(aw));
    if (dist + g2.ra > g1.rf - 0.1 * g1.mn) avisos.push("A ponta do pinhão chega ao fundo da interna (folga de raiz pequena).");
    return { distancia: dist, razao: g2.z / g1.z, descricao: "Interna com pinhão (giram no mesmo sentido)", alfaW: aw, avisos };
  }
  if (t1 === "cremalheira" && ehCilindrica(t2)) {
    conferirModulo();
    if (!mesmo(g1.beta, g2.beta)) throw new Error("Ângulos de hélice diferentes: não engrenam.");
    if (g1.beta && g1.mao === g2.mao) throw new Error("Cremalheira helicoidal: o pinhão tem a hélice no sentido oposto ao da cremalheira.");
    return { distancia: g2.r + g2.x * g2.mn, razao: 2 * Math.PI * g2.r, descricao: "Cremalheira e pinhão (distância do eixo à linha primitiva; razão = avanço por volta em mm)", avisos };
  }
  if (t1 === "conica" && t2 === "conica") {
    conferirModulo();
    if (Math.round(a.dentesPar) !== g2.z || Math.round(b.dentesPar) !== g1.z) throw new Error(`Cônicas: cada uma precisa ter os dentes da outra em "Dentes da outra" (${g1.z} e ${g2.z}).`);
    if (!mesmo(a.anguloEixos, b.anguloEixos)) throw new Error("Cônicas: o mesmo ângulo entre eixos nas duas.");
    return { distancia: 0, razao: g2.z / g1.z, descricao: `Cônicas, eixos a ${fmt(a.anguloEixos)}° (vértices coincidentes)`, avisos };
  }
  if (t1 === "coroa" && t2 === "semFim") {
    if (!mesmo(a.modulo, b.modulo)) throw new Error(`Módulos diferentes (${fmt(a.modulo)} e ${fmt(b.modulo)}): não engrenam.`);
    if (!mesmo(g1.at, g2.at)) throw new Error("Ângulos de pressão diferentes: não engrenam.");
    if (Math.round(a.entradas) !== g2.z || !mesmo(a.coefDiametro, b.coefDiametro)) throw new Error(`Coroa feita para sem-fim de ${Math.round(a.entradas)} entrada(s) e q = ${fmt(a.coefDiametro)}; o sem-fim tem ${g2.z} e q = ${fmt(b.coefDiametro)}.`);
    if (g1.mao !== g2.mao) throw new Error("Coroa e sem-fim: a hélice no mesmo sentido.");
    return { distancia: g1.r + g2.r + g1.x * a.modulo, razao: g2.z / g1.z, descricao: "Sem-fim e coroa (eixos a 90°)", avisos };
  }
  throw new Error(`${ROTULO_TIPO[t1]} e ${ROTULO_TIPO[t2]} não formam par.`);
}

// ---------- posição do par (engrenamento correto) ----------

/** Quatérnio da base (imagens dos eixos locais X, Y e Z = X × Y). */
export function quatDeBase(ex: Vec3, ey: Vec3): Quat {
  const ez: Vec3 = [ex[1] * ey[2] - ex[2] * ey[1], ex[2] * ey[0] - ex[0] * ey[2], ex[0] * ey[1] - ex[1] * ey[0]];
  const [m00, m10, m20] = ex, [m01, m11, m21] = ey, [m02, m12, m22] = ez;
  const tr = m00 + m11 + m22;
  let q: Quat;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    q = [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, 0.25 * s];
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    q = [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    q = [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s];
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    q = [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
  }
  const n = Math.hypot(...q);
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}

/** Giro em torno do eixo da peça (Y) que leva o ângulo local θ a θ − ω. */
const giroY = (omega: number): Quat => quatEixoAngulo([0, 1, 0], graus(omega));

/** Pose com: eixo local X → ex, Y → ey, depois de girar a peça de ω no próprio eixo. */
const pose = (pos: Vec3, ex: Vec3, ey: Vec3, omega: number): Transformacao => ({ pos, rot: multQuat(quatDeBase(ex, ey), giroY(omega)) });

/**
 * Posição da engrenagem 2 em relação à 1 (a 1 fica onde está; compor com a pose dela). O dente 0 da 1
 * (θ = 0) entra no vão da 2 na linha de centros; flancos simétricos → folga igual dos dois lados (zero
 * com a distância calculada).
 */
export function poseDoPar(p1: Partial<ParamEngrenagem>, p2: Partial<ParamEngrenagem>): Transformacao {
  const a = paramCompleto(p1), b = paramCompleto(p2);
  const par = calcularPar(a, b);
  const g1 = geometria(a), g2 = geometria(b);
  const t1 = a.tipoEngrenagem, t2 = b.tipoEngrenagem;
  const X: Vec3 = [1, 0, 0], Y: Vec3 = [0, 1, 0], Z: Vec3 = [0, 0, 1];
  // pares mistos na outra ordem: calcula a 1 em relação à 2 e inverte
  if ((t2 === "cremalheira" && ehCilindrica(t1)) || (t2 === "interna" && ehCilindrica(t1)) || (t2 === "coroa" && t1 === "semFim")) return inverter(poseDoPar(b, a));
  if (ehCilindrica(t1) && ehCilindrica(t2)) return pose([par.distancia, 0, 0], X, Y, Math.PI / g2.z - Math.PI);
  if (t1 === "interna") return pose([par.distancia, 0, 0], X, Y, Math.PI / g2.z);
  if (t1 === "cremalheira") {
    // pinhão acima da linha primitiva, com um dente para baixo (θ = −90°) no vão da cremalheira (x = pt/2)
    return pose([g1.pt / 2, 0, par.distancia], X, Y, Math.PI / 2);
  }
  if (t1 === "conica") {
    const S = rad(a.anguloEixos);
    const H1 = g1.Re! * Math.cos(g1.delta!);
    const w2: Vec3 = [Math.sin(S), -Math.cos(S), 0]; // do vértice para a base da 2
    const c2: Vec3 = [w2[0] * g2.Re! * Math.cos(g2.delta!), H1 + w2[1] * g2.Re! * Math.cos(g2.delta!), 0];
    const u2: Vec3 = [-w2[0], -w2[1], 0];
    // do centro da base da 2 até o ponto de contato (r1, 0, 0) no primitivo
    const d = [g1.r - c2[0], -c2[1], 0];
    const n = Math.hypot(...d);
    return pose(c2, [d[0] / n, d[1] / n, 0], u2, Math.PI / g2.z);
  }
  if (t1 === "coroa") {
    // sem-fim ao longo de Z, do lado +X, na meia largura da coroa; a rosca (θ local = 0) voltada para a coroa
    const ym = a.largura / 2;
    const thetaM = (-g1.mao * ym * Math.tan(g1.beta)) / g1.r; // dente da coroa no plano médio
    const pz = g2.pz!;
    const z0 = g1.r * Math.sin(thetaM) - pz / 2;
    const k = Math.round((z0 + b.largura / 2) / pz);
    return pose([par.distancia, ym, z0 - k * pz], [-1, 0, 0], Z, 0);
  }
  throw new Error("Par sem posição definida.");
}

// ---------- documento da peça ----------

const num = (v: number) => String(Math.round(v * 1000) / 1000).replace(".", ",");

/** Nome padronizado (o mesmo conjunto de valores = o mesmo arquivo no cofre). */
export function nomeEngrenagem(p0: Partial<ParamEngrenagem>): string {
  const p = paramCompleto(p0);
  const t = p.tipoEngrenagem;
  const m = `m${num(p.modulo)}`;
  const alfa = p.angPressao !== 20 ? ` α${num(p.angPressao)}` : "";
  const x = p.deslocamento && t !== "cremalheira" && t !== "semFim" ? ` x${num(p.deslocamento)}` : "";
  const mao = p.sentido === "esquerda" ? "esq" : "dir";
  const hel = temHelice(p) && t !== "coroa" ? ` β${num(p.helice)} ${mao}` : "";
  const furo = p.furo > 0 && t !== "interna" && t !== "cremalheira" ? ` furo${num(p.furo)}${p.chaveta && chavetaDIN6885(p.furo) ? " chav" : ""}` : "";
  const cubo = p.cuboDiametro > 0 && p.cuboComprimento > 0 && (t === "reta" || t === "helicoidal" || t === "conica" || t === "coroa") ? ` cubo${num(p.cuboDiametro)}x${num(p.cuboComprimento)}` : "";
  const b = ` b${num(p.largura)}`;
  switch (t) {
    case "reta": return `Engrenagem reta ${m} z${p.dentes}${b}${alfa}${x}${furo}${cubo}`;
    case "helicoidal": return `Engrenagem helicoidal ${m} z${p.dentes}${b}${hel}${alfa}${x}${furo}${cubo}`;
    case "interna": return `Engrenagem interna ${m} z${p.dentes}${b}${hel}${alfa}${x}${p.aro > 0 ? ` aro${num(p.aro)}` : ""}`;
    case "cremalheira": return `Cremalheira ${m} L${num(p.comprimento)} h${num(p.altura)}${b}${hel}${alfa}`;
    case "conica": return `Engrenagem cônica ${m} z${p.dentes}-${p.dentesPar}${p.anguloEixos !== 90 ? ` Σ${num(p.anguloEixos)}` : ""}${b}${alfa}${x}${furo}${cubo}`;
    case "semFim": return `Sem-fim ${m} z${p.dentes} q${num(p.coefDiametro)} L${num(p.largura)} ${mao}${alfa}${furo}`;
    case "coroa": return `Coroa ${m} z${p.dentes} (sem-fim z${p.entradas} q${num(p.coefDiametro)} ${mao})${b}${alfa}${x}${furo}${cubo}`;
  }
}

/** Só os campos de ParamEngrenagem (tira id, nome etc. de um recurso). */
export function paramDe(f: Partial<ParamEngrenagem>): ParamEngrenagem {
  const p = paramCompleto({});
  for (const k of Object.keys(p) as (keyof ParamEngrenagem)[]) if (f[k] !== undefined) (p as unknown as Record<string, unknown>)[k] = f[k];
  return p;
}

/** Peça (Documento WJCAD) com um recurso "engrenagem" editável; propriedades para a lista de materiais. */
export function documentoEngrenagem(p0: Partial<ParamEngrenagem>): Documento {
  const p = paramDe(p0);
  geometria(p); // valida antes de criar
  const nome = nomeEngrenagem(p);
  const f: FeatureEngrenagem = { id: novoId(), nome: nome.split(/ m\d/)[0], suprimida: false, tipo: "engrenagem", ...p };
  const doc: Documento = { ...documentoVazio(), nome, features: [f], material: "aco-1045" };
  const { valores } = valoresCalculados(p);
  doc.propriedades = {
    descricao: nome, material: "aco-1045", grupo: "Engrenagens", biblioteca: `engrenagem-${p.tipoEngrenagem}`,
    ...Object.fromEntries(valores.slice(0, 4).map((v) => [v.rotulo, v.valor])),
  };
  return doc;
}

/** Parâmetros da engrenagem de uma peça (o 1º recurso "engrenagem" não suprimido), ou null. */
export function engrenagemDaPeca(doc: Documento): ParamEngrenagem | null {
  const f = doc.features.find((x) => x.tipo === "engrenagem" && !x.suprimida) as FeatureEngrenagem | undefined;
  return f ? paramDe(f) : null;
}

/** Parceira sugerida para o par (mesmo módulo/ângulo, hélice oposta, dentes da razão pedida). */
export function parceiraSugerida(p0: Partial<ParamEngrenagem>, dentes2: number): ParamEngrenagem {
  const p = paramDe(p0);
  const base = { ...p, dentes: dentes2, deslocamento: 0, furo: 0, chaveta: false, cuboDiametro: 0, cuboComprimento: 0 };
  switch (p.tipoEngrenagem) {
    case "reta": return base;
    case "helicoidal": return { ...base, sentido: p.sentido === "direita" ? "esquerda" : "direita" };
    case "interna": return { ...base, tipoEngrenagem: p.helice > 0 ? "helicoidal" : "reta", aro: 0 };
    case "cremalheira": return { ...base, tipoEngrenagem: p.helice > 0 ? "helicoidal" : "reta", sentido: p.sentido === "direita" ? "esquerda" : "direita" };
    case "conica": return { ...base, dentes: Math.round(p.dentesPar), dentesPar: p.dentes };
    case "semFim": return { ...base, tipoEngrenagem: "coroa", entradas: p.dentes, largura: Math.round(2 * p.modulo * Math.sqrt(p.coefDiametro + 1) * 10) / 10 };
    case "coroa": return { ...base, tipoEngrenagem: "semFim", dentes: p.entradas, largura: Math.round(p.modulo * (11 + 0.06 * p.dentes) * 10) / 10 + Math.PI * p.modulo };
  }
}
