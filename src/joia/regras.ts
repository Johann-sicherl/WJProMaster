// WJGoldDiamond: motor puro da joia (sem OpenCascade nem DOM; testado em scripts/teste-joia.ts).
// Tamanhos de aro, ligas, lapidações (contorno, proporções, quilates), perfil do aro, posição das
// gemas (cabeça e pavé), garras, contas, zonas livres (ocar, texturas), verificações e preço.
// Eixo do aro = Z; topo do anel em +Y; ângulo θ medido a partir de +Y em direção a +X.

export type P2 = [number, number];
export type V3 = [number, number, number];
export type Norma = "BR" | "ISO" | "US" | "mm";
export type Perfil = "meia-cana" | "reto" | "conforto" | "faca";
export type Lapidacao = "redonda" | "oval" | "gota" | "navete" | "princesa" | "esmeralda" | "coracao" | "almofada" | "baguete" | "trilliant";

export interface Gema {
  lapidacao: Lapidacao;
  material: string;
  /** mm; na redonda comprimento = largura = diâmetro */
  comprimento: number;
  largura: number;
}

export interface DocJoia {
  versao: 1;
  nome: string;
  liga: string;
  aro: { norma: Norma; tamanho: number; perfil: Perfil; largura: number; espessura: number; larguraBase: number; espessuraBase: number; torcao: number };
  cabeca: { ativo: boolean; tipo: "garras" | "inglesa"; gema: Gema; garras: number; diamGarra: number; elevacao: number; galeria: boolean; parede: number; girar: number };
  pave: { ativo: boolean; tipo: "garras" | "trilho"; material: string; dInicial: number; dFinal: number; espaco: number; fileiras: number; arco: number; diamGarra: number; eternidade: boolean };
  gravacao: { ativo: boolean; texto: string; altura: number; profundidade: number; lado: "interno" | "externo"; posicao: number; negrito: boolean };
  textura: { tipo: "nenhuma" | "facetas" | "frisos"; quantidade: number; profundidade: number };
  fabricacao: { ocar: boolean; parede: number; contracao: number; canais: number; diamCanal: number; compCanal: number; perda: number };
  preco: { cotacao: number; precoQuilate: number; maoDeObra: number; margem: number };
}

const RAD = Math.PI / 180;
const lim = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const num = (v: unknown, padrao: number, a = -1e9, b = 1e9) => (typeof v === "number" && Number.isFinite(v) ? lim(v, a, b) : padrao);

// ---------------------------------------------------------------------------------------------
// tamanhos de aro

export const NORMAS: Record<Norma, string> = { BR: "Brasil (aro)", ISO: "ISO 8653 (circunferência, mm)", US: "EUA", mm: "Diâmetro interno (mm)" };

/** Diâmetro interno (mm). BR ≈ circunferência − 40 mm (conferir com o calibrador da loja). */
export function diametroInterno(n: Norma, t: number): number {
  switch (n) {
    case "BR": return (40 + t) / Math.PI;
    case "ISO": return t / Math.PI;
    case "US": return 11.63 + 0.8128 * t;
    default: return t;
  }
}

export function tamanhos(d: number): Record<Norma, number> {
  const c = d * Math.PI;
  return { BR: c - 40, ISO: c, US: (d - 11.63) / 0.8128, mm: d };
}

// ---------------------------------------------------------------------------------------------
// ligas e materiais das gemas (densidades típicas; confirmar com o fornecedor)

export const LIGAS: Record<string, { nome: string; densidade: number; cor: string; garraMin: number; aroMin: number }> = {
  "au750a": { nome: "Ouro 750 (18k) amarelo", densidade: 15.5, cor: "#e3b85c", garraMin: 0.6, aroMin: 1.0 },
  "au750b": { nome: "Ouro 750 (18k) branco", densidade: 15.9, cor: "#dcdcd8", garraMin: 0.6, aroMin: 1.0 },
  "au750r": { nome: "Ouro 750 (18k) rosé", densidade: 15.1, cor: "#e2a385", garraMin: 0.6, aroMin: 1.0 },
  "au585a": { nome: "Ouro 585 (14k) amarelo", densidade: 13.1, cor: "#e6c271", garraMin: 0.6, aroMin: 1.0 },
  "au999": { nome: "Ouro 999 (24k)", densidade: 19.3, cor: "#f0c240", garraMin: 0.9, aroMin: 1.4 },
  "ag925": { nome: "Prata 925", densidade: 10.36, cor: "#d9dbde", garraMin: 0.8, aroMin: 1.2 },
  "pt950": { nome: "Platina 950", densidade: 20.7, cor: "#cfd3d6", garraMin: 0.6, aroMin: 1.0 },
  "pd950": { nome: "Paládio 950", densidade: 12.0, cor: "#cdd0d2", garraMin: 0.6, aroMin: 1.0 },
};
/** Densidade da resina calcinável (peso do modelo impresso). */
export const DENSIDADE_RESINA = 1.15;

export const MATERIAIS: Record<string, { nome: string; densidade: number; ior: number; dispersao: number; cor: string }> = {
  diamante: { nome: "Diamante", densidade: 3.52, ior: 2.417, dispersao: 0.044, cor: "#ffffff" },
  moissanita: { nome: "Moissanita", densidade: 3.21, ior: 2.65, dispersao: 0.104, cor: "#fbfbf4" },
  zirconia: { nome: "Zircônia", densidade: 5.7, ior: 2.15, dispersao: 0.06, cor: "#ffffff" },
  rubi: { nome: "Rubi", densidade: 4.0, ior: 1.77, dispersao: 0.018, cor: "#c8102e" },
  safira: { nome: "Safira", densidade: 4.0, ior: 1.77, dispersao: 0.018, cor: "#1f4fbf" },
  esmeralda: { nome: "Esmeralda", densidade: 2.72, ior: 1.58, dispersao: 0.014, cor: "#1a9a5a" },
  ametista: { nome: "Ametista", densidade: 2.65, ior: 1.55, dispersao: 0.013, cor: "#8a4fc4" },
  topazio: { nome: "Topázio azul", densidade: 3.53, ior: 1.62, dispersao: 0.014, cor: "#62b6e8" },
  agua: { nome: "Água-marinha", densidade: 2.7, ior: 1.58, dispersao: 0.014, cor: "#8fd3e8" },
};

// ---------------------------------------------------------------------------------------------
// lapidações

