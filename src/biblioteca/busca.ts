// Árvore e busca da biblioteca de componentes de fixação (puro). A busca ignora acento e maiúscula e
// exige todas as palavras (grupo, tipo, norma, nome, palavras-chave).

import { FAMILIAS, type Familia, type Grupo } from "./dados";

export const ORDEM_GRUPOS: Grupo[] = ["Parafusos", "Porcas", "Arruelas", "Rebites", "Pinos"];

const limpar = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Grupos na ordem da árvore, cada um com as famílias (tipo/norma) dele. */
export function arvore(lista: Familia[] = FAMILIAS): { grupo: Grupo; familias: Familia[] }[] {
  return ORDEM_GRUPOS.map((grupo) => ({ grupo, familias: lista.filter((f) => f.grupo === grupo) })).filter((g) => g.familias.length);
}

/** Famílias que casam com todas as palavras do texto (vazio = todas). */
export function buscar(texto: string, lista: Familia[] = FAMILIAS): Familia[] {
  const palavras = limpar(texto).split(/\s+/).filter(Boolean);
  if (!palavras.length) return lista;
  return lista.filter((f) => {
    const alvo = limpar(`${f.grupo} ${f.tipo} ${f.norma} ${f.nome} ${f.chaves ?? ""}`);
    return palavras.every((p) => alvo.includes(p));
  });
}
