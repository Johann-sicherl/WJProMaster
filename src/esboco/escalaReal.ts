// Escala real 1:1 no esboço: com a tela calibrada (pixels CSS por milímetro físico, guardado por
// aparelho), a vista do esboço fica travada em 1 mm do modelo = 1 mm da tela. Um traço de 50 mm
// medido com a régua sobre o tablet vira uma linha de 50 mm no esboço; splines saem em 1:1.
// O navegador não informa o tamanho físico da tela (o "pixel CSS" muda de aparelho para aparelho),
// por isso a calibração com uma régua, feita uma vez.

const CHAVE = "jlscad:pxPorMm";
/** Valor nominal do CSS (96 px por polegada): ponto de partida da calibração. */
export const PX_POR_MM_NOMINAL = 96 / 25.4;
const MIN = 1, MAX = 30;

/** Pixels CSS por mm físico da tela deste aparelho (null = ainda não calibrado). */
export function lerPxPorMm(): number | null {
  try {
    const v = Number(localStorage.getItem(CHAVE));
    return v >= MIN && v <= MAX ? v : null;
  } catch {
    return null;
  }
}

function gravarPxPorMm(v: number) {
  try {
    localStorage.setItem(CHAVE, String(v));
  } catch {
    /* sem armazenamento: vale só nesta sessão */
  }
}

/** Régua em SVG de `mm` milímetros na escala dada (traço a cada mm, maior a cada 5 e 10). */
function regua(pxPorMm: number, mm: number): string {
  const w = mm * pxPorMm;
  const tracos: string[] = [];
  for (let k = 0; k <= mm; k++) {
    const x = (k * pxPorMm).toFixed(2);
    const h = k % 10 === 0 ? 26 : k % 5 === 0 ? 18 : 11;
    tracos.push(`<line x1="${x}" y1="0" x2="${x}" y2="${h}"/>`);
    if (k % 10 === 0) tracos.push(`<text x="${x}" y="40" text-anchor="${k === 0 ? "start" : k === mm ? "end" : "middle"}">${k}</text>`);
  }
  return `<svg class="er-regua" width="${w.toFixed(2)}" height="46" viewBox="0 0 ${w.toFixed(2)} 46" aria-label="Régua de ${mm} mm na tela">
    <rect x="0" y="0" width="${w.toFixed(2)}" height="4" fill="#2f7fd0"/><g stroke="#1e2730" stroke-width="1">${tracos.join("")}</g></svg>`;
}

const num = (v: number, c = 1) => v.toFixed(c).replace(".", ",");
const lerNum = (el: HTMLInputElement | null) => parseFloat((el?.value ?? "").replace(",", "."));

/** Tamanho da tela inteira em pixels CSS, na orientação atual (horizontal × vertical). */
function telaEmPx(): { w: number; h: number } {
  // em tela cheia a página ocupa a tela toda; senão, o tamanho da tela informado pelo navegador
  if (document.fullscreenElement) return { w: window.innerWidth, h: window.innerHeight };
  let w = screen.width, h = screen.height;
  const deitada = window.innerWidth > window.innerHeight;
  if (deitada !== w > h) [w, h] = [h, w];
  return { w, h };
}

/**
 * Pixels CSS por mm a partir das medidas físicas da área acesa da tela. Com os dois lados, confere a
 * proporção (medida com a moldura, ou trocada, não passa). Diagonal em polegadas também vale.
 */
export function pxPorMmDasMedidas(tela: { w: number; h: number }, m: { a?: number; b?: number; diag?: number }): { px: number } | { erro: string } {
  const a = m.a && m.a > 0 ? m.a : 0, b = m.b && m.b > 0 ? m.b : 0, d = m.diag && m.diag > 0 ? m.diag : 0;
  if (a && b) {
    const pa = tela.w / a, pb = tela.h / b;
    const desvio = Math.abs(pa / pb - 1);
    if (desvio > 0.015) {
      const esperado = (b * tela.w) / tela.h;
      return { erro: `As medidas não batem com a proporção da tela (desvio de ${num(desvio * 100)}%): com B = ${num(b)} mm, o lado A deveria ter ≈ ${num(esperado)} mm. Confira se mediu só a área acesa (sem a moldura) e se A é o lado horizontal.` };
    }
    return { px: (tela.w + tela.h) / (a + b) };
  }
  if (a) return { px: tela.w / a };
  if (b) return { px: tela.h / b };
  if (d) return { px: Math.hypot(tela.w, tela.h) / (d * 25.4) };
  return { erro: "Informe o lado A, o lado B (em mm) ou a diagonal (em polegadas)." };
}

/**
 * Calibração pelas medidas da tela: página branca em tela cheia com as bordas da área acesa
 * marcadas e as setas dos lados A (horizontal) e B (vertical). Tocar e segurar (caneta ou dedo) ou
 * "Informar medidas" abre o pop-up; o campo escolhido acende a borda correspondente.
 */
