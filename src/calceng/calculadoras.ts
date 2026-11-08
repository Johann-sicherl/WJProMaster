// WJCalcEng — calculadoras de álgebra, matrizes e física (motor puro, testado em
// scripts/teste-calceng.ts). Cada calculadora declara os campos e resolve com os PASSOS da
// resolução (como no caderno), os resultados em destaque e, quando ajuda, um gráfico em SVG.
// A interface (main.ts) só desenha os campos e o resultado. Unidades SI na física.

export type Matriz = number[][];
export type Valor = number | string | Matriz;
export type Valores = Record<string, Valor>;

interface CampoBase {
  id: string;
  rotulo: string;
  /** Só aparece quando a função diz (ex.: campo de um modo). */
  mostrarSe?: (v: Valores) => boolean;
}
export type Campo =
  | (CampoBase & { tipo: "numero"; padrao: number; unidade?: string })
  | (CampoBase & { tipo: "opcao"; opcoes: [string, string][]; padrao: string })
  /** Matriz editável; `colunas: "aumentada"` = linhas + 1 (sistema com a coluna dos termos independentes). */
  | (CampoBase & { tipo: "matriz"; padrao: Matriz; linhas: [number, number]; colunas: [number, number] | "aumentada"; cabecalhos?: (c: number, total: number) => string });

export interface Passo {
  titulo: string;
  linhas?: string[];
  /** Matriz mostrada no passo; `barra` = coluna onde fica o traço da matriz aumentada. */
  matriz?: { m: string[][]; barra?: number };
}
export interface Resultado {
  destaques: [string, string][];
  passos: Passo[];
  avisos: string[];
  /** Valores numéricos (para os testes e para copiar). */
  numeros: Record<string, number>;
  /** Texto de resultado (ex.: conjunto solução). */
  textos: Record<string, string>;
  svg?: string;
}
export interface DefCalculadora {
  id: string;
  /** Forma geral mostrada no topo (ex.: "a·x + b = c·x + d"). */
  forma: string;
  campos: Campo[];
  resolver: (v: Valores) => Resultado;
}

// ---------------------------------------------------------------------------------------------
// números

const SOBRE = "⁰¹²³⁴⁵⁶⁷⁸⁹";
/** Número em pt-BR (até 4 casas; notação científica nos muito grandes/pequenos). */
export function fmt(v: number, casas = 4): string {
  if (!Number.isFinite(v)) return v > 0 ? "+∞" : v < 0 ? "−∞" : "—";
  const a = Math.abs(v);
  if (a < 1e-12) return "0";
  if (a < 1e-4 || a >= 1e12) {
    const e = Math.floor(Math.log10(a));
    return `${(v / 10 ** e).toLocaleString("pt-BR", { maximumFractionDigits: 3 })} × 10${e < 0 ? "⁻" : ""}${String(Math.abs(e)).split("").map((d) => SOBRE[+d]).join("")}`;
  }
  return v.toLocaleString("pt-BR", { maximumFractionDigits: casas }).replace(/^-/, "−");
}
/** Fração exata p/q (q ≤ 1000) quando o número é uma, senão null. */
export function fracao(v: number): string | null {
  if (!Number.isFinite(v) || Math.abs(v - Math.round(v)) < 1e-9) return null;
  let h0 = 1, h1 = 0, k0 = 0, k1 = 1, x = Math.abs(v);
  for (let i = 0; i < 20; i++) {
    const a = Math.floor(x);
    [h0, h1] = [a * h0 + h1, h0];
    [k0, k1] = [a * k0 + k1, k0];
    if (k0 > 1000) return null;
    if (Math.abs(Math.abs(v) - h0 / k0) < 1e-9 * Math.max(1, Math.abs(v))) return `${v < 0 ? "−" : ""}${h0}/${k0}`;
    x = 1 / (x - a);
    if (!Number.isFinite(x)) return null;
  }
  return null;
}
/** Número com a fração ao lado quando for exata: "2,5 (= 5/2)". */
export const nf = (v: number) => {
  const f = fracao(v);
  return f ? `${fmt(v)} (= ${f})` : fmt(v);
};
/** Número entre parênteses se negativo (para substituir em fórmulas). */
const p = (v: number) => (v < 0 ? `(${fmt(v)})` : fmt(v));
const num = (v: Valor | undefined, padrao = 0) => (typeof v === "number" && Number.isFinite(v) ? v : padrao);
const txt = (v: Valor | undefined, padrao: string) => (typeof v === "string" ? v : padrao);
const RAD = Math.PI / 180;
const quase0 = (v: number, escala = 1) => Math.abs(v) < 1e-10 * Math.max(1, escala);
const novo = (): Resultado => ({ destaques: [], passos: [], avisos: [], numeros: {}, textos: {} });
const matrizTexto = (m: Matriz) => m.map((l) => l.map((x) => fmt(x)));

/** Matriz r×c a partir do valor guardado (completa com zeros). */
export function matrizDe(v: Valor | undefined, r: number, c: number): Matriz {
  const m = Array.isArray(v) ? v : [];
  return Array.from({ length: r }, (_, i) => Array.from({ length: c }, (_, j) => num(m[i]?.[j], 0)));
}

/** Polinômio de 1º grau legível: "2·x + 3", "−x − 5". */
function termos(pares: [number, string][]): string {
  const t = pares.filter(([c]) => !quase0(c));
  if (!t.length) return "0";
  return t.map(([c, v], i) => {
    const s = c < 0 ? "−" : "+";
    const a = Math.abs(c);
    const corpo = v ? `${a === 1 ? "" : `${fmt(a)}·`}${v}` : fmt(a);
    return i === 0 ? (c < 0 ? `−${corpo}` : corpo) : ` ${s} ${corpo}`;
  }).join("");
}

// ---------------------------------------------------------------------------------------------
// gráfico de função (SVG puro)

function grafico(f: (x: number) => number, x0: number, x1: number, marcas: { x: number; y: number; rotulo: string }[], faixas: [number, number][] = []): string {
  const W = 420, H = 240, m = 28;
  const n = 160;
  const pts: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n;
    pts.push([x, f(x)]);
  }
  const ys = [...pts.map((q) => q[1]), ...marcas.map((q) => q.y), 0].filter(Number.isFinite);
  let y0 = Math.min(...ys), y1 = Math.max(...ys);
  if (y1 - y0 < 1e-9) {
    y0 -= 1;
    y1 += 1;
  }
  const folga = (y1 - y0) * 0.08;
  y0 -= folga;
  y1 += folga;
  const X = (x: number) => m + ((x - x0) / (x1 - x0)) * (W - 2 * m);
  const Y = (y: number) => H - m - ((y - y0) / (y1 - y0)) * (H - 2 * m);
  let s = `<svg viewBox="0 0 ${W} ${H}" class="ce-grafico" role="img" aria-label="Gráfico">`;
  for (const [a, b] of faixas) {
    const xa = X(Math.max(a, x0)), xb = X(Math.min(b, x1));
    if (xb > xa) s += `<rect x="${xa.toFixed(1)}" y="${m}" width="${(xb - xa).toFixed(1)}" height="${H - 2 * m}" fill="rgba(46,139,87,.14)"/>`;
  }
  // eixos
  if (y0 <= 0 && y1 >= 0) s += `<line x1="${m}" x2="${W - m}" y1="${Y(0).toFixed(1)}" y2="${Y(0).toFixed(1)}" stroke="#9aa6b2"/>`;
  if (x0 <= 0 && x1 >= 0) s += `<line y1="${m}" y2="${H - m}" x1="${X(0).toFixed(1)}" x2="${X(0).toFixed(1)}" stroke="#9aa6b2"/>`;
  s += `<text x="${W - m + 4}" y="${(y0 <= 0 && y1 >= 0 ? Y(0) : H - m) + 4}" class="eixo">x</text>`;
  s += `<text x="${W - m - 20}" y="${H - 8}" class="eixo">${fmt(x1, 2)}</text><text x="${m}" y="${H - 8}" class="eixo">${fmt(x0, 2)}</text>`;
  s += `<polyline fill="none" stroke="#2f7fd0" stroke-width="2.2" points="${pts.filter((q) => Number.isFinite(q[1])).map(([x, y]) => `${X(x).toFixed(1)},${Y(y).toFixed(1)}`).join(" ")}"/>`;
  for (const q of marcas) {
    if (q.x < x0 || q.x > x1) continue;
    s += `<circle cx="${X(q.x).toFixed(1)}" cy="${Y(q.y).toFixed(1)}" r="4" fill="#e07a10"/><text x="${(X(q.x) + 6).toFixed(1)}" y="${(Y(q.y) - 6).toFixed(1)}" class="marca">${q.rotulo}</text>`;
  }
  return `${s}</svg>`;
}

