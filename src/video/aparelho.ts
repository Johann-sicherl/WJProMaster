// WJVideoMaker — teste do aparelho (fase V0 de docs/global/wjvideomaker.md; página video/aparelho/).
// Pergunta ao navegador o que ele decodifica/codifica (com ou sem hardware), mede no Worker
// a decodificação simultânea, a composição WebGL2 e a exportação, testa a leitura de pasta/pendrive
// e da galeria, e resume tudo em recomendações para o editor (capacidade.ts).

import "./aparelho.css";
import {
  PERFIS_AUDIO, PERFIS_VIDEO, RESOLUCOES, TIPOS_IMAGEM, classificarArquivo, ehHeic, recomendar, simboloSuporte, taxaBits, textoRecomendacao,
  type Alt, type Medidas, type Suporte, type TipoMidia,
} from "./capacidade";
import { duracaoLegivel } from "./tempo";
import { botaoDiagnostico } from "../comum/diagnostico";
import { registrarComAtualizacao } from "../comum/atualizacao";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const saida = $<HTMLPreElement>("av-saida");
const relatorio: string[] = [];
let ocupado = false;
const codecs: Pick<Medidas, "codificaH264" | "codificaVp9" | "codificaAac" | "codificaOpus"> = { codificaH264: {}, codificaVp9: {}, codificaAac: false, codificaOpus: false };

const fmt = (v: number, d = 0) => v.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
const esc = (s: string) => s.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]!);
const mb = (b: number) => (b >= 1073741824 ? `${fmt(b / 1073741824, 1)} GB` : `${fmt(b / 1048576, b < 10485760 ? 1 : 0)} MB`);
function escrever(l: string) {
  relatorio.push(l);
  saida.textContent = relatorio.join("\n");
  saida.scrollTop = saida.scrollHeight;
}
function progresso(texto: string, tipo: "" | "ok" | "erro" = "") {
  const p = $<HTMLParagraphElement>("av-progresso");
  p.hidden = false;
  p.className = `af-progresso ${tipo}`;
  p.textContent = texto;
}

// ---------------- aparelho ----------------

type Janela = typeof window & { showDirectoryPicker?: (o?: { id?: string; mode?: "read" | "readwrite" }) => Promise<PastaDisco> };
interface PastaDisco { kind: "directory"; name: string; values(): AsyncIterable<PastaDisco | ArquivoDisco> }
interface ArquivoDisco { kind: "file"; name: string; getFile(): Promise<File> }

function gpuNome(): string {
  try {
    const gl = document.createElement("canvas").getContext("webgl2");
    if (!gl) return "WebGL2 indisponível";
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const nome = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
    const max = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return `${nome} · textura até ${max} px`;
  } catch {
    return "(não informado)";
  }
}

async function mostrarAparelho() {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const est = await navigator.storage?.estimate?.().catch(() => undefined);
  const persistente = await navigator.storage?.persisted?.().catch(() => false);
  let audio = "indisponível";
  try {
    const ac = new AudioContext();
    audio = `${fmt(ac.sampleRate)} Hz, latência ${fmt((ac.baseLatency || 0) * 1000, 1)} ms`;
    void ac.close();
  } catch { /* sem Web Audio */ }
  const sim = (v: unknown) => (v ? "sim" : "não");
  const linhas: [string, string][] = [
    ["WebCodecs (vídeo)", typeof VideoDecoder === "function" && typeof VideoEncoder === "function" ? "disponível ✓" : "indisponível ✗ (o editor não funciona neste navegador)"],
    ["GPU (WebGL2)", gpuNome()],
    ["Composição em Worker", sim(typeof OffscreenCanvas === "function")],
    ["Memória do aparelho", nav.deviceMemory ? `≈ ${nav.deviceMemory} GB (valor arredondado pelo navegador)` : "(não informada)"],
    ["Núcleos de CPU", String(navigator.hardwareConcurrency || "?")],
    ["Tela", `${screen.width}×${screen.height} · densidade ${fmt(devicePixelRatio, 2)}`],
    ["Áudio", audio],
    ["Seletor de pasta/pendrive", sim((window as Janela).showDirectoryPicker)],
    ["Cache do app (OPFS)", sim(navigator.storage?.getDirectory)],
    ["Espaço para o app", est?.quota ? `${mb(est.quota)} disponíveis, ${mb(est.usage ?? 0)} em uso · ${persistente ? "persistente" : "pode ser limpo pelo navegador"}` : "(não informado)"],
    ["Tela acesa durante exportação", sim(navigator.wakeLock)],
    ["Compartilhar arquivo (enviar para apps)", sim(navigator.canShare?.({ files: [new File([""], "a.mp4", { type: "video/mp4" })] }))],
    ["Navegador", navigator.userAgent],
  ];
  $<HTMLDListElement>("av-aparelho").innerHTML = linhas.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join("");
  for (const [k, v] of linhas) relatorio.push(`${k}: ${v}`);
  relatorio.push("");
  saida.textContent = relatorio.join("\n");
}