function medirPelaTela(): Promise<number | null> {
  return new Promise((fim) => {
    const el = document.createElement("div");
    el.className = "er-tela";
    el.innerHTML = `
      <div class="er-borda er-h er-cima"></div><div class="er-borda er-h er-baixo"></div>
      <div class="er-borda er-v er-esq"></div><div class="er-borda er-v er-dir"></div>
      <div class="er-seta er-seta-a"><span>Lado A (horizontal) ↔</span></div>
      <div class="er-seta er-seta-b"><span>Lado B (vertical) ↕</span></div>
      <div class="er-dica" data-dica>As bordas coloridas são as da <b>área acesa</b> da tela.<br>Toque e segure (caneta ou dedo) para informar as medidas.
        <div><button data-a="abrir" class="destaque">Informar medidas</button><button data-a="x">Cancelar</button></div></div>
      <div class="er-popup" data-pop hidden role="dialog" aria-label="Medidas da tela">
        <b>Medidas da área acesa da tela (sem a moldura)</b>
        <label data-campo="a"><span>Lado A — horizontal ↔</span><input type="number" inputmode="decimal" step="0.1" min="1" data-m="a" placeholder="mm" /> mm</label>
        <label data-campo="b"><span>Lado B — vertical ↕</span><input type="number" inputmode="decimal" step="0.1" min="1" data-m="b" placeholder="mm" /> mm</label>
        <label data-campo="d"><span>ou Diagonal (ficha técnica)</span><input type="number" inputmode="decimal" step="0.01" min="1" data-m="diag" placeholder="pol" /> pol</label>
        <p data-msg>Os dois lados dão o resultado mais preciso (o app confere a proporção).</p>
        <div><button data-a="x">Cancelar</button><button data-a="ok" class="destaque">Usar estas medidas</button></div>
      </div>`;
    const $ = <T extends HTMLElement>(s: string) => el.querySelector(s) as T;
    const pop = $<HTMLElement>("[data-pop]");
    const sair = (v: number | null) => {
      clearTimeout(segurar);
      document.removeEventListener("keydown", tecla, true);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
      el.remove();
      fim(v);
    };
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") (e.preventDefault(), e.stopPropagation(), sair(null));
      else if (e.key === "Enter" && !pop.hidden) (e.preventDefault(), confirmar());
    };
    const abrirPop = () => {
      pop.hidden = false;
      $<HTMLElement>("[data-dica]").hidden = true;
      $<HTMLInputElement>('[data-m="a"]').focus();
    };
    const confirmar = () => {
      const r = pxPorMmDasMedidas(telaEmPx(), { a: lerNum($('[data-m="a"]')), b: lerNum($('[data-m="b"]')), diag: lerNum($('[data-m="diag"]')) });
      const msg = $<HTMLElement>("[data-msg]");
      if ("erro" in r) {
        msg.textContent = r.erro;
        msg.classList.add("er-erro");
        return;
      }
      if (r.px < MIN || r.px > MAX) {
        msg.textContent = "Valor fora do esperado: confira as unidades (lados em mm, diagonal em polegadas).";
        msg.classList.add("er-erro");
        return;
      }
      sair(r.px);
    };
    // o campo em foco acende a borda do lado medido
    el.querySelectorAll<HTMLInputElement>("[data-m]").forEach((i) => {
      i.onfocus = () => (el.dataset.lado = i.dataset.m);
      i.onblur = () => delete el.dataset.lado;
    });
    // tocar e segurar abre o pop-up
    let segurar = 0;
    el.addEventListener("pointerdown", (e) => {
      if (!pop.hidden || (e.target as HTMLElement).closest("button")) return;
      segurar = window.setTimeout(abrirPop, 550);
    });
    for (const t of ["pointerup", "pointercancel", "pointerleave"]) el.addEventListener(t, () => clearTimeout(segurar));
    el.addEventListener("contextmenu", (e) => e.preventDefault());
    el.querySelectorAll<HTMLButtonElement>("[data-a]").forEach((b) => (b.onclick = () => (b.dataset.a === "ok" ? confirmar() : b.dataset.a === "abrir" ? abrirPop() : sair(null))));
    document.addEventListener("keydown", tecla, true);
    document.body.appendChild(el);
    // tela cheia: as bordas da página passam a ser as da tela (se o navegador deixar)
    void el.requestFullscreen?.().catch(() => {});
  });
}

/**
 * Janela de calibração: uma régua de 100 mm desenhada na tela; com uma régua de verdade encostada,
 * ajusta-se (− / + de 0,1 mm, barra, ou digitando quanto ela mediu) até as duas baterem.
 * Devolve o valor salvo (pixels CSS por mm) ou null se cancelou.
 */
