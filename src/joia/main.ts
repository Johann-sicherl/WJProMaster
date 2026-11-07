// WJGoldDiamond: modelagem 3D de joias (especificação: docs/global/wjgolddiamond.md).
// Construtores paramétricos (aro, cabeça, pavé, gravação, textura, fabricação, preço) à
// esquerda, vista 3D no centro, propriedades e resultados à direita. Motor puro: regras.ts;
// sólido: geometria.ts no worker (prévia rápida + joia completa).

import "./joia.css";
import { $, autosave, baixar, Casca, escapar, escolherArquivo, Historico, janela, registrarOffline, salvarArquivo } from "../comum/casca";
import { IC, type NomeIc } from "../comum/icones";
import { carregarFonte } from "../esboco/fontesTexto";
import { gerarContornos, OPCOES_TEXTO_PADRAO } from "../esboco/texto";
import type { ComandoTexto } from "../model";
import {
  agruparLacos, diametroInterno, diametroPorQuilates, docNovo, ficha, LAPIDACOES, LIGAS, MATERIAIS, montar, NORMAS, proporcoes, quilates, tamanhos, validarDoc, verificar,
  type DocJoia, type Gema, type GrupoTexto, type Lapidacao, type Montagem, type P2,
} from "./regras";
import { VistaJoia } from "./vista";
import type { PedidoJoia, RespostaJoia } from "./worker";

const CHAVE = "wjgd:documento";
const fmt = (v: number, c = 2) => v.toLocaleString("pt-BR", { minimumFractionDigits: c, maximumFractionDigits: c });
const real = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

// ---------------------------------------------------------------------------------------------
// documento e histórico

let doc: DocJoia = (() => {
  try {
    const d = autosave.ler<unknown>(CHAVE);
    return d ? validarDoc(d) : docNovo();
  } catch {
    return docNovo();
  }
})();
const historico = new Historico<DocJoia>();
historico.limpar(doc);
let m: Montagem = montar(doc);
let texto: { grupos: GrupoTexto[]; largura: number } = { grupos: [], largura: 0 };
let resultado: { volume: number; area: number; avisos: string[]; ms: number; final: boolean } | null = null;
let erroKernel = "";

type Item = "aro" | "cabeca" | "pave" | "gravacao" | "textura" | "fabricacao" | "preco";
let sel: Item = "aro";

function alterar(muda: () => void, estrutura = false) {
  muda();
  doc = validarDoc(doc);
  historico.registrar(doc);
  autosave.guardar(CHAVE, doc);
  atualizar();
  if (estrutura) arvore();
  painel();
}

function trocarDoc(d: DocJoia) {
  doc = validarDoc(d);
  historico.limpar(doc);
  autosave.guardar(CHAVE, doc);
  casca.renderizar();
  arvore();
  atualizar();
  painel();
  vista.enquadrar(raioJoia());
  vista.vista("iso");
}

function desfazer() {
  const d = historico.desfazer();
  if (d) { doc = d; autosave.guardar(CHAVE, doc); arvore(); atualizar(); painel(); }
}
function refazer() {
  const d = historico.refazer();
  if (d) { doc = d; autosave.guardar(CHAVE, doc); arvore(); atualizar(); painel(); }
}

const raioJoia = () => diametroInterno(doc.aro.norma, doc.aro.tamanho) / 2 + Math.max(doc.aro.espessura, doc.aro.espessuraBase) + (doc.cabeca.ativo ? doc.cabeca.elevacao + proporcoes(doc.cabeca.gema).total : 0);

// ---------------------------------------------------------------------------------------------
// kernel (worker)

const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
let seq = 0;
let ultimaGeracao = 0;
const pedidos = new Map<number, (r: RespostaJoia) => void>();
let kernelPronto = false;
worker.onmessage = (ev: MessageEvent<RespostaJoia>) => {
  const r = ev.data;
  if (r.tipo === "pronto") {
    kernelPronto = true;
    gerar();
    if ("serviceWorker" in navigator && import.meta.env.PROD) void navigator.serviceWorker.ready.then((reg) => reg.active?.postMessage({ tipo: "guardar" })).catch(() => {});
  } else if (r.tipo === "falha-inicial") {
    erroKernel = `O kernel não carregou: ${r.mensagem}`;
    status();
  } else if (r.tipo === "malha") {
    if (r.seq !== ultimaGeracao) return;
    vista.definirMetal(r.pos, r.nor, r.idx, LIGAS[doc.liga].cor);
    resultado = { volume: r.volume, area: r.area, avisos: r.avisos, ms: r.ms, final: r.final };
    erroKernel = "";
    status();
    painelResultados();
  } else if (r.tipo === "erro" && r.seq === ultimaGeracao) {
    erroKernel = r.mensagem;
    status();
    painelResultados();
  }
  if (r.tipo === "arquivo" || r.tipo === "erro") {
    pedidos.get(r.seq)?.(r);
    pedidos.delete(r.seq);
  }
};

let tGerar = 0;
function gerar() {
  clearTimeout(tGerar);
  tGerar = window.setTimeout(async () => {
    if (!kernelPronto) return;
    texto = await textoDaGravacao();
    const comp = document.getElementById("gd-comp");
    if (comp) comp.textContent = fmt(texto.largura, 1);
    ultimaGeracao = ++seq;
    const p: PedidoJoia = { tipo: "gerar", seq: ultimaGeracao, doc, grupos: texto.grupos, larguraTexto: texto.largura };
    worker.postMessage(p);
  }, 120);
}

