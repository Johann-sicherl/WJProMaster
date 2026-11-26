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
import type { EsculturaVista, EventoPincel, ToqueVista } from "./vista";
import { gemaLivreNova, temPontas, type GemaLivre } from "./gemasLivres";
import { anelFolhasOval } from "./modelos";
import { CONTORNOS, folhaNova, perfilDeCurva, type ContornoFolha, type Folha } from "./folhas";
import { ALTURA_PERFIL, controlesFio, type FioCfg } from "./ornamento";
import { PERFIS_FIO } from "./fios";
import { alinharCamera, escalaPorMedida, LADO_MAX, referenciaNova, type P2 as PFoto } from "./referencia";
import { noMundo } from "./gemasLivres";
import { amostrar, mapaPontos } from "../esboco/geometria";
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
let resultado: { volume: number; area: number; avisos: string[]; ms: number; final: boolean; concordancia?: { acrescimo: number; grupos: number; voxels: number } } | null = null;
let erroKernel = "";

type Item = "aro" | "cabeca" | "pave" | "livres" | "folhas" | "ornamentos" | "esculturas" | "foto" | "gravacao" | "textura" | "fabricacao" | "preco";
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
// gemas livres: lista, seleção e posicionamento pelo toque na vista (caneta, dedo ou mouse)

let livreSel = "";
let posicionando = false;
const livreAtual = (): GemaLivre | undefined => doc.gemasLivres.find((g) => g.id === livreSel) ?? doc.gemasLivres[0];
const novoIdLivre = () => `l${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

function novaLivre(lap: Lapidacao = "navete") {
  const g = gemaLivreNova(novoIdLivre(), doc.gemasLivres.length + 1, lap);
  livreSel = g.id;
  sel = "livres";
  alterar(() => { doc.gemasLivresAtivo = true; doc.gemasLivres.push(g); }, true);
  vista.destacar(g.id);
}

function duplicarLivre() {
  const g = livreAtual();
  if (!g) return;
  const c: GemaLivre = { ...structuredClone(g), id: novoIdLivre(), nome: `${g.nome} (cópia)`.slice(0, 40), th: Math.max(-180, Math.min(180, g.th + 8)) };
  livreSel = c.id;
  alterar(() => doc.gemasLivres.splice(doc.gemasLivres.indexOf(g) + 1, 0, c), true);
  vista.destacar(c.id);
}

function posicionar(v = !posicionando) {
  posicionando = v;
  casca.renderizar();
  painel();
  if (v) casca.definirStatus(sel === "folhas" ? "Posicionar: toque (caneta, dedo ou mouse) na joia para levar a base da folha selecionada até lá. Arrastar continua girando a vista." : "Posicionar: toque (caneta, dedo ou mouse) na joia para levar a gema selecionada até lá; toque numa gema livre para selecioná-la. Arrastar continua girando a vista.");
  else status();
}

function aoTocarVista(t: ToqueVista) {
  if (editando || esculpindo) return;
  if (marcando?.etapa === "modelo") return marcarModelo(t);
  if (sel === "folhas") {
    const f = folhaAtual();
    if (!posicionando || !t.ponto || !f) return;
    const [x, y, z] = t.ponto;
    alterar(() => {
      f.th = Math.round((Math.atan2(x, y) * 180) / Math.PI * 10) / 10;
      f.z = Math.round(z * 100) / 100;
      if (f.pedra) delete f.pedra;
    });
    casca.avisar(`${f.nome}: θ ${fmt(f.th, 1)}°, lateral ${fmt(f.z)} mm.`);
    return;
  }
  if (t.livre) {
    livreSel = t.livre;
    vista.destacar(t.livre);
    if (sel !== "livres") selecionar("livres");
    else painel();
    return;
  }
  const g = livreAtual();
  if (!posicionando || !t.ponto || !g) return;
  const [x, y, z] = t.ponto;
  alterar(() => {
    g.th = Math.round((Math.atan2(x, y) * 180) / Math.PI * 10) / 10;
    g.z = Math.round(z * 100) / 100;
  });
  casca.avisar(`${g.nome}: θ ${fmt(g.th, 1)}°, lateral ${fmt(g.z)} mm.`);
}

// ---------------------------------------------------------------------------------------------
// folhas paramétricas (J9b)

let folhaSel = "";
const folhaAtual = (): Folha | undefined => doc.folhas.find((f) => f.id === folhaSel) ?? doc.folhas[0];
const novoIdFolha = () => `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

function novaFolha(contorno: ContornoFolha = "lanceolada", extra: Partial<Folha> = {}) {
  const f: Folha = { ...folhaNova(novoIdFolha(), doc.folhas.length + 1, contorno), ...extra };
  folhaSel = f.id;
  sel = "folhas";
  alterar(() => { doc.folhasAtivo = true; doc.folhas.push(f); }, true);
}

function duplicarFolha() {
  const f = folhaAtual();
  if (!f) return;
  const c: Folha = { ...structuredClone(f), id: novoIdFolha(), nome: `${f.nome} (cópia)`.slice(0, 40), th: Math.max(-180, Math.min(180, f.th + 8)) };
  delete c.pedra;
  folhaSel = c.id;
  alterar(() => doc.folhas.splice(doc.folhas.indexOf(f) + 1, 0, c), true);
}

/** Folha com o contorno da curva selecionada no esboço do ornamento (a curva vira guia de construção). */
function folhaDoContorno() {
  const o = ornAtual(), ids = edOrn?.selecao() ?? [];
  if (!o) return;
  const g = o.esboco.geos.find((x) => ids.includes(x.id) && x.tipo !== "ponto" && x.tipo !== "texto");
  if (!g) return casca.avisar("Selecione a curva da folha (spline fechada) no esboço.");
  const pts = amostrar(g, mapaPontos(o.esboco), Math.PI / 48);
  const r = perfilDeCurva(pts);
  if (!r) return casca.avisar("A curva é pequena ou aberta demais para virar contorno de folha.");
  // base na ponta da curva mais perto do centro do desenho; θ e lateral pela posição no esboço
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const Rref = m.R + superficie(doc.aro, 0, 0) + o.altura;
  g.construcao = true;
  edOrn?.reatar(o.esboco);
  novaFolha("personalizada", { perfil: r.perfil, comprimento: r.comprimento, largura: r.largura, th: Math.round(((cx - r.comprimento / 2) / Rref) * (180 / Math.PI) * 10) / 10, z: Math.round(cy * 100) / 100, nome: `Folha (contorno do esboço)` });
  sel = "ornamentos";
  painel();
  casca.avisar("Folha criada com o contorno (a curva virou guia de construção). Ajuste no construtor Folhas.", 6000);
}