interface DadosLap {
  nome: string;
  /** ct = fator × C × L × profundidade total (redonda: fator × D² × prof.) */
  fator: number;
  /** frações da largura */
  mesa: number;
  coroa: number;
  pavilhao: number;
  /** escala do contorno na culaça (0 = ponta) */
  culaca: number;
  /** relação comprimento/largura padrão */
  relacao: number;
  /** ângulo da primeira garra (graus, a partir do comprimento) */
  anguloGarra: number;
  garras: number;
}
export const LAPIDACOES: Record<Lapidacao, DadosLap> = {
  redonda: { nome: "Redonda brilhante", fator: 0.0061, mesa: 0.57, coroa: 0.15, pavilhao: 0.43, culaca: 0, relacao: 1, anguloGarra: 45, garras: 4 },
  oval: { nome: "Oval", fator: 0.0062, mesa: 0.55, coroa: 0.14, pavilhao: 0.45, culaca: 0, relacao: 1.4, anguloGarra: 30, garras: 4 },
  gota: { nome: "Gota", fator: 0.00615, mesa: 0.55, coroa: 0.14, pavilhao: 0.46, culaca: 0, relacao: 1.5, anguloGarra: 0, garras: 5 },
  navete: { nome: "Navete", fator: 0.0058, mesa: 0.55, coroa: 0.14, pavilhao: 0.46, culaca: 0, relacao: 2, anguloGarra: 0, garras: 6 },
  princesa: { nome: "Princesa", fator: 0.0083, mesa: 0.68, coroa: 0.1, pavilhao: 0.58, culaca: 0, relacao: 1, anguloGarra: 45, garras: 4 },
  esmeralda: { nome: "Esmeralda (degraus)", fator: 0.0092, mesa: 0.62, coroa: 0.12, pavilhao: 0.5, culaca: 0.3, relacao: 1.4, anguloGarra: 32, garras: 4 },
  coracao: { nome: "Coração", fator: 0.0059, mesa: 0.55, coroa: 0.13, pavilhao: 0.45, culaca: 0, relacao: 1, anguloGarra: 0, garras: 5 },
  almofada: { nome: "Almofada", fator: 0.0081, mesa: 0.58, coroa: 0.14, pavilhao: 0.5, culaca: 0, relacao: 1.1, anguloGarra: 45, garras: 4 },
  baguete: { nome: "Baguete", fator: 0.00915, mesa: 0.65, coroa: 0.1, pavilhao: 0.5, culaca: 0.3, relacao: 2.5, anguloGarra: 35, garras: 4 },
  trilliant: { nome: "Trilliant", fator: 0.0057, mesa: 0.6, coroa: 0.12, pavilhao: 0.43, culaca: 0, relacao: 1, anguloGarra: 0, garras: 3 },
};

export interface Proporcoes { mesa: number; coroa: number; cintura: number; pavilhao: number; culaca: number; total: number }
export function proporcoes(g: Gema): Proporcoes {
  const d = LAPIDACOES[g.lapidacao];
  const w = Math.min(g.comprimento, g.largura);
  const coroa = d.coroa * w, cintura = 0.03 * w, pavilhao = d.pavilhao * w;
  return { mesa: d.mesa, coroa, cintura, pavilhao, culaca: d.culaca, total: coroa + cintura + pavilhao };
}

/** Peso estimado em quilates (fórmulas de mercado; outras gemas pela densidade relativa ao diamante). */
export function quilates(g: Gema): number {
  const d = LAPIDACOES[g.lapidacao];
  const p = proporcoes(g).total;
  const base = g.lapidacao === "redonda" ? d.fator * g.largura * g.largura * p : d.fator * g.comprimento * g.largura * p;
  return base * ((MATERIAIS[g.material]?.densidade ?? 3.52) / 3.52);
}

/** Diâmetro da redonda brilhante para um peso em quilates (diamante). */
export function diametroPorQuilates(ct: number): number {
  // ct = 0.0061 · D² · 0.61 D
  return Math.cbrt(ct / (0.0061 * 0.61));
}

/** Contorno da cintura (anti-horário), x ao longo do comprimento, y lateral, centrado na origem. */
export function contorno(lap: Lapidacao, C: number, L: number, n = 48): P2[] {
  const a = C / 2, b = L / 2;
  const pts: P2[] = [];
  const amostra = (f: (t: number) => P2, k = n) => {
    for (let i = 0; i < k; i++) pts.push(f((i / k) * 2 * Math.PI));
  };
  switch (lap) {
    case "redonda":
    case "oval":
      amostra((t) => [a * Math.cos(t), b * Math.sin(t)]);
      break;
    case "almofada":
      amostra((t) => {
        const c = Math.cos(t), s = Math.sin(t);
        return [a * Math.sign(c) * Math.abs(c) ** 0.5, b * Math.sign(s) * Math.abs(s) ** 0.5];
      });
      break;
    case "navete": {
      // lente: dois arcos de raio ρ com pontas em ±a
      const rho = (a * a + b * b) / (2 * b), off = rho - b;
      const al = Math.asin(a / rho);
      for (let i = 0; i < n / 2; i++) { const t = -al + (2 * al * i) / (n / 2); pts.push([rho * Math.sin(t), rho * Math.cos(t) - off]); }
      for (let i = 0; i < n / 2; i++) { const t = -al + (2 * al * i) / (n / 2); pts.push([-rho * Math.sin(t), -(rho * Math.cos(t) - off)]); }
      pts.reverse();
      break;
    }
    case "gota": {
      // ponta em +x, ponta redonda (raio b) em −x
      const cx = -a + b;
      const k = Math.round(n / 2);
      for (let i = 0; i <= k; i++) { const t = Math.PI / 2 + (Math.PI * i) / k; pts.push([cx + b * Math.cos(t), b * Math.sin(t)]); }
      for (let i = 1; i < k; i++) { const u = i / k; pts.push([cx + (a - cx) * u, -b * (1 - u ** 1.6)]); }
      pts.push([a, 0]);
      for (let i = k - 1; i >= 1; i--) { const u = i / k; pts.push([cx + (a - cx) * u, b * (1 - u ** 1.6)]); }
      break;
    }
    case "coracao": {
      // curva clássica do coração, ponta em +x
      const raw: P2[] = [];
      for (let i = 0; i < n; i++) {
        const t = (i / n) * 2 * Math.PI;
        const x = 16 * Math.sin(t) ** 3, y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
        raw.push([-y, x]);
      }
      const xs = raw.map((p) => p[0]), ys = raw.map((p) => p[1]);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      for (const [x, y] of raw) pts.push([((x - x0) / (x1 - x0) - 0.5) * C, ((y - y0) / (y1 - y0) - 0.5) * L]);
      if (area(pts) < 0) pts.reverse();
      break;
    }
    case "princesa":
    case "baguete": {
      const c = 0.04 * Math.min(a, b);
      pts.push([a, -b + c], [a, b - c], [a - c, b], [-a + c, b], [-a, b - c], [-a, -b + c], [-a + c, -b], [a - c, -b]);
      break;
    }
    case "esmeralda": {
      const c = 0.18 * Math.min(C, L);
      pts.push([a, -b + c], [a, b - c], [a - c, b], [-a + c, b], [-a, b - c], [-a, -b + c], [-a + c, -b], [a - c, -b]);
      break;
    }
    case "trilliant": {
      // triângulo com lados levemente curvos, ponta em +x
      const v: P2[] = [[a, 0], [-a, b], [-a, -b]];
      const k = Math.max(4, Math.round(n / 3));
      for (let s = 0; s < 3; s++) {
        const p = v[s], q = v[(s + 1) % 3];
        const mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2;
        const nx = mx, ny = my, nn = Math.hypot(nx, ny) || 1;
        const bojo = 0.08 * Math.hypot(q[0] - p[0], q[1] - p[1]);
        for (let i = 0; i < k; i++) {
          const u = i / k, f = 4 * u * (1 - u);
          pts.push([p[0] + (q[0] - p[0]) * u + (nx / nn) * bojo * f, p[1] + (q[1] - p[1]) * u + (ny / nn) * bojo * f]);
        }
      }
      if (area(pts) < 0) pts.reverse();
      // os lados abaulados passam da caixa: volta às medidas C × L
      const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      for (const q of pts) { q[0] = -a + ((q[0] - x0) / (x1 - x0)) * C; q[1] = -b + ((q[1] - y0) / (y1 - y0)) * L; }
      break;
    }
  }
  return pts;
}

