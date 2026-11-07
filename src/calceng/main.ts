// WJCalcEng: cálculos de engenharia do curso (especificação: docs/global/wjcalceng.md).
// Primeiro módulo: centro de gravidade em 2D. Esboço de figuras (retângulo, círculo, setor,
// triângulo, polígono, furos), cotas dirigidas, material único ou massa por figura; resultados
// (CG de cada figura e do conjunto, momentos de inércia) e memória de cálculo. Motor: cg2d.ts.

import "./calceng.css";
import { $, autosave, Casca, escapar, escolherArquivo, Historico, janela, menu, registrarOffline, salvarArquivo } from "../comum/casca";
import { IC } from "../comum/icones";
import {
  aplicarCotas, calcular, contem, docNovo, excluirFigura, medir, NOME_TIPO, pontosDe, posicao, tipoAutomatico, transladar, validarDoc,
  type Cota, type DocCalc, type Figura, type Ponto, type RefPonto, type ResultadoCg, type TipoCota,
} from "./cg2d";

const CHAVE = "wjcalc:documento";
const RAD = Math.PI / 180;

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
const cg = () => doc.cg2d;
const historico = new Historico<DocCalc>();
let conflitos = new Set<string>();
let res: ResultadoCg = calcular(cg());

function recalcular() {
  conflitos = aplicarCotas(cg());
  res = calcular(cg());
}
recalcular();
historico.limpar(doc);

/** Alteração confirmada: cotas, resultados, histórico, salvamento automático e tela. */
function alterar(muda: () => void) {
  muda();
  recalcular();
  historico.registrar(doc);
  autosave.guardar(CHAVE, doc);
  painel();
  desenhar();
}

function trocarDoc(d: DocCalc) {
  doc = d;
  sel = null;
  ferramenta = "selecionar";
  cancelarRascunho();
  atualizarDica();
  recalcular();
  historico.limpar(doc);
  autosave.guardar(CHAVE, doc);
  casca.renderizar();
  painel();
  enquadrar();
}

const uid = () => Math.random().toString(36).slice(2, 9);
const figura = (id: string | null) => cg().figuras.find((f) => f.id === id);
function nomeNovo(base: string) {
  let n = 1;
  while (cg().figuras.some((f) => f.nome === `${base} ${n}`)) n++;
  return `${base} ${n}`;
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
    const m = v / 10 ** e;
    t = `${m.toLocaleString("pt-BR", { maximumFractionDigits: 3 })} × 10${e < 0 ? "⁻" : ""}${String(Math.abs(e)).split("").map((d) => SOBRE[+d]).join("")}`;
  } else t = (Math.abs(v) < 5e-13 ? 0 : v).toLocaleString("pt-BR", { maximumFractionDigits: a >= 100 ? 2 : a >= 1 ? 4 : 6 });
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
/** Valor para um campo editável (sem separador de milhar). */
const campo = (v: number) => (Number.isFinite(v) ? String(+v.toFixed(6)).replace(".", ",") : "");

// ---------------------------------------------------------------------------------------------
// vista (mm → px), grade e ajuste

const tela = $<HTMLCanvasElement>("#ce-tela");
const ctx = tela.getContext("2d")!;
const vista = { esc: 3, ox: 80, oy: 400, w: 800, h: 500 };
const paraTela = (p: Ponto) => ({ x: vista.ox + p.x * vista.esc, y: vista.oy - p.y * vista.esc });
const paraMundo = (x: number, y: number): Ponto => ({ x: (x - vista.ox) / vista.esc, y: (vista.oy - y) / vista.esc });
const toque = () => document.body.classList.contains("disp-tablet") || document.body.classList.contains("disp-celular");
const raioPega = () => (toque() ? 22 : 12);

/** Passo da grade (mm): 1, 2 ou 5 × 10ⁿ, com pelo menos 14 px na tela. */
function passoGrade(): number {
  const alvo = 14 / vista.esc;
  const e = 10 ** Math.floor(Math.log10(alvo));
  return [1, 2, 5, 10].map((k) => k * e).find((p) => p >= alvo) ?? 10 * e;
}
let ajustar = true;

/** Ponto notável mais perto do cursor (origem ou ponto de figura). */
function pontoProximo(px: number, py: number, ignorar?: string): { ref: RefPonto; p: Ponto } | null {
  let melhor: { ref: RefPonto; p: Ponto } | null = null;
  let dm = raioPega();
  const testa = (ref: RefPonto, p: Ponto) => {
    const t = paraTela(p), d = Math.hypot(t.x - px, t.y - py);
    if (d < dm) {
      dm = d;
      melhor = { ref, p };
    }
  };
  testa({ fig: null, p: "o" }, { x: 0, y: 0 });
  for (const f of cg().figuras) {
    if (f.id === ignorar) continue;
    for (const [k, p] of Object.entries(pontosDe(f))) testa({ fig: f.id, p: k }, p);
  }
  return melhor;
}

/** Ponto do mundo com ajuste: ponto notável → grade. */
function ajustado(px: number, py: number): { p: Ponto; pegou: boolean } {
  const pr = pontoProximo(px, py);
  if (pr) return { p: { ...pr.p }, pegou: true };
  const m = paraMundo(px, py);
  if (!ajustar) return { p: m, pegou: false };
  const g = passoGrade();
  return { p: { x: Math.round(m.x / g) * g, y: Math.round(m.y / g) * g }, pegou: false };
}

// ---------------------------------------------------------------------------------------------
// ferramentas e rascunho

type Ferramenta = "selecionar" | "retangulo" | "circulo" | "setor" | "triangulo" | "poligono" | "cota";
let ferramenta: Ferramenta = "selecionar";
let sel: { tipo: "fig" | "cota"; id: string } | null = null;
const rascunho: { pts: Ponto[]; atual: Ponto | null; refA: RefPonto | null } = { pts: [], atual: null, refA: null };
let cursor: { p: Ponto; pegou: boolean } | null = null;

const DICAS: Record<Ferramenta, string> = {
  selecionar: "Toque numa figura ou cota para editar; arraste para mover. Mouse: meio arrasta a vista, roda aproxima. Dedo (com caneta): navega.",
  retangulo: "Retângulo: arraste de um canto ao outro (ou toque nos dois cantos).",
  circulo: "Círculo: toque no centro e arraste até o raio.",
  setor: "Setor circular: toque no centro e arraste para o lado da curva (semicírculo; a abertura muda no painel).",
  triangulo: "Triângulo: toque nos três vértices.",
  poligono: "Polígono: toque em cada vértice; feche tocando no primeiro, com toque duplo ou Enter.",
  cota: "Cota: toque em dois pontos (cantos, centros, origem) ou na borda de um círculo para o raio. Depois digite o valor no painel.",
};

function usarFerramenta(f: Ferramenta) {
  ferramenta = f;
  cancelarRascunho();
  casca.renderizar();
  atualizarDica();
  desenhar();
}
function cancelarRascunho() {
  rascunho.pts = [];
  rascunho.atual = null;
  rascunho.refA = null;
}
function atualizarDica() {
  const d = $("#ce-dica");
  let t = DICAS[ferramenta];
  if (ferramenta === "cota" && rascunho.refA) t = "Cota: agora toque no segundo ponto.";
  if (ferramenta === "poligono" && rascunho.pts.length) t = `Polígono: ${rascunho.pts.length} vértice(s). Toque no primeiro, toque duplo ou Enter para fechar.`;
  d.innerHTML = `<span>${escapar(t)}</span>${ferramenta === "poligono" && rascunho.pts.length >= 3 ? `<button data-d="fechar">Fechar polígono</button>` : ""}${ferramenta !== "selecionar" ? `<button data-d="sair">Concluir (Esc)</button>` : ""}`;
  d.querySelector<HTMLElement>('[data-d="fechar"]')?.addEventListener("click", fecharPoligono);
  d.querySelector<HTMLElement>('[data-d="sair"]')?.addEventListener("click", () => usarFerramenta("selecionar"));
}

function criarFigura(f: Figura) {
  alterar(() => cg().figuras.push(f));
  sel = { tipo: "fig", id: f.id };
  painel();
  desenhar();
}

