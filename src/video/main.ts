// WJVideoMaker — editor de vídeo (V1). Fluxo de editor de vídeo de consumo: mídia à esquerda,
// visualizador no meio, propriedades à direita e linha do tempo embaixo (pista principal magnética
// de vídeos e fotos + pista de textos). Cortar (dividir/aparar), reduzir o tempo, acelerar e
// desacelerar, juntar vídeos e fotos, texto sobre a imagem e exportar MP4 (com redução de tamanho).
// Motor puro em projeto.ts; desenho do quadro em desenho.ts; prévia em previa.ts; exportação no
// Worker exportar-worker.ts. Mídia: do aparelho ou do cofre do WJPDM (cópia no app, midias.ts).

import { $, aplicarDispositivo, autosave, baixar, Casca, el, escapar, escolherArquivo, Historico, janela, menu, registrarOffline, salvarArquivo } from "../comum/casca";
import { IC } from "../comum/icones";
import { escolherDoCofre, exportarComo, lerBlobDoCofre } from "../comum/cofre";
import "./video.css";
import { caixaDoTexto } from "./desenho";
import { arquivoDaMidia, importarMidia, relocalizar } from "./midias";
import { Previa } from "./previa";
import {
  adicionarTexto, ajustarDuracao, apararNoCursor, AUDIO_BPS, definirDuracaoFoto, definirTempoTexto, definirTrecho, definirVelocidade, dimensoes, dividir,
  duplicarClipe, duracaoClipe, duracaoTotal, excluirClipe, excluirTexto, inserirMidia, linhaDoTempo, localizar, moverClipe, novoId, POSICOES_TEXTO, projetoNovo,
  PROPORCOES, taxaParaTamanho, taxaVideo, tamanhoEstimadoMb, textosEm, validarProjeto, VELOCIDADES, type Midia, type Projeto, type Proporcao,
  type Qualidade, type Texto,
} from "./projeto";
import { codigoDeTempo, duracaoDoQuadro, duracaoLegivel, encaixarNoQuadro, FPS_PADRAO } from "./tempo";
import type { PedidoExportar, RespostaExportar } from "./exportar-worker";

const CHAVE = "wjvid:documento";
const EXTS_COFRE = ["mp4", "mov", "m4v", "webm", "mkv", "jpg", "jpeg", "png", "webp", "gif", "avif"];

// projeto novo: vertical (9:16) no celular, horizontal (16:9) no tablet e no computador
const proporcaoPadrao = (): Proporcao => (aplicarDispositivo() === "celular" ? "9:16" : "16:9");
let proj: Projeto = validarProjeto(autosave.ler<unknown>(CHAVE)) ?? projetoNovo("Vídeo sem título", proporcaoPadrao());
const historico = new Historico<Projeto>();
historico.limpar(proj);
type Selecao = { tipo: "clipe" | "texto"; id: string } | null;
let sel: Selecao = null;
/** Pixels por segundo na linha do tempo. */
let zoom = 40;
/** Mídias cujo arquivo não está neste aparelho. */
const ausentes = new Set<string>();
const miniaturas = new Map<string, string>();

// ---------------- estado e histórico ----------------

function guardar() {
  autosave.guardar(CHAVE, proj);
}

/** Depois de cada mudança: guarda, registra no desfazer e redesenha. */
function mudou(registrar = true) {
  if (sel?.tipo === "clipe" && !proj.clipes.some((c) => c.id === sel!.id)) sel = null;
  if (sel?.tipo === "texto" && !proj.textos.some((t) => t.id === sel!.id)) sel = null;
  guardar();
  if (registrar) historico.registrar(proj);
  const total = duracaoTotal(proj);
  if (previa.tempo > total) previa.tempo = total;
  renderizarTudo();
  void previa.mostrar();
}

function trocarProjeto(p: Projeto) {
  previa.pausar();
  proj = p;
  sel = null;
  previa.tempo = 0;
  historico.limpar(proj);
  guardar();
  ajustarZoom();
  void conferirMidias();
  ajustarPalco();
  mudou(false);
}

const clipeSel = () => (sel?.tipo === "clipe" ? proj.clipes.find((c) => c.id === sel!.id) ?? null : null);
const textoSel = () => (sel?.tipo === "texto" ? proj.textos.find((t) => t.id === sel!.id) ?? null : null);
const midiaDe = (id: string) => proj.midias.find((m) => m.id === id);
const seg = (us: number) => Math.round(us / 1000) / 1000;
const fmtS = (us: number) => (us / 1e6).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const velTexto = (v: number) => `${v.toLocaleString("pt-BR", { maximumFractionDigits: 3 })}×`;

// ---------------- prévia ----------------

const canvas = $<HTMLCanvasElement>("#vm-previa");
const previa = new Previa(canvas, () => proj, async (id) => {
  const f = await arquivoDaMidia(id);
  if (!f) ausentes.add(id);
  return f;
});
previa.aoMudarTempo = () => atualizarCursor();
previa.aoParar = () => renderizarTransporte();
previa.aoFaltarMidia = () => renderizarBiblioteca();

/** Tamanho do canvas: proporção do projeto, nítido na tela (até 1080 no lado menor). */
function ajustarPalco() {
  const palco = $("#vm-palco");
  const r = palco.getBoundingClientRect();
  const [a, b] = PROPORCOES.find((x) => x.id === proj.proporcao)!.razao;
  const e = Math.min((r.width - 16) / a, (r.height - 16) / b);
  const w = Math.max(40, a * e), h = Math.max(40, b * e);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  const dpr = Math.min(2, devicePixelRatio || 1);
  const [W, H] = dimensoes(proj.proporcao, Math.min(1080, Math.round(Math.min(w, h) * dpr)));
  previa.dimensionar(W, H);
}
new ResizeObserver(() => ajustarPalco()).observe($("#vm-palco"));

// arrastar texto no visualizador
canvas.addEventListener("pointerdown", (e) => {
  const r = canvas.getBoundingClientRect();
  const px = ((e.clientX - r.left) / r.width) * canvas.width, py = ((e.clientY - r.top) / r.height) * canvas.height;
  const ctx = canvas.getContext("2d")!;
  const visiveis = textosEm(proj, previa.tempo).reverse();
  const alvo = visiveis.find((t) => {
    const c = caixaDoTexto(ctx, canvas.width, canvas.height, t);
    return px >= c.x && px <= c.x + c.w && py >= c.y && py <= c.y + c.h;
  });
  if (!alvo) {
    if (sel) {
      sel = null;
      renderizarTudo();
    }
    return;
  }
  previa.pausar();
  sel = { tipo: "texto", id: alvo.id };
  renderizarTudo();
  const x0 = alvo.x, y0 = alvo.y, cx = e.clientX, cy = e.clientY;
  canvas.setPointerCapture(e.pointerId);
  let moveu = false;
  const mover = (ev: PointerEvent) => {
    const dx = (ev.clientX - cx) / r.width, dy = (ev.clientY - cy) / r.height;
    if (!moveu && Math.hypot(ev.clientX - cx, ev.clientY - cy) < 4) return;
    moveu = true;
    alvo.x = Math.max(0, Math.min(1, x0 + dx));
    alvo.y = Math.max(0, Math.min(1, y0 + dy));
    void previa.mostrar();
  };
  const soltar = () => {
    canvas.removeEventListener("pointermove", mover);
    canvas.removeEventListener("pointerup", soltar);
    canvas.removeEventListener("pointercancel", soltar);
    if (moveu) mudou();
  };
  canvas.addEventListener("pointermove", mover);
  canvas.addEventListener("pointerup", soltar);
  canvas.addEventListener("pointercancel", soltar);
});