export function area(p: P2[]): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) { const [x0, y0] = p[i], [x1, y1] = p[(i + 1) % p.length]; s += x0 * y1 - x1 * y0; }
  return s / 2;
}

/** Distância do centro até o contorno na direção φ (rad). */
export function raioNaDirecao(pts: P2[], phi: number): number {
  const dx = Math.cos(phi), dy = Math.sin(phi);
  let melhor = 0;
  for (let i = 0; i < pts.length; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length];
    const ex = bx - ax, ey = by - ay;
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = (ax * ey - ay * ex) / den, u = (ax * dy - ay * dx) / den;
    if (t > 0 && u >= -1e-9 && u <= 1 + 1e-9) melhor = Math.max(melhor, t);
  }
  return melhor;
}

// ---------------------------------------------------------------------------------------------
// perfil do aro (u = radial a partir da superfície interna, v = ao longo do eixo Z)

/** Largura e espessura no ângulo θ (rad): interpolação do topo (θ=0) para a base (θ=π). */
export function secao(a: DocJoia["aro"], th: number): { w: number; t: number } {
  const f = (1 + Math.cos(th)) / 2;
  return { w: a.larguraBase + (a.largura - a.larguraBase) * f, t: a.espessuraBase + (a.espessura - a.espessuraBase) * f };
}

/** Altura da superfície externa do perfil na posição lateral v (|v| ≤ w/2). */
export function uExterno(p: Perfil, w: number, t: number, v: number): number {
  const h = w / 2, x = Math.min(Math.abs(v), h);
  const arco = (e: number) => {
    const tt = t - e, c = (tt * tt - h * h) / (2 * tt), r = tt - c;
    return e + c + Math.sqrt(Math.max(0, r * r - x * x));
  };
  switch (p) {
    case "reto": return t;
    case "meia-cana": return arco(0);
    case "conforto": return arco(0.25 * t);
    case "faca": return 0.4 * t + 0.6 * t * (1 - x / h);
  }
}

/** Altura da superfície interna (só o conforto é abaulado por dentro). */
export function uInterno(p: Perfil, w: number, t: number, v: number): number {
  if (p !== "conforto") return 0;
  const h = w / 2, e = 0.25 * t, x = Math.min(Math.abs(v), h);
  // arco por (e, ±h) e (0, 0), côncavo para o dedo
  const c = (h * h + e * e) / (2 * e);
  return c - Math.sqrt(Math.max(0, c * c - x * x));
}

/** Com torção o aro é feito por loft de seções; sem torção, pelo perfil do topo (analítico). */
export const porLoft = (a: DocJoia["aro"]) => torcaoEfetiva(a) !== 0;

/**
 * Altura da superfície externa (a partir do Ø interno) em θ e na posição lateral v. Sem torção o
 * aro afunilado é o perfil do topo descendo (eixo excêntrico) e cortado nas laterais por planos.
 */
export function superficie(a: DocJoia["aro"], th: number, v: number): number {
  const s = secao(a, th);
  return porLoft(a) ? uExterno(a.perfil, s.w, s.t, v) : uExterno(a.perfil, a.largura, a.espessura, v) - (a.espessura - s.t);
}

export function superficieInterna(a: DocJoia["aro"], th: number, v: number): number {
  const s = secao(a, th);
  return porLoft(a) ? uInterno(a.perfil, s.w, s.t, v) : uInterno(a.perfil, a.largura, a.espessura, v);
}

/** Pontos do perfil (para a torção e testes), anti-horário em (u, v). */
export function pontosPerfil(p: Perfil, w: number, t: number, n = 24): P2[] {
  const h = w / 2, pts: P2[] = [];
  for (let i = 0; i <= n; i++) { const v = -h + (w * i) / n; pts.push([uExterno(p, w, t, v), v]); }
  if (p === "faca") pts.splice(0, pts.length, [0.4 * t, -h], [t, 0], [0.4 * t, h]);
  if (p === "conforto") for (let i = n; i >= 0; i--) { const v = -h + (w * i) / n; pts.push([uInterno(p, w, t, v), v]); }
  else pts.push([0, h], [0, -h]);
  return pts;
}

/** Torção efetiva em meias-voltas: perfis sem simetria de 180° só aceitam voltas inteiras. */
export function torcaoEfetiva(a: DocJoia["aro"]): number {
  const n = Math.round(a.torcao);
  return a.perfil === "reto" ? n : 2 * Math.round(n / 2);
}