/** Figura de dois pontos (retângulo, círculo, setor). */
function finalizarDoisPontos(a: Ponto, b: Ponto) {
  const id = uid();
  if (ferramenta === "retangulo") {
    const l = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
    if (l < 1e-9 || h < 1e-9) return;
    criarFigura({ id, nome: nomeNovo("Retângulo"), tipo: "retangulo", x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), l, a: h });
  } else {
    const r = Math.hypot(b.x - a.x, b.y - a.y);
    if (r < 1e-9) return;
    if (ferramenta === "circulo") criarFigura({ id, nome: nomeNovo("Círculo"), tipo: "circulo", cx: a.x, cy: a.y, r });
    else {
      // a curva fica para o lado do arraste; múltiplos de 15°
      const ang = Math.round(Math.atan2(b.y - a.y, b.x - a.x) / RAD / 15) * 15;
      criarFigura({ id, nome: nomeNovo("Setor"), tipo: "setor", cx: a.x, cy: a.y, r, a0: ang - 90, varre: 180 });
    }
  }
}

function fecharPoligono() {
  const pts = rascunho.pts;
  if (pts.length < 3) return;
  const base = ferramenta === "triangulo" || pts.length === 3 ? "Triângulo" : "Polígono";
  cancelarRascunho();
  criarFigura({ id: uid(), nome: nomeNovo(base), tipo: "poligono", pts });
  atualizarDica();
}

/** Borda de círculo/setor perto do ponto (cota de raio/diâmetro). */
function bordaCircular(px: number, py: number): Figura | null {
  const m = paraMundo(px, py);
  for (const f of [...cg().figuras].reverse()) {
    if (f.tipo !== "circulo" && f.tipo !== "setor") continue;
    const d = Math.abs(Math.hypot(m.x - f.cx, m.y - f.cy) - f.r) * vista.esc;
    if (d < raioPega() && (f.tipo === "circulo" || contem({ ...f, r: f.r * 1.5 }, m))) return f;
  }
  return null;
}

function criarCota(c: Omit<Cota, "id" | "valor" | "dirigida" | "desloc">, desloc: number) {
  const cota: Cota = { ...c, id: uid(), valor: 0, dirigida: true, desloc };
  cota.valor = medir(cg(), cota);
  if (!Number.isFinite(cota.valor)) return;
  // cota que não fecha com as outras entra como referência (não muda nada)
  const teste = structuredClone(cg());
  teste.cotas.push(cota);
  if (aplicarCotas(teste).size) {
    cota.dirigida = false;
    casca.avisar("Esta medida já está definida por outras cotas: a cota entrou como referência.", 5000);
  }
  alterar(() => cg().cotas.push(cota));
  sel = { tipo: "cota", id: cota.id };
  painel(true);
  desenhar();
}

function toqueCota(px: number, py: number) {
  const pr = pontoProximo(px, py);
  if (!rascunho.refA) {
    if (pr) {
      rascunho.refA = pr.ref;
      rascunho.pts = [pr.p];
    } else {
      const f = bordaCircular(px, py);
      if (f) criarCota({ tipo: f.tipo === "circulo" ? "diametro" : "raio", a: { fig: f.id, p: "c" } }, 0);
      else casca.avisar("Toque num canto, centro, vértice, na origem ou na borda de um círculo.");
    }
  } else if (pr && !(pr.ref.fig === rascunho.refA.fig && pr.ref.p === rascunho.refA.p)) {
    const pa = rascunho.pts[0];
    const tipo = tipoAutomatico(pa, pr.p);
    const desloc = tipo === "alinhada" ? 24 / vista.esc : 24 / vista.esc + (tipo === "horizontal" ? Math.abs(pr.p.y - pa.y) / 2 : Math.abs(pr.p.x - pa.x) / 2);
    const a = rascunho.refA;
    cancelarRascunho();
    criarCota({ tipo, a, b: pr.ref }, tipo === "vertical" ? -desloc : desloc);
  }
  atualizarDica();
  desenhar();
}

// ---------------------------------------------------------------------------------------------
// geometria das cotas na tela

interface GeoCota {
  linhas: [Ponto, Ponto][];
  setas: [Ponto, Ponto][];
  texto: Ponto;
  rotulo: string;
}
function geoCota(c: Cota): GeoCota | null {
  const v = c.tipo === "diametro" ? `Ø${fmt(c.valor)}` : c.tipo === "raio" ? `R${fmt(c.valor)}` : fmt(c.valor);
  const rotulo = c.dirigida ? v : `(${v})`;
  if (c.tipo === "raio" || c.tipo === "diametro") {
    const f = figura(c.a.fig);
    if (!f || (f.tipo !== "circulo" && f.tipo !== "setor")) return null;
    const ang = f.tipo === "setor" ? (f.a0 + f.varre / 2) * RAD : Math.PI / 4;
    const u = { x: Math.cos(ang), y: Math.sin(ang) };
    const fora = { x: f.cx + u.x * f.r, y: f.cy + u.y * f.r };
    const ini = c.tipo === "diametro" ? { x: f.cx - u.x * f.r, y: f.cy - u.y * f.r } : { x: f.cx, y: f.cy };
    const ext = { x: fora.x + (u.x * 20) / vista.esc, y: fora.y + (u.y * 20) / vista.esc };
    return { linhas: [[ini, ext]], setas: c.tipo === "diametro" ? [[fora, ini], [ini, fora]] : [[ini, fora]], texto: { x: ext.x + (u.x * 14) / vista.esc, y: ext.y + (u.y * 14) / vista.esc }, rotulo };
  }
  const pa = posicao(cg(), c.a), pb = c.b ? posicao(cg(), c.b) : null;
  if (!pa || !pb) return null;
  let a: Ponto, b: Ponto;
  if (c.tipo === "horizontal") {
    const y = (pa.y + pb.y) / 2 + c.desloc;
    a = { x: pa.x, y };
    b = { x: pb.x, y };
  } else if (c.tipo === "vertical") {
    const x = (pa.x + pb.x) / 2 + c.desloc;
    a = { x, y: pa.y };
    b = { x, y: pb.y };
  } else {
    const d = Math.hypot(pb.x - pa.x, pb.y - pa.y) || 1;
    const n = { x: -(pb.y - pa.y) / d, y: (pb.x - pa.x) / d };
    a = { x: pa.x + n.x * c.desloc, y: pa.y + n.y * c.desloc };
    b = { x: pb.x + n.x * c.desloc, y: pb.y + n.y * c.desloc };
  }
  return { linhas: [[pa, a], [pb, b], [a, b]], setas: [[b, a], [a, b]], texto: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, rotulo };
}

/** Novo afastamento da cota arrastada até o ponto m. */
function deslocPara(c: Cota, m: Ponto): number {
  const pa = posicao(cg(), c.a), pb = c.b ? posicao(cg(), c.b) : null;
  if (!pa || !pb) return c.desloc;
  if (c.tipo === "horizontal") return m.y - (pa.y + pb.y) / 2;
  if (c.tipo === "vertical") return m.x - (pa.x + pb.x) / 2;
  const d = Math.hypot(pb.x - pa.x, pb.y - pa.y) || 1;
  return ((m.x - pa.x) * -(pb.y - pa.y) + (m.y - pa.y) * (pb.x - pa.x)) / d;
}

