// WJCalcEng — expressões matemáticas (motor puro, testado em scripts/teste-calceng.ts):
// leitura do que o aluno digita ("x^2 + 3x", "sen 2x", "e^(x²)", "√(1 − x²)"), árvore com números
// RACIONAIS exatos (1/3 continua 1/3), simplificação (junta termos e potências), valor numérico e
// impressão em texto (pt-BR), HTML (frações empilhadas, expoentes, raiz) e LaTeX.

// ---------------------------------------------------------------------------------------------
// árvore

/** "pm" = ±u (só no editor de equações: a ± b). */
export type NomeFn = "sen" | "cos" | "tg" | "cotg" | "sec" | "cossec" | "arcsen" | "arccos" | "arctg" | "ln" | "log" | "abs" | "senh" | "cosh" | "tgh" | "pm";
export type No =
  /** Número racional p/q (q > 0); número decimal longo vira p com q = 1. */
  | { t: "n"; p: number; q: number }
  | { t: "v"; n: string }
  | { t: "c"; n: "pi" | "e" }
  | { t: "+"; a: No[] }
  | { t: "*"; a: No[] }
  | { t: "^"; b: No; e: No }
  | { t: "f"; n: NomeFn; a: No };

const mdc = (a: number, b: number): number => {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a;
};
/** Racional normalizado; sem inteiros exatos vira decimal (q = 1). */
export function Q(p: number, q = 1): No {
  if (q < 0) [p, q] = [-p, -q];
  if (!Number.isInteger(p) || !Number.isInteger(q) || Math.abs(p) > 2 ** 52 || q > 2 ** 52) return { t: "n", p: p / q, q: 1 };
  const g = mdc(p, q) || 1;
  return { t: "n", p: p / g || 0, q: q / g };
}
export const ZERO = Q(0), UM = Q(1), MENOS_UM = Q(-1), MEIO = Q(1, 2);
export const PI: No = { t: "c", n: "pi" };
export const E: No = { t: "c", n: "e" };
export const v = (n: string): No => ({ t: "v", n });
const valorQ = (n: { p: number; q: number }) => n.p / n.q;
const ehN = (n: No, p: number, q = 1): boolean => n.t === "n" && n.p === p && n.q === q;
export const ehZero = (n: No) => ehN(n, 0);
export const ehUm = (n: No) => ehN(n, 1);
/** Valor inteiro do número (null se não for inteiro). */
const inteiro = (n: No): number | null => (n.t === "n" && n.q === 1 && Number.isInteger(n.p) ? n.p : null);
const ehInteiro = (n: No) => inteiro(n) !== null;
const qSoma = (a: { p: number; q: number }, b: { p: number; q: number }) => Q(a.p * b.q + b.p * a.q, a.q * b.q);
const qMult = (a: { p: number; q: number }, b: { p: number; q: number }) => Q(a.p * b.p, a.q * b.q);
function qPot(a: { p: number; q: number }, k: number): No | null {
  if (a.p === 0 && k < 0) return null;
  if (Math.abs(k) > 64) return null;
  const r = Q(a.p ** Math.abs(k), a.q ** Math.abs(k));
  if (r.t !== "n") return null;
  return k < 0 ? Q(r.q, r.p) : r;
}

/** Texto canônico (comparar e ordenar). */
export function chave(n: No): string {
  switch (n.t) {
    case "n": return `${n.p}/${n.q}`;
    case "v": return n.n;
    case "c": return `#${n.n}`;
    case "+": return `(+ ${n.a.map(chave).join(" ")})`;
    case "*": return `(* ${n.a.map(chave).join(" ")})`;
    case "^": return `(^ ${chave(n.b)} ${chave(n.e)})`;
    case "f": return `(${n.n} ${chave(n.a)})`;
  }
}
export const iguais = (a: No, b: No) => chave(a) === chave(b);

/** A expressão depende da variável? */
export function contem(n: No, x: string): boolean {
  switch (n.t) {
    case "n": case "c": return false;
    case "v": return n.n === x;
    case "+": case "*": return n.a.some((a) => contem(a, x));
    case "^": return contem(n.b, x) || contem(n.e, x);
    case "f": return contem(n.a, x);
  }
}
/** Variáveis usadas. */
export function variaveis(n: No, s = new Set<string>()): Set<string> {
  if (n.t === "v") s.add(n.n);
  else if (n.t === "+" || n.t === "*") n.a.forEach((a) => variaveis(a, s));
  else if (n.t === "^") {
    variaveis(n.b, s);
    variaveis(n.e, s);
  } else if (n.t === "f") variaveis(n.a, s);
  return s;
}

// ---------------------------------------------------------------------------------------------
// simplificação (forma canônica)