// ---------------------------------------------------------------------------------------------
// álgebra

const eq1: DefCalculadora = {
  id: "eq1",
  forma: "a·x + b = c·x + d",
  campos: [
    { id: "a", rotulo: "a", tipo: "numero", padrao: 2 },
    { id: "b", rotulo: "b", tipo: "numero", padrao: 3 },
    { id: "c", rotulo: "c", tipo: "numero", padrao: 0 },
    { id: "d", rotulo: "d", tipo: "numero", padrao: 11 },
  ],
  resolver(v) {
    const r = novo();
    const a = num(v.a), b = num(v.b), c = num(v.c), d = num(v.d);
    const k = a - c, rhs = d - b;
    r.passos.push({ titulo: "Equação", linhas: [`${termos([[a, "x"], [b, ""]])} = ${termos([[c, "x"], [d, ""]])}`] });
    r.passos.push({ titulo: "Termos com x de um lado, números do outro", linhas: [`(${fmt(a)} − ${p(c)})·x = ${fmt(d)} − ${p(b)}`, `${fmt(k)}·x = ${fmt(rhs)}`] });
    if (quase0(k)) {
      const inf = quase0(rhs);
      r.passos.push({ titulo: "Coeficiente de x é zero", linhas: [inf ? "0 = 0 vale para qualquer x." : `0 = ${fmt(rhs)} é impossível.`] });
      r.destaques.push(["Solução", inf ? "S = ℝ (infinitas soluções)" : "S = ∅ (sem solução)"]);
      r.textos.solucao = inf ? "R" : "vazio";
      return r;
    }
    const x = rhs / k;
    r.passos.push({ titulo: "Dividir pelo coeficiente de x", linhas: [`x = ${fmt(rhs)} / ${p(k)} = ${nf(x)}`] });
    r.passos.push({ titulo: "Verificação", linhas: [`${fmt(a)}·${p(x)} + ${p(b)} = ${fmt(a * x + b)}`, `${fmt(c)}·${p(x)} + ${p(d)} = ${fmt(c * x + d)}`] });
    r.destaques.push(["x", nf(x)]);
    r.numeros.x = x;
    return r;
  },
};

/** Raízes reais de a·x² + b·x + c (ordem crescente) e Δ. */
function raizes2(a: number, b: number, c: number) {
  const delta = b * b - 4 * a * c;
  if (delta < -1e-12 * Math.max(1, b * b)) return { delta, r: [] as number[] };
  if (Math.abs(delta) <= 1e-12 * Math.max(1, b * b)) return { delta: 0, r: [-b / (2 * a)] };
  const s = Math.sqrt(delta);
  return { delta, r: [(-b - s) / (2 * a), (-b + s) / (2 * a)].sort((x, y) => x - y) };
}

const eq2: DefCalculadora = {
  id: "eq2",
  forma: "a·x² + b·x + c = 0",
  campos: [
    { id: "a", rotulo: "a", tipo: "numero", padrao: 1 },
    { id: "b", rotulo: "b", tipo: "numero", padrao: -5 },
    { id: "c", rotulo: "c", tipo: "numero", padrao: 6 },
  ],
  resolver(v) {
    const a = num(v.a), b = num(v.b), c = num(v.c);
    if (quase0(a)) {
      const r = eq1.resolver({ a: b, b: c, c: 0, d: 0 });
      r.avisos.unshift("a = 0: a equação é do 1º grau (b·x + c = 0).");
      return r;
    }
    const r = novo();
    r.passos.push({ titulo: "Equação", linhas: [`${termos([[a, "x²"], [b, "x"], [c, ""]])} = 0`] });
    const { delta, r: rs } = raizes2(a, b, c);
    r.passos.push({ titulo: "Discriminante (Δ)", linhas: ["Δ = b² − 4·a·c", `Δ = ${p(b)}² − 4·${p(a)}·${p(c)} = ${nf(delta)}`] });
    r.numeros.delta = delta;
    const xv = -b / (2 * a), yv = -delta / (4 * a);
    if (rs.length === 2) {
      const sd = Math.sqrt(delta);
      r.passos.push({ titulo: "Fórmula de Bhaskara: x = (−b ± √Δ) / (2·a)", linhas: [`√Δ = ${nf(sd)}`, `x₁ = (${fmt(-b)} − ${fmt(sd)}) / ${fmt(2 * a)} = ${nf(rs[0])}`, `x₂ = (${fmt(-b)} + ${fmt(sd)}) / ${fmt(2 * a)} = ${nf(rs[1])}`] });
      r.destaques.push(["x₁", nf(rs[0])], ["x₂", nf(rs[1])]);
      r.numeros.x1 = rs[0];
      r.numeros.x2 = rs[1];
      r.passos.push({ titulo: "Forma fatorada", linhas: [`${fmt(a)}·(x − ${p(rs[0])})·(x − ${p(rs[1])}) = 0`] });
    } else if (rs.length === 1) {
      r.passos.push({ titulo: "Δ = 0: uma raiz dupla", linhas: [`x = −b / (2·a) = ${fmt(-b)} / ${fmt(2 * a)} = ${nf(rs[0])}`] });
      r.destaques.push(["x₁ = x₂", nf(rs[0])]);
      r.numeros.x1 = r.numeros.x2 = rs[0];
    } else {
      const im = Math.sqrt(-delta) / Math.abs(2 * a);
      r.passos.push({ titulo: "Δ < 0: sem raízes reais", linhas: ["Raízes complexas: x = (−b ± i·√(−Δ)) / (2·a)", `x = ${nf(xv)} ± ${nf(im)}·i`] });
      r.destaques.push(["Raízes reais", "nenhuma (Δ < 0)"], ["Complexas", `${fmt(xv)} ± ${fmt(im)}·i`]);
      r.numeros.re = xv;
      r.numeros.im = im;
    }
    r.passos.push({ titulo: "Soma e produto das raízes", linhas: [`S = −b/a = ${nf(-b / a)}`, `P = c/a = ${nf(c / a)}`] });
    r.passos.push({ titulo: "Vértice da parábola", linhas: [`xv = −b / (2·a) = ${nf(xv)}`, `yv = −Δ / (4·a) = ${nf(yv)}`, a > 0 ? "a > 0: concavidade para cima (yv é o mínimo)." : "a < 0: concavidade para baixo (yv é o máximo)."] });
    r.destaques.push(["Vértice", `(${fmt(xv)}; ${fmt(yv)})`]);
    r.numeros.xv = xv;
    r.numeros.yv = yv;
    const meia = Math.max(rs.length === 2 ? (rs[1] - rs[0]) * 0.9 : 0, Math.sqrt(Math.abs(yv / a)) * 1.6, 2);
    r.svg = grafico((x) => a * x * x + b * x + c, xv - meia, xv + meia, [...rs.map((x, i) => ({ x, y: 0, rotulo: rs.length === 2 ? `x${i ? "₂" : "₁"}` : "x" })), { x: xv, y: yv, rotulo: "V" }]);
    return r;
  },
};

