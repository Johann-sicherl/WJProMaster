// WJCalcEng — cálculo diferencial e integral (motor puro, testado em scripts/teste-calceng.ts):
// derivada simbólica (soma, produto, quociente, cadeia, potência, funções) e integral simbólica
// (tabela, linearidade, substituição, por partes/LIATE, frações parciais com denominador de grau ≤ 2,
// identidades trigonométricas), sempre com a REGRA de cada passo. Toda primitiva é conferida
// derivando (numericamente, em vários pontos): se não bater, não é mostrada.
// Também as calculadoras de derivada, integral indefinida/definida e o editor de equações.

import {
  avaliar, chave, contem, div, E, expandir, fn, html, iguais, latex, ler, lerEquacao, mult, MENOS_UM, MEIO, neg, pot, Q, raiz, simplificar, soma, sub, texto, trocar,
  trocarSub, UM, v, variaveis, ZERO, ehZero, ehUm, type No, type NomeFn,
} from "./expressao";
import { fmt, grafico, nf, type DefCalculadora, type Passo, type Resultado, type Valores } from "./calculadoras";

// ---------------------------------------------------------------------------------------------
// derivada

export interface PassoCalc {
  regra: string;
  /** Expressão de partida (derivada: f; integral: integrando). */
  de: No;
  /** Resultado (derivada ou primitiva). */
  para: No;
  /** Linhas de apoio (u = …, du = …), em texto e HTML. */
  extra?: { texto: string; html: string }[];
}

const ehVar = (n: No, x: string) => n.t === "v" && n.n === x;

const REGRA_FN: Record<NomeFn, string> = {
  sen: "(sen u)′ = cos u · u′", cos: "(cos u)′ = −sen u · u′", tg: "(tg u)′ = sec² u · u′", cotg: "(cotg u)′ = −cossec² u · u′",
  sec: "(sec u)′ = sec u · tg u · u′", cossec: "(cossec u)′ = −cossec u · cotg u · u′", arcsen: "(arcsen u)′ = u′/√(1 − u²)",
  arccos: "(arccos u)′ = −u′/√(1 − u²)", arctg: "(arctg u)′ = u′/(1 + u²)", ln: "(ln u)′ = u′/u", log: "(log u)′ = u′/(u·ln 10)",
  abs: "(|u|)′ = u·u′/|u|", senh: "(senh u)′ = cosh u · u′", cosh: "(cosh u)′ = senh u · u′", tgh: "(tgh u)′ = u′/cosh² u", pm: "",
};

/** Derivada de g(u) em relação a u (sem a regra da cadeia). */
function derivadaExterna(n: NomeFn, u: No): No {
  switch (n) {
    case "sen": return fn("cos", u);
    case "cos": return neg(fn("sen", u));
    case "tg": return pot(fn("sec", u), Q(2));
    case "cotg": return neg(pot(fn("cossec", u), Q(2)));
    case "sec": return mult(fn("sec", u), fn("tg", u));
    case "cossec": return neg(mult(fn("cossec", u), fn("cotg", u)));
    case "arcsen": return pot(sub(UM, pot(u, Q(2))), Q(-1, 2));
    case "arccos": return neg(pot(sub(UM, pot(u, Q(2))), Q(-1, 2)));
    case "arctg": return pot(soma(UM, pot(u, Q(2))), MENOS_UM);
    case "ln": return pot(u, MENOS_UM);
    case "log": return pot(mult(u, fn("ln", Q(10))), MENOS_UM);
    case "abs": return div(u, fn("abs", u));
    case "senh": return fn("cosh", u);
    case "cosh": return fn("senh", u);
    case "tgh": return pot(fn("cosh", u), Q(-2));
    case "pm": throw new Error('O "±" só vale no Editor de equações.');
  }
}

/** Derivada em relação a x; `passos` recebe a regra usada em cada parte não trivial. */
export function derivar(f: No, x: string, passos?: PassoCalc[]): No {
  const reg = (regra: string, de: No, para: No) => {
    if (passos && passos.length < 40) passos.push({ regra, de, para });
    return para;
  };
  const d = (f: No): No => {
    if (!contem(f, x)) return ZERO;
    switch (f.t) {
      case "v": return UM;
      case "+": return reg("Regra da soma: a derivada da soma é a soma das derivadas", f, soma(...f.a.map(d)));
      case "*": {
        const cs = f.a.filter((a) => !contem(a, x)), vs = f.a.filter((a) => contem(a, x));
        if (cs.length) {
          const c = mult(...cs), resto = mult(...vs);
          return reg("Constante multiplicando: (k·f)′ = k·f′", f, mult(c, d(resto)));
        }
        const den = vs.filter((a) => a.t === "^" && a.e.t === "n" && a.e.p < 0);
        if (den.length && den.length < vs.length) {
          const N = mult(...vs.filter((a) => !den.includes(a)));
          const D = mult(...den.map((a) => (a.t === "^" ? pot(a.b, neg(a.e)) : a)));
          const r = div(sub(mult(d(N), D), mult(N, d(D))), pot(D, Q(2)));
          return reg("Regra do quociente: (u/v)′ = (u′·v − u·v′)/v²", f, r);
        }
        const termos = vs.map((fi, i) => mult(d(fi), ...vs.filter((_, j) => j !== i)));
        return reg("Regra do produto: (u·v)′ = u′·v + u·v′", f, soma(...termos));
      }
      case "^": {
        const bx = contem(f.b, x), ex = contem(f.e, x);
        if (bx && !ex) {
          const r = mult(f.e, pot(f.b, sub(f.e, UM)), d(f.b));
          const raizQ = f.e.t === "n" && f.e.p === 1 && f.e.q === 2;
          const regra = ehVar(f.b, x)
            ? raizQ ? "Raiz: (√x)′ = 1/(2√x)" : "Regra da potência: (xⁿ)′ = n·xⁿ⁻¹"
            : raizQ ? "Raiz com regra da cadeia: (√u)′ = u′/(2√u)" : "Potência com regra da cadeia: (uⁿ)′ = n·uⁿ⁻¹·u′";
          return reg(regra, f, r);
        }
        if (!bx && ex) {
          if (f.b.t === "c" && f.b.n === "e") return reg(ehVar(f.e, x) ? "Exponencial: (eˣ)′ = eˣ" : "Exponencial com regra da cadeia: (eᵘ)′ = eᵘ·u′", f, mult(f, d(f.e)));
          return reg("Exponencial de base a: (aᵘ)′ = aᵘ·ln a·u′", f, mult(f, fn("ln", f.b), d(f.e)));
        }
        const r = mult(f, soma(mult(d(f.e), fn("ln", f.b)), mult(f.e, d(f.b), pot(f.b, MENOS_UM))));
        return reg("Derivação logarítmica: (uᵛ)′ = uᵛ·(v′·ln u + v·u′/u)", f, r);
      }
      case "f": {
        const u = f.a;
        // ln|u| = u′/u (o módulo não muda a derivada)
        if (f.n === "ln" && u.t === "f" && u.n === "abs") return reg("(ln|u|)′ = u′/u", f, div(d(u.a), u.a));
        const r = mult(derivadaExterna(f.n, u), d(u));
        return reg(ehVar(u, x) ? REGRA_FN[f.n].replace(/ · u′|u′\/|·u′/g, (m) => (m === "u′/" ? "1/" : "")).replace(/\bu\b/g, "x") : `${REGRA_FN[f.n]} (regra da cadeia)`, f, r);
      }
      default:
        return ZERO;
    }
  };
  return simplificar(d(f), x);
}

