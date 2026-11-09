// WJVideoMaker — exportação em MP4 num Worker (a interface continua solta durante a exportação).
// Vídeo: cada quadro do plano (planoDeQuadros) vem da mídia já redimensionada e com a rotação do
// celular aplicada (CanvasSink da mediabunny), é desenhado com os textos (desenho.ts, o mesmo da
// prévia) e codificado pelo codificador do aparelho (H.264 de preferência). Áudio: os trechos de cada
// clipe, contínuos (silêncio nas fotos e nos clipes mudos), convertidos para 48 kHz estéreo pelo
// reamostrador (audio.ts), que aplica a velocidade do clipe junto (o tom acompanha a velocidade, como
// uma fita acelerada). O arquivo é gravado no armazenamento do app (OPFS) aos poucos,
// sem guardar o vídeo inteiro na memória.

import {
  ALL_FORMATS, AudioSample, AudioSampleSink, AudioSampleSource, BlobSource, CanvasSink, CanvasSource, Input, Mp4OutputFormat, Output, StreamTarget,
  getFirstEncodableAudioCodec, getFirstEncodableVideoCodec, type StreamTargetChunk,
} from "mediabunny";
import { Reamostrador, TAXA_SAIDA } from "./audio";
import { desenharMidia, desenharTextos } from "./desenho";
import { AUDIO_BPS, caixaInteira, linhaDoTempo, planoDeQuadros, textosEm, duracaoTotal, type Clipe, type Midia, type Projeto, type QuadroSaida } from "./projeto";
import { fpsDecimal, tempoDoQuadro } from "./tempo";

export interface PedidoExportar {
  tipo: "exportar";
  projeto: Projeto;
  arquivos: Record<string, File>;
  largura: number;
  altura: number;
  bitrateVideo: number;
  nome: string;
}
export type RespostaExportar =
  | { tipo: "progresso"; feito: number; total: number }
  | { tipo: "fim"; arquivo: File; codecVideo: string; codecAudio: string | null }
  | { tipo: "erro"; texto: string };

const ctxW = self as unknown as Worker;
const enviar = (r: RespostaExportar) => ctxW.postMessage(r);
const TAXA = TAXA_SAIDA;

interface Bloco { canais: Float32Array[]; taxa: number; t: number }

