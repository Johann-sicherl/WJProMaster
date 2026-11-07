// WJCalcEng: cálculos de engenharia do curso (especificação: docs/global/wjcalceng.md).
// Calculadora 1 — centro de gravidade em 2D. O desenho é o MESMO esboço do WJCAD (editor,
// ferramentas, relações com as entidades e com a origem, cotas inteligentes, solver PlaneGCS,
// painel do esboço à esquerda), numa vista só 2D. Cada região fechada do esboço é uma figura; o
// painel à direita define a massa (um material para todas ou a massa de cada figura) e mostra o
// CG de cada figura e do conjunto, os momentos de inércia e a memória de cálculo. Motor: cg2d.ts.

import "../style.css"; // estilos do esboço do WJCAD (painel, cotas, relações, lupa)
import wasmPlaneGcs from "@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm?url";
import { $, autosave, Casca, escapar, escolherArquivo, Historico, janela, menu, registrarOffline, salvarArquivo } from "../comum/casca";
import "./calceng.css";
import { ABAS, type Comando as ComandoCad } from "../comandos";
import { ICONES } from "../icones";
import { Viewport } from "../viewport";
import { EditorEsboco, type Ferramenta, type Hospedeiro } from "../esboco/editor";
import { renderizarPainelEsboco } from "../esboco/painel";
import { SolverEsboco } from "../esboco/solver";
import { abrirCalibracao, lerPxPorMm, pxPorMmAutomatico } from "../esboco/escalaReal";
import { IC } from "../comum/icones";
import { buscarCalculadoras, calculadora } from "./modulos";
import { calcularDoc, docNovo, validarDoc, type DocCalc, type P2, type ResultadoCg } from "./cg2d";

const CHAVE = "wjcalc:documento";
const CHAVE_PREFS = "wjcalc:prefs";

// ---------------------------------------------------------------------------------------------
// documento, histórico e resultados

let doc: DocCalc = (() => {
  try {
    const d = autosave.ler<unknown>(CHAVE);
    return d ? validarDoc(d) : docNovo();
  } catch {
    return docNovo();
  }
})();
const historico = new Historico<DocCalc>();
historico.limpar(doc);
let res: ResultadoCg = calcularDoc(doc.cg2d);
/** Figura destacada (linha da lista tocada). */
let destaque: string | null = null;

const prefs: { ultimoMenu: Record<string, string>; escalaReal?: boolean } = (() => {
  try {
    return { ultimoMenu: {}, ...JSON.parse(localStorage.getItem(CHAVE_PREFS) ?? "{}") };
  } catch {
    return { ultimoMenu: {} };
  }
})();
const salvarPrefs = () => {
  try {
    localStorage.setItem(CHAVE_PREFS, JSON.stringify(prefs));
  } catch {
    /* sem armazenamento */
  }
};

let pedidoCalculo = 0;
/** Recalcula no próximo quadro (o arrasto no esboço avisa muitas vezes). */
function recalcular() {
  if (pedidoCalculo) return;
  pedidoCalculo = requestAnimationFrame(() => {
    pedidoCalculo = 0;
    res = calcularDoc(doc.cg2d);
    painelResultados();
    desenharCg();
    status();
  });
}

/** O esboço mudou; `final` = vira passo de desfazer e salva. */
function alterou(final: boolean) {
  recalcular();
  if (final) {
    historico.registrar(doc);
    autosave.guardar(CHAVE, doc);
  }
}

/** Mudança dos dados das figuras ou do material (painel da direita). */
function alterarDados(muda: () => void) {
  muda();
  res = calcularDoc(doc.cg2d);
  historico.registrar(doc);
  autosave.guardar(CHAVE, doc);
  painelResultados();
  desenharCg();
}

function trocarDoc(d: DocCalc) {
  doc = d;
  destaque = null;
  historico.limpar(doc);
  autosave.guardar(CHAVE, doc);
  if (editor) {
    editor.reatar(doc.cg2d.esboco);
    editor.definirFerramenta("selecionar");
  }
  res = calcularDoc(doc.cg2d);
  casca.renderizar();
  painelEsboco();
  painelResultados();
  enquadrar();
}

function desfazer() {
  const d = historico.desfazer();
  if (d) depoisDoHistorico(d);
}
function refazer() {
  const d = historico.refazer();
  if (d) depoisDoHistorico(d);
}
function depoisDoHistorico(d: DocCalc) {
  doc = d;
  editor?.reatar(doc.cg2d.esboco);
  autosave.guardar(CHAVE, doc);
  res = calcularDoc(doc.cg2d);
  casca.renderizar();
  painelEsboco();
  painelResultados();
  desenharCg();
}