// ---------------------------------------------------------------------------------------------
// integral

/** u = a·x + b (a e b sem x, a ≠ 0)? */
function linear(u: No, x: string): { a: No; b: No } | null {
  if (ehVar(u, x)) return { a: UM, b: ZERO };
  const e = expandir(u);
  const termos = e.t === "+" ? e.a : [e];
  const as: No[] = [], bs: No[] = [];
  for (const t of termos) {
    if (!contem(t, x)) bs.push(t);
    else if (ehVar(t, x)) as.push(UM);
    else if (t.t === "*" && t.a.filter((f) => contem(f, x)).length === 1 && t.a.some((f) => ehVar(f, x))) as.push(mult(...t.a.filter((f) => !ehVar(f, x))));
    else return null;
  }
  if (!as.length) return null;
  const a = soma(...as);
  return ehZero(a) ? null : { a, b: soma(...bs) };
}

/** Coeficientes do polinômio em x (índice = grau), ou null. */
function polinomio(f: No, x: string): No[] | null {
  const e = expandir(f);
  const termos = e.t === "+" ? e.a : [e];
  const c: No[] = [];
  for (const t of termos) {
    const fs = t.t === "*" ? t.a : [t];
    let k = 0;
    const coef: No[] = [];
    for (const g of fs) {
      if (!contem(g, x)) coef.push(g);
      else if (ehVar(g, x)) k += 1;
      else if (g.t === "^" && ehVar(g.b, x) && g.e.t === "n" && g.e.q === 1 && g.e.p > 0 && Number.isInteger(g.e.p)) k += g.e.p;
      else return null;
    }
    c[k] = soma(c[k] ?? ZERO, mult(...coef));
  }
  for (let i = 0; i < c.length; i++) c[i] ??= ZERO;
  while (c.length > 1 && ehZero(c[c.length - 1])) c.pop();
  return c;
}
const dePolinomio = (c: No[], x: string) => soma(...c.map((a, k) => mult(a, pot(v(x), Q(k)))));
const numerico = (n: No) => n.t === "n";

/** Divisão de polinômios (coeficientes numéricos): quociente e resto. */
function dividir(N: No[], D: No[]): { q: No[]; r: No[] } {
  const r = N.slice();
  const q: No[] = Array(Math.max(1, N.length - D.length + 1)).fill(ZERO);
  for (let k = N.length - D.length; k >= 0; k--) {
    const c = div(r[k + D.length - 1], D[D.length - 1]);
    q[k] = c;
    for (let j = 0; j < D.length; j++) r[k + j] = sub(r[k + j], mult(c, D[j]));
  }
  const resto = r.slice(0, D.length - 1);
  while (resto.length > 1 && ehZero(resto[resto.length - 1])) resto.pop();
  return { q, r: resto.length ? resto : [ZERO] };
}

const linhaExtra = (t: string, h: string) => ({ texto: t, html: h });

class Integrador {
  passos: PassoCalc[] = [];
  constructor(public x: string) {}
  private X() {
    return v(this.x);
  }
  private reg(regra: string, de: No, para: No, extra?: PassoCalc["extra"]) {
    if (this.passos.length < 60) this.passos.push({ regra, de, para, extra });
    return para;
  }

  integrar(f: No, prof = 0): No | null {
    if (prof > 5) return null;
    const x = this.x, X = this.X();
    f = simplificar(f, x);
    if (!contem(f, x)) return this.reg("Integral de uma constante: ∫k dx = k·x", f, mult(f, X));
    if (f.t === "+") {
      const marca = this.passos.length;
      const partes = f.a.map((t) => this.integrar(t, prof + 1));
      if (partes.every((p) => p)) return this.reg("Linearidade: integra termo a termo (∫(f + g) = ∫f + ∫g)", f, soma(...(partes as No[])));
      this.passos.length = marca;
    }
    if (f.t === "*") {
      const cs = f.a.filter((a) => !contem(a, x));
      if (cs.length) {
        const c = mult(...cs), resto = mult(...f.a.filter((a) => contem(a, x)));
        const G = this.integrar(resto, prof + 1);
        if (G) return this.reg("A constante sai da integral: ∫k·f dx = k·∫f dx", f, mult(c, G));
        return null;
      }
    }
    for (const tentativa of [
      () => this.tabela(f),
      () => this.polinomial(f, prof),
      () => this.racional(f, prof),
      () => this.substituicao(f, prof),
      () => this.trigonometrica(f, prof),
      () => this.porPartes(f, prof),
      () => this.expandida(f, prof),
    ]) {
      const marca = this.passos.length;
      const r = tentativa();
      if (r) return r;
      this.passos.length = marca;
    }
    return null;
  }