// ---------- sistemas e escalonamento ----------

const nomeVar = (j: number, n: number) => (n <= 3 ? ["x", "y", "z"][j] : `x${"₁₂₃₄₅₆₇₈"[j]}`);

interface Escalonado {
  m: Matriz;
  pivos: number[];
  passos: Passo[];
}

/**
 * Escalona a matriz aumentada. `jordan`: forma escalonada reduzida (pivôs = 1, zeros acima e abaixo)
 * com pivoteamento parcial; senão eliminação de Gauss clássica (zeros abaixo; troca só com pivô zero).
 */
function escalonar(entrada: Matriz, jordan: boolean): Escalonado {
  const m = entrada.map((l) => [...l]);
  const nl = m.length, nc = m[0].length - 1;
  const escala = Math.max(1, ...m.flat().map(Math.abs));
  const passos: Passo[] = [];
  const pivos: number[] = [];
  let linha = 0;
  for (let col = 0; col < nc && linha < nl; col++) {
    let piv = linha;
    if (jordan) {
      for (let i = linha + 1; i < nl; i++) if (Math.abs(m[i][col]) > Math.abs(m[piv][col])) piv = i;
    } else {
      while (piv < nl && quase0(m[piv][col], escala)) piv++;
      if (piv === nl) piv = linha;
    }
    if (quase0(m[piv][col], escala)) continue;
    const ops: string[] = [];
    if (piv !== linha) {
      [m[piv], m[linha]] = [m[linha], m[piv]];
      ops.push(`L${linha + 1} ↔ L${piv + 1}`);
    }
    if (jordan && !quase0(m[linha][col] - 1)) {
      const d = m[linha][col];
      m[linha] = m[linha].map((x) => x / d);
      ops.push(`L${linha + 1} ← L${linha + 1} ÷ ${p(d)}`);
    }
    for (let i = jordan ? 0 : linha + 1; i < nl; i++) {
      if (i === linha || quase0(m[i][col], escala)) continue;
      const f = m[i][col] / m[linha][col];
      m[i] = m[i].map((x, j) => (j === col ? 0 : x - f * m[linha][j]));
      for (let j = 0; j <= nc; j++) if (quase0(m[i][j], escala)) m[i][j] = 0;
      const ff = fracao(f);
      ops.push(`L${i + 1} ← L${i + 1} − ${ff ? (f < 0 ? `(${ff})` : ff) : p(f)}·L${linha + 1}`);
    }
    pivos.push(col);
    if (ops.length) passos.push({ titulo: `Coluna ${col + 1} (${nomeVar(col, nc)}): ${ops.join("; ")}`, matriz: { m: matrizTexto(m), barra: nc } });
    linha++;
  }
  return { m, pivos, passos };
}

/** Classificação e solução a partir da forma escalonada. */
function classificar(e: Escalonado, n: number) {
  const nc = e.m[0].length - 1;
  const escala = Math.max(1, ...e.m.flat().map(Math.abs));
  const incompativel = e.m.some((l) => l.slice(0, nc).every((x) => quase0(x, escala)) && !quase0(l[nc], escala));
  if (incompativel) return { tipo: "SI" as const };
  return { tipo: e.pivos.length === n ? ("SPD" as const) : ("SPI" as const) };
}

const sistemas: DefCalculadora = {
  id: "sistemas",
  forma: "matriz aumentada [A | b] (até 6 equações)",
  campos: [
    {
      id: "m", rotulo: "Coeficientes e termos independentes", tipo: "matriz", linhas: [2, 6], colunas: "aumentada",
      padrao: [[1, 1, 1, 6], [2, -1, 1, 3], [1, 2, -1, 2]],
      cabecalhos: (c, total) => (c === total - 1 ? "=" : nomeVar(c, total - 1)),
    },
  ],
  resolver(v) {
    const r = novo();
    const bruto = Array.isArray(v.m) ? v.m : [];
    const n = Math.min(6, Math.max(2, bruto.length || 3));
    const M = matrizDe(v.m, n, n + 1);
    r.passos.push({ titulo: "Sistema", linhas: M.map((l) => `${termos(l.slice(0, n).map((c, j) => [c, nomeVar(j, n)] as [number, string]))} = ${fmt(l[n])}`) });
    r.passos.push({ titulo: "Matriz aumentada [A | b]", matriz: { m: matrizTexto(M), barra: n } });
    const e = escalonar(M, true);
    r.passos.push(...e.passos);
    const c = classificar(e, n);
    r.textos.tipo = c.tipo;
    if (c.tipo === "SI") {
      r.passos.push({ titulo: "Linha 0 = número diferente de zero", linhas: ["O sistema é impossível (SI): não tem solução."] });
      r.destaques.push(["Classificação", "Sistema impossível (SI)"]);
      return r;
    }
    if (c.tipo === "SPD") {
      r.destaques.push(["Classificação", "Possível e determinado (SPD)"]);
      const sol = e.pivos.map((_, i) => e.m[i][n]);
      r.passos.push({ titulo: "Forma escalonada reduzida: leitura direta", linhas: sol.map((x, j) => `${nomeVar(j, n)} = ${nf(x)}`) });
      sol.forEach((x, j) => {
        r.destaques.push([nomeVar(j, n), nf(x)]);
        r.numeros[nomeVar(j, n)] = x;
      });
      return r;
    }
    const livres = Array.from({ length: n }, (_, j) => j).filter((j) => !e.pivos.includes(j));
    r.destaques.push(["Classificação", `Possível e indeterminado (SPI): ${livres.length} variável(is) livre(s)`]);
    r.passos.push({
      titulo: "Solução geral (variáveis livres: " + livres.map((j) => nomeVar(j, n)).join(", ") + ")",
      linhas: e.pivos.map((col, i) => `${nomeVar(col, n)} = ${termos([[e.m[i][n], ""], ...livres.map((j) => [-e.m[i][j], nomeVar(j, n)] as [number, string])])}`),
    });
    return r;
  },
};

const det3 = (m: Matriz) => m[0][0] * m[1][1] * m[2][2] + m[0][1] * m[1][2] * m[2][0] + m[0][2] * m[1][0] * m[2][1] - m[0][2] * m[1][1] * m[2][0] - m[0][0] * m[1][2] * m[2][1] - m[0][1] * m[1][0] * m[2][2];
function sarrus(m: Matriz): string[] {
  const t = (i: number, j: number) => p(m[i][j]);
  const pos = [`${t(0, 0)}·${t(1, 1)}·${t(2, 2)}`, `${t(0, 1)}·${t(1, 2)}·${t(2, 0)}`, `${t(0, 2)}·${t(1, 0)}·${t(2, 1)}`];
  const neg = [`${t(0, 2)}·${t(1, 1)}·${t(2, 0)}`, `${t(0, 0)}·${t(1, 2)}·${t(2, 1)}`, `${t(0, 1)}·${t(1, 0)}·${t(2, 2)}`];
  const vp = m[0][0] * m[1][1] * m[2][2] + m[0][1] * m[1][2] * m[2][0] + m[0][2] * m[1][0] * m[2][1];
  const vn = m[0][2] * m[1][1] * m[2][0] + m[0][0] * m[1][2] * m[2][1] + m[0][1] * m[1][0] * m[2][2];
  return [`(${pos.join(" + ")}) − (${neg.join(" + ")})`, `= ${fmt(vp)} − ${p(vn)} = ${fmt(vp - vn)}`];
}

