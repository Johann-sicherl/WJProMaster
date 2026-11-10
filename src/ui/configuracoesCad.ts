// Tela de Configurações do WJCAD (⚙ na barra superior da Peça, da Montagem e do Desenho).
// Reúne as opções do aparelho por seções; cada mudança vale na hora e fica guardada neste aparelho
// (`jlscad:interface`, a mesma chave lida pelos três ambientes). Cada ambiente passa um adaptador:
// a Peça grava no objeto de preferências dela; a Montagem e o Desenho, direto no armazenamento.
// Opção nova de uma seção = um item a mais em `itensDaSecao` (ex.: "Relações automáticas" no Esboço).

import { ICONES, type NomeIcone } from "../icones";
import {
  PASSO_ZOOM_MAX, PASSO_ZOOM_MIN, PASSO_ZOOM_PADRAO, passoZoom, type Dispositivo, type PrefsCad,
} from "./preferenciasCad";

export type Ambiente = "peca" | "montagem" | "desenho";
export type IdSecao = "dispositivo" | "mouse" | "esboco" | "exibicao" | "cofre";

export interface AdaptadorConfig {
  ambiente: Ambiente;
  /** Valores atuais (a Peça passa o objeto de preferências dela). */
  ler(): PrefsCad;
  /** Grava e aplica na hora. */
  mudar(m: Partial<PrefsCad>): void;
  /** Caixa flutuante dos comandos ligada agora (só a Peça tem; segue o aparelho se ninguém escolheu). */
  caixaFlutuante?: () => boolean;
  /** Estilo de exibição da vista 3D (Peça e Montagem). */
  estilo?: { atual(): string; mudar(e: string): void };
  /** Liga/desliga a escala real 1:1 do esboço (só a Peça; pode pedir a calibração antes). */
  escalaReal?: (ligar: boolean) => Promise<void>;
  /** Calibrar a escala da tela (uma vez por aparelho). */
  calibrar(): Promise<void>;
  /** Abre a tela "Cópias do cofre". */
  copias(): void;
}

type Item =
  | { tipo: "escolha"; rotulo: string; nota?: string; opcoes: { valor: string; rotulo: string; icone?: NomeIcone; nota?: string }[]; valor: () => string; mudar: (v: string) => void | Promise<void>; cartoes?: boolean }
  | { tipo: "interruptor"; rotulo: string; nota?: string; valor: () => boolean; mudar: (v: boolean) => void | Promise<void> }
  | { tipo: "passo"; rotulo: string; nota?: string; valor: () => number; mudar: (v: number) => void }
  | { tipo: "botao"; rotulo: string; nota?: string; icone?: NomeIcone; fazer: () => void | Promise<void> }
  | { tipo: "nota"; texto: string };

const SECOES: { id: IdSecao; rotulo: string; icone: NomeIcone }[] = [
  { id: "dispositivo", rotulo: "Dispositivo", icone: "tablet" },
  { id: "mouse", rotulo: "Mouse e zoom", icone: "mouse" },
  { id: "esboco", rotulo: "Esboço", icone: "esboco" },
  { id: "exibicao", rotulo: "Exibição", icone: "estiloSombreadoArestas" },
  { id: "cofre", rotulo: "Cofre (WJPDM)", icone: "pasta" },
];

const DISPOSITIVOS: { valor: Dispositivo; rotulo: string; icone: NomeIcone; nota: string }[] = [
  { valor: "celular", rotulo: "Celular", icone: "celular", nota: "Ícones sem texto, árvore e painéis em gaveta, o dedo desenha" },
  { valor: "tablet", rotulo: "Tablet", icone: "tablet", nota: "A caneta desenha e o dedo navega, alvos grandes e lupa" },
  { valor: "computador", rotulo: "Computador", icone: "computador", nota: "Botões compactos, atalhos, botão do meio gira" },
];
const TOQUE_LONGO: [number, string][] = [[0, "Desligado"], [400, "0,4 s"], [600, "0,6 s (padrão)"], [1000, "1 s"], [1500, "1,5 s"], [3000, "3 s"], [5000, "5 s"]];
const ESTILOS: [string, string][] = [["sombreado-arestas", "Sombreado com arestas"], ["sombreado", "Sombreado"], ["arestas", "Só arestas"]];

