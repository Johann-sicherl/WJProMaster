// Botão calculadora nos campos numéricos (pedido do Johann, 15/11/2026): o mesmo teclado-calculadora
// das cotas do esboço (`src/ui/tecladoCota.ts`, normal ↔ científica) abre ao lado do campo, sem subir o
// teclado do sistema no tablet. Vale para todas as faces:
//  - `ligarCalculadora(campo, opções)` liga um campo (o painel de comando do WJCAD usa assim, com o valor
//    e a unidade do recurso);
//  - `instalarCalculadoras()` liga sozinho todo campo numérico que aparecer na página (`type="number"` ou
//    `inputmode="decimal"/"numeric"`), inclusive os criados depois (janelas, painéis). Um campo fica de fora
//    com `data-sem-calculadora` (caixa que já tem a sua, campo de ano/código que não é medida); o passo
//    "− campo +" (contagens pequenas, já com botões de toque) também fica de fora no modo automático.
// O campo continua aceitando o que já aceitava (expressões com "=" e variáveis digitadas): a calculadora só
// põe o número calculado e dispara `input` e `change`, como se tivesse sido digitado.

import { abrirTecladoCota, avaliarTeclado } from "../ui/tecladoCota";

/** Símbolo de calculadora (o mesmo do botão da caixa de cota do esboço). */
export const ICONE_CALCULADORA = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="2"/><rect x="8" y="6" width="8" height="3.5" rx=".6"/><path d="M8.5 13h.01M12 13h.01M15.5 13h.01M8.5 16.5h.01M12 16.5h.01M15.5 16.5h.01" stroke-width="2.4"/></svg>`;

export interface OpcoesCalculadora {
  /** título no alto da calculadora (padrão: o rótulo do campo) */
  titulo?: string;
  /** unidade ao lado do visor (padrão: o `.unidade` vizinho do campo, se houver) */
  unidade?: string;
  /** valor inicial (padrão: o que está no campo; expressão com variáveis → o valor calculado por quem chamou) */
  valor?: () => number;
  /** aplica o valor (padrão: escreve no campo e dispara `input` e `change`) */
  aoAplicar?: (v: number) => void;
  /** onde pôr o botão (padrão: logo depois do campo) */
  depoisDe?: Element;
  /** avisos de abrir (antes de o campo perder o foco) e de fechar a calculadora */
  aoAbrir?: () => void;
  aoFechar?: () => void;
}

const ESTILO = `
.calc-campo{flex:none;display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;min-width:34px;padding:0;margin:0 0 0 4px;border:1px solid #d5dbe1;border-radius:8px;background:#f5f7f9;color:#2f7fd0;cursor:pointer;vertical-align:middle;touch-action:manipulation}
.calc-campo:hover{background:#e3effb}
.calc-campo:disabled{opacity:.4;cursor:default}
.calc-campo svg{pointer-events:none}
.calc-envolve{display:inline-flex;align-items:center;min-width:0;max-width:100%;vertical-align:middle}
.calc-envolve>:first-child{flex:1 1 auto;min-width:0}
body.disp-tablet .calc-campo,body.disp-celular .calc-campo{width:44px;height:44px;min-width:44px}
@media (pointer:coarse){.calc-campo{width:44px;height:44px;min-width:44px}}
body.disp-computador .calc-campo{width:30px;height:30px;min-width:30px}
`;

function estilo() {
  if (document.getElementById("calc-campo-css")) return;
  document.head.append(Object.assign(document.createElement("style"), { id: "calc-campo-css", textContent: ESTILO }));
}

/** Campo numérico que recebe o botão? (number, decimal ou numeric; não oculto nem marcado para ficar de fora). */
export function ehCampoNumerico(el: Element): el is HTMLInputElement {
  if (!(el instanceof HTMLInputElement)) return false;
  if (el.type === "hidden" || el.hidden || el.dataset.semCalculadora !== undefined || el.dataset.calculadora !== undefined) return false;
  const modo = (el.getAttribute("inputmode") ?? "").toLowerCase();
  if (el.type !== "number" && modo !== "decimal" && modo !== "numeric") return false;
  // passo "− campo +" (contagens pequenas com botões próprios): fica como está, o botão não cabe
  return !(el.previousElementSibling instanceof HTMLButtonElement && el.nextElementSibling instanceof HTMLButtonElement);
}

/** Rótulo do campo para o título da calculadora. */
function rotuloDo(inp: HTMLInputElement): string {
  const aria = inp.getAttribute("aria-label");
  if (aria) return aria;
  if (inp.id) {
    const l = document.querySelector(`label[for="${CSS.escape(inp.id)}"]`);
    if (l?.textContent?.trim()) return l.textContent.trim();
  }
  const campo = inp.closest("label, .campo");
  const r = campo?.querySelector(".campo-rotulo, span");
  const t = (r && !r.contains(inp) ? r.textContent : campo?.firstChild?.textContent)?.trim();
  return t || inp.placeholder || inp.title || "Valor";
}

/** Número do campo (vírgula ou ponto; expressão simples); NaN se não der para ler. */
function valorDoCampo(inp: HTMLInputElement): number {
  const t = inp.value.trim().replace(/^=/, "");
  if (!t) return 0;
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) ? n : avaliarTeclado(t);
}

/** Escreve o valor no campo como se tivesse sido digitado (`input` + `change`). */
function escrever(inp: HTMLInputElement, v: number) {
  const r = Math.round(v * 1e6) / 1e6;
  inp.value = String(inp.step && inp.step !== "any" && Number(inp.step) >= 1 && inp.type === "number" ? Math.round(r) : r);
  inp.dispatchEvent(new Event("input", { bubbles: true }));
  inp.dispatchEvent(new Event("change", { bubbles: true }));
}

/** Põe o botão calculadora no campo (uma vez só). Devolve o botão (null se o campo já tinha). */
export function ligarCalculadora(inp: HTMLInputElement, o: OpcoesCalculadora = {}): HTMLButtonElement | null {
  if (inp.dataset.calculadora !== undefined) return null;
  estilo();
  inp.dataset.calculadora = "";
  const b = document.createElement("button");
  b.type = "button";
  b.className = "calc-campo";
  b.title = "Calculadora";
  b.setAttribute("aria-label", "Calculadora");
  b.innerHTML = ICONE_CALCULADORA;
  const abrir = () => {
    if (inp.disabled || inp.readOnly) return;
    o.aoAbrir?.();
    inp.blur(); // o teclado do sistema desce: a calculadora ocupa o lugar dele
    const atual = o.valor ? o.valor() : valorDoCampo(inp);
    const un = o.unidade ?? (inp.parentElement?.querySelector(".unidade")?.textContent?.trim() || "");
    abrirTecladoCota({
      valor: Number.isFinite(atual) ? atual : 0,
      unidade: un,
      titulo: o.titulo ?? rotuloDo(inp),
      ancora: () => (inp.isConnected ? inp.getBoundingClientRect() : null),
      aoAplicar: (v) => (o.aoAplicar ? o.aoAplicar(v) : escrever(inp, v)),
      aoFechar: () => o.aoFechar?.(),
    });
  };
  // abre ao soltar o dedo/caneta: em cima da vista 3D o toque não vira "click" (a vista cancela o gesto);
  // o "click" fica para o teclado e para quando o soltar não chegou aqui. Não tira o foco do campo.
  let apertado = false, ultimoAbrir = 0;
  b.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    apertado = true;
  });
  b.addEventListener("pointerup", (e) => {
    if (!apertado) return;
    apertado = false;
    e.stopPropagation();
    ultimoAbrir = performance.now();
    abrir();
  });
  b.addEventListener("pointercancel", () => (apertado = false));
  b.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (performance.now() - ultimoAbrir < 600) return; // já abriu no pointerup
    abrir();
  });
  if (o.depoisDe) o.depoisDe.after(b);
  else {
    // campo e botão juntos no lugar do campo (célula de grade, linha de formulário): o layout não quebra
    const alvo: HTMLElement = inp;
    const env = document.createElement("span");
    env.className = "calc-envolve";
    const w = alvo.style.width;
    if (w) {
      env.style.width = w;
      alvo.style.width = "";
    }
    alvo.replaceWith(env);
    env.append(alvo, b);
  }
  return b;
}

/** Liga todos os campos numéricos dentro de `raiz` (sem os que já têm botão ou ficam de fora). */
export function ligarCalculadorasEm(raiz: ParentNode) {
  if (raiz instanceof Element && ehCampoNumerico(raiz)) ligarCalculadora(raiz);
  for (const el of raiz.querySelectorAll("input")) if (ehCampoNumerico(el)) ligarCalculadora(el);
}

let observador: MutationObserver | null = null;

/**
 * Liga os campos numéricos da página e os que aparecerem depois (uma vez por página). O trabalho é
 * juntado num quadro só: abrir uma janela com vários campos não faz uma varredura por campo.
 */
export function instalarCalculadoras(raiz: HTMLElement = document.body): void {
  if (observador) return;
  ligarCalculadorasEm(raiz);
  let pendentes: Element[] = [];
  let agendado = false;
  observador = new MutationObserver((muts) => {
    for (const m of muts) for (const n of m.addedNodes) if (n instanceof Element && n.className !== "calc-campo" && n.className !== "calc-envolve" && !n.closest(".tc")) pendentes.push(n);
    if (agendado || !pendentes.length) return;
    agendado = true;
    queueMicrotask(() => {
      agendado = false;
      const lista = pendentes;
      pendentes = [];
      for (const n of lista) if (n.isConnected) ligarCalculadorasEm(n);
    });
  });
  observador.observe(raiz, { childList: true, subtree: true });
}