function exportar(formato: "stl" | "step", fabricar: boolean) {
  if (!resultado?.final) return casca.avisar("Aguarde a joia terminar de ser gerada.");
  const s = ++seq;
  pedidos.set(s, (r) => {
    if (r.tipo === "arquivo") {
      const suf = fabricar ? " (fundição)" : "";
      baixar(r.bytes, `${doc.nome}${suf}`, formato);
      casca.avisar(`${formato.toUpperCase()} exportado${fabricar ? ` com contração de ${fmt(doc.fabricacao.contracao, 1)} % e ${doc.fabricacao.canais} canal(is)` : ""}.`);
    } else if (r.tipo === "erro") casca.avisar(r.mensagem, 6000);
  });
  worker.postMessage({ tipo: "exportar", seq: s, formato, fabricar } satisfies PedidoJoia);
}

// ---------------------------------------------------------------------------------------------
// gravação: letras → contornos (fonte do texto de esboço do WJCAD)

const cacheTexto = new Map<string, { grupos: GrupoTexto[]; largura: number }>();
async function textoDaGravacao(): Promise<{ grupos: GrupoTexto[]; largura: number }> {
  const g = doc.gravacao;
  if (!g.ativo || !g.texto.trim()) return { grupos: [], largura: 0 };
  const k = `${g.texto}|${g.altura}|${g.negrito}`;
  const c = cacheTexto.get(k);
  if (c) return c;
  try {
    const fonte = await carregarFonte(g.negrito, false);
    const cont = gerarContornos(fonte, { ...OPCOES_TEXTO_PADRAO, texto: g.texto, altura: g.altura, negrito: g.negrito, alinhamento: "centro" });
    const r = agruparLacos(cont.flatMap(achatar));
    cacheTexto.set(k, r);
    return r;
  } catch {
    casca.avisar("Não foi possível ler a fonte da gravação.");
    return { grupos: [], largura: 0 };
  }
}

/** Comandos de contorno (retas e Béziers) → laços de pontos. */
function achatar(cs: ComandoTexto[]): P2[][] {
  const lacos: P2[][] = [];
  let atual: P2[] = [];
  let p: P2 = [0, 0];
  for (const c of cs) {
    if (c[0] === "M") {
      if (atual.length > 2) lacos.push(atual);
      p = [c[1], c[2]];
      atual = [p];
    } else if (c[0] === "L") {
      p = [c[1], c[2]];
      atual.push(p);
    } else if (c[0] === "Q") {
      const [, x1, y1, x, y] = c;
      for (let i = 1; i <= 3; i++) {
        const t = i / 3, u = 1 - t;
        atual.push([u * u * p[0] + 2 * u * t * x1 + t * t * x, u * u * p[1] + 2 * u * t * y1 + t * t * y]);
      }
      p = [x, y];
    } else if (c[0] === "C") {
      const [, x1, y1, x2, y2, x, y] = c;
      for (let i = 1; i <= 4; i++) {
        const t = i / 4, u = 1 - t;
        atual.push([u ** 3 * p[0] + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t ** 3 * x, u ** 3 * p[1] + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t ** 3 * y]);
      }
      p = [x, y];
    }
  }
  if (atual.length > 2) lacos.push(atual);
  return lacos.map((l) => {
    const f = l[0], u = l[l.length - 1];
    return simplificar(Math.hypot(f[0] - u[0], f[1] - u[1]) < 1e-6 ? l.slice(0, -1) : l, 0.015);
  });
}

