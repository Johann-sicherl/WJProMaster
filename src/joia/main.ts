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
  agruparLacos, diametroInterno, diametroPorQuilates, docNovo, ficha, superficie, LAPIDACOES, LIGAS, MATERIAIS, montar, NORMAS, proporcoes, quilates, tamanhos, validarDoc, verificar,
  type DocJoia, type Gema, type GrupoTexto, type Lapidacao, type Montagem, type P2,
} from "./regras";
import { VistaJoia } from "./vista";
import { esbocoNovoOrnamento, ornamentoVintage, type Ornamento } from "./ornamento";
import { aplicarToque, codificar, dentroDoRaio, esculturaNova, malhaLocal, matrizLugar, normais, subdividir, vizinhanca, type Escultura, type FormaBase, type Malha, type Pincel, type Vizinhanca } from "./escultura";
import type { EsculturaVista, EventoPincel } from "./vista";
import type { EditorOrnamento } from "./editorOrnamento";
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

type Item = "aro" | "cabeca" | "pave" | "ornamentos" | "esculturas" | "gravacao" | "textura" | "fabricacao" | "preco";
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

function restaurar(d: DocJoia | null) {
  if (!d) return;
  doc = d;
  autosave.guardar(CHAVE, doc);
  if (esculpindo) {
    const e = escAtual();
    if (e) abrirSessao(e);
    else concluirEscultura();
    painel();
    return;
  }
  if (editando) {
    const o = ornAtual();
    if (o && edOrn) edOrn.reatar(o.esboco);
    else concluirOrnamento();
    painel();
    return;
  }
  arvore();
  atualizar();
  painel();
}
const desfazer = () => restaurar(historico.desfazer());
const refazer = () => restaurar(historico.refazer());

// ---------------------------------------------------------------------------------------------
// ornamentos: o esboço do WJCAD num modo de edição (carregado só quando aberto)