/** Grau em x (só para ordenar os termos: maior grau primeiro). */
function grau(n: No, x: string): number {
  if (n.t === "v") return n.n === x ? 1 : 0;
  if (n.t === "^" && n.b.t === "v" && n.b.n === x && n.e.t === "n") return valorQ(n.e);
  if (n.t === "*") return n.a.reduce((s, a) => s + grau(a, x), 0);
  return 0;
}
const baseDe = (n: No) => (n.t === "^" ? n.b : n);
function rankFator(n: No): number {
  const b = baseDe(n);
  if (n.t === "^" && b.t === "c" && variaveis(n.e).size) return 3; // eˣ depois de x
  return b.t === "n" ? 0 : b.t === "c" ? 1 : b.t === "v" ? 2 : b.t === "+" ? 4 : 3;
}
let varOrdem = "x";

function sSoma(termos: No[]): No {
  const plano: No[] = [];
  const empurrar = (t: No) => {
    if (t.t === "+") t.a.forEach(empurrar);
    // k·(a + b) dentro de uma soma vira k·a + k·b (junta termos semelhantes: x − 1 − (x + 1) = −2)
    else if (t.t === "*" && t.a.length === 2 && t.a[0].t === "n" && t.a[1].t === "+") t.a[1].a.forEach((u) => empurrar(sMult([t.a[0], u])));
    else plano.push(t);
  };
  termos.forEach(empurrar);
  let c: No = ZERO;
  const grupos = new Map<string, { resto: No; coef: No }>();
  for (const t of plano) {
    if (t.t === "n") {
      c = qSoma(c as { p: number; q: number }, t);
      continue;
    }
    let coef: No = UM, resto: No = t;
    if (t.t === "*" && t.a[0].t === "n") {
      coef = t.a[0];
      resto = t.a.length === 2 ? t.a[1] : { t: "*", a: t.a.slice(1) };
    }
    const k = chave(resto);
    const g = grupos.get(k);
    if (g) g.coef = qSoma(g.coef as { p: number; q: number }, coef as { p: number; q: number });
    else grupos.set(k, { resto, coef });
  }
  const out: No[] = [];
  for (const { resto, coef } of grupos.values()) {
    if (ehZero(coef)) continue;
    out.push(ehUm(coef) ? resto : sMult([coef, resto]));
  }
  out.sort((a, b) => grau(b, varOrdem) - grau(a, varOrdem) || (chave(a) < chave(b) ? -1 : 1));
  if (!ehZero(c)) out.push(c);
  if (!out.length) return ZERO;
  return out.length === 1 ? out[0] : { t: "+", a: out };
}

function sMult(fatores: No[]): No {
  const plano: No[] = [];
  for (const f of fatores) (f.t === "*" ? plano.push(...f.a) : plano.push(f));
  let c: No = UM;
  const grupos = new Map<string, { b: No; e: No[] }>();
  for (const f of plano) {
    if (f.t === "n") {
      c = qMult(c as { p: number; q: number }, f);
      continue;
    }
    // potências de mesma base somam os expoentes (√2·√2 = 2, x²·x³ = x⁵, eˣ·e²ˣ = e³ˣ)
    const b = f.t === "^" ? f.b : f;
    const e = f.t === "^" ? f.e : UM;
    const k = chave(b);
    const g = grupos.get(k);
    if (g) g.e.push(e);
    else grupos.set(k, { b, e: [e] });
  }
  if (ehZero(c)) return ZERO;
  const out: No[] = [];
  for (const { b, e } of grupos.values()) {
    const p = sPot(b, e.length === 1 ? e[0] : sSoma(e));
    if (p.t === "n") c = qMult(c as { p: number; q: number }, p);
    else if (p.t === "*") for (const q of p.a) (q.t === "n" ? (c = qMult(c as { p: number; q: number }, q)) : out.push(q));
    else if (!ehUm(p)) out.push(p);
  }
  if (ehZero(c)) return ZERO;
  out.sort((a, b) => rankFator(a) - rankFator(b) || (chave(baseDe(a)) < chave(baseDe(b)) ? -1 : 1));
  if (!out.length) return c;
  if (ehUm(c)) return out.length === 1 ? out[0] : { t: "*", a: out };
  return { t: "*", a: [c, ...out] };
}

function quadradoPerfeito(n: number): number | null {
  if (n < 0 || !Number.isInteger(n)) return null;
  const r = Math.round(Math.sqrt(n));
  return r * r === n ? r : null;
}

function sPot(b: No, e: No): No {
  if (ehZero(e)) return UM;
  if (ehUm(e)) return b;
  if (ehUm(b)) return UM;
  if (b.t === "n" && e.t === "n") {
    const k = inteiro(e);
    if (k !== null) {
      const r = qPot(b, k);
      if (r) return r;
    } else if (e.q === 2 && b.q >= 1 && b.p > 0) {
      const rp = quadradoPerfeito(b.p), rq = quadradoPerfeito(b.q);
      if (rp !== null && rq !== null) return sPot(Q(rp, rq), Q(e.p));
    }
  }
  if (ehZero(b) && e.t === "n" && e.p > 0) return ZERO;
  if (b.t === "^" && ehInteiro(e)) return sPot(b.b, sMult([b.e, e]));
  if (b.t === "^" && b.b.t === "c" && b.b.n === "e") return sPot(b.b, sMult([b.e, e]));
  if (b.t === "*" && ehInteiro(e)) return sMult(b.a.map((f) => sPot(f, e)));
  if (b.t === "f" && b.n === "abs" && (inteiro(e) ?? 1) % 2 === 0) return sPot(b.a, e);
  if (b.t === "c" && b.n === "e" && e.t === "f" && e.n === "ln") return e.a;
  return { t: "^", b, e };
}

