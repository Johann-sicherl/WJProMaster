// WJVideoMaker — capacidades do aparelho (puro, testado em scripts/teste-video.ts).
// Lista o que o teste do aparelho (fase V0, video/aparelho/) pergunta ao navegador e transforma
// as medições em recomendações para o editor: quantos vídeos tocam juntos, quando usar proxy,
// qualidade da prévia, formato e resolução de exportação.

export type Alt = 720 | 1080 | 2160;
export interface Resolucao { nome: string; alt: Alt; w: number; h: number }

export const RESOLUCOES: Resolucao[] = [
  { nome: "720p", alt: 720, w: 1280, h: 720 },
  { nome: "1080p", alt: 1080, w: 1920, h: 1080 },
  { nome: "4K", alt: 2160, w: 3840, h: 2160 },
];

/** Cadeias de codec (RFC 6381) por resolução, com nível suficiente para ela. */
export interface PerfilVideo { nome: string; familia: "h264" | "hevc" | "vp9" | "av1" | "vp8"; dezBits?: boolean; codec: Record<Alt, string> }

export const PERFIS_VIDEO: PerfilVideo[] = [
  { nome: "H.264", familia: "h264", codec: { 720: "avc1.64001F", 1080: "avc1.640028", 2160: "avc1.640033" } },
  { nome: "H.265 (HEVC)", familia: "hevc", codec: { 720: "hvc1.1.6.L93.B0", 1080: "hvc1.1.6.L120.B0", 2160: "hvc1.1.6.L150.B0" } },
  { nome: "H.265 10 bits", familia: "hevc", dezBits: true, codec: { 720: "hvc1.2.4.L93.B0", 1080: "hvc1.2.4.L120.B0", 2160: "hvc1.2.4.L150.B0" } },
  { nome: "VP9", familia: "vp9", codec: { 720: "vp09.00.31.08", 1080: "vp09.00.40.08", 2160: "vp09.00.50.08" } },
  { nome: "VP9 10 bits", familia: "vp9", dezBits: true, codec: { 720: "vp09.02.31.10", 1080: "vp09.02.40.10", 2160: "vp09.02.50.10" } },
  { nome: "AV1", familia: "av1", codec: { 720: "av01.0.05M.08", 1080: "av01.0.08M.08", 2160: "av01.0.12M.08" } },
  { nome: "VP8", familia: "vp8", codec: { 720: "vp8", 1080: "vp8", 2160: "vp8" } },
];

export interface PerfilAudio { nome: string; codec: string; amostragem: number }
export const PERFIS_AUDIO: PerfilAudio[] = [
  { nome: "AAC", codec: "mp4a.40.2", amostragem: 48000 },
  { nome: "Opus", codec: "opus", amostragem: 48000 },
  { nome: "MP3", codec: "mp3", amostragem: 44100 },
  { nome: "FLAC", codec: "flac", amostragem: 48000 },
  { nome: "PCM 16 bits", codec: "pcm-s16", amostragem: 48000 },
];

export const TIPOS_IMAGEM: { nome: string; mime: string }[] = [
  { nome: "JPEG", mime: "image/jpeg" },
  { nome: "PNG", mime: "image/png" },
  { nome: "WebP", mime: "image/webp" },
  { nome: "GIF", mime: "image/gif" },
  { nome: "AVIF", mime: "image/avif" },
  { nome: "HEIC/HEIF", mime: "image/heic" },
];

/** Codecs tentados (em ordem) para gerar o vídeo de teste numa resolução. */
export const codecsParaGerar = (alt: Alt) => [PERFIS_VIDEO[0].codec[alt], PERFIS_VIDEO[3].codec[alt], "vp8"];

/** Taxa de bits de exportação (bit/s): ~0,2 bit por pixel por quadro (1080p30 ≈ 12 Mbit/s). */
export const taxaBits = (w: number, h: number, fps: number) => Math.round((w * h * fps * 0.2) / 100_000) * 100_000;

/** Situação de um codec: decodifica/codifica com hardware, só por software, ou não. */
export type Suporte = "hardware" | "software" | "nao";
export const simboloSuporte = (s: Suporte) => (s === "hardware" ? "✓ hardware" : s === "software" ? "software" : "—");

// ---------------- arquivos ----------------

export type TipoMidia = "video" | "imagem" | "audio" | "legenda" | "lut";
const EXT: Record<string, TipoMidia> = {
  mp4: "video", m4v: "video", mov: "video", webm: "video", mkv: "video", "3gp": "video", avi: "video", mts: "video", m2ts: "video",
  jpg: "imagem", jpeg: "imagem", png: "imagem", webp: "imagem", gif: "imagem", avif: "imagem", heic: "imagem", heif: "imagem", bmp: "imagem", svg: "imagem",
  mp3: "audio", m4a: "audio", aac: "audio", wav: "audio", flac: "audio", ogg: "audio", opus: "audio", oga: "audio",
  srt: "legenda", vtt: "legenda",
  cube: "lut",
};

