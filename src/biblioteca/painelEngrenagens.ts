// Painel do gerador de engrenagens: as caixas de campos (só o necessário) e os valores calculados, usados
// tanto no recurso "Engrenagem" da Peça (src/ui/esquemas.ts, editar depois) quanto na Biblioteca de
// componentes da Montagem (aba Engrenagens). Regras e contas em engrenagens.ts (testadas em Node).

import type { ParamEngrenagem, TipoEngrenagem } from "../model";
import type { Caixa } from "../ui/formulario";
import { ROTULO_TIPO, TIPOS_ENGRENAGEM, valoresCalculados } from "./engrenagens";

const tipo = (f: ParamEngrenagem) => f.tipoEngrenagem;
const em = (...t: TipoEngrenagem[]) => (f: ParamEngrenagem) => t.includes(f.tipoEngrenagem);

/** Ao trocar o tipo: valores de partida que fazem sentido (o resto do que foi digitado fica). */
export function aoTrocarTipo(f: ParamEngrenagem, t: TipoEngrenagem) {
  const antes = f.tipoEngrenagem;
  f.tipoEngrenagem = t;
  if (t === "helicoidal" && !(f.helice > 0)) f.helice = 15;
  if ((t === "reta" || t === "conica") && antes === "semFim") f.dentes = 20;
  if (t === "semFim") {
    f.dentes = Math.min(Math.max(1, Math.round(f.entradas || 1)), 4);
    if (antes !== "semFim") f.largura = Math.round(f.modulo * (11 + 0.06 * 40) * 10) / 10 + Math.round(Math.PI * f.modulo * 10) / 10;
  }
  if (t === "coroa" && antes === "semFim") {
    f.entradas = f.dentes;
    f.dentes = 40;
    f.largura = Math.round(2 * f.modulo * Math.sqrt(f.coefDiametro + 1) * 10) / 10;
  }
  if (t === "interna" && f.dentes < 30) f.dentes = 60;
  if (t === "conica" && f.largura > 10 * f.modulo) f.largura = Math.round(5 * f.modulo * 10) / 10;
}

