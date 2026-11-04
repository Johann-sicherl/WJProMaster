// Árvore lateral ajustável (Peça, Montagem e Desenho): alça na borda direita para arrastar a
// largura (mouse, dedo ou caneta) e botão para recolher/expandir. A largura e o estado ficam
// guardados por ambiente. No celular a árvore continua sendo a gaveta (nada disto aparece).

const MIN = 180;

export function instalarLateralAjustavel(ambiente: "peca" | "montagem" | "desenho") {
  const area = document.querySelector<HTMLElement>(".area");
  const lateral = area?.querySelector<HTMLElement>(".lateral");
  if (!area || !lateral) return;
  const chave = `wjcad:lateral:${ambiente}`;
  let guardado: { largura?: number; recolhida?: boolean } = {};
  try {
    guardado = JSON.parse(localStorage.getItem(chave) ?? "{}");
  } catch {
    guardado = {};
  }
  const salvar = () => {
    try {
      localStorage.setItem(chave, JSON.stringify(guardado));
    } catch {
      /* sem armazenamento: vale só nesta sessão */
    }
  };
  const max = () => Math.max(MIN, Math.round(window.innerWidth * 0.6));
  const aplicar = () => {
    if (guardado.largura) area.style.setProperty("--larg-lateral", `${Math.min(max(), Math.max(MIN, guardado.largura))}px`);
    else area.style.removeProperty("--larg-lateral");
    document.body.classList.toggle("lateral-recolhida", !!guardado.recolhida);
    botao.textContent = guardado.recolhida ? "›" : "‹";
    botao.title = guardado.recolhida ? "Mostrar a árvore" : "Recolher a árvore";
    botao.setAttribute("aria-label", botao.title);
    window.dispatchEvent(new Event("resize")); // o viewport acompanha a nova largura
  };

  const alca = document.createElement("div");
  alca.className = "lateral-alca";
  alca.title = "Arraste para ajustar a largura da árvore (toque duplo: largura padrão)";
  const botao = document.createElement("button");
  botao.className = "lateral-recolher";
  botao.onclick = () => {
    guardado.recolhida = !guardado.recolhida;
    salvar();
    aplicar();
  };
  area.append(alca, botao);

  let inicio: { x: number; w: number } | null = null;
  alca.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    try {
      alca.setPointerCapture(e.pointerId);
    } catch {
      /* sem captura: o arrasto segue pelos eventos da própria alça */
    }
    inicio = { x: e.clientX, w: lateral.getBoundingClientRect().width };
    alca.classList.add("arrastando");
  });
  alca.addEventListener("pointermove", (e) => {
    if (!inicio) return;
    guardado.largura = Math.min(max(), Math.max(MIN, Math.round(inicio.w + e.clientX - inicio.x)));
    area.style.setProperty("--larg-lateral", `${guardado.largura}px`);
    window.dispatchEvent(new Event("resize"));
  });
  const soltar = () => {
    if (!inicio) return;
    inicio = null;
    alca.classList.remove("arrastando");
    salvar();
  };
  alca.addEventListener("pointerup", soltar);
  alca.addEventListener("pointercancel", soltar);
  alca.addEventListener("dblclick", () => {
    delete guardado.largura;
    salvar();
    aplicar();
  });
  aplicar();
}