function distSeg(p: Ponto, a: Ponto, b: Ponto) {
  const dx = b.x - a.x, dy = b.y - a.y, l = dx * dx + dy * dy;
  const t = l ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

function acharCota(px: number, py: number): Cota | null {
  for (const c of [...cg().cotas].reverse()) {
    const g = geoCota(c);
    if (!g) continue;
    const t = paraTela(g.texto);
    if (Math.abs(t.x - px) < 34 && Math.abs(t.y - py) < 16) return c;
    const [a, b] = g.linhas[g.linhas.length - 1];
    if (distSeg({ x: px, y: py }, paraTela(a), paraTela(b)) < raioPega() / 2) return c;
  }
  return null;
}
function acharFigura(px: number, py: number): Figura | null {
  const m = paraMundo(px, py);
  const lista = [...cg().figuras];
  // furos por cima das figuras sólidas (como são desenhados)
  lista.sort((a, b) => Number(!!a.furo) - Number(!!b.furo));
  for (const f of lista.reverse()) if (contem(f, m)) return f;
  return null;
}

// ---------------------------------------------------------------------------------------------
// desenho

let pedido = 0;
function desenhar() {
  if (!pedido) pedido = requestAnimationFrame(pintar);
}

const COR = { acento: "#2f7fd0", sel: "#e07a10", texto: "#1e2730", texto2: "#5e6b78", grade: "#e3e8ed", grade2: "#cdd5dd", furo: "#c9372c", cota: "#1f4e79", ref: "#6b7785", erro: "#c9372c" };

function caminhoFigura(f: Figura) {
  ctx.beginPath();
  if (f.tipo === "retangulo" || f.tipo === "poligono") {
    const pts = f.tipo === "retangulo" ? [{ x: f.x, y: f.y }, { x: f.x + f.l, y: f.y }, { x: f.x + f.l, y: f.y + f.a }, { x: f.x, y: f.y + f.a }] : f.pts;
    pts.forEach((p, i) => {
      const t = paraTela(p);
      if (i) ctx.lineTo(t.x, t.y);
      else ctx.moveTo(t.x, t.y);
    });
    ctx.closePath();
  } else {
    const c = paraTela({ x: f.cx, y: f.cy });
    const r = f.r * vista.esc;
    if (f.tipo === "circulo") ctx.arc(c.x, c.y, r, 0, 2 * Math.PI);
    else {
      ctx.moveTo(c.x, c.y);
      // y da tela é para baixo: ângulos trocam de sinal
      ctx.arc(c.x, c.y, r, -f.a0 * RAD, -(f.a0 + f.varre) * RAD, true);
      ctx.closePath();
    }
  }
}

function simboloCg(p: Ponto, r: number, cor: string) {
  const t = paraTela(p);
  ctx.save();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = cor;
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.arc(t.x, t.y, r, 0, 2 * Math.PI);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = cor;
  for (const a0 of [0, Math.PI]) {
    ctx.beginPath();
    ctx.moveTo(t.x, t.y);
    ctx.arc(t.x, t.y, r, a0 - Math.PI / 2, a0);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function seta(de: Ponto, para: Ponto, cor: string) {
  const a = paraTela(de), b = paraTela(para);
  const ang = Math.atan2(b.y - a.y, b.x - a.x), s = 8;
  ctx.fillStyle = cor;
  ctx.beginPath();
  ctx.moveTo(b.x, b.y);
  ctx.lineTo(b.x - s * Math.cos(ang - 0.35), b.y - s * Math.sin(ang - 0.35));
  ctx.lineTo(b.x - s * Math.cos(ang + 0.35), b.y - s * Math.sin(ang + 0.35));
  ctx.closePath();
  ctx.fill();
}

function etiqueta(texto: string, p: Ponto, cor: string, fundo = "rgba(255,255,255,.88)", dx = 0, dy = 0) {
  const t = paraTela(p);
  ctx.font = "600 13px system-ui, sans-serif";
  const w = ctx.measureText(texto).width + 8;
  ctx.fillStyle = fundo;
  ctx.fillRect(t.x + dx - w / 2, t.y + dy - 9, w, 18);
  ctx.fillStyle = cor;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(texto, t.x + dx, t.y + dy + 0.5);
}

function pintar() {
  pedido = 0;
  const { w, h } = vista;
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  ctx.fillStyle = "#fbfcfd";
  ctx.fillRect(0, 0, w, h);
  // grade
  const g = passoGrade(), forte = g * 5;
  const m0 = paraMundo(0, h), m1 = paraMundo(w, 0);
  for (const [passo, cor] of [[g, COR.grade], [forte, COR.grade2]] as const) {
    ctx.strokeStyle = cor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = Math.ceil(m0.x / passo) * passo; x <= m1.x; x += passo) {
      const t = Math.round(paraTela({ x, y: 0 }).x) + 0.5;
      ctx.moveTo(t, 0);
      ctx.lineTo(t, h);
    }
    for (let y = Math.ceil(m0.y / passo) * passo; y <= m1.y; y += passo) {
      const t = Math.round(paraTela({ x: 0, y }).y) + 0.5;
      ctx.moveTo(0, t);
      ctx.lineTo(w, t);
    }
    ctx.stroke();
  }
  // eixos da origem
  const o = paraTela({ x: 0, y: 0 });
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 4]);
  ctx.strokeStyle = "#9aa6b2";
  ctx.beginPath();
  ctx.moveTo(0, o.y);
  ctx.lineTo(w, o.y);
  ctx.moveTo(o.x, 0);
  ctx.lineTo(o.x, h);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.lineWidth = 2;
  for (const [dx, dy, cor, nome] of [[1, 0, "#c9372c", "x"], [0, 1, "#2e8b57", "y"]] as const) {
    ctx.strokeStyle = ctx.fillStyle = cor;
    ctx.beginPath();
    ctx.moveTo(o.x, o.y);
    ctx.lineTo(o.x + dx * 40, o.y - dy * 40);
    ctx.stroke();
    seta({ x: 0, y: 0 }, { x: (dx * 40) / vista.esc, y: (dy * 40) / vista.esc }, cor);
    ctx.font = "600 13px system-ui, sans-serif";
    ctx.fillText(nome, o.x + dx * 48 - 4, o.y - dy * 48 + 4);
  }

  // figuras: sólidas e depois furos
  const ordem = [...cg().figuras].sort((a, b) => Number(!!a.furo) - Number(!!b.furo));
  for (const f of ordem) {
    caminhoFigura(f);
    const s = sel?.tipo === "fig" && sel.id === f.id;
    if (f.furo) {
      ctx.fillStyle = "#fbfcfd";
      ctx.fill();
      ctx.save();
      ctx.clip();
      ctx.strokeStyle = "rgba(201,55,44,.35)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let k = -h; k < w + h; k += 10) {
        ctx.moveTo(k, 0);
        ctx.lineTo(k - h, h);
      }
      ctx.stroke();
      ctx.restore();
      caminhoFigura(f);
      ctx.setLineDash([7, 4]);
      ctx.strokeStyle = s ? COR.sel : COR.furo;
    } else {
      ctx.fillStyle = s ? "rgba(224,122,16,.16)" : "rgba(47,127,208,.16)";
      ctx.fill();
      ctx.strokeStyle = s ? COR.sel : COR.acento;
    }
    ctx.lineWidth = s ? 3 : 2;
    ctx.stroke();
    ctx.setLineDash([]);
  }
  // pontos notáveis (cotas e figura selecionada)
  if (ferramenta === "cota" || sel?.tipo === "fig") {
    for (const f of cg().figuras) {
      if (ferramenta !== "cota" && f.id !== sel?.id) continue;
      for (const p of Object.values(pontosDe(f))) {
        const t = paraTela(p);
        ctx.fillStyle = "#fff";
        ctx.strokeStyle = COR.cota;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(t.x, t.y, 4, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();
      }
    }
  }
  // cotas
  for (const c of cg().cotas) {
    const gc = geoCota(c);
    if (!gc) continue;
    const s = sel?.tipo === "cota" && sel.id === c.id;
    const cor = conflitos.has(c.id) ? COR.erro : s ? COR.sel : c.dirigida ? COR.cota : COR.ref;
    ctx.strokeStyle = cor;
    ctx.lineWidth = s ? 2 : 1.2;
    ctx.beginPath();
    for (const [a, b] of gc.linhas) {
      const ta = paraTela(a), tb = paraTela(b);
      ctx.moveTo(ta.x, ta.y);
      ctx.lineTo(tb.x, tb.y);
    }
    ctx.stroke();
    for (const [de, para] of gc.setas) seta(de, para, cor);
    etiqueta(gc.rotulo, gc.texto, cor);
  }
  // CG de cada figura e do conjunto
  for (const f of res.figuras) {
    simboloCg({ x: f.x, y: f.y }, 5, f.furo ? COR.furo : COR.acento);
    etiqueta(f.nome, { x: f.x, y: f.y }, COR.texto2, "rgba(255,255,255,.7)", 0, 16);
  }
  if (doc.cg2d.material.modo === "massa" && res.centroide && res.cg && Math.hypot(res.centroide.x - res.cg.x, res.centroide.y - res.cg.y) * vista.esc > 3) {
    const t = paraTela(res.centroide);
    ctx.strokeStyle = COR.texto2;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(t.x - 6, t.y - 6);
    ctx.lineTo(t.x + 6, t.y + 6);
    ctx.moveTo(t.x + 6, t.y - 6);
    ctx.lineTo(t.x - 6, t.y + 6);
    ctx.stroke();
    etiqueta("centroide da área", res.centroide, COR.texto2, "rgba(255,255,255,.8)", 0, -16);
  }
  if (res.cg) {
    simboloCg(res.cg, 10, "#111");
    etiqueta(`CG (${fmt(res.cg.x)}; ${fmt(res.cg.y)})`, res.cg, "#fff", "#1e2730", 0, -22);
  }
  // rascunho da ferramenta
  const atual = rascunho.atual;
  if (rascunho.pts.length && atual && ferramenta !== "cota") {
    ctx.strokeStyle = COR.sel;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    const a = rascunho.pts[0];
    let texto = "";
    if (ferramenta === "retangulo") {
      caminhoFigura({ id: "", nome: "", tipo: "retangulo", x: Math.min(a.x, atual.x), y: Math.min(a.y, atual.y), l: Math.abs(atual.x - a.x), a: Math.abs(atual.y - a.y) });
      texto = `${fmt(Math.abs(atual.x - a.x))} × ${fmt(Math.abs(atual.y - a.y))}`;
    } else if (ferramenta === "circulo" || ferramenta === "setor") {
      const r = Math.hypot(atual.x - a.x, atual.y - a.y);
      const ang = Math.round(Math.atan2(atual.y - a.y, atual.x - a.x) / RAD / 15) * 15;
      caminhoFigura(ferramenta === "circulo" ? { id: "", nome: "", tipo: "circulo", cx: a.x, cy: a.y, r } : { id: "", nome: "", tipo: "setor", cx: a.x, cy: a.y, r, a0: ang - 90, varre: 180 });
      texto = `R ${fmt(r)}`;
    } else {
      ctx.beginPath();
      [...rascunho.pts, atual].forEach((p, i) => {
        const t = paraTela(p);
        if (i) ctx.lineTo(t.x, t.y);
        else ctx.moveTo(t.x, t.y);
      });
      texto = `${fmt(Math.hypot(atual.x - rascunho.pts[rascunho.pts.length - 1].x, atual.y - rascunho.pts[rascunho.pts.length - 1].y))}`;
    }
    ctx.stroke();
    ctx.setLineDash([]);
    etiqueta(texto, atual, COR.sel, "rgba(255,255,255,.9)", 0, -20);
  }
  if (ferramenta === "cota" && rascunho.refA && atual) {
    const a = paraTela(rascunho.pts[0]), b = paraTela(atual);
    ctx.strokeStyle = COR.sel;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  // cursor com ajuste
  if (cursor && ferramenta !== "selecionar") {
    const t = paraTela(cursor.p);
    ctx.strokeStyle = cursor.pegou ? COR.sel : COR.texto2;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (cursor.pegou) ctx.arc(t.x, t.y, 7, 0, 2 * Math.PI);
    else {
      ctx.moveTo(t.x - 7, t.y);
      ctx.lineTo(t.x + 7, t.y);
      ctx.moveTo(t.x, t.y - 7);
      ctx.lineTo(t.x, t.y + 7);
    }
    ctx.stroke();
  }
  status();
}

function status() {
  const c = cursor ? `x ${fmt(cursor.p.x)} · y ${fmt(cursor.p.y)} mm · ` : "";
  casca.definirStatus(`${c}Grade ${fmt(passoGrade())} mm · Ajuste ${ajustar ? "ligado" : "desligado"} · Unidades: mm, kg`);
}

function redimensionar() {
  const r = tela.parentElement!.getBoundingClientRect();
  const w = Math.max(50, Math.floor(r.width)), h = Math.max(50, Math.floor(r.height));
  if (w === vista.w && h === vista.h && tela.width) return;
  // mantém o ponto do mundo no centro
  const centro = paraMundo(vista.w / 2, vista.h / 2);
  vista.w = w;
  vista.h = h;
  tela.width = Math.round(w * devicePixelRatio);
  tela.height = Math.round(h * devicePixelRatio);
  tela.style.width = `${w}px`;
  tela.style.height = `${h}px`;
  vista.ox = w / 2 - centro.x * vista.esc;
  vista.oy = h / 2 + centro.y * vista.esc;
  desenhar();
}

/** Enquadra figuras e origem. */
function enquadrar() {
  let x0 = 0, y0 = 0, x1 = 0, y1 = 0;
  const inclui = (p: Ponto, r = 0) => {
    x0 = Math.min(x0, p.x - r);
    y0 = Math.min(y0, p.y - r);
    x1 = Math.max(x1, p.x + r);
    y1 = Math.max(y1, p.y + r);
  };
  for (const f of cg().figuras) {
    if (f.tipo === "circulo" || f.tipo === "setor") inclui({ x: f.cx, y: f.cy }, f.r);
    else for (const p of Object.values(pontosDe(f))) inclui(p);
  }
  if (x1 - x0 < 1e-9 && y1 - y0 < 1e-9) {
    x1 = 100;
    y1 = 60;
  }
  const m = 70;
  vista.esc = Math.min((vista.w - 2 * m) / Math.max(x1 - x0, 1e-6), (vista.h - 2 * m) / Math.max(y1 - y0, 1e-6));
  vista.esc = Math.min(Math.max(vista.esc, 1e-3), 1e4);
  vista.ox = vista.w / 2 - ((x0 + x1) / 2) * vista.esc;
  vista.oy = vista.h / 2 + ((y0 + y1) / 2) * vista.esc;
  desenhar();
}

function zoom(fator: number, px: number, py: number) {
  const m = paraMundo(px, py);
  vista.esc = Math.min(Math.max(vista.esc * fator, 1e-3), 1e4);
  vista.ox = px - m.x * vista.esc;
  vista.oy = py + m.y * vista.esc;
  desenhar();
}

// ---------------------------------------------------------------------------------------------
// entrada: caneta e mouse desenham; dedo navega quando há caneta (senão também desenha)

const ponteiros = new Map<number, { x: number; y: number }>();
let viuCaneta = false;
let pinca: { d0: number; esc0: number; m0: Ponto } | null = null;
type Acao =
  | { tipo: "pan"; x: number; y: number }
  | { tipo: "mover"; id: string; ini: Ponto; copia: string; moveu: boolean }
  | { tipo: "cota"; id: string; copia: number; moveu: boolean }
  | { tipo: "desenho"; ini: { x: number; y: number }; novo: boolean };
let acao: Acao | null = null;
let tLongo = 0;
let inicio = { x: 0, y: 0 };
let ultimoToque = { t: 0, x: 0, y: 0 };
let ultimoTipo = "mouse";

const local = (e: PointerEvent | MouseEvent) => {
  const r = tela.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
};

function desfazerAcao() {
  if (acao?.tipo === "mover") {
    const i = cg().figuras.findIndex((f) => f.id === (acao as { id: string }).id);
    if (i >= 0) cg().figuras[i] = JSON.parse(acao.copia) as Figura;
    recalcular();
  } else if (acao?.tipo === "cota") {
    const c = cg().cotas.find((x) => x.id === (acao as { id: string }).id);
    if (c) c.desloc = acao.copia;
  }
  acao = null;
  desenhar();
}

tela.addEventListener("pointerdown", (e) => {
  ultimoTipo = e.pointerType;
  if (e.pointerType === "pen") viuCaneta = true;
  try {
    tela.setPointerCapture(e.pointerId);
  } catch {
    /* ponteiro já solto */
  }
  const p = local(e);
  ponteiros.set(e.pointerId, p);
  clearTimeout(tLongo);
  if (ponteiros.size === 2) {
    // dois dedos: aproxima e arrasta a vista
    desfazerAcao();
    const [a, b] = [...ponteiros.values()];
    pinca = { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, esc0: vista.esc, m0: paraMundo((a.x + b.x) / 2, (a.y + b.y) / 2) };
    return;
  }
  if (ponteiros.size > 2) return;
  inicio = p;
  if (e.button === 2) return;
  if (e.button === 1 || (e.pointerType === "touch" && viuCaneta)) {
    acao = { tipo: "pan", x: p.x, y: p.y };
    e.preventDefault();
    return;
  }
  if (e.pointerType !== "mouse") tLongo = window.setTimeout(() => {
    desfazerAcao();
    menuContexto(p.x, p.y);
  }, 600);
  if (ferramenta === "selecionar") {
    const c = acharCota(p.x, p.y);
    const f = c ? null : acharFigura(p.x, p.y);
    if (c) {
      sel = { tipo: "cota", id: c.id };
      acao = { tipo: "cota", id: c.id, copia: c.desloc, moveu: false };
    } else if (f) {
      sel = { tipo: "fig", id: f.id };
      acao = { tipo: "mover", id: f.id, ini: paraMundo(p.x, p.y), copia: JSON.stringify(f), moveu: false };
    } else {
      sel = null;
      acao = { tipo: "pan", x: p.x, y: p.y };
    }
    painel();
    desenhar();
    return;
  }
  const novo = !rascunho.pts.length;
  if (ferramenta === "retangulo" || ferramenta === "circulo" || ferramenta === "setor") {
    const a = ajustado(p.x, p.y).p;
    if (novo) rascunho.pts = [a];
    rascunho.atual = a;
  }
  acao = { tipo: "desenho", ini: p, novo };
  desenhar();
});

tela.addEventListener("pointermove", (e) => {
  const p = local(e);
  if (ponteiros.has(e.pointerId)) ponteiros.set(e.pointerId, p);
  if (Math.hypot(p.x - inicio.x, p.y - inicio.y) > 8) clearTimeout(tLongo);
  if (pinca && ponteiros.size === 2) {
    const [a, b] = [...ponteiros.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    vista.esc = Math.min(Math.max((pinca.esc0 * d) / pinca.d0, 1e-3), 1e4);
    const c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    vista.ox = c.x - pinca.m0.x * vista.esc;
    vista.oy = c.y + pinca.m0.y * vista.esc;
    desenhar();
    return;
  }
  if (ferramenta !== "selecionar") {
    cursor = ajustado(p.x, p.y);
    if (rascunho.pts.length) rascunho.atual = cursor.p;
  } else cursor = { p: paraMundo(p.x, p.y), pegou: false };
  if (!acao) return desenhar();
  if (acao.tipo === "pan") {
    vista.ox += p.x - acao.x;
    vista.oy += p.y - acao.y;
    acao.x = p.x;
    acao.y = p.y;
  } else if (acao.tipo === "mover") {
    const i = cg().figuras.findIndex((f) => f.id === (acao as { id: string }).id);
    if (i < 0) return;
    const m = paraMundo(p.x, p.y);
    let dx = m.x - acao.ini.x, dy = m.y - acao.ini.y;
    if (ajustar) {
      const g = passoGrade();
      dx = Math.round(dx / g) * g;
      dy = Math.round(dy / g) * g;
    }
    if (dx || dy) acao.moveu = true;
    const f = JSON.parse(acao.copia) as Figura;
    transladar(f, dx, dy);
    cg().figuras[i] = f;
    recalcular();
  } else if (acao.tipo === "cota") {
    const c = cg().cotas.find((x) => x.id === (acao as { id: string }).id);
    if (c && c.b) {
      c.desloc = deslocPara(c, paraMundo(p.x, p.y));
      acao.moveu = true;
    }
  }
  desenhar();
});

function soltar(e: PointerEvent) {
  clearTimeout(tLongo);
  const tinha = ponteiros.size;
  ponteiros.delete(e.pointerId);
  if (pinca) {
    if (!ponteiros.size) pinca = null;
    return;
  }
  if (tinha !== 1 || !acao) return;
  const a = acao;
  acao = null;
  const p = local(e);
  if (e.type === "pointercancel") return void desfazerAcao();
  if (a.tipo === "mover" || a.tipo === "cota") {
    if (a.moveu) alterar(() => {});
    return;
  }
  if (a.tipo !== "desenho") return;
  const arrastou = Math.hypot(p.x - a.ini.x, p.y - a.ini.y) > 8;
  const pt = ajustado(p.x, p.y).p;
  if (ferramenta === "retangulo" || ferramenta === "circulo" || ferramenta === "setor") {
    if (!a.novo || arrastou) {
      const ini = rascunho.pts[0];
      cancelarRascunho();
      if (ini) finalizarDoisPontos(ini, pt);
    }
  } else if (ferramenta === "triangulo" || ferramenta === "poligono") {
    const agora = performance.now();
    const duplo = agora - ultimoToque.t < 450 && Math.hypot(p.x - ultimoToque.x, p.y - ultimoToque.y) < 20;
    ultimoToque = { t: agora, x: p.x, y: p.y };
    const primeiro = rascunho.pts[0] && paraTela(rascunho.pts[0]);
    if (ferramenta === "poligono" && rascunho.pts.length >= 3 && (duplo || (primeiro && Math.hypot(primeiro.x - p.x, primeiro.y - p.y) < raioPega()))) return fecharPoligono();
    const ultimo = rascunho.pts[rascunho.pts.length - 1];
    if (!ultimo || Math.hypot(ultimo.x - pt.x, ultimo.y - pt.y) > 1e-9) rascunho.pts.push(pt);
    rascunho.atual = pt;
    if (ferramenta === "triangulo" && rascunho.pts.length === 3) return fecharPoligono();
    atualizarDica();
  } else if (ferramenta === "cota") toqueCota(p.x, p.y);
  desenhar();
}
tela.addEventListener("pointerup", soltar);
tela.addEventListener("pointercancel", soltar);
tela.addEventListener("pointerleave", () => {
  if (ultimoTipo === "mouse" && !acao) {
    cursor = null;
    desenhar();
  }
});
tela.addEventListener("wheel", (e) => {
  e.preventDefault();
  const p = local(e);
  zoom(Math.exp(-e.deltaY * 0.0015), p.x, p.y);
}, { passive: false });
tela.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  // no toque o menu abre pelo toque longo (temporizador próprio)
  if (ultimoTipo === "mouse") {
    const p = local(e);
    menuContexto(p.x, p.y);
  }
});

