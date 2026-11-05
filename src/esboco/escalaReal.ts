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
      <p>Encoste uma <b>régua</b> na barra azul, com o zero no começo dela, e ajuste até a marca final bater com
      <b data-mm></b> na régua. Feito uma vez por aparelho; vale para a <b>Escala real 1:1</b> do esboço.</p>
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