  /** Integrais imediatas (argumento linear a·x + b: divide por a). */
  private tabela(f: No): No | null {
    const x = this.x;
    const lin = (u: No) => linear(u, x);
    const porA = (r: No, a: No) => div(r, a);
    const nota = (l: { a: No }, u: No) => (ehVar(u, x) ? "" : ehUm(l.a) ? " (argumento linear)" : ` (argumento linear: divide por ${texto(l.a)})`);
    // xⁿ e (ax + b)ⁿ
    const base = f.t === "^" ? f.b : f, e = f.t === "^" ? f.e : UM;
    if (!contem(e, x)) {
      const l = lin(base);
      if (l) {
        if (iguais(e, MENOS_UM)) return this.reg(`∫1/u du = ln|u|${nota(l, base)}`, f, porA(fn("ln", fn("abs", base)), l.a));
        const n1 = soma(e, UM);
        return this.reg(`Regra da potência: ∫xⁿ dx = xⁿ⁺¹/(n + 1)${nota(l, base)}`, f, porA(div(pot(base, n1), n1), l.a));
      }
    }
    // eᵘ e aᵘ
    if (f.t === "^" && !contem(f.b, x)) {
      const l = lin(f.e);
      if (l) {
        if (f.b.t === "c" && f.b.n === "e") return this.reg(`∫eᵘ du = eᵘ${nota(l, f.e)}`, f, porA(f, l.a));
        return this.reg(`∫aᵘ du = aᵘ/ln a${nota(l, f.e)}`, f, porA(div(f, fn("ln", f.b)), l.a));
      }
    }
    // funções de argumento linear
    if (f.t === "f") {
      const u = f.a, l = lin(u);
      if (l) {
        const T: Partial<Record<NomeFn, [string, () => No]>> = {
          sen: ["∫sen u du = −cos u", () => neg(fn("cos", u))],
          cos: ["∫cos u du = sen u", () => fn("sen", u)],
          tg: ["∫tg u du = −ln|cos u|", () => neg(fn("ln", fn("abs", fn("cos", u))))],
          cotg: ["∫cotg u du = ln|sen u|", () => fn("ln", fn("abs", fn("sen", u)))],
          sec: ["∫sec u du = ln|sec u + tg u|", () => fn("ln", fn("abs", soma(fn("sec", u), fn("tg", u))))],
          cossec: ["∫cossec u du = −ln|cossec u + cotg u|", () => neg(fn("ln", fn("abs", soma(fn("cossec", u), fn("cotg", u)))))],
          senh: ["∫senh u du = cosh u", () => fn("cosh", u)],
          cosh: ["∫cosh u du = senh u", () => fn("senh", u)],
          tgh: ["∫tgh u du = ln(cosh u)", () => fn("ln", fn("cosh", u))],
          ln: ["∫ln u du = u·ln u − u (por partes: u = ln u, dv = du)", () => sub(mult(u, fn("ln", u)), u)],
          log: ["∫log u du = (u·ln u − u)/ln 10 (por partes)", () => div(sub(mult(u, fn("ln", u)), u), fn("ln", Q(10)))],
          arctg: ["∫arctg u du = u·arctg u − ½·ln(1 + u²) (por partes)", () => sub(mult(u, fn("arctg", u)), mult(MEIO, fn("ln", soma(UM, pot(u, Q(2))))))],
          arcsen: ["∫arcsen u du = u·arcsen u + √(1 − u²) (por partes)", () => soma(mult(u, fn("arcsen", u)), raiz(sub(UM, pot(u, Q(2)))))],
          arccos: ["∫arccos u du = u·arccos u − √(1 − u²) (por partes)", () => sub(mult(u, fn("arccos", u)), raiz(sub(UM, pot(u, Q(2)))))],
        };
        const t = T[f.n];
        if (t) return this.reg(`${t[0]}${nota(l, u)}`, f, porA(t[1](), l.a));
      }
    }
    // quadrados de funções trigonométricas
    if (f.t === "^" && f.b.t === "f" && iguais(f.e, Q(2))) {
      const u = f.b.a, l = lin(u);
      if (l) {
        const T: Partial<Record<NomeFn, [string, () => No]>> = {
          sec: ["∫sec² u du = tg u", () => fn("tg", u)],
          cossec: ["∫cossec² u du = −cotg u", () => neg(fn("cotg", u))],
          sen: ["sen² u = (1 − cos 2u)/2 ⇒ ∫sen² u du = u/2 − sen(2u)/4", () => sub(div(u, Q(2)), div(fn("sen", mult(Q(2), u)), Q(4)))],
          cos: ["cos² u = (1 + cos 2u)/2 ⇒ ∫cos² u du = u/2 + sen(2u)/4", () => soma(div(u, Q(2)), div(fn("sen", mult(Q(2), u)), Q(4)))],
          tg: ["tg² u = sec² u − 1 ⇒ ∫tg² u du = tg u − u", () => sub(fn("tg", u), u)],
          cotg: ["cotg² u = cossec² u − 1 ⇒ ∫cotg² u du = −cotg u − u", () => neg(soma(fn("cotg", u), u))],
        };
        const t = T[f.b.n];
        if (t) return this.reg(`${t[0]}${nota(l, u)}`, f, porA(t[1](), l.a));
      }
    }
    // sec·tg, cossec·cotg e eᵃˣ·sen/cos(bx) (integral cíclica)
    if (f.t === "*" && f.a.length === 2) {
      const [p, q] = f.a;
      if (p.t === "f" && q.t === "f" && iguais(p.a, q.a)) {
        const u = p.a, l = lin(u);
        const par = [p.n, q.n].sort().join(",");
        if (l && par === "sec,tg") return this.reg(`∫sec u·tg u du = sec u${nota(l, u)}`, f, porA(fn("sec", u), l.a));
        if (l && par === "cossec,cotg") return this.reg(`∫cossec u·cotg u du = −cossec u${nota(l, u)}`, f, porA(neg(fn("cossec", u)), l.a));
      }
      const ex = [p, q].find((g) => g.t === "^" && g.b.t === "c" && g.b.n === "e");
      const tr = [p, q].find((g) => g.t === "f" && (g.n === "sen" || g.n === "cos"));
      if (ex && tr && ex.t === "^" && tr.t === "f") {
        const la = lin(ex.e), lb = lin(tr.a);
        if (la && lb) {
          const a = la.a, b = lb.a, den = soma(pot(a, Q(2)), pot(b, Q(2)));
          const s = fn("sen", tr.a), c = fn("cos", tr.a);
          const r = tr.n === "sen" ? div(mult(ex, sub(mult(a, s), mult(b, c))), den) : div(mult(ex, soma(mult(a, c), mult(b, s))), den);
          return this.reg(`Integral cíclica (por partes duas vezes): ∫eᵃˣ·${tr.n}(bx) dx = eᵃˣ·(${tr.n === "sen" ? "a·sen bx − b·cos bx" : "a·cos bx + b·sen bx"})/(a² + b²)`, f, r);
        }
      }
    }
    // √(k − m·x²) e √(m·x² + k) (substituição trigonométrica)
    if (f.t === "^" && iguais(f.e, MEIO)) {
      const c = polinomio(f.b, x);
      if (c && c.length === 3 && ehZero(c[1]) && numerico(c[0]) && numerico(c[2])) {
        const k = c[0], m = c[2], X = this.X();
        const vm = avaliar(m, {}), vk = avaliar(k, {});
        if (vm < 0 && vk > 0) {
          const sm = raiz(neg(m));
          return this.reg("Substituição trigonométrica (x = a·sen θ): ∫√(a² − u²) du = (u/2)·√(a² − u²) + (a²/2)·arcsen(u/a)", f, soma(mult(MEIO, X, f), mult(div(k, mult(Q(2), sm)), fn("arcsen", div(mult(sm, X), raiz(k))))));
        }
        if (vm > 0) {
          const sm = raiz(m);
          return this.reg("Substituição trigonométrica (x = a·tg θ): ∫√(u² + k) du = (u/2)·√(u² + k) + (k/2)·ln|u + √(u² + k)|", f, soma(mult(MEIO, X, f), mult(div(k, mult(Q(2), sm)), fn("ln", fn("abs", soma(mult(sm, X), raiz(div(f.b, m))))))));
        }
      }
    }
    // 1/√(k − m·x²) e 1/√(m·x² + k)
    if (f.t === "^" && iguais(f.e, Q(-1, 2))) {
      const c = polinomio(f.b, x);
      if (c && c.length === 3 && ehZero(c[1]) && numerico(c[0]) && numerico(c[2])) {
        const k = c[0], m = c[2];
        const vm = avaliar(m, {}), vk = avaliar(k, {});
        const X = this.X();
        if (vm < 0 && vk > 0) {
          const sm = raiz(neg(m)), sk = raiz(k);
          return this.reg("∫1/√(a² − u²) du = arcsen(u/a)", f, div(fn("arcsen", div(mult(sm, X), sk)), sm));
        }
        if (vm > 0) {
          const sm = raiz(m);
          return this.reg("∫1/√(u² + k) du = ln|u + √(u² + k)|", f, div(fn("ln", fn("abs", soma(mult(sm, X), raiz(f.b)))), sm));
        }
      }
    }
    return null;
  }