function menuContexto(px: number, py: number) {
  const r = tela.getBoundingClientRect();
  const x = r.left + px, y = r.top + py;
  if (rascunho.pts.length) {
    const itens: Parameters<typeof menu>[2] = [{ rotulo: "Cancelar desenho", acao: () => { cancelarRascunho(); atualizarDica(); desenhar(); } }];
    if (ferramenta === "poligono" && rascunho.pts.length >= 3) itens.unshift({ rotulo: "Fechar polígono", acao: fecharPoligono });
    return menu(x, y, itens);
  }
  const c = acharCota(px, py);
  if (c) {
    sel = { tipo: "cota", id: c.id };
    painel();
    desenhar();
    return menu(x, y, [
      { rotulo: c.dirigida ? "Tornar referência (só mostra)" : "Tornar dirigida (comanda)", acao: () => alterar(() => (c.dirigida = !c.dirigida)) },
      ...(c.b ? [{ rotulo: "Passar para o outro lado", acao: () => alterar(() => (c.desloc = -c.desloc)) }] : []),
      "-",
      { rotulo: "Excluir cota", icone: "apagar", acao: excluirSelecao },
    ]);
  }
  const f = acharFigura(px, py);
  if (f) {
    sel = { tipo: "fig", id: f.id };
    painel();
    desenhar();
    return menu(x, y, [
      { rotulo: f.furo ? "Tornar sólida" : "Tornar furo (vazio)", acao: () => alterar(() => (f.furo = !f.furo)) },
      { rotulo: "Duplicar", icone: "copiar", acao: duplicar },
      "-",
      { rotulo: "Excluir figura", icone: "apagar", acao: excluirSelecao },
    ]);
  }
  menu(x, y, [
    { rotulo: "Enquadrar (F)", acao: enquadrar },
    { rotulo: ajustar ? "Desligar ajuste à grade" : "Ligar ajuste à grade", acao: alternarAjuste },
    "-",
    { rotulo: "Retângulo", acao: () => usarFerramenta("retangulo") },
    { rotulo: "Círculo", acao: () => usarFerramenta("circulo") },
    { rotulo: "Cota", acao: () => usarFerramenta("cota") },
  ]);
}