// ---------------------------------------------------------------------------------------------
// imagem de referência (foto da joia): carregar, medir, alinhar a câmera e comparar. A foto fica só no
// arquivo (.wjgd), reduzida a 1600 px no lado maior; nada é enviado para fora do aparelho.

/** marcação em curso: medir (dois toques na foto) ou par (um toque na foto e depois no modelo) */
let marcando: { tipo: "medir" | "par"; etapa: "foto" | "modelo"; pts: PFoto[] } | null = null;
/** ver a joia pela câmera alinhada à foto (perspectiva só aqui) */
let verPelaFoto = false;
let comparando: number | null = null;
let erroAlinhar: number | null = null;

async function carregarFoto(camera = false) {
  const inp = document.createElement("input");
  inp.type = "file";
  inp.accept = "image/*";
  if (camera) inp.setAttribute("capture", "environment");
  inp.onchange = async () => {
    const f = inp.files?.[0];
    if (!f) return;
    try {
      const url = await new Promise<string>((ok, erro) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => erro(r.error); r.readAsDataURL(f); });
      const img = new Image();
      await new Promise((ok, erro) => { img.onload = ok; img.onerror = () => erro(new Error("Imagem inválida.")); img.src = url; });
      const k = Math.min(1, LADO_MAX / Math.max(img.naturalWidth, img.naturalHeight));
      const cv = document.createElement("canvas");
      cv.width = Math.round(img.naturalWidth * k);
      cv.height = Math.round(img.naturalHeight * k);
      cv.getContext("2d")!.drawImage(img, 0, 0, cv.width, cv.height);
      const dados = cv.toDataURL("image/jpeg", 0.85);
      const r = referenciaNova(dados, cv.width, cv.height);
      // tamanho inicial: a foto cobre ~1,3 vez o diâmetro da joia
      r.escala = Math.round(((2.6 * raioJoia()) / cv.width) * 1e5) / 1e5;
      sel = "foto";
      verPelaFoto = false;
      alterar(() => (doc.referencia = r), true);
      vista.vista("cima");
      casca.avisar("Foto carregada (fica só neste arquivo). Meça algo conhecido na foto para acertar a escala.", 6000);
    } catch (e) {
      casca.avisar((e as Error).message || "Não foi possível ler a imagem.", 6000);
    }
  };
  inp.click();
}

/** Ponto de referência da foto fixa: cintura da gema central ou topo do aro. */
const pontoFoto = (): [number, number, number] => (m.cabeca ? m.cabeca.ref.p : [0, m.R + superficie(doc.aro, 0, 0), 0]);

function atualizarFoto() {
  vista.definirFoto(doc.referencia, pontoFoto(), verPelaFoto);
  vista.comparar(comparando);
  edOrn?.definirFoto(doc.referencia);
  quadroFoto();
}

/** Quadro sobre a vista com a foto inteira para tocar nos pontos (medir ou marcar pares). */
function quadroFoto() {
  const q = $("#gd-foto-quadro");
  const r = doc.referencia;
  if (!marcando || marcando.etapa !== "foto" || !r) { q.hidden = true; return; }
  q.hidden = false;
  const img = $<HTMLImageElement>("img", q);
  if (img.src !== r.imagem) img.src = r.imagem;
  const W = q.clientWidth, H = q.clientHeight, k = Math.min(W / r.largura, H / r.altura), ox = (W - r.largura * k) / 2, oy = (H - r.altura * k) / 2;
  Object.assign(img.style, { left: `${ox}px`, top: `${oy}px`, width: `${r.largura * k}px`, height: `${r.altura * k}px` });
  const pts = [...marcando.pts, ...(marcando.tipo === "par" ? r.pares.map((p) => p.foto) : [])];
  $("svg", q).innerHTML = pts.map(([u, v], i) => `<g transform="translate(${(ox + u * k).toFixed(1)} ${(oy + v * k).toFixed(1)})"><circle r="9"/><path d="M-14 0H14M0-14V14"/>${marcando!.tipo === "par" && i >= marcando!.pts.length ? `<text x="11" y="-9">${i - marcando!.pts.length + 1}</text>` : ""}</g>`).join("");
  $(".gd-foto-dica", q).textContent = marcando.tipo === "medir"
    ? (marcando.pts.length ? "Toque na outra ponta da medida." : "Toque numa ponta de algo com medida conhecida (ex.: a oval de 8 mm).")
    : `Par ${r.pares.length + 1}: toque no ponto na foto (ex.: ponta da oval, centro de uma redonda).`;
}

function iniciarMarcacao(tipo: "medir" | "par") {
  if (!doc.referencia) return;
  marcando = { tipo, etapa: "foto", pts: [] };
  comparando = null;
  verPelaFoto = false;
  atualizarFoto();
  painel();
}

function pararMarcacao() {
  marcando = null;
  atualizarFoto();
  painel();
  status();
}

function tocarNaFoto(ev: PointerEvent) {
  const r = doc.referencia, mc = marcando;
  if (!r || !mc || mc.etapa !== "foto") return;
  const img = $<HTMLImageElement>("#gd-foto-quadro img").getBoundingClientRect();
  const u = ((ev.clientX - img.left) / img.width) * r.largura, v = ((ev.clientY - img.top) / img.height) * r.altura;
  if (u < 0 || v < 0 || u > r.largura || v > r.altura) return;
  mc.pts.push([Math.round(u * 10) / 10, Math.round(v * 10) / 10]);
  if (mc.tipo === "medir" && mc.pts.length === 2) {
    quadroFoto();
    const t = prompt("Medida real entre os dois pontos (mm):", "8");
    const mm = Number(String(t ?? "").replace(",", "."));
    const [a, b] = mc.pts;
    marcando = null;
    if (mm > 0) {
      try {
        const e = escalaPorMedida(a, b, mm);
        alterar(() => {
          const ref = doc.referencia!;
          ref.escala = Math.round(e * 1e6) / 1e6;
          // o meio da medida vai para o ponto de referência (centro da gema central ou topo do aro)
          ref.cx = (a[0] + b[0]) / 2;
          ref.cy = (a[1] + b[1]) / 2;
          ref.dx = ref.dy = 0;
        });
        casca.avisar(`Escala: ${fmt(mm, 2)} mm em ${fmt(Math.hypot(b[0] - a[0], b[1] - a[1]), 0)} px = ${fmt(e * 1000, 2)} µm por px.`);
      } catch (x) {
        casca.avisar((x as Error).message, 5000);
      }
    }
    atualizarFoto();
    painel();
    return;
  }
  if (mc.tipo === "par") {
    mc.etapa = "modelo";
    casca.definirStatus("Agora toque no ponto correspondente na joia (encaixa no centro ou na ponta da gema mais próxima). Arrastar gira a vista.");
  }
  quadroFoto();
}

