// WJSlicer3D: ícones SVG próprios (traço de 1,8 px em 24×24, cor do texto). Desenhados para este app: nada copiado de
// outros programas (regra de inspiração sem cópia, docs/global/regras.md §2).
const svg = (d: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

export const ICONES: Record<string, string> = {
  arquivo: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  salvar: svg('<path d="M5 3h11l3 3v15H5z"/><path d="M8 3v5h7V3"/><rect x="8" y="13" width="8" height="8"/>'),
  desfazer: svg('<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>'),
  refazer: svg('<path d="m15 14 5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>'),
  calibrar: svg('<circle cx="12" cy="13" r="8"/><path d="M12 13V8M9 3h6"/>'),
  menu: svg('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  inicio: svg('<path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/>'),
  preparar: svg('<path d="M12 3 4 7.5v9L12 21l8-4.5v-9z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/>'),
  previa: svg('<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>'),
  bancada: svg('<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 12h2M12 12h2M8 16h2M12 16h2M16 12v4"/>'),
  engrenagem: svg('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>'),
  lapis: svg('<path d="M4 20l1-5L16 4l4 4L9 19z"/><path d="m14 6 4 4"/>'),
  objeto: svg('<path d="M12 3 4 7.5v9L12 21l8-4.5v-9z"/><path d="M12 9v6M9 12h6"/>'),
  organizar: svg('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>'),
  apoio: svg('<path d="M12 3v10"/><path d="m8 9 4 4 4-4"/><path d="M4 20h16"/>'),
  girar: svg('<path d="M20 12a8 8 0 1 1-3-6.2"/><path d="M20 4v5h-5"/>'),
  pintar: svg('<path d="m14 4 6 6-8 8H6v-6z"/><path d="M4 21h8"/>'),
  mover: svg('<path d="M12 3v18M3 12h18"/><path d="m9 6 3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3"/>'),
  escala: svg('<path d="M4 20 20 4"/><path d="M14 4h6v6M10 20H4v-6"/>'),
  cortar: svg('<rect x="5" y="4" width="14" height="16" rx="1"/><path d="M2 12h20" stroke-dasharray="3 2"/>'),
  medir: svg('<rect x="3" y="8" width="18" height="8" rx="1"/><path d="M7 8v3M11 8v4M15 8v3M19 8v4"/>'),
  biblioteca: svg('<path d="M5 4h4v16H5zM10 4h4v16h-4z"/><path d="m15 5 4-1 3 15-4 1z"/>'),
  orcamento: svg('<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>'),
  proposta: svg('<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>'),
  cofre: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="12" cy="12" r="3.5"/><path d="M12 8.5V10M12 14v1.5"/>'),
};

/** Preenche todo `<i class="sl-ic" data-ic="nome">` da página com o SVG correspondente. */
export function pintarIcones(raiz: ParentNode = document) {
  for (const i of raiz.querySelectorAll<HTMLElement>("i.sl-ic[data-ic]")) i.innerHTML = ICONES[i.dataset.ic!] ?? "";
}
