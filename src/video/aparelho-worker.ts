// WJVideoMaker — medições do teste do aparelho (fase V0), num Worker como será o editor.
// 1) Gera um vídeo sintético com o codificador do próprio aparelho (sem arquivo de terceiros).
// 2) Decodifica 1, 2, 3 e 4 cópias ao mesmo tempo: quadros/s de cada uma.
// 3) Composição WebGL2 em OffscreenCanvas: 2 vídeos misturados + correção de cor + título.
// 4) Exportação: decodificar → compor → codificar 10 s de vídeo, com 1 e 2 vídeos.
// 5) Armazenamento do app (OPFS): velocidade de escrita e leitura (cache de proxies e miniaturas).

import { RESOLUCOES, codecsParaGerar, taxaBits, type MedidaDecodificacao, type MedidaExportacao, type Resolucao } from "./capacidade";

const FPS = 30;
const QUADRO_US = Math.round(1e6 / FPS);
const ctx = self as unknown as Worker;
const linha = (texto: string) => ctx.postMessage({ tipo: "linha", texto });
const etapa = (texto: string) => ctx.postMessage({ tipo: "etapa", texto });
const fmt = (v: number, d = 1) => v.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
const pausa = (ms = 2) => new Promise((r) => setTimeout(r, ms));

/** Quadro codificado guardado em bruto: dá para recriar com qualquer carimbo de tempo. */
interface Bruto { chave: boolean; dados: Uint8Array }
interface Amostra { res: Resolucao; config: VideoDecoderConfig; quadros: Bruto[]; encoder: VideoEncoderConfig; hwEnc: boolean }

const pedaco = (b: Bruto, i: number) =>
  new EncodedVideoChunk({ type: b.chave ? "key" : "delta", timestamp: i * QUADRO_US, duration: QUADRO_US, data: b.dados });

async function configEncoder(res: Resolucao): Promise<{ cfg: VideoEncoderConfig; hw: boolean } | null> {
  for (const codec of codecsParaGerar(res.alt))
    for (const hw of ["prefer-hardware", "no-preference"] as const) {
      const cfg: VideoEncoderConfig = { codec, width: res.w, height: res.h, bitrate: taxaBits(res.w, res.h, FPS), framerate: FPS, hardwareAcceleration: hw, latencyMode: "quality" };
      try {
        if ((await VideoEncoder.isConfigSupported(cfg)).supported) return { cfg, hw: hw === "prefer-hardware" };
      } catch { /* configuração recusada: tenta a próxima */ }
    }
  return null;
}

/** Desenho sintético com movimento e cor (para o codificador ter trabalho de verdade). */
function desenhar(g: OffscreenCanvasRenderingContext2D, w: number, h: number, i: number) {
  const t = i / FPS;
  const fundo = g.createLinearGradient(0, 0, w, h);
  fundo.addColorStop(0, `hsl(${(i * 3) % 360} 60% 45%)`);
  fundo.addColorStop(1, `hsl(${(i * 3 + 140) % 360} 55% 30%)`);
  g.fillStyle = fundo;
  g.fillRect(0, 0, w, h);
  for (let k = 0; k < 14; k++) {
    g.fillStyle = `hsl(${k * 26} 80% 62% / 0.8)`;
    g.beginPath();
    g.arc(w * (0.5 + 0.42 * Math.sin(t * 1.3 + k)), h * (0.5 + 0.4 * Math.cos(t * 0.9 + k * 1.7)), h * 0.06, 0, 7);
    g.fill();
  }
  g.fillStyle = "#fff";
  g.font = `600 ${Math.round(h / 14)}px sans-serif`;
  g.fillText(`WJVideoMaker · quadro ${i}`, w * 0.05, h * 0.9);
}

/**
 * Gera quadros sintéticos nesta resolução com o codificador do aparelho: 90 (3 s), ou só 30 em 4K
 * sem hardware (codificar 4K por software no tablet levaria minutos).
 */