/** Caixas do painel (tipo, dentes, hélice, cônica, sem-fim/coroa, cremalheira, interna, furo/cubo, valores). */
export function caixasEngrenagem<F extends ParamEngrenagem>(): Caixa<F>[] {
  return [
    { titulo: "Tipo", campos: [
      { t: "sel", rot: "Tipo de engrenagem", cam: "tipoEngrenagem", opcoes: TIPOS_ENGRENAGEM.map((t) => [t, ROTULO_TIPO[t]]), aoMudar: (f, v) => aoTrocarTipo(f, v as TipoEngrenagem) },
    ] },
    { titulo: "Dentes", campos: [
      { t: "num", rot: "Módulo m", cam: "modulo", un: "mm", min: 0.1, max: 50, passo: 0.25 },
      { t: "num", rot: "Nº de dentes z", cam: "dentes", min: 4, max: 400, passo: 1, vis: (f) => !em("semFim", "cremalheira")(f) },
      { t: "num", rot: "Nº de entradas", cam: "dentes", min: 1, max: 8, passo: 1, vis: em("semFim") },
      { t: "num", rot: "Ângulo de pressão α", cam: "angPressao", un: "°", min: 10, max: 35, passo: 0.5 },
      { t: "num", rot: "Largura do dente b", cam: "largura", un: "mm", min: 0.5, passo: 1, vis: (f) => tipo(f) !== "semFim" },
      { t: "num", rot: "Comprimento do sem-fim", cam: "largura", un: "mm", min: 1, passo: 1, vis: em("semFim") },
      { t: "num", rot: "Deslocamento de perfil x", cam: "deslocamento", min: -1.5, max: 1.5, passo: 0.05, vis: (f) => !em("semFim", "cremalheira")(f) },
    ] },
    { titulo: "Hélice", vis: em("helicoidal", "interna", "cremalheira", "semFim", "coroa"), campos: [
      { t: "num", rot: "Ângulo de hélice β", cam: "helice", un: "°", min: 0, max: 45, passo: 1, vis: em("helicoidal", "interna", "cremalheira") },
      { t: "info", texto: (f) => (f.tipoEngrenagem === "helicoidal" ? "Módulo e ângulo de pressão normais; o par externo tem a hélice no sentido oposto." : f.tipoEngrenagem === "coroa" ? "β da coroa = ângulo de avanço do sem-fim (mesmo sentido)." : f.tipoEngrenagem === "semFim" ? "Sem-fim e coroa: hélice no mesmo sentido." : "0° = dentes retos.") },
      { t: "sel", rot: "Sentido", cam: "sentido", opcoes: [["direita", "À direita"], ["esquerda", "À esquerda"]], vis: (f) => em("semFim", "coroa", "helicoidal")(f) || f.helice > 0 },
    ] },
    { titulo: "Cônica", vis: em("conica"), campos: [
      { t: "num", rot: "Dentes da outra engrenagem", cam: "dentesPar", min: 4, max: 400, passo: 1 },
      { t: "num", rot: "Ângulo entre eixos Σ", cam: "anguloEixos", un: "°", min: 10, max: 170, passo: 5 },
    ] },
    { titulo: "Sem-fim e coroa", vis: em("semFim", "coroa"), campos: [
      { t: "num", rot: "Coeficiente de diâmetro q (d1 = q·m)", cam: "coefDiametro", min: 4, max: 30, passo: 1 },
      { t: "num", rot: "Entradas do sem-fim", cam: "entradas", min: 1, max: 8, passo: 1, vis: em("coroa") },
    ] },
    { titulo: "Cremalheira", vis: em("cremalheira"), campos: [
      { t: "num", rot: "Comprimento", cam: "comprimento", un: "mm", min: 1, passo: 10 },
      { t: "num", rot: "Altura total", cam: "altura", un: "mm", min: 1, passo: 1 },
    ] },
    { titulo: "Aro", vis: em("interna"), campos: [
      { t: "num", rot: "Ø externo do aro (0 = automático)", cam: "aro", un: "mm", min: 0, passo: 5 },
    ] },
    { titulo: "Furo, cubo e chaveta", vis: (f) => !em("interna", "cremalheira")(f), campos: [
      { t: "num", rot: "Ø do furo (0 = maciço)", cam: "furo", un: "mm", min: 0, passo: 1 },
      { t: "check", rot: "Rasgo de chaveta (DIN 6885)", cam: "chaveta", vis: (f) => f.furo > 0 },
      { t: "num", rot: "Ø do cubo (0 = sem cubo)", cam: "cuboDiametro", un: "mm", min: 0, passo: 1, vis: (f) => tipo(f) !== "semFim" },
      { t: "num", rot: "Comprimento do cubo", cam: "cuboComprimento", un: "mm", min: 0, passo: 1, vis: (f) => tipo(f) !== "semFim" && f.cuboDiametro > 0 },
    ] },
    { titulo: "Valores calculados", campos: [
      { t: "elemento", criar: (f) => tabelaCalculada(f) },
    ] },
  ];
}

/** Tabela dos valores calculados (ou o erro de entrada, em vermelho). */
export function tabelaCalculada(f: ParamEngrenagem, extra: { rotulo: string; valor: string }[] = [], avisosExtra: string[] = []): HTMLElement {
  const d = document.createElement("div");
  const p = (classe: string, texto: string) => Object.assign(document.createElement("p"), { className: classe, textContent: texto });
  try {
    const { valores, avisos } = valoresCalculados(f);
    const dl = document.createElement("dl");
    dl.className = "eng-valores";
    for (const v of [...valores, ...extra]) dl.append(Object.assign(document.createElement("dt"), { textContent: v.rotulo }), Object.assign(document.createElement("dd"), { textContent: v.valor }));
    d.append(dl);
    for (const a of [...avisos, ...avisosExtra]) d.append(p("eng-aviso", `⚠ ${a}`));
  } catch (e) {
    d.append(p("eng-erro", (e as Error).message));
  }
  return d;
}

/** Abas "Fixação | Engrenagens" no topo da Biblioteca de componentes. */
export function abasBiblioteca(atual: "fixacao" | "engrenagens", trocar: (a: "fixacao" | "engrenagens") => void): HTMLElement {
  const d = document.createElement("div");
  d.className = "pc-abas bib-abas";
  for (const [id, rot] of [["fixacao", "Fixação"], ["engrenagens", "Engrenagens"]] as const) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "pc-aba";
    b.textContent = rot;
    b.setAttribute("aria-selected", String(atual === id));
    b.onclick = () => {
      if (atual !== id) trocar(id);
    };
    d.append(b);
  }
  return d;
}