/** Pontos notáveis do modelo para o par: centro (cintura) e pontas das gemas, topo das garras. */
function pontosNotaveis(): [number, number, number][] {
  const out: [number, number, number][] = [];
  const gemas = [...(m.cabeca ? [m.cabeca] : []), ...m.livres.map((l) => l.gema), ...m.pave, ...m.gemasOrn.map((x) => x.gema)];
  for (const g of gemas) {
    const pr = proporcoes(g.gema), y = pr.cintura;
    out.push(noMundo(g.ref, [0, y, 0]), noMundo(g.ref, [g.gema.comprimento / 2, y, 0]), noMundo(g.ref, [-g.gema.comprimento / 2, y, 0]));
    if (g.gema.largura !== g.gema.comprimento) out.push(noMundo(g.ref, [0, y, g.gema.largura / 2]), noMundo(g.ref, [0, y, -g.gema.largura / 2]));
  }
  for (const h of m.garras) out.push(h.topo);
  return out;
}

function marcarModelo(t: ToqueVista) {
  const r = doc.referencia, mc = marcando;
  if (!r || !mc || !t.tela) return;
  // encaixe no ponto notável mais perto do toque na tela (até 28 px); senão, o ponto da superfície
  let melhor: [number, number, number] | null = null, dm = 28;
  for (const p of pontosNotaveis()) {
    const [x, y] = vista.naTela(p), d = Math.hypot(x - t.tela[0], y - t.tela[1]);
    if (d < dm) { dm = d; melhor = p; }
  }
  const p = melhor ?? t.ponto;
  if (!p) return casca.avisar("Toque sobre a joia (ou perto de uma gema).");
  const foto = mc.pts[0];
  marcando = null;
  alterar(() => doc.referencia!.pares.push({ foto, modelo: [Math.round(p[0] * 1e4) / 1e4, Math.round(p[1] * 1e4) / 1e4, Math.round(p[2] * 1e4) / 1e4] }));
  casca.avisar(`Par ${doc.referencia!.pares.length} marcado${melhor ? " (encaixado na gema)" : ""}.${doc.referencia!.pares.length >= 2 ? " Toque em Alinhar câmera." : ""}`);
  atualizarFoto();
  painel();
}

function alinhar() {
  const r = doc.referencia;
  if (!r) return;
  try {
    const t0 = performance.now();
    const { camera, erro } = alinharCamera(r.pares, r.largura, r.altura, vista.cameraAtual(r.altura));
    erroAlinhar = erro;
    verPelaFoto = true;
    alterar(() => { r.camera = camera; r.modo = "camera"; });
    casca.avisar(`Câmera alinhada à foto: erro médio ${fmt(erro, 1)} px (${r.pares.length} pares, ${Math.round(performance.now() - t0)} ms).`, 5000);
  } catch (e) {
    casca.avisar((e as Error).message, 5000);
  }
}

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
  edOrn.definirFoto(doc.referencia);
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
  vista.mostrarEsculturas(true);
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
    // a joia final já traz as esculturas unidas (a malha delas só aparece na prévia e ao esculpir)
    vista.mostrarEsculturas(!r.final || !r.comEsculturas || esculpindo);
    resultado = r.final || !resultado ? { volume: r.final ? r.volume : 0, area: r.final ? r.area : 0, avisos: r.avisos, ms: r.ms, final: r.final, concordancia: r.concordancia } : { ...resultado, final: false };
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
  const outras = [...(m.cabeca ? [m.cabeca] : []), ...m.pave, ...m.gemasOrn.map((x) => x.gema)];
  vista.definirGemas([...outras, ...m.livres.map((x) => x.gema)], [...outras.map(() => undefined), ...m.livres.map((x) => x.id)]);
  if (!doc.gemasLivres.some((g) => g.id === livreSel)) livreSel = doc.gemasLivres[0]?.id ?? "";
  vista.destacar(sel === "livres" ? livreSel : "");
  vista.corMetal(LIGAS[doc.liga].cor);
  vistaEsculturas();
  atualizarFoto();
  if (resultado) resultado.final = false;
  gerar();
  status();
}