// ---------------------------------------------------------------------------------------------
// números

const SOBRE = "⁰¹²³⁴⁵⁶⁷⁸⁹";
function fmt(v: number, unidade = ""): string {
  if (!Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  let t: string;
  if (a !== 0 && (a < 1e-4 || a >= 1e12)) {
    const e = Math.floor(Math.log10(a));
    t = `${(v / 10 ** e).toLocaleString("pt-BR", { maximumFractionDigits: 3 })} × 10${e < 0 ? "⁻" : ""}${String(Math.abs(e)).split("").map((d) => SOBRE[+d]).join("")}`;
  } else t = (a < 5e-13 ? 0 : v).toLocaleString("pt-BR", { maximumFractionDigits: a >= 100 ? 2 : a >= 1 ? 4 : 6 });
  return unidade ? `${t} ${unidade}` : t;
}
/** Número digitado: aceita vírgula, "pi" e contas simples (100/3, 2*pi*5, 3^2). */
function lerNumero(s: string): number {
  const t = s.trim().toLowerCase().replace(/\s+/g, "").replace(/,/g, ".").replace(/π|pi/g, `(${Math.PI})`).replace(/\^/g, "**");
  if (!t || !/^[\d.+\-*/()e]+$/.test(t.replace(/\*\*/g, ""))) return NaN;
  try {
    const v = Function(`"use strict";return (${t});`)() as unknown;
    return typeof v === "number" ? v : NaN;
  } catch {
    return NaN;
  }
}
const campo = (v: number) => (Number.isFinite(v) ? String(+v.toFixed(6)).replace(".", ",") : "");

// ---------------------------------------------------------------------------------------------
// viewport 2D e editor de esboço do WJCAD

const viewport = new Viewport($("#ce-viewport"));
viewport.definir2D(true);
for (const p of ["XY", "XZ", "YZ"] as const) viewport.definirVisibilidadeReferencia(p, false);
let editor: EditorEsboco | null = null;

function painelEsboco() {
  const ed = editor;
  const painel = $("#painel-comando");
  if (!ed) {
    painel.innerHTML = `<p class="dica">Carregando o esboço…</p>`;
    return;
  }
  renderizarPainelEsboco(
    painel,
    ed,
    () => ed.definirFerramenta("selecionar"),
    (nome) => {
      ed.esb.nome = nome;
      alterou(true);
    },
    (ancora) => {
      const r = ancora.getBoundingClientRect();
      menu(r.left, r.bottom + 4, ed.relacoesPossiveis().map((o) => ({ rotulo: `${o.simbolo}   ${o.rotulo}`, acao: o.aplicar })));
    },
  );
  // o esboço do WJCalcEng fica sempre aberto: sem o botão "Sair do esboço"
  painel.querySelectorAll("button").forEach((b) => {
    if (b.textContent?.includes("Sair do esboço")) b.closest(".prop-rodape")?.remove();
  });
}

async function iniciarEditor() {
  let solver: SolverEsboco;
  try {
    solver = await SolverEsboco.criar(() => wasmPlaneGcs);
  } catch (e) {
    casca.avisar(`Não foi possível carregar o solver de esboço: ${(e as Error).message}`, 8000);
    return;
  }
  const host: Hospedeiro = {
    viewport,
    solver,
    overlay: $("#overlay-esboco"),
    alterou,
    atualizarInterface: () => {
      montarFaixa();
      painelEsboco();
      status();
    },
    avisar: (t) => casca.avisar(t, 5000),
  };
  editor = new EditorEsboco(host, doc.cg2d.esboco);
  // as marcas de CG vão por cima de cada quadro desenhado
  const aposEditor = viewport.aposDesenhar;
  viewport.aposDesenhar = () => {
    aposEditor?.();
    desenharCg();
  };
  aplicarEscalaReal();
  montarFaixa();
  painelEsboco();
  enquadrar();
  status();
}

/** Enquadra o esboço e a origem. */
function enquadrar() {
  if (!editor) return;
  const ref = editor.referencial;
  viewport.olharPlano(ref);
  const pts = doc.cg2d.esboco.pontos;
  if (!pts.length || prefs.escalaReal) return;
  const xs = [0, ...pts.map((p) => p.x)], ys = [0, ...pts.map((p) => p.y)];
  const r = viewport.canvas().getBoundingClientRect();
  // depois da câmera assentar de frente para o plano
  setTimeout(() => {
    const a = viewport.planoParaTela(ref, Math.min(...xs), Math.max(...ys));
    const b = viewport.planoParaTela(ref, Math.max(...xs), Math.min(...ys));
    const m = 60;
    viewport.ampliarArea(r.left + a.x - m, r.top + a.y - m, r.left + b.x + m, r.top + b.y + m);
  }, 450);
}

// ---------- escala real 1:1 (a mesma do esboço do WJCAD) ----------

async function alternarEscalaReal(ligar = !prefs.escalaReal) {
  let fonte = "";
  if (ligar && lerPxPorMm() === null) {
    const auto = await pxPorMmAutomatico();
    if (auto) fonte = auto.fonte;
    else {
      casca.avisar("Antes, calibre a escala da tela (uma vez por aparelho).", 6000);
      if ((await abrirCalibracao()) === null) return;
    }
  }
  prefs.escalaReal = ligar;
  salvarPrefs();
  aplicarEscalaReal();
  montarFaixa();
  status();
  casca.avisar(ligar ? `${fonte ? `Escala calibrada pela ficha do ${fonte}. ` : ""}Escala real 1:1: 1 mm na tela = 1 mm no desenho.` : "Escala real desligada: zoom livre de novo.", 6000);
}
function aplicarEscalaReal() {
  const px = prefs.escalaReal && editor ? lerPxPorMm() : null;
  if (px && editor) viewport.olharPlano(editor.referencial);
  viewport.travarEscala(px, editor?.referencial ?? null);
}

// ---------------------------------------------------------------------------------------------
// faixa de comandos: a aba Sketch do WJCAD (sem os comandos que pedem uma peça 3D)

const FORA = new Set(["grupo-esboco", "grupo-converter"]);
const SKETCH = ABAS.find((a) => a.id === "sketch")!.comandos.filter((c) => !FORA.has(c.id));

function ativo(c: ComandoCad): boolean {
  if (!editor) return false;
  if (c.id === "construcao") return editor.construcao;
  if (c.id === "escalaReal") return !!prefs.escalaReal;
  const [ferr, variante] = c.id.split(":");
  return ferr === editor.ferramenta && (!variante || editor.variante(ferr) === variante);
}

function botaoCmd(c: ComandoCad, rotulo = c.rotulo): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = "wj-cmd";
  b.title = c.emBreve ? `${c.dica} — em breve` : c.dica;
  b.innerHTML = `${ICONES[c.icone] ?? ""}<span>${escapar(rotulo)}</span>`;
  if (c.emBreve) b.setAttribute("aria-disabled", "true");
  b.setAttribute("aria-pressed", String(ativo(c)));
  b.onclick = () => void executar(c, b);
  return b;
}