/** Tira pontos quase alinhados (desvio < tol mm): menos faces para cortar no aro. */
function simplificar(l: P2[], tol: number): P2[] {
  const out: P2[] = [];
  for (const p of l) {
    while (out.length >= 2) {
      const [a, b] = [out[out.length - 2], out[out.length - 1]];
      const L = Math.hypot(p[0] - a[0], p[1] - a[1]);
      const dist = L < 1e-9 ? Math.hypot(b[0] - a[0], b[1] - a[1]) : Math.abs((p[0] - a[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (p[1] - a[1])) / L;
      if (dist < tol) out.pop();
      else break;
    }
    out.push(p);
  }
  return out.length >= 3 ? out : l;
}

// ---------------------------------------------------------------------------------------------
// atualização (gemas na hora; metal pelo kernel)

function atualizar() {
  m = montar(doc);
  vista.definirGemas([...(m.cabeca ? [m.cabeca] : []), ...m.pave]);
  vista.corMetal(LIGAS[doc.liga].cor);
  if (resultado) resultado.final = false;
  gerar();
  status();
}

function status() {
  const ct = (m.cabeca?.ct ?? 0) + m.pave.reduce((s, g) => s + g.ct, 0);
  const pedras = (m.cabeca ? 1 : 0) + m.pave.length;
  const est = erroKernel ? `⚠ ${erroKernel}` : !kernelPronto ? "Carregando o kernel…" : resultado?.final ? `Pronto em ${resultado.ms < 1000 ? `${Math.round(resultado.ms)} ms` : `${fmt(resultado.ms / 1000, 1)} s`}` : "Calculando assentos e acabamentos…";
  casca.definirStatus(`Aro ${doc.aro.norma} ${fmt(doc.aro.tamanho, doc.aro.norma === "mm" ? 2 : 1)} · Ø ${fmt(2 * m.R)} mm · ${pedras} pedra(s) · ${fmt(ct, 3)} ct · ${est}`);
  casca.statusDireita.textContent = resultado ? `${fmt((resultado.volume / 1000) * LIGAS[doc.liga].densidade)} g · ${LIGAS[doc.liga].nome}` : "";
}

// ---------------------------------------------------------------------------------------------
// árvore de construtores

const ITENS: { id: Item; rotulo: string; icone: NomeIc; ativo?: () => boolean; alternar?: (v: boolean) => void }[] = [
  { id: "aro", rotulo: "Aro", icone: "anel" },
  { id: "cabeca", rotulo: "Cabeça", icone: "garras", ativo: () => doc.cabeca.ativo, alternar: (v) => (doc.cabeca.ativo = v) },
  { id: "pave", rotulo: "Pavé", icone: "pave", ativo: () => doc.pave.ativo, alternar: (v) => (doc.pave.ativo = v) },
  { id: "gravacao", rotulo: "Gravação", icone: "gravar", ativo: () => doc.gravacao.ativo, alternar: (v) => (doc.gravacao.ativo = v) },
  { id: "textura", rotulo: "Textura", icone: "textura", ativo: () => doc.textura.tipo !== "nenhuma", alternar: (v) => (doc.textura.tipo = v ? "facetas" : "nenhuma") },
  { id: "fabricacao", rotulo: "Fabricação", icone: "fundir" },
  { id: "preco", rotulo: "Preço", icone: "moeda" },
];

function arvore() {
  const a = $("#gd-arvore");
  a.innerHTML = `<h3>Construtores</h3>${ITENS.map((it) => `
    <div class="gd-item" aria-current="${it.id === sel}" data-i="${it.id}">
      <button data-sel="${it.id}">${IC[it.icone]}<span>${it.rotulo}</span></button>
      ${it.alternar ? `<input type="checkbox" data-alt="${it.id}" title="Ligar/desligar" ${it.ativo!() ? "checked" : ""} />` : ""}
    </div>`).join("")}`;
}

function selecionar(i: Item) {
  sel = i;
  arvore();
  painel();
}

// ---------------------------------------------------------------------------------------------
// painel de propriedades

type Campo = { k: string; r: string; u?: string; t?: "num" | "sel" | "chk" | "txt"; ops?: () => [string, string][]; passo?: number; se?: () => boolean; estrutura?: boolean };

const ler = (k: string): unknown => k.split(".").reduce<any>((o, p) => o?.[p], doc);
function gravar(k: string, v: unknown) {
  const ps = k.split(".");
  const o = ps.slice(0, -1).reduce<any>((x, p) => x[p], doc);
  o[ps[ps.length - 1]] = v;
}

const opLap = (): [string, string][] => (Object.keys(LAPIDACOES) as Lapidacao[]).map((k) => [k, LAPIDACOES[k].nome]);
const opMat = (): [string, string][] => Object.entries(MATERIAIS).map(([k, v]) => [k, v.nome]);
const redonda = () => doc.cabeca.gema.lapidacao === "redonda";

const CAMPOS: Record<Item, Campo[]> = {
  aro: [
    { k: "aro.norma", r: "Tabela de tamanho", t: "sel", ops: () => Object.entries(NORMAS) as [string, string][] },
    { k: "aro.tamanho", r: "Tamanho", passo: 0.5 },
    { k: "liga", r: "Liga", t: "sel", ops: () => Object.entries(LIGAS).map(([k, v]) => [k, v.nome]) },
    { k: "aro.perfil", r: "Perfil", t: "sel", ops: () => [["conforto", "Anatômico (conforto)"], ["meia-cana", "Meia-cana"], ["reto", "Reto"], ["faca", "Faca"]] },
    { k: "aro.largura", r: "Largura no topo", u: "mm", passo: 0.1 },
    { k: "aro.espessura", r: "Espessura no topo", u: "mm", passo: 0.1 },
    { k: "aro.larguraBase", r: "Largura na base", u: "mm", passo: 0.1 },
    { k: "aro.espessuraBase", r: "Espessura na base", u: "mm", passo: 0.1 },
    { k: "aro.torcao", r: "Torção (meias-voltas)", passo: 1 },
  ],
  cabeca: [
    { k: "cabeca.tipo", r: "Cravação", t: "sel", ops: () => [["garras", "Garras"], ["inglesa", "Inglesa (aro fechado)"]], estrutura: true },
    { k: "cabeca.gema.lapidacao", r: "Lapidação", t: "sel", ops: opLap, estrutura: true },
    { k: "cabeca.gema.material", r: "Gema", t: "sel", ops: opMat },
    { k: "cabeca.gema.largura", r: "Diâmetro", u: "mm", passo: 0.1, se: redonda },
    { k: "cabeca.gema.comprimento", r: "Comprimento", u: "mm", passo: 0.1, se: () => !redonda() },
    { k: "cabeca.gema.largura", r: "Largura", u: "mm", passo: 0.1, se: () => !redonda() },
    { k: "cabeca.garras", r: "Nº de garras", passo: 1, se: () => doc.cabeca.tipo === "garras" },
    { k: "cabeca.diamGarra", r: "Diâmetro da garra", u: "mm", passo: 0.05, se: () => doc.cabeca.tipo === "garras" },
    { k: "cabeca.galeria", r: "Galeria (anel entre as garras)", t: "chk", se: () => doc.cabeca.tipo === "garras" },
    { k: "cabeca.parede", r: "Parede da inglesa", u: "mm", passo: 0.05, se: () => doc.cabeca.tipo === "inglesa" },
    { k: "cabeca.elevacao", r: "Altura da cintura sobre o aro", u: "mm", passo: 0.1 },
    { k: "cabeca.girar", r: "Girar a gema", u: "°", passo: 90, se: () => !redonda() },
  ],
  pave: [
    { k: "pave.tipo", r: "Cravação", t: "sel", ops: () => [["garras", "Pavé com contas"], ["trilho", "Trilho (canal)"]] },
    { k: "pave.material", r: "Gema", t: "sel", ops: opMat },
    { k: "pave.eternidade", r: "Volta inteira (eternidade)", t: "chk", estrutura: true },
    { k: "pave.dInicial", r: "Ø perto do topo", u: "mm", passo: 0.05 },
    { k: "pave.dFinal", r: "Ø nas pontas", u: "mm", passo: 0.05, se: () => !doc.pave.eternidade },
    { k: "pave.arco", r: "Arco ocupado", u: "°", passo: 5, se: () => !doc.pave.eternidade },
    { k: "pave.espaco", r: "Espaço entre pedras", u: "mm", passo: 0.05 },
    { k: "pave.fileiras", r: "Fileiras", passo: 1 },
    { k: "pave.diamGarra", r: "Ø da conta / parede", u: "mm", passo: 0.05 },
  ],
  gravacao: [
    { k: "gravacao.texto", r: "Texto", t: "txt" },
    { k: "gravacao.lado", r: "Lado", t: "sel", ops: () => [["interno", "Por dentro"], ["externo", "Por fora"]] },
    { k: "gravacao.altura", r: "Altura das letras", u: "mm", passo: 0.1 },
    { k: "gravacao.profundidade", r: "Profundidade", u: "mm", passo: 0.05 },
    { k: "gravacao.posicao", r: "Posição (0° = topo)", u: "°", passo: 15 },
    { k: "gravacao.negrito", r: "Negrito", t: "chk" },
  ],
  textura: [
    { k: "textura.tipo", r: "Tipo", t: "sel", ops: () => [["nenhuma", "Nenhuma"], ["facetas", "Facetado (lapidado)"], ["frisos", "Frisos transversais"]], estrutura: true },
    { k: "textura.quantidade", r: "Quantidade na volta", passo: 1 },
    { k: "textura.profundidade", r: "Profundidade", u: "mm", passo: 0.05 },
  ],
  fabricacao: [
    { k: "fabricacao.ocar", r: "Ocar (canal interno para tirar metal)", t: "chk" },
    { k: "fabricacao.parede", r: "Parede mínima ao ocar", u: "mm", passo: 0.05 },
    { k: "fabricacao.contracao", r: "Contração da fundição", u: "%", passo: 0.1 },
    { k: "fabricacao.canais", r: "Canais de alimentação", passo: 1 },
    { k: "fabricacao.diamCanal", r: "Ø do canal", u: "mm", passo: 0.1 },
    { k: "fabricacao.compCanal", r: "Comprimento do canal", u: "mm", passo: 0.5 },
    { k: "fabricacao.perda", r: "Perda de metal", u: "%", passo: 0.5 },
  ],
  preco: [
    { k: "preco.cotacao", r: "Metal (liga)", u: "R$/g", passo: 1 },
    { k: "preco.precoQuilate", r: "Gemas", u: "R$/ct", passo: 10 },
    { k: "preco.maoDeObra", r: "Mão de obra", u: "R$", passo: 10 },
    { k: "preco.margem", r: "Margem", u: "%", passo: 1 },
  ],
};

function campoHtml(c: Campo): string {
  if (c.se && !c.se()) return "";
  const v = ler(c.k);
  if (c.t === "chk") return `<label class="gd-check"><input type="checkbox" data-k="${c.k}" ${v ? "checked" : ""} ${c.estrutura ? "data-e" : ""}/> ${escapar(c.r)}</label>`;
  const ctrl = c.t === "sel"
    ? `<select data-k="${c.k}" ${c.estrutura ? "data-e" : ""}>${c.ops!().map(([k, r]) => `<option value="${k}" ${String(v) === k ? "selected" : ""}>${escapar(r)}</option>`).join("")}</select>`
    : c.t === "txt"
      ? `<input data-k="${c.k}" data-t="txt" maxlength="60" value="${escapar(String(v))}" />`
      : `<input data-k="${c.k}" type="number" inputmode="decimal" step="${c.passo ?? 0.1}" value="${Number(v)}" />`;
  return `<label class="gd-campo"><span>${escapar(c.r)}</span>${ctrl}<em>${c.u ?? ""}</em></label>`;
}

function painel() {
  const p = $("#gd-props");
  const it = ITENS.find((i) => i.id === sel)!;
  let extra = "";
  if (sel === "aro") {
    const d = diametroInterno(doc.aro.norma, doc.aro.tamanho), t = tamanhos(d);
    extra = `<p class="gd-nota">Ø interno ${fmt(d)} mm · circunferência ${fmt(t.ISO, 1)} mm · BR ${fmt(t.BR, 1)} · US ${fmt(t.US, 2)}. Confira com o calibrador da loja.</p>`;
  } else if (sel === "cabeca") {
    const g = doc.cabeca.gema;
    extra = `<label class="gd-campo"><span>Peso da gema</span><input data-ct type="number" step="0.05" inputmode="decimal" value="${fmt(quilates(g), 3).replace(",", ".")}" /><em>ct</em></label>
      <p class="gd-nota">Proporção ${fmt(proporcoes(g).total / Math.min(g.comprimento, g.largura) * 100, 0)} % de profundidade. Mudar os quilates redimensiona a gema.</p>
      <div class="gd-botoes"><button data-acao="biblioteca">${IC.gema} Biblioteca de gemas</button></div>`;
  } else if (sel === "pave") {
    extra = `<p class="gd-nota">${m.pave.length} pedra(s), ${m.contas.length} conta(s). Gemas redondas; posições que não cabem ou colidem ficam de fora.</p>`;
  } else if (sel === "gravacao") {
    extra = `<p class="gd-nota">Fonte Noto Sans. Texto com <span id="gd-comp">${fmt(texto.largura, 1)}</span> mm de comprimento.</p>`;
  } else if (sel === "fabricacao") {
    extra = `<div class="gd-botoes"><button data-acao="stl-fund">${IC.fundir} STL para impressão e fundição</button><button data-acao="stl">${IC.exportar} STL da joia</button><button data-acao="step">${IC.exportar} STEP</button><button data-acao="ficha">${IC.tabela} Ficha técnica</button></div>
      <p class="gd-nota">Contração e canais só entram no "STL para impressão e fundição".</p>`;
  }
  p.innerHTML = `<section><h3>${IC[it.icone]} ${it.rotulo}</h3>
    ${it.alternar && !it.ativo!() ? `<p class="gd-nota">Desligado. <button data-ligar>Ligar</button></p>` : CAMPOS[sel].map(campoHtml).join("") + extra + (it.alternar ? `<div class="gd-botoes"><button data-desligar>Desligar ${it.rotulo.toLowerCase()}</button></div>` : "")}</section>
    <section id="gd-resultados"></section>`;
  painelResultados();
}

function painelResultados() {
  const s = document.getElementById("gd-resultados");
  if (!s) return;
  const vol = resultado?.volume ?? 0;
  const f = ficha(doc, m, vol);
  const av = [...verificar(doc, m, texto.largura), ...(resultado?.final ? resultado.avisos : [])];
  const liga = LIGAS[doc.liga];
  s.innerHTML = `<h3>Resultados</h3>
    <div class="gd-destaque"><small>${escapar(liga.nome)}${resultado?.final ? "" : " · calculando…"}</small><b>${fmt(f.peso)} g</b><small>${fmt(f.ctTotal, 3)} ct em ${f.gemas.reduce((a, g) => a + g.quantidade, 0)} pedra(s)</small></div>
    <dl class="gd-res">
      <dt>Ø interno</dt><dd>${fmt(f.diametro)} mm</dd>
      <dt>Volume do metal</dt><dd>${fmt(vol, 1)} mm³</dd>
      <dt>Área (polimento)</dt><dd>${fmt(resultado?.area ?? 0, 0)} mm²</dd>
      <dt>Peso com perda</dt><dd>${fmt(f.pesoComPerda)} g</dd>
      <dt>Modelo em resina</dt><dd>${fmt(f.pesoResina, 3)} g</dd>
      ${doc.preco.cotacao || doc.preco.precoQuilate || doc.preco.maoDeObra ? `<dt>Custo</dt><dd>${real(f.custo)}</dd><dt>Preço de venda</dt><dd><b>${real(f.venda)}</b></dd>` : ""}
    </dl>
    ${erroKernel ? `<p class="gd-aviso">${escapar(erroKernel)}</p>` : ""}
    ${av.map((a) => `<p class="gd-aviso">${escapar(a)}</p>`).join("")}`;
}

// eventos do painel e da árvore (delegação)
const props = $("#gd-props");
props.addEventListener("change", (e) => {
  const x = e.target as HTMLInputElement | HTMLSelectElement;
  if (x.dataset.ct !== undefined) {
    const ct = Number(x.value);
    if (!(ct > 0)) return;
    alterar(() => {
      const g = doc.cabeca.gema;
      if (g.lapidacao === "redonda") g.largura = g.comprimento = Math.round(diametroPorQuilates(ct * (3.52 / (MATERIAIS[g.material]?.densidade ?? 3.52))) * 100) / 100;
      else { const k = Math.cbrt(ct / quilates(g)); g.comprimento = Math.round(g.comprimento * k * 100) / 100; g.largura = Math.round(g.largura * k * 100) / 100; }
    });
    return;
  }
  const k = x.dataset.k;
  if (!k) return;
  const v = x instanceof HTMLInputElement && x.type === "checkbox" ? x.checked : x instanceof HTMLInputElement && x.type === "number" ? Number(x.value.replace(",", ".")) : x.value;
  if (typeof v === "number" && !Number.isFinite(v)) return;
  alterar(() => {
    gravar(k, v);
    if (k === "cabeca.gema.lapidacao") {
      const lap = LAPIDACOES[v as Lapidacao], g = doc.cabeca.gema;
      const w = Math.min(g.comprimento, g.largura);
      g.largura = w;
      g.comprimento = Math.round(w * lap.relacao * 100) / 100;
      doc.cabeca.garras = lap.garras;
    }
    if (k === "aro.largura" && doc.aro.larguraBase > (v as number)) doc.aro.larguraBase = v as number;
    if (k === "aro.espessura" && doc.aro.espessuraBase > (v as number)) doc.aro.espessuraBase = v as number;
  }, k === "textura.tipo");
});
props.addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest("button");
  if (!b) return;
  if (b.dataset.ligar !== undefined || b.dataset.desligar !== undefined) return alterar(() => ITENS.find((i) => i.id === sel)!.alternar!(b.dataset.ligar !== undefined), true);
  const a = b.dataset.acao;
  if (a === "biblioteca") biblioteca();
  else if (a === "stl-fund") exportar("stl", true);
  else if (a === "stl") exportar("stl", false);
  else if (a === "step") exportar("step", false);
  else if (a === "ficha") fichaTecnica();
});
const arv = $("#gd-arvore");
arv.addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>("[data-sel]");
  if (b) selecionar(b.dataset.sel as Item);
});
arv.addEventListener("change", (e) => {
  const x = e.target as HTMLInputElement;
  const it = ITENS.find((i) => i.id === x.dataset.alt);
  if (it) { sel = it.id; alterar(() => it.alternar!(x.checked), true); }
});