// ---------------- transporte ----------------

function renderizarTransporte() {
  const t = $("#vm-transporte");
  const bt = (a: string, ic: string, dica: string, extra = "") => `<button class="wj-ic" data-t="${a}" title="${dica}" aria-label="${dica}" ${extra}>${ic}</button>`;
  t.innerHTML = `${bt("inicio", IC.inicioFilme, "Início (Home)")}${bt("ant", "◀", "Quadro anterior (←)")}
    ${bt("tocar", previa.tocando ? IC.pausar : IC.rodar, previa.tocando ? "Pausar (Espaço)" : "Tocar (Espaço)", 'class="wj-ic vm-tocar"')}
    ${bt("prox", "▶", "Próximo quadro (→)")}${bt("fim", IC.fimFilme, "Fim (End)")}
    <span class="vm-tempo" id="vm-tempo"></span>`;
  t.querySelectorAll<HTMLButtonElement>("[data-t]").forEach((b) => (b.onclick = () => transporte(b.dataset.t!)));
  atualizarCursor();
}

function transporte(a: string) {
  const q = duracaoDoQuadro(proj.fps);
  if (a === "tocar") {
    if (previa.tocando) previa.pausar();
    else previa.tocar();
    renderizarTransporte();
  } else if (a === "inicio") void previa.buscar(0);
  else if (a === "fim") void previa.buscar(duracaoTotal(proj));
  else if (a === "ant") void previa.buscar(encaixarNoQuadro(previa.tempo, proj.fps) - q);
  else if (a === "prox") void previa.buscar(encaixarNoQuadro(previa.tempo, proj.fps) + q);
}

function atualizarCursor() {
  const tempo = document.getElementById("vm-tempo");
  if (tempo) tempo.textContent = `${codigoDeTempo(previa.tempo, proj.fps)} / ${codigoDeTempo(duracaoTotal(proj), proj.fps)}`;
  const cursor = document.getElementById("vm-cursor");
  if (cursor) {
    const x = (previa.tempo / 1e6) * zoom;
    cursor.style.transform = `translateX(${x}px)`;
    // acompanha o cursor tocando
    const rolo = $("#vm-rolo");
    if (previa.tocando && (x < rolo.scrollLeft || x > rolo.scrollLeft + rolo.clientWidth - 40)) rolo.scrollLeft = Math.max(0, x - 60);
  }
}

// ---------------- biblioteca ----------------

async function miniatura(m: Midia): Promise<string | null> {
  if (miniaturas.has(m.id)) return miniaturas.get(m.id)!;
  const f = await arquivoDaMidia(m.id);
  if (!f) return null;
  const cv = document.createElement("canvas");
  cv.width = 160;
  cv.height = 90;
  const g = cv.getContext("2d")!;
  g.fillStyle = "#000";
  g.fillRect(0, 0, 160, 90);
  try {
    let fonte: CanvasImageSource, sw: number, sh: number;
    let liberar = () => {};
    if (m.tipo === "imagem") {
      const b = await createImageBitmap(f, { resizeWidth: 320, resizeQuality: "low" });
      fonte = b;
      sw = b.width;
      sh = b.height;
      liberar = () => b.close();
    } else {
      const v = document.createElement("video");
      v.muted = true;
      v.preload = "auto";
      const url = URL.createObjectURL(f);
      v.src = url;
      await new Promise<void>((ok) => {
        v.addEventListener("loadeddata", () => ok(), { once: true });
        v.addEventListener("error", () => ok(), { once: true });
        setTimeout(ok, 5000);
      });
      v.currentTime = Math.min(1, (m.duracaoUs / 1e6) * 0.1);
      await new Promise<void>((ok) => {
        v.addEventListener("seeked", () => ok(), { once: true });
        setTimeout(ok, 3000);
      });
      fonte = v;
      sw = v.videoWidth;
      sh = v.videoHeight;
      liberar = () => {
        v.removeAttribute("src");
        v.load();
        URL.revokeObjectURL(url);
      };
    }
    if (sw && sh) {
      const e = Math.max(160 / sw, 90 / sh);
      g.drawImage(fonte, (160 - sw * e) / 2, (90 - sh * e) / 2, sw * e, sh * e);
    }
    liberar();
  } catch {
    /* sem miniatura */
  }
  const url = cv.toDataURL("image/jpeg", 0.7);
  miniaturas.set(m.id, url);
  return url;
}

function renderizarBiblioteca() {
  const b = $("#vm-biblioteca");
  const usos = (id: string) => proj.clipes.filter((c) => c.midia === id).length;
  b.innerHTML = `<header class="vm-cab"><b>Mídia</b><span>${proj.midias.length}</span></header>
    <div class="vm-importar">
      <button data-imp="aparelho" class="destaque" title="Vídeos e fotos do aparelho (galeria, câmera, Downloads, pendrive)">${IC.importar}<span>Do aparelho</span></button>
      <button data-imp="cofre" title="Vídeos e fotos guardados no cofre do WJPDM">${IC.pasta}<span>Do WJPDM</span></button>
    </div>
    <div class="vm-midias">${proj.midias.length ? "" : `<p class="vm-dica">Importe vídeos e fotos. Toque numa mídia para pôr na linha do tempo.</p>`}
    ${proj.midias.map((m) => `<button class="vm-midia${ausentes.has(m.id) ? " ausente" : ""}" data-m="${m.id}" title="${escapar(m.nome)}">
        <img alt="" data-mini="${m.id}" />
        <span class="vm-tipo">${m.tipo === "imagem" ? IC.imagem : IC.filme}</span>
        ${m.tipo === "video" ? `<span class="vm-dur">${duracaoLegivel(m.duracaoUs)}</span>` : ""}
        <span class="vm-nome">${escapar(m.nome)}</span>
        ${ausentes.has(m.id) ? `<span class="vm-falta">Fora deste aparelho · Localizar…</span>` : usos(m.id) ? `<span class="vm-usos">${usos(m.id)}× na linha</span>` : ""}
      </button>`).join("")}</div>`;
  b.querySelector<HTMLButtonElement>('[data-imp="aparelho"]')!.onclick = () => $<HTMLInputElement>("#vm-entrada").click();
  b.querySelector<HTMLButtonElement>('[data-imp="cofre"]')!.onclick = () => void importarDoCofre();
  b.querySelectorAll<HTMLButtonElement>("[data-m]").forEach((x) => {
    const m = midiaDe(x.dataset.m!)!;
    x.onclick = () => (ausentes.has(m.id) ? localizarMidia(m) : colocarNaLinha(m));
    x.oncontextmenu = (e) => {
      e.preventDefault();
      menu(e.clientX, e.clientY, [
        { rotulo: "Pôr na linha do tempo", icone: "mais", acao: () => colocarNaLinha(m) },
        { rotulo: "Trocar o arquivo (Localizar…)", icone: "localizar", acao: () => localizarMidia(m) },
        { rotulo: "Tirar do projeto", icone: "apagar", acao: () => tirarMidia(m) },
      ]);
    };
  });
  for (const m of proj.midias)
    void miniatura(m).then((u) => {
      const img = b.querySelector<HTMLImageElement>(`[data-mini="${m.id}"]`);
      if (img && u) img.src = u;
    });
}