function montarFaixa() {
  const faixa = document.querySelector<HTMLElement>(".wj-faixa");
  if (!faixa) return;
  faixa.innerHTML = "";
  let grupo: HTMLElement | null = null;
  let g = -1;
  for (const c of SKETCH) {
    if (c.grupo !== g || !grupo) {
      grupo = document.createElement("div");
      grupo.className = "wj-grupo";
      faixa.append(grupo);
      g = c.grupo;
    }
    if (!c.itens) {
      grupo.append(botaoCmd(c));
      continue;
    }
    const itens = c.itens.filter((i) => !FORA.has(i.id));
    const atual = itens.find((i) => i.id === prefs.ultimoMenu[c.id]) ?? itens[0];
    const caixa = document.createElement("span");
    caixa.className = "ce-menu";
    const b = botaoCmd(atual, c.rotulo);
    b.title = `${atual.rotulo} — ${b.title}`;
    if (itens.length < 2) {
      grupo.append(b);
      continue;
    }
    const seta = document.createElement("button");
    seta.className = "ce-seta";
    seta.textContent = "▾";
    seta.title = `${c.rotulo}: outras opções`;
    seta.setAttribute("aria-label", seta.title);
    seta.onclick = () => {
      const r = seta.getBoundingClientRect();
      menu(r.left, r.bottom + 4, itens.map((it) => ({
        rotulo: `${it.id === atual.id ? "● " : ""}${it.rotulo}${it.emBreve ? " (em breve)" : ""}`,
        acao: () => {
          if (!it.emBreve && it.id !== "selecionarTudo" && it.id !== "calibrarTela") {
            prefs.ultimoMenu[c.id] = it.id;
            salvarPrefs();
          }
          void executar(it, seta);
        },
      })));
    };
    caixa.append(b, seta);
    grupo.append(caixa);
  }
}