/** Tipo de mídia pelo nome (extensão) e, se faltar, pelo tipo MIME. */
export function classificarArquivo(nome: string, mime = ""): TipoMidia | null {
  const ext = nome.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (ext && EXT[ext]) return EXT[ext];
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("image/")) return "imagem";
  if (mime.startsWith("audio/")) return "audio";
  return null;
}

/** Fotos HEIC/HEIF: o Chrome não decodifica (aviso com a dica de exportar como JPEG). */
export const ehHeic = (nome: string, mime = "") => /\.(heic|heif)$/i.test(nome) || /image\/hei[cf]/i.test(mime);

// ---------------- recomendações ----------------

export interface MedidaDecodificacao { res: Alt; fluxos: number; fpsPorFluxo: number }
export interface MedidaExportacao { res: Alt; fluxos: number; fps: number }
export interface Medidas {
  /** Vídeos decodificados ao mesmo tempo e quadros/s de cada um. */
  decodificacao: MedidaDecodificacao[];
  /** Quadros/s da composição WebGL2 (2 vídeos + cor + título) em 1080p, se medida. */
  composicao1080?: number;
  /** Cadeia completa decodificar → compor → codificar. */
  exportacao: MedidaExportacao[];
  /** Codificação de vídeo H.264 por resolução. */
  codificaH264: Partial<Record<Alt, Suporte>>;
  /** Decodificação H.264 por resolução (hardware/software): a amostra sintética é leve, então
   *  4K por software "passa" no teste mas trava com vídeo de câmera (taxa muitas vezes maior). */
  decodificaH264?: Partial<Record<Alt, Suporte>>;
  /** H.265 10 bits (vídeo HDR de celular) abre neste aparelho? */
  decodificaHevc10?: boolean;
  codificaVp9: Partial<Record<Alt, Suporte>>;
  codificaAac: boolean;
  codificaOpus: boolean;
}

export interface Recomendacao {
  /** Vídeos 1080p30 que tocam juntos (transições e sobreposições). */
  fluxos1080: number;
  fluxos720: number;
  /** Acima desta resolução a edição usa proxy (null = nunca precisa). */
  proxyAcima: Alt | null;
  qualidadePrevia: "completa" | "metade" | "um quarto";
  /** Maior resolução de exportação recomendada. */
  exportarAte: Alt | null;
  formatoSaida: string;
  /** Minutos para exportar 1 min de vídeo simples (1 vídeo) e com 2 vídeos sobrepostos. */
  minutosPorMinuto1: number | null;
  minutosPorMinuto2: number | null;
  avisos: string[];
}

const FPS_ALVO = 30;
const FOLGA = 1.2; // 20 % de folga: o decodificador também divide o aparelho com a composição e o áudio

/** Quantos vídeos simultâneos ainda decodificam em tempo real (≥ 36 qps cada) nessa resolução. */
export function fluxosEmTempoReal(m: MedidaDecodificacao[], res: Alt, fps = FPS_ALVO): number {
  let melhor = 0;
  for (const d of m) if (d.res === res && d.fpsPorFluxo >= fps * FOLGA) melhor = Math.max(melhor, d.fluxos);
  return melhor;
}

const ORDEM: Alt[] = [720, 1080, 2160];