function alternarAjuste() {
  ajustar = !ajustar;
  casca.renderizar();
  desenhar();
}

function excluirSelecao() {
  if (!sel) return;
  const s = sel;
  sel = null;
  alterar(() => {
    if (s.tipo === "fig") excluirFigura(cg(), s.id);
    else cg().cotas = cg().cotas.filter((c) => c.id !== s.id);
  });
}

function duplicar() {
  const f = sel?.tipo === "fig" ? figura(sel.id) : undefined;
  if (!f) return;
  const novo = JSON.parse(JSON.stringify(f)) as Figura;
  novo.id = uid();
  novo.nome = nomeNovo(f.nome.replace(/\s+\d+$/, ""));
  transladar(novo, 10 * passoGrade(), 0);
  criarFigura(novo);
}

document.addEventListener("keydown", (e) => {
  const alvo = e.target as HTMLElement;
  if (alvo.closest("input, select, textarea, .wj-janela")) return;
  const k = e.key;
  if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === "z") {
    e.preventDefault();
    desfazer();
  } else if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === "y") {
    e.preventDefault();
    refazer();
  } else if (e.ctrlKey || e.metaKey || e.altKey) return;
  else if (k === "Escape") {
    if (rascunho.pts.length || rascunho.refA) {
      cancelarRascunho();
      atualizarDica();
      desenhar();
    } else if (ferramenta !== "selecionar") usarFerramenta("selecionar");
    else {
      sel = null;
      painel();
      desenhar();
    }
  } else if (k === "Enter" && ferramenta === "poligono") fecharPoligono();
  else if (k === "Delete" || k === "Backspace") excluirSelecao();
  else {
    const atalho: Record<string, Ferramenta> = { r: "retangulo", c: "circulo", a: "setor", t: "triangulo", p: "poligono", d: "cota", v: "selecionar" };
    const f = atalho[k.toLowerCase()];
    if (f) usarFerramenta(f);
    else if (k.toLowerCase() === "f") enquadrar();
    else if (k.toLowerCase() === "g") alternarAjuste();
  }
});