/** Põe a mídia logo depois do clipe selecionado (ou no fim). */
function colocarNaLinha(m: Midia) {
  const c = clipeSel();
  const i = c ? proj.clipes.indexOf(c) + 1 : proj.clipes.length;
  const novo = inserirMidia(proj, m, i);
  sel = { tipo: "clipe", id: novo.id };
  const inicio = linhaDoTempo(proj).find((x) => x.clipe.id === novo.id)!.inicio;
  previa.tempo = inicio;
  mudou();
  casca.avisar(`${m.nome} na linha do tempo.`);
}

function tirarMidia(m: Midia) {
  const n = proj.clipes.filter((c) => c.midia === m.id).length;
  if (n && !confirm(`${m.nome} está ${n}× na linha do tempo. Tirar do projeto junto com esses clipes?`)) return;
  proj.clipes = proj.clipes.filter((c) => c.midia !== m.id);
  proj.midias = proj.midias.filter((x) => x.id !== m.id);
  mudou();
}

async function importar(lista: { dados: Blob; nome: string }[]) {
  if (!lista.length) return;
  const estavaVazio = !proj.clipes.length;
  const erros: string[] = [];
  let n = 0;
  for (const [i, a] of lista.entries()) {
    casca.avisar(`Importando ${i + 1} de ${lista.length}: ${a.nome}…`, 60000);
    try {
      // mesma mídia (nome + tamanho) já no projeto: reaproveita
      const ja = proj.midias.find((m) => m.nome === a.nome && m.tamanho === a.dados.size);
      const m = ja ?? (await importarMidia(a.dados, a.nome));
      if (!ja) proj.midias.push(m);
      inserirMidia(proj, m);
      n++;
    } catch (e) {
      erros.push((e as Error).message);
    }
  }
  // primeira mídia (ou vídeo maior que a tela): a linha do tempo mostra o vídeo inteiro
  if (estavaVazio || (duracaoTotal(proj) / 1e6) * zoom > $("#vm-rolo").clientWidth - 40) ajustarZoom();
  mudou();
  if (erros.length) janela("Alguns arquivos não entraram", `<ul class="vm-erros">${erros.map((x) => `<li>${escapar(x)}</li>`).join("")}</ul>`);
  if (n) casca.avisar(`${n} mídia${n > 1 ? "s" : ""} na linha do tempo.`);
}

$<HTMLInputElement>("#vm-entrada").onchange = (e) => {
  const inp = e.target as HTMLInputElement;
  const arqs = Array.from(inp.files ?? []).map((f) => ({ dados: f as Blob, nome: f.name }));
  inp.value = "";
  void importar(arqs);
};

async function importarDoCofre() {
  const a = await escolherDoCofre("video", "Importar vídeo ou foto do WJPDM", EXTS_COFRE, "Vídeos e fotos", "Importar");
  if (!a) return;
  const r = await lerBlobDoCofre(a.id);
  if (!r) return casca.avisar(`${a.nome}: conteúdo não encontrado no cofre deste aparelho.`, 6000);
  await importar([{ dados: r.dados, nome: a.nome }]);
}

function localizarMidia(m: Midia) {
  const inp = el("input", { type: "file", accept: m.tipo === "imagem" ? "image/*" : "video/*" }) as HTMLInputElement;
  inp.onchange = async () => {
    const f = inp.files?.[0];
    if (!f) return;
    if (f.size !== m.tamanho && !confirm(`${f.name} tem tamanho diferente de ${m.nome}. Usar mesmo assim?`)) return;
    await relocalizar(m, f);
    ausentes.delete(m.id);
    miniaturas.delete(m.id);
    previa.esquecer(m.id);
    mudou(false);
    casca.avisar(`${m.nome}: arquivo encontrado.`);
  };
  inp.click();
}

async function conferirMidias() {
  ausentes.clear();
  for (const m of proj.midias) if (!(await arquivoDaMidia(m.id))) ausentes.add(m.id);
  renderizarBiblioteca();
  renderizarLinha();
}

// ---------------- linha do tempo ----------------

function ajustarZoom() {
  const largura = Math.max(300, $("#vm-rolo").clientWidth - 60);
  const total = duracaoTotal(proj) / 1e6;
  zoom = total > 0 ? Math.max(2, Math.min(400, largura / total)) : 40;
}

