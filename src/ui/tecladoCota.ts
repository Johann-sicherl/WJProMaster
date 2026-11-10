// Teclado de cota do esboço: uma pequena calculadora que abre ao criar ou editar qualquer cota
// (pedido do Johann, 09/11/2026). Modo normal (algarismos e as quatro operações) e científico
// (trigonométricas em graus, como no CAD, raiz, potência, π, log, ln, parênteses), com o resultado ao
// vivo. O visor não é um campo de texto: o teclado do sistema não sobe no tablet. No computador o
// teclado físico também vale (Enter aplica, Esc cancela). O mesmo editor de esboço é usado no WJCAD,
// no WJCalcEng e no WJGoldDiamond: o estilo vem junto com o módulo.

import { avaliarExpressao } from "../equacoes";

/** Expressão como aparece no visor (×, ÷, −, √, π, ^ e vírgula decimal) → valor; NaN se inválida. */
export function avaliarTeclado(texto: string): number {
  let t = texto.trim();
  if (!t) return NaN;
  t = t.replace(/×/g, "*").replace(/÷/g, "/").replace(/−/g, "-").replace(/√/g, "sqrt").replace(/π/g, "pi");
  // multiplicação implícita: 2π, 2(3+1), 3sin(30), (2)(3)
  t = t.replace(/(\d|\)|pi)\s*(?=pi|\(|sqrt|asin|acos|atan|sin|cos|tan|log|ln)/g, "$1*");
  t = t.replace(/\^/g, "**");
  return avaliarExpressao(t, new Map());
}

/** Número para o visor: vírgula decimal, sem zeros sobrando (`casas`: 3 = precisão das cotas). */
export const numeroVisor = (v: number, casas = 6) => String(Number(v.toFixed(casas))).replace(".", ",");

export interface OpcoesTeclado {
  valor: number;
  /** "mm" ou "°" (só o rótulo ao lado do visor) */
  unidade: string;
  titulo: string;
  /** retângulo da cota na tela: o teclado abre ao lado, sem cobrir o número */
  ancora: () => DOMRect | null;
  aoMudar?: (texto: string, valor: number) => void;
  aoAplicar: (valor: number) => void;
  aoFechar: () => void;
}

const CHAVE_CIENTIFICO = "jlscad:tecladoCientifico";
const NORMAL = [
  ["C", "⌫", "(", ")"],
  ["7", "8", "9", "÷"],
  ["4", "5", "6", "×"],
  ["1", "2", "3", "−"],
  ["±", "0", ",", "+"],
];
const CIENTIFICO = [
  ["sin", "cos", "tan", "√"],
  ["asin", "acos", "atan", "x²"],
  ["xʸ", "π", "log", "ln"],
];
const ROTULO: Record<string, string> = { sin: "sen", asin: "sen⁻¹", acos: "cos⁻¹", atan: "tan⁻¹", "⌫": "⌫" };
const OPERADORES = ["+", "−", "×", "÷", "^"];

const CSS = `
.tc{position:fixed;z-index:60;width:292px;padding:8px;background:#fff;border:1px solid #2f7fd0;border-radius:12px;box-shadow:0 6px 24px rgba(30,45,60,.28);font:15px system-ui,sans-serif;color:#1e2730;user-select:none;touch-action:none}
.tc header{display:flex;align-items:center;gap:6px;margin-bottom:6px}
.tc header b{flex:1;font-size:13px;color:#5e6b78;font-weight:600}
.tc header button{min-height:32px;padding:0 10px;border:1px solid #d5dbe1;border-radius:8px;background:#f5f7f9;font:inherit;font-size:13px;cursor:pointer}
.tc .tc-visor{display:flex;flex-direction:column;align-items:flex-end;justify-content:center;min-height:62px;padding:4px 10px;margin-bottom:8px;background:#f5f7f9;border:1px solid #d5dbe1;border-radius:8px;overflow:hidden}
.tc .tc-linha{display:flex;justify-content:flex-end;width:100%;overflow:hidden}
.tc .tc-expr{flex:none;font-size:22px;font-weight:600;white-space:nowrap}
.tc .tc-expr.sel{background:#e3effb;border-radius:4px}
.tc .tc-res{font-size:13px;color:#5e6b78;min-height:17px}
.tc .tc-res.erro{color:#c9372c}
.tc .tc-grade{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}
.tc .tc-grade+.tc-grade{margin-top:6px}
.tc .tc-grade button{min-height:46px;border:1px solid #d5dbe1;border-radius:8px;background:#fff;font:inherit;font-size:18px;cursor:pointer;touch-action:manipulation}
.tc .tc-grade button:active{background:#e3effb}
.tc .tc-grade button.op{background:#f5f7f9;font-weight:600}
.tc .tc-grade button.fn{font-size:14px;background:#f5f7f9;min-height:40px}
.tc .tc-acoes{display:grid;grid-template-columns:1fr 2fr;gap:6px;margin-top:6px}
.tc .tc-acoes button{min-height:48px;border-radius:8px;font:inherit;font-size:20px;cursor:pointer}
.tc .tc-ok{background:#2f7fd0;color:#fff;border:1px solid #2f7fd0;font-weight:700}
.tc .tc-ok:disabled{opacity:.45}
.tc .tc-cancelar{background:#fff;color:#c9372c;border:1px solid #d5dbe1}
body.disp-celular .tc{width:min(292px,calc(100vw - 16px))}
body.disp-computador .tc .tc-grade button{min-height:36px}
body.disp-computador .tc .tc-acoes button{min-height:38px}
`;