const SISTEMA_3: Matriz = [[2, 1, -1, 8], [-3, -1, 2, -11], [-2, 1, 2, -3]];

const cramer: DefCalculadora = {
  id: "cramer",
  forma: "sistema 3×3 pela regra de Cramer (determinantes por Sarrus)",
  campos: [{ id: "m", rotulo: "Coeficientes e termos independentes", tipo: "matriz", linhas: [3, 3], colunas: "aumentada", padrao: SISTEMA_3, cabecalhos: (c) => (c === 3 ? "=" : "xyz"[c]) }],
  resolver(v) {
    const r = novo();
    const M = matrizDe(v.m, 3, 4);
    const A = M.map((l) => l.slice(0, 3)), b = M.map((l) => l[3]);
    const D = det3(A);
    r.passos.push({ titulo: "Matriz dos coeficientes A", matriz: { m: matrizTexto(A) } });
    r.passos.push({ titulo: "D = det A (Sarrus)", linhas: sarrus(A) });
    r.numeros.D = D;
    const nomes = ["x", "y", "z"];
    const Ds = [0, 1, 2].map((k) => {
      const Ak = A.map((l, i) => l.map((x, j) => (j === k ? b[i] : x)));
      const d = det3(Ak);
      r.passos.push({ titulo: `D${nomes[k]}: coluna de ${nomes[k]} trocada pelos termos independentes`, matriz: { m: matrizTexto(Ak) }, linhas: sarrus(Ak) });
      r.numeros[`D${nomes[k]}`] = d;
      return d;
    });
    const escala = Math.max(1, ...A.flat().map(Math.abs)) ** 3;
    if (quase0(D, escala)) {
      const todos0 = Ds.every((d) => quase0(d, escala));
      r.passos.push({ titulo: "D = 0: a regra de Cramer não decide", linhas: [todos0 ? "Dx = Dy = Dz = 0: o sistema pode ser indeterminado (SPI) ou impossível. Resolva por Gauss (calculadora Sistemas ou Gauss 3×3)." : "D = 0 e algum Dx, Dy ou Dz ≠ 0: sistema impossível (SI)."] });
      r.destaques.push(["D", "0"], ["Classificação", todos0 ? "SPI ou SI (use Gauss)" : "Sistema impossível (SI)"]);
      r.textos.tipo = todos0 ? "SPI?" : "SI";
      return r;
    }
    r.passos.push({ titulo: "Regra de Cramer", linhas: Ds.map((d, k) => `${nomes[k]} = D${nomes[k]} / D = ${fmt(d)} / ${p(D)} = ${nf(d / D)}`) });
    r.destaques.push(["D", fmt(D)]);
    Ds.forEach((d, k) => {
      r.destaques.push([nomes[k], nf(d / D)]);
      r.numeros[nomes[k]] = d / D;
    });
    r.textos.tipo = "SPD";
    return r;
  },
};

const gauss: DefCalculadora = {
  id: "gauss",
  forma: "sistema 3×3 por eliminação de Gauss (escalonamento + retrossubstituição)",
  campos: [{ id: "m", rotulo: "Coeficientes e termos independentes", tipo: "matriz", linhas: [3, 3], colunas: "aumentada", padrao: SISTEMA_3, cabecalhos: (c) => (c === 3 ? "=" : "xyz"[c]) }],
  resolver(v) {
    const r = novo();
    const M = matrizDe(v.m, 3, 4);
    r.passos.push({ titulo: "Matriz aumentada [A | b]", matriz: { m: matrizTexto(M), barra: 3 } });
    const e = escalonar(M, false);
    r.passos.push(...e.passos);
    const c = classificar(e, 3);
    r.textos.tipo = c.tipo;
    if (c.tipo !== "SPD") {
      r.passos.push({ titulo: "Matriz escalonada", linhas: [c.tipo === "SI" ? "Uma linha ficou 0 = número ≠ 0: sistema impossível (SI)." : "Sobrou uma linha 0 = 0: sistema possível e indeterminado (SPI). A solução geral está na calculadora Sistemas."] });
      r.destaques.push(["Classificação", c.tipo === "SI" ? "Sistema impossível (SI)" : "Possível e indeterminado (SPI)"]);
      return r;
    }
    const m = e.m;
    const z = m[2][3] / m[2][2];
    const y = (m[1][3] - m[1][2] * z) / m[1][1];
    const x = (m[0][3] - m[0][1] * y - m[0][2] * z) / m[0][0];
    r.passos.push({
      titulo: "Retrossubstituição (de baixo para cima)",
      linhas: [
        `z = ${fmt(m[2][3])} / ${p(m[2][2])} = ${nf(z)}`,
        `y = (${fmt(m[1][3])} − ${p(m[1][2])}·${p(z)}) / ${p(m[1][1])} = ${nf(y)}`,
        `x = (${fmt(m[0][3])} − ${p(m[0][1])}·${p(y)} − ${p(m[0][2])}·${p(z)}) / ${p(m[0][0])} = ${nf(x)}`,
      ],
    });
    r.destaques.push(["Classificação", "Possível e determinado (SPD)"], ["x", nf(x)], ["y", nf(y)], ["z", nf(z)]);
    Object.assign(r.numeros, { x, y, z });
    return r;
  },
};

const mult: DefCalculadora = {
  id: "mult",
  forma: "C = A · B (linha de A × coluna de B)",
  campos: [
    { id: "A", rotulo: "Matriz A", tipo: "matriz", linhas: [1, 6], colunas: [1, 6], padrao: [[1, 2, 3], [4, 5, 6]] },
    { id: "B", rotulo: "Matriz B", tipo: "matriz", linhas: [1, 6], colunas: [1, 6], padrao: [[7, 8], [9, 10], [11, 12]] },
  ],
  resolver(v) {
    const r = novo();
    const dims = (x: Valor | undefined): [number, number] => (Array.isArray(x) && x.length ? [x.length, x[0]?.length ?? 1] : [2, 2]);
    const [ma, na] = dims(v.A), [mb, nb] = dims(v.B);
    const A = matrizDe(v.A, ma, na), B = matrizDe(v.B, mb, nb);
    if (na !== mb) {
      r.avisos.push(`A é ${ma}×${na} e B é ${mb}×${nb}: o número de colunas de A (${na}) precisa ser igual ao de linhas de B (${mb}).`);
      r.destaques.push(["Produto", "não definido"]);
      return r;
    }
    const C = A.map((l) => B[0].map((_, j) => l.reduce((s, x, k) => s + x * B[k][j], 0)));
    r.passos.push({ titulo: `Dimensões: (${ma}×${na}) · (${mb}×${nb}) = ${ma}×${nb}` });
    r.passos.push({ titulo: "Cada elemento: cᵢⱼ = Σ aᵢₖ·bₖⱼ", linhas: C.flatMap((l, i) => l.map((c, j) => `c${i + 1}${j + 1} = ${A[i].map((x, k) => `${p(x)}·${p(B[k][j])}`).join(" + ")} = ${fmt(c)}`)) });
    r.passos.push({ titulo: "Resultado C = A·B", matriz: { m: matrizTexto(C) } });
    r.destaques.push(["C", `${ma}×${nb}`]);
    C.forEach((l, i) => l.forEach((c, j) => (r.numeros[`c${i + 1}${j + 1}`] = c)));
    return r;
  },
};

// ---------- inequações ----------