export function recomendar(m: Medidas): Recomendacao {
  const avisos: string[] = [];
  const fluxos720 = fluxosEmTempoReal(m.decodificacao, 720);
  const fluxos1080 = fluxosEmTempoReal(m.decodificacao, 1080);
  const fluxos4k = fluxosEmTempoReal(m.decodificacao, 2160);
  const mediu4k = m.decodificacao.some((d) => d.res === 2160);

  const dec4kHw = m.decodificaH264?.[2160] === "hardware";
  let proxyAcima: Alt | null;
  if (fluxos4k >= 1 && fluxos1080 >= 2 && dec4kHw) proxyAcima = null;
  else if (fluxos1080 >= 1) proxyAcima = 1080;
  else proxyAcima = 720;
  if (!mediu4k) avisos.push("Não deu para medir 4K (o codificador não gera amostra 4K): vídeos 4K serão editados por proxy.");
  if (fluxos1080 === 0 && fluxos720 === 0) avisos.push("Nem um vídeo 720p decodifica em tempo real: a prévia vai pular quadros (a exportação continua correta).");
  else if (fluxos1080 < 2) avisos.push("Transições e sobreposições em 1080p não tocam lisas: a prévia usa metade da resolução nesses trechos.");
  else if (fluxos1080 < 3) avisos.push(`Até ${fluxos1080} vídeos 1080p ao mesmo tempo tocam lisos; com mais camadas a prévia usa metade da resolução nesses trechos.`);
  if (mediu4k && !dec4kHw) avisos.push("4K só decodifica por software neste aparelho: a amostra de teste é leve e passa, mas vídeo 4K de câmera travaria; ele será editado por proxy.");
  if (m.decodificaHevc10 === false) avisos.push("Vídeos H.265 10 bits (HDR de celular) não abrem neste aparelho: grave sem HDR ou converta antes.");

  let qualidadePrevia: Recomendacao["qualidadePrevia"] = "completa";
  if (fluxos1080 < 1 || (m.composicao1080 !== undefined && m.composicao1080 < FPS_ALVO * FOLGA)) qualidadePrevia = "metade";
  if (fluxos720 < 1) qualidadePrevia = "um quarto";

  // exporta até a maior resolução que o aparelho codifica em H.264 (ou VP9, se não houver H.264)
  const codifica = (r: Alt) => (m.codificaH264[r] ?? "nao") !== "nao" || (m.codificaVp9[r] ?? "nao") !== "nao";
  let exportarAte: Alt | null = null;
  for (const r of ORDEM) if (codifica(r)) exportarAte = r;
  // 4K só se codificar em hardware: por software seria lento demais
  if (exportarAte === 2160 && m.codificaH264[2160] !== "hardware" && m.codificaVp9[2160] !== "hardware") exportarAte = codifica(1080) ? 1080 : 720;

  const h264 = ORDEM.some((r) => (m.codificaH264[r] ?? "nao") !== "nao");
  const vp9 = ORDEM.some((r) => (m.codificaVp9[r] ?? "nao") !== "nao");
  let formatoSaida: string;
  if (h264 && m.codificaAac) formatoSaida = "MP4 (H.264 + AAC)";
  else if (h264 && m.codificaOpus) {
    formatoSaida = "MP4 (H.264 + Opus)";
    avisos.push("Este aparelho não codifica AAC: o MP4 sai com áudio Opus (toca no Chrome, Android e players atuais; alguns aparelhos antigos podem não tocar o som).");
  } else if (vp9 && m.codificaOpus) {
    formatoSaida = "WebM (VP9 + Opus)";
    avisos.push("Este aparelho não codifica H.264: a exportação padrão será WebM.");
  } else {
    formatoSaida = "nenhum";
    avisos.push("O navegador deste aparelho não codifica vídeo: só dá para editar, não exportar.");
  }

  const minutos = (fluxos: number) => {
    const e = m.exportacao.filter((x) => x.fluxos === fluxos).sort((a, b) => b.res - a.res)[0];
    return e && e.fps > 0 ? FPS_ALVO / e.fps : null;
  };
  const minutosPorMinuto1 = minutos(1);
  const minutosPorMinuto2 = minutos(2);
  if (minutosPorMinuto1 !== null && minutosPorMinuto1 > 3) avisos.push("A exportação é lenta neste aparelho: deixe-o na tomada e com o app aberto durante a exportação.");

  return { fluxos1080, fluxos720, proxyAcima, qualidadePrevia, exportarAte, formatoSaida, minutosPorMinuto1, minutosPorMinuto2, avisos };
}

const nomeRes = (a: Alt | null) => (a === null ? "—" : a === 2160 ? "4K" : `${a}p`);
const num = (v: number, d = 1) => v.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });

/** Texto do resumo mostrado na página e copiado no relatório. */
export function textoRecomendacao(r: Recomendacao): string[] {
  const l = [
    `Vídeos 1080p que tocam juntos: ${r.fluxos1080} (720p: ${r.fluxos720})`,
    `Proxy (cópia leve para editar): ${r.proxyAcima === null ? "não precisa" : `vídeos acima de ${nomeRes(r.proxyAcima)}`}`,
    `Qualidade da prévia: ${r.qualidadePrevia}`,
    `Exportar até: ${nomeRes(r.exportarAte)} · formato padrão: ${r.formatoSaida}`,
  ];
  if (r.minutosPorMinuto1 !== null) l.push(`Exportar 1 min de vídeo: ≈ ${num(r.minutosPorMinuto1)} min (1 vídeo)${r.minutosPorMinuto2 !== null ? ` · ≈ ${num(r.minutosPorMinuto2)} min (2 vídeos sobrepostos)` : ""}`);
  for (const a of r.avisos) l.push(`! ${a}`);
  return l;
}