  /** Polinômio: expande e integra termo a termo. */
  private polinomial(f: No, prof: number): No | null {
    if (f.t !== "*" && f.t !== "^") return null;
    const c = polinomio(f, this.x);
    if (!c) return null;
    const e = dePolinomio(c, this.x);
    if (iguais(e, f)) return null;
    const marca = this.passos.length;
    const G = this.integrar(e, prof + 1);
    if (!G) return null;
    this.passos.splice(marca, 0, { regra: "Expandir o polinômio", de: f, para: e });
    this.passos[marca].extra = [linhaExtra(`${texto(f)} = ${texto(e)}`, `${html(f)} = ${html(e)}`)];
    this.passos.length = Math.min(this.passos.length, 60);
    // o passo "Expandir" mostra a expansão, não a primitiva
    this.passos[marca].para = e;
    return G;
  }

  /** Funções racionais P/Q (coeficientes numéricos) com denominador de grau 1 ou 2. */
  private racional(f: No, prof: number): No | null {
    const x = this.x, X = this.X();
    const fs = f.t === "*" ? f.a : [f];
    const numF: No[] = [], denF: No[] = [];
    for (const g of fs) {
      if (g.t === "^" && g.e.t === "n" && g.e.p < 0 && g.e.q === 1) denF.push(pot(g.b, Q(-g.e.p)));
      else numF.push(g);
    }
    if (!denF.length) return null;
    const N = polinomio(mult(...numF), x), D = polinomio(mult(...denF), x);
    if (!N || !D || !N.every(numerico) || !D.every(numerico) || D.length < 2 || D.length > 3) return null;
    const extra: PassoCalc["extra"] = [];
    let parteQ: No = ZERO;
    let R: No[] = N;
    if (N.length >= D.length) {
      const { q, r } = dividir(N, D);
      parteQ = dePolinomio(q, x);
      R = r;
      extra.push(linhaExtra(`Divisão: ${texto(dePolinomio(N, x))} = (${texto(dePolinomio(D, x))})·(${texto(parteQ)}) + (${texto(dePolinomio(R, x))})`, `Divisão de polinômios: quociente ${html(parteQ)}, resto ${html(dePolinomio(R, x))}`));
    }
    const Dn = dePolinomio(D, x);
    let G: No;
    let regra: string;
    const r1 = R[1] ?? ZERO, r0 = R[0] ?? ZERO;
    if (D.length === 2) {
      // r0/(d1·x + d0)
      G = mult(div(r0, D[1]), fn("ln", fn("abs", Dn)));
      regra = "∫k/(ax + b) dx = (k/a)·ln|ax + b|";
    } else {
      const [d0, d1, d2] = D;
      const delta = sub(pot(d1, Q(2)), mult(Q(4), d2, d0));
      const vd = avaliar(delta, {});
      const Rx = (t: No) => soma(mult(r1, t), r0);
      if (vd > 1e-12) {
        const sd = raiz(delta);
        const a1 = div(soma(neg(d1), neg(sd)), mult(Q(2), d2)), a2 = div(soma(neg(d1), sd), mult(Q(2), d2));
        const A = div(Rx(a1), mult(d2, sub(a1, a2))), B = div(Rx(a2), mult(d2, sub(a2, a1)));
        G = soma(mult(A, fn("ln", fn("abs", sub(X, a1)))), mult(B, fn("ln", fn("abs", sub(X, a2)))));
        regra = "Frações parciais: denominador com duas raízes reais ⇒ A/(x − r₁) + B/(x − r₂)";
        extra.push(linhaExtra(`Raízes do denominador: r₁ = ${texto(a1)}, r₂ = ${texto(a2)}; A = ${texto(A)}, B = ${texto(B)}`, `Raízes do denominador: <i>r</i>₁ = ${html(a1)}, <i>r</i>₂ = ${html(a2)}; <i>A</i> = ${html(A)}, <i>B</i> = ${html(B)}`));
      } else if (vd > -1e-12) {
        const rr = div(neg(d1), mult(Q(2), d2));
        const k = soma(mult(r1, rr), r0);
        G = sub(mult(div(r1, d2), fn("ln", fn("abs", sub(X, rr)))), div(k, mult(d2, sub(X, rr))));
        regra = "Frações parciais: raiz dupla ⇒ A/(x − r) + B/(x − r)²";
        extra.push(linhaExtra(`Raiz dupla r = ${texto(rr)}`, `Raiz dupla <i>r</i> = ${html(rr)}`));
      } else {
        const h = div(d1, mult(Q(2), d2));
        const k = raiz(sub(div(d0, d2), pot(h, Q(2))));
        const xh = soma(X, h);
        const lnArg = avaliar(d2, {}) > 0 ? Dn : neg(Dn);
        G = soma(mult(div(r1, mult(Q(2), d2)), fn("ln", lnArg)), mult(div(sub(r0, mult(r1, h)), mult(d2, k)), fn("arctg", div(xh, k))));
        regra = "Completar quadrado: (x + h)² + k² ⇒ ln e arctg";
        extra.push(linhaExtra(`${texto(Dn)} = ${texto(d2)}·((${texto(xh)})² + ${texto(pot(k, Q(2)))})`, `${html(Dn)} = ${html(d2)}·(${html(pot(xh, Q(2)))} + ${html(pot(k, Q(2)))})`));
      }
    }
    if (!ehZero(parteQ)) {
      const Gq = this.integrar(parteQ, prof + 1);
      if (!Gq) return null;
      G = soma(Gq, G);
    }
    return this.reg(regra, f, G, extra);
  }

  /** Substituição u = g(x): procura u tal que f/u′ só dependa de u. */
  private substituicao(f: No, prof: number): No | null {
    const x = this.x;
    const candidatos = new Map<string, No>();
    const visitar = (n: No) => {
      if (n !== f && contem(n, x) && !ehVar(n, x) && !linear(n, x)) candidatos.set(chave(n), n);
      if (n.t === "+" || n.t === "*") n.a.forEach(visitar);
      else if (n.t === "^") {
        visitar(n.b);
        visitar(n.e);
      } else if (n.t === "f") visitar(n.a);
    };
    visitar(f);
    const lista = [...candidatos.values()].sort((a, b) => chave(b).length - chave(a).length).slice(0, 14);
    const nomeU = variaveis(f).has("u") ? "w" : "u";
    const U = v(nomeU);
    for (const u of lista) {
      const du = derivar(u, x);
      if (ehZero(du)) continue;
      const q = simplificar(div(f, du), x);
      const g = simplificar(trocarSub(q, u, U), nomeU);
      if (contem(g, x) || !contem(g, nomeU) && iguais(g, q)) continue;
      const sub2 = new Integrador(nomeU);
      const G = sub2.integrar(g, prof + 1);
      if (!G) continue;
      const F = trocar(G, nomeU, u);
      return this.reg("Substituição (mudança de variável)", f, F, [
        linhaExtra(`${nomeU} = ${texto(u)}  ⇒  d${nomeU} = ${texto(du)} dx`, `<i>${nomeU}</i> = ${html(u)} ⇒ d<i>${nomeU}</i> = ${html(du)} d<i>x</i>`),
        linhaExtra(`∫ ${texto(g)} d${nomeU} = ${texto(G)}`, `∫ ${html(g)} d<i>${nomeU}</i> = ${html(G)}`),
        linhaExtra(`Volta para x: ${texto(F)}`, `Volta para <i>x</i>: ${html(F)}`),
      ]);
    }
    return null;
  }