function desfazer() {
  const d = historico.desfazer();
  if (!d) return;
  doc = d;
  depoisDoHistorico();
}
function refazer() {
  const d = historico.refazer();
  if (!d) return;
  doc = d;
  depoisDoHistorico();
}
function depoisDoHistorico() {
  if (sel && !(sel.tipo === "fig" ? figura(sel.id) : cg().cotas.some((c) => c.id === sel!.id))) sel = null;
  recalcular();
  autosave.guardar(CHAVE, doc);
  casca.renderizar();
  painel();
  desenhar();
}

// ---------------------------------------------------------------------------------------------
// painel: material, seleção e resultados

const painelEl = $("#ce-painel");

function linhaCampo(rotulo: string, chave: string, valor: string, unidade = "", extra = "") {
  return `<label class="ce-campo"><span>${rotulo}</span><input data-c="${chave}" value="${escapar(valor)}" inputmode="decimal" autocomplete="off" ${extra}/><em>${unidade}</em></label>`;
}

function camposFigura(f: Figura): string {
  const ehMassa = cg().material.modo === "massa";
  let h = `<label class="ce-campo"><span>Nome</span><input data-c="nome" value="${escapar(f.nome)}" autocomplete="off" /><em></em></label>
    <label class="ce-campo"><span>Tipo</span><select data-c="furo"><option value="0">Sólida</option><option value="1" ${f.furo ? "selected" : ""}>Furo (vazio)</option></select><em></em></label>`;
  if (f.tipo === "retangulo") {
    h += linhaCampo("Canto x", "x", campo(f.x), "mm") + linhaCampo("Canto y", "y", campo(f.y), "mm") + linhaCampo("Largura", "l", campo(f.l), "mm") + linhaCampo("Altura", "a", campo(f.a), "mm");
  } else if (f.tipo === "circulo" || f.tipo === "setor") {
    h += linhaCampo("Centro x", "cx", campo(f.cx), "mm") + linhaCampo("Centro y", "cy", campo(f.cy), "mm") + linhaCampo("Raio", "r", campo(f.r), "mm") + linhaCampo("Diâmetro", "d", campo(2 * f.r), "mm");
    if (f.tipo === "setor") {
      h += linhaCampo("Ângulo inicial", "a0", campo(f.a0), "°") + linhaCampo("Abertura", "varre", campo(f.varre), "°");
      h += `<div class="ce-rapidos"><span>Abertura:</span>${[90, 180, 270].map((v) => `<button data-varre="${v}" aria-pressed="${Math.abs(f.varre - v) < 1e-9}">${v}°</button>`).join("")}<button data-girar="90" title="Girar 90° no sentido anti-horário">↺ 90°</button></div>`;
    }
  } else {
    h += `<div class="ce-vertices"><span>Vértices (mm)</span>${f.pts.map((p, i) => `<div><b>${i + 1}</b><input data-c="px${i}" value="${campo(p.x)}" inputmode="decimal" aria-label="x do vértice ${i + 1}" /><input data-c="py${i}" value="${campo(p.y)}" inputmode="decimal" aria-label="y do vértice ${i + 1}" /></div>`).join("")}</div>`;
  }
  if (ehMassa) h += linhaCampo("Massa", "massa", f.massa === undefined ? "" : campo(f.massa), "kg", `placeholder="informe"${f.massa === undefined ? ' class="falta"' : ""}`);
  const r = res.figuras.find((x) => x.id === f.id);
  if (r) {
    h += `<dl class="ce-res">
      <dt>Área</dt><dd>${fmt(r.A, "mm²")}</dd>
      <dt>Massa</dt><dd>${fmt(r.m, "kg")}</dd>
      <dt>CG da figura</dt><dd>x̄ = ${fmt(r.x)} · ȳ = ${fmt(r.y)} mm</dd>
      <dt>Ix' (próprio)</dt><dd>${fmt(r.Ix, "mm⁴")}</dd>
      <dt>Iy' (próprio)</dt><dd>${fmt(r.Iy, "mm⁴")}</dd>
      <dt>Ixy' (próprio)</dt><dd>${fmt(r.Ixy, "mm⁴")}</dd></dl>`;
  }
  return `${h}<div class="ce-botoes"><button data-b="duplicar">Duplicar</button><button data-b="excluir" class="perigo">Excluir</button></div>`;
}

const NOME_COTA: Record<TipoCota, string> = { horizontal: "Horizontal", vertical: "Vertical", alinhada: "Alinhada", raio: "Raio", diametro: "Diâmetro" };

function camposCota(c: Cota): string {
  const nomeRef = (r: RefPonto) => {
    if (r.fig === null) return "Origem";
    const f = figura(r.fig);
    const k = r.p === "c" ? "centro" : r.p.startsWith("v") ? `vértice ${Number(r.p.slice(1)) + 1}` : r.p === "p0" ? "início do arco" : "fim do arco";
    return `${f?.nome ?? "?"} (${k})`;
  };
  const tipos: TipoCota[] = c.b ? ["horizontal", "vertical", "alinhada"] : ["raio", "diametro"];
  return `<label class="ce-campo"><span>Tipo</span><select data-c="tipo">${tipos.map((t) => `<option value="${t}" ${t === c.tipo ? "selected" : ""}>${NOME_COTA[t]}</option>`).join("")}</select><em></em></label>
    ${linhaCampo("Valor", "valor", campo(c.valor), "mm", c.dirigida ? "" : "disabled")}
    <label class="ce-check"><input type="checkbox" data-c="dirigida" ${c.dirigida ? "checked" : ""} /> Dirigida (o valor comanda a geometria)</label>
    ${conflitos.has(c.id) ? `<p class="ce-aviso">Esta cota entra em conflito com outra: desligue uma delas ou torne-a referência.</p>` : ""}
    <p class="ce-nota">${c.b ? `De ${escapar(nomeRef(c.a))} até ${escapar(nomeRef(c.b))}. Ao mudar o valor, a figura do segundo ponto se move (se os dois pontos são da mesma figura, ela muda de tamanho).` : `${escapar(figura(c.a.fig)?.nome ?? "")}.`}</p>
    <div class="ce-botoes">${c.b ? `<button data-b="lado">Outro lado</button>` : ""}<button data-b="excluir" class="perigo">Excluir</button></div>`;
}

