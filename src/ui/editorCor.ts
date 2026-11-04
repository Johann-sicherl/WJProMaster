// Editor de aparência (cor) da Peça e da Montagem: painel à esquerda com ✓/✕, "Aplicar em"
// (face / corpo / peça / componente), paleta, cor do sistema, RGB ou HSV com barras e código
// hexadecimal, e "Remover aparência". Mostra a cor no modelo enquanto se escolhe (prévia).

import { corDeHex, hexDeCor } from "../aparencia";

export interface NivelCor {
  id: string;
  rotulo: string;
  /** cor atual neste nível (undefined = sem aparência própria) */
  cor?: number;
}

export interface OpcoesEditorCor {
  titulo?: string;
  niveis: NivelCor[];
  /** nível escolhido ao abrir */
  nivel?: string;
  /** cor mostrada quando o nível não tem a sua (ex.: cor do material) */
  corPadrao: number;
  /** prévia no modelo: cor null = sem aparência própria */
  previa: (nivel: string, cor: number | null) => void;
  confirmar: (nivel: string, cor: number | null) => void;
  cancelar: () => void;
  /** opção extra (ex.: usar as cores do arquivo importado) */
  extra?: { rotulo: string; marcado: boolean; aoMudar: (v: boolean) => void };
}

const PALETA = [
  0xffffff, 0xd0d7df, 0x9aa3ad, 0x5e6b78, 0x2b333b, 0x111111,
  0xc0392b, 0xe74c3c, 0xe67e22, 0xf39c12, 0xf1c40f, 0xd4b106,
  0x27ae60, 0x2ecc71, 0x16a085, 0x1abc9c, 0x2980b9, 0x3498db,
  0x1f4e79, 0x8e44ad, 0x9b59b6, 0xd35400, 0xb4bcc6, 0xd8bf6a,
];

const rgbDe = (c: number) => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
const deRgb = (r: number, g: number, b: number) => (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);