let ornSel = "";
let editando = false;
let edOrn: EditorOrnamento | null = null;
const ornAtual = (): Ornamento | undefined => doc.ornamentos.find((o) => o.id === ornSel) ?? doc.ornamentos[0];
const novoIdOrn = () => `o${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

function novoOrnamento(exemplo = false) {
  const id = novoIdOrn();
  const g = doc.cabeca.ativo ? doc.cabeca.gema : null;
  const vira = doc.cabeca.girar % 180 >= 45;
  const o: Ornamento = exemplo
    ? ornamentoVintage(id, doc.aro.largura)
    : {
      id, nome: `Ornamento ${doc.ornamentos.length + 1}`, ativo: true, altura: 0.05, diametro: 0.7, simetria: "xy", envolver: true, pontas: true, fios: {}, pontos: {},
      esboco: esbocoNovoOrnamento(`${id}-esb`, doc.aro.largura, g && (vira ? { comprimento: g.largura, largura: g.comprimento } : g), 26),
    };
  ornSel = id;
  alterar(() => doc.ornamentos.push(o), true);
  if (!exemplo) void editarOrnamento();
}

async function editarOrnamento() {
  const o = ornAtual();
  if (!o) return novoOrnamento();
  ornSel = o.id;
  editando = true;
  vista.girar(false);
  $("#gd-vista").hidden = true;
  $("#gd-esboco").hidden = false;
  $("#gd-arvore").hidden = true;
  $("#gd-esq-esboco").hidden = false;
  casca.definirStatus("Carregando o esboço…");
  try {
    if (!edOrn) {
      const { EditorOrnamento } = await import("./editorOrnamento");
      edOrn = await EditorOrnamento.criar({
        viewport: $("#gd-vp"), overlay: $("#gd-overlay"), painel: $("#painel-comando"),
        alterou: (final) => {
          autosave.guardar(CHAVE, doc);
          if (final) historico.registrar(doc);
        },
        atualizar: () => {
          cancelAnimationFrame(quadroPainel);
          quadroPainel = requestAnimationFrame(() => painel());
        },
        avisar: (t) => casca.avisar(t, 5000),
        simetria: () => ornAtual()?.simetria ?? "nenhuma",
      });
    }
  } catch (e) {
    casca.avisar(`Não foi possível abrir o esboço: ${(e as Error).message}`, 8000);
    return concluirOrnamento();
  }
  if (!editando) return;
  edOrn.abrir(ornAtual()!.esboco);
  casca.renderizar();
  painel();
  casca.definirStatus("Desenhe na vista de cima do aro: horizontal = ao longo do aro (0 = topo), vertical = largura. Linhas tracejadas = guias.");
}
let quadroPainel = 0;

function concluirOrnamento() {
  editando = false;
  edOrn?.fechar();
  $("#gd-vista").hidden = false;
  $("#gd-esboco").hidden = true;
  $("#gd-arvore").hidden = false;
  $("#gd-esq-esboco").hidden = true;
  doc = validarDoc(doc);
  historico.registrar(doc);
  autosave.guardar(CHAVE, doc);
  casca.renderizar();
  arvore();
  atualizar();
  painel();
}

// ---------------------------------------------------------------------------------------------
// escultura livre em malha (pincéis na vista 3D; caneta/mouse esculpe, dedo gira)

let escSel = "";
let esculpindo = false;
let sessao: { id: string; malha: Malha; nor: Float32Array; vz: Vizinhanca; pesos?: Map<number, number>; ultimo?: [number, number, number] } | null = null;
const pincel: { tipo: Pincel; raio: number; forca: number; inverter: boolean; simetria: boolean; pressao: boolean; dedo: boolean } = (() => {
  const p = { tipo: "puxar" as Pincel, raio: 1.2, forca: 0.5, inverter: false, simetria: true, pressao: true, dedo: false };
  try {
    Object.assign(p, JSON.parse(localStorage.getItem("wjgd:pincel") ?? "{}"));
  } catch {
    /* padrão */
  }
  return p;
})();
const guardarPincel = () => {
  try {
    localStorage.setItem("wjgd:pincel", JSON.stringify(pincel));
  } catch {
    /* sem preferências */
  }
};
const escAtual = (): Escultura | undefined => doc.esculturas.find((e) => e.id === escSel) ?? doc.esculturas[0];
const PINCEIS: [Pincel, string, NomeIc, string][] = [
  ["puxar", "Puxar", "mais", "Levanta (ou afunda, invertido) na direção da superfície"],
  ["inflar", "Inflar", "circulo", "Incha cada ponto pela sua normal"],
  ["suavizar", "Suavizar", "pincel", "Alisa as irregularidades"],
  ["achatar", "Achatar", "regua", "Aplaina no plano médio sob o pincel"],
  ["vinco", "Vinco", "recortar", "Afina e afunda em linha (nervura de folha); invertido faz crista"],
  ["arrastar", "Arrastar", "movimento", "Puxa a região tocada acompanhando o traço"],
];

/** Esculturas na vista (a da sessão usa os arrays vivos do pincel). */
function vistaEsculturas() {
  const R = diametroInterno(doc.aro.norma, doc.aro.tamanho) / 2;
  const t = (th: number) => superficie(doc.aro, th, 0);
  const lista: EsculturaVista[] = doc.esculturas.filter((e) => e.ativo).map((e) => {
    const viva = sessao?.id === e.id ? sessao : null;
    const ml = viva ? viva.malha : malhaLocal(e);
    return { id: e.id, pos: ml.pos, nor: viva ? viva.nor : normais(ml.pos, ml.tri), tri: ml.tri, matrizes: (e.espelhar ? [false, true] : [false]).map((s) => matrizLugar(e, R, t, s)) };
  });
  vista.definirEsculturas(lista);
}

function abrirSessao(e: Escultura) {
  const malha = malhaLocal(e);
  sessao = { id: e.id, malha, nor: normais(malha.pos, malha.tri), vz: vizinhanca(malha.tri, malha.pos.length / 3) };
  vista.esculpir = { id: e.id, raio: pincel.raio, dedo: pincel.dedo, aoPincel };
  vistaEsculturas();
}

function aoPincel(ev: EventoPincel) {
  const e = escAtual(), s = sessao;
  if (!e || !s || s.id !== ev.id) return;
  if (ev.fase === "fim") {
    e.pos = codificar(s.malha.pos);
    s.pesos = undefined;
    s.ultimo = undefined;
    historico.registrar(doc);
    autosave.guardar(CHAVE, doc);
    casca.definirStatus("Esculpindo: peso e STL são atualizados ao concluir.");
    return;
  }
  const escala = Math.max(0.05, e.lugar.tamanho / 2);
  const r = pincel.raio / escala;
  const f = pincel.forca * (pincel.pressao ? Math.min(1.5, Math.max(0.15, ev.pressao * 1.6)) : 1);
  if (pincel.tipo === "arrastar") {
    if (ev.fase === "inicio") s.pesos = dentroDoRaio(s.malha.pos, ev.c, r);
    else if (ev.d && s.pesos) aplicarToque(s.malha.pos, s.nor, s.vz, { pincel: "arrastar", c: ev.c, n: ev.n, r, f, inverter: false, d: ev.d, pesos: s.pesos }, pincel.simetria);
  } else {
    if (!Number.isFinite(ev.c[0])) return;
    // espaçamento dos toques: 20 % do raio
    if (s.ultimo && Math.hypot(ev.c[0] - s.ultimo[0], ev.c[1] - s.ultimo[1], ev.c[2] - s.ultimo[2]) < r * 0.2) return;
    s.ultimo = ev.c;
    aplicarToque(s.malha.pos, s.nor, s.vz, { pincel: pincel.tipo, c: ev.c, n: ev.n, r, f, inverter: pincel.inverter }, pincel.simetria);
  }
  normais(s.malha.pos, s.malha.tri, s.nor);
  vista.atualizarEscultura(s.id);
}

function novaEscultura(base: FormaBase) {
  const id = `e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  escSel = id;
  alterar(() => doc.esculturas.push(esculturaNova(id, base, doc.esculturas.length + 1)), true);
  esculpir();
}