async function gerar(res: Resolucao): Promise<Amostra | null> {
  const e = await configEncoder(res);
  if (!e) return null;
  const n = res.alt === 2160 ? (e.hw ? 60 : 30) : 90;
  const cv = new OffscreenCanvas(res.w, res.h);
  const g = cv.getContext("2d")!;
  const quadros: Bruto[] = [];
  let config: VideoDecoderConfig | undefined;
  let erro: unknown = null;
  const enc = new VideoEncoder({
    output: (c, meta) => {
      const d = new Uint8Array(c.byteLength);
      c.copyTo(d);
      quadros.push({ chave: c.type === "key", dados: d });
      if (meta?.decoderConfig) config = meta.decoderConfig;
    },
    error: (x) => (erro = x),
  });
  enc.configure(e.cfg);
  const t0 = performance.now();
  for (let i = 0; i < n && !erro; i++) {
    desenhar(g, res.w, res.h, i);
    const f = new VideoFrame(cv, { timestamp: i * QUADRO_US, duration: QUADRO_US });
    enc.encode(f, { keyFrame: i % FPS === 0 });
    f.close();
    while (enc.encodeQueueSize > 4 && !erro) await pausa();
  }
  if (!erro) await enc.flush().catch((x) => (erro = x));
  if (enc.state !== "closed") enc.close();
  if (erro) throw erro;
  if (!quadros.length || !quadros[0].chave) throw new Error("o codificador não devolveu quadros");
  const s = (performance.now() - t0) / 1000;
  const mb = quadros.reduce((a, q) => a + q.dados.byteLength, 0) / 1048576;
  linha(`  amostra ${res.nome}: ${e.cfg.codec} (${e.hw ? "hardware" : "software ou indefinido"}), ${n} quadros em ${fmt(s)} s (${fmt(n / s, 0)} qps desenhando + codificando), ${fmt(mb)} MB`);
  return { res, config: config ?? { codec: e.cfg.codec, codedWidth: res.w, codedHeight: res.h }, quadros, encoder: e.cfg, hwEnc: e.hw };
}

async function configDecoder(a: Amostra): Promise<{ cfg: VideoDecoderConfig; hw: boolean }> {
  for (const hw of ["prefer-hardware", "no-preference"] as const) {
    const cfg: VideoDecoderConfig = { ...a.config, hardwareAcceleration: hw };
    try {
      if ((await VideoDecoder.isConfigSupported(cfg)).supported) return { cfg, hw: hw === "prefer-hardware" };
    } catch { /* tenta a próxima */ }
  }
  throw new Error("o decodificador recusou a amostra");
}

/**
 * Decodifica `total` quadros da amostra (repetindo-a). `aoQuadro` recebe cada quadro e tem de
 * fechá-lo; `esperar` segura a entrada enquanto quem consome está atrasado.
 */
async function decodificar(a: Amostra, cfg: VideoDecoderConfig, total: number, aoQuadro: (f: VideoFrame) => void, esperar: () => boolean = () => false) {
  let erro: unknown = null;
  const d = new VideoDecoder({ output: aoQuadro, error: (x) => (erro = x) });
  d.configure(cfg);
  for (let i = 0; i < total && !erro; i++) {
    d.decode(pedaco(a.quadros[i % a.quadros.length], i));
    while ((d.decodeQueueSize > 6 || esperar()) && !erro) await pausa();
  }
  if (!erro) await d.flush().catch((x) => (erro = x));
  if (d.state !== "closed") d.close();
  if (erro) throw erro;
}

/** k decodificações simultâneas: quadros/s de cada uma (0 se o aparelho recusar). */
async function medirDecodificacao(a: Amostra, cfg: VideoDecoderConfig, k: number): Promise<number> {
  const total = Math.max(a.quadros.length * 2, 120);
  const t0 = performance.now();
  await Promise.all(Array.from({ length: k }, () => decodificar(a, cfg, total, (f) => f.close())));
  return total / ((performance.now() - t0) / 1000);
}

// ---------------- composição WebGL2 ----------------