/** k·π com k racional (para valores exatos de sen/cos). */
function multiploDePi(a: No): number | null {
  if (a.t === "c" && a.n === "pi") return 1;
  if (ehZero(a)) return 0;
  if (a.t === "*" && a.a.length === 2 && a.a[0].t === "n" && a.a[1].t === "c" && a.a[1].n === "pi") return valorQ(a.a[0]);
  return null;
}

/** sen exato de k·π nos ângulos notáveis (múltiplos de 30° e 45°), ou null. */
function senExato(k: number): No | null {
  let g = Math.round(k * 180 * 1e6) / 1e6;
  if (!Number.isInteger(g) || (g % 30 !== 0 && g % 45 !== 0)) return null;
  g = ((g % 360) + 360) % 360;
  const sinal = g > 180 ? -1 : 1;
  let r = g > 180 ? g - 180 : g;
  if (r > 90) r = 180 - r;
  const v: Record<number, No> = { 0: ZERO, 30: MEIO, 45: { t: "^", b: Q(2), e: Q(-1, 2) }, 60: { t: "*", a: [MEIO, { t: "^", b: Q(3), e: MEIO }] }, 90: UM };
  const base = v[r];
  return base ? (sinal < 0 ? sMult([MENOS_UM, base]) : base) : null;
}
/** Ângulo exato (em múltiplos de π) para arcsen/arccos/arctg de valores notáveis. */
function anguloNotavel(n: "arcsen" | "arccos" | "arctg", a: No): No | null {
  const x = a.t === "n" ? valorQ(a) : NaN;
  const tabela: Record<string, Record<string, number>> = {
    arcsen: { "-1": -1 / 2, "-0.5": -1 / 6, "0": 0, "0.5": 1 / 6, "1": 1 / 2 },
    arccos: { "-1": 1, "-0.5": 2 / 3, "0": 1 / 2, "0.5": 1 / 3, "1": 0 },
    arctg: { "-1": -1 / 4, "0": 0, "1": 1 / 4 },
  };
  const k = tabela[n][String(x)];
  if (k === undefined) return null;
  return k === 0 ? ZERO : sMult([Q(Math.round(k * 12), 12), PI]);
}

function sFn(n: NomeFn, a: No): No {
  const k = multiploDePi(a);
  const meio = k !== null ? Math.round(k * 2) / 2 === k : false; // múltiplo de π/2
  if (k !== null && (n === "sen" || n === "cos" || n === "tg")) {
    const s = senExato(k), c = senExato(k + 0.5);
    if (n === "sen" && s) return s;
    if (n === "cos" && c) return c;
    if (n === "tg" && s && c && !ehZero(c)) return sMult([s, sPot(c, MENOS_UM)]);
  }
  // paridade: sen, tg, arcsen, arctg e senh são ímpares; cos e cosh são pares
  const negArg = (a.t === "*" && a.a[0].t === "n" && a.a[0].p < 0) || (a.t === "n" && a.p < 0);
  if (negArg && ["sen", "tg", "cotg", "cossec", "arcsen", "arctg", "senh", "tgh", "cos", "sec", "cosh"].includes(n)) {
    const pos = sMult([MENOS_UM, a]);
    const r = sFn(n, pos);
    return ["cos", "sec", "cosh"].includes(n) ? r : sMult([MENOS_UM, r]);
  }
  if ((n === "arcsen" || n === "arccos" || n === "arctg") && a.t === "n") {
    const r = anguloNotavel(n, a);
    if (r) return r;
  }
  switch (n) {
    case "ln":
      if (ehUm(a)) return ZERO;
      if (a.t === "c" && a.n === "e") return UM;
      if (a.t === "^" && a.b.t === "c" && a.b.n === "e") return a.e;
      break;
    case "sen":
      if (k !== null && meio) return Q(Math.round(Math.sin(k * Math.PI)));
      break;
    case "cos":
      if (k !== null && meio) return Q(Math.round(Math.cos(k * Math.PI)));
      break;
    case "tg":
      if (k !== null && Number.isInteger(k)) return ZERO;
      break;
    case "arcsen": case "arctg": case "senh": case "tgh":
      if (ehZero(a)) return ZERO;
      break;
    case "arccos":
      if (ehUm(a)) return ZERO;
      break;
    case "cosh":
      if (ehZero(a)) return UM;
      break;
    case "abs":
      if (a.t === "n") return Q(Math.abs(a.p), a.q);
      if (a.t === "c" || (a.t === "f" && a.n === "abs")) return a;
      if (a.t === "^" && a.b.t === "c" && a.b.n === "e") return a;
      break;
  }
  return { t: "f", n, a };
}

