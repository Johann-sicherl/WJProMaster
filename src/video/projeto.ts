// WJVideoMaker — projeto de edição (puro, testado em scripts/teste-video.ts).
// Pista principal magnética (clipes de vídeo e fotos em sequência, sem vãos) + pista de textos
// sobrepostos. Todo tempo é inteiro em microssegundos; cortes caem em fronteiras de quadro.
// Um clipe mostra o trecho [entrada, saída) da mídia (em µs da mídia) na velocidade dada; a duração
// na linha do tempo é (saída − entrada) / velocidade. Foto: o "trecho" é só a duração (velocidade 1).

import { duracaoDoQuadro, encaixarNoQuadro, fpsDecimal, tempoDoQuadro, type Fps } from "./tempo";

export type Proporcao = "16:9" | "9:16" | "1:1" | "4:5";
export const PROPORCOES: { id: Proporcao; nome: string; razao: [number, number] }[] = [
  { id: "16:9", nome: "Horizontal 16:9", razao: [16, 9] },
  { id: "9:16", nome: "Vertical 9:16", razao: [9, 16] },
  { id: "1:1", nome: "Quadrado 1:1", razao: [1, 1] },
  { id: "4:5", nome: "Retrato 4:5", razao: [4, 5] },
];

export interface Midia {
  id: string;
  nome: string;
  tipo: "video" | "imagem";
  /** Duração do vídeo (µs); 0 para foto. */
  duracaoUs: number;
  largura: number;
  altura: number;
  temAudio: boolean;
  /** Tamanho do arquivo (bytes): com o nome, reencontra a mídia ("Localizar…"). */
  tamanho: number;
}

export interface Clipe {
  id: string;
  midia: string;
  entradaUs: number;
  saidaUs: number;
  /** 1 = normal; 2 = duas vezes mais rápido (metade do tempo); 0,5 = câmera lenta. Foto: sempre 1. */
  velocidade: number;
  /** 0 = mudo, 1 = original, até 2. */
  volume: number;
}

export interface Texto {
  id: string;
  texto: string;
  inicioUs: number;
  duracaoUs: number;
  /** Centro do texto em fração da largura/altura do quadro (0–1). */
  x: number;
  y: number;
  /** Altura da letra em fração da altura do quadro. */
  tamanho: number;
  cor: string;
  /** Faixa atrás do texto (legibilidade sobre o vídeo). */
  fundo: boolean;
  corFundo: string;
  negrito: boolean;
}

export interface Projeto {
  formato: "wjvid";
  versao: 1;
  nome: string;
  proporcao: Proporcao;
  fps: Fps;
  midias: Midia[];
  clipes: Clipe[];
  textos: Texto[];
}