// ---------------- formatos ----------------

const MODOS = ["prefer-hardware", "no-preference"] as const;

async function suporteVideo(dir: "dec" | "cod", codec: string, w: number, h: number): Promise<Suporte> {
  if (typeof VideoDecoder !== "function") return "nao";
  for (const hw of MODOS) {
    try {
      const ok = dir === "dec"
        ? (await VideoDecoder.isConfigSupported({ codec, codedWidth: w, codedHeight: h, hardwareAcceleration: hw })).supported
        : (await VideoEncoder.isConfigSupported({ codec, width: w, height: h, bitrate: taxaBits(w, h, 30), framerate: 30, hardwareAcceleration: hw })).supported;
      if (ok) return hw === "prefer-hardware" ? "hardware" : "software";
    } catch { /* recusado */ }
  }
  return "nao";
}

async function suporteAudio(dir: "dec" | "cod", codec: string, amostragem: number): Promise<boolean> {
  try {
    if (dir === "dec") return !!(await AudioDecoder.isConfigSupported({ codec, sampleRate: amostragem, numberOfChannels: 2 })).supported;
    return !!(await AudioEncoder.isConfigSupported({ codec, sampleRate: amostragem, numberOfChannels: 2, bitrate: 128000 })).supported;
  } catch {
    return false;
  }
}

const celula = (s: Suporte) => `<td class="${s === "hardware" ? "hw" : s === "nao" ? "nao" : ""}">${simboloSuporte(s)}</td>`;

async function mostrarFormatos() {
  const cab = RESOLUCOES.map((r) => `<th>${r.nome}: abre</th><th>${r.nome}: exporta</th>`).join("");
  const linhas: string[] = [];
  escrever("== Formatos de vídeo (abre = decodifica · exporta = codifica) ==");
  for (const p of PERFIS_VIDEO) {
    const cels: string[] = [];
    const txt: string[] = [];
    for (const r of RESOLUCOES) {
      const [d, c] = await Promise.all([suporteVideo("dec", p.codec[r.alt], r.w, r.h), suporteVideo("cod", p.codec[r.alt], r.w, r.h)]);
      cels.push(celula(d), celula(c));
      txt.push(`${r.nome} abre ${simboloSuporte(d)} / exporta ${simboloSuporte(c)}`);
      if (p.nome === "H.264") codecs.codificaH264[r.alt as Alt] = c;
      if (p.nome === "VP9") codecs.codificaVp9[r.alt as Alt] = c;
    }
    linhas.push(`<tr><th>${p.nome}</th>${cels.join("")}</tr>`);
    escrever(`  ${p.nome}: ${txt.join(" · ")}`);
  }
  $<HTMLTableElement>("av-formatos").innerHTML = `<thead><tr><th>Vídeo</th>${cab}</tr></thead><tbody>${linhas.join("")}</tbody>`;

  const la: string[] = [];
  const ta: string[] = [];
  for (const p of PERFIS_AUDIO) {
    const [d, c] = typeof AudioDecoder === "function" ? await Promise.all([suporteAudio("dec", p.codec, p.amostragem), suporteAudio("cod", p.codec, p.amostragem)]) : [false, false];
    if (p.codec === "mp4a.40.2") codecs.codificaAac = c;
    if (p.codec === "opus") codecs.codificaOpus = c;
    la.push(`<tr><th>${p.nome}</th><td class="${d ? "" : "nao"}">${d ? "✓" : "—"}</td><td class="${c ? "" : "nao"}">${c ? "✓" : "—"}</td></tr>`);
    ta.push(`${p.nome} abre ${d ? "✓" : "—"} / exporta ${c ? "✓" : "—"}`);
  }
  $<HTMLTableElement>("av-audio").innerHTML = `<thead><tr><th>Áudio</th><th>abre</th><th>exporta</th></tr></thead><tbody>${la.join("")}</tbody>`;
  escrever(`== Áudio ==\n  ${ta.join(" · ")}`);

  const ImgDec = (window as typeof window & { ImageDecoder?: { isTypeSupported(t: string): Promise<boolean> } }).ImageDecoder;
  const img: string[] = [];
  for (const t of TIPOS_IMAGEM) img.push(`${t.nome} ${ImgDec ? ((await ImgDec.isTypeSupported(t.mime).catch(() => false)) ? "✓" : "—") : "?"}`);
  const textoImg = `Imagens: ${img.join(" · ")}${img.some((x) => x.startsWith("HEIC") && x.endsWith("—")) ? " (fotos HEIC precisam ser convertidas para JPEG)" : ""}`;
  $("av-imagens").textContent = textoImg;
  escrever(`== ${textoImg} ==\n`);
}

