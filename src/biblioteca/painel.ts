// Painel "Biblioteca de componentes" da Montagem (WJCAD): busca + árvore por tipo/norma, escolha de
// tamanho, passo, comprimento (lista do padrão ou valor) e rosca, e o encaixe por toque ou arraste no furo.
// Só interface: as regras estão em dados.ts / gerar.ts / encaixe.ts (testadas em Node).

import { buscar, arvore } from "./busca";
import { LISTA_COMPRIMENTOS, familiaPorId, type Familia } from "./dados";
import { comprimentosDoPadrao, nomePadrao, passoGrosso, passosFinos, suportaRoscaReal } from "./gerar";

export interface EstadoBib {
  /** texto da busca */
  busca: string;
  /** grupos abertos na árvore */
  abertos: string[];
  familia?: string;
  tam?: string;
  /** comprimento fixo (mm); "auto" = o sugerido pela espessura do furo */
  comprimento: number | "auto";
  /** valor digitado fora da lista */
  outro?: number;
  passo?: number;
  roscaReal: boolean;
  /** furo passante com porca do outro lado (muda o comprimento sugerido) */
  comPorca: boolean;
  /** entrar pelo lado oposto ao que olha para a câmera */
  oposto: boolean;
  /** aba aberta: fixação (padrão) ou engrenagens */
  aba?: "fixacao" | "engrenagens";
}

export const estadoInicialBib = (): EstadoBib => ({ busca: "", abertos: ["Parafusos"], comprimento: "auto", roscaReal: false, comPorca: true, oposto: false });

export interface ContextoBib {
  /** cabeçalho do painel de comando (título + ✓ ✕) e caixas, os mesmos do resto da Montagem */
  painelBase(titulo: string): HTMLElement;
  caixa(p: HTMLElement, titulo: string): HTMLElement;
  /** o item mudou (redesenhar) */
  aoMudar(): void;
  /** soltou/tocou o item num ponto da tela (arraste ou botão "Inserir solto") */
  aoSoltar(x: number, y: number): void;
  /** inserir sem furo (fica solto ao lado do modelo) */
  aoInserirSolto(): void;
  /** texto sobre o último furo tocado (espessura, compatibilidade) */
  infoDoFuro(): string;
  /** comprimento sugerido (da espessura do último furo) ou undefined */
  sugerido(): number | undefined;
  /** onde fica o modelo (área onde soltar o arraste vale) */
  areaDoModelo(): DOMRect;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, classe?: string, texto?: string) => {
  const e = document.createElement(tag);
  if (classe) e.className = classe;
  if (texto !== undefined) e.textContent = texto;
  return e;
};

/** Item completo escolhido no painel (pronto para gerar), ou o que falta. */
export function itemEscolhido(s: EstadoBib, sugerido?: number): { familia: Familia; tam: string; comprimento?: number; passo?: number } | string {
  const f = s.familia ? familiaPorId(s.familia) : undefined;
  if (!f) return "Escolha um item na árvore.";
  const tam = s.tam ?? f.tamanhos[0].tam;
  if (!f.tamanhos.some((t) => t.tam === tam)) return "Escolha o tamanho.";
  let comprimento: number | undefined;
  if (f.comprimento) {
    const lista = comprimentosDoPadrao(f, tam, LISTA_COMPRIMENTOS);
    comprimento = s.comprimento === "auto" ? sugerido ?? lista[Math.floor(lista.length / 3)] : s.comprimento;
    if (comprimento === undefined) return "Escolha o comprimento.";
  }
  return { familia: f, tam, comprimento, ...(f.roscado && s.passo && s.passo !== passoGrosso(tam) ? { passo: s.passo } : {}) };
}

const num = (v: number) => String(Math.round(v * 100) / 100).replace(".", ",");