function esculpir() {
  const e = escAtual();
  if (!e) return casca.avisar("Crie uma escultura primeiro (Nova: esfera, gota, folha ou cápsula).");
  if (editando) concluirOrnamento();
  escSel = e.id;
  esculpindo = true;
  sel = "esculturas";
  vista.girar(false);
  abrirSessao(e);
  casca.renderizar();
  arvore();
  painel();
  casca.definirStatus("Esculpir: caneta ou mouse esquerdo esculpe sobre a peça; dedo (ou botão do meio) gira, dois dedos aproximam.");
}

function concluirEscultura() {
  esculpindo = false;
  vista.esculpir = null;
  sessao = null;
  casca.renderizar();
  atualizar();
  painel();
}

function subdividirEscultura() {
  const e = escAtual();
  if (!e) return;
  if (e.nivel >= 6) return casca.avisar("A escultura já está no nível máximo (40 962 vértices).");
  if (sessao?.id === e.id) e.pos = codificar(sessao.malha.pos);
  const nova = subdividir(e);
  alterar(() => (doc.esculturas = doc.esculturas.map((x) => (x.id === e.id ? nova : x))));
  if (esculpindo) abrirSessao(escAtual()!);
  casca.avisar(`Subdividida: ${(malhaLocal(nova).pos.length / 3).toLocaleString("pt-BR")} vértices.`);
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
    resultado = r.final || !resultado ? { volume: r.final ? r.volume : 0, area: r.final ? r.area : 0, avisos: r.avisos, ms: r.ms, final: r.final } : { ...resultado, final: false };
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
  vista.definirGemas([...(m.cabeca ? [m.cabeca] : []), ...m.pave, ...m.gemasOrn.map((x) => x.gema)]);
  vista.corMetal(LIGAS[doc.liga].cor);
  vistaEsculturas();
  if (resultado) resultado.final = false;
  gerar();
  status();
}