const dispositivoDe = (p: PrefsCad): Dispositivo =>
  p.dispositivo ?? (matchMedia("(pointer: coarse)").matches ? (Math.min(screen.width, screen.height) < 600 ? "celular" : "tablet") : "computador");

function itensDaSecao(s: IdSecao, a: AdaptadorConfig): Item[] {
  const p = () => a.ler();
  switch (s) {
    case "dispositivo":
      return [
        {
          tipo: "escolha", rotulo: "Perfil do aparelho", cartoes: true,
          nota: "Adapta a interface ao aparelho (vale também para os outros apps do WJProMaster).",
          opcoes: DISPOSITIVOS, valor: () => dispositivoDe(p()), mudar: (v) => a.mudar({ dispositivo: v as Dispositivo }),
        },
        {
          tipo: "escolha", rotulo: "Segurar a caneta/dedo parado abre o menu de contexto",
          opcoes: TOQUE_LONGO.map(([v, r]) => ({ valor: String(v), rotulo: r })),
          valor: () => String(p().toqueLongoMs ?? 600), mudar: (v) => a.mudar({ toqueLongoMs: Number(v) }),
        },
        ...(a.caixaFlutuante
          ? [{ tipo: "interruptor", rotulo: "Comandos com caixa flutuante perto da peça", nota: "Sem escolha, liga no celular e no tablet.",
              valor: a.caixaFlutuante, mudar: (v: boolean) => a.mudar({ caixaFlutuante: v }) } as Item]
          : []),
      ];
    case "mouse":
      return [
        {
          tipo: "escolha", rotulo: "Sentido da roda",
          opcoes: [
            { valor: "aproxima", rotulo: "Rolar para a frente aproxima" },
            { valor: "afasta", rotulo: "Rolar para a frente afasta" },
          ],
          valor: () => (p().rodaFrenteAfasta ? "afasta" : "aproxima"),
          mudar: (v) => a.mudar({ rodaFrenteAfasta: v === "afasta" }),
        },
        {
          tipo: "passo", rotulo: "Passo do zoom por clique da roda",
          nota: `De ${PASSO_ZOOM_MIN} % a ${PASSO_ZOOM_MAX} % (padrão ${PASSO_ZOOM_PADRAO} %). O touchpad aproxima na mesma proporção, em passos menores.`,
          valor: () => passoZoom(p()), mudar: (v) => a.mudar({ passoZoom: v }),
        },
        { tipo: "nota", texto: "Vale na Peça, na Montagem e no Desenho. No esboço em Escala 1:1 o zoom continua travado (tamanho real)." },
      ];
    case "esboco":
      return [
        ...(a.escalaReal
          ? [{ tipo: "interruptor", rotulo: "Escala real 1:1 no esboço", nota: "A vista fica de frente para o plano, em tamanho real (sem zoom nem rotação).",
              valor: () => !!p().escalaReal, mudar: (v: boolean) => a.escalaReal!(v) } as Item]
          : []),
        { tipo: "botao", rotulo: "Calibrar escala da tela…", icone: "regua", nota: "Uma vez por aparelho; usada pela escala real 1:1.", fazer: a.calibrar },
        // próxima opção do esboço: "Relações automáticas" (interruptor) entra aqui
        ...(a.ambiente === "peca" ? [] : [{ tipo: "nota", texto: "Os esboços são feitos na Peça; estas opções valem lá." } as Item]),
      ];
    case "exibicao":
      return a.estilo
        ? [{
            tipo: "escolha", rotulo: "Estilo de exibição da vista 3D",
            opcoes: ESTILOS.map(([v, r]) => ({ valor: v, rotulo: r })),
            valor: a.estilo.atual, mudar: a.estilo.mudar,
          }]
        : [{ tipo: "nota", texto: "A folha do Desenho não tem opções de exibição gerais: o estilo de cada vista fica nas propriedades da vista." }];
    case "cofre":
      return [
        { tipo: "botao", rotulo: "Cópias do cofre…", icone: "pasta", nota: "Pendrive, pasta do dispositivo, Google Drive, sincronizar agora e o aviso de conexões.", fazer: a.copias },
      ];
  }
}