// ---------------------------------------------------------------------------------------------
// posição das gemas: referencial {p, rz, ry}: gira em Y (ry), depois em Z (rz), depois translada p.
// Local da gema: cintura de y = 0 a y = cintura, coroa para +y, pavilhão para −y; comprimento em x.

export interface Referencial { p: V3; rz: number; ry: number }
export interface GemaPosta { gema: Gema; ref: Referencial; passagem: "coroa" | "reta"; ct: number }
export interface Haste { base: V3; topo: V3; r: number }
export interface Galeria { y: number; escalaFora: number; escalaDentro: number; altura: number }
export interface Trilho { a0: number; a1: number; v: number; rBase: number; rTopo: number; espessura: number }
export interface Montagem {
  R: number;
  cabeca?: GemaPosta;
  garras: Haste[];
  galeria?: Galeria;
  inglesa?: { yBase: number; yTopo: number; escala: number; escalaFuro: number };
  pave: GemaPosta[];
  contas: Haste[];
  trilhos: Trilho[];
  /** zonas ocupadas no topo (graus, ±) */
  zonaCabeca: number;
  zonaPave: number;
  descartadas: number;
  avisos: string[];
}

const raio3 = (th: number, r: number, v: number): V3 => [r * Math.sin(th), r * Math.cos(th), v];

export function montar(d: DocJoia): Montagem {
  const a = d.aro;
  const R = diametroInterno(a.norma, a.tamanho) / 2;
  const s0 = secao(a, 0);
  const m: Montagem = { R, garras: [], pave: [], contas: [], trilhos: [], zonaCabeca: 0, zonaPave: 0, descartadas: 0, avisos: [] };
  let meiaCabeca = 0; // meia extensão tangencial da cabeça (mm, na superfície do topo)

  if (d.cabeca.ativo) {
    const c = d.cabeca, g = c.gema, pr = proporcoes(g), lap = LAPIDACOES[g.lapidacao];
    const yg = R + s0.t + c.elevacao;
    const ry = c.girar * RAD;
    m.cabeca = { gema: g, ref: { p: [0, yg, 0], rz: 0, ry }, passagem: c.tipo === "garras" ? "coroa" : "reta", ct: quilates(g) };
    const cont = contorno(g.lapidacao, g.comprimento, g.largura);
    const yb = R + s0.t * 0.5;
    const extX = Math.abs(Math.cos(ry)) * g.comprimento / 2 + Math.abs(Math.sin(ry)) * g.largura / 2;
    const extZ = Math.abs(Math.sin(ry)) * g.comprimento / 2 + Math.abs(Math.cos(ry)) * g.largura / 2;
    if (c.tipo === "garras") {
      const dg = c.diamGarra, n = Math.max(2, Math.round(c.garras));
      const rb = Math.max(0.2, Math.min(0.45 * Math.min(g.comprimento, g.largura) / 2, s0.w / 2 - dg / 2 - 0.05));
      const yTopo = yg + pr.cintura + pr.coroa * 0.55;
      let soma = 0;
      for (let k = 0; k < n; k++) {
        const phi = (lap.anguloGarra + (360 * k) / n) * RAD;
        const rc = raioNaDirecao(cont, phi) + dg * 0.25;
        soma += rc;
        // direção local (x ao longo do comprimento, y lateral → −Z no mundo antes do giro)
        const lx = Math.cos(phi), lz = -Math.sin(phi);
        const wx = lx * Math.cos(ry) + lz * Math.sin(ry), wz = -lx * Math.sin(ry) + lz * Math.cos(ry);
        m.garras.push({ base: [wx * rb, yb, wz * rb], topo: [wx * rc, yTopo, wz * rc], r: dg / 2 });
      }
      if (c.galeria) {
        const rTopo = soma / n, yGal = yg - pr.pavilhao * 0.45;
        const lam = (yTopo - yGal) / (yTopo - yb);
        const rho = rTopo + (rb - rTopo) * lam;
        const rMed = rTopo - dg * 0.25;
        const s = rho / rMed, e = (dg * 0.35) / rMed;
        if (s - e > 0.1) m.galeria = { y: yGal, escalaFora: s + e, escalaDentro: s - e, altura: dg * 0.7 };
      }
      meiaCabeca = extX + dg;
    } else {
      const rMed = Math.min(g.comprimento, g.largura) / 2;
      m.inglesa = { yBase: yb, yTopo: yg + pr.cintura + pr.coroa * 0.4, escala: 1 + c.parede / rMed, escalaFuro: 0.8 };
      meiaCabeca = extX + c.parede;
    }
    if (extZ * 2 > s0.w * 3) m.avisos.push("A gema central é muito mais larga que o aro: confira a cesta.");
    m.zonaCabeca = (meiaCabeca / (R + s0.t)) / RAD + 4;
  }

  if (d.pave.ativo) posicionarPave(d, m, meiaCabeca);
  return m;
}

