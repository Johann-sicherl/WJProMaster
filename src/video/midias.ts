// WJVideoMaker — mídias do projeto. Os arquivos vêm do aparelho (galeria, câmera, Downloads, pendrive
// pelo seletor do sistema) ou do cofre do WJPDM; uma cópia fica no armazenamento do app (OPFS,
// wjvideo/midia/<id>) para o projeto abrir de novo sem pedir o arquivo. A leitura das informações
// (duração, tamanho do quadro, se tem som, se o aparelho decodifica) usa a mediabunny, carregada só
// na primeira importação.

import { classificarArquivo, ehHeic } from "./capacidade";
import { novoId, type Midia } from "./projeto";

const pasta = async () => (await (await navigator.storage.getDirectory()).getDirectoryHandle("wjvideo", { create: true })).getDirectoryHandle("midia", { create: true });

/** Arquivo guardado da mídia (null se não está neste aparelho). */
export async function arquivoDaMidia(id: string): Promise<File | null> {
  try {
    return await (await (await pasta()).getFileHandle(id)).getFile();
  } catch {
    return null;
  }
}

async function guardar(id: string, dados: Blob) {
  const h = await (await pasta()).getFileHandle(id, { create: true });
  const w = await h.createWritable();
  await dados.stream().pipeTo(w); // fecha o arquivo ao terminar
}

/** Lê as informações da mídia. Lança erro com mensagem clara se o aparelho não abre o arquivo. */
export async function analisar(dados: Blob, nome: string): Promise<Omit<Midia, "id">> {
  const tipo = classificarArquivo(nome, dados.type);
  if (tipo === "imagem") {
    try {
      const b = await createImageBitmap(dados);
      const r = { nome, tipo: "imagem" as const, duracaoUs: 0, largura: b.width, altura: b.height, temAudio: false, tamanho: dados.size };
      b.close();
      return r;
    } catch {
      throw new Error(ehHeic(nome, dados.type) ? `${nome}: foto HEIC não abre no navegador; exporte como JPEG na galeria e importe de novo.` : `${nome}: imagem que este aparelho não abre.`);
    }
  }
  if (tipo !== "video") throw new Error(`${nome}: use vídeo (MP4, MOV, WebM) ou foto (JPEG, PNG, WebP).`);
  const { Input, BlobSource, ALL_FORMATS } = await import("mediabunny");
  const entrada = new Input({ source: new BlobSource(dados), formats: ALL_FORMATS });
  try {
    const v = await entrada.getPrimaryVideoTrack().catch(() => null);
    if (!v) throw new Error(`${nome}: arquivo sem vídeo ou formato que o editor não lê.`);
    if (!(await v.canDecode())) {
      const codec = (await v.getCodecParameterString().catch(() => null)) ?? v.codec ?? "?";
      throw new Error(`${nome}: este aparelho não decodifica o vídeo (${codec}${/hvc1\.2|hev1\.2/.test(codec) ? ", H.265 10 bits/HDR: grave sem HDR" : ""}).`);
    }
    const a = await entrada.getPrimaryAudioTrack().catch(() => null);
    const duracao = await entrada.computeDuration();
    return {
      nome, tipo: "video", duracaoUs: Math.round(duracao * 1e6), largura: v.displayWidth, altura: v.displayHeight,
      temAudio: !!a && (await a.canDecode().catch(() => false)), tamanho: dados.size,
    };
  } finally {
    entrada.dispose();
  }
}

/** Importa um arquivo: lê as informações e guarda uma cópia no app. */
export async function importarMidia(dados: Blob, nome: string): Promise<Midia> {
  const info = await analisar(dados, nome);
  const m: Midia = { id: novoId(), ...info };
  await guardar(m.id, dados);
  return m;
}

/** Recoloca o arquivo de uma mídia que ficou fora deste aparelho ("Localizar…"). */
export async function relocalizar(m: Midia, dados: Blob): Promise<void> {
  await guardar(m.id, dados);
}

/** Espaço usado pelas mídias guardadas (bytes). */
export async function espacoUsado(): Promise<number> {
  const p = await pasta();
  let total = 0;
  for await (const h of (p as unknown as { values(): AsyncIterable<FileSystemFileHandle> }).values()) total += (await h.getFile()).size;
  return total;
}