/** Simplifica (forma canônica). `x` = variável principal (ordem dos termos). */
export function simplificar(n: No, x = varOrdem): No {
  const ant = varOrdem;
  varOrdem = x;
  try {
    return s(n);
  } finally {
    varOrdem = ant;
  }
}
function s(n: No): No {
  switch (n.t) {
    case "n": case "v": case "c": return n;
    case "+": return sSoma(n.a.map(s));
    case "*": return sMult(n.a.map(s));
    case "^": return sPot(s(n.b), s(n.e));
    case "f": return sFn(n.n, s(n.a));
  }
}

// construtores já simplificados
export const soma = (...a: No[]) => sSoma(a.map(s));
export const mult = (...a: No[]) => sMult(a.map(s));
export const pot = (b: No, e: No) => sPot(s(b), s(e));
export const fn = (n: NomeFn, a: No) => sFn(n, s(a));
export const neg = (a: No) => mult(MENOS_UM, a);
export const sub = (a: No, b: No) => soma(a, neg(b));
export const div = (a: No, b: No) => mult(a, pot(b, MENOS_UM));
export const raiz = (a: No) => pot(a, MEIO);

/** Troca a variável por uma expressão (substituição). */
export function trocar(n: No, x: string, por: No): No {
  switch (n.t) {
    case "n": case "c": return n;
    case "v": return n.n === x ? por : n;
    case "+": return soma(...n.a.map((a) => trocar(a, x, por)));
    case "*": return mult(...n.a.map((a) => trocar(a, x, por)));
    case "^": return pot(trocar(n.b, x, por), trocar(n.e, x, por));
    case "f": return fn(n.n, trocar(n.a, x, por));
  }
}

/** Troca uma subexpressão (por igualdade estrutural) por outra. */
export function trocarSub(n: No, alvo: No, por: No): No {
  if (iguais(n, alvo)) return por;
  switch (n.t) {
    case "n": case "c": case "v": return n;
    case "+": return soma(...n.a.map((a) => trocarSub(a, alvo, por)));
    case "*": return mult(...n.a.map((a) => trocarSub(a, alvo, por)));
    case "^":
      // potência do alvo: (alvo)^k
      return pot(trocarSub(n.b, alvo, por), trocarSub(n.e, alvo, por));
    case "f": return fn(n.n, trocarSub(n.a, alvo, por));
  }
}

/** Distribui o produto de duas somas termo a termo. */
function distribuir(a: No, b: No): No {
  const as = a.t === "+" ? a.a : [a], bs = b.t === "+" ? b.a : [b];
  return soma(...as.flatMap((x) => bs.map((y) => mult(x, y))));
}
/** Expande produtos e potências inteiras de somas (até a 8ª). */
export function expandir(n: No): No {
  switch (n.t) {
    case "+": return soma(...n.a.map(expandir));
    case "*": return n.a.map(expandir).reduce((r, f) => distribuir(r, f), UM);
    case "^": {
      const b = expandir(n.b);
      const k = inteiro(n.e);
      if (b.t === "+" && k !== null && k > 1 && k <= 8) {
        let r: No = b;
        for (let i = 1; i < k; i++) r = distribuir(r, b);
        return r;
      }
      return pot(b, n.e);
    }
    default: return n;
  }
}

// ---------------------------------------------------------------------------------------------
// valor numérico