  /** senⁿ/cosⁿ ímpares e produtos sen·cos de argumentos diferentes. */
  private trigonometrica(f: No, prof: number): No | null {
    const x = this.x;
    // fatores sen/cos do mesmo argumento linear: senᵐ(u)·cosⁿ(u)
    const fatores = f.t === "*" ? f.a : [f];
    const exp = (g: No) => (g.t === "^" && g.e.t === "n" && g.e.q === 1 && g.e.p > 0 ? g.e.p : g.t === "f" ? 1 : 0);
    const fnDe = (g: No) => (g.t === "^" ? g.b : g);
    if (fatores.length === 2 && fatores.every((g) => { const b = fnDe(g); return b.t === "f" && (b.n === "sen" || b.n === "cos") && exp(g) > 0; })) {
      const [g1, g2] = fatores.map(fnDe) as { t: "f"; n: NomeFn; a: No }[];
      if (g1.n !== g2.n && iguais(g1.a, g2.a) && linear(g1.a, x)) {
        const m = exp(fatores[fatores.findIndex((g) => (fnDe(g) as { n: string }).n === "sen")]);
        const n = exp(fatores[fatores.findIndex((g) => (fnDe(g) as { n: string }).n === "cos")]);
        const u = g1.a, S = fn("sen", u), C = fn("cos", u);
        let reescrita: No | null = null, id = "";
        if (m % 2 === 1 && m >= 3) [reescrita, id] = [mult(S, pot(sub(UM, pot(C, Q(2))), Q((m - 1) / 2)), pot(C, Q(n))), "sen ímpar: separa um sen u e troca sen²u = 1 − cos²u"];
        else if (n % 2 === 1 && n >= 3) [reescrita, id] = [mult(C, pot(sub(UM, pot(S, Q(2))), Q((n - 1) / 2)), pot(S, Q(m))), "cos ímpar: separa um cos u e troca cos²u = 1 − sen²u"];
        if (reescrita) {
          const G = this.integrar(expandir(reescrita), prof + 1);
          if (G) return this.reg(`Potências de seno e cosseno: ${id}`, f, G, [linhaExtra(`${texto(f)} = ${texto(reescrita)}`, `${html(f)} = ${html(reescrita)}`)]);
        }
      }
    }
    // senⁿ e cosⁿ pares ≥ 4: reduz com sen²u = (1 − cos 2u)/2, cos²u = (1 + cos 2u)/2
    if (f.t === "^" && f.b.t === "f" && (f.b.n === "sen" || f.b.n === "cos") && f.e.t === "n" && f.e.q === 1 && f.e.p >= 4 && f.e.p % 2 === 0) {
      const u = f.b.a;
      if (linear(u, x)) {
        const metade = f.b.n === "sen" ? div(sub(UM, fn("cos", mult(Q(2), u))), Q(2)) : div(soma(UM, fn("cos", mult(Q(2), u))), Q(2));
        const reescrita = expandir(pot(metade, Q(f.e.p / 2)));
        const G = this.integrar(reescrita, prof + 1);
        if (G) return this.reg(`Potência par: ${f.b.n}²u = (1 ${f.b.n === "sen" ? "−" : "+"} cos 2u)/2 (reduz o grau)`, f, G, [linhaExtra(`${texto(f)} = ${texto(reescrita)}`, `${html(f)} = ${html(reescrita)}`)]);
      }
    }
    if (f.t === "^" && f.b.t === "f" && (f.b.n === "sen" || f.b.n === "cos") && f.e.t === "n" && f.e.q === 1 && f.e.p >= 3 && f.e.p % 2 === 1) {
      const u = f.b.a, k = (f.e.p - 1) / 2;
      const outra = fn(f.b.n === "sen" ? "cos" : "sen", u);
      const reescrita = mult(f.b, pot(sub(UM, pot(outra, Q(2))), Q(k)));
      const G = this.integrar(reescrita, prof + 1);
      if (!G) return null;
      return this.reg(`Potência ímpar: ${f.b.n}²u = 1 − ${f.b.n === "sen" ? "cos" : "sen"}²u, separa um ${f.b.n} u`, f, G, [linhaExtra(`${texto(f)} = ${texto(reescrita)}`, `${html(f)} = ${html(reescrita)}`)]);
    }
    if (f.t === "*" && f.a.length === 2 && f.a.every((g) => g.t === "f" && (g.n === "sen" || g.n === "cos"))) {
      const [p, q] = f.a as { t: "f"; n: NomeFn; a: No }[];
      if (iguais(p.a, q.a) || !linear(p.a, x) || !linear(q.a, x)) return null;
      const A = p.a, B = q.a;
      let r: No, id: string;
      if (p.n === "sen" && q.n === "sen") [r, id] = [mult(MEIO, sub(fn("cos", sub(A, B)), fn("cos", soma(A, B)))), "sen A·sen B = [cos(A − B) − cos(A + B)]/2"];
      else if (p.n === "cos" && q.n === "cos") [r, id] = [mult(MEIO, soma(fn("cos", sub(A, B)), fn("cos", soma(A, B)))), "cos A·cos B = [cos(A − B) + cos(A + B)]/2"];
      else {
        const [S, C] = p.n === "sen" ? [A, B] : [B, A];
        [r, id] = [mult(MEIO, soma(fn("sen", soma(S, C)), fn("sen", sub(S, C)))), "sen A·cos B = [sen(A + B) + sen(A − B)]/2"];
      }
      const G = this.integrar(r, prof + 1);
      if (!G) return null;
      return this.reg(`Produto em soma: ${id}`, f, G, [linhaExtra(`${texto(f)} = ${texto(r)}`, `${html(f)} = ${html(r)}`)]);
    }
    return null;
  }

  /** Por partes (LIATE): ∫u dv = u·v − ∫v du. */
  private porPartes(f: No, prof: number): No | null {
    if (prof > 3) return null;
    const x = this.x;
    const prioridade = (g: No): number => {
      const b = g.t === "^" ? g.b : g;
      if (b.t === "f" && (b.n === "ln" || b.n === "log")) return 5;
      if (b.t === "f" && b.n.startsWith("arc")) return 4;
      if (polinomio(g, x)) return 3;
      if (b.t === "f") return 2;
      return 1;
    };
    // um fator só (ln²x, arcsen x…): u = f, dv = dx
    if (f.t !== "*" && prioridade(f) < 4) return null;
    const fatores = f.t === "*" ? [...f.a].sort((a, b) => prioridade(b) - prioridade(a)) : [f];
    const u = fatores[0];
    const dv = fatores.length > 1 ? mult(...fatores.slice(1)) : UM;
    if (prioridade(u) < 3 && !(prioridade(u) === 2 && fatores.slice(1).every((g) => prioridade(g) <= 1))) return null;
    const aux = new Integrador(x);
    const V = aux.integrar(dv, prof + 1);
    if (!V) return null;
    const du = derivar(u, x);
    const resto = this.integrar(mult(V, du), prof + 1);
    if (!resto) return null;
    const F = sub(mult(u, V), resto);
    return this.reg("Por partes (LIATE): ∫u dv = u·v − ∫v du", f, F, [
      linhaExtra(`u = ${texto(u)}  ⇒  du = ${texto(du)} dx`, `<i>u</i> = ${html(u)} ⇒ d<i>u</i> = ${html(du)} d<i>x</i>`),
      linhaExtra(`dv = ${texto(dv)} dx  ⇒  v = ${texto(V)}`, `d<i>v</i> = ${html(dv)} d<i>x</i> ⇒ <i>v</i> = ${html(V)}`),
      linhaExtra(`∫u dv = ${texto(mult(u, V))} − ∫${texto(simplificar(mult(V, du), x))} dx`, `∫<i>u</i> d<i>v</i> = ${html(mult(u, V))} − ∫${html(simplificar(mult(V, du), x))} d<i>x</i>`),
    ]);
  }