function status() {
  const ct = (m.cabeca?.ct ?? 0) + m.pave.reduce((s, g) => s + g.ct, 0) + m.gemasOrn.reduce((s, g) => s + g.gema.ct, 0) + m.livres.reduce((s, g) => s + g.gema.ct, 0);
  const pedras = (m.cabeca ? 1 : 0) + m.pave.length + m.gemasOrn.length + m.livres.length;
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
  { id: "livres", rotulo: "Gemas livres", icone: "gema", ativo: () => doc.gemasLivresAtivo, alternar: (v) => (doc.gemasLivresAtivo = v) },
  { id: "folhas", rotulo: "Folhas", icone: "esculpir", ativo: () => doc.folhasAtivo, alternar: (v) => (doc.folhasAtivo = v) },
  { id: "ornamentos", rotulo: "Ornamentos", icone: "filigrana" },
  { id: "esculturas", rotulo: "Escultura", icone: "esculpir" },
  { id: "foto", rotulo: "Foto de referência", icone: "imagem", ativo: () => !!doc.referencia?.ativo, alternar: (v) => { if (doc.referencia) doc.referencia.ativo = v; } },
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
  if (i !== sel && posicionando) posicionando = false;
  sel = i;
  if (i !== "foto" && marcando) { marcando = null; atualizarFoto(); }
  vista.destacar(i === "livres" ? livreAtual()?.id ?? "" : "");
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
    { k: "aro.afastamento", r: "Afastamento dos ramos no topo (ao longo do dedo)", u: "mm", passo: 0.1, se: () => doc.aro.dividido > 0 },
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
  livres: [],
  folhas: [],
  ornamentos: [],
  esculturas: [],
  foto: [],
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
    { k: "concordancia.ativo", r: "Concordância (transição suave entre aro, fios, folhas, garras e cabeça)", t: "chk" },
    { k: "concordancia.raio", r: "Raio de concordância", u: "mm", passo: 0.05, se: () => doc.concordancia.ativo },
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
    const c: FioCfg = o.fios[geos[0].id] ?? {};
    const f = (nome: string, rot: string, v: number | undefined, u: string, passo = 0.05) => `<label class="gd-campo"><span>${rot}</span><input type="number" step="${passo}" inputmode="decimal" data-fio="${nome}" value="${v ?? ""}" placeholder="padrão" /><em>${u}</em></label>`;
    const perfil = c.perfil ?? "redondo";
    const d0 = c.d0 ?? o.diametro, ctrl = c.controles?.length ? controlesFio(c, d0, c.d1 ?? d0, c.a0 ?? o.altura, c.a1 ?? c.a0 ?? o.altura) : null;
    h += `<h4>${geos.length} fio(s) selecionado(s)</h4>
      <label class="gd-campo"><span>Perfil</span><select data-fio="perfil">${PERFIS_FIO.map(([k2, r]) => `<option value="${k2}" ${k2 === perfil ? "selected" : ""}>${r}</option>`).join("")}</select><em></em></label>
      ${ctrl ? "" : `${f("d0", perfil === "redondo" ? "Ø no início" : "Largura no início", c.d0, "mm")}${f("d1", perfil === "redondo" ? "Ø no fim" : "Largura no fim", c.d1, "mm")}
      ${perfil !== "redondo" ? `${f("h0", "Altura da seção no início", c.h0, "mm")}${f("h1", "Altura da seção no fim", c.h1, "mm")}` : ""}
      ${f("a0", "Altura sobre o aro no início", c.a0, "mm")}${f("a1", "Altura sobre o aro no fim", c.a1, "mm")}
      ${perfil !== "redondo" ? `${f("i0", "Inclinação no início", c.i0, "°", 5)}${f("i1", "Inclinação no fim", c.i1, "°", 5)}` : ""}`}
      ${ctrl ? `<table class="gd-tabela gd-ctrl"><thead><tr><th>Ponto (%)</th><th>${perfil === "redondo" ? "Ø" : "Larg."}</th>${perfil !== "redondo" ? "<th>Alt. seção</th>" : ""}<th>Altura</th>${perfil !== "redondo" ? "<th>Incl. °</th>" : ""}<th></th></tr></thead><tbody>
        ${ctrl.map((x, i) => `<tr><td><input type="number" step="5" inputmode="decimal" data-ctrl="${i}:u" value="${Math.round(x.u * 100)}" /></td><td><input type="number" step="0.05" inputmode="decimal" data-ctrl="${i}:d" value="${x.d}" /></td>${perfil !== "redondo" ? `<td><input type="number" step="0.05" inputmode="decimal" data-ctrl="${i}:h" value="${x.h ?? ""}" /></td>` : ""}<td><input type="number" step="0.05" inputmode="decimal" data-ctrl="${i}:a" value="${x.a}" /></td>${perfil !== "redondo" ? `<td><input type="number" step="5" inputmode="decimal" data-ctrl="${i}:i" value="${x.i ?? 0}" /></td>` : ""}<td>${ctrl.length > 2 ? `<button data-ctrl-del="${i}" title="Tirar o ponto">${IC.apagar}</button>` : ""}</td></tr>`).join("")}</tbody></table>` : ""}
      <div class="gd-botoes"><button data-acao="ctrl-novo">${IC.novo} Ponto de controle</button>${ctrl ? `<button data-acao="ctrl-limpar">${IC.apagar} Só início e fim</button>` : ""}</div>
      ${f("torcao", perfil === "redondo" && !c.trancado ? "Torção (voltas; vale para perfis não redondos e trançado)" : "Torção (voltas ao longo do fio)", c.torcao, "", 0.25)}
      <label class="gd-check"><input type="checkbox" data-fio="trancado" ${c.trancado ? "checked" : ""}/> Trançado (dois fios torcidos um no outro, Ø = largura)</label>
      <label class="gd-campo"><span>Subir livre até um apoio</span><select data-fio="subir">${([["nenhum", "Não (apoiado na superfície)"], ["inicio", "Início"], ["fim", "Fim"], ["ambos", "Início e fim"]] as [string, string][]).map(([k2, r]) => `<option value="${k2}" ${(c.subir ?? "nenhum") === k2 ? "selected" : ""}>${r}</option>`).join("")}</select><em></em></label>
      ${f("concordancia", "Raio de concordância do fio (vazio = o global)", c.concordancia, "mm")}
      <p class="gd-nota">Vazio = valor padrão do ornamento. A ponta que sobe vai até a garra, gema ou folha mais próxima (até 4 mm) e encaixa nela.</p>
      <div class="gd-botoes"><button data-acao="folha-contorno">${IC.esculpir} Folha com este contorno</button></div>`;
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
      : `<input data-k="${c.k}" type="number" inputmode="decimal" step="${c.passo ?? 0.1}" value="${v === undefined ? "" : Number(v)}" ${v === undefined ? 'placeholder="padrão"' : ""} />`;
  return `<label class="gd-campo"><span>${escapar(c.r)}</span>${ctrl}<em>${c.u ?? ""}</em></label>`;
}

function camposLivre(i: number): Campo[] {
  const k = (c: string) => `gemasLivres.${i}.${c}`;
  const g = doc.gemasLivres[i], red = () => g.gema.lapidacao === "redonda", garras = () => g.engaste === "garras";
  return [
    { k: k("nome"), r: "Nome", t: "txt" },
    { k: k("gema.lapidacao"), r: "Lapidação", t: "sel", ops: opLap, estrutura: true },
    { k: k("gema.material"), r: "Gema", t: "sel", ops: opMat },
    { k: k("gema.largura"), r: "Diâmetro", u: "mm", passo: 0.05, se: red },
    { k: k("gema.comprimento"), r: "Comprimento", u: "mm", passo: 0.05, se: () => !red() },
    { k: k("gema.largura"), r: "Largura", u: "mm", passo: 0.05, se: () => !red() },
    { k: k("th"), r: "Posição ao longo do aro (0° = topo)", u: "°", passo: 1 },
    { k: k("z"), r: "Lateral (ao longo do dedo)", u: "mm", passo: 0.1 },
    { k: k("refAltura"), r: "Altura medida", t: "sel", ops: () => [["aro", "Sobre a superfície do aro"], ["central", "Relativa à cintura da gema central"]] },
    { k: k("altura"), r: "Altura da cintura", u: "mm", passo: 0.05 },
    { k: k("giro"), r: "Giro no plano (0° = ao longo do aro, 90° = ao longo do dedo)", u: "°", passo: 5, se: () => !red() },
    { k: k("inclinacao"), r: "Inclinação (positivo baixa a ponta)", u: "°", passo: 2 },
    { k: k("seguir"), r: "Seguir a superfície do aro (eixo na normal)", t: "chk" },
    { k: k("engaste"), r: "Engaste", t: "sel", ops: () => [["garras", "Garras"], ["inglesa", "Inglesa (aro fechado)"]], estrutura: true },
    { k: k("pontasV"), r: "Garras em V protegendo as pontas", t: "chk", se: () => garras() && temPontas(g.gema.lapidacao), estrutura: true },
    { k: k("laterais"), r: "Garras laterais (0, 2 ou 4)", passo: 2, se: () => garras() && g.pontasV && temPontas(g.gema.lapidacao) },
    { k: k("garras"), r: "Nº de garras", passo: 1, se: () => garras() && !(g.pontasV && temPontas(g.gema.lapidacao)) },
    { k: k("diamGarra"), r: "Diâmetro da garra", u: "mm", passo: 0.05, se: garras },
    { k: k("pontaGarra"), r: "Ponta da garra", t: "sel", ops: () => [["bolinha", "Bolinha"], ["alongada", "Alongada (sobre a pedra)"], ["dupla", "Garra dupla"]], se: garras },
    { k: k("parede"), r: "Parede da inglesa", u: "mm", passo: 0.05, se: () => !garras() },
    { k: k("simetria"), r: "Simetria", t: "sel", ops: () => [["nenhuma", "Nenhuma"], ["x", "Esquerda ↔ direita"], ["y", "Frente ↔ trás"], ["xy", "Dois eixos"]] },
  ];
}