/** Calibrar a escala da tela na Montagem e no Desenho (a calibração só é carregada quando pedida). */
export async function calibrarTelaCad() {
  const { abrirCalibracao } = await import("../esboco/escalaReal");
  await abrirCalibracao();
}

let aberta: HTMLElement | null = null;

/** Abre a tela de Configurações (na seção pedida ou na última vista). */
export function abrirConfiguracoesCad(a: AdaptadorConfig, secao?: IdSecao) {
  aberta?.remove();
  let atual: IdSecao = secao ?? lerUltima() ?? "dispositivo";
  const fundo = document.createElement("div");
  fundo.className = "fundo-dialogo cfg-fundo";
  fundo.innerHTML = `
    <div class="dialogo cfg" role="dialog" aria-modal="true" aria-labelledby="cfg-titulo">
      <header class="cfg-topo"><strong id="cfg-titulo">Configurações do WJCAD</strong>
        <button class="btn-ic cfg-fechar" title="Fechar (Esc)" aria-label="Fechar">✕</button></header>
      <div class="cfg-corpo">
        <nav class="cfg-secoes" role="tablist" aria-label="Seções"></nav>
        <section class="cfg-conteudo" role="tabpanel"></section>
      </div>
      <p class="cfg-rodape">Vale na hora e fica guardado neste aparelho, para a Peça, a Montagem e o Desenho.</p>
    </div>`;
  const nav = fundo.querySelector<HTMLElement>(".cfg-secoes")!;
  const conteudo = fundo.querySelector<HTMLElement>(".cfg-conteudo")!;

  const desenharNav = () => {
    nav.innerHTML = "";
    for (const s of SECOES) {
      const b = document.createElement("button");
      b.role = "tab";
      b.dataset.secao = s.id;
      b.setAttribute("aria-selected", String(s.id === atual));
      b.innerHTML = `${ICONES[s.icone]}<span>${s.rotulo}</span>`;
      b.onclick = () => {
        atual = s.id;
        gravarUltima(atual);
        desenharNav();
        desenhar();
      };
      nav.append(b);
    }
  };

  const desenhar = () => {
    conteudo.innerHTML = `<h3>${SECOES.find((s) => s.id === atual)!.rotulo}</h3>`;
    for (const it of itensDaSecao(atual, a)) conteudo.append(criarItem(it, desenhar));
  };

  const fechar = () => {
    fundo.remove();
    if (aberta === fundo) aberta = null;
    document.removeEventListener("keydown", esc, true);
  };
  const esc = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    // calibração ou Cópias abertas por cima: o Esc é delas
    const topo = [...document.body.children].reverse().find((x) => getComputedStyle(x).position === "fixed" && !(x as HTMLElement).hidden);
    if (topo && topo !== fundo) return;
    e.preventDefault();
    e.stopPropagation();
    fechar();
  };
  // as teclas digitadas aqui não viram atalhos do CAD (S, F, setas…)
  fundo.addEventListener("keydown", (e) => e.stopPropagation());
  fundo.addEventListener("pointerdown", (e) => e.target === fundo && fechar());
  fundo.querySelector<HTMLButtonElement>(".cfg-fechar")!.onclick = fechar;
  document.addEventListener("keydown", esc, true);
  desenharNav();
  desenhar();
  document.body.append(fundo);
  aberta = fundo;
  nav.querySelector<HTMLElement>('[aria-selected="true"]')?.focus({ preventScroll: true });
}