  /** Última tentativa: expandir produtos/potências e integrar. */
  private expandida(f: No, prof: number): No | null {
    const e = expandir(f);
    if (iguais(e, f) || e.t !== "+") return null;
    const G = this.integrar(e, prof + 1);
    if (!G) return null;
    return this.reg("Expandir e integrar termo a termo", f, G, [linhaExtra(`${texto(f)} = ${texto(e)}`, `${html(f)} = ${html(e)}`)]);
  }
}

/** Confere numericamente se F′ = f em vários pontos (parâmetros com valores quaisquer). */
export function conferir(F: No, f: No, x: string): boolean {
  const dF = derivar(F, x);
  const params = [...variaveis(f), ...variaveis(F)].filter((n) => n !== x);
  const amb: Record<string, number> = {};
  params.forEach((p, i) => (amb[p] = 1.3 + 0.37 * i));
  let bons = 0;
  for (const t of [0.37, 0.71, 1.13, 1.57, 2.31, -0.61, -1.43, 3.7, 0.05, 5.3]) {
    amb[x] = t;
    const a = avaliar(dF, amb), b = avaliar(f, amb);
    if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(b) > 1e8) continue;
    if (Math.abs(a - b) > 1e-6 * Math.max(1, Math.abs(b))) return false;
    bons++;
  }
  return bons >= 3;
}

/** Primitiva com os passos (ou null se as regras não encontram/conferem). */
export function integrar(f: No, x: string): { F: No; passos: PassoCalc[] } | null {
  const it = new Integrador(x);
  const F = it.integrar(simplificar(f, x));
  if (!F) return null;
  const Fs = simplificar(F, x);
  return conferir(Fs, simplificar(f, x), x) ? { F: Fs, passos: it.passos } : null;
}

/** Integral numérica (Simpson adaptativo); NaN se a função não for finita no intervalo. */
export function integralNumerica(g: (t: number) => number, a: number, b: number): number {
  const simpson = (a: number, b: number, fa: number, fm: number, fb: number) => ((b - a) / 6) * (fa + 4 * fm + fb);
  const rec = (a: number, b: number, fa: number, fm: number, fb: number, todo: number, tol: number, prof: number): number => {
    const m = (a + b) / 2, lm = (a + m) / 2, rm = (m + b) / 2;
    const flm = g(lm), frm = g(rm);
    const esq = simpson(a, m, fa, flm, fm), dir = simpson(m, b, fm, frm, fb);
    if (prof > 40 || Math.abs(esq + dir - todo) <= 15 * tol) return esq + dir + (esq + dir - todo) / 15;
    return rec(a, m, fa, flm, fm, esq, tol / 2, prof + 1) + rec(m, b, fm, frm, fb, dir, tol / 2, prof + 1);
  };
  if (a === b) return 0;
  const fa = g(a), fb = g(b), fm = g((a + b) / 2);
  if (![fa, fb, fm].every(Number.isFinite)) return NaN;
  return rec(a, b, fa, fm, fb, simpson(a, b, fa, fm, fb), 1e-11, 0);
}

// ---------------------------------------------------------------------------------------------
// calculadoras

const novo = (): Resultado => ({ destaques: [], passos: [], avisos: [], numeros: {}, textos: {} });
const OPCOES_VAR: [string, string][] = [["x", "x"], ["t", "t"], ["y", "y"], ["u", "u"], ["z", "z"]];
const txtV = (v: Valores, id: string, padrao: string) => (typeof v[id] === "string" ? (v[id] as string) : padrao);

const dx = (x: string) => `d/d${x}`;
const dxHtml = (x: string, ordem = 1) => `<span class="m-fr"><span class="m-num">d${ordem > 1 ? `<sup>${ordem}</sup>` : ""}</span><span class="m-den">d<i>${x}</i>${ordem > 1 ? `<sup>${ordem}</sup>` : ""}</span></span>`;
const linhaPasso = (p: PassoCalc, tipo: "d" | "i", x: string): Passo => {
  const t = tipo === "d" ? `${dx(x)} [${texto(p.de)}] = ${texto(p.para)}` : `∫ ${texto(p.de)} d${x} = ${texto(p.para)}`;
  const h = tipo === "d" ? `${dxHtml(x)} [ ${html(p.de)} ] = ${html(p.para)}` : `∫ ${html(p.de)} d<i>${x}</i> = ${html(p.para)}`;
  const extra = p.extra ?? [];
  // passo "Expandir": a linha principal é a própria expansão
  if (p.regra === "Expandir o polinômio") return { titulo: p.regra, linhas: extra.map((e) => e.texto), html: extra.map((e) => e.html) };
  return { titulo: p.regra, linhas: [...extra.map((e) => e.texto), t], html: [...extra.map((e) => e.html), h] };
};
/** Lê o campo de expressão; erro vira aviso no resultado. */
function lerCampo(r: Resultado, valor: string, rotulo: string): No | null {
  try {
    return ler(valor);
  } catch (e) {
    r.avisos.push(`${rotulo}: ${(e as Error).message}`);
    return null;
  }
}
/** Faixa do gráfico em torno de um ponto de interesse. */
const faixa = (centro: number, meia = 5): [number, number] => [centro - meia, centro + meia];