// ---------------------------------------------------------------------------------------------
// janelas: biblioteca de gemas, ficha técnica, modelos

function biblioteca() {
  let lap: Lapidacao = doc.cabeca.gema.lapidacao, mat = doc.cabeca.gema.material;
  const linhas = () => {
    const d = LAPIDACOES[lap];
    const ws = lap === "redonda" ? [1, 1.3, 1.5, 1.8, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.2, 5.5, 6, 6.5, 7, 7.5, 8, 9, 10] : [3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 8, 9, 10];
    return ws.map((w) => {
      const g: Gema = { lapidacao: lap, material: mat, comprimento: Math.round(w * d.relacao * 100) / 100, largura: w };
      const med = lap === "redonda" ? `${fmt(w, 2)}` : `${fmt(g.comprimento, 2)} × ${fmt(w, 2)}`;
      return `<tr data-c="${g.comprimento}" data-l="${w}"><td>${med} mm</td><td>${fmt(proporcoes(g).total, 2)} mm</td><td>${fmt(quilates(g), 3)} ct</td></tr>`;
    }).join("");
  };
  const { corpo, fechar } = janela("Biblioteca de gemas", `
    <div class="gd-lib"><label>Lapidação <select data-lap>${opLap().map(([k, r]) => `<option value="${k}" ${k === lap ? "selected" : ""}>${r}</option>`).join("")}</select></label>
    <label>Gema <select data-mat>${opMat().map(([k, r]) => `<option value="${k}" ${k === mat ? "selected" : ""}>${r}</option>`).join("")}</select></label></div>
    <p class="gd-nota">Peso estimado pelas fórmulas de mercado (proporções padrão). Toque numa linha para usar na cabeça.</p>
    <div class="gd-rolar"><table class="gd-tabela"><thead><tr><th>Medidas</th><th>Profundidade</th><th>Peso</th></tr></thead><tbody>${linhas()}</tbody></table></div>`, [{ rotulo: "Fechar" }], true);
  const tb = $("tbody", corpo);
  corpo.addEventListener("change", (e) => {
    const x = e.target as HTMLSelectElement;
    if (x.dataset.lap !== undefined) lap = x.value as Lapidacao;
    if (x.dataset.mat !== undefined) mat = x.value;
    tb.innerHTML = linhas();
  });
  tb.addEventListener("click", (e) => {
    const tr = (e.target as HTMLElement).closest<HTMLElement>("tr");
    if (!tr) return;
    fechar();
    alterar(() => {
      doc.cabeca.ativo = true;
      doc.cabeca.gema = { lapidacao: lap, material: mat, comprimento: Number(tr.dataset.c), largura: Number(tr.dataset.l) };
      doc.cabeca.garras = LAPIDACOES[lap].garras;
    }, true);
    selecionar("cabeca");
  });
}