// ---------------- medição no Worker ----------------

async function exclusivo(nome: string, f: () => Promise<void>) {
  if (ocupado) return;
  ocupado = true;
  const botoes = document.querySelectorAll<HTMLButtonElement>(".af-botoes button");
  botoes.forEach((b) => (b.disabled = b.id !== "av-copiar"));
  progresso(`⏳ ${nome} em andamento… não saia desta tela.`);
  const tela = await navigator.wakeLock?.request("screen").catch(() => null);
  try {
    await f();
    progresso(`✓ Pronto: ${nome}. Toque em "Copiar resultados" e cole na conversa.`, "ok");
  } catch (e) {
    escrever(`!! erro: ${(e as Error).message || e}`);
    progresso(`✗ Parou com erro: ${nome} (detalhe no relatório abaixo).`, "erro");
  } finally {
    void tela?.release().catch(() => {});
    navigator.vibrate?.(200);
    ocupado = false;
    botoes.forEach((b) => (b.disabled = b.id === "av-medir" && typeof VideoDecoder !== "function"));
  }
}

function medir(): Promise<void> {
  return new Promise((ok, falha) => {
    escrever("== Medição de desempenho ==");
    const w = new Worker(new URL("./aparelho-worker.ts", import.meta.url), { type: "module" });
    const t0 = performance.now();
    w.onmessage = (ev: MessageEvent<{ tipo: string; texto?: string; medidas?: Pick<Medidas, "decodificacao" | "exportacao" | "composicao1080"> }>) => {
      const m = ev.data;
      if (m.tipo === "linha") escrever(m.texto!);
      else if (m.tipo === "etapa") progresso(`⏳ ${m.texto}… não saia desta tela.`);
      else if (m.tipo === "erro") {
        w.terminate();
        falha(new Error(m.texto));
      } else if (m.tipo === "fim") {
        w.terminate();
        escrever(`(medição em ${fmt((performance.now() - t0) / 1000)} s)\n`);
        mostrarResumo({ ...codecs, ...m.medidas! });
        ok();
      }
    };
    w.onerror = (e) => {
      w.terminate();
      falha(new Error(e.message || "o Worker de medição falhou"));
    };
    w.postMessage({ tipo: "medir" });
  });
}

function mostrarResumo(m: Medidas) {
  const linhas = textoRecomendacao(recomendar(m));
  $("av-resumo").innerHTML = linhas.map((l) => (l.startsWith("! ") ? `<li class="aviso">${esc(l.slice(2))}</li>` : `<li>${esc(l)}</li>`)).join("");
  $("av-cartao-resumo").hidden = false;
  escrever(`== Resumo para o editor ==\n${linhas.map((l) => `  ${l}`).join("\n")}\n`);
}

// ---------------- pasta / pendrive ----------------

/** Toca o arquivo num elemento de vídeo/áudio: resolução e duração, ou recusa. */
function testarReproducao(f: File, tipo: "video" | "audio"): Promise<string> {
  return new Promise((ok) => {
    const url = URL.createObjectURL(f);
    const el = document.createElement(tipo);
    el.preload = "metadata";
    el.muted = true;
    const fim = (t: string) => {
      clearTimeout(limite);
      el.removeAttribute("src");
      el.load();
      URL.revokeObjectURL(url);
      ok(t);
    };
    const limite = setTimeout(() => fim("? sem resposta em 10 s"), 10000);
    el.onloadedmetadata = () => {
      const dur = Number.isFinite(el.duration) ? duracaoLegivel(el.duration * 1e6) : "duração ?";
      fim(el instanceof HTMLVideoElement && el.videoWidth ? `✓ abre ${el.videoWidth}×${el.videoHeight}, ${dur}` : `✓ abre, ${dur}`);
    };
    el.onerror = () => fim("✗ este navegador não abre este arquivo (formato/codec)");
    el.src = url;
  });
}

async function testarImagem(f: File): Promise<string> {
  try {
    const b = await createImageBitmap(f);
    const t = `✓ ${b.width}×${b.height}`;
    b.close();
    return t;
  } catch {
    return ehHeic(f.name, f.type) ? "✗ HEIC: o Chrome não abre (exporte a foto como JPEG)" : "✗ não abriu";
  }
}