let aberto: { fechar(): void } | null = null;

/** Abre o teclado (fecha um que já estivesse aberto). Devolve como fechar e reposicionar. */
export function abrirTecladoCota(o: OpcoesTeclado): { fechar(): void; reposicionar(): void } {
  aberto?.fechar();
  if (!document.getElementById("tc-css")) document.head.append(Object.assign(document.createElement("style"), { id: "tc-css", textContent: CSS }));
  let cientifico = false;
  try {
    cientifico = localStorage.getItem(CHAVE_CIENTIFICO) === "1";
  } catch {
    /* sem preferências */
  }
  let texto = numeroVisor(o.valor, 3);
  let substituir = true; // o valor atual fica "selecionado": o 1º algarismo o troca, um operador continua dele
  const el = document.createElement("div");
  el.className = "tc";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-label", `Valor da cota: ${o.titulo}`);

  const valor = () => avaliarTeclado(texto);
  const desenhar = () => {
    const v = valor();
    const grades = (cientifico ? [CIENTIFICO] : []).concat([NORMAL]);
    el.innerHTML = `
      <header><b>${o.titulo}</b><button data-t="modo" title="Alternar calculadora normal / científica">${cientifico ? "123 Normal" : "fx Científica"}</button></header>
      <div class="tc-visor"><div class="tc-linha"><span class="tc-expr${substituir ? " sel" : ""}">${(texto || "0").replace(/</g, "&lt;")} ${o.unidade}</span></div><span class="tc-res${Number.isFinite(v) || !texto ? "" : " erro"}">${!texto ? "" : Number.isFinite(v) ? (texto === numeroVisor(v) ? "" : `= ${numeroVisor(v)} ${o.unidade}`) : "expressão incompleta"}</span></div>
      ${grades.map((g, gi) => `<div class="tc-grade">${g.flat().map((k) => `<button data-k="${k}" class="${gi === 0 && cientifico ? "fn" : OPERADORES.includes(k) || ["C", "⌫", "(", ")", "±"].includes(k) ? "op" : ""}" aria-label="${ROTULO[k] ?? k}">${ROTULO[k] ?? k}</button>`).join("")}</div>`).join("")}
      <div class="tc-acoes"><button class="tc-cancelar" data-t="cancelar" aria-label="Cancelar">✕</button><button class="tc-ok" data-t="ok" aria-label="Aplicar"${Number.isFinite(v) ? "" : " disabled"}>✓</button></div>`;
    o.aoMudar?.(texto, v);
  };

  const tecla = (k: string) => {
    const ehOp = OPERADORES.includes(k) || k === "x²" || k === "xʸ";
    if (substituir && !ehOp && k !== "⌫" && k !== "±") texto = "";
    substituir = false;
    if (k === "C") texto = "";
    else if (k === "⌫") texto = texto.replace(/(asin\(|acos\(|atan\(|sin\(|cos\(|tan\(|log\(|ln\(|√\(|.)$/u, "");
    else if (k === "±") {
      const m = texto.match(/^(.*?)(−?)([\d,]*)$/u);
      texto = m && m[3] ? `${m[1]}${m[2] ? "" : "−"}${m[3]}` : texto.startsWith("−") ? texto.slice(1) : `−${texto}`;
    } else if (k === "x²") texto += "^2";
    else if (k === "xʸ") texto += "^";
    else if (["sin", "cos", "tan", "asin", "acos", "atan", "log", "ln"].includes(k)) texto += `${k}(`;
    else if (k === "√") texto += "√(";
    else if (k === ",") {
      // uma vírgula por número
      if (!/\d*,\d*$/.test(texto.split(/[+−×÷^()]/).pop() ?? "") || !texto) texto += texto && /\d$/.test(texto) ? "," : "0,";
    } else if (OPERADORES.includes(k)) {
      // trocar o operador do fim em vez de empilhar dois
      texto = /[+×÷^]$/.test(texto) || (/−$/.test(texto) && texto.length > 1) ? texto.slice(0, -1) + k : texto + k;
    } else texto += k;
    desenhar();
  };

  const fechar = () => {
    if (!el.isConnected) return;
    el.remove();
    document.removeEventListener("keydown", teclado, true);
    document.removeEventListener("pointerdown", fora, true);
    window.removeEventListener("resize", reposicionar);
    if (aberto === controle) aberto = null;
    o.aoFechar();
  };
  const aplicar = () => {
    const v = valor();
    if (!Number.isFinite(v)) return;
    fechar();
    o.aoAplicar(v);
  };

  el.addEventListener("pointerdown", (e) => e.stopPropagation());
  el.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest("button");
    if (!b) return;
    if (b.dataset.k) return tecla(b.dataset.k);
    if (b.dataset.t === "ok") return aplicar();
    if (b.dataset.t === "cancelar") return fechar();
    if (b.dataset.t === "modo") {
      cientifico = !cientifico;
      try {
        localStorage.setItem(CHAVE_CIENTIFICO, cientifico ? "1" : "0");
      } catch {
        /* segue sem lembrar */
      }
      desenhar();
      reposicionar();
    }
  });
  // teclado físico (computador, tablet com teclado): não deixa as teclas virarem atalhos do esboço
  const teclado = (e: KeyboardEvent) => {
    const mapa: Record<string, string> = { "*": "×", "/": "÷", "-": "−", ".": ",", Backspace: "⌫", Delete: "C", "^": "xʸ" };
    const k = mapa[e.key] ?? e.key;
    if (e.key === "Enter" || e.key === "=") aplicar();
    else if (e.key === "Escape") fechar();
    else if (/^[\d+()]$/.test(k) || ["×", "÷", "−", ",", "⌫", "C", "xʸ"].includes(k)) tecla(k);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };
  // toque fora: aplica o que estiver no visor (como a caixa de antes); expressão inválida só fecha
  const fora = (e: PointerEvent) => {
    if (el.contains(e.target as Node)) return;
    if (Number.isFinite(valor()) && !substituir) aplicar();
    else fechar();
  };
  const reposicionar = () => {
    const r = o.ancora();
    const w = el.offsetWidth || 292, h = el.offsetHeight || 380;
    const vw = window.innerWidth, vh = window.innerHeight;
    let x: number, y: number;
    if (!r) {
      x = vw - w - 12;
      y = vh - h - 12;
    } else {
      // ao lado da cota (direita, senão esquerda, senão embaixo), sem cobrir o número
      x = r.right + 16 + w <= vw - 8 ? r.right + 16 : r.left - 16 - w >= 8 ? r.left - 16 - w : Math.min(Math.max(8, r.left), vw - w - 8);
      y = x === Math.min(Math.max(8, r.left), vw - w - 8) ? (r.bottom + 12 + h <= vh - 8 ? r.bottom + 12 : Math.max(8, r.top - 12 - h)) : r.top + r.height / 2 - h / 2;
    }
    el.style.left = `${Math.round(Math.min(Math.max(8, x), vw - w - 8))}px`;
    el.style.top = `${Math.round(Math.min(Math.max(8, y), vh - h - 8))}px`;
  };
  const controle = { fechar, reposicionar };
  aberto = controle;
  desenhar();
  document.body.append(el);
  reposicionar();
  document.addEventListener("keydown", teclado, true);
  // o toque que abriu o teclado ainda está terminando: o "fora" só vale a partir do próximo
  setTimeout(() => el.isConnected && document.addEventListener("pointerdown", fora, true), 0);
  window.addEventListener("resize", reposicionar);
  return controle;
}