function fichaTecnica() {
  const f = ficha(doc, m, resultado?.volume ?? 0);
  const a = doc.aro, liga = LIGAS[doc.liga];
  const linhas: [string, string][] = [
    ["Peça", doc.nome],
    ["Liga", liga.nome],
    ["Aro", `${NORMAS[a.norma]} ${fmt(a.tamanho, 1)} · Ø interno ${fmt(f.diametro)} mm`],
    ["Perfil", `${a.perfil}, ${fmt(a.largura)} × ${fmt(a.espessura)} mm no topo, ${fmt(a.larguraBase)} × ${fmt(a.espessuraBase)} mm na base`],
    ["Volume do metal", `${fmt(f.volume, 1)} mm³`],
    ["Peso do metal", `${fmt(f.peso)} g (com ${fmt(doc.fabricacao.perda, 1)} % de perda: ${fmt(f.pesoComPerda)} g)`],
    ["Modelo em resina", `${fmt(f.pesoResina, 3)} g`],
    ["Contração na fundição", `${fmt(doc.fabricacao.contracao, 1)} %`],
    ["Gravação", doc.gravacao.ativo ? `"${doc.gravacao.texto}" ${doc.gravacao.lado}, ${fmt(doc.gravacao.altura, 1)} mm` : "—"],
  ];
  const csv = [["Item", "Valor"], ...linhas, [], ["Gema", "Quantidade", "ct cada", "ct total"], ...f.gemas.map((g) => [g.descricao, String(g.quantidade), fmt(g.ctUnit, 3), fmt(g.ctTotal, 3)]), ["Total", "", "", fmt(f.ctTotal, 3)]];
  const temPreco = !!(doc.preco.cotacao || doc.preco.precoQuilate || doc.preco.maoDeObra);
  if (temPreco) csv.push([], ["Metal", real(f.custoMetal)], ["Gemas", real(f.custoGemas)], ["Mão de obra", real(doc.preco.maoDeObra)], ["Custo", real(f.custo)], ["Venda", real(f.venda)]);
  janela("Ficha técnica", `
    <table class="gd-tabela gd-esq"><tbody>${linhas.map(([k, v]) => `<tr><th>${escapar(k)}</th><td>${escapar(v)}</td></tr>`).join("")}</tbody></table>
    <h4>Gemas</h4>
    <table class="gd-tabela"><thead><tr><th>Gema</th><th>Qtd.</th><th>ct cada</th><th>ct total</th></tr></thead><tbody>
    ${f.gemas.map((g) => `<tr><td>${escapar(g.descricao)}</td><td>${g.quantidade}</td><td>${fmt(g.ctUnit, 3)}</td><td>${fmt(g.ctTotal, 3)}</td></tr>`).join("")}
    <tr><td>Total</td><td>${f.gemas.reduce((s, g) => s + g.quantidade, 0)}</td><td></td><td>${fmt(f.ctTotal, 3)}</td></tr></tbody></table>
    ${temPreco ? `<h4>Preço</h4><p>Metal ${real(f.custoMetal)} · Gemas ${real(f.custoGemas)} · Mão de obra ${real(doc.preco.maoDeObra)} · Custo ${real(f.custo)} · <b>Venda ${real(f.venda)}</b></p>` : ""}
    ${verificar(doc, m, texto.largura).map((x) => `<p class="gd-aviso">${escapar(x)}</p>`).join("")}`,
  [{ rotulo: "Baixar CSV", acao: () => { baixar("﻿" + csv.map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\r\n"), `${doc.nome} - ficha`, "csv", "text/csv"); return false; } }, { rotulo: "Fechar", destaque: true }], true);
}

const MODELOS: { nome: string; criar: () => DocJoia }[] = [
  { nome: "Solitário 4 garras", criar: () => ({ ...docNovo(), nome: "Solitário" }) },
  { nome: "Solitário com pavé lateral", criar: () => ({ ...docNovo(), nome: "Solitário com pavé", pave: { ...docNovo().pave, ativo: true } }) },
  { nome: "Aliança reta", criar: () => ({ ...docNovo(), nome: "Aliança", cabeca: { ...docNovo().cabeca, ativo: false }, aro: { ...docNovo().aro, perfil: "conforto", largura: 4, espessura: 1.6, larguraBase: 4, espessuraBase: 1.6 }, gravacao: { ...docNovo().gravacao, ativo: true } }) },
  { nome: "Meia-aliança com pavé", criar: () => ({ ...docNovo(), nome: "Meia-aliança", cabeca: { ...docNovo().cabeca, ativo: false }, aro: { ...docNovo().aro, perfil: "meia-cana", largura: 2.8, espessura: 1.8, larguraBase: 2.2, espessuraBase: 1.5 }, pave: { ...docNovo().pave, ativo: true, dInicial: 1.6, dFinal: 1.6, arco: 150 } }) },
  { nome: "Eternidade", criar: () => ({ ...docNovo(), nome: "Eternidade", cabeca: { ...docNovo().cabeca, ativo: false }, aro: { ...docNovo().aro, perfil: "reto", largura: 3, espessura: 1.8, larguraBase: 3, espessuraBase: 1.8 }, pave: { ...docNovo().pave, ativo: true, eternidade: true, dInicial: 1.8 } }) },
  { nome: "Inglesa oval (safira)", criar: () => ({ ...docNovo(), nome: "Inglesa oval", cabeca: { ...docNovo().cabeca, tipo: "inglesa", elevacao: 1.2, gema: { lapidacao: "oval", material: "safira", comprimento: 7, largura: 5 } } }) },
  { nome: "Anel torcido", criar: () => ({ ...docNovo(), nome: "Anel torcido", cabeca: { ...docNovo().cabeca, ativo: false }, aro: { ...docNovo().aro, perfil: "reto", largura: 2.6, espessura: 2.2, larguraBase: 2.6, espessuraBase: 2.2, torcao: 3 } }) },
  { nome: "Aliança facetada", criar: () => ({ ...docNovo(), nome: "Aliança facetada", cabeca: { ...docNovo().cabeca, ativo: false }, aro: { ...docNovo().aro, perfil: "reto", largura: 3.5, espessura: 1.9, larguraBase: 3.5, espessuraBase: 1.9 }, textura: { tipo: "facetas", quantidade: 14, profundidade: 0.3 } }) },
];

function modelos() {
  const { corpo, fechar } = janela("Modelos", `<div class="gd-modelos">${MODELOS.map((x, i) => `<button data-m="${i}">${IC.anel}<span>${escapar(x.nome)}</span></button>`).join("")}</div>
    <p class="gd-nota">O modelo substitui a joia aberta (dá para desfazer com Ctrl+Z).</p>`);
  corpo.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-m]");
    if (!b) return;
    fechar();
    const d = MODELOS[Number(b.dataset.m)].criar();
    doc = validarDoc(d);
    historico.registrar(doc);
    autosave.guardar(CHAVE, doc);
    casca.renderizar();
    arvore();
    atualizar();
    painel();
    vista.enquadrar(raioJoia());
  });
}

async function imagem() {
  const b = await vista.imagem();
  if (b) baixar(b, doc.nome, "png", "image/png");
}

// ---------------------------------------------------------------------------------------------
// casca e início

const vista = new VistaJoia($("#gd-vista"));
const casca: Casca = new Casca({
  app: "WJGoldDiamond",
  icone: "",
  extensao: "wjgd",
  nomeDoc: () => doc.nome,
  renomear: (n) => {
    doc.nome = n;
    autosave.guardar(CHAVE, doc);
    casca.renderizar();
  },
  novo: () => trocarDoc(docNovo()),
  abrir: () =>
    void escolherArquivo().then((a) => {
      if (!a?.texto) return;
      try {
        const d = validarDoc(JSON.parse(a.texto));
        if (d.nome === docNovo().nome) d.nome = a.nome.replace(/\.[^.]+$/, "");
        trocarDoc(d);
      } catch (e) {
        casca.avisar((e as Error).message || "Arquivo inválido.", 6000);
      }
    }),
  salvar: () => {
    casca.avisar("Salvando no cofre…");
    void salvarArquivo(JSON.stringify(doc), doc.nome, "wjgd");
  },
  desfazer,
  refazer,
  abas: [
    {
      id: "joia", rotulo: "Joia", grupos: [
        [{ id: "mod", rotulo: "Modelos", icone: "anel", dica: "Começar de um modelo pronto", acao: modelos }],
        [
          { id: "aro", rotulo: "Aro", icone: "anel", acao: () => selecionar("aro") },
          { id: "garras", rotulo: "Garras", icone: "garras", dica: "Cabeça com garras", acao: () => alterar(() => { doc.cabeca.ativo = true; doc.cabeca.tipo = "garras"; sel = "cabeca"; }, true) },
          { id: "inglesa", rotulo: "Inglesa", icone: "inglesa", dica: "Cabeça com aro fechado em volta da gema", acao: () => alterar(() => { doc.cabeca.ativo = true; doc.cabeca.tipo = "inglesa"; sel = "cabeca"; }, true) },
          { id: "pave", rotulo: "Pavé", icone: "pave", dica: "Pedras ao longo do aro (tamanhos graduados, fileiras, eternidade)", acao: () => alterar(() => { doc.pave.ativo = true; sel = "pave"; }, true) },
        ],
        [
          { id: "grav", rotulo: "Gravação", icone: "gravar", dica: "Texto por dentro ou por fora do aro", acao: () => alterar(() => { doc.gravacao.ativo = true; sel = "gravacao"; }, true) },
          { id: "tex", rotulo: "Textura", icone: "textura", dica: "Facetado ou frisos no aro", acao: () => alterar(() => { if (doc.textura.tipo === "nenhuma") doc.textura.tipo = "facetas"; sel = "textura"; }, true) },
        ],
      ],
    },
    {
      id: "gemas", rotulo: "Gemas", grupos: [
        [{ id: "lib", rotulo: "Biblioteca de gemas", icone: "gema", dica: "Lapidações, medidas e quilates", acao: biblioteca }],
        [{ id: "cab", rotulo: "Gema central", icone: "garras", acao: () => selecionar("cabeca") }, { id: "pv", rotulo: "Pedras do pavé", icone: "pave", acao: () => selecionar("pave") }],
      ],
    },
    {
      id: "fab", rotulo: "Fabricação", grupos: [
        [{ id: "fich", rotulo: "Ficha técnica", icone: "tabela", dica: "Pedras, quilates, peso por liga e preço", acao: fichaTecnica }],
        [
          { id: "stlf", rotulo: "STL fundição", icone: "fundir", dica: "STL com contração e canais de alimentação", acao: () => exportar("stl", true) },
          { id: "stl", rotulo: "STL", icone: "exportar", acao: () => exportar("stl", false) },
          { id: "step", rotulo: "STEP", icone: "exportar", acao: () => exportar("step", false) },
        ],
        [{ id: "fab", rotulo: "Ocar e canais", icone: "fundir", acao: () => selecionar("fabricacao") }, { id: "prc", rotulo: "Preço", icone: "moeda", acao: () => selecionar("preco") }],
      ],
    },
    {
      id: "vista", rotulo: "Vista", grupos: [
        [
          { id: "iso", rotulo: "Isométrica", icone: "enquadrar", acao: () => vista.vista("iso") },
          { id: "fr", rotulo: "Frente", icone: "anel", acao: () => vista.vista("frente") },
          { id: "ld", rotulo: "Lado", icone: "anel", acao: () => vista.vista("lado") },
          { id: "ci", rotulo: "Cima", icone: "anel", acao: () => vista.vista("cima") },
        ],
        [
          { id: "enq", rotulo: "Enquadrar", icone: "enquadrar", dica: "Enquadrar (F)", acao: () => vista.enquadrar(raioJoia()) },
          { id: "gir", rotulo: "Girar", icone: "girar", dica: "Girar sem parar (apresentação)", ativo: () => vista.estaGirando, acao: () => { vista.girar(!vista.estaGirando); casca.renderizar(); } },
          { id: "img", rotulo: "Imagem", icone: "imagem", dica: "Salvar a vista como imagem PNG", acao: () => void imagem() },
        ],
      ],
    },
  ],
});
document.addEventListener("keydown", (e) => {
  if ((e.target as HTMLElement).closest("input, select, textarea")) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); desfazer(); }
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") { e.preventDefault(); refazer(); }
  else if (!e.ctrlKey && !e.metaKey && e.key.toLowerCase() === "f") vista.enquadrar(raioJoia());
});
registrarOffline();
arvore();
painel();
atualizar();
vista.enquadrar(raioJoia());
vista.vista("iso");