const VERT = `#version 300 es
out vec2 uv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  uv = vec2(p.x, 1.0 - p.y);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;
const FRAG = `#version 300 es
precision mediump float;
in vec2 uv;
uniform sampler2D a, b, titulo;
uniform float mistura, brilho, contraste, saturacao;
out vec4 cor;
void main() {
  vec3 c = mix(texture(a, uv).rgb, texture(b, uv).rgb, mistura);
  c = (c - 0.5) * contraste + 0.5 + brilho;
  c = mix(vec3(dot(c, vec3(0.299, 0.587, 0.114))), c, saturacao);
  vec4 t = texture(titulo, uv);
  cor = vec4(clamp(mix(c, t.rgb, t.a), 0.0, 1.0), 1.0);
}`;

class Compositor {
  readonly canvas: OffscreenCanvas;
  private gl: WebGL2RenderingContext;
  private tex: WebGLTexture[] = [];
  private px = new Uint8Array(4);
  private mistura: WebGLUniformLocation;
  constructor(w: number, h: number) {
    this.canvas = new OffscreenCanvas(w, h);
    const gl = this.canvas.getContext("webgl2", { antialias: false, preserveDrawingBuffer: false });
    if (!gl) throw new Error("WebGL2 indisponível no Worker deste navegador");
    this.gl = gl;
    const sh = (tipo: number, src: string) => {
      const s = gl.createShader(tipo)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`shader: ${gl.getShaderInfoLog(s)}`);
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`programa: ${gl.getProgramInfoLog(p)}`);
    gl.useProgram(p);
    gl.bindVertexArray(gl.createVertexArray());
    ["a", "b", "titulo"].forEach((nome, k) => {
      const t = gl.createTexture()!;
      gl.activeTexture(gl.TEXTURE0 + k);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.uniform1i(gl.getUniformLocation(p, nome), k);
      this.tex.push(t);
    });
    gl.uniform1f(gl.getUniformLocation(p, "brilho"), 0.03);
    gl.uniform1f(gl.getUniformLocation(p, "contraste"), 1.1);
    gl.uniform1f(gl.getUniformLocation(p, "saturacao"), 1.2);
    this.mistura = gl.getUniformLocation(p, "mistura")!;
    // título (texto com sombra) desenhado uma vez em 2D e enviado como textura
    const t2 = new OffscreenCanvas(w, h);
    const g = t2.getContext("2d")!;
    g.font = `700 ${Math.round(h / 10)}px sans-serif`;
    g.shadowColor = "rgba(0,0,0,.6)";
    g.shadowBlur = h / 80;
    g.fillStyle = "#fff";
    g.fillText("Título de teste", w * 0.06, h * 0.18);
    gl.activeTexture(gl.TEXTURE2);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, t2);
    gl.viewport(0, 0, w, h);
  }
  /** Compõe os dois quadros e espera a GPU terminar (como na exportação). */
  desenhar(a: VideoFrame, b: VideoFrame, mistura: number) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, a);
    gl.activeTexture(gl.TEXTURE1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, b);
    gl.uniform1f(this.mistura, mistura);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, this.px);
  }
  fechar() {
    this.gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}

async function medirComposicao(a: Amostra, cfg: VideoDecoderConfig): Promise<number> {
  const guardados: VideoFrame[] = [];
  await decodificar(a, cfg, Math.min(8, a.quadros.length), (f) => (guardados.length < 2 ? guardados.push(f) : f.close()));
  if (guardados.length < 2) throw new Error("não vieram quadros para compor");
  const c = new Compositor(a.res.w, a.res.h);
  try {
    c.desenhar(guardados[0], guardados[1], 0.5); // aquece (compila o shader de verdade)
    const n = 120;
    const t0 = performance.now();
    for (let i = 0; i < n; i++) c.desenhar(guardados[i & 1], guardados[(i + 1) & 1], (i % 30) / 30);
    return n / ((performance.now() - t0) / 1000);
  } finally {
    c.fechar();
    guardados.forEach((f) => f.close());
  }
}

/** Cadeia de exportação: k vídeos decodificados → compostos → codificados. Devolve quadros/s. */
async function medirExportacao(a: Amostra, cfg: VideoDecoderConfig, k: number, total: number): Promise<number> {
  const comp = new Compositor(a.res.w, a.res.h);
  const filas: VideoFrame[][] = Array.from({ length: k }, () => []);
  let n = 0;
  let erroEnc: unknown = null;
  const enc = new VideoEncoder({ output: () => {}, error: (x) => (erroEnc = x) });
  enc.configure(a.encoder);
  const bombear = () => {
    while (filas.every((f) => f.length) && !erroEnc) {
      const fr = filas.map((f) => f.shift()!);
      comp.desenhar(fr[0], fr[1] ?? fr[0], k > 1 ? 0.5 : 0);
      const vf = new VideoFrame(comp.canvas, { timestamp: n * QUADRO_US, duration: QUADRO_US });
      enc.encode(vf, { keyFrame: n % (2 * FPS) === 0 });
      vf.close();
      fr.forEach((f) => f.close());
      n++;
    }
  };
  const t0 = performance.now();
  try {
    await Promise.all(filas.map((fila) => decodificar(a, cfg, total, (f) => { fila.push(f); bombear(); }, () => enc.encodeQueueSize > 6 || fila.length > 3)));
    bombear();
    if (!erroEnc) await enc.flush().catch((x) => (erroEnc = x));
    if (erroEnc) throw erroEnc;
    return n / ((performance.now() - t0) / 1000);
  } finally {
    if (enc.state !== "closed") enc.close();
    filas.flat().forEach((f) => f.close());
    comp.fechar();
  }
}

// ---------------- armazenamento (OPFS) ----------------

async function medirArmazenamento() {
  etapa("Armazenamento do app (cache)");
  const raiz = await navigator.storage.getDirectory();
  const nome = "wjvideo-teste-aparelho.bin";
  const h = await raiz.getFileHandle(nome, { create: true });
  const acesso = await h.createSyncAccessHandle();
  const bloco = new Uint8Array(4 << 20);
  for (let i = 0; i < bloco.length; i++) bloco[i] = (i * 2654435761) >>> 24;
  const blocos = 16; // 64 MB
  try {
    let t0 = performance.now();
    for (let i = 0; i < blocos; i++) acesso.write(bloco, { at: i * bloco.length });
    acesso.flush();
    const escrita = (blocos * 4) / ((performance.now() - t0) / 1000);
    t0 = performance.now();
    for (let i = 0; i < blocos; i++) acesso.read(bloco, { at: i * bloco.length });
    const leitura = (blocos * 4) / ((performance.now() - t0) / 1000);
    linha(`Cache do app (OPFS), 64 MB: escrita ${fmt(escrita, 0)} MB/s · leitura ${fmt(leitura, 0)} MB/s`);
  } finally {
    acesso.close();
    await raiz.removeEntry(nome).catch(() => {});
  }
}

// ---------------- roteiro da medição ----------------

async function medir() {
  const decodificacao: MedidaDecodificacao[] = [];
  const exportacao: MedidaExportacao[] = [];
  let composicao1080: number | undefined;
  let base: { a: Amostra; cfg: VideoDecoderConfig } | null = null;

  for (const res of RESOLUCOES) {
    etapa(`Gerando amostra ${res.nome}`);
    linha(`== ${res.nome} (${res.w}×${res.h}, ${FPS} qps) ==`);
    let a: Amostra | null = null;
    try {
      a = await gerar(res);
    } catch (e) {
      linha(`  não gerou amostra: ${(e as Error).message}`);
    }
    if (!a) {
      linha("  o codificador deste aparelho não aceita esta resolução: decodificação não medida.");
      continue;
    }
    let dec: { cfg: VideoDecoderConfig; hw: boolean };
    try {
      dec = await configDecoder(a);
    } catch (e) {
      linha(`  ${(e as Error).message}`);
      continue;
    }
    linha(`  decodificador: ${dec.hw ? "hardware" : "software ou indefinido"}`);
    for (let k = 1; k <= 4; k++) {
      etapa(`Decodificando ${k} vídeo(s) ${res.nome} ao mesmo tempo`);
      try {
        const fps = await medirDecodificacao(a, dec.cfg, k);
        decodificacao.push({ res: res.alt, fluxos: k, fpsPorFluxo: fps });
        linha(`  ${k} vídeo(s) ao mesmo tempo: ${fmt(fps, 0)} qps cada ${fps >= FPS * 1.2 ? "✓ tempo real" : "✗ abaixo do tempo real"}`);
        if (fps < FPS * 0.5) break; // já está muito abaixo: não insiste
      } catch (e) {
        linha(`  ${k} vídeo(s) ao mesmo tempo: recusado (${(e as Error).message || e})`);
        break;
      }
    }
    if (res.alt === 1080 || (res.alt === 720 && !base)) base = { a, cfg: dec.cfg };
  }

  if (base) {
    const { a, cfg } = base;
    try {
      etapa(`Composição WebGL2 ${a.res.nome}`);
      const fps = await medirComposicao(a, cfg);
      if (a.res.alt === 1080) composicao1080 = fps;
      linha(`== Composição WebGL2 no Worker (${a.res.nome}: 2 vídeos + cor + título) ==\n  ${fmt(fps, 0)} qps ${fps >= FPS * 1.2 ? "✓" : "✗ abaixo do tempo real"}`);
    } catch (e) {
      linha(`== Composição WebGL2: falhou — ${(e as Error).message}`);
    }
    linha(`== Exportação (${a.res.nome}, 10 s de vídeo, ${a.encoder.codec}) ==`);
    for (const k of [1, 2]) {
      etapa(`Exportando 10 s com ${k} vídeo(s)`);
      try {
        const fps = await medirExportacao(a, cfg, k, 10 * FPS);
        exportacao.push({ res: a.res.alt, fluxos: k, fps });
        linha(`  ${k} vídeo(s): ${fmt(fps, 0)} qps → 1 min de vídeo exporta em ≈ ${fmt(FPS / fps)} min`);
      } catch (e) {
        linha(`  ${k} vídeo(s): falhou — ${(e as Error).message || e}`);
      }
    }
  } else linha("Sem amostra de vídeo: composição e exportação não medidas.");

  try {
    await medirArmazenamento();
  } catch (e) {
    linha(`Cache do app (OPFS): não medido — ${(e as Error).message}`);
  }
  ctx.postMessage({ tipo: "fim", medidas: { decodificacao, exportacao, composicao1080 } });
}

ctx.onmessage = (ev: MessageEvent<{ tipo: string }>) => {
  if (ev.data.tipo === "medir")
    medir().catch((e) => ctx.postMessage({ tipo: "erro", texto: (e as Error).message || String(e) }));
};