async function exportar(o: PedidoExportar) {
  const p = o.projeto;
  const W = o.largura, H = o.altura;
  const fps = fpsDecimal(p.fps);
  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext("2d", { alpha: false })!;
  const midia = (id: string) => p.midias.find((m) => m.id === id)!;

  const codecVideo = await getFirstEncodableVideoCodec(["avc", "hevc", "vp9", "av1"], { width: W, height: H, bitrate: o.bitrateVideo });
  if (!codecVideo) throw new Error(`este aparelho não codifica vídeo em ${W}×${H}; escolha uma resolução menor.`);
  const comSom = p.clipes.some((c) => c.volume > 0 && midia(c.midia).temAudio);
  const codecAudio = comSom ? await getFirstEncodableAudioCodec(["aac", "opus"], { numberOfChannels: 2, sampleRate: TAXA, bitrate: AUDIO_BPS }) : null;

  // destino: armazenamento do app (sobrescreve a exportação anterior)
  const pasta = await (await (await navigator.storage.getDirectory()).getDirectoryHandle("wjvideo", { create: true })).getDirectoryHandle("exportar", { create: true });
  for await (const nome of (pasta as unknown as { keys(): AsyncIterable<string> }).keys()) await pasta.removeEntry(nome).catch(() => {});
  // nome interno sem acentos (há navegadores que recusam acento no armazenamento do app); o arquivo
  // entregue ao usuário leva o nome escolhido (abaixo, sem copiar os dados)
  const h = await pasta.getFileHandle("exportado.mp4", { create: true });
  const gravador = await h.createWritable();
  const saida = new Output({ format: new Mp4OutputFormat(), target: new StreamTarget(gravador as unknown as WritableStream<StreamTargetChunk>, { chunked: true }) });
  const fonteVideo = new CanvasSource(canvas, { codec: codecVideo, bitrate: o.bitrateVideo, keyFrameInterval: 2 });
  saida.addVideoTrack(fonteVideo, { frameRate: fps });
  const fonteAudio = codecAudio ? new AudioSampleSource({ codec: codecAudio, bitrate: AUDIO_BPS }) : null;
  if (fonteAudio) saida.addAudioTrack(fonteAudio);
  await saida.start();

  // entradas abertas uma vez por mídia
  const entradas = new Map<string, Input>();
  const entrada = (m: Midia) => {
    let e = entradas.get(m.id);
    if (!e) {
      e = new Input({ source: new BlobSource(o.arquivos[m.id]), formats: ALL_FORMATS });
      entradas.set(m.id, e);
    }
    return e;
  };
  const fotos = new Map<string, ImageBitmap>();

  // ---------- áudio contínuo ----------
  let audioAte = 0; // segundos já entregues ao codificador
  const entregar = async (b: Bloco, limite: number) => {
    if (!fonteAudio) return;
    if (b.t > audioAte + 0.002) await silencio(b.t);
    let frames = b.canais[0].length;
    let ini = 0;
    if (b.t < audioAte) ini = Math.min(frames, Math.round((audioAte - b.t) * b.taxa)); // sobreposição por arredondamento
    const fim = Math.min(frames, Math.max(ini, Math.round((limite - b.t) * b.taxa)));
    frames = fim - ini;
    if (frames <= 0) return;
    const nc = b.canais.length;
    const dados = new Float32Array(frames * nc);
    b.canais.forEach((c, k) => dados.set(c.subarray(ini, fim), k * frames));
    const taxa = Math.round(b.taxa);
    const a = new AudioSample({ data: dados, format: "f32-planar", numberOfChannels: nc, sampleRate: taxa, timestamp: audioAte });
    await fonteAudio.add(a);
    a.close();
    audioAte += frames / taxa;
  };
  const silencio = async (ate: number) => {
    if (!fonteAudio) return;
    while (audioAte < ate - 0.0005) {
      const n = Math.min(TAXA, Math.max(1, Math.round((ate - audioAte) * TAXA)));
      const a = new AudioSample({ data: new Float32Array(n * 2), format: "f32-planar", numberOfChannels: 2, sampleRate: TAXA, timestamp: audioAte });
      await fonteAudio.add(a);
      a.close();
      audioAte += n / TAXA;
    }
  };
  async function* audioDoClipe(c: Clipe, inicioSaida: number): AsyncGenerator<Bloco> {
    const m = midia(c.midia);
    if (!fonteAudio || m.tipo !== "video" || !m.temAudio || c.volume <= 0) return;
    const faixa = await entrada(m).getPrimaryAudioTrack().catch(() => null);
    if (!faixa || !(await faixa.canDecode().catch(() => false))) return;
    const e = c.entradaUs / 1e6, s = c.saidaUs / 1e6;
    let conv: Reamostrador | null = null;
    for await (const a of new AudioSampleSink(faixa).samples(e, s)) {
      const sr = a.sampleRate;
      const f0 = Math.max(0, Math.round((e - a.timestamp) * sr));
      const f1 = Math.min(a.numberOfFrames, Math.round((s - a.timestamp) * sr));
      if (f1 > f0) {
        const n = f1 - f0;
        const canais: Float32Array[] = [];
        for (let k = 0; k < a.numberOfChannels; k++) {
          const buf = new Float32Array(n);
          a.copyTo(buf, { planeIndex: k, format: "f32-planar", frameOffset: f0, frameCount: n });
          if (c.volume !== 1) for (let i = 0; i < n; i++) buf[i] = Math.max(-1, Math.min(1, buf[i] * c.volume));
          canais.push(buf);
        }
        const tMidia = a.timestamp + f0 / sr;
        conv ??= new Reamostrador(sr, c.velocidade);
        const [esq, dir] = conv.processar(canais);
        if (esq.length) yield { canais: [esq, dir], taxa: TAXA, t: inicioSaida + (tMidia - e) / c.velocidade };
      }
      a.close();
    }
  }

  // ---------- vídeo, clipe a clipe ----------
  const quadros = [...planoDeQuadros(p)];
  const total = quadros.length;
  const linha = linhaDoTempo(p);
  let i = 0;
  while (i < total) {
    const k = quadros[i].indiceClipe;
    let j = i;
    while (j < total && quadros[j].indiceClipe === k) j++;
    const trecho = quadros.slice(i, j);
    const pos = k >= 0 ? linha[k] : null;
    const m = pos ? midia(pos.clipe.midia) : null;
    const fimTrecho = pos ? pos.fim / 1e6 : duracaoTotal(p) / 1e6;
    const audio = pos ? audioDoClipe(pos.clipe, pos.inicio / 1e6) : null;
    let pendente: Bloco | null = null;
    let audioFim = !audio;
    // entrega o áudio do clipe até o tempo t (adiantado meio segundo, intercalado com o vídeo)
    const audioAte_ = async (t: number) => {
      while (!audioFim && audioAte < t) {
        if (!pendente) {
          const r = await audio!.next();
          if (r.done) {
            audioFim = true;
            break;
          }
          pendente = r.value;
        }
        await entregar(pendente, fimTrecho);
        pendente = null;
      }
    };
    const desenharQuadro = async (q: QuadroSaida, fonte: CanvasImageSource | null, sw: number, sh: number) => {
      desenharMidia(ctx, W, H, fonte, sw, sh);
      const t = tempoDoQuadro(q.n, p.fps);
      desenharTextos(ctx, W, H, textosEm(p, t));
      await fonteVideo.add(q.n / fps, 1 / fps);
      await audioAte_((q.n + 1) / fps + 0.5);
      if (q.n % 10 === 0) enviar({ tipo: "progresso", feito: q.n, total });
    };
    if (m?.tipo === "video") {
      const faixa = await entrada(m).getPrimaryVideoTrack();
      if (!faixa) throw new Error(`${m.nome}: sem vídeo.`);
      const r = caixaInteira(faixa.displayWidth, faixa.displayHeight, W, H);
      const sink = new CanvasSink(faixa, { width: Math.max(2, Math.round(r.w)), height: Math.max(2, Math.round(r.h)), fit: "fill", poolSize: 2 });
      let n = 0;
      for await (const wc of sink.canvasesAtTimestamps(trecho.map((q) => q.tMidia / 1e6))) {
        const q = trecho[n++];
        await desenharQuadro(q, wc?.canvas ?? null, wc?.canvas.width ?? 0, wc?.canvas.height ?? 0);
      }
    } else if (m?.tipo === "imagem") {
      let bmp = fotos.get(m.id);
      if (!bmp) fotos.set(m.id, (bmp = await createImageBitmap(o.arquivos[m.id])));
      for (const q of trecho) await desenharQuadro(q, bmp, bmp.width, bmp.height);
    } else for (const q of trecho) await desenharQuadro(q, null, 0, 0);
    await audioAte_(Infinity);
    await silencio(fimTrecho);
    i = j;
  }
  await silencio(total / fps);
  enviar({ tipo: "progresso", feito: total, total });
  await saida.finalize();
  for (const e of entradas.values()) e.dispose();
  for (const b of fotos.values()) b.close();
  const nomeFinal = `${o.nome.replace(/[\\/:*?"<>|]/g, "_").trim() || "video"}.mp4`;
  return { arquivo: new File([await h.getFile()], nomeFinal, { type: "video/mp4" }), codecVideo, codecAudio };
}

ctxW.onmessage = (ev: MessageEvent<PedidoExportar>) => {
  if (ev.data?.tipo !== "exportar") return;
  exportar(ev.data).then(
    (r) => enviar({ tipo: "fim", ...r }),
    (e) => enviar({ tipo: "erro", texto: (e as Error)?.message || String(e) }),
  );
};