/** Os mesmos comandos da aba Sketch do WJCAD. */
async function executar(c: ComandoCad, botao: HTMLElement) {
  if (c.emBreve) return casca.avisar(`${c.rotulo}: em breve.`);
  const ed = editor;
  if (!ed) return casca.avisar("O esboço ainda está carregando.");
  switch (c.id) {
    case "relacao": {
      const ops = ed.relacoesPossiveis();
      if (!ops.length) return casca.avisar("Selecione entidades para relacionar (ex.: duas linhas → Paralelo; um ponto e a origem → Coincidente).");
      const r = botao.getBoundingClientRect();
      return menu(r.left, r.bottom + 4, ops.map((o) => ({ rotulo: `${o.simbolo}   ${o.rotulo}`, acao: o.aplicar })));
    }
    case "construcao":
      if (ed.geosSelecionadas().length) ed.alternarConstrucaoSelecao();
      else {
        ed.construcao = !ed.construcao;
        casca.avisar(ed.construcao ? "Próximas entidades serão de construção (não entram nas figuras)." : "Próximas entidades serão normais.");
        montarFaixa();
        painelEsboco();
      }
      return;
    case "espelhoDinamico":
      return ed.alternarEspelhoDinamico();
    case "escalaReal":
      return void alternarEscalaReal();
    case "calibrarTela":
      if ((await abrirCalibracao()) !== null) aplicarEscalaReal();
      return;
    case "selecionarTudo":
      return ed.selecionarTudo();
    case "exibirRelacoes":
    case "padraoLinearEsboco":
    case "padraoCircularEsboco":
      return ed.definirFerramenta(c.id);
    default: {
      // "ferramenta:variante" (ex.: retangulo:centro)
      const [ferr, variante] = c.id.split(":") as [Ferramenta, string | undefined];
      if (variante) ed.definirVariante(ferr, variante);
      ed.definirFerramenta(ferr);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// marcas de CG sobre o desenho (SVG por cima do viewport)

const svgCg = document.getElementById("ce-cg") as unknown as SVGSVGElement;

function simbolo(p: P2, r: number, cor: string): string {
  return `<g transform="translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})"><circle r="${r}" fill="#fff" stroke="${cor}" stroke-width="1.5"/>`
    + `<path d="M0 0V${-r}A${r} ${r} 0 0 1 ${r} 0Z M0 0V${r}A${r} ${r} 0 0 1 ${-r} 0Z" fill="${cor}"/></g>`;
}
function rotulo(p: P2, texto: string, cor: string, fundo: string, dy: number): string {
  const w = texto.length * 7 + 10;
  return `<g transform="translate(${p.x.toFixed(1)} ${(p.y + dy).toFixed(1)})"><rect x="${-w / 2}" y="-9" width="${w}" height="18" rx="4" fill="${fundo}"/>`
    + `<text text-anchor="middle" dominant-baseline="central" fill="${cor}">${escapar(texto)}</text></g>`;
}

function desenharCg() {
  if (!editor || !svgCg) return;
  const ref = editor.referencial;
  const t = (p: P2) => viewport.planoParaTela(ref, p.x, p.y);
  let h = "";
  const fd = res.figuras.find((f) => f.chave === destaque);
  if (fd) h += `<polygon points="${fd.poligono.map((p) => { const q = t(p); return `${q.x.toFixed(1)},${q.y.toFixed(1)}`; }).join(" ")}" fill="rgba(240,140,0,.18)" stroke="#f08c00" stroke-width="2.5"/>`;
  for (const f of res.figuras) {
    if (!Number.isFinite(f.x)) continue;
    const q = t(f);
    if (f.furo) h += `<path transform="translate(${q.x.toFixed(1)} ${q.y.toFixed(1)})" d="M-5 -5L5 5M5 -5L-5 5" stroke="#c9372c" stroke-width="1.6"/>`;
    else h += simbolo(q, 5, "#2f7fd0");
    h += rotulo(q, f.furo ? `${f.nome} (furo)` : f.nome, f.furo ? "#c9372c" : "#5e6b78", "rgba(255,255,255,.75)", 15);
  }
  if (doc.cg2d.material.modo === "massa" && res.centroide && res.cg && Math.hypot(res.centroide.x - res.cg.x, res.centroide.y - res.cg.y) > 1e-6) {
    const q = t(res.centroide);
    h += `<path transform="translate(${q.x.toFixed(1)} ${q.y.toFixed(1)})" d="M-6 -6L6 6M6 -6L-6 6" stroke="#5e6b78" stroke-width="1.6"/>${rotulo(q, "centroide da área", "#5e6b78", "rgba(255,255,255,.8)", -16)}`;
  }
  if (res.cg) {
    const q = t(res.cg);
    h += simbolo(q, 10, "#111") + rotulo(q, `CG (${fmt(res.cg.x)}; ${fmt(res.cg.y)})`, "#fff", "#1e2730", -22);
  }
  svgCg.innerHTML = h;
}

// ---------------------------------------------------------------------------------------------
// painel da direita: massa, figuras e resultados

const painelEl = $("#ce-painel");

function linhaCampo(rot: string, chave: string, valor: string, unidade = "") {
  return `<label class="ce-campo"><span>${rot}</span><input data-c="${chave}" value="${escapar(valor)}" inputmode="decimal" autocomplete="off" /><em>${unidade}</em></label>`;
}

function painelResultados() {
  const mat = doc.cg2d.material;
  const ehMassa = mat.modo === "massa";
  const i = res.areaCentroide, o = res.areaOrigem, mi = res.massaCg;
  const kgm2 = (v: number) => fmt(v * 1e-6, "kg·m²");
  const figs = res.figuras;
  const massaDe = (k: string) => doc.cg2d.regioes[k]?.massa;
  painelEl.innerHTML = `
    <section><h3>Massa das figuras</h3>
      <div class="ce-modo" role="group" aria-label="Como obter a massa">
        <button data-modo="densidade" aria-pressed="${!ehMassa}">Massa única (um material)</button>
        <button data-modo="massa" aria-pressed="${ehMassa}">Massa de cada figura</button>
      </div>
      ${!ehMassa ? linhaCampo("Densidade ρ", "densidade", campo(mat.densidade), "kg/m³") + linhaCampo("Espessura", "espessura", campo(mat.espessura), "mm") + `<p class="ce-nota">Massa = ρ × espessura × área, o mesmo material em todas as figuras: o CG coincide com o centroide da área.</p>` : `<p class="ce-nota">Informe a massa (kg) de cada figura na lista abaixo.</p>`}
    </section>
    <section><h3>Figuras (regiões fechadas do esboço)</h3>
      ${figs.length ? `<div class="ce-figuras">${figs.map((f) => `
        <div class="ce-fig${f.chave === destaque ? " sel" : ""}" data-f="${escapar(f.chave)}">
          <div class="ce-fig-linha">
            <input class="ce-fig-nome" data-nome value="${escapar(f.nome)}" aria-label="Nome da figura" />
            <label class="ce-check"><input type="checkbox" data-furo ${f.furo ? "checked" : ""} /> Furo</label>
          </div>
          ${ehMassa && !f.furo ? `<label class="ce-campo"><span>Massa</span><input data-massa value="${massaDe(f.chave) === undefined ? "" : campo(massaDe(f.chave)!)}" inputmode="decimal" placeholder="informe" class="${massaDe(f.chave) === undefined ? "falta" : ""}" /><em>kg</em></label>` : ""}
          <small>A = ${fmt(f.A, "mm²")}${f.furo ? "" : ` · m = ${fmt(f.m, "kg")}`}<br>x̄ = ${fmt(f.x)} · ȳ = ${fmt(f.y)} mm</small>
        </div>`).join("")}</div>` : `<p class="ce-nota">Desenhe contornos fechados com as ferramentas da aba Sketch. Cada região fechada vira uma figura; contorno dentro de outro vira furo.</p>`}
    </section>
    <section><h3>Resultados</h3>
      ${res.cg ? `<div class="ce-destaque"><small>Centro de gravidade do conjunto</small><b>X = ${fmt(res.cg.x)} mm</b><b>Y = ${fmt(res.cg.y)} mm</b></div>` : ""}
      ${res.linhas.length ? `<dl class="ce-res">
        <dt>Massa total</dt><dd>${fmt(res.m, "kg")}</dd>
        <dt>Área líquida</dt><dd>${fmt(res.A, "mm²")}</dd>
        ${ehMassa && res.centroide ? `<dt>Centroide da área</dt><dd>${fmt(res.centroide.x)} ; ${fmt(res.centroide.y)} mm</dd>` : ""}
      </dl>` : ""}
      ${res.avisos.map((a) => `<p class="ce-aviso">${escapar(a)}</p>`).join("")}
      ${i ? `<h3>Momento de inércia de área — eixos pelo centroide</h3><dl class="ce-res">
        <dt>Ix</dt><dd>${fmt(i.Ix, "mm⁴")}</dd><dt>Iy</dt><dd>${fmt(i.Iy, "mm⁴")}</dd><dt>Ixy</dt><dd>${fmt(i.Ixy, "mm⁴")}</dd>
        <dt>J = Ix + Iy</dt><dd>${fmt(i.J, "mm⁴")}</dd>
        <dt>I₁ / I₂</dt><dd>${fmt(i.I1)} / ${fmt(i.I2)} mm⁴</dd><dt>θ (eixo de I₁)</dt><dd>${fmt(i.theta, "°")}</dd></dl>` : ""}
      ${o ? `<h3>Momento de inércia de área — eixos da origem</h3><dl class="ce-res">
        <dt>Ix</dt><dd>${fmt(o.Ix, "mm⁴")}</dd><dt>Iy</dt><dd>${fmt(o.Iy, "mm⁴")}</dd><dt>Ixy</dt><dd>${fmt(o.Ixy, "mm⁴")}</dd></dl>` : ""}
      ${mi ? `<h3>Momento de inércia de massa — eixos pelo CG</h3><dl class="ce-res">
        <dt>Ix</dt><dd>${fmt(mi.Ix, "kg·mm²")}<br><small>${kgm2(mi.Ix)}</small></dd>
        <dt>Iy</dt><dd>${fmt(mi.Iy, "kg·mm²")}<br><small>${kgm2(mi.Iy)}</small></dd>
        <dt>Iz (polar)</dt><dd>${fmt(mi.Iz, "kg·mm²")}<br><small>${kgm2(mi.Iz)}</small></dd></dl>
        <p class="ce-nota">Placa fina de massa uniforme em cada figura; Iz em torno do eixo perpendicular ao plano, pelo CG.</p>` : ""}
      ${res.linhas.length ? `<div class="ce-botoes"><button data-b="memoria" class="destaque">Memória de cálculo</button><button data-b="copiar">Copiar tabela</button></div>` : ""}
    </section>`;

  painelEl.querySelectorAll<HTMLElement>("[data-modo]").forEach((b) => (b.onclick = () => alterarDados(() => (doc.cg2d.material.modo = b.dataset.modo as "densidade" | "massa"))));
  for (const chave of ["densidade", "espessura"] as const) {
    const inp = painelEl.querySelector<HTMLInputElement>(`[data-c="${chave}"]`);
    if (!inp) continue;
    inp.onchange = () => {
      const v = lerNumero(inp.value);
      if (!(v >= 0)) {
        casca.avisar("Valor inválido.");
        return painelResultados();
      }
      alterarDados(() => (doc.cg2d.material[chave] = v));
    };
    inp.onkeydown = (e) => e.key === "Enter" && inp.blur();
  }
  painelEl.querySelectorAll<HTMLElement>(".ce-fig").forEach((div) => {
    const chave = div.dataset.f!;
    const dados = () => (doc.cg2d.regioes[chave] ??= { nome: "Figura" });
    const marcar = () => {
      destaque = chave;
      desenharCg();
    };
    div.onclick = (e) => {
      if ((e.target as HTMLElement).closest("input, label")) return;
      destaque = destaque === chave ? null : chave;
      painelResultados();
      desenharCg();
    };
    const nome = div.querySelector<HTMLInputElement>("[data-nome]")!;
    nome.onfocus = marcar;
    nome.onchange = () => alterarDados(() => (dados().nome = nome.value.trim() || dados().nome));
    nome.onkeydown = (e) => e.key === "Enter" && nome.blur();
    const furo = div.querySelector<HTMLInputElement>("[data-furo]")!;
    furo.onchange = () => alterarDados(() => {
      const f = res.figuras.find((x) => x.chave === chave);
      // igual ao padrão (dentro de outra = furo): não guarda nada
      if (f && furo.checked === f.furoPadrao) delete dados().furo;
      else dados().furo = furo.checked;
    });
    const massa = div.querySelector<HTMLInputElement>("[data-massa]");
    if (massa) {
      massa.onfocus = marcar;
      massa.onchange = () => {
        if (!massa.value.trim()) return alterarDados(() => delete dados().massa);
        const v = lerNumero(massa.value);
        if (!(v >= 0)) {
          casca.avisar("Massa inválida.");
          return painelResultados();
        }
        alterarDados(() => (dados().massa = v));
      };
      massa.onkeydown = (e) => e.key === "Enter" && massa.blur();
    }
  });
  painelEl.querySelector<HTMLElement>('[data-b="memoria"]')?.addEventListener("click", memoriaDeCalculo);
  painelEl.querySelector<HTMLElement>('[data-b="copiar"]')?.addEventListener("click", () => void copiarTabela());
}

// ---------------------------------------------------------------------------------------------
// memória de cálculo (método das figuras compostas)

type Linha = ResultadoCg["linhas"][number];

function linhasTabela(): string[][] {
  const ehMassa = doc.cg2d.material.modo === "massa";
  const c = res.centroide ?? { x: 0, y: 0 };
  const cab = ["Figura", "A (mm²)", "m (kg)", "x̄ (mm)", "ȳ (mm)", ehMassa ? "m·x̄" : "A·x̄", ehMassa ? "m·ȳ" : "A·ȳ", "Ix' (mm⁴)", "Iy' (mm⁴)", "dy (mm)", "dx (mm)", "Ix'+A·dy²", "Iy'+A·dx²"];
  const w = (l: Linha) => (ehMassa ? l.m : l.A);
  const linhas = res.linhas.map((l) => {
    const dy = l.y - c.y, dx = l.x - c.x;
    return [l.nome, fmt(l.A), fmt(l.m), fmt(l.x), fmt(l.y), fmt(w(l) * l.x), fmt(w(l) * l.y), fmt(l.Ix), fmt(l.Iy), fmt(dy), fmt(dx), fmt(l.Ix + l.A * dy * dy), fmt(l.Iy + l.A * dx * dx)];
  });
  const soma = (fn: (l: Linha) => number) => res.linhas.reduce((s, l) => s + fn(l), 0);
  linhas.push(["Σ", fmt(res.A), fmt(res.m), "", "", fmt(soma((l) => w(l) * l.x)), fmt(soma((l) => w(l) * l.y)), "", "", "", "", fmt(res.areaCentroide?.Ix ?? NaN), fmt(res.areaCentroide?.Iy ?? NaN)]);
  return [cab, ...linhas];
}

function memoriaDeCalculo() {
  const ehMassa = doc.cg2d.material.modo === "massa";
  const t = linhasTabela();
  const peso = ehMassa ? "m" : "A";
  const sW = ehMassa ? res.m : res.A;
  const sX = res.linhas.reduce((s, l) => s + (ehMassa ? l.m : l.A) * l.x, 0);
  const sY = res.linhas.reduce((s, l) => s + (ehMassa ? l.m : l.A) * l.y, 0);
  const mat = doc.cg2d.material;
  const corpo = `
    <p class="ce-nota">${ehMassa ? "Massa informada em cada figura." : `Massa única: ρ = ${fmt(mat.densidade)} kg/m³, espessura = ${fmt(mat.espessura)} mm; m = ρ·t·A.`} Cada figura entra com o contorno cheio (+); o que está dentro dela entra recortado (−).</p>
    <div class="ce-memoria"><table class="ce-tabela"><thead><tr>${t[0].map((x) => `<th>${escapar(x)}</th>`).join("")}</tr></thead>
    <tbody>${t.slice(1).map((l) => `<tr>${l.map((x) => `<td>${escapar(x)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
    ${res.cg ? `<h3>Centro de gravidade</h3>
    <p>X = Σ${peso}·x̄ / Σ${peso} = ${fmt(sX)} / ${fmt(sW)} = <b>${fmt(sX / sW)} mm</b></p>
    <p>Y = Σ${peso}·ȳ / Σ${peso} = ${fmt(sY)} / ${fmt(sW)} = <b>${fmt(sY / sW)} mm</b></p>` : ""}
    ${res.areaCentroide ? `<h3>Momento de inércia de área (teorema dos eixos paralelos)</h3>
    <p>Ix = Σ(Ix' + A·dy²) = <b>${fmt(res.areaCentroide.Ix, "mm⁴")}</b> · Iy = Σ(Iy' + A·dx²) = <b>${fmt(res.areaCentroide.Iy, "mm⁴")}</b></p>
    <p class="ce-nota">dx e dy: distâncias do centroide de cada linha ao centroide do conjunto (${res.centroide ? `${fmt(res.centroide.x)} ; ${fmt(res.centroide.y)}` : "—"} mm).</p>` : ""}
    ${res.massaCg ? `<h3>Momento de inércia de massa (pelo CG)</h3><p>Iz = Σ[(m/A)·(Ix' + Iy') + m·d²] = <b>${fmt(res.massaCg.Iz, "kg·mm²")}</b> = ${fmt(res.massaCg.Iz * 1e-6, "kg·m²")}</p>` : ""}`;
  janela("Memória de cálculo — centro de gravidade 2D", corpo, [{ rotulo: "Copiar tabela", acao: () => (void copiarTabela(), false) }, { rotulo: "Fechar", destaque: true }], true);
}

async function copiarTabela() {
  try {
    await navigator.clipboard.writeText(linhasTabela().map((l) => l.join("\t")).join("\n"));
    casca.avisar("Tabela copiada: cole no WJPlan.");
  } catch {
    casca.avisar("Não foi possível copiar (o navegador bloqueou).");
  }
}

// ---------------------------------------------------------------------------------------------
// calculadoras (módulos)

/** Botão "Calculadora": abre o seletor por matéria com a lupa de pesquisa. */
function montarCalculadoras() {
  const b = $("#ce-calc");
  b.innerHTML = `<small>Calculadora</small><span>${escapar(calculadora(doc.modulo)?.nome ?? "")} ▾</span>`;
  b.onclick = () => abrirSeletor(b);
}

function abrirSeletor(ancora: HTMLElement) {
  document.querySelector(".ce-seletor")?.remove();
  const caixa = document.createElement("div");
  caixa.className = "ce-seletor";
  caixa.setAttribute("role", "dialog");
  caixa.setAttribute("aria-label", "Calculadoras por matéria");
  caixa.innerHTML = `<label class="ce-busca">${IC.localizar}<input type="search" placeholder="Pesquisar (ex.: bhaskara, 3x3)" aria-label="Pesquisar calculadora" autocomplete="off" /></label><div class="ce-materias"></div>`;
  const campoBusca = caixa.querySelector("input")!;
  const lista = caixa.querySelector<HTMLElement>(".ce-materias")!;
  const fechar = () => {
    caixa.remove();
    document.removeEventListener("pointerdown", fora, true);
  };
  const fora = (e: PointerEvent) => {
    if (!caixa.contains(e.target as Node) && e.target !== ancora && !ancora.contains(e.target as Node)) fechar();
  };
  const escolher = (id: string) => {
    const c = calculadora(id);
    if (!c) return;
    if (!c.pronto) return casca.avisar(`${c.nome}: em breve.`);
    fechar();
  };
  const desenhar = () => {
    const achadas = buscarCalculadoras(campoBusca.value);
    lista.innerHTML = achadas.length
      ? achadas.map((m) => `<section><h4>${escapar(m.nome)}</h4>${m.calculadoras.map((c) => `
          <button data-id="${c.id}" class="${c.id === doc.modulo ? "atual" : ""}" ${c.pronto ? "" : 'aria-disabled="true"'}>
            <span>${escapar(c.nome)}</span>${c.pronto ? (c.id === doc.modulo ? "<em>aberta</em>" : "") : "<em>em breve</em>"}
          </button>`).join("")}</section>`).join("")
      : `<p class="ce-nota">Nenhuma calculadora com "${escapar(campoBusca.value)}".</p>`;
    lista.querySelectorAll<HTMLElement>("[data-id]").forEach((x) => (x.onclick = () => escolher(x.dataset.id!)));
  };
  campoBusca.oninput = desenhar;
  campoBusca.onkeydown = (e) => {
    if (e.key === "Escape") fechar();
    else if (e.key === "Enter") {
      // Enter abre a primeira calculadora pronta do resultado
      const primeira = buscarCalculadoras(campoBusca.value).flatMap((m) => m.calculadoras).find((c) => c.pronto);
      if (primeira) escolher(primeira.id);
    }
  };
  desenhar();
  document.body.append(caixa);
  const r = ancora.getBoundingClientRect();
  caixa.style.left = `${Math.max(4, Math.min(r.left, innerWidth - caixa.offsetWidth - 4))}px`;
  caixa.style.top = `${r.bottom + 4}px`;
  setTimeout(() => document.addEventListener("pointerdown", fora, true));
  // no computador o cursor já fica na lupa; no toque, só se a pessoa tocar (o teclado não sobe sozinho)
  if (!matchMedia("(pointer: coarse)").matches) campoBusca.focus();
}

// ---------------------------------------------------------------------------------------------
// casca

function status() {
  const ed = editor;
  casca.definirStatus(ed ? `${ed.textoDefinicao} · ${res.figuras.length} figura(s) · Unidades: mm, kg${prefs.escalaReal ? " · Escala 1:1" : ""}` : "Carregando o esboço…");
}

const casca: Casca = new Casca({
  app: "WJCalcEng",
  icone: "",
  extensao: "wjcalc",
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
    void salvarArquivo(JSON.stringify(doc), doc.nome, "wjcalc");
  },
  desfazer,
  refazer,
  abas: [{ id: "sketch", rotulo: "Sketch", grupos: [] }],
});
// a faixa é a da aba Sketch do WJCAD: refeita a cada renderização da casca
const renderizarCasca = casca.renderizar.bind(casca);
casca.renderizar = () => {
  renderizarCasca();
  montarFaixa();
};

document.addEventListener("keydown", (e) => {
  if ((e.target as HTMLElement).closest("input, select, textarea, .wj-janela")) return;
  const ctrl = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  if (ctrl && k === "z" && !e.shiftKey) desfazer();
  else if (ctrl && (k === "y" || (k === "z" && e.shiftKey))) refazer();
  else if (ctrl && k === "a" && editor) editor.selecionarTudo();
  else if (ctrl) return;
  else if (editor && editor.teclado(e)) {
    /* atalhos do esboço (os mesmos do WJCAD) */
  } else if (k === "f") enquadrar();
  else return;
  e.preventDefault();
});
new ResizeObserver(() => desenharCg()).observe($("#ce-viewport"));

registrarOffline();
casca.renderizar();
montarCalculadoras();
painelEsboco();
painelResultados();
void iniciarEditor();