function posicionarPave(d: DocJoia, m: Montagem, meiaCabeca: number) {
  const a = d.aro, p = d.pave, R = m.R;
  const gema = (D: number): Gema => ({ lapidacao: "redonda", material: p.material, comprimento: D, largura: D });
  const dMax = Math.max(p.dInicial, p.dFinal);
  const nf = Math.max(1, Math.min(5, Math.round(p.fileiras)));
  const passoV = dMax + p.espaco;
  const fileiras = Array.from({ length: nf }, (_, j) => (j - (nf - 1) / 2) * passoV);
  const thMax = (p.eternidade ? 180 : Math.min(180, p.arco / 2)) * RAD;
  const rc = (th: number, v: number, D: number) => {
    const pr = proporcoes(gema(D));
    return R + superficie(a, th, v) - pr.coroa - pr.cintura - 0.05;
  };
  const cabe = (th: number, v: number, D: number) => Math.abs(v) + D / 2 + 0.2 <= secao(a, th).w / 2;
  const angulos: { th: number; D: number }[] = [];
  const r0 = R + secao(a, 0).t;
  const thIni = meiaCabeca > 0 ? meiaCabeca / r0 + (p.espaco + 0.1) / r0 : 0;
  const tamanho = (th: number) => {
    if (p.eternidade) return p.dInicial;
    const f = thMax > thIni ? lim((th - thIni) / (thMax - thIni), 0, 1) : 0;
    return p.dInicial + (p.dFinal - p.dInicial) * f;
  };
  if (p.eternidade && meiaCabeca === 0) {
    const D = p.dInicial, r = rc(Math.PI / 2, 0, D) + D * 0.3;
    const n = Math.max(1, Math.floor((2 * Math.PI * r) / (D + p.espaco)));
    for (let i = 0; i < n; i++) angulos.push({ th: (2 * Math.PI * i) / n, D });
  } else {
    // um lado; o outro é espelhado
    let D = tamanho(thIni), th = thIni + (meiaCabeca > 0 ? D / 2 / r0 : 0);
    let guarda = 0;
    while (th + D / 2 / r0 <= thMax + 1e-9 && guarda++ < 400) {
      angulos.push({ th, D });
      if (th > 0) angulos.push({ th: -th, D });
      const r = rc(th, 0, D) + D * 0.3;
      const Dn = tamanho(th + (D + p.espaco) / r);
      th += (D / 2 + p.espaco + Dn / 2) / r;
      D = Dn;
    }
  }
  // fileiras, encaixe lateral e colisões (as mais próximas do topo têm prioridade)
  angulos.sort((x, y) => Math.abs(x.th) - Math.abs(y.th));
  const centros: { c: V3; r: number }[] = [];
  for (const { th, D } of angulos) {
    for (const v of fileiras) {
      if (!cabe(th, v, D)) { m.descartadas++; continue; }
      const r = rc(th, v, D);
      const pr = proporcoes(gema(D));
      const c = raio3(th, r + pr.cintura / 2, v);
      if (centros.some((o) => Math.hypot(o.c[0] - c[0], o.c[1] - c[1], o.c[2] - c[2]) < o.r + D / 2 + 0.05)) { m.descartadas++; continue; }
      centros.push({ c, r: D / 2 });
      m.pave.push({ gema: gema(D), ref: { p: raio3(th, r, v), rz: -th, ry: 0 }, passagem: "reta", ct: quilates(gema(D)) });
    }
  }
  if (m.descartadas) m.avisos.push(`${m.descartadas} posição(ões) do pavé ficaram de fora (não cabem na largura do aro ou colidem).`);
  const ths = m.pave.map((g) => Math.abs(Math.atan2(g.ref.p[0], g.ref.p[1])));
  m.zonaPave = ths.length ? Math.max(...ths) / RAD + (dMax / 2 + 0.5) / r0 / RAD : 0;
  for (const g of m.pave) {
    const pr = proporcoes(g.gema), r = Math.hypot(g.ref.p[0], g.ref.p[1]);
    if (r - pr.pavilhao < R + 0.15) { m.avisos.push("Pedras do pavé fundas demais para a espessura do aro: aumente a espessura ou reduza o diâmetro."); break; }
  }
  if (p.tipo === "garras") contas(d, m);
  else trilhos(d, m, fileiras, dMax);
}

/** Contas (garrinhas) entre pedras vizinhas de cada fileira e nas pontas. */
function contas(d: DocJoia, m: Montagem) {
  const rb = d.pave.diamGarra / 2;
  const porFileira = new Map<number, { th: number; r: number; D: number; v: number }[]>();
  for (const g of m.pave) {
    const v = Math.round(g.ref.p[2] * 1000) / 1000;
    const th = Math.atan2(g.ref.p[0], g.ref.p[1]);
    const lista = porFileira.get(v) ?? [];
    lista.push({ th, r: Math.hypot(g.ref.p[0], g.ref.p[1]), D: g.gema.largura, v });
    porFileira.set(v, lista);
  }
  const pts: { th: number; r: number; v: number; D: number }[] = [];
  const voltaInteira = d.pave.eternidade && !d.cabeca.ativo;
  for (const lista of porFileira.values()) {
    lista.sort((x, y) => x.th - y.th);
    const n = lista.length;
    for (let i = 0; i < (voltaInteira ? n : n - 1); i++) {
      const g1 = lista[i], g2 = lista[(i + 1) % n];
      let dth = g2.th - g1.th;
      if (dth <= 0) dth += 2 * Math.PI;
      const r = (g1.r + g2.r) / 2, D = (g1.D + g2.D) / 2;
      // salta o vão da cabeça (vizinhas de lados opostos do topo)
      if (d.cabeca.ativo && g1.th < 0 && g2.th > 0) {
        pts.push({ th: g1.th + (g1.D / 2 + rb * 0.5) / r, r, v: g1.v, D: g1.D }, { th: g2.th - (g2.D / 2 + rb * 0.5) / r, r, v: g2.v, D: g2.D });
        continue;
      }
      const meio = g1.th + dth / 2, s = (dth * r) / 2;
      const dc = D / 2 + rb * 0.5;
      const lat = dc > s ? Math.sqrt(dc * dc - s * s) : 0;
      if (lat === 0) pts.push({ th: meio, r, v: g1.v, D });
      else pts.push({ th: meio, r, v: g1.v + lat, D }, { th: meio, r, v: g1.v - lat, D });
    }
    if (!voltaInteira && n) {
      const f = lista[0], l = lista[n - 1];
      pts.push({ th: f.th - (f.D / 2 + rb * 0.5) / f.r, r: f.r, v: f.v, D: f.D }, { th: l.th + (l.D / 2 + rb * 0.5) / l.r, r: l.r, v: l.v, D: l.D });
    }
  }
  const aceitas: Haste[] = [];
  for (const q of pts) {
    const s = secao(d.aro, q.th);
    if (Math.abs(q.v) + rb > s.w / 2) continue;
    const pr = proporcoes({ lapidacao: "redonda", material: "diamante", comprimento: q.D, largura: q.D });
    // conta = esfera com o centro na altura da mesa (metade para fora)
    const base = raio3(q.th, q.r, q.v);
    const topo = raio3(q.th, q.r + pr.cintura + pr.coroa, q.v);
    if (aceitas.some((o) => Math.hypot(o.topo[0] - topo[0], o.topo[1] - topo[1], o.topo[2] - topo[2]) < 2 * rb + 0.05)) continue;
    aceitas.push({ base, topo, r: rb });
  }
  m.contas = aceitas;
}