function camposFolha(i: number): Campo[] {
  const k = (c: string) => `folhas.${i}.${c}`;
  const f = doc.folhas[i], livre = () => !f.pedra;
  return [
    { k: k("nome"), r: "Nome", t: "txt" },
    { k: k("contorno"), r: "Contorno", t: "sel", ops: () => CONTORNOS.filter(([c]) => c !== "personalizada" || f.contorno === "personalizada" || !!f.perfil) },
    { k: k("comprimento"), r: "Comprimento", u: "mm", passo: 0.1 },
    { k: k("largura"), r: "Largura", u: "mm", passo: 0.05 },
    { k: k("ponta"), r: "Ponta", t: "sel", ops: () => [["aguda", "Aguda"], ["arredondada", "Arredondada"]] },
    { k: k("nervura"), r: "Nervura central", t: "sel", ops: () => [["vinco", "Vinco"], ["saliente", "Saliente"], ["nenhuma", "Nenhuma"]] },
    { k: k("profNervura"), r: "Profundidade/altura da nervura", u: "mm", passo: 0.02, se: () => f.nervura !== "nenhuma" },
    { k: k("dobra"), r: "Dobra ao longo da nervura (+ levanta as bordas)", u: "°", passo: 5 },
    { k: k("curvatura"), r: "Curvatura no comprimento (ponta + sobe, − desce)", u: "mm", passo: 0.05 },
    { k: k("espessura"), r: "Espessura", u: "mm", passo: 0.05 },
    { k: k("borda"), r: "Borda", t: "sel", ops: () => [["arredondada", "Arredondada"], ["viva", "Viva"]] },
    { k: k("pedra"), r: "Folha com pedra (a gema assenta na folha)", t: "sel", ops: () => [["", "Nenhuma"], ...doc.gemasLivres.map((g) => [g.id, g.nome] as [string, string])], estrutura: true },
    { k: k("th"), r: "Posição ao longo do aro (0° = topo)", u: "°", passo: 1, se: livre },
    { k: k("z"), r: "Lateral (ao longo do dedo)", u: "mm", passo: 0.1, se: livre },
    { k: k("refAltura"), r: "Altura medida", t: "sel", ops: () => [["aro", "Sobre a superfície do aro"], ["central", "Relativa à cintura da gema central"]], se: livre },
    { k: k("altura"), r: f.pedra ? "Altura sob a cintura da pedra" : "Altura da base", u: "mm", passo: 0.05 },
    { k: k("giro"), r: "Giro no plano (0° = ao longo do aro)", u: "°", passo: 5, se: livre },
    { k: k("inclinacao"), r: "Inclinação (positivo baixa a ponta)", u: "°", passo: 2, se: livre },
    { k: k("seguir"), r: "Seguir a superfície do aro", t: "chk", se: livre },
    { k: k("simetria"), r: "Simetria", t: "sel", ops: () => [["nenhuma", "Nenhuma"], ["x", "Esquerda ↔ direita"], ["y", "Frente ↔ trás"], ["xy", "Dois eixos"]], se: livre },
    { k: k("concordancia"), r: "Raio de concordância desta folha (vazio = o global)", u: "mm", passo: 0.05 },
  ];
}