export function renderizarPainelBiblioteca(ctx: ContextoBib, s: EstadoBib) {
  const p = ctx.painelBase("Biblioteca de componentes");

  // ---- busca + árvore ----
  const cb = ctx.caixa(p, "Fixação: buscar e escolher");
  const busca = el("input", "campo-busca") as HTMLInputElement;
  busca.type = "search";
  busca.placeholder = "Buscar: allen, ISO 4032, arruela…";
  busca.setAttribute("aria-label", "Buscar na biblioteca de componentes");
  busca.value = s.busca;
  busca.oninput = () => {
    s.busca = busca.value;
    desenharLista();
  };
  const lista = el("div", "bib-arvore");
  cb.append(busca, lista);
  const botaoFamilia = (f: Familia) => {
    const b = el("button", "pc-arquivo bib-familia");
    b.setAttribute("aria-pressed", String(s.familia === f.id));
    b.innerHTML = `<span><strong></strong><small></small></span>`;
    b.querySelector("strong")!.textContent = `${f.tipo} · ${f.norma}`;
    b.querySelector("small")!.textContent = `${f.grupo}${f.conferencia === "aproximada" ? " · ≈ forma/cotas aproximadas" : ""}`;
    b.onclick = () => {
      s.familia = f.id;
      s.tam = f.tamanhos.some((t) => t.tam === s.tam) ? s.tam : f.tamanhos.find((t) => t.tam === "M8")?.tam ?? f.tamanhos[Math.min(3, f.tamanhos.length - 1)].tam;
      s.passo = undefined;
      s.comprimento = "auto";
      ctx.aoMudar();
    };
    return b;
  };
  function desenharLista() {
    lista.innerHTML = "";
    const q = s.busca.trim();
    if (q) {
      const achadas = buscar(q);
      if (!achadas.length) lista.append(el("p", "dica", "Nada encontrado."));
      for (const f of achadas) lista.append(botaoFamilia(f));
      return;
    }
    for (const g of arvore()) {
      const aberto = s.abertos.includes(g.grupo);
      const cab = el("button", "bib-grupo");
      cab.setAttribute("aria-expanded", String(aberto));
      cab.textContent = `${aberto ? "▾" : "▸"} ${g.grupo} (${g.familias.length})`;
      cab.onclick = () => {
        s.abertos = aberto ? s.abertos.filter((x) => x !== g.grupo) : [...s.abertos, g.grupo];
        desenharLista();
      };
      lista.append(cab);
      if (aberto) for (const f of g.familias) lista.append(botaoFamilia(f));
    }
  }
  desenharLista();

  const f = s.familia ? familiaPorId(s.familia) : undefined;
  if (!f) {
    cb.append(el("p", "dica", "Escolha o tipo na árvore; depois o tamanho e o comprimento. A peça é criada sozinha e guardada no cofre (CAD › Biblioteca)."));
    return;
  }

  // ---- tamanho, passo, comprimento, rosca ----
  const ci = ctx.caixa(p, `${f.nome} ${f.norma}`);
  const tam = s.tam ?? f.tamanhos[0].tam;
  const campo = (rot: string, controle: HTMLElement) => {
    const l = el("label", "campo");
    l.append(el("span", "campo-rotulo", rot), controle);
    ci.append(l);
  };
  const selTam = el("select");
  for (const t of f.tamanhos) selTam.add(new Option(t.tam, t.tam));
  selTam.value = tam;
  selTam.onchange = () => {
    s.tam = selTam.value;
    s.passo = undefined;
    s.comprimento = "auto";
    ctx.aoMudar();
  };
  campo("Tamanho", selTam);

  if (f.roscado) {
    const finos = passosFinos(tam);
    const selPasso = el("select");
    selPasso.add(new Option(`Grosso (${num(passoGrosso(tam))})`, String(passoGrosso(tam))));
    for (const x of finos) selPasso.add(new Option(`Fino (${num(x)})`, String(x)));
    selPasso.value = String(s.passo ?? passoGrosso(tam));
    selPasso.onchange = () => {
      s.passo = Number(selPasso.value);
      ctx.aoMudar();
    };
    campo("Passo da rosca", selPasso);
  }

  if (f.comprimento) {
    const padrao = comprimentosDoPadrao(f, tam, LISTA_COMPRIMENTOS);
    const sug = ctx.sugerido();
    const selC = el("select");
    selC.add(new Option(sug !== undefined ? `Sugerido pela espessura (${num(sug)})` : "Sugerido pela espessura do furo", "auto"));
    for (const l of padrao) selC.add(new Option(`${num(l)} mm`, String(l)));
    selC.add(new Option("Outro valor…", "outro"));
    const noPadrao = typeof s.comprimento === "number" && padrao.includes(s.comprimento);
    selC.value = s.comprimento === "auto" ? "auto" : noPadrao ? String(s.comprimento) : "outro";
    campo("Comprimento", selC);
    const t0 = f.tamanhos.find((t) => t.tam === tam)!;
    const outro = el("input") as HTMLInputElement;
    outro.type = "number";
    outro.step = "0.5";
    outro.min = String(t0.lmin ?? 1);
    outro.max = String(t0.lmax ?? 500);
    outro.value = String(s.outro ?? (typeof s.comprimento === "number" ? s.comprimento : padrao[0] ?? ""));
    outro.setAttribute("aria-label", "Comprimento em mm");
    const linhaOutro = el("label", "campo");
    linhaOutro.append(el("span", "campo-rotulo", "Valor (mm)"), outro);
    linhaOutro.style.display = selC.value !== "outro" ? "none" : "";
    ci.append(linhaOutro);
    selC.onchange = () => {
      if (selC.value === "auto") s.comprimento = "auto";
      else if (selC.value === "outro") {
        s.comprimento = Number(outro.value) || padrao[0];
        s.outro = s.comprimento as number;
      } else s.comprimento = Number(selC.value);
      ctx.aoMudar();
    };
    outro.onchange = () => {
      const v = Number(outro.value);
      if (v > 0) {
        s.outro = v;
        s.comprimento = v;
      }
      ctx.aoMudar();
    };
    ci.append(el("p", "dica", `Padrão ${f.norma} ${tam}: de ${num(t0.lmin ?? 0)} a ${num(t0.lmax ?? 0)} mm.`));
    if (f.grupo === "Parafusos" && f.forma !== "semCabeca") {
      const l = el("label", "interruptor");
      const c = el("input") as HTMLInputElement;
      c.type = "checkbox";
      c.checked = s.comPorca;
      c.onchange = () => {
        s.comPorca = c.checked;
        ctx.aoMudar();
      };
      l.append(c, el("span", undefined, "Com porca e arruela do outro lado (para o comprimento sugerido)"));
      ci.append(l);
    }
  }

  if (suportaRoscaReal(f)) {
    const l = el("label", "interruptor");
    const c = el("input") as HTMLInputElement;
    c.type = "checkbox";
    c.checked = s.roscaReal;
    c.onchange = () => {
      s.roscaReal = c.checked;
      ctx.aoMudar();
    };
    l.append(c, el("span", undefined, "Rosca real (modelada; mais lenta). Desligado: rosca cosmética"));
    ci.append(l);
  }

  const item = itemEscolhido(s, ctx.sugerido());
  if (typeof item !== "string") {
    const nome = nomePadrao(item.familia, item.tam, item.comprimento, item.passo);
    ci.append(el("p", "bib-nome", nome));
  }

  // ---- encaixar ----
  const ce = ctx.caixa(p, "Encaixar no furo");
  const info = ctx.infoDoFuro();
  if (info) ce.append(el("p", "dica", info));
  const lado = el("label", "interruptor");
  const co = el("input") as HTMLInputElement;
  co.type = "checkbox";
  co.checked = s.oposto;
  co.onchange = () => {
    s.oposto = co.checked;
    ctx.aoMudar();
  };
  lado.append(co, el("span", undefined, "Entrar pelo lado oposto ao que está voltado para a câmera (porca)"));
  ce.append(lado);
  const arrastar = el("button", "bib-arrastar destaque");
  arrastar.type = "button";
  arrastar.innerHTML = `<span aria-hidden="true">⠿</span> Arraste até o furo`;
  arrastar.title = "Arraste este botão para o furo no modelo (ou toque e depois toque no furo)";
  ligarArraste(arrastar, ctx);
  const solto = el("button", undefined, "Inserir solto");
  solto.type = "button";
  solto.onclick = () => ctx.aoInserirSolto();
  const botoes = el("div", "pc-botoes");
  botoes.append(arrastar, solto);
  ce.append(botoes);
  ce.append(el("p", "dica", "Ao soltar sobre a parede de um furo, a peça entra concêntrica e apoiada na face (arruelas empilham sozinhas). Se houver outros furos iguais, o app pergunta se repete em todos."));
}