const OPS: [string, string][] = [["<", "<"], ["<=", "≤"], [">", ">"], [">=", "≥"]];
const simb = (op: string) => OPS.find((o) => o[0] === op)?.[1] ?? op;
const inverterOp = (op: string) => ({ "<": ">", "<=": ">=", ">": "<", ">=": "<=" })[op] ?? op;

/** Intervalo na notação brasileira: [a; b], ]a; b[, ]−∞; b]… */
function intervalo(a: number, b: number, fa: boolean, fb: boolean) {
  return `${fa && Number.isFinite(a) ? "[" : "]"}${fmt(a)}; ${fmt(b)}${fb && Number.isFinite(b) ? "]" : "["}`;
}

const inequacoes: DefCalculadora = {
  id: "inequacoes",
  forma: "1º grau: a·x + b ⋚ c   ·   2º grau: a·x² + b·x + c ⋚ 0",
  campos: [
    { id: "grau", rotulo: "Tipo", tipo: "opcao", opcoes: [["1", "1º grau: a·x + b ⋚ c"], ["2", "2º grau: a·x² + b·x + c ⋚ 0"]], padrao: "2" },
    { id: "op", rotulo: "Sinal", tipo: "opcao", opcoes: OPS, padrao: "<" },
    { id: "a", rotulo: "a", tipo: "numero", padrao: 1 },
    { id: "b", rotulo: "b", tipo: "numero", padrao: -5 },
    { id: "c", rotulo: "c", tipo: "numero", padrao: 6 },
  ],
  resolver(v) {
    const r = novo();
    const op = txt(v.op, "<");
    const a = num(v.a), b = num(v.b), c = num(v.c);
    const estrito = op === "<" || op === ">";
    const resposta = (s: string, conj: string, faixas: [number, number][]) => {
      r.destaques.push(["S", s], ["Em palavras", conj]);
      r.textos.solucao = s;
      return faixas;
    };
    if (txt(v.grau, "2") === "1" || quase0(a)) {
      // 1º grau (ou 2º grau com a = 0: b·x + c ⋚ 0)
      const [k, lado, rot] = txt(v.grau, "2") === "1" ? [a, c - b, `${termos([[a, "x"], [b, ""]])} ${simb(op)} ${fmt(c)}`] : [b, -c, `${termos([[b, "x"], [c, ""]])} ${simb(op)} 0`];
      if (txt(v.grau, "2") === "2") r.avisos.push("a = 0: a inequação é do 1º grau.");
      r.passos.push({ titulo: "Inequação", linhas: [rot, `${fmt(k)}·x ${simb(op)} ${fmt(lado)}`] });
      if (quase0(k)) {
        const vale = op === "<" ? 0 < lado : op === "<=" ? 0 <= lado : op === ">" ? 0 > lado : 0 >= lado;
        r.passos.push({ titulo: "Coeficiente de x é zero", linhas: [`0 ${simb(op)} ${fmt(lado)} é ${vale ? "verdadeiro para todo x" : "falso"}.`] });
        resposta(vale ? "ℝ" : "∅", vale ? "todos os reais" : "nenhum real", []);
        return r;
      }
      const lim = lado / k;
      const op2 = k < 0 ? inverterOp(op) : op;
      r.passos.push({ titulo: k < 0 ? "Dividir por número negativo: o sinal inverte" : "Dividir pelo coeficiente de x", linhas: [`x ${simb(op2)} ${fmt(lado)} / ${p(k)}`, `x ${simb(op2)} ${nf(lim)}`] });
      r.numeros.limite = lim;
      const menor = op2 === "<" || op2 === "<=";
      const s = menor ? intervalo(-Infinity, lim, false, !estrito) : intervalo(lim, Infinity, !estrito, false);
      const faixa: [number, number] = menor ? [-Infinity, lim] : [lim, Infinity];
      resposta(s, `x ${simb(op2)} ${fmt(lim)}`, [faixa]);
      r.svg = grafico((x) => k * x - lado, lim - 5, lim + 5, [{ x: lim, y: 0, rotulo: fmt(lim) }], [faixa]);
      return r;
    }
    r.passos.push({ titulo: "Inequação", linhas: [`${termos([[a, "x²"], [b, "x"], [c, ""]])} ${simb(op)} 0`] });
    const { delta, r: rs } = raizes2(a, b, c);
    r.passos.push({ titulo: "Raízes de f(x) = a·x² + b·x + c", linhas: [`Δ = ${p(b)}² − 4·${p(a)}·${p(c)} = ${fmt(delta)}`, rs.length ? `Raízes: ${rs.map((x) => nf(x)).join(" e ")}` : "Δ < 0: f(x) não tem raízes reais."] });
    rs.forEach((x, i) => (r.numeros[`r${i + 1}`] = x));
    const sa = a > 0 ? 1 : -1;
    const quer = op === ">" || op === ">=" ? 1 : -1;
    r.passos.push({ titulo: "Estudo do sinal", linhas: [a > 0 ? "a > 0: f é positiva fora das raízes e negativa entre elas." : "a < 0: f é negativa fora das raízes e positiva entre elas.", `Queremos f(x) ${quer > 0 ? "positiva" : "negativa"}${estrito ? "" : " ou nula"}.`] });
    let s: string, conj: string, faixas: [number, number][] = [];
    if (rs.length === 2) {
      const [r1, r2] = rs;
      if (quer === sa) {
        s = `${intervalo(-Infinity, r1, false, !estrito)} ∪ ${intervalo(r2, Infinity, !estrito, false)}`;
        conj = `x ${estrito ? "<" : "≤"} ${fmt(r1)} ou x ${estrito ? ">" : "≥"} ${fmt(r2)}`;
        faixas = [[-Infinity, r1], [r2, Infinity]];
      } else {
        s = intervalo(r1, r2, !estrito, !estrito);
        conj = `${fmt(r1)} ${estrito ? "<" : "≤"} x ${estrito ? "<" : "≤"} ${fmt(r2)}`;
        faixas = [[r1, r2]];
      }
    } else if (rs.length === 1) {
      const x0 = rs[0];
      if (quer === sa) [s, conj, faixas] = estrito ? [`ℝ − {${fmt(x0)}}`, `todo x ≠ ${fmt(x0)}`, [[-Infinity, Infinity]]] : ["ℝ", "todos os reais", [[-Infinity, Infinity]]];
      else [s, conj] = estrito ? ["∅", "nenhum real"] : [`{${fmt(x0)}}`, `só x = ${fmt(x0)}`];
    } else if (quer === sa) [s, conj, faixas] = ["ℝ", "todos os reais", [[-Infinity, Infinity]]];
    else [s, conj] = ["∅", "nenhum real"];
    resposta(s, conj, faixas);
    const xv = -b / (2 * a);
    const meia = Math.max(rs.length === 2 ? (rs[1] - rs[0]) * 0.9 : 0, 3);
    r.svg = grafico((x) => a * x * x + b * x + c, xv - meia, xv + meia, rs.map((x) => ({ x, y: 0, rotulo: fmt(x) })), faixas);
    return r;
  },
};

// ---------------------------------------------------------------------------------------------
// física (SI)

/** Seta SVG de (x0,y0) a (x1,y1) com rótulo. */
function seta(x0: number, y0: number, x1: number, y1: number, cor: string, rot: string) {
  const ang = Math.atan2(y1 - y0, x1 - x0), s = 9;
  const a = `${(x1 - s * Math.cos(ang - 0.4)).toFixed(1)},${(y1 - s * Math.sin(ang - 0.4)).toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)} ${(x1 - s * Math.cos(ang + 0.4)).toFixed(1)},${(y1 - s * Math.sin(ang + 0.4)).toFixed(1)}`;
  return `<line x1="${x0.toFixed(1)}" y1="${y0.toFixed(1)}" x2="${x1.toFixed(1)}" y2="${y1.toFixed(1)}" stroke="${cor}" stroke-width="2.4"/><polygon points="${a}" fill="${cor}"/><text x="${(x1 + 8 * Math.cos(ang)).toFixed(1)}" y="${(y1 + 8 * Math.sin(ang) + 4).toFixed(1)}" fill="${cor}" class="forca">${rot}</text>`;
}

