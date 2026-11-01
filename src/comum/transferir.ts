// Arquivo grande passado de uma página para outra (ex.: montagem STEP aberta na Peça segue para a
// Montagem). Vai pelo IndexedDB: o localStorage não comporta vários MB.

import { Armazem } from "./armazem";

const abrir = () => Armazem.abrir("wjcad-transferencia", ["arquivos"]);

export async function deixarArquivo(nome: string, bytes: Uint8Array) {
  await (await abrir()).por("arquivos", { id: "arquivo", nome, bytes } as { id: string });
}

/** Lê e apaga (só serve uma vez). */
export async function pegarArquivo(): Promise<{ nome: string; bytes: Uint8Array } | null> {
  const a = await abrir();
  const r = await a.ler<{ id: string; nome: string; bytes: Uint8Array }>("arquivos", "arquivo");
  if (r) await a.apagar("arquivos", "arquivo");
  return r ? { nome: r.nome, bytes: r.bytes } : null;
}