export function avaliar(n: No, amb: Record<string, number>): number {
  switch (n.t) {
    case "n": return valorQ(n);
    case "c": return n.n === "pi" ? Math.PI : Math.E;
    case "v": return amb[n.n] ?? NaN;
    case "+": return n.a.reduce((s, a) => s + avaliar(a, amb), 0);
    case "*": return n.a.reduce((s, a) => s * avaliar(a, amb), 1);
    case "^": {
      const b = avaliar(n.b, amb), e = avaliar(n.e, amb);
      // raiz ímpar de negativo (∛−8 = −2)
      if (b < 0 && n.e.t === "n" && n.e.q % 2 === 1 && !Number.isInteger(e)) return -((-b) ** e) * (n.e.p % 2 === 0 ? -1 : 1);
      return b ** e;
    }
    case "f": {
      const a = avaliar(n.a, amb);
      switch (n.n) {
        case "sen": return Math.sin(a);
        case "cos": return Math.cos(a);
        case "tg": return Math.tan(a);
        case "cotg": return 1 / Math.tan(a);
        case "sec": return 1 / Math.cos(a);
        case "cossec": return 1 / Math.sin(a);
        case "arcsen": return Math.asin(a);
        case "arccos": return Math.acos(a);
        case "arctg": return Math.atan(a);
        case "ln": return a > 0 ? Math.log(a) : NaN;
        case "log": return a > 0 ? Math.log10(a) : NaN;
        case "abs": return Math.abs(a);
        case "senh": return Math.sinh(a);
        case "cosh": return Math.cosh(a);
        case "tgh": return Math.tanh(a);
        case "pm": return NaN;
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// leitura do que se digita

export class ErroExpressao extends Error {}

const FUNCOES: Record<string, NomeFn | "raiz" | "exp"> = {
  arcsen: "arcsen", arcsin: "arcsen", asen: "arcsen", asin: "arcsen",
  arccos: "arccos", acos: "arccos",
  arctg: "arctg", arctan: "arctg", atg: "arctg", atan: "arctg",
  cossec: "cossec", csc: "cossec", cosec: "cossec",
  cotg: "cotg", cotan: "cotg", cot: "cotg",
  senh: "senh", sinh: "senh", cosh: "cosh", tgh: "tgh", tanh: "tgh",
  sen: "sen", sin: "sen", cos: "cos", tg: "tg", tan: "tg", sec: "sec",
  ln: "ln", log: "log", abs: "abs", raiz: "raiz", sqrt: "raiz", exp: "exp",
};
const NOMES = Object.keys(FUNCOES).sort((a, b) => b.length - a.length);

type Token = { k: "num"; v: No } | { k: "id"; v: string } | { k: "fn"; v: NomeFn | "raiz" | "exp" } | { k: "op"; v: string };

const SOBRESCRITO: Record<string, string> = { "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9", "⁻": "-" };

function tokens(texto: string): Token[] {
  let t = texto.replace(/\*\*/g, "^").replace(/[×·∙]/g, "*").replace(/÷/g, "/").replace(/[−–]/g, "-").replace(/π/g, "pi").replace(/∞/g, "inf");
  // sobrescritos: x² → x^(2)
  t = t.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻]+/g, (m) => `^(${m.split("").map((c) => SOBRESCRITO[c]).join("")})`);
  const out: Token[] = [];
  let i = 0;
  while (i < t.length) {
    const c = t[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(t[i + 1] ?? ""))) {
      let j = i;
      while (j < t.length && /[0-9]/.test(t[j])) j++;
      let dec = "";
      if ((t[j] === "," || t[j] === ".") && /[0-9]/.test(t[j + 1] ?? "")) {
        let k = j + 1;
        while (k < t.length && /[0-9]/.test(t[k])) k++;
        dec = t.slice(j + 1, k);
        j = k;
      }
      const inteiro = t.slice(i, j).split(/[.,]/)[0] || "0";
      out.push({ k: "num", v: dec.length <= 9 ? Q(Number(inteiro + dec), 10 ** dec.length) : Q(Number(`${inteiro}.${dec}`)) });
      i = j;
      continue;
    }
    if (c === "√") {
      out.push({ k: "fn", v: "raiz" });
      i++;
      continue;
    }
    if (/[a-zA-ZÀ-ÿ]/.test(c)) {
      let j = i;
      while (j < t.length && /[a-zA-ZÀ-ÿ]/.test(t[j])) j++;
      const palavra = t.slice(i, j).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
      // separa a palavra em funções, constantes e variáveis de uma letra
      let k = 0;
      while (k < palavra.length) {
        const nome = NOMES.find((n) => palavra.startsWith(n, k));
        if (nome) {
          out.push({ k: "fn", v: FUNCOES[nome] });
          k += nome.length;
        } else if (palavra.startsWith("pi", k)) {
          out.push({ k: "id", v: "pi" });
          k += 2;
        } else {
          out.push({ k: "id", v: palavra[k] });
          k++;
        }
      }
      i = j;
      continue;
    }
    if ("+-*/^()[]{}|=,±".includes(c)) {
      if (c === ",") throw new ErroExpressao(`Vírgula fora de número na posição ${i + 1}.`);
      out.push({ k: "op", v: "[{".includes(c) ? "(" : "]}".includes(c) ? ")" : c });
      i++;
      continue;
    }
    throw new ErroExpressao(`Símbolo "${c}" não reconhecido.`);
  }
  return out;
}

class Leitor {
  i = 0;
  constructor(private ts: Token[]) {}
  ver(): Token | undefined {
    return this.ts[this.i];
  }
  eh(op: string) {
    const t = this.ver();
    return t?.k === "op" && t.v === op;
  }
  esperar(op: string) {
    if (!this.eh(op)) throw new ErroExpressao(op === ")" ? "Falta fechar um parêntese." : `Esperava "${op}".`);
    this.i++;
  }
  /** Começa um fator (para multiplicação implícita: 2x, x(x+1), 3sen x). */
  comecaFator() {
    const t = this.ver();
    return !!t && (t.k === "num" || t.k === "id" || t.k === "fn" || (t.k === "op" && (t.v === "(" || t.v === "|")));
  }
  expr(): No {
    let r = this.termo();
    for (;;) {
      if (this.eh("+")) {
        this.i++;
        r = { t: "+", a: [r, this.termo()] };
      } else if (this.eh("-")) {
        this.i++;
        r = { t: "+", a: [r, { t: "*", a: [MENOS_UM, this.termo()] }] };
      } else if (this.eh("±")) {
        this.i++;
        r = { t: "+", a: [r, { t: "f", n: "pm", a: this.termo() }] };
      } else return r;
    }
  }
  termo(): No {
    let r = this.unario();
    for (;;) {
      if (this.eh("*")) {
        this.i++;
        r = { t: "*", a: [r, this.unario()] };
      } else if (this.eh("/")) {
        this.i++;
        r = { t: "*", a: [r, { t: "^", b: this.unario(), e: MENOS_UM }] };
      } else if (this.comecaFator() && !this.eh("|")) r = { t: "*", a: [r, this.potencia()] };
      else return r;
    }
  }
  unario(): No {
    if (this.eh("-")) {
      this.i++;
      return { t: "*", a: [MENOS_UM, this.unario()] };
    }
    if (this.eh("+")) {
      this.i++;
      return this.unario();
    }
    if (this.eh("±")) {
      this.i++;
      return { t: "f", n: "pm", a: this.unario() };
    }
    return this.potencia();
  }
  potencia(): No {
    const b = this.primario();
    if (this.eh("^")) {
      this.i++;
      return { t: "^", b, e: this.unario() };
    }
    return b;
  }
  primario(): No {
    const t = this.ver();
    if (!t) throw new ErroExpressao("A expressão terminou antes do esperado.");
    if (t.k === "num") {
      this.i++;
      return t.v;
    }
    if (t.k === "id") {
      this.i++;
      if (t.v === "pi") return PI;
      if (t.v === "e") return E;
      return v(t.v);
    }
    if (t.k === "fn") {
      this.i++;
      // sen^2(x) = (sen x)²
      let expoente: No | null = null;
      if (this.eh("^")) {
        this.i++;
        expoente = this.primario();
      }
      const arg = this.argumento();
      const base: No = t.v === "raiz" ? { t: "^", b: arg, e: MEIO } : t.v === "exp" ? { t: "^", b: E, e: arg } : { t: "f", n: t.v, a: arg };
      return expoente ? { t: "^", b: base, e: expoente } : base;
    }
    if (t.k === "op" && t.v === "(") {
      this.i++;
      const r = this.expr();
      this.esperar(")");
      return r;
    }
    if (t.k === "op" && t.v === "|") {
      this.i++;
      const r = this.expr();
      this.esperar("|");
      return { t: "f", n: "abs", a: r };
    }
    throw new ErroExpressao(t.k === "op" ? `"${t.v}" fora do lugar.` : "Expressão incompleta.");
  }
  /** Argumento de função: (…) ou, sem parênteses, o fator seguinte com os produtos implícitos (sen 2x). */
  argumento(): No {
    if (this.eh("(")) {
      this.i++;
      const r = this.expr();
      this.esperar(")");
      return r;
    }
    let r = this.potencia();
    for (;;) {
      const t = this.ver();
      if (t && (t.k === "num" || t.k === "id")) r = { t: "*", a: [r, this.potencia()] };
      else return r;
    }
  }
}

/** Lê uma expressão (sem "="). Lança ErroExpressao com mensagem em português. */
export function ler(texto: string, aceitaMaisMenos = false): No {
  if (!aceitaMaisMenos && texto.includes("±")) throw new ErroExpressao('O "±" só vale no Editor de equações.');
  if (!texto.trim()) throw new ErroExpressao("Digite uma expressão.");
  const ts = tokens(texto);
  if (ts.some((t) => t.k === "op" && t.v === "=")) throw new ErroExpressao('Aqui vai só a expressão, sem "=".');
  const l = new Leitor(ts);
  const r = l.expr();
  if (l.i < ts.length) {
    const t = ts[l.i];
    throw new ErroExpressao(t.k === "op" && t.v === ")" ? "Parêntese fechado sem abrir." : "Sobrou algo no fim da expressão.");
  }
  return r;
}
/** Lê uma equação ou expressão com um ou mais "=" (editor de equações). */
export function lerEquacao(texto: string): No[] {
  if (!texto.trim()) throw new ErroExpressao("Digite uma expressão.");
  return texto.split("=").map((lado, i) => {
    try {
      return ler(lado, true);
    } catch (e) {
      throw new ErroExpressao(`${texto.includes("=") ? `${i === 0 ? "Lado esquerdo" : "Lado direito"}: ` : ""}${(e as Error).message}`);
    }
  });
}

// ---------------------------------------------------------------------------------------------
// impressão

const NOME_FN: Record<NomeFn, string> = {
  sen: "sen", cos: "cos", tg: "tg", cotg: "cotg", sec: "sec", cossec: "cossec", arcsen: "arcsen", arccos: "arccos", arctg: "arctg",
  ln: "ln", log: "log", abs: "abs", senh: "senh", cosh: "cosh", tgh: "tgh", pm: "±",
};
const SUP = "⁰¹²³⁴⁵⁶⁷⁸⁹";
const sobrescrito = (k: number) => `${k < 0 ? "⁻" : ""}${String(Math.abs(k)).split("").map((d) => SUP[+d]).join("")}`;

function numTexto(p: number): string {
  if (Number.isInteger(p)) return String(Math.abs(p));
  return Math.abs(p).toLocaleString("pt-BR", { maximumFractionDigits: 6 });
}

/** Produto separado em sinal, coeficiente, numerador e denominador. */
function partes(n: No) {
  const fs = n.t === "*" ? n.a : [n];
  let sinal = 1, cp = 1, cq = 1;
  const num: No[] = [], den: No[] = [];
  for (const f of fs) {
    if (f.t === "n") {
      if (f.p < 0) sinal = -sinal;
      cp *= Math.abs(f.p);
      cq *= f.q;
    } else if (f.t === "^" && f.e.t === "n" && f.e.p < 0) den.push(sPot(f.b, Q(-f.e.p, f.e.q)));
    else num.push(f);
  }
  return { sinal, cp, cq, num, den };
}
const negativo = (t: No) => (t.t === "n" && t.p < 0) || (t.t === "*" && t.a[0].t === "n" && t.a[0].p < 0);

interface Estilo {
  num: (p: number) => string;
  v: (n: string) => string;
  c: (n: "pi" | "e") => string;
  mais: string;
  menos: string;
  maisMenos: string;
  vezes: string;
  menosUnario: string;
  frac: (n: string, d: string, nSimples: boolean, dSimples: boolean) => string;
  pot: (b: string, e: string, eSimplesInt: number | null) => string;
  raizQ: (a: string, simples: boolean) => string;
  fn: (nome: string, a: string) => string;
  abs: (a: string) => string;
  ln: (a: string) => string;
  par: (a: string) => string;
  supFn: (nome: string, k: number, a: string) => string;
}

function imprimir(n: No, es: Estilo, comoDigitado = false): string {
  const atomo = (x: No) => x.t === "v" || x.t === "c" || (x.t === "n" && x.q === 1 && x.p >= 0) || x.t === "f";
  const env = (x: No, minPrec: number) => (prec(x) < minPrec ? es.par(imp(x)) : imp(x));
  const prec = (x: No): number => {
    if (x.t === "+") return 1;
    if (x.t === "*") return negativo(x) ? 1.5 : 2;
    if (x.t === "n") return x.p < 0 ? 1.5 : x.q !== 1 ? 2 : 4;
    if (x.t === "^") return x.e.t === "n" && x.e.p < 0 ? 2 : 3;
    return 4;
  };
  const juntar = (fs: string[], cru: No[]) => fs.reduce((s, f, i) => {
    if (i === 0) return f;
    const ant = cru[i - 1], cur = cru[i];
    // como se escreve à mão: 3x, 4ac, x²y, 2π; ponto antes de funções e de eˣ (x·sen(x), 2x·e^x)
    const letra = (n: No) => n.t === "v" || (n.t === "c" && n.n === "pi") || (n.t === "^" && n.b.t === "v");
    const cola = ant.t === "n" ? cur.t !== "n" : letra(ant) && letra(cur);
    return s + (cola ? "" : es.vezes) + f;
  }, "");
  function prod(x: No): string {
    const { sinal, cp, cq, num, den } = partes(x);
    const temFracao = den.length > 0 || cq !== 1;
    // numerador/denominador de um fator só: a fração cuida dos parênteses
    const fNum = num.map((f) => (temFracao && num.length === 1 && cp === 1 ? imp(f) : env(f, 2)));
    const crusNum = num.slice();
    if (cp !== 1 || !num.length) {
      fNum.unshift(es.num(cp));
      crusNum.unshift(Q(cp));
    }
    let r = juntar(fNum, crusNum);
    if (den.length || cq !== 1) {
      const fDen = den.map((f) => (den.length === 1 && cq === 1 ? imp(f) : env(f, 2)));
      const crusDen = den.slice();
      if (cq !== 1) {
        fDen.unshift(es.num(cq));
        crusDen.unshift(Q(cq));
      }
      // numerador sem soma dispensa parênteses (a·x²/2); denominador composto leva: 1/(2x)
      const nSimples = crusNum.every((f) => prec(f) >= 2);
      const dSimples = crusDen.length === 1 && prec(crusDen[0]) >= 3;
      r = es.frac(r, juntar(fDen, crusDen), nSimples, dSimples);
    }
    return sinal < 0 ? es.menosUnario + r : r;
  }
  function imp(x: No): string {
    switch (x.t) {
      case "n": {
        const s = x.q === 1 ? es.num(x.p) : es.frac(es.num(x.p), es.num(x.q), true, true);
        return x.p < 0 ? es.menosUnario + s : s;
      }
      case "v": return es.v(x.n);
      case "c": return es.c(x.n);
      case "+": {
        // leitura natural: começa por um termo positivo quando houver (1 − x², não −x² + 1)
        const i0 = !comoDigitado && negativo(x.a[0]) ? x.a.findIndex((t) => !negativo(t) && !(t.t === "f" && t.n === "pm")) : 0;
        const ordem = i0 > 0 ? [x.a[i0], ...x.a.filter((_, i) => i !== i0)] : x.a;
        return ordem.map((t, i) => {
          if (t.t === "f" && t.n === "pm") return `${i === 0 ? "±" : es.maisMenos}${t.a.t === "+" ? es.par(imp(t.a)) : imp(t.a)}`;
          if (i === 0) return imp(t);
          if (!negativo(t)) return es.mais + imp(t);
          const m = neg(t);
          return es.menos + (m.t === "+" ? es.par(imp(m)) : imp(m));
        }).join("");
      }
      case "*": return prod(x);
      case "^": {
        if (x.e.t === "n" && x.e.p < 0) return prod(x);
        if (x.e.t === "n" && x.e.p === 1 && x.e.q === 2) return es.raizQ(imp(x.b), atomo(x.b) && x.b.t !== "f");
        const k = inteiro(x.e);
        if (x.b.t === "f" && k !== null && k > 0 && x.b.n !== "abs") return es.supFn(NOME_FN[x.b.n], k, imp(x.b.a));
        const base = atomo(x.b) && !(x.b.t === "f") ? imp(x.b) : es.par(imp(x.b));
        return es.pot(base, imp(x.e), k);
      }
      case "f":
        if (x.n === "pm") return `±${imp(x.a)}`;
        if (x.n === "abs") return es.abs(imp(x.a));
        if (x.n === "ln" && x.a.t === "f" && x.a.n === "abs") return es.ln(imp(x.a.a));
        return es.fn(NOME_FN[x.n], imp(x.a));
    }
  }
  return imp(n);
}

const escHtml = (t: string) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

const TEXTO: Estilo = {
  num: numTexto,
  v: (n) => n,
  c: (n) => (n === "pi" ? "π" : "e"),
  mais: " + ",
  menos: " − ",
  maisMenos: " ± ",
  vezes: "·",
  menosUnario: "−",
  frac: (n, d, ns, ds) => `${ns ? n : `(${n})`}/${ds ? d : `(${d})`}`,
  pot: (b, e, k) => (k !== null && k >= 0 ? `${b}${sobrescrito(k)}` : `${b}^${/^(\d+|[a-zπ])$/.test(e) ? e : `(${e})`}`),
  raizQ: (a, simples) => (simples ? `√${a}` : `√(${a})`),
  fn: (nome, a) => `${nome}(${a})`,
  abs: (a) => `|${a}|`,
  ln: (a) => `ln|${a}|`,
  par: (a) => `(${a})`,
  supFn: (nome, k, a) => `${nome}${sobrescrito(k)}(${a})`,
};
const HTML: Estilo = {
  num: numTexto,
  v: (n) => `<i>${escHtml(n)}</i>`,
  c: (n) => (n === "pi" ? "π" : "<i>e</i>"),
  mais: " + ",
  menos: " − ",
  maisMenos: " ± ",
  vezes: "·",
  menosUnario: "−",
  frac: (n, d) => `<span class="m-fr"><span class="m-num">${n}</span><span class="m-den">${d}</span></span>`,
  pot: (b, e) => `${b}<sup>${e}</sup>`,
  raizQ: (a) => `<span class="m-raiz"><span class="m-raiz-s">√</span><span class="m-raiz-a">${a}</span></span>`,
  fn: (nome, a) => `${nome}<span class="m-p">(</span>${a}<span class="m-p">)</span>`,
  abs: (a) => `|${a}|`,
  ln: (a) => `ln|${a}|`,
  par: (a) => `<span class="m-p">(</span>${a}<span class="m-p">)</span>`,
  supFn: (nome, k, a) => `${nome}<sup>${k}</sup><span class="m-p">(</span>${a}<span class="m-p">)</span>`,
};
const LATEX: Estilo = {
  num: (p) => (Number.isInteger(p) ? String(Math.abs(p)) : String(Math.abs(p)).replace(".", "{,}")),
  v: (n) => n,
  c: (n) => (n === "pi" ? "\\pi" : "e"),
  mais: " + ",
  menos: " - ",
  maisMenos: " \\pm ",
  vezes: " \\cdot ",
  menosUnario: "-",
  frac: (n, d) => `\\frac{${n}}{${d}}`,
  pot: (b, e) => `${b}^{${e}}`,
  raizQ: (a) => `\\sqrt{${a}}`,
  fn: (nome, a) => `\\operatorname{${nome}}\\left(${a}\\right)`,
  abs: (a) => `\\left|${a}\\right|`,
  ln: (a) => `\\ln\\left|${a}\\right|`,
  par: (a) => `\\left(${a}\\right)`,
  supFn: (nome, k, a) => `\\operatorname{${nome}}^{${k}}\\left(${a}\\right)`,
};

/** Texto pt-BR (copiar, passos em texto). `comoDigitado`: mantém a ordem dos termos. */
export const texto = (n: No, comoDigitado = false) => imprimir(n, TEXTO, comoDigitado);
/** HTML com frações empilhadas, expoentes e raiz (classe .m-* no CSS). */
export const html = (n: No, comoDigitado = false) => imprimir(n, HTML, comoDigitado);
/** LaTeX (colar em documentos). */
export const latex = (n: No, comoDigitado = false) => imprimir(n, LATEX, comoDigitado).replace(/\\operatorname\{ln\}/g, "\\ln").replace(/\\operatorname\{log\}/g, "\\log").replace(/\\operatorname\{cos\}/g, "\\cos").replace(/\\operatorname\{sec\}/g, "\\sec");
