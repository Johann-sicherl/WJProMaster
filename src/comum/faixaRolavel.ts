// Faixa de comandos rolável (WJCAD e demais faces): barra de rolagem fina e visível embaixo (só quando a faixa
// não cabe), roda do mouse rola na horizontal, arrastar com o mouse em área sem botão, setas ‹ › nas pontas e
// o comando ativo é trazido para a área visível. Funciona com o conteúdo sendo refeito (innerHTML) a cada render.

import "./faixaRolavel.css";

export function tornarFaixaRolavel(faixa: HTMLElement): void {
  if (faixa.parentElement?.classList.contains("faixa-rol")) return;
  const caixa = document.createElement("div");
  caixa.className = "faixa-rol";
  faixa.replaceWith(caixa);
  caixa.append(faixa);
  const esq = seta("‹", "Rolar para a esquerda");
  const dir = seta("›", "Rolar para a direita");
  esq.classList.add("faixa-seta-esq");
  dir.classList.add("faixa-seta-dir");
  const barra = document.createElement("div");
  barra.className = "faixa-barra";
  barra.hidden = true;
  const dedo = document.createElement("div");
  dedo.className = "faixa-dedo";
  barra.append(dedo);
  caixa.append(esq, dir, barra);

  let ultimo = 0; // posição lembrada entre renders da mesma aba
  let assinatura = "";

  const maximo = () => Math.max(0, faixa.scrollWidth - faixa.clientWidth);
  function atualizar() {
    const max = maximo();
    const cabe = max <= 1;
    barra.hidden = cabe;
    esq.hidden = cabe || faixa.scrollLeft <= 8;
    dir.hidden = cabe || faixa.scrollLeft >= max - 8;
    if (cabe) return;
    const larg = barra.clientWidth;
    const tam = Math.max(40, (faixa.clientWidth / faixa.scrollWidth) * larg);
    dedo.style.width = `${tam}px`;
    dedo.style.transform = `translateX(${(faixa.scrollLeft / max) * (larg - tam)}px)`;
  }
  const rolarPara = (x: number) => { faixa.scrollLeft = Math.max(0, Math.min(maximo(), x)); };

  esq.onclick = () => faixa.scrollBy({ left: -faixa.clientWidth * 0.7, behavior: "smooth" });
  dir.onclick = () => faixa.scrollBy({ left: faixa.clientWidth * 0.7, behavior: "smooth" });

  faixa.addEventListener("scroll", () => { ultimo = faixa.scrollLeft; atualizar(); }, { passive: true });
  // roda do mouse (sem Shift) rola na horizontal
  faixa.addEventListener("wheel", (e) => {
    if (maximo() <= 1 || e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    e.preventDefault();
    const px = e.deltaMode === 1 ? e.deltaY * 40 : e.deltaMode === 2 ? e.deltaY * faixa.clientWidth : e.deltaY;
    rolarPara(faixa.scrollLeft + px);
  }, { passive: false });

  // arrastar com o mouse (botão esquerdo) em área sem botão
  faixa.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "mouse" || e.button !== 0 || maximo() <= 1) return;
    if ((e.target as HTMLElement).closest("button, select, input, a")) return;
    const x0 = e.clientX, s0 = faixa.scrollLeft;
    faixa.setPointerCapture(e.pointerId);
    faixa.classList.add("arrastando");
    const mover = (m: PointerEvent) => rolarPara(s0 - (m.clientX - x0));
    const fim = () => {
      faixa.classList.remove("arrastando");
      faixa.removeEventListener("pointermove", mover);
      faixa.removeEventListener("pointerup", fim);
      faixa.removeEventListener("pointercancel", fim);
    };
    faixa.addEventListener("pointermove", mover);
    faixa.addEventListener("pointerup", fim);
    faixa.addEventListener("pointercancel", fim);
  });

  // barra: arrastar o dedo ou tocar na trilha
  dedo.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    const x0 = e.clientX, s0 = faixa.scrollLeft;
    dedo.setPointerCapture(e.pointerId);
    const mover = (m: PointerEvent) => {
      const livre = barra.clientWidth - dedo.offsetWidth;
      if (livre > 0) rolarPara(s0 + ((m.clientX - x0) / livre) * maximo());
    };
    const fim = () => {
      dedo.removeEventListener("pointermove", mover);
      dedo.removeEventListener("pointerup", fim);
      dedo.removeEventListener("pointercancel", fim);
    };
    dedo.addEventListener("pointermove", mover);
    dedo.addEventListener("pointerup", fim);
    dedo.addEventListener("pointercancel", fim);
  });
  barra.addEventListener("pointerdown", (e) => {
    if (e.target !== barra) return;
    const r = dedo.getBoundingClientRect();
    faixa.scrollBy({ left: (e.clientX < r.left ? -1 : 1) * faixa.clientWidth * 0.8, behavior: "smooth" });
  });

  // conteúdo refeito: mantém a posição na mesma aba e traz o comando ativo para a área visível
  const aoRefazer = () => {
    const nova = Array.from(faixa.querySelectorAll("button")).slice(0, 4).map((b) => b.textContent).join("|");
    faixa.scrollLeft = nova === assinatura ? ultimo : 0;
    assinatura = nova;
    const ativo = faixa.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (ativo && maximo() > 1) {
      const fa = faixa.getBoundingClientRect(), a = ativo.getBoundingClientRect();
      if (a.left < fa.left) rolarPara(faixa.scrollLeft - (fa.left - a.left) - 8);
      else if (a.right > fa.right) rolarPara(faixa.scrollLeft + (a.right - fa.right) + 8);
    }
    atualizar();
  };
  new MutationObserver(aoRefazer).observe(faixa, { childList: true });
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(atualizar).observe(faixa);
  window.addEventListener("resize", atualizar);
  aoRefazer();
}

function seta(txt: string, titulo: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = "faixa-seta";
  b.type = "button";
  b.textContent = txt;
  b.title = titulo;
  b.setAttribute("aria-label", titulo);
  b.hidden = true;
  return b;
}