export const VEL_MIN = 0.1;
export const VEL_MAX = 10;
export const VELOCIDADES = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 8];
export const DURACAO_FOTO_US = 4_000_000;
const MAX_FOTO_US = 600_000_000; // 10 min
let contador = 0;
export const novoId = () => `${Date.now().toString(36)}${(contador++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function projetoNovo(nome = "Vídeo sem título", proporcao: Proporcao = "16:9"): Projeto {
  return { formato: "wjvid", versao: 1, nome, proporcao, fps: [30, 1], midias: [], clipes: [], textos: [] };
}

// ---------------- linha do tempo ----------------

/** Duração do clipe na linha do tempo (µs, ao menos 1). */
export const duracaoClipe = (c: Clipe) => Math.max(1, Math.round((c.saidaUs - c.entradaUs) / c.velocidade));

export interface Posicao { clipe: Clipe; indice: number; inicio: number; fim: number }

/** Início e fim de cada clipe na linha do tempo (pista magnética: um depois do outro). */
export function linhaDoTempo(p: Projeto): Posicao[] {
  let t = 0;
  return p.clipes.map((clipe, indice) => {
    const inicio = t;
    t += duracaoClipe(clipe);
    return { clipe, indice, inicio, fim: t };
  });
}

/** Fim do vídeo: o maior entre o fim dos clipes e o fim dos textos. */
export function duracaoTotal(p: Projeto): number {
  const l = linhaDoTempo(p);
  const clipes = l.length ? l[l.length - 1].fim : 0;
  return Math.max(clipes, ...p.textos.map((t) => t.inicioUs + t.duracaoUs), 0);
}

/** Clipe na tela no tempo t (o último quadro do vídeo conta como dentro do último clipe). */
export function localizar(p: Projeto, t: number): (Posicao & { tMidia: number }) | null {
  const l = linhaDoTempo(p);
  if (!l.length || t < 0) return null;
  const pos = l.find((x) => t < x.fim) ?? (t <= l[l.length - 1].fim ? l[l.length - 1] : null);
  if (!pos) return null;
  const local = Math.min(t, pos.fim - 1) - pos.inicio;
  return { ...pos, tMidia: Math.min(pos.clipe.saidaUs - 1, pos.clipe.entradaUs + Math.round(local * pos.clipe.velocidade)) };
}

const midiaDe = (p: Projeto, id: string) => p.midias.find((m) => m.id === id);
const ehFoto = (p: Projeto, c: Clipe) => midiaDe(p, c.midia)?.tipo === "imagem";

/** Põe a mídia na pista principal (no fim, ou na posição dada). Devolve o clipe criado. */
export function inserirMidia(p: Projeto, m: Midia, indice = p.clipes.length, duracaoFotoUs = DURACAO_FOTO_US): Clipe {
  if (!midiaDe(p, m.id)) p.midias.push(m);
  const c: Clipe = {
    id: novoId(), midia: m.id, entradaUs: 0,
    saidaUs: m.tipo === "imagem" ? duracaoFotoUs : Math.max(1, m.duracaoUs),
    velocidade: 1, volume: m.temAudio ? 1 : 0,
  };
  p.clipes.splice(Math.max(0, Math.min(indice, p.clipes.length)), 0, c);
  return c;
}

/**
 * Divide o clipe que está no tempo t (encaixado no quadro). Cada parte fica com ao menos um quadro.
 * Devolve a parte de trás (nova) ou null se t não cai dentro de um clipe.
 */
export function dividir(p: Projeto, t: number): Clipe | null {
  const q = duracaoDoQuadro(p.fps);
  const tq = encaixarNoQuadro(t, p.fps);
  const pos = linhaDoTempo(p).find((x) => tq > x.inicio && tq < x.fim);
  if (!pos || tq - pos.inicio < q || pos.fim - tq < q) return null;
  const c = pos.clipe;
  const corte = c.entradaUs + Math.round((tq - pos.inicio) * c.velocidade);
  const tras: Clipe = { ...c, id: novoId(), entradaUs: corte };
  c.saidaUs = corte;
  p.clipes.splice(pos.indice + 1, 0, tras);
  return tras;
}

/**
 * Apara o clipe pelo cursor: "inicio" tira o que vem antes do cursor, "fim" tira o que vem depois.
 * Pista magnética: o resto anda junto. Devolve false se o cursor não está dentro do clipe.
 */
export function apararNoCursor(p: Projeto, idClipe: string, lado: "inicio" | "fim", t: number): boolean {
  const pos = linhaDoTempo(p).find((x) => x.clipe.id === idClipe);
  const tq = encaixarNoQuadro(t, p.fps);
  if (!pos || tq <= pos.inicio || tq >= pos.fim) return false;
  const c = pos.clipe;
  const m = c.entradaUs + Math.round((tq - pos.inicio) * c.velocidade);
  return lado === "inicio" ? definirTrecho(p, c.id, m, c.saidaUs) : definirTrecho(p, c.id, c.entradaUs, m);
}

/** Define o trecho da mídia [entrada, saída), limitado à mídia e a ao menos um quadro. */
export function definirTrecho(p: Projeto, idClipe: string, entradaUs: number, saidaUs: number): boolean {
  const c = p.clipes.find((x) => x.id === idClipe);
  if (!c) return false;
  const m = midiaDe(p, c.midia);
  const minimo = Math.ceil(duracaoDoQuadro(p.fps) * c.velocidade);
  if (m?.tipo === "imagem") {
    c.entradaUs = 0;
    c.saidaUs = Math.max(duracaoDoQuadro(p.fps), Math.min(MAX_FOTO_US, Math.round(saidaUs - entradaUs)));
    return true;
  }
  const fimMidia = m ? m.duracaoUs : Number.MAX_SAFE_INTEGER;
  let e = Math.max(0, Math.min(Math.round(entradaUs), fimMidia - minimo));
  let s = Math.min(fimMidia, Math.round(saidaUs));
  if (s - e < minimo) {
    if (e + minimo <= fimMidia) s = e + minimo;
    else e = s - minimo;
  }
  c.entradaUs = e;
  c.saidaUs = s;
  return true;
}

/** Velocidade do clipe (vídeo), limitada a 0,1×–10×; foto não muda. */
export function definirVelocidade(p: Projeto, idClipe: string, v: number): boolean {
  const c = p.clipes.find((x) => x.id === idClipe);
  if (!c || ehFoto(p, c) || !Number.isFinite(v)) return false;
  c.velocidade = Math.round(Math.max(VEL_MIN, Math.min(VEL_MAX, v)) * 1000) / 1000;
  return true;
}

/** Duração da foto (µs). */
export function definirDuracaoFoto(p: Projeto, idClipe: string, us: number): boolean {
  const c = p.clipes.find((x) => x.id === idClipe);
  if (!c || !ehFoto(p, c)) return false;
  return definirTrecho(p, idClipe, 0, us);
}

/**
 * Duração desejada na linha do tempo ("reduzir o tempo" sem cortar): ajusta a velocidade do vídeo
 * (ou a duração da foto) para o clipe durar `us`.
 */
export function ajustarDuracao(p: Projeto, idClipe: string, us: number): boolean {
  const c = p.clipes.find((x) => x.id === idClipe);
  if (!c || !(us > 0)) return false;
  if (ehFoto(p, c)) return definirDuracaoFoto(p, idClipe, us);
  return definirVelocidade(p, idClipe, (c.saidaUs - c.entradaUs) / us);
}

export function excluirClipe(p: Projeto, idClipe: string): boolean {
  const i = p.clipes.findIndex((x) => x.id === idClipe);
  if (i < 0) return false;
  p.clipes.splice(i, 1);
  return true;
}

export function duplicarClipe(p: Projeto, idClipe: string): Clipe | null {
  const i = p.clipes.findIndex((x) => x.id === idClipe);
  if (i < 0) return null;
  const c = { ...p.clipes[i], id: novoId() };
  p.clipes.splice(i + 1, 0, c);
  return c;
}

/** Leva o clipe para a posição `indice` da pista principal. */
export function moverClipe(p: Projeto, idClipe: string, indice: number): boolean {
  const i = p.clipes.findIndex((x) => x.id === idClipe);
  if (i < 0) return false;
  const [c] = p.clipes.splice(i, 1);
  p.clipes.splice(Math.max(0, Math.min(indice, p.clipes.length)), 0, c);
  return i !== p.clipes.indexOf(c);
}

/** Mídias sem nenhum clipe (podem sair do projeto). */
export const midiasSemUso = (p: Projeto) => p.midias.filter((m) => !p.clipes.some((c) => c.midia === m.id));

// ---------------- textos ----------------

export const POSICOES_TEXTO: { id: string; nome: string; x: number; y: number }[] = [
  { id: "topo", nome: "Em cima", x: 0.5, y: 0.12 },
  { id: "centro", nome: "No meio", x: 0.5, y: 0.5 },
  { id: "base", nome: "Embaixo", x: 0.5, y: 0.85 },
];

export function adicionarTexto(p: Projeto, t: number, texto = "Seu texto aqui"): Texto {
  const total = duracaoTotal(p);
  const inicio = Math.max(0, encaixarNoQuadro(Math.min(t, Math.max(0, total - duracaoDoQuadro(p.fps))), p.fps));
  const dur = total > inicio ? Math.min(3_000_000, total - inicio) : 3_000_000;
  const novo: Texto = { id: novoId(), texto, inicioUs: inicio, duracaoUs: dur, x: 0.5, y: 0.85, tamanho: 0.07, cor: "#ffffff", fundo: true, corFundo: "#000000", negrito: true };
  p.textos.push(novo);
  return novo;
}

/** Textos visíveis no tempo t, na ordem de criação (o último fica por cima). */
export const textosEm = (p: Projeto, t: number) => p.textos.filter((x) => t >= x.inicioUs && t < x.inicioUs + x.duracaoUs);

/** Início e duração do texto, limitados a ≥ 0 e a ao menos um quadro. */
export function definirTempoTexto(p: Projeto, id: string, inicioUs: number, duracaoUs: number): boolean {
  const x = p.textos.find((y) => y.id === id);
  if (!x) return false;
  x.inicioUs = Math.max(0, encaixarNoQuadro(inicioUs, p.fps));
  x.duracaoUs = Math.max(duracaoDoQuadro(p.fps), encaixarNoQuadro(duracaoUs, p.fps));
  return true;
}

export function excluirTexto(p: Projeto, id: string): boolean {
  const i = p.textos.findIndex((x) => x.id === id);
  if (i >= 0) p.textos.splice(i, 1);
  return i >= 0;
}

/**
 * Linhas do texto já quebradas para caber em `larguraMax` (quebra nas palavras; palavra maior que a
 * largura fica sozinha na linha). `medir` dá a largura de um trecho na fonte em uso.
 */
export function quebrarLinhas(texto: string, larguraMax: number, medir: (s: string) => number): string[] {
  const out: string[] = [];
  for (const par of texto.split("\n")) {
    const palavras = par.split(/\s+/).filter(Boolean);
    if (!palavras.length) {
      out.push("");
      continue;
    }
    let linha = palavras[0];
    for (const w of palavras.slice(1)) {
      const tentativa = `${linha} ${w}`;
      if (medir(tentativa) <= larguraMax) linha = tentativa;
      else {
        out.push(linha);
        linha = w;
      }
    }
    out.push(linha);
  }
  return out;
}

// ---------------- quadro de saída ----------------

/** Largura e altura (pares) do vídeo para a proporção, com o lado menor = `ladoMenor` (1080, 720…). */
export function dimensoes(proporcao: Proporcao, ladoMenor: number): [number, number] {
  const [a, b] = PROPORCOES.find((x) => x.id === proporcao)!.razao;
  const par = (v: number) => Math.max(2, Math.round(v / 2) * 2);
  return a >= b ? [par((ladoMenor * a) / b), par(ladoMenor)] : [par(ladoMenor), par((ladoMenor * b) / a)];
}

/** Retângulo para mostrar a mídia inteira no quadro, centrada (faixas pretas no que sobra). */
export function caixaInteira(sw: number, sh: number, dw: number, dh: number): { x: number; y: number; w: number; h: number } {
  const e = Math.min(dw / sw, dh / sh);
  const w = sw * e, h = sh * e;
  return { x: (dw - w) / 2, y: (dh - h) / 2, w, h };
}

/** Um quadro da exportação: qual clipe e em que tempo da mídia (µs). */
export interface QuadroSaida { n: number; indiceClipe: number; tMidia: number }

/**
 * Plano de quadros da exportação: o quadro n (tempo n/fps) mostra o clipe em que cai, no tempo da
 * mídia correspondente. Gerado clipe a clipe (em ordem crescente de tempo da mídia dentro do clipe).
 */
export function* planoDeQuadros(p: Projeto): Generator<QuadroSaida> {
  const total = duracaoTotal(p);
  const nTotal = Math.round((total * fpsDecimal(p.fps)) / 1e6);
  const l = linhaDoTempo(p);
  let k = 0;
  for (let n = 0; n < nTotal; n++) {
    const t = tempoDoQuadro(n, p.fps);
    while (k < l.length - 1 && t >= l[k].fim) k++;
    const pos = l[k];
    if (!pos || t >= pos.fim) {
      yield { n, indiceClipe: -1, tMidia: 0 }; // só texto depois do último clipe: fundo preto
      continue;
    }
    const c = pos.clipe;
    yield { n, indiceClipe: k, tMidia: Math.min(c.saidaUs - 1, c.entradaUs + Math.round((t - pos.inicio) * c.velocidade)) };
  }
}

// ---------------- tamanho e qualidade da exportação ----------------

export type Qualidade = "alta" | "media" | "baixa";
const BITS_POR_PIXEL: Record<Qualidade, number> = { alta: 0.2, media: 0.1, baixa: 0.05 };
export const AUDIO_BPS = 128_000;

/** Taxa de vídeo (bit/s) para a resolução e a qualidade (alta: 1080p30 ≈ 12 Mbit/s). */
export const taxaVideo = (w: number, h: number, fps: number, q: Qualidade) => Math.round((w * h * fps * BITS_POR_PIXEL[q]) / 100_000) * 100_000;

/** Taxa de vídeo para o arquivo ficar com até `mb` megabytes (mínimo 200 kbit/s). */
export function taxaParaTamanho(mb: number, duracaoUs: number, audioBps = AUDIO_BPS): number {
  const s = Math.max(0.1, duracaoUs / 1e6);
  const total = (mb * 8 * 1_000_000 * 0.95) / s; // 5 % de folga para o contêiner
  return Math.max(200_000, Math.floor((total - audioBps) / 1000) * 1000);
}

/** Tamanho estimado do arquivo (MB). */
export const tamanhoEstimadoMb = (duracaoUs: number, videoBps: number, audioBps = AUDIO_BPS) => ((videoBps + audioBps) * (duracaoUs / 1e6)) / 8 / 1_000_000;

// ---------------- arquivo ----------------

const num = (v: unknown, padrao: number) => (typeof v === "number" && Number.isFinite(v) ? v : padrao);
const str = (v: unknown, padrao: string) => (typeof v === "string" ? v : padrao);

/** Confere e completa um projeto lido de arquivo/autosave (null se não for um projeto). */
export function validarProjeto(x: unknown): Projeto | null {
  const o = x as Partial<Projeto> | null;
  if (!o || typeof o !== "object" || o.formato !== "wjvid") return null;
  const p = projetoNovo(str(o.nome, "Vídeo sem título"), PROPORCOES.some((r) => r.id === o.proporcao) ? o.proporcao! : "16:9");
  const fps = Array.isArray(o.fps) && o.fps.length === 2 && o.fps.every((v) => typeof v === "number" && v > 0) ? (o.fps as unknown as Fps) : p.fps;
  p.fps = fps;
  for (const m of Array.isArray(o.midias) ? o.midias : []) {
    if (!m || typeof m.id !== "string") continue;
    p.midias.push({
      id: m.id, nome: str(m.nome, "mídia"), tipo: m.tipo === "imagem" ? "imagem" : "video", duracaoUs: Math.max(0, num(m.duracaoUs, 0)),
      largura: Math.max(1, num(m.largura, 1920)), altura: Math.max(1, num(m.altura, 1080)), temAudio: !!m.temAudio, tamanho: Math.max(0, num(m.tamanho, 0)),
    });
  }
  for (const c of Array.isArray(o.clipes) ? o.clipes : []) {
    if (!c || typeof c.id !== "string" || !p.midias.some((m) => m.id === c.midia)) continue;
    const e = Math.max(0, num(c.entradaUs, 0));
    p.clipes.push({ id: c.id, midia: c.midia, entradaUs: e, saidaUs: Math.max(e + 1, num(c.saidaUs, e + 1)), velocidade: Math.max(VEL_MIN, Math.min(VEL_MAX, num(c.velocidade, 1))), volume: Math.max(0, Math.min(2, num(c.volume, 1))) });
  }
  for (const t of Array.isArray(o.textos) ? o.textos : []) {
    if (!t || typeof t.id !== "string") continue;
    p.textos.push({
      id: t.id, texto: str(t.texto, ""), inicioUs: Math.max(0, num(t.inicioUs, 0)), duracaoUs: Math.max(1, num(t.duracaoUs, 3_000_000)),
      x: Math.max(0, Math.min(1, num(t.x, 0.5))), y: Math.max(0, Math.min(1, num(t.y, 0.85))), tamanho: Math.max(0.02, Math.min(0.3, num(t.tamanho, 0.07))),
      cor: str(t.cor, "#ffffff"), fundo: t.fundo !== false, corFundo: str(t.corFundo, "#000000"), negrito: t.negrito !== false,
    });
  }
  return p;
}
