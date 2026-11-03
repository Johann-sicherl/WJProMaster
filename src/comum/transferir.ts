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

/** Guarda um valor (JSON/estruturado) para outra página, pela chave. */
export async function deixar(chave: string, valor: unknown) {
  await (await abrir()).por("arquivos", { id: `valor:${chave}`, valor } as { id: string });
}

/** Lê o valor deixado; `apagar` = só serve uma vez. */
export async function pegar<T>(chave: string, apagar = true): Promise<T | null> {
  const a = await abrir();
  const r = await a.ler<{ id: string; valor: T }>("arquivos", `valor:${chave}`);
  if (r && apagar) await a.apagar("arquivos", `valor:${chave}`);
  return r ? r.valor : null;
}

export async function esquecer(chave: string) {
  await (await abrir()).apagar("arquivos", `valor:${chave}`);
}