async function testarPasta() {
  const sdp = (window as Janela).showDirectoryPicker;
  if (!sdp) {
    escrever("Pasta/pendrive: este navegador não tem o seletor de pastas. Use o teste 3 (escolher arquivos).");
    return;
  }
  let pasta: PastaDisco;
  try {
    pasta = await sdp({ id: "wjvideo-teste", mode: "read" });
  } catch {
    escrever("Pasta/pendrive: nenhuma pasta escolhida.");
    return;
  }
  await exclusivo("Teste da pasta", async () => {
    escrever(`== Pasta "${pasta.name}" ==`);
    const conta: Record<TipoMidia | "outros", number> = { video: 0, imagem: 0, audio: 0, legenda: 0, lut: 0, outros: 0 };
    let bytes = 0;
    let vistos = 0;
    let maior: File | null = null;
    const t0 = performance.now();
    const andar = async (p: PastaDisco, nivel: number) => {
      for await (const e of p.values()) {
        if (vistos >= 3000) return;
        if (e.kind === "directory") {
          if (nivel < 3 && !e.name.startsWith(".")) await andar(e, nivel + 1);
          continue;
        }
        vistos++;
        const tipo = classificarArquivo(e.name);
        conta[tipo ?? "outros"]++;
        if (!tipo) continue;
        const f = await e.getFile();
        bytes += f.size;
        if (tipo === "video" && (!maior || f.size > maior.size)) maior = f;
      }
    };
    await andar(pasta, 0);
    escrever(`  ${vistos} arquivos (até 3 níveis) listados em ${fmt((performance.now() - t0) / 1000, 1)} s: ${conta.video} vídeos, ${conta.imagem} fotos, ${conta.audio} áudios, ${conta.legenda} legendas, ${conta.outros} outros · mídia ${mb(bytes)}`);
    const v = maior as File | null;
    if (!v) return;
    const n = Math.min(v.size, 64 << 20);
    let t = performance.now();
    await v.slice(0, n).arrayBuffer();
    const seq = n / 1048576 / ((performance.now() - t) / 1000);
    // acesso salteado: é o que o editor faz ao pular pela linha do tempo
    const saltos = 16;
    t = performance.now();
    for (let i = 0; i < saltos; i++) {
      const pos = Math.floor(((i * 7919) % saltos) / saltos * Math.max(0, v.size - (1 << 20)));
      await v.slice(pos, pos + (1 << 20)).arrayBuffer();
    }
    const salto = (performance.now() - t) / saltos;
    escrever(`  maior vídeo: ${v.name} (${mb(v.size)}) · leitura contínua ${fmt(seq, 0)} MB/s · salto de 1 MB em ${fmt(salto, 0)} ms`);
    escrever(`  ${await testarReproducao(v, "video")}`);
    if (seq < 15) escrever("  ! leitura lenta: no editor, use \"Copiar para o aparelho\" para os vídeos desta pasta.");
    escrever("");
  });
}

async function testarArquivos(lista: FileList) {
  await exclusivo("Teste dos arquivos", async () => {
    escrever(`== ${lista.length} arquivo(s) escolhido(s) ==`);
    for (const f of Array.from(lista).slice(0, 30)) {
      const tipo = classificarArquivo(f.name, f.type);
      const r = tipo === "video" || tipo === "audio" ? await testarReproducao(f, tipo) : tipo === "imagem" ? await testarImagem(f) : "— tipo não usado no editor";
      escrever(`  ${f.name} (${f.type || "tipo ?"}, ${mb(f.size)}): ${r}`);
    }
    escrever("");
  });
}

// ---------------- ligações ----------------

$("av-medir").onclick = () => void exclusivo("Medição de desempenho", medir);
$("av-pasta").onclick = () => void testarPasta();
$("av-arquivos").onclick = () => $<HTMLInputElement>("av-entrada").click();
$<HTMLInputElement>("av-entrada").onchange = (e) => {
  const inp = e.target as HTMLInputElement;
  if (inp.files?.length) void testarArquivos(inp.files).finally(() => (inp.value = ""));
};
$("av-copiar").onclick = async () => {
  try {
    await navigator.clipboard.writeText(relatorio.join("\n"));
    $("av-copiar").textContent = "Copiado ✓";
  } catch {
    getSelection()?.selectAllChildren(saida);
    $("av-copiar").textContent = "Selecionado: copie";
  }
  setTimeout(() => ($("av-copiar").textContent = "Copiar resultados"), 2000);
};

// "Medir" só depois de saber os codificadores (o resumo depende deles)
$<HTMLButtonElement>("av-medir").disabled = true;
void (async () => {
  await mostrarAparelho();
  await mostrarFormatos().catch((e) => escrever(`!! formatos: ${(e as Error).message}`));
  $<HTMLButtonElement>("av-medir").disabled = typeof VideoDecoder !== "function";
})();
{
  const b = botaoDiagnostico();
  if (b) {
    b.style.marginLeft = "auto";
    document.querySelector(".af-topo")!.append(b);
  }
}
registrarComAtualizacao();