function renderizarLinha() {
  const rolo = $("#vm-rolo");
  const total = duracaoTotal(proj);
  const largura = Math.max(rolo.clientWidth, (total / 1e6) * zoom + 120);
  const passo = [0.1, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600].find((s) => s * zoom >= 70) ?? 600;
  const marcas: string[] = [];
  for (let s = 0; s * zoom <= largura; s += passo) {
    const rotulo = s >= 60 ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}` : `${(Math.round(s * 10) / 10).toLocaleString("pt-BR")} s`;
    marcas.push(`<span class="vm-marca" style="left:${s * zoom}px">${rotulo}</span>`);
  }
  const clipes = linhaDoTempo(proj).map(({ clipe: c, inicio, fim }) => {
    const m = midiaDe(c.midia);
    const w = Math.max(6, ((fim - inicio) / 1e6) * zoom);
    const selecionado = sel?.tipo === "clipe" && sel.id === c.id;
    return `<div class="vm-clipe${m?.tipo === "imagem" ? " foto" : ""}${selecionado ? " sel" : ""}${m && ausentes.has(m.id) ? " ausente" : ""}" data-c="${c.id}" style="left:${(inicio / 1e6) * zoom}px;width:${w}px">
      <span class="vm-alca ini" data-alca="ini"></span>
      <span class="vm-rot">${m?.tipo === "imagem" ? IC.imagem : IC.filme}<b>${escapar(m?.nome ?? "?")}</b>${c.velocidade !== 1 ? `<em>${velTexto(c.velocidade)}</em>` : ""}${m?.tipo === "video" && c.volume === 0 ? `<i>${IC.semSom}</i>` : ""}</span>
      <span class="vm-alca fim" data-alca="fim"></span></div>`;
  }).join("");
  const textos = proj.textos.map((t) => {
    const selecionado = sel?.tipo === "texto" && sel.id === t.id;
    return `<div class="vm-txt${selecionado ? " sel" : ""}" data-x="${t.id}" style="left:${(t.inicioUs / 1e6) * zoom}px;width:${Math.max(6, (t.duracaoUs / 1e6) * zoom)}px">
      <span class="vm-alca ini" data-alca="ini"></span><span class="vm-rot">T <b>${escapar(t.texto.split("\n")[0] || "(vazio)")}</b></span><span class="vm-alca fim" data-alca="fim"></span></div>`;
  }).join("");
  rolo.innerHTML = `<div class="vm-conteudo" style="width:${largura}px">
      <div class="vm-regua" data-regua>${marcas.join("")}</div>
      <div class="vm-pista vm-pista-txt" aria-label="Textos">${textos}</div>
      <div class="vm-pista vm-pista-video" aria-label="Vídeos e fotos">${clipes || `<span class="vm-vazia">Importe vídeos e fotos (à esquerda): eles entram aqui, um depois do outro.</span>`}</div>
      <div class="vm-cursor" id="vm-cursor"><span></span></div>
      <div class="vm-insercao" id="vm-insercao" hidden></div>
    </div>`;
  atualizarCursor();
}

/** Tempo (µs) no ponto x da tela, dentro da linha do tempo. */
const tempoEmX = (clientX: number) => {
  const rolo = $("#vm-rolo");
  const r = rolo.getBoundingClientRect();
  return Math.max(0, ((clientX - r.left + rolo.scrollLeft) / zoom) * 1e6);
};

// toque/clique na linha do tempo: buscar, selecionar, mover, aparar
$("#vm-rolo").addEventListener("pointerdown", (e) => {
  const alvo = e.target as HTMLElement;
  const rolo = $("#vm-rolo");
  const bloco = alvo.closest<HTMLElement>("[data-c],[data-x]");
  const alca = alvo.closest<HTMLElement>("[data-alca]")?.dataset.alca as "ini" | "fim" | undefined;
  const regua = !!alvo.closest("[data-regua]") || !!alvo.closest(".vm-cursor");
  if (e.button === 2) return;
  if (!bloco) {
    if (!regua && e.pointerType === "touch") return; // dedo no fundo das pistas rola a linha do tempo
    previa.pausar();
    renderizarTransporte();
    rolo.setPointerCapture(e.pointerId);
    void previa.buscar(tempoEmX(e.clientX));
    const arrastar = (ev: PointerEvent) => void previa.buscar(tempoEmX(ev.clientX));
    const soltar = () => {
      rolo.removeEventListener("pointermove", arrastar);
      rolo.removeEventListener("pointerup", soltar);
      rolo.removeEventListener("pointercancel", soltar);
    };
    rolo.addEventListener("pointermove", arrastar);
    rolo.addEventListener("pointerup", soltar);
    rolo.addEventListener("pointercancel", soltar);
    return;
  }
  e.preventDefault();
  previa.pausar();
  const ehClipe = !!bloco.dataset.c;
  const id = (bloco.dataset.c ?? bloco.dataset.x)!;
  sel = { tipo: ehClipe ? "clipe" : "texto", id };
  renderizarTudo();
  renderizarTransporte();
  const x0 = e.clientX, y0 = e.clientY;
  const c0 = ehClipe ? { ...proj.clipes.find((c) => c.id === id)! } : null;
  const t0 = !ehClipe ? { ...proj.textos.find((t) => t.id === id)! } : null;
  let modo: "nada" | "aparar" | "mover" | "menu" = "nada";
  let destino = -1;
  const longo = setTimeout(() => {
    if (modo !== "nada") return;
    modo = "menu";
    menuDoBloco(x0, y0);
  }, 600);
  rolo.setPointerCapture(e.pointerId);
  const mover = (ev: PointerEvent) => {
    const dx = ev.clientX - x0;
    if (modo === "nada" && Math.hypot(dx, ev.clientY - y0) < 6) return;
    if (modo === "menu") return;
    clearTimeout(longo);
    if (modo === "nada") modo = alca ? "aparar" : "mover";
    const dUs = (dx / zoom) * 1e6;
    if (ehClipe && c0) {
      if (modo === "aparar") {
        if (alca === "ini") definirTrecho(proj, id, c0.entradaUs + dUs * c0.velocidade, c0.saidaUs);
        else definirTrecho(proj, id, c0.entradaUs, c0.saidaUs + dUs * c0.velocidade);
        renderizarLinha();
        renderizarPropriedades();
      } else {
        // mover: posição de inserção pelo meio dos outros clipes
        const t = tempoEmX(ev.clientX);
        const outros = linhaDoTempo(proj).filter((x) => x.clipe.id !== id);
        destino = outros.filter((x) => (x.inicio + x.fim) / 2 < t).length;
        const marca = $("#vm-insercao");
        const xMarca = destino < outros.length ? outros[destino].inicio : (outros[outros.length - 1]?.fim ?? 0);
        const idxAtual = proj.clipes.findIndex((c) => c.id === id);
        const xReal = destino >= idxAtual ? xMarca + duracaoClipe(c0) : xMarca;
        marca.hidden = false;
        marca.style.left = `${(Math.min(xReal, duracaoTotal(proj)) / 1e6) * zoom}px`;
        bloco.classList.add("arrastando");
        bloco.style.transform = `translateX(${dx}px)`;
      }
    } else if (t0) {
      if (modo === "aparar" && alca === "ini") definirTempoTexto(proj, id, t0.inicioUs + dUs, t0.duracaoUs - dUs);
      else if (modo === "aparar") definirTempoTexto(proj, id, t0.inicioUs, t0.duracaoUs + dUs);
      else definirTempoTexto(proj, id, t0.inicioUs + dUs, t0.duracaoUs);
      renderizarLinha();
      renderizarPropriedades();
    }
    void previa.mostrar();
  };
  const soltar = () => {
    clearTimeout(longo);
    rolo.removeEventListener("pointermove", mover);
    rolo.removeEventListener("pointerup", soltar);
    rolo.removeEventListener("pointercancel", soltar);
    if (modo === "mover" && ehClipe && destino >= 0) moverClipe(proj, id, destino);
    if (modo === "nada") {
      // toque simples: leva o cursor para onde tocou dentro do bloco
      void previa.buscar(tempoEmX(x0));
      return;
    }
    if (modo !== "menu") mudou();
  };
  rolo.addEventListener("pointermove", mover);
  rolo.addEventListener("pointerup", soltar);
  rolo.addEventListener("pointercancel", soltar);
});
$("#vm-rolo").addEventListener("contextmenu", (e) => {
  e.preventDefault();
  if ((e.target as HTMLElement).closest("[data-c],[data-x]")) menuDoBloco(e.clientX, e.clientY);
});
$("#vm-rolo").addEventListener("wheel", (e) => {
  if (!e.ctrlKey) return;
  e.preventDefault();
  zoomEm(e.deltaY < 0 ? 1.25 : 0.8, e.clientX);
}, { passive: false });

function zoomEm(fator: number, clientX?: number) {
  const rolo = $("#vm-rolo");
  const r = rolo.getBoundingClientRect();
  const x = (clientX ?? r.left + rolo.clientWidth / 2) - r.left;
  const t = (rolo.scrollLeft + x) / zoom;
  zoom = Math.max(2, Math.min(400, zoom * fator));
  renderizarLinha();
  rolo.scrollLeft = Math.max(0, t * zoom - x);
}

function menuDoBloco(x: number, y: number) {
  if (sel?.tipo === "clipe")
    menu(x, y, [
      { rotulo: "Dividir no cursor (S)", icone: "dividirClipe", acao: () => cmdDividir() },
      { rotulo: "Aparar início até o cursor (Q)", icone: "apararInicio", acao: () => cmdAparar("inicio") },
      { rotulo: "Aparar fim a partir do cursor (W)", icone: "apararFim", acao: () => cmdAparar("fim") },
      "-",
      ...VELOCIDADES.filter((v) => v !== 1).map((v) => ({ rotulo: `Velocidade ${velTexto(v)}`, icone: "velocidade" as const, acao: () => cmdVelocidade(v) })),
      { rotulo: "Velocidade normal (1×)", icone: "velocidade", acao: () => cmdVelocidade(1) },
      "-",
      { rotulo: "Duplicar", icone: "duplicar", acao: () => cmdDuplicar() },
      { rotulo: "Excluir (Delete)", icone: "apagar", acao: () => cmdExcluir() },
    ]);
  else if (sel?.tipo === "texto")
    menu(x, y, [
      { rotulo: "Duplicar texto", icone: "duplicar", acao: () => cmdDuplicar() },
      { rotulo: "Excluir texto (Delete)", icone: "apagar", acao: () => cmdExcluir() },
    ]);
}

// ---------------- comandos ----------------

function cmdDividir() {
  previa.pausar();
  const novo = dividir(proj, previa.tempo);
  if (!novo) return casca.avisar("Dividir: ponha o cursor dentro de um clipe (a pelo menos um quadro das pontas).");
  sel = { tipo: "clipe", id: novo.id };
  mudou();
}

function cmdAparar(lado: "inicio" | "fim") {
  previa.pausar();
  const loc = localizar(proj, previa.tempo);
  const c = clipeSel() ?? loc?.clipe;
  if (!c || !apararNoCursor(proj, c.id, lado, previa.tempo)) return casca.avisar("Aparar: ponha o cursor dentro do clipe que quer aparar.");
  sel = { tipo: "clipe", id: c.id };
  // depois de aparar o início, o cursor fica no começo do que sobrou
  if (lado === "inicio") previa.tempo = linhaDoTempo(proj).find((x) => x.clipe.id === c.id)!.inicio;
  mudou();
}

function cmdExcluir() {
  if (sel?.tipo === "clipe") excluirClipe(proj, sel.id);
  else if (sel?.tipo === "texto") excluirTexto(proj, sel.id);
  else return casca.avisar("Selecione um clipe ou texto na linha do tempo.");
  sel = null;
  mudou();
}

function cmdDuplicar() {
  if (sel?.tipo === "clipe") {
    const c = duplicarClipe(proj, sel.id);
    if (c) sel = { tipo: "clipe", id: c.id };
  } else if (sel?.tipo === "texto") {
    const t = textoSel()!;
    const novo: Texto = { ...t, id: novoId(), inicioUs: t.inicioUs + t.duracaoUs };
    proj.textos.push(novo);
    sel = { tipo: "texto", id: novo.id };
  } else return;
  mudou();
}

function cmdMover(d: -1 | 1) {
  const c = clipeSel();
  if (!c) return casca.avisar("Selecione um clipe para mover.");
  const i = proj.clipes.indexOf(c);
  if (moverClipe(proj, c.id, i + d)) mudou();
}

function cmdVelocidade(v: number) {
  const c = clipeSel() ?? localizar(proj, previa.tempo)?.clipe;
  if (!c) return casca.avisar("Selecione um clipe de vídeo.");
  if (midiaDe(c.midia)?.tipo === "imagem") return casca.avisar("Foto não tem velocidade: mude a duração no painel à direita.");
  definirVelocidade(proj, c.id, v);
  sel = { tipo: "clipe", id: c.id };
  mudou();
  casca.avisar(`Velocidade ${velTexto(c.velocidade)}: o clipe passa a durar ${duracaoLegivel(duracaoClipe(c))}.`);
}

function cmdSom() {
  const c = clipeSel();
  if (!c || midiaDe(c.midia)?.tipo !== "video") return casca.avisar("Selecione um clipe de vídeo.");
  c.volume = c.volume === 0 ? 1 : 0;
  mudou();
}

function cmdTexto() {
  previa.pausar();
  const t = adicionarTexto(proj, previa.tempo);
  sel = { tipo: "texto", id: t.id };
  mudou();
  setTimeout(() => document.querySelector<HTMLTextAreaElement>("#vm-props textarea")?.select(), 50);
}

function mudarTexto(f: (t: Texto) => void) {
  const t = textoSel();
  if (!t) return casca.avisar("Selecione um texto (na pista de textos ou tocando nele no vídeo).");
  f(t);
  mudou();
}

// ---------------- propriedades ----------------

function campoTempo(rotulo: string, us: number, chave: string, dica = "") {
  return `<label class="vm-campo">${rotulo}<span><input type="number" step="0.01" min="0" inputmode="decimal" data-campo="${chave}" value="${seg(us)}" /> s</span>${dica ? `<small>${dica}</small>` : ""}</label>`;
}

function renderizarPropriedades() {
  const p = $("#vm-props");
  const c = clipeSel();
  const t = textoSel();
  if (c) {
    const m = midiaDe(c.midia)!;
    const foto = m.tipo === "imagem";
    p.innerHTML = `<header class="vm-cab"><b>${foto ? "Foto" : "Clipe de vídeo"}</b></header>
      <p class="vm-nome-midia">${escapar(m.nome)}</p>
      ${foto ? campoTempo("Duração na tela", c.saidaUs, "duracaoFoto")
        : `${campoTempo("Começa no vídeo em", c.entradaUs, "entrada", `vídeo original: ${fmtS(m.duracaoUs)} s`)}
           ${campoTempo("Termina no vídeo em", c.saidaUs, "saida")}
           <label class="vm-campo">Velocidade<span><select data-campo="velPreset">${VELOCIDADES.map((v) => `<option value="${v}"${v === c.velocidade ? " selected" : ""}>${velTexto(v)}</option>`).join("")}${VELOCIDADES.includes(c.velocidade) ? "" : `<option selected value="${c.velocidade}">${velTexto(c.velocidade)}</option>`}</select>
             <input type="number" step="0.05" min="0.1" max="10" inputmode="decimal" data-campo="vel" value="${c.velocidade}" /> ×</span><small>acima de 1 acelera e encurta; abaixo de 1 é câmera lenta</small></label>
           ${campoTempo("Duração na linha do tempo", duracaoClipe(c), "duracao", "mudar aqui ajusta a velocidade (reduz o tempo sem cortar)")}
           <label class="vm-campo">Volume<span><input type="range" min="0" max="200" step="5" data-campo="volume" value="${Math.round(c.volume * 100)}" ${m.temAudio ? "" : "disabled"} /> <b>${m.temAudio ? `${Math.round(c.volume * 100)}%` : "sem som"}</b></span></label>`}
      <div class="vm-acoes">
        <button data-acao="dividir">${IC.dividirClipe}<span>Dividir</span></button>
        <button data-acao="duplicar">${IC.duplicar}<span>Duplicar</span></button>
        <button data-acao="excluir">${IC.apagar}<span>Excluir</span></button>
      </div>`;
  } else if (t) {
    p.innerHTML = `<header class="vm-cab"><b>Texto</b></header>
      <label class="vm-campo">Texto<textarea rows="3" data-campo="texto">${escapar(t.texto)}</textarea></label>
      ${campoTempo("Aparece em", t.inicioUs, "tInicio")}
      ${campoTempo("Fica na tela por", t.duracaoUs, "tDuracao")}
      <label class="vm-campo">Posição<span>${POSICOES_TEXTO.map((x) => `<button data-pos="${x.id}">${x.nome}</button>`).join("")}</span><small>ou arraste o texto no vídeo</small></label>
      <label class="vm-campo">Tamanho<span><input type="range" min="2" max="25" step="0.5" data-campo="tamanho" value="${Math.round(t.tamanho * 1000) / 10}" /> <b>${Math.round(t.tamanho * 1000) / 10}%</b></span></label>
      <label class="vm-campo">Cor<span><input type="color" data-campo="cor" value="${t.cor}" />
        <label class="vm-check"><input type="checkbox" data-campo="negrito" ${t.negrito ? "checked" : ""} /> Negrito</label></span></label>
      <label class="vm-campo">Faixa atrás do texto<span><label class="vm-check"><input type="checkbox" data-campo="fundo" ${t.fundo ? "checked" : ""} /> Mostrar</label>
        <input type="color" data-campo="corFundo" value="${t.corFundo}" ${t.fundo ? "" : "disabled"} /></span></label>
      <div class="vm-acoes"><button data-acao="duplicar">${IC.duplicar}<span>Duplicar</span></button><button data-acao="excluir">${IC.apagar}<span>Excluir</span></button></div>`;
  } else {
    const total = duracaoTotal(proj);
    p.innerHTML = `<header class="vm-cab"><b>Projeto</b></header>
      <label class="vm-campo">Formato do vídeo<span><select data-campo="proporcao">${PROPORCOES.map((r) => `<option value="${r.id}"${r.id === proj.proporcao ? " selected" : ""}>${r.nome}</option>`).join("")}</select></span></label>
      <label class="vm-campo">Quadros por segundo<span><select data-campo="fps">${FPS_PADRAO.map((f) => `<option value="${f.fps.join("/")}"${f.fps.join("/") === proj.fps.join("/") ? " selected" : ""}>${f.nome}</option>`).join("")}</select></span></label>
      <p class="vm-resumo">Duração: <b>${duracaoLegivel(total)}</b><br>${proj.clipes.length} clipe(s), ${proj.textos.length} texto(s)</p>
      <p class="vm-dica">Toque num clipe ou texto da linha do tempo para editar.<br>Atalhos: Espaço toca, S divide, Q/W aparam, Delete exclui, ←/→ andam um quadro.</p>`;
  }
  ligarPropriedades(p);
}

function ligarPropriedades(p: HTMLElement) {
  const c = clipeSel();
  p.querySelectorAll<HTMLButtonElement>("[data-acao]").forEach((b) => {
    b.onclick = () => ({ dividir: cmdDividir, duplicar: cmdDuplicar, excluir: cmdExcluir })[b.dataset.acao as "dividir"]();
  });
  p.querySelectorAll<HTMLButtonElement>("[data-pos]").forEach((b) => {
    b.onclick = (e) => {
      e.preventDefault();
      const pos = POSICOES_TEXTO.find((x) => x.id === b.dataset.pos)!;
      mudarTexto((t) => ((t.x = pos.x), (t.y = pos.y)));
    };
  });
  p.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("[data-campo]").forEach((inp) => {
    const k = inp.dataset.campo!;
    const valor = () => parseFloat(String(inp.value).replace(",", "."));
    const aoMudar = () => {
      const v = valor();
      const us = Math.round(v * 1e6);
      switch (k) {
        case "duracaoFoto":
          if (c && v > 0) definirDuracaoFoto(proj, c.id, us);
          break;
        case "entrada":
          if (c && v >= 0) definirTrecho(proj, c.id, us, c.saidaUs);
          break;
        case "saida":
          if (c && v > 0) definirTrecho(proj, c.id, c.entradaUs, us);
          break;
        case "vel":
        case "velPreset":
          if (c && v > 0) definirVelocidade(proj, c.id, v);
          break;
        case "duracao":
          if (c && v > 0) ajustarDuracao(proj, c.id, us);
          break;
        case "volume":
          if (c) c.volume = v / 100;
          break;
        case "proporcao":
          proj.proporcao = inp.value as Proporcao;
          ajustarPalco();
          break;
        case "fps":
          proj.fps = inp.value.split("/").map(Number) as unknown as Projeto["fps"];
          break;
        default: {
          const t = textoSel();
          if (!t) return;
          if (k === "texto") t.texto = inp.value;
          else if (k === "tInicio" && v >= 0) definirTempoTexto(proj, t.id, us, t.duracaoUs);
          else if (k === "tDuracao" && v > 0) definirTempoTexto(proj, t.id, t.inicioUs, us);
          else if (k === "tamanho") t.tamanho = v / 100;
          else if (k === "cor") t.cor = inp.value;
          else if (k === "corFundo") t.corFundo = inp.value;
          else if (k === "negrito") t.negrito = (inp as HTMLInputElement).checked;
          else if (k === "fundo") t.fundo = (inp as HTMLInputElement).checked;
        }
      }
      mudou();
    };
    // texto e controles deslizantes: prévia ao vivo, histórico ao soltar
    if (k === "texto" || k === "tamanho" || k === "volume") {
      inp.oninput = () => {
        const t = textoSel();
        if (k === "texto" && t) t.texto = inp.value;
        else if (k === "tamanho" && t) t.tamanho = valor() / 100;
        else if (k === "volume" && c) c.volume = valor() / 100;
        guardar();
        renderizarLinha();
        void previa.mostrar();
        const b = inp.parentElement?.querySelector("b");
        if (b && k !== "texto") b.textContent = `${inp.value}%`;
      };
      inp.onchange = () => mudou();
    } else inp.onchange = aoMudar;
  });
}

function renderizarTudo() {
  renderizarBiblioteca();
  renderizarLinha();
  renderizarPropriedades();
  casca.renderizar();
  const total = duracaoTotal(proj);
  const [W, H] = dimensoes(proj.proporcao, 1080);
  casca.definirStatus(`${PROPORCOES.find((r) => r.id === proj.proporcao)!.nome} · ${W}×${H} · ${FPS_PADRAO.find((f) => f.fps.join("/") === proj.fps.join("/"))?.nome ?? "30"} qps · ${duracaoLegivel(total)}`);
}

// ---------------- exportar ----------------

async function exportar() {
  previa.pausar();
  renderizarTransporte();
  const total = duracaoTotal(proj);
  if (!proj.clipes.length) return casca.avisar("Ponha ao menos um vídeo ou foto na linha do tempo antes de exportar.");
  const arquivos: Record<string, File> = {};
  const faltam: string[] = [];
  for (const m of proj.midias.filter((x) => proj.clipes.some((c) => c.midia === x.id))) {
    const f = await arquivoDaMidia(m.id);
    if (f) arquivos[m.id] = f;
    else faltam.push(m.nome);
  }
  if (faltam.length) return janela("Faltam arquivos", `<p>Estas mídias não estão neste aparelho: <b>${faltam.map(escapar).join(", ")}</b>.</p><p>Toque nelas na lista de mídia (à esquerda) e use <b>Localizar…</b>.</p>`);
  const fps = proj.fps[0] / proj.fps[1];
  const corpo = `<div class="vm-exportar">
    <label class="wj-campo"><label>Nome do arquivo</label><input data-e="nome" value="${escapar(proj.nome)}" /></label>
    <label class="wj-campo"><label>Resolução</label><select data-e="res">
      ${[1080, 720, 480, 360].map((r) => { const [w, h] = dimensoes(proj.proporcao, r); return `<option value="${r}"${r === 1080 ? " selected" : ""}>${r === 1080 ? "Alta" : r === 720 ? "Média" : r === 480 ? "Pequena" : "Mínima"} (${w}×${h})</option>`; }).join("")}
    </select></label>
    <label class="wj-campo"><label>Qualidade / tamanho</label><select data-e="qual">
      <option value="alta">Alta qualidade</option><option value="media" selected>Boa qualidade (arquivo menor)</option><option value="baixa">Econômica (bem menor)</option><option value="mb">Até um tamanho máximo…</option>
    </select></label>
    <label class="wj-campo" data-mb hidden><label>Tamanho máximo (MB)</label><input data-e="mb" type="number" min="1" step="1" value="16" inputmode="numeric" /></label>
    <p class="vm-estimativa" data-est></p>
    <p class="vm-dica">Vídeo MP4 (H.264 + AAC quando o aparelho tem; toca em qualquer lugar). Duração: ${duracaoLegivel(total)}.</p></div>`;
  const conta = (c: HTMLElement) => {
    const res = Number($<HTMLSelectElement>('[data-e="res"]', c).value);
    const qual = $<HTMLSelectElement>('[data-e="qual"]', c).value;
    const [w, h] = dimensoes(proj.proporcao, res);
    const mb = Number($<HTMLInputElement>('[data-e="mb"]', c).value) || 16;
    const bps = qual === "mb" ? taxaParaTamanho(mb, total) : taxaVideo(w, h, fps, qual as Qualidade);
    return { w, h, bps, nome: $<HTMLInputElement>('[data-e="nome"]', c).value.trim() || proj.nome };
  };
  const { corpo: c } = janela("Exportar vídeo", corpo, [
    { rotulo: "Cancelar" },
    { rotulo: "Exportar", destaque: true, acao: (cc) => void rodarExportacao(conta(cc), arquivos) },
  ]);
  const atualizar = () => {
    $<HTMLElement>("[data-mb]", c).hidden = $<HTMLSelectElement>('[data-e="qual"]', c).value !== "mb";
    const r = conta(c);
    $("[data-est]", c).textContent = `${r.w}×${r.h} · ${(r.bps / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} Mbit/s · arquivo ≈ ${tamanhoEstimadoMb(total, r.bps, AUDIO_BPS).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;
  };
  c.querySelectorAll("select, input").forEach((x) => x.addEventListener("input", atualizar));
  atualizar();
}

function rodarExportacao(o: { w: number; h: number; bps: number; nome: string }, arquivos: Record<string, File>) {
  const w = new Worker(new URL("./exportar-worker.ts", import.meta.url), { type: "module" });
  const t0 = performance.now();
  const { corpo, fechar } = janela("Exportando…", `<div class="vm-progresso"><div class="vm-barra"><i data-b></i></div><p data-p>Preparando…</p>
    <p class="vm-dica">Deixe o app aberto e a tela acesa (ela fica acesa sozinha). A edição continua liberada.</p></div>`, [
    { rotulo: "Cancelar exportação", acao: () => (w.terminate(), void tela?.release().catch(() => {}), casca.avisar("Exportação cancelada.")) },
  ]);
  let tela: WakeLockSentinel | null = null;
  void navigator.wakeLock?.request("screen").then((s) => (tela = s)).catch(() => {});
  w.onmessage = (ev: MessageEvent<RespostaExportar>) => {
    const r = ev.data;
    if (r.tipo === "progresso") {
      const f = r.total ? r.feito / r.total : 0;
      $<HTMLElement>("[data-b]", corpo).style.width = `${Math.round(f * 100)}%`;
      const s = (performance.now() - t0) / 1000;
      const resta = f > 0.02 ? (s / f) * (1 - f) : NaN;
      $("[data-p]", corpo).textContent = `${Math.round(f * 100)}%${Number.isFinite(resta) ? ` · falta ≈ ${duracaoLegivel(resta * 1e6)}` : ""}`;
    } else {
      w.terminate();
      void tela?.release().catch(() => {});
      fechar();
      if (r.tipo === "erro") janela("Não foi possível exportar", `<p>${escapar(r.texto)}</p>`);
      else concluir(r.arquivo, r.codecVideo, r.codecAudio, (performance.now() - t0) / 1000);
    }
  };
  w.onerror = (e) => {
    w.terminate();
    fechar();
    janela("Não foi possível exportar", `<p>${escapar(e.message || "falha no Worker de exportação")}</p>`);
  };
  const pedido: PedidoExportar = { tipo: "exportar", projeto: proj, arquivos, largura: o.w, altura: o.h, bitrateVideo: o.bps, nome: o.nome };
  w.postMessage(pedido);
}

function concluir(arquivo: File, codecVideo: string, codecAudio: string | null, segundos: number) {
  navigator.vibrate?.(200);
  const nomes: Record<string, string> = { avc: "H.264", hevc: "H.265", vp9: "VP9", av1: "AV1", aac: "AAC", opus: "Opus" };
  const podeCompartilhar = !!navigator.canShare?.({ files: [arquivo] });
  const { corpo } = janela("Vídeo pronto", `<p><b>${escapar(arquivo.name)}</b> · ${(arquivo.size / 1048576).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB · ${nomes[codecVideo] ?? codecVideo}${codecAudio ? ` + ${nomes[codecAudio] ?? codecAudio}` : " (sem som)"} · feito em ${duracaoLegivel(segundos * 1e6)}</p>
    <video class="vm-pronto" controls playsinline></video>`, [
    ...(podeCompartilhar ? [{ rotulo: "Compartilhar…", acao: () => (void navigator.share({ files: [arquivo], title: arquivo.name }).catch(() => {}), false) }] : []),
    { rotulo: "Baixar no aparelho", acao: () => (baixar(arquivo, arquivo.name.replace(/\.mp4$/i, ""), "mp4", "video/mp4"), false) },
    {
      rotulo: "Salvar no WJPDM…", destaque: true,
      acao: () => (void exportarComo("video", arquivo.name.replace(/\.mp4$/i, ""), [{ ext: "mp4", rotulo: "Vídeo MP4" }], async () => arquivo, { semVersoes: true }).then((m) => casca.avisar(m, 7000)), false),
    },
    { rotulo: "Fechar" },
  ]);
  const v = $<HTMLVideoElement>("video", corpo);
  v.src = URL.createObjectURL(arquivo);
}

// ---------------- casca (barra, faixa, atalhos) ----------------

const casca: Casca = new Casca({
  app: "WJVideoMaker",
  icone: "",
  extensao: "wjvid",
  nomeDoc: () => proj.nome,
  renomear: (n) => {
    proj.nome = n;
    guardar();
    casca.renderizar();
  },
  novo: () => {
    if (proj.clipes.length && !confirm("Começar um vídeo novo? O atual continua no cofre se você salvou.")) return;
    trocarProjeto(projetoNovo("Vídeo sem título", proj.proporcao));
  },
  abrir: () =>
    void escolherArquivo().then((a) => {
      if (!a?.texto) return;
      try {
        const p = validarProjeto(JSON.parse(a.texto));
        if (!p) throw new Error("Não é um projeto do WJVideoMaker (.wjvid).");
        trocarProjeto(p);
      } catch (e) {
        casca.avisar((e as Error).message || "Arquivo inválido.", 6000);
      }
    }),
  salvar: () => void salvarArquivo(JSON.stringify(proj), proj.nome, "wjvid", "application/json"),
  desfazer: () => {
    const p = historico.desfazer();
    if (p) {
      proj = p;
      mudou(false);
    }
  },
  refazer: () => {
    const p = historico.refazer();
    if (p) {
      proj = p;
      mudou(false);
    }
  },
  direita: [
    { id: "aparelho", rotulo: "Teste do aparelho", icone: "aparelho", dica: "Teste do aparelho: formatos e desempenho de vídeo", acao: () => (location.href = "aparelho/") },
  ],
  abas: [
    {
      id: "editar",
      rotulo: "Editar",
      grupos: [
        [
          { id: "imp", rotulo: "Do aparelho", icone: "importar", dica: "Importar vídeos e fotos do aparelho (galeria, câmera, Downloads, pendrive)", acao: () => $<HTMLInputElement>("#vm-entrada").click() },
          { id: "impCofre", rotulo: "Do WJPDM", icone: "pasta", dica: "Importar vídeo ou foto do cofre do WJPDM", acao: () => void importarDoCofre() },
        ],
        [
          { id: "dividir", rotulo: "Dividir", icone: "dividirClipe", dica: "Dividir o clipe no cursor (S ou Ctrl+B)", acao: cmdDividir },
          { id: "aparIni", rotulo: "Aparar início", icone: "apararInicio", dica: "Tirar o que vem antes do cursor (Q)", acao: () => cmdAparar("inicio") },
          { id: "aparFim", rotulo: "Aparar fim", icone: "apararFim", dica: "Tirar o que vem depois do cursor (W)", acao: () => cmdAparar("fim") },
        ],
        [
          {
            id: "vel", rotulo: "Velocidade", dica: "Velocidade do clipe: acelera (encurta) ou câmera lenta",
            opcoes: () => [["", "Velocidade…"], ...VELOCIDADES.map((v) => [String(v), velTexto(v)] as [string, string])],
            valor: () => "", aoMudar: (v) => v && cmdVelocidade(Number(v)),
          },
          { id: "som", rotulo: "Som", icone: "som", dica: "Ligar/desligar o som do clipe", acao: cmdSom, ativo: () => (clipeSel()?.volume ?? 1) > 0 },
        ],
        [
          { id: "antes", rotulo: "Mover antes", icone: "moverAntes", dica: "Levar o clipe uma posição para trás", acao: () => cmdMover(-1) },
          { id: "depois", rotulo: "Mover depois", icone: "moverDepois", dica: "Levar o clipe uma posição para frente", acao: () => cmdMover(1) },
          { id: "dup", rotulo: "Duplicar", icone: "duplicar", acao: cmdDuplicar },
          { id: "exc", rotulo: "Excluir", icone: "apagar", dica: "Excluir o clipe ou texto selecionado (Delete); a linha fecha o vão", acao: cmdExcluir },
        ],
      ],
    },
    {
      id: "texto",
      rotulo: "Texto",
      grupos: [
        [{ id: "txt", rotulo: "Adicionar texto", icone: "caixaTexto", dica: "Texto sobre o vídeo/foto a partir do cursor (T)", acao: cmdTexto }],
        [
          {
            id: "pos", rotulo: "Posição", dica: "Posição do texto selecionado",
            opcoes: () => [["", "Posição…"], ...POSICOES_TEXTO.map((x) => [x.id, x.nome] as [string, string])],
            valor: () => "", aoMudar: (v) => { const p = POSICOES_TEXTO.find((x) => x.id === v); if (p) mudarTexto((t) => ((t.x = p.x), (t.y = p.y))); },
          },
          { id: "neg", rotulo: "Negrito", icone: "negrito", acao: () => mudarTexto((t) => (t.negrito = !t.negrito)), ativo: () => !!textoSel()?.negrito },
          { id: "faixa", rotulo: "Faixa", icone: "corFundo", dica: "Faixa escura atrás do texto", acao: () => mudarTexto((t) => (t.fundo = !t.fundo)), ativo: () => !!textoSel()?.fundo },
          { id: "maior", rotulo: "Maior", icone: "maiorFonte", acao: () => mudarTexto((t) => (t.tamanho = Math.min(0.25, t.tamanho * 1.2))) },
          { id: "menor", rotulo: "Menor", icone: "menorFonte", acao: () => mudarTexto((t) => (t.tamanho = Math.max(0.02, t.tamanho / 1.2))) },
        ],
        [{ id: "excT", rotulo: "Excluir texto", icone: "apagar", acao: () => (sel?.tipo === "texto" ? cmdExcluir() : casca.avisar("Selecione um texto.")) }],
      ],
    },
    {
      id: "exportar",
      rotulo: "Exportar",
      grupos: [
        [{ id: "exp", rotulo: "Exportar vídeo", icone: "exportar", dica: "Gerar o MP4 (resolução, qualidade ou tamanho máximo)", acao: () => void exportar() }],
        [
          {
            id: "prop", rotulo: "Formato", dica: "Formato do vídeo",
            opcoes: () => PROPORCOES.map((r) => [r.id, r.nome] as [string, string]),
            valor: () => proj.proporcao, aoMudar: (v) => ((proj.proporcao = v as Proporcao), ajustarPalco(), mudou()),
          },
        ],
      ],
    },
  ],
});

// ---------------- linha do tempo: barra de zoom ----------------

$("#vm-zoom").innerHTML = `<button class="wj-ic" data-z="menos" title="Afastar a linha do tempo" aria-label="Afastar">${IC.zoomMenos}</button>
  <button class="wj-ic" data-z="ajustar" title="Mostrar o vídeo inteiro" aria-label="Mostrar tudo">${IC.enquadrar}</button>
  <button class="wj-ic" data-z="mais" title="Aproximar a linha do tempo" aria-label="Aproximar">${IC.zoomMais}</button>`;
$("#vm-zoom").querySelectorAll<HTMLButtonElement>("[data-z]").forEach((b) => {
  b.onclick = () => {
    if (b.dataset.z === "ajustar") {
      ajustarZoom();
      renderizarLinha();
      $("#vm-rolo").scrollLeft = 0;
    } else zoomEm(b.dataset.z === "mais" ? 1.5 : 1 / 1.5);
  };
});

// pinça com dois dedos na linha do tempo = zoom
{
  const toques = new Map<number, number>();
  let dist0 = 0, zoom0 = zoom;
  const rolo = $("#vm-rolo");
  rolo.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "touch") return;
    toques.set(e.pointerId, e.clientX);
    if (toques.size === 2) {
      const [a, b] = [...toques.values()];
      dist0 = Math.abs(a - b);
      zoom0 = zoom;
    }
  });
  rolo.addEventListener("pointermove", (e) => {
    if (!toques.has(e.pointerId)) return;
    toques.set(e.pointerId, e.clientX);
    if (toques.size === 2 && dist0 > 20) {
      const [a, b] = [...toques.values()];
      const z = Math.max(2, Math.min(400, (zoom0 * Math.abs(a - b)) / dist0));
      if (Math.abs(z - zoom) / zoom > 0.03) zoomEm(z / zoom, (a + b) / 2);
    }
  });
  const fim = (e: PointerEvent) => toques.delete(e.pointerId);
  rolo.addEventListener("pointerup", fim);
  rolo.addEventListener("pointercancel", fim);
}