const derivada: DefCalculadora = {
  id: "derivada",
  forma: "f′(x) = d/dx f(x)",
  campos: [
    { id: "f", rotulo: "f(x) =", tipo: "expressao", padrao: "x^2·sen(x)", dica: "Ex.: x^3 − 2x, sen(2x), e^(x^2), ln(x)/x, √(1 + x²)" },
    { id: "x", rotulo: "Variável", tipo: "opcao", opcoes: OPCOES_VAR, padrao: "x" },
    { id: "ordem", rotulo: "Ordem", tipo: "opcao", opcoes: [["1", "1ª derivada"], ["2", "2ª derivada"], ["3", "3ª derivada"], ["4", "4ª derivada"]], padrao: "1" },
    { id: "x0", rotulo: "Num ponto (opcional)", tipo: "expressao", padrao: "", opcional: true, dica: "Ex.: 1, pi/2: valor da derivada e reta tangente" },
  ],
  resolver(vals) {
    const r = novo();
    const x = txtV(vals, "x", "x");
    const f0 = lerCampo(r, txtV(vals, "f", ""), "f");
    if (!f0) return r;
    const f = simplificar(f0, x);
    const ordem = Math.max(1, Math.min(4, Number(txtV(vals, "ordem", "1")) || 1));
    if (!contem(f, x)) r.avisos.push(`A expressão não tem ${x}: a derivada é zero.`);
    r.passos.push({ titulo: "Função", linhas: [`f(${x}) = ${texto(f)}`], html: [`<i>f</i>(<i>${x}</i>) = ${html(f)}`] });
    let atual = f;
    const derivadas: No[] = [];
    for (let k = 1; k <= ordem; k++) {
      const ps: PassoCalc[] = [];
      atual = derivar(atual, x, k === 1 ? ps : undefined);
      derivadas.push(atual);
      if (k === 1) for (const p of ps.reverse()) r.passos.push(linhaPasso(p, "d", x));
      else r.passos.push({ titulo: `${k}ª derivada (derivando a anterior)`, linhas: [`f${"′".repeat(k)}(${x}) = ${texto(atual)}`], html: [`<i>f</i>${"′".repeat(k)}(<i>${x}</i>) = ${html(atual)}`] });
    }
    const linha = "′".repeat(ordem);
    r.formula = `<i>f</i>${linha}(<i>${x}</i>) = ${html(atual)}`;
    r.destaques.push([`f${linha}(${x})`, texto(atual)]);
    r.textos.derivada = texto(atual);
    r.passos.push({ titulo: "Resultado simplificado", linhas: [`f${linha}(${x}) = ${texto(atual)}`], html: [r.formula] });
    const x0t = txtV(vals, "x0", "").trim();
    const fv = (n: No) => (t: number) => avaliar(n, { [x]: t });
    let centro = 0;
    let tangente: ((t: number) => number) | null = null;
    if (x0t) {
      const p = lerCampo(r, x0t, "Ponto");
      if (p) {
        const a = avaliar(simplificar(p), {});
        const ya = fv(f)(a), da = fv(atual)(a);
        centro = a;
        r.numeros.valorNoPonto = da;
        r.passos.push({ titulo: `No ponto ${x} = ${fmt(a)}`, linhas: [`f(${fmt(a)}) = ${nf(ya)}`, `f${linha}(${fmt(a)}) = ${texto(simplificar(trocar(atual, x, p)))} = ${nf(da)}`] });
        r.destaques.push([`f${linha}(${fmt(a)})`, nf(da)]);
        if (ordem === 1 && Number.isFinite(ya) && Number.isFinite(da)) {
          const b = ya - da * a;
          tangente = (t) => ya + da * (t - a);
          r.passos.push({ titulo: "Reta tangente: y = f(a) + f′(a)·(x − a)", linhas: [`y = ${fmt(ya)} + ${fmt(da)}·(${x} − ${fmt(a)})`, `y = ${fmt(da)}·${x} ${b < 0 ? "−" : "+"} ${fmt(Math.abs(b))}`] });
          r.destaques.push(["Reta tangente", `y = ${fmt(da)}${x} ${b < 0 ? "−" : "+"} ${fmt(Math.abs(b))}`]);
        }
      }
    }
    const [g0, g1] = faixa(centro);
    const curvas = [{ f: fv(atual), cor: "#e07a10", nome: `f${linha}` }];
    if (tangente) curvas.push({ f: tangente, cor: "#2e8b57", nome: "tangente" });
    r.svg = grafico(fv(f), g0, g1, x0t && Number.isFinite(r.numeros.valorNoPonto) ? [{ x: centro, y: fv(f)(centro), rotulo: "a" }] : [], [], { curvas, nome: "f" });
    return r;
  },
};

function primitiva(r: Resultado, f: No, x: string): No | null {
  const res = integrar(f, x);
  if (!res) {
    r.avisos.push("Não encontrei uma primitiva com as regras do curso (tabela, substituição, por partes, frações parciais, identidades). Pode não existir primitiva elementar (ex.: e^(x²), sen(x)/x).");
    return null;
  }
  for (const p of res.passos.slice().reverse()) r.passos.push(linhaPasso(p, "i", x));
  return res.F;
}

const integralIndefinida: DefCalculadora = {
  id: "integralIndefinida",
  forma: "∫ f(x) dx = F(x) + C",
  campos: [
    { id: "f", rotulo: "f(x) =", tipo: "expressao", padrao: "x·e^x", dica: "Ex.: 3x² + 2, x·cos(x), 1/(x² + 1), 2x/(x² + 1), sen³(x)" },
    { id: "x", rotulo: "Variável", tipo: "opcao", opcoes: OPCOES_VAR, padrao: "x" },
  ],
  resolver(vals) {
    const r = novo();
    const x = txtV(vals, "x", "x");
    const f0 = lerCampo(r, txtV(vals, "f", ""), "f");
    if (!f0) return r;
    const f = simplificar(f0, x);
    r.passos.push({ titulo: "Integral", linhas: [`∫ ${texto(f)} d${x}`], html: [`∫ ${html(f)} d<i>${x}</i>`] });
    const F = primitiva(r, f, x);
    if (!F) return r;
    r.formula = `∫ ${html(f)} d<i>${x}</i> = ${html(F)} + <i>C</i>`;
    r.destaques.push(["F(" + x + ")", `${texto(F)} + C`]);
    r.textos.primitiva = texto(F);
    r.passos.push({ titulo: "Conferência: derivando a resposta volta-se ao integrando", linhas: [`${dx(x)} [${texto(F)}] = ${texto(derivar(F, x))}  ✓`], html: [`${dxHtml(x)} [ ${html(F)} ] = ${html(derivar(F, x))} ✓`] });
    r.passos.push({ titulo: "Resultado", linhas: [`∫ ${texto(f)} d${x} = ${texto(F)} + C`], html: [r.formula] });
    const fv = (n: No) => (t: number) => avaliar(n, { [x]: t });
    r.svg = grafico(fv(f), -5, 5, [], [], { curvas: [{ f: fv(F), cor: "#e07a10", nome: "F (C = 0)" }], nome: "f" });
    return r;
  },
};