const newton: DefCalculadora = {
  id: "newton",
  forma: "2ª lei de Newton: F = m·a  (F resultante)",
  campos: [
    { id: "modo", rotulo: "Cálculo", tipo: "opcao", opcoes: [["fma", "F = m·a (uma incógnita)"], ["forcas", "Resultante de várias forças"]], padrao: "fma" },
    { id: "calc", rotulo: "Calcular", tipo: "opcao", opcoes: [["F", "a força F"], ["m", "a massa m"], ["a", "a aceleração a"]], padrao: "a", mostrarSe: (v) => v.modo !== "forcas" },
    { id: "F", rotulo: "Força F", tipo: "numero", padrao: 50, unidade: "N", mostrarSe: (v) => v.modo !== "forcas" && v.calc !== "F" },
    { id: "m", rotulo: "Massa m", tipo: "numero", padrao: 10, unidade: "kg", mostrarSe: (v) => v.modo === "forcas" || v.calc !== "m" },
    { id: "a", rotulo: "Aceleração a", tipo: "numero", padrao: 2, unidade: "m/s²", mostrarSe: (v) => v.modo !== "forcas" && v.calc !== "a" },
    { id: "forcas", rotulo: "Forças (módulo em N, ângulo em ° a partir de +x)", tipo: "matriz", linhas: [1, 8], colunas: [2, 2], padrao: [[30, 0], [40, 90]], cabecalhos: (c) => (c ? "ângulo (°)" : "F (N)"), mostrarSe: (v) => v.modo === "forcas" },
    { id: "g", rotulo: "Gravidade g", tipo: "numero", padrao: 9.81, unidade: "m/s²" },
  ],
  resolver(v) {
    const r = novo();
    const g = num(v.g, 9.81);
    if (txt(v.modo, "fma") === "forcas") {
      const lista = Array.isArray(v.forcas) && v.forcas.length ? v.forcas : [[0, 0]];
      const fs = matrizDe(lista, lista.length, 2);
      const m = num(v.m);
      const comps = fs.map(([F, ang]) => [F * Math.cos(ang * RAD), F * Math.sin(ang * RAD)]);
      r.passos.push({ titulo: "Componentes de cada força: Fx = F·cos θ, Fy = F·sen θ", linhas: fs.map(([F, ang], i) => `F${i + 1} = ${fmt(F)} N a ${fmt(ang)}°: Fx = ${fmt(comps[i][0])} N, Fy = ${fmt(comps[i][1])} N`) });
      const Rx = comps.reduce((s, c) => s + c[0], 0), Ry = comps.reduce((s, c) => s + c[1], 0);
      const R = Math.hypot(Rx, Ry), dir = Math.atan2(Ry, Rx) / RAD;
      r.passos.push({ titulo: "Resultante", linhas: [`Rx = ΣFx = ${fmt(Rx)} N`, `Ry = ΣFy = ${fmt(Ry)} N`, `R = √(Rx² + Ry²) = ${fmt(R)} N`, `Direção: θ = atan2(Ry, Rx) = ${fmt(dir)}°`] });
      r.destaques.push(["Resultante R", `${fmt(R)} N`], ["Direção", `${fmt(dir)}°`]);
      Object.assign(r.numeros, { Rx, Ry, R, direcao: dir });
      if (m > 0) {
        const a = R / m;
        r.passos.push({ titulo: "2ª lei de Newton", linhas: [`a = R / m = ${fmt(R)} / ${fmt(m)} = ${fmt(a)} m/s² (na direção da resultante)`, `Peso: P = m·g = ${fmt(m)}·${fmt(g)} = ${fmt(m * g)} N`] });
        r.destaques.push(["Aceleração a", `${fmt(a)} m/s²`]);
        r.numeros.a = a;
      }
      // diagrama
      const maxF = Math.max(R, ...fs.map((f) => Math.abs(f[0])), 1e-9);
      const k = 90 / maxF, cx = 160, cy = 120;
      let s = `<svg viewBox="0 0 320 240" class="ce-grafico" role="img" aria-label="Diagrama de forças"><rect x="${cx - 14}" y="${cy - 14}" width="28" height="28" fill="#e3effb" stroke="#2f7fd0"/>`;
      fs.forEach(([F, ang], i) => (s += seta(cx, cy, cx + F * k * Math.cos(ang * RAD), cy - F * k * Math.sin(ang * RAD), "#5e6b78", `F${i + 1}`)));
      if (R > 1e-9) s += seta(cx, cy, cx + Rx * k, cy - Ry * k, "#c9372c", "R");
      r.svg = `${s}</svg>`;
      return r;
    }
    const calc = txt(v.calc, "a");
    let F = num(v.F), m = num(v.m), a = num(v.a);
    if (calc === "F") {
      F = m * a;
      r.passos.push({ titulo: "F = m·a", linhas: [`F = ${fmt(m)} kg · ${p(a)} m/s² = ${fmt(F)} N`] });
      r.destaques.push(["Força F", `${fmt(F)} N`]);
    } else if (calc === "m") {
      if (quase0(a)) return { ...r, avisos: ["Com a = 0 a massa não pode ser determinada."] };
      m = F / a;
      r.passos.push({ titulo: "m = F / a", linhas: [`m = ${fmt(F)} N / ${p(a)} m/s² = ${fmt(m)} kg`] });
      r.destaques.push(["Massa m", `${fmt(m)} kg`]);
    } else {
      if (!(m > 0)) return { ...r, avisos: ["A massa precisa ser maior que zero."] };
      a = F / m;
      r.passos.push({ titulo: "a = F / m", linhas: [`a = ${fmt(F)} N / ${fmt(m)} kg = ${fmt(a)} m/s²`] });
      r.destaques.push(["Aceleração a", `${fmt(a)} m/s²`]);
    }
    if (m > 0) {
      r.passos.push({ titulo: "Peso", linhas: [`P = m·g = ${fmt(m)}·${fmt(g)} = ${fmt(m * g)} N`] });
      r.destaques.push(["Peso P", `${fmt(m * g)} N`]);
    }
    Object.assign(r.numeros, { F, m, a, P: m * g });
    return r;
  },
};