function blocoResultados(): string {
  const mat = cg().material;
  if (!res.figuras.length) return `<p class="ce-nota">Desenhe as figuras (aba Esboço). O centro de gravidade de cada uma e o do conjunto aparecem aqui e no desenho.</p>`;
  const i = res.areaCentroide, o = res.areaOrigem, mi = res.massaCg;
  const ehMassa = mat.modo === "massa";
  const kgm2 = (v: number) => fmt(v * 1e-6, "kg·m²");
  return `
    ${res.cg ? `<div class="ce-destaque"><small>Centro de gravidade do conjunto</small><b>X = ${fmt(res.cg.x)} mm</b><b>Y = ${fmt(res.cg.y)} mm</b></div>` : ""}
    <dl class="ce-res">
      <dt>Massa total</dt><dd>${fmt(res.m, "kg")}</dd>
      <dt>Área líquida</dt><dd>${fmt(res.A, "mm²")}</dd>
      ${ehMassa && res.centroide ? `<dt>Centroide da área</dt><dd>${fmt(res.centroide.x)} ; ${fmt(res.centroide.y)} mm</dd>` : ""}
    </dl>
    ${res.avisos.map((a) => `<p class="ce-aviso">${escapar(a)}</p>`).join("")}
    <table class="ce-tabela"><thead><tr><th>Figura</th><th>m (kg)</th><th>x̄</th><th>ȳ</th></tr></thead><tbody>
      ${res.figuras.map((f) => `<tr data-f="${f.id}" class="${sel?.id === f.id ? "sel" : ""}"><td>${escapar(f.nome)}${f.furo ? " <small>(furo)</small>" : ""}</td><td>${fmt(f.m)}</td><td>${fmt(f.x)}</td><td>${fmt(f.y)}</td></tr>`).join("")}
    </tbody></table>
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
      <p class="ce-nota">Placa fina de massa uniforme em cada figura; Iz é em torno do eixo perpendicular ao plano, passando pelo CG.</p>` : ""}
    <div class="ce-botoes"><button data-b="memoria" class="destaque">Memória de cálculo</button><button data-b="copiar">Copiar tabela</button></div>`;
}

/** Monta o painel. `focarValor`: põe o cursor no valor da cota (logo depois de criá-la). */
function painel(focarValor = false) {
  const mat = cg().material;
  const f = sel?.tipo === "fig" ? figura(sel.id) : undefined;
  const c = sel?.tipo === "cota" ? cg().cotas.find((x) => x.id === sel!.id) : undefined;
  painelEl.innerHTML = `
    <section><h3>Massa das figuras</h3>
      <div class="ce-modo" role="group" aria-label="Como obter a massa">
        <button data-modo="densidade" aria-pressed="${mat.modo === "densidade"}">Mesmo material</button>
        <button data-modo="massa" aria-pressed="${mat.modo === "massa"}">Massa de cada figura</button>
      </div>
      ${mat.modo === "densidade" ? linhaCampo("Densidade ρ", "densidade", campo(mat.densidade), "kg/m³") + linhaCampo("Espessura", "espessura", campo(mat.espessura), "mm") + `<p class="ce-nota">Massa = ρ × espessura × área. Com um só material, o CG coincide com o centroide da área.</p>` : `<p class="ce-nota">Selecione cada figura e informe a massa dela (kg). Furo: massa retirada.</p>`}
    </section>
    <section><h3>${f ? (f.tipo === "poligono" && f.pts.length === 3 ? "Triângulo" : NOME_TIPO[f.tipo]) : c ? `Cota ${NOME_COTA[c.tipo].toLowerCase()}` : "Seleção"}</h3>
      ${f ? camposFigura(f) : c ? camposCota(c) : `<p class="ce-nota">Toque numa figura ou numa cota para ver e editar as medidas. Toque longo (ou botão direito) abre o menu.</p>`}
    </section>
    <section><h3>Resultados</h3>${blocoResultados()}</section>`;

  // material
  painelEl.querySelectorAll<HTMLElement>("[data-modo]").forEach((b) => (b.onclick = () => alterar(() => (cg().material.modo = b.dataset.modo as "densidade" | "massa"))));
  // campos numéricos/textos
  painelEl.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-c]").forEach((inp) => {
    inp.onchange = () => mudarCampo(inp.dataset.c!, inp, f, c);
    if (inp instanceof HTMLInputElement && inp.type !== "checkbox")
      inp.onkeydown = (e) => {
        if (e.key === "Enter") inp.blur();
      };
  });
  painelEl.querySelectorAll<HTMLElement>("[data-varre]").forEach((b) => (b.onclick = () => f?.tipo === "setor" && alterar(() => (f.varre = Number(b.dataset.varre)))));
  painelEl.querySelector<HTMLElement>("[data-girar]")?.addEventListener("click", () => f?.tipo === "setor" && alterar(() => (f.a0 = (f.a0 + 90) % 360)));
  painelEl.querySelector<HTMLElement>('[data-b="excluir"]')?.addEventListener("click", excluirSelecao);
  painelEl.querySelector<HTMLElement>('[data-b="duplicar"]')?.addEventListener("click", duplicar);
  painelEl.querySelector<HTMLElement>('[data-b="lado"]')?.addEventListener("click", () => c && alterar(() => (c.desloc = -c.desloc)));
  painelEl.querySelector<HTMLElement>('[data-b="memoria"]')?.addEventListener("click", memoriaDeCalculo);
  painelEl.querySelector<HTMLElement>('[data-b="copiar"]')?.addEventListener("click", () => void copiarTabela());
  painelEl.querySelectorAll<HTMLElement>("tr[data-f]").forEach((tr) => (tr.onclick = () => {
    sel = { tipo: "fig", id: tr.dataset.f! };
    painel();
    desenhar();
  }));
  if (focarValor) {
    const v = painelEl.querySelector<HTMLInputElement>('[data-c="valor"]');
    if (v && !v.disabled) {
      v.focus({ preventScroll: false });
      v.select();
    }
  }
}

function mudarCampo(chave: string, inp: HTMLInputElement | HTMLSelectElement, f?: Figura, c?: Cota) {
  const texto = inp.value;
  if (chave === "nome" && f) return alterar(() => (f.nome = texto.trim() || f.nome));
  if (chave === "furo" && f) return alterar(() => (f.furo = texto === "1" || undefined));
  if (chave === "tipo" && c) return alterar(() => {
    c.tipo = texto as TipoCota;
    if (!c.dirigida || !Number.isFinite(c.valor)) return;
    c.valor = medir(cg(), c);
  });
  if (chave === "dirigida" && c) return alterar(() => {
    c.dirigida = (inp as HTMLInputElement).checked;
    if (c.dirigida) c.valor = medir(cg(), c);
  });
  if (chave === "massa" && f) {
    if (!texto.trim()) return alterar(() => delete f.massa);
  }
  const v = lerNumero(texto);
  const positivo = ["l", "a", "r", "d", "densidade", "espessura", "valor", "massa", "varre"].includes(chave);
  if (!Number.isFinite(v) || (positivo && (v < 0 || (v === 0 && chave !== "massa" && chave !== "densidade" && chave !== "espessura")))) {
    casca.avisar("Valor inválido.");
    painel();
    return;
  }
  alterar(() => {
    const m = cg().material;
    if (chave === "densidade") m.densidade = v;
    else if (chave === "espessura") m.espessura = v;
    else if (c && chave === "valor") c.valor = v;
    else if (f) {
      if (chave === "massa") f.massa = v;
      else if (f.tipo === "retangulo" && (chave === "x" || chave === "y" || chave === "l" || chave === "a")) f[chave] = v;
      else if ((f.tipo === "circulo" || f.tipo === "setor") && (chave === "cx" || chave === "cy" || chave === "r")) f[chave] = v;
      else if ((f.tipo === "circulo" || f.tipo === "setor") && chave === "d") f.r = v / 2;
      else if (f.tipo === "setor" && chave === "a0") f.a0 = v;
      else if (f.tipo === "setor" && chave === "varre") f.varre = Math.min(360, v);
      else if (f.tipo === "poligono" && /^p[xy]\d+$/.test(chave)) f.pts[Number(chave.slice(2))][chave[1] as "x" | "y"] = v;
    }
  });
  // valor comandado por cota volta ao que a cota manda
  if (f && !["massa", "nome"].includes(chave) && cg().cotas.some((x) => x.dirigida && (x.a.fig === f.id || x.b?.fig === f.id))) {
    casca.avisar("Se o valor voltou, ele é comandado por uma cota: mude a cota.", 4500);
  }
}

// ---------------------------------------------------------------------------------------------
// memória de cálculo

function linhasTabela(): string[][] {
  const ehMassa = cg().material.modo === "massa";
  const ref = res.cg ?? res.centroide ?? { x: 0, y: 0 };
  const cab = ["Figura", "Tipo", "A (mm²)", "m (kg)", "x̄ (mm)", "ȳ (mm)", ehMassa ? "m·x̄" : "A·x̄", ehMassa ? "m·ȳ" : "A·ȳ", "Ix' (mm⁴)", "Iy' (mm⁴)", "dy (mm)", "dx (mm)", "Ix'+A·dy²", "Iy'+A·dx²"];
  const linhas = res.figuras.map((f) => {
    const fig = figura(f.id);
    const w = ehMassa ? f.m : f.A;
    const c = res.centroide ?? ref;
    const dy = f.y - c.y, dx = f.x - c.x;
    return [f.nome, `${fig ? (fig.tipo === "poligono" && fig.pts.length === 3 ? "Triângulo" : NOME_TIPO[fig.tipo]) : ""}${f.furo ? " (furo)" : ""}`, fmt(f.A), fmt(f.m), fmt(f.x), fmt(f.y), fmt(w * f.x), fmt(w * f.y), fmt(f.Ix), fmt(f.Iy), fmt(dy), fmt(dx), fmt(f.Ix + f.A * dy * dy), fmt(f.Iy + f.A * dx * dx)];
  });
  const soma = (fn: (f: ResultadoCg["figuras"][number]) => number) => res.figuras.reduce((s, f) => s + fn(f), 0);
  const w = (f: ResultadoCg["figuras"][number]) => (ehMassa ? f.m : f.A);
  linhas.push(["Σ", "", fmt(res.A), fmt(res.m), "", "", fmt(soma((f) => w(f) * f.x)), fmt(soma((f) => w(f) * f.y)), "", "", "", "", fmt(res.areaCentroide?.Ix ?? NaN), fmt(res.areaCentroide?.Iy ?? NaN)]);
  return [cab, ...linhas];
}

function memoriaDeCalculo() {
  const ehMassa = cg().material.modo === "massa";
  const t = linhasTabela();
  const peso = ehMassa ? "m" : "A";
  const somaW = ehMassa ? res.m : res.A;
  const somaX = res.figuras.reduce((s, f) => s + (ehMassa ? f.m : f.A) * f.x, 0);
  const somaY = res.figuras.reduce((s, f) => s + (ehMassa ? f.m : f.A) * f.y, 0);
  const mat = cg().material;
  const corpo = `
    <p class="ce-nota">${ehMassa ? "Massa informada em cada figura." : `Mesmo material: ρ = ${fmt(mat.densidade)} kg/m³, espessura = ${fmt(mat.espessura)} mm; m = ρ·t·A.`} Furos entram com área e massa negativas.</p>
    <div class="ce-memoria"><table class="ce-tabela"><thead><tr>${t[0].map((x) => `<th>${escapar(x)}</th>`).join("")}</tr></thead>
    <tbody>${t.slice(1).map((l) => `<tr>${l.map((x) => `<td>${escapar(x)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
    ${res.cg ? `<h3>Centro de gravidade</h3>
    <p>X = Σ${peso}·x̄ / Σ${peso} = ${fmt(somaX)} / ${fmt(somaW)} = <b>${fmt(somaX / somaW)} mm</b></p>
    <p>Y = Σ${peso}·ȳ / Σ${peso} = ${fmt(somaY)} / ${fmt(somaW)} = <b>${fmt(somaY / somaW)} mm</b></p>` : ""}
    ${res.areaCentroide ? `<h3>Momento de inércia de área (teorema dos eixos paralelos)</h3>
    <p>Ix = Σ(Ix' + A·dy²) = <b>${fmt(res.areaCentroide.Ix, "mm⁴")}</b> · Iy = Σ(Iy' + A·dx²) = <b>${fmt(res.areaCentroide.Iy, "mm⁴")}</b></p>
    <p class="ce-nota">dx e dy: distâncias do centroide de cada figura ao centroide do conjunto (${res.centroide ? `${fmt(res.centroide.x)} ; ${fmt(res.centroide.y)}` : "—"} mm).</p>` : ""}
    ${res.massaCg ? `<h3>Momento de inércia de massa (pelo CG)</h3><p>Iz = Σ[(m/A)·(Ix' + Iy') + m·d²] = <b>${fmt(res.massaCg.Iz, "kg·mm²")}</b> = ${fmt(res.massaCg.Iz * 1e-6, "kg·m²")}</p>` : ""}`;
  janela("Memória de cálculo — centro de gravidade 2D", corpo, [{ rotulo: "Copiar tabela", acao: () => (void copiarTabela(), false) }, { rotulo: "Fechar", destaque: true }], true);
}

async function copiarTabela() {
  const tsv = linhasTabela().map((l) => l.join("\t")).join("\n");
  try {
    await navigator.clipboard.writeText(tsv);
    casca.avisar("Tabela copiada: cole no WJPlan.");
  } catch {
    casca.avisar("Não foi possível copiar (o navegador bloqueou).");
  }
}

// ---------------------------------------------------------------------------------------------
// exemplo (problema clássico: chapa com recorte e furo)

function exemplo() {
  const d = docNovo();
  d.nome = "Exemplo — chapa com furo";
  d.cg2d.figuras = [
    { id: "a", nome: "Chapa", tipo: "retangulo", x: 0, y: 0, l: 120, a: 80 },
    { id: "b", nome: "Triângulo", tipo: "poligono", pts: [{ x: 120, y: 0 }, { x: 180, y: 0 }, { x: 120, y: 80 }] },
    { id: "c", nome: "Semicírculo", tipo: "setor", cx: 60, cy: 80, r: 40, a0: 0, varre: 180 },
    { id: "d", nome: "Furo", tipo: "circulo", cx: 40, cy: 40, r: 15, furo: true },
  ];
  d.cg2d.cotas = [
    { id: "1", tipo: "horizontal", a: { fig: "a", p: "v0" }, b: { fig: "a", p: "v1" }, valor: 120, dirigida: true, desloc: -50 },
    { id: "2", tipo: "vertical", a: { fig: "a", p: "v0" }, b: { fig: "a", p: "v3" }, valor: 80, dirigida: true, desloc: -80 },
    { id: "3", tipo: "horizontal", a: { fig: null, p: "o" }, b: { fig: "d", p: "c" }, valor: 40, dirigida: true, desloc: -25 },
    { id: "4", tipo: "vertical", a: { fig: null, p: "o" }, b: { fig: "d", p: "c" }, valor: 40, dirigida: true, desloc: -20 },
    { id: "5", tipo: "diametro", a: { fig: "d", p: "c" }, valor: 30, dirigida: true, desloc: 0 },
  ];
  trocarDoc(d);
}

// ---------------------------------------------------------------------------------------------
// calculadoras (módulos): só o centro de gravidade 2D por enquanto

const MODULOS: { id: string; nome: string; pronto?: boolean }[] = [
  { id: "cg2d", nome: "Centro de gravidade 2D", pronto: true },
  { id: "eq1", nome: "Equação do 1º grau" },
  { id: "eq2", nome: "Equação do 2º grau" },
  { id: "sistemas", nome: "Sistemas com várias variáveis" },
  { id: "inequacoes", nome: "Inequações" },
  { id: "newton", nome: "Leis de Newton" },
  { id: "plano", nome: "Plano inclinado" },
  { id: "atrito", nome: "Força de atrito" },
  { id: "trabalho", nome: "Trabalho" },
  { id: "cramer", nome: "Matriz 3×3 — Cramer" },
  { id: "gauss", nome: "Matriz 3×3 — Gauss" },
  { id: "mult", nome: "Multiplicação de matrizes" },
];
function montarModulos() {
  const n = $("#ce-modulos");
  n.innerHTML = `<h3>Calculadoras</h3>${MODULOS.map((m) => `<button data-m="${m.id}" ${m.pronto ? `aria-current="${doc.modulo === m.id}"` : "disabled"}>${IC.centroGravidade && m.pronto ? IC.centroGravidade : ""}<span>${escapar(m.nome)}${m.pronto ? "" : "<small>em breve</small>"}</span></button>`).join("")}`;
}

// ---------------------------------------------------------------------------------------------
// casca

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
  abas: [
    {
      id: "esboco", rotulo: "Esboço", grupos: [
        [{ id: "sel", rotulo: "Selecionar", icone: "selecionar", dica: "Selecionar e mover (V / Esc)", ativo: () => ferramenta === "selecionar", acao: () => usarFerramenta("selecionar") }],
        [
          { id: "ret", rotulo: "Retângulo", icone: "retangulo", dica: "Retângulo (R)", ativo: () => ferramenta === "retangulo", acao: () => usarFerramenta("retangulo") },
          { id: "cir", rotulo: "Círculo", icone: "circulo", dica: "Círculo (C)", ativo: () => ferramenta === "circulo", acao: () => usarFerramenta("circulo") },
          { id: "set", rotulo: "Setor", icone: "setor", dica: "Setor circular: semicírculo, quarto de círculo… (A)", ativo: () => ferramenta === "setor", acao: () => usarFerramenta("setor") },
          { id: "tri", rotulo: "Triângulo", icone: "triangulo", dica: "Triângulo (T)", ativo: () => ferramenta === "triangulo", acao: () => usarFerramenta("triangulo") },
          { id: "pol", rotulo: "Polígono", icone: "poligono", dica: "Polígono (P)", ativo: () => ferramenta === "poligono", acao: () => usarFerramenta("poligono") },
        ],
        [{ id: "cota", rotulo: "Cota", icone: "cota", dica: "Cota de distância, raio ou diâmetro (D)", ativo: () => ferramenta === "cota", acao: () => usarFerramenta("cota") }],
        [
          { id: "ajuste", rotulo: "Ajuste à grade", icone: "ima", dica: "Ajustar à grade e aos pontos (G)", ativo: () => ajustar, acao: alternarAjuste },
          { id: "enq", rotulo: "Enquadrar", icone: "enquadrar", dica: "Enquadrar tudo (F)", acao: enquadrar },
        ],
        [{ id: "exc", rotulo: "Excluir", icone: "apagar", dica: "Excluir a seleção (Delete)", acao: excluirSelecao }],
        [
          { id: "mem", rotulo: "Memória de cálculo", icone: "tabela", acao: memoriaDeCalculo },
          { id: "ex", rotulo: "Exemplo", icone: "centroGravidade", dica: "Abre um exemplo: chapa com triângulo, semicírculo e furo", acao: exemplo },
        ],
      ],
    },
  ],
});
registrarOffline();
montarModulos();
painel();
atualizarDica();
new ResizeObserver(redimensionar).observe(tela.parentElement!);
redimensionar();
enquadrar();
