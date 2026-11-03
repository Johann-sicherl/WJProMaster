// Ícone de cada tipo de recurso na árvore (Peça e componentes na Montagem).

import type { Feature } from "../model";
import type { NomeIcone } from "../icones";

export const ICONE_FEATURE: Record<Feature["tipo"], NomeIcone> = {
  esboco: "esboco", extrusao: "extrusao", revolucao: "revolucao", filete: "filete", chanfro: "chanfro",
  casca: "casca", inclinacao: "inclinacaoRecurso", nervura: "nervura", furo: "furo", padraoLinear: "padraoLinear",
  padraoCircular: "padraoCircular", espelhar: "espelhar", planoRef: "plano", eixoRef: "eixoRef",
  varredura: "varredura", loft: "loft", curva: "helice",
  flangeBase: "flangeBase", flangeAresta: "flangeAresta", bainha: "bainha", abaChapa: "aba", corteChapa: "corteChapa", dobraEsboco: "dobra", junta: "junta", meiaEsquadria: "meiaEsquadria",
  fecharCanto: "fecharCanto", alivioCanto: "alivioCanto", quebrarCanto: "quebrarCanto",
  desdobrar: "desdobrar", dobrar: "dobrar", converterChapa: "converterChapa", importado: "abrir", moverFace: "moverFace", excluirFace: "excluirFace", substituirFace: "substituirFace",
};

export function iconeFeature(f: Feature): NomeIcone {
  if (f.tipo === "extrusao" && f.operacao === "cortar") return "corte";
  if (f.tipo === "revolucao" && f.operacao === "cortar") return "corteRevolucao";
  if (f.tipo === "varredura" && f.operacao === "cortar") return "corteVarredura";
  if (f.tipo === "loft" && f.operacao === "cortar") return "corteLoft";
  if (f.tipo === "curva") return ({ helice: "helice", xyz: "curvaXYZ", pontosRef: "curvaPontos", composta: "curvaComposta", projetada: "curvaProjetada" } as const)[f.modo];
  return ICONE_FEATURE[f.tipo];
}