function camposFoto(): Campo[] {
  const r = doc.referencia!;
  return [
    { k: "referencia.opacidade", r: "Opacidade", passo: 0.05 },
    { k: "referencia.frente", r: "Por cima do modelo (semitransparente); desligado = por trás", t: "chk" },
    { k: "referencia.modo", r: "Modo", t: "sel", ops: () => [["vista", "Fixa numa vista"], ...(r.camera ? [["camera", "Câmera alinhada à foto"] as [string, string]] : [])] },
    { k: "referencia.vista", r: "Vista", t: "sel", ops: () => [["cima", "Cima"], ["frente", "Frente"], ["lado", "Lado"]], se: () => r.modo === "vista" },
    { k: "referencia.escala", r: "Escala (mm por px)", passo: 0.0005, se: () => r.modo === "vista" },
    { k: "referencia.giro", r: "Girar a foto", u: "°", passo: 1, se: () => r.modo === "vista" },
    { k: "referencia.dx", r: "Deslocar na horizontal", u: "mm", passo: 0.1, se: () => r.modo === "vista" },
    { k: "referencia.dy", r: "Deslocar na vertical", u: "mm", passo: 0.1, se: () => r.modo === "vista" },
  ];
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
  } else if (sel === "livres") {
    const g = livreAtual();
    const i = g ? doc.gemasLivres.indexOf(g) : -1;
    const copias = (id: string) => m.livres.filter((x) => x.id === id).length;
    extra = `<p class="gd-nota">Qualquer lapidação num ponto livre, girada e inclinada, com garras próprias (as hastes descem até o aro, um ramo, um fio de ornamento ou uma garra da central) ou inglesa. Toque numa gema na vista para selecioná-la.</p>
      <div class="gd-lista">${doc.gemasLivres.map((x) => `<label class="gd-check ${x.id === g?.id ? "gd-atual" : ""}"><input type="checkbox" data-livre-ativo="${x.id}" ${x.ativo ? "checked" : ""} /><button data-livre="${x.id}">${escapar(x.nome)}${copias(x.id) > 1 ? ` <small>×${copias(x.id)}</small>` : ""}</button></label>`).join("") || `<p class="gd-nota">Nenhuma gema livre.</p>`}</div>
      <div class="gd-botoes"><label class="gd-campo gd-curto"><span>Nova</span><select data-livre-lap>${opLap().map(([k2, r]) => `<option value="${k2}" ${k2 === "navete" ? "selected" : ""}>${escapar(r)}</option>`).join("")}</select><em></em></label><button data-acao="livre-nova">${IC.novo} Nova gema</button></div>
      ${g ? `<div class="gd-botoes"><button data-acao="livre-posicionar" class="${posicionando ? "destaque" : ""}" aria-pressed="${posicionando}">${IC.movimento} ${posicionando ? "Posicionando: toque na joia" : "Posicionar tocando na vista"}</button><button data-acao="livre-duplicar">${IC.duplicar} Duplicar</button><button data-acao="livre-excluir">${IC.apagar} Excluir</button></div>
      <label class="gd-campo"><span>Peso da gema</span><input data-ct-livre type="number" step="0.005" inputmode="decimal" value="${(Math.round(quilates(g.gema) * 1000) / 1000).toString()}" /><em>ct</em></label>
      ${camposLivre(i).map(campoHtml).join("")}` : ""}`;
  } else if (sel === "folhas") {
    const f = folhaAtual();
    const i = f ? doc.folhas.indexOf(f) : -1;
    const copias = (id: string) => m.folhas.filter((x) => x.id === id).length;
    extra = `<p class="gd-nota">Folha paramétrica de fundição: contorno, nervura, dobra, curvatura e espessura constante (≥ mínimo da liga: ${fmt(LIGAS[doc.liga].garraMin, 2)} mm). "Folha com pedra": a gema livre assenta na folha e as garras se apoiam nela.</p>
      <div class="gd-lista">${doc.folhas.map((x) => `<label class="gd-check ${x.id === f?.id ? "gd-atual" : ""}"><input type="checkbox" data-folha-ativo="${x.id}" ${x.ativo ? "checked" : ""} /><button data-folha="${x.id}">${escapar(x.nome)}${copias(x.id) > 1 ? ` <small>×${copias(x.id)}</small>` : ""}</button></label>`).join("") || `<p class="gd-nota">Nenhuma folha.</p>`}</div>
      <div class="gd-botoes"><label class="gd-campo gd-curto"><span>Nova</span><select data-folha-contorno>${CONTORNOS.filter(([c]) => c !== "personalizada").map(([k2, r]) => `<option value="${k2}">${escapar(r)}</option>`).join("")}</select><em></em></label><button data-acao="folha-nova">${IC.novo} Nova folha</button></div>
      ${f ? `<div class="gd-botoes"><button data-acao="folha-posicionar" class="${posicionando ? "destaque" : ""}" aria-pressed="${posicionando}">${IC.movimento} ${posicionando ? "Posicionando: toque na joia" : "Posicionar tocando na vista"}</button><button data-acao="folha-duplicar">${IC.duplicar} Duplicar</button><button data-acao="folha-excluir">${IC.apagar} Excluir</button></div>
      ${f.espessura < LIGAS[doc.liga].garraMin - 1e-9 ? `<p class="gd-aviso">Espessura abaixo do mínimo da liga (${fmt(LIGAS[doc.liga].garraMin, 2)} mm).</p>` : ""}
      ${camposFolha(i).map(campoHtml).join("")}` : ""}
      <p class="gd-nota">Contorno personalizado: no esboço do ornamento, desenhe a folha com uma spline fechada, selecione e toque em "Folha com este contorno".</p>`;
  } else if (sel === "foto") {
    const r = doc.referencia;
    extra = !r
      ? `<p class="gd-nota">Ponha a foto da joia como referência: ela fica só neste arquivo, nunca é enviada para fora do aparelho.</p>
        <div class="gd-botoes"><button data-acao="foto-galeria" class="destaque">${IC.imagem} Galeria ou arquivo</button><button data-acao="foto-camera">${IC.imagem} Câmera</button></div>`
      : `<p class="gd-nota">Foto ${r.largura} × ${r.altura} px (fica só neste arquivo). ${r.modo === "vista" ? "Fixa na vista: meça algo conhecido para acertar a escala." : "Câmera alinhada: a vista usa a perspectiva da foto."}</p>
        <div class="gd-botoes"><button data-acao="foto-medir" class="${marcando?.tipo === "medir" ? "destaque" : ""}">${IC.cota} Medir na foto (escala)</button><button data-acao="foto-galeria">${IC.imagem} Trocar foto</button><button data-acao="foto-remover">${IC.apagar} Remover</button></div>
        ${camposFoto().map(campoHtml).join("")}
        <h4>Alinhar a câmera à foto</h4>
        <p class="gd-nota">Marque 2 a 4 pares: um ponto na foto e o mesmo ponto na joia (pontas da oval, centro das redondas). Com 4 pares a câmera acerta também o campo de visão.</p>
        <div class="gd-botoes"><button data-acao="foto-par" class="${marcando?.tipo === "par" ? "destaque" : ""}">${IC.novo} Marcar par (${r.pares.length})</button>${r.pares.length ? `<button data-acao="foto-limpar">${IC.apagar} Limpar pares</button>` : ""}${r.pares.length >= 2 ? `<button data-acao="foto-alinhar" class="destaque">${IC.enquadrar} Alinhar câmera</button>` : ""}</div>
        ${r.camera ? `<label class="gd-check"><input type="checkbox" data-foto-camera ${verPelaFoto ? "checked" : ""}/> Ver pela câmera da foto (perspectiva)</label>${erroAlinhar !== null ? `<p class="gd-nota">Erro médio do alinhamento: ${fmt(erroAlinhar, 1)} px.</p>` : ""}` : ""}
        ${marcando ? `<div class="gd-botoes"><button data-acao="foto-parar">${IC.fechar} Parar de marcar</button></div>` : ""}
        <h4>Comparar</h4>
        <label class="gd-campo"><span>Modelo ↔ foto</span><input type="range" data-comparar min="0" max="1" step="0.05" value="${comparando ?? 0.5}" /><em>${comparando === null ? "" : `${Math.round(comparando * 100)} %`}</em></label>
        <div class="gd-botoes"><button data-acao="foto-alternar">${IC.girar} Alternar modelo × foto</button>${comparando !== null ? `<button data-acao="foto-comparar-fim">${IC.fechar} Parar de comparar</button>` : ""}</div>`;
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
    ${it.alternar && !it.ativo!() && !(sel === "foto" && !doc.referencia) ? `<p class="gd-nota">Desligado. <button data-ligar>Ligar</button></p>` : CAMPOS[sel].map(campoHtml).join("") + extra + (it.alternar && !(sel === "foto" && !doc.referencia) ? `<div class="gd-botoes"><button data-desligar>Desligar ${it.rotulo.toLowerCase()}</button></div>` : "")}</section>
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
      ${doc.concordancia.ativo ? `<dt>Concordância</dt><dd>${resultado?.final && resultado.concordancia ? `R ${fmt(doc.concordancia.raio)} mm · +${fmt(resultado.concordancia.acrescimo, 2)} mm³ ✓` : `R ${fmt(doc.concordancia.raio)} mm · ${resultado?.final ? "—" : "na versão final"}`}</dd>` : ""}
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
  if (x.dataset.ctLivre !== undefined) {
    const g = livreAtual(), ct = Number(x.value.replace(",", "."));
    if (!g || !(ct > 0)) return;
    alterar(() => {
      const k = Math.cbrt(ct / quilates(g.gema));
      g.gema.comprimento = Math.round(g.gema.comprimento * k * 100) / 100;
      g.gema.largura = Math.round(g.gema.largura * k * 100) / 100;
    });
    return;
  }
  if (x.dataset.livreAtivo) {
    const alvo = doc.gemasLivres.find((q) => q.id === x.dataset.livreAtivo);
    if (alvo) alterar(() => (alvo.ativo = (x as HTMLInputElement).checked));
    return;
  }
  if (x.dataset.livreLap !== undefined) return;
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
  if (x.dataset.folhaAtivo) {
    const alvo = doc.folhas.find((q) => q.id === x.dataset.folhaAtivo);
    if (alvo) alterar(() => (alvo.ativo = (x as HTMLInputElement).checked));
    return;
  }
  if (x.dataset.folhaContorno !== undefined) return;
  if (x.dataset.fotoCamera !== undefined) {
    verPelaFoto = (x as HTMLInputElement).checked;
    if (verPelaFoto && doc.referencia) doc.referencia.modo = "camera";
    atualizarFoto();
    painel();
    return;
  }
  if (x.dataset.comparar !== undefined) return;
  if (o && x.dataset.ctrl) {
    // ponto de controle do fio: "i:campo"
    const [i, campo] = x.dataset.ctrl.split(":");
    const ids = edOrn?.selecao() ?? [];
    const v = Number(x.value.replace(",", "."));
    if (!Number.isFinite(v)) return;
    for (const g of o.esboco.geos) {
      if (!ids.includes(g.id) || g.tipo === "ponto") continue;
      const c = o.fios[g.id];
      const ct = c?.controles?.[Number(i)];
      if (!ct) continue;
      (ct as unknown as Record<string, number>)[campo] = campo === "u" ? Math.min(1, Math.max(0, v / 100)) : v;
    }
    historico.registrar(doc);
    autosave.guardar(CHAVE, doc);
    painel();
    return;
  }
  if (o && (x.dataset.fio || x.dataset.pt)) {
    const ids = edOrn?.selecao() ?? [];
    const texto = x.dataset.pt === "tipo" || x.dataset.pt === "material" || x.dataset.fio === "perfil" || x.dataset.fio === "subir";
    const valor = x.dataset.fio === "trancado" ? (x as HTMLInputElement).checked || undefined : x.value.trim() === "" ? undefined : texto ? x.value : Number(x.value.replace(",", "."));
    if (typeof valor === "number" && !Number.isFinite(valor)) return;
    if (typeof valor === "number" && !(valor >= 0) && !["a0", "a1", "i0", "i1", "torcao"].includes(x.dataset.fio ?? "")) return;
    for (const g of o.esboco.geos) {
      if (x.dataset.fio && ids.includes(g.id) && g.tipo !== "ponto") {
        const c = (o.fios[g.id] ??= {});
        (c as Record<string, unknown>)[x.dataset.fio] = valor;
        if (valor === undefined || (x.dataset.fio === "perfil" && valor === "redondo") || (x.dataset.fio === "subir" && valor === "nenhum")) delete (c as Record<string, unknown>)[x.dataset.fio];
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
  // opcionais: raio de concordância por peça (vazio = o global) e a pedra da folha ("" = nenhuma)
  if ((/\.concordancia$/.test(k) && x.value.trim() === "") || (/^folhas\.\d+\.pedra$/.test(k) && !x.value)) {
    alterar(() => { const ps = k.split("."); const alvo = ps.slice(0, -1).reduce<any>((q, c) => q[c], doc); delete alvo[ps[ps.length - 1]]; }, true);
    return;
  }
  const v = x instanceof HTMLInputElement && x.type === "checkbox" ? x.checked : x instanceof HTMLInputElement && x.type === "number" ? Number(x.value.replace(",", ".")) : x.value;
  if (typeof v === "number" && !Number.isFinite(v)) return;
  if (k === "referencia.modo" && v === "camera") verPelaFoto = true;
  if (k === "referencia.modo" && v === "vista") verPelaFoto = false;
  alterar(() => {
    gravar(k, v);
    const lv = /^gemasLivres\.(\d+)\.gema\.lapidacao$/.exec(k);
    if (lv) {
      const g = doc.gemasLivres[Number(lv[1])], lap = LAPIDACOES[v as Lapidacao];
      const w = Math.min(g.gema.comprimento, g.gema.largura);
      g.gema.largura = w;
      g.gema.comprimento = Math.round(w * lap.relacao * 100) / 100;
      g.pontasV = temPontas(v as Lapidacao);
      g.garras = lap.garras;
    }
    if (k === "cabeca.gema.lapidacao") {
      const lap = LAPIDACOES[v as Lapidacao], g = doc.cabeca.gema;
      const w = Math.min(g.comprimento, g.largura);
      g.largura = w;
      g.comprimento = Math.round(w * lap.relacao * 100) / 100;
      doc.cabeca.garras = lap.garras;
    }
    if (k === "aro.largura" && doc.aro.larguraBase > (v as number)) doc.aro.larguraBase = v as number;
    if (k === "aro.espessura" && doc.aro.espessuraBase > (v as number)) doc.aro.espessuraBase = v as number;
  }, k === "textura.tipo" || k === "referencia.modo");
});
// comparar: a mistura muda ao arrastar (sem histórico)
props.addEventListener("input", (e) => {
  const x = e.target as HTMLInputElement;
  if (x.dataset.comparar === undefined) return;
  comparando = Number(x.value);
  vista.comparar(comparando);
  const em = x.parentElement?.querySelector("em");
  if (em) em.textContent = `${Math.round(comparando * 100)} %`;
});
props.addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest("button");
  if (!b) return;
  if (b.dataset.ligar !== undefined || b.dataset.desligar !== undefined) return alterar(() => ITENS.find((i) => i.id === sel)!.alternar!(b.dataset.ligar !== undefined), true);
  if (b.dataset.livre) {
    livreSel = b.dataset.livre;
    vista.destacar(livreSel);
    painel();
    return;
  }
  if (b.dataset.folha) {
    folhaSel = b.dataset.folha;
    painel();
    return;
  }
  if (b.dataset.ctrlDel) {
    const o = ornAtual(), ids = edOrn?.selecao() ?? [];
    if (o) for (const g of o.esboco.geos) if (ids.includes(g.id)) o.fios[g.id]?.controles?.splice(Number(b.dataset.ctrlDel), 1);
    historico.registrar(doc);
    autosave.guardar(CHAVE, doc);
    return painel();
  }
  switch (b.dataset.acao) {
    case "folha-nova": return novaFolha((props.querySelector<HTMLSelectElement>("[data-folha-contorno]")?.value as ContornoFolha) || "lanceolada");
    case "folha-duplicar": return duplicarFolha();
    case "folha-posicionar": return posicionar();
    case "folha-excluir": {
      const f = folhaAtual();
      if (f && confirm(`Excluir a folha "${f.nome}"?`)) alterar(() => (doc.folhas = doc.folhas.filter((x) => x.id !== f.id)), true);
      return;
    }
    case "folha-contorno": return folhaDoContorno();
    case "ctrl-novo":
    case "ctrl-limpar": {
      const o = ornAtual(), ids = edOrn?.selecao() ?? [];
      if (!o) return;
      for (const g of o.esboco.geos) {
        if (!ids.includes(g.id) || g.tipo === "ponto" || g.construcao) continue;
        const c = (o.fios[g.id] ??= {});
        if (b.dataset.acao === "ctrl-limpar") { delete c.controles; continue; }
        const d0 = c.d0 ?? o.diametro, a0 = c.a0 ?? o.altura;
        const lista = controlesFio(c, d0, c.d1 ?? d0, a0, c.a1 ?? a0);
        // ponto novo no meio do maior trecho, com os valores interpolados
        let k = 0;
        for (let i = 0; i + 1 < lista.length; i++) if (lista[i + 1].u - lista[i].u > lista[k + 1].u - lista[k].u) k = i;
        const A = lista[k], B = lista[k + 1], med = (p: number, q: number) => Math.round(((p + q) / 2) * 100) / 100;
        lista.splice(k + 1, 0, { u: med(A.u, B.u), d: med(A.d, B.d), h: med(A.h ?? A.d * ALTURA_PERFIL[c.perfil ?? "redondo"], B.h ?? B.d * ALTURA_PERFIL[c.perfil ?? "redondo"]), a: med(A.a, B.a), i: med(A.i ?? 0, B.i ?? 0) });
        c.controles = lista;
      }
      historico.registrar(doc);
      autosave.guardar(CHAVE, doc);
      return painel();
    }
    case "foto-galeria": return void carregarFoto(false);
    case "foto-camera": return void carregarFoto(true);
    case "foto-remover":
      if (confirm("Remover a foto de referência deste arquivo?")) { marcando = null; comparando = null; verPelaFoto = false; alterar(() => (doc.referencia = null), true); }
      return;
    case "foto-medir": return iniciarMarcacao("medir");
    case "foto-par": return iniciarMarcacao("par");
    case "foto-parar": return pararMarcacao();
    case "foto-limpar": erroAlinhar = null; return alterar(() => { doc.referencia!.pares = []; });
    case "foto-alinhar": return alinhar();
    case "foto-alternar":
      comparando = comparando === null || comparando < 0.5 ? 1 : 0;
      vista.comparar(comparando);
      return painel();
    case "foto-comparar-fim":
      comparando = null;
      vista.comparar(null);
      return painel();
  }
  if (b.dataset.acao === "livre-nova") return novaLivre((props.querySelector<HTMLSelectElement>("[data-livre-lap]")?.value as Lapidacao) || "navete");
  if (b.dataset.acao === "livre-duplicar") return duplicarLivre();
  if (b.dataset.acao === "livre-posicionar") return posicionar();
  if (b.dataset.acao === "livre-excluir") {
    const g = livreAtual();
    if (g && confirm(`Excluir a gema livre "${g.nome}"?`)) alterar(() => (doc.gemasLivres = doc.gemasLivres.filter((x) => x.id !== g.id)), true);
    return;
  }
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
  { nome: "Anel folhas com oval", criar: anelFolhasOval },
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

/** Vista padrão: sai da câmera da foto (volta à ortográfica). */
function mudarVista(v: "iso" | "frente" | "lado" | "cima") {
  if (verPelaFoto) { verPelaFoto = false; atualizarFoto(); if (sel === "foto") painel(); }
  vista.vista(v);
}

async function imagem() {
  const b = await vista.imagem();
  if (b) baixar(b, doc.nome, "png", "image/png");
}

// ---------------------------------------------------------------------------------------------
// casca e início

const vista = new VistaJoia($("#gd-vista"));
vista.aoTocar = aoTocarVista;
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
          { id: "livres", rotulo: "Gemas livres", icone: "gema", dica: "Gema de qualquer lapidação num ponto livre, com garras próprias ou inglesa", acao: () => (doc.gemasLivres.length ? selecionar("livres") : novaLivre()) },
          { id: "folhas", rotulo: "Folhas", icone: "esculpir", dica: "Folha paramétrica de fundição (contorno, nervura, dobra, curvatura, espessura), também sob uma pedra", acao: () => (doc.folhas.length ? selecionar("folhas") : novaFolha()) },
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
        [{ id: "cab", rotulo: "Gema central", icone: "garras", acao: () => selecionar("cabeca") }, { id: "pv", rotulo: "Pedras do pavé", icone: "pave", acao: () => selecionar("pave") }, { id: "lv", rotulo: "Gemas livres", icone: "gema", acao: () => selecionar("livres") }],
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
          { id: "iso", rotulo: "Isométrica", icone: "enquadrar", acao: () => mudarVista("iso") },
          { id: "fr", rotulo: "Frente", icone: "anel", acao: () => mudarVista("frente") },
          { id: "ld", rotulo: "Lado", icone: "anel", acao: () => mudarVista("lado") },
          { id: "ci", rotulo: "Cima", icone: "anel", acao: () => mudarVista("cima") },
        ],
        [
          { id: "enq", rotulo: "Enquadrar", icone: "enquadrar", dica: "Enquadrar (F)", acao: () => vista.enquadrar(raioJoia()) },
          { id: "gir", rotulo: "Girar", icone: "girar", dica: "Girar sem parar (apresentação)", ativo: () => vista.estaGirando, acao: () => { vista.girar(!vista.estaGirando); casca.renderizar(); } },
          { id: "img", rotulo: "Imagem", icone: "imagem", dica: "Salvar a vista como imagem PNG", acao: () => void imagem() },
        ],
        [
          { id: "foto", rotulo: "Foto", icone: "imagem", dica: "Foto de referência da joia (fica só no arquivo)", acao: () => (doc.referencia ? selecionar("foto") : void carregarFoto(false)) },
          { id: "cmp", rotulo: "Comparar", icone: "girar", dica: "Alternar modelo × foto no mesmo ângulo", acao: () => { if (!doc.referencia) return casca.avisar("Carregue uma foto de referência primeiro."); comparando = comparando === null || comparando < 0.5 ? 1 : 0; vista.comparar(comparando); selecionar("foto"); } },
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
$("#gd-foto-quadro").addEventListener("pointerup", (e) => tocarNaFoto(e));
new ResizeObserver(() => quadroFoto()).observe($("#gd-vista"));
// testes de interface (só no servidor de desenvolvimento): projeção de pontos e estado
if (import.meta.env.DEV) void import("./referencia").then((r) => ((window as any).__wjgd = { vista, doc: () => doc, montagem: () => m, notaveis: pontosNotaveis, projetar: r.projetar, olharPara: r.olharPara }));
registrarOffline();
arvore();
painel();
atualizar();
vista.enquadrar(raioJoia());
vista.vista("iso");