function trilhos(d: DocJoia, m: Montagem, fileiras: number[], dMax: number) {
  if (!m.pave.length) return;
  const esp = Math.max(0.3, d.pave.diamGarra);
  const ths = m.pave.map((g) => Math.atan2(g.ref.p[0], g.ref.p[1]));
  const rs = m.pave.map((g) => Math.hypot(g.ref.p[0], g.ref.p[1]));
  const rMin = Math.min(...rs), rMax = Math.max(...rs);
  const pr = proporcoes({ lapidacao: "redonda", material: "diamante", comprimento: dMax, largura: dMax });
  const vExt = Math.max(...fileiras.map(Math.abs)) + dMax / 2 + esp / 2 - 0.1;
  const margem = (dMax / 2 + esp) / rMin;
  const lados: [number, number][] = [];
  const voltaInteira = d.pave.eternidade && !d.cabeca.ativo;
  if (voltaInteira) lados.push([0, 2 * Math.PI]);
  else {
    const pos = ths.filter((t) => t >= -1e-9), neg = ths.filter((t) => t < -1e-9);
    if (!d.cabeca.ativo) lados.push([Math.min(...ths) - margem, Math.max(...ths) + margem]);
    else {
      if (pos.length) lados.push([Math.min(...pos) - margem, Math.max(...pos) + margem]);
      if (neg.length) lados.push([Math.min(...neg) - margem, Math.max(...neg) + margem]);
    }
  }
  for (const [a0, a1] of lados)
    for (const v of [vExt, -vExt]) {
      if (vExt + esp / 2 > secao(d.aro, 0).w / 2 + esp) m.avisos.push("Trilho mais largo que o aro: as paredes ficam para fora.");
      m.trilhos.push({ a0, a1, v, rBase: rMin - pr.pavilhao * 0.5, rTopo: rMax + pr.cintura + pr.coroa + 0.15, espessura: esp });
    }
  m.avisos = [...new Set(m.avisos)];
}

// ---------------------------------------------------------------------------------------------
// zonas livres (graus, θ em [0, 360)) para ocar e texturas

export function intervalosLivres(ocupadas: [number, number][], minimo = 10): [number, number][] {
  const z = ocupadas.flatMap(([c, h]) => {
    const a = c - h, b = c + h;
    if (h >= 180) return [[0, 360]] as [number, number][];
    const n = (x: number) => ((x % 360) + 360) % 360;
    const na = n(a), nb = n(b);
    return (na <= nb ? [[na, nb]] : [[na, 360], [0, nb]]) as [number, number][];
  }).sort((x, y) => x[0] - y[0]);
  const livres: [number, number][] = [];
  let pos = 0;
  for (const [a, b] of z) {
    if (a > pos) livres.push([pos, a]);
    pos = Math.max(pos, b);
  }
  if (pos < 360) livres.push([pos, 360]);
  // junta o que atravessa 0°
  if (livres.length > 1 && livres[0][0] === 0 && livres[livres.length - 1][1] === 360) {
    const ult = livres.pop()!;
    livres[0] = [ult[0] - 360, livres[0][1]];
  }
  return livres.filter(([a, b]) => b - a >= minimo);
}

/** Zonas ocupadas (centro, meia abertura em graus): cabeça, pavé e gravação interna (opcional). */
export function zonasOcupadas(d: DocJoia, m: Montagem, comprimentoTexto: number, incluirInterna: boolean): [number, number][] {
  const z: [number, number][] = [];
  if (m.zonaCabeca) z.push([0, m.zonaCabeca + 6]);
  if (m.zonaPave) z.push([0, m.zonaPave + 4]);
  if (d.gravacao.ativo && comprimentoTexto > 0 && (incluirInterna ? d.gravacao.lado === "interno" : d.gravacao.lado === "externo")) {
    const r = d.gravacao.lado === "interno" ? m.R : m.R + secao(d.aro, d.gravacao.posicao * RAD).t;
    z.push([d.gravacao.posicao, (comprimentoTexto / 2 / r) / RAD + 4]);
  }
  return z;
}

/** g (graus) dentro de [a, b], com a podendo ser negativo (faixa que atravessa 0°). */
export const naFaixa = (g: number, a: number, b: number) => [g, g - 360, g + 360].some((x) => x >= a && x <= b);

/** Polígono convexo (XY) = interseção dos semiplanos das facetas; facetas fora das zonas livres não cortam. */
export function poligonoFacetas(d: DocJoia, m: Montagem, livres: [number, number][]): P2[] | null {
  const n = Math.max(5, Math.round(d.textura.quantidade));
  const dentro = (g: number) => livres.some(([a, b]) => naFaixa(g, a, b));
  let poli: P2[] = [[-100, -100], [100, -100], [100, 100], [-100, 100]];
  let cortou = false;
  for (let k = 0; k < n; k++) {
    const g = (360 * k) / n;
    const passo = 360 / n / 2;
    if (!dentro(g) || !dentro(g - passo + 0.01) || !dentro(g + passo - 0.01)) continue;
    const th = g * RAD, s = secao(d.aro, th);
    const ap = m.R + s.t - d.textura.profundidade;
    const nx = Math.sin(th), ny = Math.cos(th);
    poli = recortar(poli, nx, ny, ap);
    cortou = true;
  }
  return cortou ? poli : null;
}

/** Sutherland–Hodgman: mantém n·p ≤ c. */
function recortar(p: P2[], nx: number, ny: number, c: number): P2[] {
  const out: P2[] = [];
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length];
    const da = nx * a[0] + ny * a[1] - c, db = nx * b[0] + ny * b[1] - c;
    if (da <= 0) out.push(a);
    if (da * db < 0) { const t = da / (da - db); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
  }
  return out;
}