const integralDefinida: DefCalculadora = {
  id: "integralDefinida",
  forma: "∫ₐᵇ f(x) dx = F(b) − F(a)",
  campos: [
    { id: "f", rotulo: "f(x) =", tipo: "expressao", padrao: "x^2", dica: "Ex.: sen(x), 1/x, x·e^x, √(4 − x²)" },
    { id: "a", rotulo: "De a =", tipo: "expressao", padrao: "0", dica: "Aceita pi, e, ln(2)…" },
    { id: "b", rotulo: "Até b =", tipo: "expressao", padrao: "2" },
    { id: "x", rotulo: "Variável", tipo: "opcao", opcoes: OPCOES_VAR, padrao: "x" },
  ],
  resolver(vals) {
    const r = novo();
    const x = txtV(vals, "x", "x");
    const f0 = lerCampo(r, txtV(vals, "f", ""), "f");
    const a0 = lerCampo(r, txtV(vals, "a", ""), "a"), b0 = lerCampo(r, txtV(vals, "b", ""), "b");
    if (!f0 || !a0 || !b0) return r;
    const f = simplificar(f0, x), A = simplificar(a0), B = simplificar(b0);
    const outras = [...variaveis(f)].filter((n) => n !== x);
    if (contem(A, x) || contem(B, x) || variaveis(A).size || variaveis(B).size || outras.length) {
      r.avisos.push(outras.length ? `A integral definida precisa de números: troque ${outras.join(", ")} por valores.` : "Os limites precisam ser números (aceitam pi, e, ln(2)…).");
      return r;
    }
    const a = avaliar(A, {}), b = avaliar(B, {});
    const g = (t: number) => avaliar(f, { [x]: t });
    r.passos.push({ titulo: "Integral definida", linhas: [`∫ de ${texto(A)} a ${texto(B)} de ${texto(f)} d${x}`], html: [`<span class="m-int">∫<sub>${html(A)}</sub><sup>${html(B)}</sup></span> ${html(f)} d<i>${x}</i>`] });
    // descontinuidade no intervalo (integral imprópria)
    const lo = Math.min(a, b), hi = Math.max(a, b);
    let impropria = false;
    for (let i = 0; i <= 400; i++) {
      const t = lo + ((hi - lo) * i) / 400;
      if (!Number.isFinite(g(t))) {
        impropria = true;
        break;
      }
    }
    if (impropria) r.avisos.push(`f não é contínua em [${fmt(lo)}; ${fmt(hi)}] (integral imprópria): o Teorema Fundamental não vale direto; o resultado pode não existir.`);
    const numerica = integralNumerica(g, a, b);
    r.numeros.numerica = numerica;
    const F = impropria ? null : primitiva(r, f, x);
    let valor = numerica;
    if (F) {
      const Fb = simplificar(trocar(F, x, B)), Fa = simplificar(trocar(F, x, A));
      const exato = simplificar(sub(Fb, Fa));
      const ve = avaliar(exato, {});
      r.passos.push({
        titulo: "Teorema Fundamental do Cálculo: F(b) − F(a)",
        linhas: [`F(${x}) = ${texto(F)}`, `F(${texto(B)}) = ${texto(Fb)}`, `F(${texto(A)}) = ${texto(Fa)}`, `F(b) − F(a) = ${texto(exato)} ≈ ${fmt(ve, 6)}`],
        html: [`<i>F</i>(<i>${x}</i>) = ${html(F)}`, `<i>F</i>(${html(B)}) = ${html(Fb)}`, `<i>F</i>(${html(A)}) = ${html(Fa)}`, `<i>F</i>(<i>b</i>) − <i>F</i>(<i>a</i>) = ${html(exato)} ≈ ${fmt(ve, 6)}`],
      });
      if (Number.isFinite(ve) && Number.isFinite(numerica) && Math.abs(ve - numerica) > 1e-6 * Math.max(1, Math.abs(numerica))) {
        r.avisos.push(`O valor pela primitiva (${fmt(ve, 6)}) não confere com a integração numérica (${fmt(numerica, 6)}): use o valor numérico.`);
      } else {
        valor = ve;
        r.formula = `<span class="m-int">∫<sub>${html(A)}</sub><sup>${html(B)}</sup></span> ${html(f)} d<i>${x}</i> = ${html(exato)}${exato.t === "n" && exato.q === 1 ? "" : ` ≈ ${fmt(ve, 6)}`}`;
        r.destaques.push(["Valor exato", texto(exato)]);
        r.textos.exato = texto(exato);
      }
      r.passos.push({ titulo: "Conferência numérica (Simpson adaptativo)", linhas: [`≈ ${fmt(numerica, 8)}`] });
    } else if (!impropria) {
      r.passos.push({ titulo: "Integração numérica (Simpson adaptativo)", linhas: [`∫ ≈ ${fmt(numerica, 8)}`] });
    }
    if (!r.formula && Number.isFinite(valor)) r.formula = `<span class="m-int">∫<sub>${html(A)}</sub><sup>${html(B)}</sup></span> ${html(f)} d<i>${x}</i> ≈ ${fmt(valor, 6)}`;
    r.destaques.push(["Valor", Number.isFinite(valor) ? fmt(valor, 6) : "não existe (diverge)"]);
    r.numeros.valor = valor;
    // área geométrica (com sinal) e área total
    if (!impropria) {
      const absoluta = integralNumerica((t) => Math.abs(g(t)), lo, hi);
      if (Math.abs(absoluta - Math.abs(valor)) > 1e-6 * Math.max(1, absoluta)) r.passos.push({ titulo: "Atenção ao sinal", linhas: [`A função troca de sinal no intervalo: a integral (${fmt(valor, 6)}) desconta as partes abaixo do eixo; a área total entre a curva e o eixo é ≈ ${fmt(absoluta, 6)}.`] });
      r.numeros.areaTotal = absoluta;
    }
    const meia = Math.max(1, (hi - lo) * 0.4);
    r.svg = grafico(g, lo - meia, hi + meia, [], [], { area: [lo, hi] });
    return r;
  },
};

const editor: DefCalculadora = {
  id: "editor",
  forma: "escreva, veja a fórmula formatada e copie (texto ou LaTeX)",
  campos: [{ id: "eq", rotulo: "Expressão ou equação", tipo: "expressao", padrao: "x = (−b ± √(b² − 4ac))/(2a)", equacao: true, dica: "Use o teclado matemático; \"=\" separa os lados" }],
  resolver(vals) {
    const r = novo();
    const t = txtV(vals, "eq", "");
    let lados: No[];
    try {
      lados = lerEquacao(t);
    } catch (e) {
      r.avisos.push((e as Error).message);
      return r;
    }
    const temMaisMenos = t.includes("±");
    // a fórmula como foi escrita (sem simplificar nem reordenar)
    r.formula = lados.map((n) => html(n, true)).join(" = ");
    r.textos.texto = lados.map((n) => texto(n, true)).join(" = ");
    r.textos.latex = lados.map((n) => latex(n, true)).join(" = ");
    r.destaques.push(["Texto", r.textos.texto], ["LaTeX", r.textos.latex]);
    r.passos.push({ titulo: "Como ficou", html: [r.formula], linhas: [r.textos.texto] });
    if (lados.length === 1 && !temMaisMenos) {
      const s = simplificar(lados[0]);
      if (!iguais(s, lados[0])) r.passos.push({ titulo: "Simplificada", linhas: [texto(s)], html: [html(s)] });
      if (!variaveis(s).size) {
        const val = avaliar(s, {});
        r.passos.push({ titulo: "Valor numérico", linhas: [`= ${nf(val)}`] });
        r.destaques.push(["Valor", nf(val)]);
        r.numeros.valor = val;
      }
    }
    r.passos.push({ titulo: "Dicas de escrita", linhas: ["Potência: x^2 ou x² · Raiz: √x ou raiz(x) · Fração: (a + b)/(c + d)", "Funções: sen, cos, tg, ln, log, e^x, arcsen, arctg, |x| · Constantes: pi (π) e e", "Multiplicação pode ficar implícita: 2x, 3sen(x), x(x + 1)"] });
    return r;
  },
};

export const CALCULO: Record<string, DefCalculadora> = Object.fromEntries([derivada, integralIndefinida, integralDefinida, editor].map((c) => [c.id, c]));
export { E };