function status() {
  const ct = (m.cabeca?.ct ?? 0) + m.pave.reduce((s, g) => s + g.ct, 0) + m.gemasOrn.reduce((s, g) => s + g.gema.ct, 0);
  const pedras = (m.cabeca ? 1 : 0) + m.pave.length + m.gemasOrn.length;
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
  { id: "ornamentos", rotulo: "Ornamentos", icone: "filigrana" },
  { id: "esculturas", rotulo: "Escultura", icone: "esculpir" },
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
    { k: "aro.dividido", r: "Aro dividido: abertura no topo (0 = inteiro)", u: "mm", passo: 0.1 },
    { k: "aro.divisao", r: "Divisão até", u: "°", passo: 5, se: () => doc.aro.dividido > 0 },
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
    { k: "cabeca.pontaGarra", r: "Ponta da garra", t: "sel", ops: () => [["bolinha", "Bolinha"], ["alongada", "Alongada (sobre a pedra)"], ["dupla", "Garra dupla"]], se: () => doc.cabeca.tipo === "garras" },
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
  ornamentos: [],
  esculturas: [],
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

function camposOrnamento(i: number): Campo[] {
  const k = (c: string) => `ornamentos.${i}.${c}`;
  return [
    { k: k("nome"), r: "Nome", t: "txt" },
    { k: k("altura"), r: "Altura sobre o aro", u: "mm", passo: 0.1 },
    { k: k("diametro"), r: "Ø padrão do fio", u: "mm", passo: 0.05 },
    { k: k("simetria"), r: "Simetria", t: "sel", ops: () => [["xy", "Espelhar nos dois eixos"], ["x", "Espelhar esquerda ↔ direita"], ["y", "Espelhar frente ↔ trás"], ["nenhuma", "Sem simetria"]] },
    { k: k("envolver"), r: "Envolver no aro (senão: plano sobre o topo)", t: "chk" },
    { k: k("pontas"), r: "Bolinha nas pontas soltas", t: "chk" },
  ];
}

/** Seção da seleção no esboço: Ø e altura dos fios, tipo dos pontos. */
function selecaoOrnamento(o: Ornamento): string {
  const ids = edOrn?.selecao() ?? [];
  const geos = o.esboco.geos.filter((g) => ids.includes(g.id) && !g.construcao && g.tipo !== "ponto" && g.tipo !== "texto");
  const pts = o.esboco.geos.filter((g) => g.tipo === "ponto" && ids.includes(g.p)).map((g) => (g as { p: string }).p);
  if (!geos.length && !pts.length) return `<p class="gd-nota">Toque num fio ou ponto para ajustar Ø, altura e tipo. Ponto (ferramenta Ponto) = bolinha ou pedrinha.</p>`;
  let h = "";
  if (geos.length) {
    const c = o.fios[geos[0].id] ?? {};
    const f = (nome: string, rot: string, v: number | undefined, u: string) => `<label class="gd-campo"><span>${rot}</span><input type="number" step="0.05" inputmode="decimal" data-fio="${nome}" value="${v ?? ""}" placeholder="padrão" /><em>${u}</em></label>`;
    h += `<h4>${geos.length} fio(s) selecionado(s)</h4>${f("d0", "Ø no início", c.d0, "mm")}${f("d1", "Ø no fim", c.d1, "mm")}${f("a0", "Altura no início", c.a0, "mm")}${f("a1", "Altura no fim", c.a1, "mm")}
      <p class="gd-nota">Vazio = valor padrão do ornamento. Alturas diferentes fazem o fio subir ou descer (ex.: da moldura até o aro).</p>`;
  }
  if (pts.length) {
    const c = o.pontos[pts[0]] ?? { tipo: "conta", d: Math.round(o.diametro * 160) / 100, material: "diamante" };
    h += `<h4>${pts.length} ponto(s) selecionado(s)</h4>
      <label class="gd-campo"><span>Tipo</span><select data-pt="tipo"><option value="conta" ${c.tipo === "conta" ? "selected" : ""}>Bolinha de metal</option><option value="inglesa" ${c.tipo === "inglesa" ? "selected" : ""}>Pedrinha em inglesa</option></select><em></em></label>
      <label class="gd-campo"><span>Ø</span><input type="number" step="0.05" inputmode="decimal" data-pt="d" value="${c.d}" /><em>mm</em></label>
      ${c.tipo === "inglesa" ? `<label class="gd-campo"><span>Gema</span><select data-pt="material">${opMat().map(([k, r]) => `<option value="${k}" ${k === c.material ? "selected" : ""}>${r}</option>`).join("")}</select><em></em></label>` : ""}`;
  }
  return h;
}

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

function camposEscultura(i: number): Campo[] {
  const k = (c: string) => `esculturas.${i}.${c}`;
  return [
    { k: k("nome"), r: "Nome", t: "txt" },
    { k: k("lugar.th"), r: "Posição ao longo do aro (0° = topo)", u: "°", passo: 2 },
    { k: k("lugar.z"), r: "Lateral (largura do aro)", u: "mm", passo: 0.1 },
    { k: k("lugar.altura"), r: "Altura sobre o aro", u: "mm", passo: 0.1 },
    { k: k("lugar.tamanho"), r: "Tamanho", u: "mm", passo: 0.2 },
    { k: k("lugar.rx"), r: "Giro em X (inclina para os lados)", u: "°", passo: 5 },
    { k: k("lugar.ry"), r: "Giro em Y (gira sobre o aro)", u: "°", passo: 5 },
    { k: k("lugar.rz"), r: "Giro em Z (inclina ao longo do aro)", u: "°", passo: 5 },
    { k: k("espelhar"), r: "Cópia espelhada do outro lado do aro", t: "chk" },
  ];
}

function painelPincel(): string {
  const faixa = (id: string, rot: string, v: number, min: number, max: number, passo: number, u: string) =>
    `<label class="gd-campo"><span>${rot}</span><input type="range" data-pincel="${id}" min="${min}" max="${max}" step="${passo}" value="${v}" /><em>${fmt(v, passo < 0.1 ? 2 : 1)}${u}</em></label>`;
  const chk = (id: string, rot: string, v: boolean) => `<label class="gd-check"><input type="checkbox" data-pincel="${id}" ${v ? "checked" : ""} /> ${rot}</label>`;
  return `<h4>Pincel: ${PINCEIS.find((x) => x[0] === pincel.tipo)?.[1]}</h4>
    ${faixa("raio", "Raio", pincel.raio, 0.1, 6, 0.05, " mm")}
    ${faixa("forca", "Força", pincel.forca, 0.05, 1, 0.05, "")}
    ${chk("inverter", "Inverter (afundar em vez de levantar)", pincel.inverter)}
    ${chk("simetria", "Simetria (espelha o traço no X da peça)", pincel.simetria)}
    ${chk("pressao", "Pressão da caneta muda a força", pincel.pressao)}
    ${chk("dedo", "Esculpir com o dedo (sem caneta)", pincel.dedo)}`;
}

function painel() {
  if (editando) sel = "ornamentos";
  if (esculpindo) sel = "esculturas";
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
  } else if (sel === "esculturas") {
    const e = escAtual();
    const i = e ? doc.esculturas.indexOf(e) : -1;
    const nv = e ? malhaLocal(e).pos.length / 3 : 0;
    extra = `<p class="gd-nota">Escultura livre em malha (folhas, flores, relevos). Parte de uma forma, recebe pincéis e é unida à joia no peso e no STL (STEP leva só a parte paramétrica).</p>
      <div class="gd-lista">${doc.esculturas.map((x) => `<label class="gd-check ${x.id === e?.id ? "gd-atual" : ""}"><input type="checkbox" data-esc-ativo="${x.id}" ${x.ativo ? "checked" : ""} /><button data-esc="${x.id}">${escapar(x.nome)}</button></label>`).join("") || `<p class="gd-nota">Nenhuma escultura.</p>`}</div>
      <div class="gd-botoes">${(["esfera", "gota", "folha", "capsula"] as FormaBase[]).map((b) => `<button data-esc-nova="${b}">${IC.novo} ${{ esfera: "Esfera", gota: "Gota", folha: "Folha", capsula: "Cápsula" }[b]}</button>`).join("")}</div>
      ${e ? `<div class="gd-botoes">${esculpindo ? "" : `<button data-acao="esc-esculpir" class="destaque">${IC.esculpir} Esculpir</button>`}<button data-acao="esc-subdividir">${IC.grade} Subdividir (${nv.toLocaleString("pt-BR")} vértices)</button><button data-acao="esc-excluir">${IC.apagar} Excluir</button></div>` : ""}
      ${esculpindo ? painelPincel() : ""}
      ${e ? camposEscultura(i).map(campoHtml).join("") : ""}`;
  } else if (sel === "ornamentos") {
    const o = ornAtual();
    const i = o ? doc.ornamentos.indexOf(o) : -1;
    extra = `<p class="gd-nota">Desenhe fios (filigrana, volutas, moldura, pipa) com as ferramentas do esboço do WJCAD na vista de cima do aro; a simetria completa o desenho e o fio é envolvido no aro.</p>
      <div class="gd-lista">${doc.ornamentos.map((x) => `<label class="gd-check ${x.id === o?.id ? "gd-atual" : ""}"><input type="checkbox" data-orn-ativo="${x.id}" ${x.ativo ? "checked" : ""} /><button data-orn="${x.id}">${escapar(x.nome)}</button></label>`).join("") || `<p class="gd-nota">Nenhum ornamento.</p>`}</div>
      <div class="gd-botoes"><button data-acao="orn-novo">${IC.novo} Novo</button>${o ? `<button data-acao="orn-editar" class="destaque">${IC.editar} Desenhar</button><button data-acao="orn-excluir">${IC.apagar} Excluir</button>` : ""}<button data-acao="orn-exemplo">${IC.filigrana} Exemplo de filigrana</button></div>
      ${o ? camposOrnamento(i).map(campoHtml).join("") : ""}
      ${editando && o ? selecaoOrnamento(o) : ""}`;
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
  if (x.dataset.pincel) {
    const k = x.dataset.pincel as keyof typeof pincel;
    const inp = x as HTMLInputElement;
    (pincel as Record<string, unknown>)[k] = inp.type === "checkbox" ? inp.checked : Number(inp.value);
    guardarPincel();
    if (vista.esculpir) Object.assign(vista.esculpir, { raio: pincel.raio, dedo: pincel.dedo });
    painel();
    return;
  }
  if (x.dataset.escAtivo) {
    const alvo = doc.esculturas.find((q) => q.id === x.dataset.escAtivo);
    if (alvo) alterar(() => (alvo.ativo = (x as HTMLInputElement).checked));
    return;
  }
  const o = ornAtual();
  if (x.dataset.ornAtivo) {
    const alvo = doc.ornamentos.find((q) => q.id === x.dataset.ornAtivo);
    if (alvo) alterar(() => (alvo.ativo = (x as HTMLInputElement).checked));
    return;
  }
  if (o && (x.dataset.fio || x.dataset.pt)) {
    const ids = edOrn?.selecao() ?? [];
    const valor = x.value.trim() === "" ? undefined : x.dataset.pt === "tipo" || x.dataset.pt === "material" ? x.value : Number(x.value.replace(",", "."));
    if (typeof valor === "number" && !(valor >= 0)) return;
    for (const g of o.esboco.geos) {
      if (x.dataset.fio && ids.includes(g.id) && g.tipo !== "ponto") {
        const c = (o.fios[g.id] ??= {});
        (c as Record<string, number | undefined>)[x.dataset.fio] = valor as number | undefined;
      }
      if (x.dataset.pt && g.tipo === "ponto" && ids.includes(g.p)) {
        const c = (o.pontos[g.p] ??= { tipo: "conta", d: Math.round(o.diametro * 160) / 100, material: "diamante" });
        (c as unknown as Record<string, unknown>)[x.dataset.pt] = valor ?? c[x.dataset.pt as "d"];
      }
    }
    historico.registrar(doc);
    autosave.guardar(CHAVE, doc);
    painel();
    return;
  }
  const k = x.dataset.k;
  if (!k) return;
  if (editando && k.startsWith("ornamentos.")) {
    // durante o desenho: muda no lugar (o editor segura o mesmo esboço)
    const v = x instanceof HTMLInputElement && x.type === "checkbox" ? x.checked : x instanceof HTMLInputElement && x.type === "number" ? Number(x.value.replace(",", ".")) : x.value;
    if (typeof v === "number" && !Number.isFinite(v)) return;
    gravar(k, v);
    historico.registrar(doc);
    autosave.guardar(CHAVE, doc);
    painel();
    return;
  }
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
  if (b.dataset.esc) {
    escSel = b.dataset.esc;
    if (esculpindo) esculpir();
    else painel();
    return;
  }
  if (b.dataset.escNova) return novaEscultura(b.dataset.escNova as FormaBase);
  if (b.dataset.acao === "esc-esculpir") return esculpir();
  if (b.dataset.acao === "esc-subdividir") return subdividirEscultura();
  if (b.dataset.acao === "esc-excluir") {
    const e = escAtual();
    if (e && confirm(`Excluir a escultura "${e.nome}"?`)) {
      if (esculpindo) concluirEscultura();
      alterar(() => (doc.esculturas = doc.esculturas.filter((x) => x.id !== e.id)), true);
    }
    return;
  }
  if (b.dataset.orn) {
    ornSel = b.dataset.orn;
    if (editando) void editarOrnamento();
    else painel();
    return;
  }
  const a = b.dataset.acao;
  if (a === "orn-novo") novoOrnamento();
  else if (a === "orn-exemplo") novoOrnamento(true);
  else if (a === "orn-editar") void editarOrnamento();
  else if (a === "orn-excluir") {
    const o = ornAtual();
    if (o && confirm(`Excluir o ornamento "${o.nome}"?`)) {
      if (editando) concluirOrnamento();
      alterar(() => (doc.ornamentos = doc.ornamentos.filter((x) => x !== ornAtual())), true);
    }
  } else if (a === "biblioteca") biblioteca();
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
  {
    nome: "Anel vintage com filigrana",
    criar: () => {
      const b = docNovo();
      return {
        ...b, nome: "Anel vintage",
        aro: { ...b.aro, perfil: "meia-cana", tamanho: 14, largura: 2.2, espessura: 1.6, larguraBase: 2.0, espessuraBase: 1.5 },
        cabeca: { ...b.cabeca, gema: { lapidacao: "oval", material: "diamante", comprimento: 8, largura: 6 }, girar: 90, pontaGarra: "alongada", galeria: false, elevacao: 2.9, diamGarra: 0.9 },
        ornamentos: [ornamentoVintage("vintage", 2.2)],
      };
    },
  },
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
          { id: "esc", rotulo: "Escultura", icone: "esculpir", dica: "Escultura livre em malha: folhas, flores, relevos (pincéis com a caneta)", acao: () => { sel = "esculturas"; if (doc.esculturas.length) esculpir(); else { arvore(); painel(); } } },
          { id: "orn", rotulo: "Ornamento", icone: "filigrana", dica: "Desenhar filigrana, volutas e molduras (esboço do WJCAD envolvido no aro)", acao: () => { sel = "ornamentos"; if (doc.ornamentos.length) void editarOrnamento(); else novoOrnamento(); } },
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
  if ((e.target as HTMLElement).closest("input, select, textarea, .wj-janela")) return;
  const ctrl = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
  if (ctrl && k === "z" && !e.shiftKey) desfazer();
  else if (ctrl && (k === "y" || (k === "z" && e.shiftKey))) refazer();
  else if (ctrl && k === "a" && editando) edOrn?.ed?.selecionarTudo();
  else if (ctrl) return;
  else if (esculpindo && /^[1-6]$/.test(k)) pincel.tipo = PINCEIS[Number(k) - 1][0];
  else if (esculpindo && (k === "[" || k === "]")) { pincel.raio = Math.max(0.1, Math.min(6, pincel.raio * (k === "]" ? 1.2 : 1 / 1.2))); if (vista.esculpir) vista.esculpir.raio = pincel.raio; }
  else if (ctrl) return;
  else if (editando && edOrn?.teclado(e)) {
    /* atalhos do esboço (os mesmos do WJCAD) */
  } else if (k === "f") (editando ? edOrn?.enquadrar() : vista.enquadrar(raioJoia()));
  else return;
  e.preventDefault();
  if (esculpindo) { guardarPincel(); casca.renderizar(); painel(); }
});
// no desenho do ornamento a faixa é a do esboço do WJCAD (+ Concluir)
const renderizarCasca = casca.renderizar.bind(casca);
casca.renderizar = () => {
  renderizarCasca();
  const faixa = document.querySelector<HTMLElement>(".wj-faixa");
  if (editando && edOrn && faixa) edOrn.montarFaixa(faixa, concluirOrnamento);
  if (esculpindo && faixa) faixaEscultura(faixa);
};