/** Ângulos (graus) dos frisos nas zonas livres. */
export function angulosFrisos(d: DocJoia, livres: [number, number][]): number[] {
  const n = Math.max(1, Math.round(d.textura.quantidade));
  const out: number[] = [];
  for (let k = 0; k < n; k++) {
    const g = (360 * k) / n;
    if (livres.some(([a, b]) => naFaixa(g, a + 1, b - 1))) out.push(g);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// gravação: contornos das letras → grupos (contorno externo + furos)

export interface GrupoTexto { x: number; contornos: P2[][] }

function dentroPoli(p: P2, poli: P2[]): boolean {
  let c = false;
  for (let i = 0, j = poli.length - 1; i < poli.length; j = i++) {
    const [xi, yi] = poli[i], [xj, yj] = poli[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** Agrupa laços por aninhamento (par = externo, ímpar = furo do pai). Coordenadas centradas no texto. */
export function agruparLacos(lacos: P2[][]): { grupos: GrupoTexto[]; largura: number } {
  const ok = lacos.filter((l) => l.length >= 3 && Math.abs(area(l)) > 1e-6);
  if (!ok.length) return { grupos: [], largura: 0 };
  const xs = ok.flat().map((p) => p[0]), ys = ok.flat().map((p) => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const L = ok.map((l) => l.map(([x, y]) => [x - cx, y - cy] as P2));
  const ar = L.map((l) => Math.abs(area(l)));
  const pais = L.map((l, i) => L.map((o, j) => j).filter((j) => j !== i && ar[j] > ar[i] && dentroPoli(l[0], L[j])));
  const grupos: GrupoTexto[] = [];
  const idx = new Map<number, number>();
  L.forEach((l, i) => {
    if (pais[i].length % 2 === 0) {
      const lx = l.map((p) => p[0]);
      idx.set(i, grupos.length);
      grupos.push({ x: (Math.min(...lx) + Math.max(...lx)) / 2, contornos: [l] });
    }
  });
  L.forEach((l, i) => {
    if (pais[i].length % 2 === 1) {
      const pai = pais[i].reduce((m, j) => (ar[j] < ar[m] ? j : m), pais[i][0]);
      const g = idx.get(pai);
      if (g !== undefined) grupos[g].contornos.push(l);
    }
  });
  for (const g of grupos) g.contornos = g.contornos.map((c) => c.map(([x, y]) => [x - g.x, y] as P2));
  return { grupos, largura: Math.max(...xs) - Math.min(...xs) };
}

// ---------------------------------------------------------------------------------------------
// verificações de fabricação, ficha técnica e preço

export function verificar(d: DocJoia, m: Montagem, comprimentoTexto: number): string[] {
  const av = [...m.avisos];
  const liga = LIGAS[d.liga] ?? LIGAS.au750a;
  const a = d.aro;
  const tMin = Math.min(a.espessura, a.espessuraBase), wMin = Math.min(a.largura, a.larguraBase);
  if (tMin < liga.aroMin) av.push(`Espessura mínima do aro ${tMin.toFixed(2)} mm abaixo de ${liga.aroMin} mm para ${liga.nome}.`);
  if (wMin < 1.5) av.push(`Largura mínima do aro ${wMin.toFixed(2)} mm: abaixo de 1,5 mm o aro deforma.`);
  if (d.cabeca.ativo && d.cabeca.tipo === "garras" && d.cabeca.diamGarra < liga.garraMin) av.push(`Garras de ${d.cabeca.diamGarra} mm: mínimo recomendado ${liga.garraMin} mm em ${liga.nome}.`);
  if (d.cabeca.ativo && d.cabeca.tipo === "inglesa" && d.cabeca.parede < 0.4) av.push("Parede da inglesa abaixo de 0,4 mm: risco de falha na fundição.");
  if (d.pave.ativo && d.pave.tipo === "garras" && d.pave.diamGarra < 0.35) av.push("Contas do pavé abaixo de 0,35 mm: difíceis de imprimir e fundir.");
  if (d.pave.ativo && d.pave.dInicial < 0.8) av.push("Pedras abaixo de 0,8 mm: micropavé exige impressora de alta resolução.");
  if (a.torcao && torcaoEfetiva(a) !== Math.round(a.torcao)) av.push(`Perfil ${a.perfil}: torção arredondada para ${torcaoEfetiva(a) / 2} volta(s) inteira(s).`);
  if (d.gravacao.ativo) {
    if (d.gravacao.profundidade > tMin / 3) av.push("Gravação mais funda que 1/3 da espessura: enfraquece o aro.");
    if (d.gravacao.altura > wMin - 0.4) av.push("Altura das letras maior que a largura útil do aro.");
    if (comprimentoTexto > Math.PI * m.R * 1.6) av.push("Texto longo demais para dar a volta no aro.");
    if (d.gravacao.altura < 0.6) av.push("Letras abaixo de 0,6 mm ficam ilegíveis depois do polimento.");
  }
  if (d.fabricacao.contracao < 0 || d.fabricacao.contracao > 5) av.push("Contração fora da faixa usual (0 a 5 %).");
  return [...new Set(av)];
}

export interface Ficha {
  gemas: { descricao: string; quantidade: number; ctUnit: number; ctTotal: number }[];
  ctTotal: number;
  volume: number;
  peso: number;
  pesoResina: number;
  pesoComPerda: number;
  custoMetal: number;
  custoGemas: number;
  custo: number;
  venda: number;
  diametro: number;
}

export function ficha(d: DocJoia, m: Montagem, volume: number): Ficha {
  const liga = LIGAS[d.liga] ?? LIGAS.au750a;
  const todas = [...(m.cabeca ? [m.cabeca] : []), ...m.pave];
  const mapa = new Map<string, { descricao: string; quantidade: number; ctUnit: number; ctTotal: number }>();
  for (const g of todas) {
    const x = g.gema;
    const dims = x.lapidacao === "redonda" ? `${x.largura.toFixed(2)} mm` : `${x.comprimento.toFixed(2)} × ${x.largura.toFixed(2)} mm`;
    const k = `${MATERIAIS[x.material]?.nome ?? x.material} ${LAPIDACOES[x.lapidacao].nome.toLowerCase()} ${dims}`;
    const e = mapa.get(k) ?? { descricao: k, quantidade: 0, ctUnit: g.ct, ctTotal: 0 };
    e.quantidade++;
    e.ctTotal += g.ct;
    mapa.set(k, e);
  }
  const gemas = [...mapa.values()];
  const ctTotal = gemas.reduce((s, g) => s + g.ctTotal, 0);
  const peso = (volume / 1000) * liga.densidade;
  const pesoComPerda = peso * (1 + d.fabricacao.perda / 100);
  const custoMetal = pesoComPerda * d.preco.cotacao;
  const custoGemas = ctTotal * d.preco.precoQuilate;
  const custo = custoMetal + custoGemas + d.preco.maoDeObra;
  return {
    gemas, ctTotal, volume, peso, pesoResina: (volume / 1000) * DENSIDADE_RESINA, pesoComPerda, custoMetal, custoGemas, custo,
    venda: custo * (1 + d.preco.margem / 100), diametro: 2 * m.R,
  };
}

// ---------------------------------------------------------------------------------------------
// documento

export function docNovo(): DocJoia {
  return {
    versao: 1, nome: "Joia sem nome", liga: "au750a",
    aro: { norma: "BR", tamanho: 16, perfil: "conforto", largura: 2.4, espessura: 1.7, larguraBase: 2.4, espessuraBase: 1.7, torcao: 0 },
    cabeca: { ativo: true, tipo: "garras", gema: { lapidacao: "redonda", material: "diamante", comprimento: 5.2, largura: 5.2 }, garras: 4, diamGarra: 0.8, elevacao: 1.8, galeria: true, parede: 0.6, girar: 0 },
    pave: { ativo: false, tipo: "garras", material: "diamante", dInicial: 1.5, dFinal: 1.1, espaco: 0.15, fileiras: 1, arco: 120, diamGarra: 0.45, eternidade: false },
    gravacao: { ativo: false, texto: "Para sempre", altura: 1.2, profundidade: 0.2, lado: "interno", posicao: 180, negrito: false },
    textura: { tipo: "nenhuma", quantidade: 16, profundidade: 0.25 },
    fabricacao: { ocar: false, parede: 0.6, contracao: 0, canais: 1, diamCanal: 1.6, compCanal: 6, perda: 5 },
    preco: { cotacao: 0, precoQuilate: 0, maoDeObra: 0, margem: 0 },
  };
}

const umDe = <T extends string>(v: unknown, ops: readonly T[], p: T): T => (ops.includes(v as T) ? (v as T) : p);

/** Valida e completa um documento lido (valores fora da faixa voltam ao limite). */
export function validarDoc(x: unknown): DocJoia {
  if (!x || typeof x !== "object") throw new Error("Arquivo de joia inválido.");
  const o = x as Record<string, any>;
  const n = docNovo();
  const g = (v: any, p: Gema): Gema => ({
    lapidacao: umDe(v?.lapidacao, Object.keys(LAPIDACOES) as Lapidacao[], p.lapidacao),
    material: typeof v?.material === "string" && MATERIAIS[v.material] ? v.material : p.material,
    comprimento: num(v?.comprimento, p.comprimento, 0.5, 40), largura: num(v?.largura, p.largura, 0.5, 40),
  });
  const a = o.aro ?? {}, c = o.cabeca ?? {}, pv = o.pave ?? {}, gr = o.gravacao ?? {}, tx = o.textura ?? {}, f = o.fabricacao ?? {}, pr = o.preco ?? {};
  const doc: DocJoia = {
    versao: 1,
    nome: typeof o.nome === "string" && o.nome.trim() ? o.nome : n.nome,
    liga: typeof o.liga === "string" && LIGAS[o.liga] ? o.liga : n.liga,
    aro: {
      norma: umDe(a.norma, ["BR", "ISO", "US", "mm"] as const, n.aro.norma),
      tamanho: num(a.tamanho, n.aro.tamanho, 0, 80), perfil: umDe(a.perfil, ["meia-cana", "reto", "conforto", "faca"] as const, n.aro.perfil),
      largura: num(a.largura, n.aro.largura, 0.8, 25), espessura: num(a.espessura, n.aro.espessura, 0.5, 8),
      larguraBase: num(a.larguraBase, num(a.largura, n.aro.larguraBase, 0.8, 25), 0.8, 25), espessuraBase: num(a.espessuraBase, num(a.espessura, n.aro.espessuraBase, 0.5, 8), 0.5, 8),
      torcao: Math.round(num(a.torcao, 0, 0, 8)),
    },
    cabeca: {
      ativo: !!(c.ativo ?? n.cabeca.ativo), tipo: umDe(c.tipo, ["garras", "inglesa"] as const, n.cabeca.tipo), gema: g(c.gema, n.cabeca.gema),
      garras: Math.round(num(c.garras, n.cabeca.garras, 2, 8)), diamGarra: num(c.diamGarra, n.cabeca.diamGarra, 0.3, 3), elevacao: num(c.elevacao, n.cabeca.elevacao, 0, 10),
      galeria: !!(c.galeria ?? true), parede: num(c.parede, n.cabeca.parede, 0.2, 3), girar: num(c.girar, 0, 0, 180),
    },
    pave: {
      ativo: !!pv.ativo, tipo: umDe(pv.tipo, ["garras", "trilho"] as const, n.pave.tipo), material: typeof pv.material === "string" && MATERIAIS[pv.material] ? pv.material : n.pave.material,
      dInicial: num(pv.dInicial, n.pave.dInicial, 0.5, 6), dFinal: num(pv.dFinal, n.pave.dFinal, 0.5, 6), espaco: num(pv.espaco, n.pave.espaco, 0.05, 2),
      fileiras: Math.round(num(pv.fileiras, 1, 1, 5)), arco: num(pv.arco, n.pave.arco, 10, 360), diamGarra: num(pv.diamGarra, n.pave.diamGarra, 0.2, 1.5), eternidade: !!pv.eternidade,
    },
    gravacao: {
      ativo: !!gr.ativo, texto: typeof gr.texto === "string" ? gr.texto.slice(0, 60) : n.gravacao.texto, altura: num(gr.altura, n.gravacao.altura, 0.3, 10),
      profundidade: num(gr.profundidade, n.gravacao.profundidade, 0.05, 2), lado: umDe(gr.lado, ["interno", "externo"] as const, "interno"), posicao: num(gr.posicao, 180, 0, 360), negrito: !!gr.negrito,
    },
    textura: { tipo: umDe(tx.tipo, ["nenhuma", "facetas", "frisos"] as const, "nenhuma"), quantidade: Math.round(num(tx.quantidade, 16, 1, 120)), profundidade: num(tx.profundidade, 0.25, 0.05, 2) },
    fabricacao: {
      ocar: !!f.ocar, parede: num(f.parede, 0.6, 0.3, 3), contracao: num(f.contracao, 0, -5, 10), canais: Math.round(num(f.canais, 1, 0, 3)),
      diamCanal: num(f.diamCanal, 1.6, 0.5, 5), compCanal: num(f.compCanal, 6, 1, 30), perda: num(f.perda, 5, 0, 50),
    },
    preco: { cotacao: num(pr.cotacao, 0, 0), precoQuilate: num(pr.precoQuilate, 0, 0), maoDeObra: num(pr.maoDeObra, 0, 0), margem: num(pr.margem, 0, -100, 1000) },
  };
  if (doc.cabeca.gema.lapidacao === "redonda") doc.cabeca.gema.comprimento = doc.cabeca.gema.largura;
  return doc;
}