// ---------------- teclado ----------------

document.addEventListener("keydown", (e) => {
  const alvo = e.target as HTMLElement;
  if (alvo.closest("input, textarea, select, .wj-janela")) return;
  const k = e.key;
  if (e.ctrlKey || e.metaKey) {
    if (k.toLowerCase() === "z") (e.preventDefault(), casca.o.desfazer!());
    else if (k.toLowerCase() === "y") (e.preventDefault(), casca.o.refazer!());
    else if (k.toLowerCase() === "b") (e.preventDefault(), cmdDividir());
    else if (k.toLowerCase() === "e") (e.preventDefault(), void exportar());
    return;
  }
  const acoes: Record<string, () => void> = {
    " ": () => transporte("tocar"), ArrowLeft: () => transporte("ant"), ArrowRight: () => transporte("prox"),
    Home: () => transporte("inicio"), End: () => transporte("fim"), s: cmdDividir, S: cmdDividir,
    q: () => cmdAparar("inicio"), w: () => cmdAparar("fim"), Delete: cmdExcluir, Backspace: cmdExcluir, t: cmdTexto,
    "+": () => zoomEm(1.5), "-": () => zoomEm(1 / 1.5),
  };
  const f = acoes[k];
  if (f) {
    e.preventDefault();
    f();
  }
});

// ---------------- início ----------------

ajustarPalco();
ajustarZoom();
renderizarTransporte();
renderizarTudo();
void conferirMidias();
void previa.mostrar();
registrarOffline();
// ponte para os testes de navegador (estado do projeto)
(window as unknown as { __video: unknown }).__video = { projeto: () => proj, previa };