/** Faixa no modo esculpir: Concluir, pincéis e alternâncias. */
function faixaEscultura(faixa: HTMLElement) {
  faixa.innerHTML = "";
  const grupo = () => faixa.appendChild(document.createElement("div")) as HTMLElement;
  const botao = (g: HTMLElement, rot: string, ic: string, dica: string, ativo: boolean, acao: () => void) => {
    const b = document.createElement("button");
    b.className = "wj-cmd";
    b.title = dica;
    b.innerHTML = `${ic}<span>${escapar(rot)}</span>`;
    b.setAttribute("aria-pressed", String(ativo));
    b.onclick = () => { acao(); casca.renderizar(); painel(); };
    g.className = "wj-grupo";
    g.append(b);
    return b;
  };
  botao(grupo(), "Concluir escultura", `<span style="font-size:22px">✓</span>`, "Volta à joia e recalcula peso e STL", false, concluirEscultura).classList.add("gd-concluir");
  const gp = grupo();
  for (const [id, rot, ic, dica] of PINCEIS) botao(gp, rot, IC[ic], dica, pincel.tipo === id, () => { pincel.tipo = id; guardarPincel(); });
  const ga = grupo();
  botao(ga, "Inverter", IC.desfazer, "Afunda em vez de levantar", pincel.inverter, () => { pincel.inverter = !pincel.inverter; guardarPincel(); });
  botao(ga, "Simetria", IC.duplicar, "Espelha o traço no X da peça", pincel.simetria, () => { pincel.simetria = !pincel.simetria; guardarPincel(); });
  botao(ga, "Dedo esculpe", IC.caneta, "Sem caneta: o dedo esculpe sobre a peça (dois dedos navegam)", pincel.dedo, () => { pincel.dedo = !pincel.dedo; guardarPincel(); if (vista.esculpir) vista.esculpir.dedo = pincel.dedo; });
  const gs = grupo();
  botao(gs, "Subdividir", IC.grade, "Mais vértices para detalhes finos (até 40 962)", false, subdividirEscultura);
  botao(gs, "Enquadrar", IC.enquadrar, "Enquadrar (F)", false, () => vista.enquadrar(raioJoia()));
}
registrarOffline();
arvore();
painel();
atualizar();
vista.enquadrar(raioJoia());
vista.vista("iso");