function criarItem(it: Item, redesenhar: () => void): HTMLElement {
  const bloco = document.createElement("div");
  bloco.className = "cfg-item";
  const nota = (t?: string) => (t ? `<small class="cfg-nota">${t}</small>` : "");
  switch (it.tipo) {
    case "nota":
      bloco.innerHTML = `<p class="cfg-nota">${it.texto}</p>`;
      return bloco;
    case "interruptor": {
      bloco.innerHTML = `<label class="interruptor"><input type="checkbox"${it.valor() ? " checked" : ""}><span>${it.rotulo}</span></label>${nota(it.nota)}`;
      const ck = bloco.querySelector("input")!;
      ck.onchange = async () => {
        await it.mudar(ck.checked);
        redesenhar(); // a ação pode ter sido recusada (ex.: calibração cancelada)
      };
      return bloco;
    }
    case "botao": {
      bloco.innerHTML = `<button class="cfg-botao">${it.icone ? ICONES[it.icone] : ""}<span>${it.rotulo}</span></button>${nota(it.nota)}`;
      bloco.querySelector("button")!.onclick = () => void it.fazer();
      return bloco;
    }
    case "escolha": {
      bloco.innerHTML = `<span class="cfg-rotulo">${it.rotulo}</span><div class="cfg-opcoes${it.cartoes ? " cfg-cartoes" : ""}" role="radiogroup" aria-label="${it.rotulo}"></div>${nota(it.nota)}`;
      const grupo = bloco.querySelector<HTMLElement>(".cfg-opcoes")!;
      const v = it.valor();
      for (const o of it.opcoes) {
        const b = document.createElement("button");
        b.role = "radio";
        b.dataset.valor = o.valor;
        b.setAttribute("aria-checked", String(o.valor === v));
        b.innerHTML = `${o.icone ? ICONES[o.icone] : ""}<strong>${o.rotulo}</strong>${o.nota && it.cartoes ? `<small>${o.nota}</small>` : ""}`;
        b.onclick = async () => {
          await it.mudar(o.valor);
          redesenhar();
        };
        grupo.append(b);
      }
      return bloco;
    }
    case "passo": {
      const id = `cfg-passo-${Math.random().toString(36).slice(2, 8)}`;
      bloco.innerHTML = `<label class="cfg-rotulo" for="${id}">${it.rotulo}</label>
        <div class="cfg-passo">
          <button class="cfg-menos" aria-label="Diminuir">−</button>
          <input id="${id}" type="range" min="${PASSO_ZOOM_MIN}" max="${PASSO_ZOOM_MAX}" step="1" value="${it.valor()}">
          <button class="cfg-mais" aria-label="Aumentar">+</button>
          <output class="cfg-valor">${it.valor()} %</output>
          <button class="cfg-padrao">Padrão</button>
        </div>${nota(it.nota)}`;
      const r = bloco.querySelector<HTMLInputElement>("input")!;
      const saida = bloco.querySelector("output")!;
      const definir = (n: number) => {
        n = Math.min(PASSO_ZOOM_MAX, Math.max(PASSO_ZOOM_MIN, Math.round(n)));
        r.value = String(n);
        saida.textContent = `${n} %`;
        it.mudar(n);
      };
      r.oninput = () => definir(Number(r.value));
      bloco.querySelector<HTMLButtonElement>(".cfg-menos")!.onclick = () => definir(Number(r.value) - 1);
      bloco.querySelector<HTMLButtonElement>(".cfg-mais")!.onclick = () => definir(Number(r.value) + 1);
      bloco.querySelector<HTMLButtonElement>(".cfg-padrao")!.onclick = () => definir(PASSO_ZOOM_PADRAO);
      return bloco;
    }
  }
}

const CHAVE_ULTIMA = "jlscad:configuracoesSecao";
function lerUltima(): IdSecao | null {
  try {
    const s = localStorage.getItem(CHAVE_ULTIMA) as IdSecao | null;
    return s && SECOES.some((x) => x.id === s) ? s : null;
  } catch {
    return null;
  }
}
function gravarUltima(s: IdSecao) {
  try {
    localStorage.setItem(CHAVE_ULTIMA, s);
  } catch {
    /* armazenamento indisponível */
  }
}