/** Movimento de um bloco com atrito: força motriz líquida `motriz` (sinal = sentido), normal N. */
function comAtrito(r: Resultado, motriz: number, N: number, us: number, uk: number, m: number) {
  const fmax = us * N;
  r.passos.push({ titulo: "Atrito estático máximo", linhas: [`Fat,máx = μe·N = ${fmt(us)}·${fmt(N)} = ${fmt(fmax)} N`] });
  r.numeros.fatMax = fmax;
  if (Math.abs(motriz) <= fmax + 1e-12) {
    r.passos.push({ titulo: "Compara com a força que tenta mover", linhas: [`|F motriz| = ${fmt(Math.abs(motriz))} N ≤ ${fmt(fmax)} N → o bloco fica parado.`, `O atrito estático equilibra: Fat = ${fmt(Math.abs(motriz))} N, a = 0.`] });
    r.destaques.push(["Situação", "parado (atrito estático)"], ["Atrito Fat", `${fmt(Math.abs(motriz))} N`], ["Aceleração a", "0 m/s²"]);
    Object.assign(r.numeros, { fat: Math.abs(motriz), a: 0, move: 0 });
    return;
  }
  const fk = uk * N;
  const a = (Math.abs(motriz) - fk) / m;
  r.passos.push({ titulo: "Compara com a força que tenta mover", linhas: [`|F motriz| = ${fmt(Math.abs(motriz))} N > ${fmt(fmax)} N → o bloco se move.`, `Atrito cinético: Fat = μc·N = ${fmt(uk)}·${fmt(N)} = ${fmt(fk)} N (contra o movimento)`, `a = (|F motriz| − Fat) / m = (${fmt(Math.abs(motriz))} − ${fmt(fk)}) / ${fmt(m)} = ${fmt(a)} m/s²`] });
  r.destaques.push(["Situação", "em movimento (atrito cinético)"], ["Atrito Fat", `${fmt(fk)} N`], ["Aceleração a", `${fmt(a)} m/s²`]);
  Object.assign(r.numeros, { fat: fk, a, move: 1 });
}

const plano: DefCalculadora = {
  id: "plano",
  forma: "bloco num plano inclinado de ângulo θ, com atrito e força F paralela ao plano (para cima)",
  campos: [
    { id: "m", rotulo: "Massa m", tipo: "numero", padrao: 10, unidade: "kg" },
    { id: "th", rotulo: "Ângulo θ", tipo: "numero", padrao: 30, unidade: "°" },
    { id: "us", rotulo: "Atrito estático μe", tipo: "numero", padrao: 0.3 },
    { id: "uk", rotulo: "Atrito cinético μc", tipo: "numero", padrao: 0.2 },
    { id: "F", rotulo: "Força F (paralela, para cima)", tipo: "numero", padrao: 0, unidade: "N" },
    { id: "g", rotulo: "Gravidade g", tipo: "numero", padrao: 9.81, unidade: "m/s²" },
  ],
  resolver(v) {
    const r = novo();
    const m = num(v.m), th = num(v.th), us = num(v.us), uk = num(v.uk), F = num(v.F), g = num(v.g, 9.81);
    if (!(m > 0)) return { ...r, avisos: ["A massa precisa ser maior que zero."] };
    const P = m * g, Px = P * Math.sin(th * RAD), Py = P * Math.cos(th * RAD), N = Py;
    r.passos.push({ titulo: "Peso e componentes", linhas: [`P = m·g = ${fmt(m)}·${fmt(g)} = ${fmt(P)} N`, `P∥ = P·sen θ = ${fmt(P)}·sen ${fmt(th)}° = ${fmt(Px)} N (desce o plano)`, `P⊥ = P·cos θ = ${fmt(P)}·cos ${fmt(th)}° = ${fmt(Py)} N`] });
    r.passos.push({ titulo: "Normal (equilíbrio perpendicular ao plano)", linhas: [`N = P⊥ = ${fmt(N)} N`] });
    const motriz = Px - F;
    r.passos.push({ titulo: "Força que tenta mover (positivo = descer)", linhas: [`P∥ − F = ${fmt(Px)} − ${fmt(F)} = ${fmt(motriz)} N`] });
    Object.assign(r.numeros, { P, Px, Py, N });
    comAtrito(r, motriz, N, us, uk, m);
    if (r.numeros.move) r.destaques.splice(1, 0, ["Sentido", motriz > 0 ? "desce o plano" : "sobe o plano"]);
    const thc = Math.atan(us) / RAD;
    r.passos.push({ titulo: "Ângulo crítico (sem F, começa a escorregar)", linhas: [`tg θc = μe → θc = atan ${fmt(us)} = ${fmt(thc)}°`] });
    r.numeros.thetaC = thc;
    // diagrama do plano
    const W = 360, H = 240, t = Math.min(Math.max(th, 3), 75) * RAD;
    const x0 = 30, y0 = 210, L = 300;
    const x1 = x0 + L * Math.cos(t), y1 = y0 - L * Math.sin(t);
    const bx = x0 + 0.55 * L * Math.cos(t), by = y0 - 0.55 * L * Math.sin(t);
    const u = [Math.cos(t), -Math.sin(t)], n = [-Math.sin(t), -Math.cos(t)];
    const c = [bx + n[0] * 16, by + n[1] * 16];
    const k = 70 / Math.max(P, F, 1e-9);
    let s = `<svg viewBox="0 0 ${W} ${H}" class="ce-grafico" role="img" aria-label="Plano inclinado"><polygon points="${x0},${y0} ${x1.toFixed(1)},${y1.toFixed(1)} ${x1.toFixed(1)},${y0}" fill="#f5f7f9" stroke="#9aa6b2"/>`;
    s += `<g transform="translate(${c[0].toFixed(1)} ${c[1].toFixed(1)}) rotate(${(-t / RAD).toFixed(1)})"><rect x="-22" y="-16" width="44" height="32" fill="#e3effb" stroke="#2f7fd0"/></g>`;
    s += `<text x="${x0 + 34}" y="${y0 - 6}" class="eixo">θ = ${fmt(th, 1)}°</text>`;
    s += seta(c[0], c[1], c[0], c[1] + P * k, "#1e2730", "P");
    s += seta(c[0], c[1], c[0] + n[0] * N * k, c[1] + n[1] * N * k, "#2e8b57", "N");
    const fat = r.numeros.fat ?? 0;
    if (fat > 1e-9) {
      // atrito contra o movimento (ou contra a tendência): motriz > 0 = desce → atrito para cima
      const sgn = motriz > 0 ? 1 : -1;
      s += seta(c[0], c[1], c[0] + u[0] * sgn * fat * k, c[1] + u[1] * sgn * fat * k, "#c9372c", "Fat");
    }
    if (F > 1e-9) s += seta(c[0] + u[0] * 22, c[1] + u[1] * 22, c[0] + u[0] * (22 + F * k), c[1] + u[1] * (22 + F * k), "#e07a10", "F");
    r.svg = `${s}</svg>`;
    return r;
  },
};

const atrito: DefCalculadora = {
  id: "atrito",
  forma: "bloco no plano horizontal puxado por F com ângulo θ acima da horizontal",
  campos: [
    { id: "m", rotulo: "Massa m", tipo: "numero", padrao: 10, unidade: "kg" },
    { id: "F", rotulo: "Força F", tipo: "numero", padrao: 60, unidade: "N" },
    { id: "th", rotulo: "Ângulo de F (θ)", tipo: "numero", padrao: 0, unidade: "°" },
    { id: "us", rotulo: "Atrito estático μe", tipo: "numero", padrao: 0.5 },
    { id: "uk", rotulo: "Atrito cinético μc", tipo: "numero", padrao: 0.4 },
    { id: "g", rotulo: "Gravidade g", tipo: "numero", padrao: 9.81, unidade: "m/s²" },
  ],
  resolver(v) {
    const r = novo();
    const m = num(v.m), F = num(v.F), th = num(v.th), us = num(v.us), uk = num(v.uk), g = num(v.g, 9.81);
    if (!(m > 0)) return { ...r, avisos: ["A massa precisa ser maior que zero."] };
    const P = m * g, Fx = F * Math.cos(th * RAD), Fy = F * Math.sin(th * RAD);
    const N = P - Fy;
    r.passos.push({ titulo: "Componentes de F", linhas: [`Fx = F·cos θ = ${fmt(F)}·cos ${fmt(th)}° = ${fmt(Fx)} N`, `Fy = F·sen θ = ${fmt(Fy)} N`] });
    r.passos.push({ titulo: "Normal (equilíbrio vertical)", linhas: [`N = P − Fy = m·g − Fy = ${fmt(P)} − ${p(Fy)} = ${fmt(N)} N`] });
    Object.assign(r.numeros, { P, N, Fx });
    if (N <= 0) {
      r.avisos.push("N ≤ 0: a componente vertical de F levanta o bloco do chão; não há atrito.");
      r.destaques.push(["Normal N", `${fmt(N)} N`]);
      return r;
    }
    comAtrito(r, Fx, N, us, uk, m);
    let s = `<svg viewBox="0 0 320 200" class="ce-grafico" role="img" aria-label="Bloco com atrito"><line x1="20" y1="150" x2="300" y2="150" stroke="#9aa6b2" stroke-width="2"/><rect x="130" y="110" width="60" height="40" fill="#e3effb" stroke="#2f7fd0"/>`;
    const k = 60 / Math.max(P, F, 1e-9);
    s += seta(160, 130, 160, 130 + P * k, "#1e2730", "P") + seta(160, 130, 160, 130 - N * k, "#2e8b57", "N");
    if (F > 0) s += seta(190, 130, 190 + F * k * Math.cos(th * RAD), 130 - F * k * Math.sin(th * RAD), "#e07a10", "F");
    if ((r.numeros.fat ?? 0) > 1e-9) s += seta(130, 145, 130 - r.numeros.fat * k, 145, "#c9372c", "Fat");
    r.svg = `${s}</svg>`;
    return r;
  },
};

