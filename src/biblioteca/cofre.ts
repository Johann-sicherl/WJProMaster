// Biblioteca de fixação ↔ cofre do WJPDM: a peça gerada é salva em CAD › Biblioteca com o nome padronizado
// ("Parafuso ISO 4762 M6x20") e REUTILIZADA se já existir (mesmo nome); o cartão de dados já nasce com
// descrição e material, e a lista de materiais da montagem lê as propriedades da própria peça. Engrenagens:
// CAD › Biblioteca › Engrenagens, nome com os valores ("Engrenagem reta m2 z20 b20").

import { MATERIAIS, validarDocumento, type Documento, type ParamEngrenagem } from "../model";
import { gravarArquivoFixo, lerArquivoFixo, lerDoCofre } from "../comum/cofre";
import { gerarPeca, type Pedido, type Resultado } from "./gerar";
import { documentoEngrenagem } from "./engrenagens";

export const PASTA_BIBLIOTECA = "Biblioteca";
export const PASTA_ENGRENAGENS = "Engrenagens";

export interface PecaDaBiblioteca {
  doc: Documento;
  /** arquivo do cofre e versão (para embutir na montagem ligada ao cofre) */
  arquivo: string;
  versao: number;
  /** nome do arquivo sem extensão */
  nome: string;
  /** true = já existia no cofre e foi reutilizada */
  reaproveitada: boolean;
  descricao: string;
}

/** Nome do arquivo: o nome padronizado (rosca real ganha o sufixo, são peças diferentes). */
export const nomeDoArquivo = (r: Pick<Resultado, "nome">, roscaReal: boolean) => `${r.nome}${roscaReal ? " (rosca real)" : ""}`;

/** Peça da biblioteca: lê do cofre se já existir, senão gera, salva em CAD › Biblioteca e devolve. */
export async function pecaDaBiblioteca(pedido: Pedido): Promise<PecaDaBiblioteca> {
  const r = gerarPeca(pedido); // valida o pedido (tamanho, comprimento) antes de tocar no cofre
  const roscaReal = r.doc.propriedades?.rosca === "real";
  const nome = nomeDoArquivo(r, roscaReal);
  const arquivo = `${nome}.wjcad`;
  const existente = await lerArquivoFixo("cad", arquivo, [PASTA_BIBLIOTECA]);
  if (existente) {
    const lido = await lerDoCofre(existente.id);
    if (lido) {
      try {
        return { doc: validarDocumento(JSON.parse(lido.texto)), arquivo: existente.id, versao: lido.versao, nome, reaproveitada: true, descricao: r.descricao };
      } catch {
        // arquivo estragado: gera de novo (vira a versão seguinte)
      }
    }
  }
  r.doc.nome = nome;
  const dados = new Blob([JSON.stringify(r.doc)], { type: "application/octet-stream" });
  const cartao: Record<string, string> = { descricao: r.descricao, material: MATERIAIS[r.doc.material ?? ""]?.nome ?? "", codigo: nome, obs: `Biblioteca de componentes — ${r.familia.norma}${r.familia.conferencia === "aproximada" ? " (forma/cotas aproximadas)" : ""}` };
  const gravado = await gravarArquivoFixo("cad", arquivo, dados, { sub: [PASTA_BIBLIOTECA], cartao });
  const lido = gravado.id ? await lerDoCofre(gravado.id) : null;
  return { doc: r.doc, arquivo: gravado.id, versao: lido?.versao ?? 1, nome, reaproveitada: false, descricao: r.descricao };
}

/** Engrenagem da biblioteca: o mesmo conjunto de valores = o mesmo arquivo em CAD › Biblioteca › Engrenagens (reaproveita). */
export async function pecaDeEngrenagem(p: ParamEngrenagem): Promise<PecaDaBiblioteca> {
  const doc = documentoEngrenagem(p); // valida antes de tocar no cofre
  const nome = doc.nome;
  const arquivo = `${nome}.wjcad`;
  const sub = [PASTA_BIBLIOTECA, PASTA_ENGRENAGENS];
  const existente = await lerArquivoFixo("cad", arquivo, sub);
  if (existente) {
    const lido = await lerDoCofre(existente.id);
    if (lido) {
      try {
        return { doc: validarDocumento(JSON.parse(lido.texto)), arquivo: existente.id, versao: lido.versao, nome, reaproveitada: true, descricao: nome };
      } catch {
        // arquivo estragado: gera de novo (vira a versão seguinte)
      }
    }
  }
  const dados = new Blob([JSON.stringify(doc)], { type: "application/octet-stream" });
  const cartao: Record<string, string> = { descricao: nome, material: MATERIAIS[doc.material ?? ""]?.nome ?? "", codigo: nome, obs: "Biblioteca de componentes — engrenagem de perfil evolvente (paramétrica: edite o recurso Engrenagem)" };
  const gravado = await gravarArquivoFixo("cad", arquivo, dados, { sub, cartao });
  const lido = gravado.id ? await lerDoCofre(gravado.id) : null;
  return { doc, arquivo: gravado.id, versao: lido?.versao ?? 1, nome, reaproveitada: false, descricao: nome };
}