/** Arrasto do botão até o modelo (dedo, caneta ou mouse); toque simples arma o próximo toque no furo. */
function ligarArraste(b: HTMLElement, ctx: ContextoBib) {
  let id = -1, fantasma: HTMLElement | null = null, x0 = 0, y0 = 0, moveu = false;
  const fim = () => {
    fantasma?.remove();
    fantasma = null;
    id = -1;
  };
  b.onpointerdown = (e) => {
    id = e.pointerId;
    x0 = e.clientX;
    y0 = e.clientY;
    moveu = false;
    b.setPointerCapture(id);
    e.preventDefault();
  };
  b.onpointermove = (e) => {
    if (e.pointerId !== id) return;
    if (!moveu && Math.hypot(e.clientX - x0, e.clientY - y0) > 8) {
      moveu = true;
      fantasma = el("div", "bib-fantasma", "⠿ fixador");
      document.body.append(fantasma);
    }
    if (fantasma) {
      fantasma.style.left = `${e.clientX + 12}px`;
      fantasma.style.top = `${e.clientY - 30}px`;
    }
  };
  b.onpointerup = (e) => {
    if (e.pointerId !== id) return;
    const arrastou = moveu;
    fim();
    if (!arrastou) {
      // toque simples: o próximo toque no modelo encaixa (avisa)
      ctx.aoSoltar(NaN, NaN);
      return;
    }
    const a = ctx.areaDoModelo();
    if (e.clientX >= a.left && e.clientX <= a.right && e.clientY >= a.top && e.clientY <= a.bottom) ctx.aoSoltar(e.clientX, e.clientY);
  };
  b.onpointercancel = fim;
}