const trabalho: DefCalculadora = {
  id: "trabalho",
  forma: "W = F·d·cos θ  ·  W = ΔEc  ·  W do peso = −m·g·Δh",
  campos: [
    { id: "modo", rotulo: "Cálculo", tipo: "opcao", opcoes: [["forca", "Força constante (W = F·d·cos θ)"], ["cinetica", "Teorema da energia cinética"], ["peso", "Trabalho do peso"]], padrao: "forca" },
    { id: "F", rotulo: "Força F", tipo: "numero", padrao: 50, unidade: "N", mostrarSe: (v) => v.modo === "forca" || v.modo === undefined },
    { id: "d", rotulo: "Deslocamento d", tipo: "numero", padrao: 10, unidade: "m", mostrarSe: (v) => v.modo === "forca" || v.modo === undefined },
    { id: "th", rotulo: "Ângulo entre F e d", tipo: "numero", padrao: 0, unidade: "°", mostrarSe: (v) => v.modo === "forca" || v.modo === undefined },
    { id: "t", rotulo: "Tempo (para a potência; 0 = não)", tipo: "numero", padrao: 0, unidade: "s", mostrarSe: (v) => v.modo === "forca" || v.modo === undefined },
    { id: "m", rotulo: "Massa m", tipo: "numero", padrao: 2, unidade: "kg", mostrarSe: (v) => v.modo === "cinetica" || v.modo === "peso" },
    { id: "v0", rotulo: "Velocidade inicial v₀", tipo: "numero", padrao: 0, unidade: "m/s", mostrarSe: (v) => v.modo === "cinetica" },
    { id: "v", rotulo: "Velocidade final v", tipo: "numero", padrao: 10, unidade: "m/s", mostrarSe: (v) => v.modo === "cinetica" },
    { id: "h", rotulo: "Variação de altura Δh (subida > 0)", tipo: "numero", padrao: 5, unidade: "m", mostrarSe: (v) => v.modo === "peso" },
    { id: "g", rotulo: "Gravidade g", tipo: "numero", padrao: 9.81, unidade: "m/s²", mostrarSe: (v) => v.modo === "peso" },
  ],
  resolver(v) {
    const r = novo();
    const modo = txt(v.modo, "forca");
    if (modo === "cinetica") {
      const m = num(v.m), v0 = num(v.v0), v1 = num(v.v);
      const e0 = 0.5 * m * v0 * v0, e1 = 0.5 * m * v1 * v1, W = e1 - e0;
      r.passos.push({ titulo: "Energias cinéticas: Ec = m·v²/2", linhas: [`Ec₀ = ${fmt(m)}·${p(v0)}²/2 = ${fmt(e0)} J`, `Ec = ${fmt(m)}·${p(v1)}²/2 = ${fmt(e1)} J`] });
      r.passos.push({ titulo: "Teorema da energia cinética: W = ΔEc", linhas: [`W = ${fmt(e1)} − ${fmt(e0)} = ${fmt(W)} J`] });
      r.destaques.push(["Trabalho W", `${fmt(W)} J`], ["Tipo", W > 0 ? "motor (acelera)" : W < 0 ? "resistente (freia)" : "nulo"]);
      Object.assign(r.numeros, { W, Ec0: e0, Ec: e1 });
      return r;
    }
    if (modo === "peso") {
      const m = num(v.m), h = num(v.h), g = num(v.g, 9.81);
      const W = -m * g * h;
      r.passos.push({ titulo: "Trabalho do peso (independe da trajetória)", linhas: [`W = −m·g·Δh = −${fmt(m)}·${fmt(g)}·${p(h)} = ${fmt(W)} J`, h > 0 ? "Subida: o peso é contra o movimento (trabalho negativo)." : h < 0 ? "Descida: o peso ajuda (trabalho positivo)." : "Sem variação de altura: trabalho nulo."] });
      r.passos.push({ titulo: "Energia potencial gravitacional", linhas: [`ΔEp = m·g·Δh = ${fmt(-W)} J (W do peso = −ΔEp)`] });
      r.destaques.push(["Trabalho do peso", `${fmt(W)} J`], ["ΔEp", `${fmt(-W)} J`]);
      Object.assign(r.numeros, { W, dEp: -W });
      return r;
    }
    const F = num(v.F), d = num(v.d), th = num(v.th), t = num(v.t);
    const W = F * d * Math.cos(th * RAD);
    r.passos.push({ titulo: "W = F·d·cos θ", linhas: [`W = ${fmt(F)}·${fmt(d)}·cos ${fmt(th)}° = ${fmt(W)} J`, Math.abs(th % 180 - 90) < 1e-9 ? "θ = 90°: a força é perpendicular ao deslocamento e não realiza trabalho." : W >= 0 ? "Trabalho motor (a força favorece o movimento)." : "Trabalho resistente (a força se opõe ao movimento)."] });
    r.destaques.push(["Trabalho W", `${fmt(W)} J`]);
    r.numeros.W = W;
    if (t > 0) {
      r.passos.push({ titulo: "Potência média", linhas: [`P = W / Δt = ${fmt(W)} / ${fmt(t)} = ${fmt(W / t)} W`] });
      r.destaques.push(["Potência", `${fmt(W / t)} W`]);
      r.numeros.Pot = W / t;
    }
    return r;
  },
};

export const CALCULADORAS: Record<string, DefCalculadora> = Object.fromEntries([eq1, eq2, sistemas, inequacoes, cramer, gauss, mult, newton, plano, atrito, trabalho].map((c) => [c.id, c]));

/** Valores iniciais (padrões) de uma calculadora, completados pelos já guardados. */
export function valoresDe(def: DefCalculadora, guardados?: Valores): Valores {
  const v: Valores = {};
  for (const c of def.campos) {
    const g = guardados?.[c.id];
    if (c.tipo === "numero") v[c.id] = typeof g === "number" && Number.isFinite(g) ? g : c.padrao;
    else if (c.tipo === "opcao") v[c.id] = typeof g === "string" && c.opcoes.some((o) => o[0] === g) ? g : c.padrao;
    else v[c.id] = Array.isArray(g) && g.length && Array.isArray(g[0]) ? (g as Matriz).map((l) => l.map((x) => num(x))) : c.padrao.map((l) => [...l]);
  }
  return v;
}