export function abrirCalibracao(): Promise<number | null> {
  let px = lerPxPorMm() ?? PX_POR_MM_NOMINAL;
  // cabe na tela: régua de 100 mm, ou de 50 mm em telas estreitas
  const mmRegua = () => (100 * px <= window.innerWidth - 64 ? 100 : 50);
  return new Promise((fim) => {
    const fundo = document.createElement("div");
    fundo.className = "er-fundo";
    fundo.innerHTML = `<div class="er-janela" role="dialog" aria-modal="true" aria-label="Calibrar escala da tela">
      <header><b>Calibrar escala da tela</b><button data-a="x" title="Cancelar" aria-label="Cancelar">✕</button></header>
      <div class="er-opcao"><div><b>Pelas medidas da tela</b> (recomendado): a tela fica branca com as bordas marcadas e você informa o tamanho da área acesa (lados em mm ou diagonal).</div>
        <button data-a="tela" class="destaque">Medidas da tela…</button></div>
      <p data-ok class="er-ok" hidden></p>
      <p><b>Ou com uma régua</b> (também serve para conferir): encoste a régua na barra azul, com o zero no começo dela, e ajuste até a marca final bater com
      <b data-mm></b>. Feito uma vez por aparelho; vale para a <b>Escala real 1:1</b> do esboço.</p>
      <div class="er-area" data-area></div>
      <div class="er-ajuste">
        <button data-a="menos" title="Encolher 0,1 mm" aria-label="Encolher 0,1 mm">−</button>
        <input type="range" data-barra min="${MIN}" max="${MAX}" step="any" aria-label="Ajuste fino da escala" />
        <button data-a="mais" title="Esticar 0,1 mm" aria-label="Esticar 0,1 mm">+</button>
      </div>
      <label class="er-medida">Ou digite quanto a barra mediu na régua:
        <span><input type="number" data-medido step="0.1" min="1" inputmode="decimal" aria-label="Medida na régua em mm" /> mm <button data-a="corrigir">Corrigir</button></span></label>
      <p class="er-valor" data-valor></p>
      <footer><button data-a="nominal">Valor padrão</button><span></span><button data-a="x">Cancelar</button><button data-a="ok" class="destaque">Salvar calibração</button></footer>
    </div>`;
    const $ = <T extends HTMLElement>(s: string) => fundo.querySelector(s) as T;
    const barra = $<HTMLInputElement>("[data-barra]");
    const desenhar = () => {
      px = Math.min(MAX, Math.max(MIN, px));
      const mm = mmRegua();
      $<HTMLElement>("[data-area]").innerHTML = regua(px, mm);
      $<HTMLElement>("[data-mm]").textContent = `${mm} mm`;
      barra.value = String(px);
      $<HTMLElement>("[data-valor]").textContent = `${px.toFixed(3).replace(".", ",")} pixels por mm (${(px * 25.4).toFixed(1).replace(".", ",")} por polegada)`;
    };
    const fechar = (v: number | null) => {
      document.removeEventListener("keydown", tecla, true);
      fundo.remove();
      fim(v);
    };
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") (e.preventDefault(), e.stopPropagation(), fechar(null));
    };
    // ±0,1 mm no comprimento da régua mostrada
    const passo = (s: number) => {
      const mm = mmRegua();
      px = (px * mm + s * 0.1 * px) / mm;
      desenhar();
    };
    const acoes: Record<string, () => void> = {
      x: () => fechar(null),
      menos: () => passo(-1),
      mais: () => passo(1),
      nominal: () => ((px = PX_POR_MM_NOMINAL), desenhar()),
      tela: async () => {
        fundo.hidden = true;
        const v = await medirPelaTela();
        fundo.hidden = false;
        if (v === null) return;
        px = v;
        desenhar();
        const ok = $<HTMLElement>("[data-ok]");
        ok.hidden = false;
        ok.textContent = `Calculado pelas medidas da tela: ${num(px, 3)} pixels por mm. Se quiser, confira com a régua abaixo; depois toque em Salvar calibração.`;
      },
      corrigir: () => {
        const medido = parseFloat($<HTMLInputElement>("[data-medido]").value.replace(",", "."));
        if (!(medido > 0)) return;
        // a barra tem mm·px pixels e mediu `medido` mm de verdade
        px = (mmRegua() * px) / medido;
        $<HTMLInputElement>("[data-medido]").value = "";
        desenhar();
      },
      ok: () => {
        gravarPxPorMm(px);
        fechar(px);
      },
    };
    fundo.querySelectorAll<HTMLButtonElement>("[data-a]").forEach((b) => (b.onclick = () => acoes[b.dataset.a!]?.()));
    barra.oninput = () => ((px = Number(barra.value)), desenhar());
    $<HTMLInputElement>("[data-medido]").onkeydown = (e) => {
      if (e.key === "Enter") acoes.corrigir();
    };
    fundo.addEventListener("pointerdown", (e) => e.target === fundo && fechar(null));
    document.addEventListener("keydown", tecla, true);
    document.body.appendChild(fundo);
    desenhar();
  });
}