function hsvDe(c: number): [number, number, number] {
  const [r, g, b] = rgbDe(c).map((v) => v / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [Math.round(((h * 60) + 360) % 360), Math.round(mx ? (d / mx) * 100 : 0), Math.round(mx * 100)];
}

function deHsv(h: number, s: number, v: number): number {
  s /= 100;
  v /= 100;
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return deRgb((r + m) * 255, (g + m) * 255, (b + m) * 255);
}

let aberto: HTMLElement | null = null;

/** Fecha o editor aberto (sem confirmar). */
export function fecharEditorCor() {
  aberto?.dispatchEvent(new Event("cancelar"));
}

/** Abre o editor de aparência. */
export function abrirEditorCor(o: OpcoesEditorCor) {
  fecharEditorCor();
  let nivel = o.nivel && o.niveis.some((n) => n.id === o.nivel) ? o.nivel : o.niveis[0].id;
  const atualDo = (id: string) => o.niveis.find((n) => n.id === id)?.cor;
  let cor: number | null = atualDo(nivel) ?? null;
  let modo: "rgb" | "hsv" = "rgb";
  const p = document.createElement("div");
  p.className = "painel-cor";
  p.setAttribute("role", "dialog");
  p.setAttribute("aria-label", o.titulo ?? "Aparência");
  p.innerHTML = `
    <div class="pc-topo"><b>${o.titulo ?? "Aparência"}</b>
      <button class="pc-ok" title="OK (Enter)" aria-label="OK">✓</button><button class="pc-cancelar" title="Cancelar (Esc)" aria-label="Cancelar">✕</button></div>
    <div class="pc-sec">Aplicar em</div><div class="pc-niveis"></div>
    <div class="pc-sec">Cor</div>
    <div class="pc-atual"><span class="pc-amostra"></span><input class="pc-hex" maxlength="7" spellcheck="false" aria-label="Código hexadecimal"/><input type="color" class="pc-sistema" aria-label="Escolher cor"/></div>
    <div class="pc-paleta"></div>
    <div class="pc-modos"><button data-m="rgb">RGB</button><button data-m="hsv">HSV</button></div>
    <div class="pc-barras"></div>
    ${o.extra ? `<label class="pc-extra"><input type="checkbox" ${o.extra.marcado ? "checked" : ""}/> ${o.extra.rotulo}</label>` : ""}
    <button class="pc-remover">Remover aparência</button>`;
  const $ = <T extends HTMLElement>(s: string) => p.querySelector(s) as T;
  const niveis = $("div.pc-niveis");
  for (const n of o.niveis) {
    const b = document.createElement("button");
    b.textContent = n.rotulo;
    b.dataset.n = n.id;
    b.onclick = () => {
      o.previa(nivel, atualDo(nivel) ?? null); // o nível anterior volta como estava
      nivel = n.id;
      cor = atualDo(nivel) ?? null;
      desenhar();
      o.previa(nivel, cor);
    };
    niveis.appendChild(b);
  }
  const paleta = $("div.pc-paleta");
  for (const c of PALETA) {
    const b = document.createElement("button");
    b.style.background = hexDeCor(c);
    b.title = hexDeCor(c);
    b.setAttribute("aria-label", `Cor ${hexDeCor(c)}`);
    b.onclick = () => escolher(c);
    paleta.appendChild(b);
  }
  const barras = $("div.pc-barras");
  const escolher = (c: number | null) => {
    cor = c;
    desenhar();
    o.previa(nivel, cor);
  };
  const desenhar = () => {
    const c = cor ?? o.corPadrao;
    for (const b of niveis.querySelectorAll<HTMLElement>("button")) b.classList.toggle("ativo", b.dataset.n === nivel);
    for (const b of p.querySelectorAll<HTMLElement>(".pc-modos button")) b.classList.toggle("ativo", b.dataset.m === modo);
    $("span.pc-amostra").style.background = hexDeCor(c);
    $("span.pc-amostra").classList.toggle("vazia", cor === null);
    const hex = $<HTMLInputElement>("input.pc-hex");
    if (document.activeElement !== hex) hex.value = cor === null ? "" : hexDeCor(c);
    hex.placeholder = `${hexDeCor(o.corPadrao)} (padrão)`;
    $<HTMLInputElement>("input.pc-sistema").value = hexDeCor(c);
    $<HTMLButtonElement>("button.pc-remover").disabled = cor === null;
    const vals = modo === "rgb" ? rgbDe(c) : hsvDe(c);
    const defs = modo === "rgb" ? [["R", 255], ["G", 255], ["B", 255]] : [["H", 360], ["S", 100], ["V", 100]];
    if (barras.dataset.modo !== modo) {
      barras.dataset.modo = modo;
      barras.innerHTML = defs.map(([n, max], k) => `<label><span>${n}</span><input type="range" min="0" max="${max}" data-k="${k}"/><input type="number" min="0" max="${max}" data-k="${k}"/></label>`).join("");
      for (const inp of barras.querySelectorAll<HTMLInputElement>("input")) inp.oninput = () => {
        const v = [...barras.querySelectorAll<HTMLInputElement>("input[type=range]")].map((x) => +x.value);
        const k = +inp.dataset.k!;
        const max = +inp.max;
        v[k] = Math.max(0, Math.min(max, +inp.value || 0));
        escolher(modo === "rgb" ? deRgb(v[0], v[1], v[2]) : deHsv(v[0] % 360, v[1], v[2]));
      };
    }
    for (const inp of barras.querySelectorAll<HTMLInputElement>("input")) if (document.activeElement !== inp) inp.value = String(vals[+inp.dataset.k!]);
  };
  for (const b of p.querySelectorAll<HTMLElement>(".pc-modos button")) b.onclick = () => { modo = b.dataset.m as "rgb" | "hsv"; desenhar(); };
  $<HTMLInputElement>("input.pc-hex").oninput = (e) => {
    const v = (e.target as HTMLInputElement).value.trim();
    if (/^#?[0-9a-f]{6}$/i.test(v)) escolher(corDeHex(v));
  };
  $<HTMLInputElement>("input.pc-sistema").oninput = (e) => escolher(corDeHex((e.target as HTMLInputElement).value));
  $<HTMLButtonElement>("button.pc-remover").onclick = () => escolher(null);
  if (o.extra) $<HTMLInputElement>(".pc-extra input").onchange = (e) => o.extra!.aoMudar((e.target as HTMLInputElement).checked);
  const fechar = () => {
    document.removeEventListener("keydown", tecla, true);
    p.remove();
    if (aberto === p) aberto = null;
  };
  const ok = () => {
    fechar();
    o.confirmar(nivel, cor);
  };
  const cancelar = () => {
    fechar();
    o.previa(nivel, atualDo(nivel) ?? null);
    o.cancelar();
  };
  const tecla = (e: KeyboardEvent) => {
    if (e.key === "Escape") (e.preventDefault(), e.stopPropagation(), cancelar());
    else if (e.key === "Enter" && !(e.target instanceof HTMLInputElement && e.target.type === "number")) (e.preventDefault(), e.stopPropagation(), ok());
  };
  document.addEventListener("keydown", tecla, true);
  $<HTMLButtonElement>("button.pc-ok").onclick = ok;
  $<HTMLButtonElement>("button.pc-cancelar").onclick = cancelar;
  p.addEventListener("cancelar", cancelar);
  document.body.appendChild(p);
  aberto = p;
  desenhar();
}
