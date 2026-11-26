// WJSlicer3D: projeto salvo no cofre do WJPDM (arquivo .wjslc, JSON): as peças da mesa (malha na posição
// de impressão, cópias, pintura de cada triângulo), os filamentos (cor, material, R$/kg), a troca de cor
// de cada impressora e os ajustes. As malhas vão em binário comprimido (gzip) dentro do JSON, para o
// arquivo abrir pelo mesmo caminho dos outros apps do cofre. Desde a L0 do novo layout (26/11/2026) o projeto grava o
// **perfil do projeto = só as diferenças sobre o "0,20 mm Padrão"** da impressora (`camadas.ts`); o `.wjslc` antigo (campo
// `ajustes` inteiro) abre igual e é convertido em diferenças, sem perder nada. Puro: testado em scripts/teste-slicer.ts.

import { ajustesDe, diferencasDeAjustes, limparDiferencas, resolver } from "./camadas";
import type { Plano } from "./esquema";
import { filamentosPadrao, MAX_CORES, type Filamento } from "./cores";
import { MAQUINAS, type ConfigTroca, type IdMaterial } from "./perfis";

export const EXTENSAO_PROJETO = "wjslc";

export interface PecaProjeto {
  nome: string;
  copias: number;
  pos: Float32Array;
  tri: Uint32Array;
  /** cor (0–3) de cada triângulo */
  cores: Uint8Array;
}

export interface ProjetoSlicer {
  nome: string;
  maquina: string;
  material: IdMaterial;
  /** perfil do projeto: só as diferenças sobre o 0,20 mm Padrão da impressora (id → valor) */
  perfil: Plano;
  precos: Partial<Record<IdMaterial, number>>;
  filamentos: Filamento[];
  /** troca de cor editada, por impressora (o que não está aqui usa o de fábrica) */
  trocas: Record<string, ConfigTroca>;
  /** orçamento do projeto (linhas com os valores gravados, lucro por linha); normalizado por quem usa */
  orcamento?: unknown;
  pecas: PecaProjeto[];
}

function paraBase64(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}
function deBase64(t: string): Uint8Array {
  const s = atob(t), b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
  return b;
}
async function passar(b: Uint8Array, f: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  return new Uint8Array(await new Response(new Blob([b as BlobPart]).stream().pipeThrough(f)).arrayBuffer());
}

/** O projeto como texto JSON (o que vai para o cofre). */
export async function empacotar(p: ProjetoSlicer): Promise<string> {
  const comprime = typeof CompressionStream !== "undefined";
  const pecas = [];
  for (const x of p.pecas) {
    const nv = x.pos.length / 3, nt = x.tri.length / 3;
    const bruto = new Uint8Array(nv * 12 + nt * 12 + nt);
    bruto.set(new Uint8Array(x.pos.buffer, x.pos.byteOffset, nv * 12), 0);
    bruto.set(new Uint8Array(x.tri.buffer, x.tri.byteOffset, nt * 12), nv * 12);
    bruto.set(x.cores.subarray(0, nt), nv * 12 + nt * 12);
    const dados = comprime ? await passar(bruto, new CompressionStream("gzip")) : bruto;
    pecas.push({ nome: x.nome, copias: x.copias, nv, nt, gz: comprime, dados: paraBase64(dados) });
  }
  return JSON.stringify({
    formato: EXTENSAO_PROJETO, versao: 2, nome: p.nome,
    // `ajustes` também vai, só para uma versão antiga do app (aparelho ainda sem "Atualizar") abrir o projeto; quem lê prefere `perfil`
    config: { maquina: p.maquina, material: p.material, perfil: p.perfil, ajustes: ajustesDe(resolver({ maquina: p.maquina, projeto: p.perfil })), precos: p.precos, filamentos: p.filamentos, trocas: p.trocas, ...(p.orcamento ? { orcamento: p.orcamento } : {}) },
    pecas,
  });
}

/** Lê o texto de um projeto (valida o que importa; o que faltar volta ao padrão). */
export async function desempacotar(texto: string): Promise<ProjetoSlicer> {
  let j: { formato?: string; nome?: string; config?: Partial<ProjetoSlicer> & { ajustes?: Record<string, unknown> }; pecas?: { nome: string; copias: number; nv: number; nt: number; gz: boolean; dados: string }[] };
  try {
    j = JSON.parse(texto);
  } catch {
    throw new Error("O arquivo não é um projeto do WJSlicer3D.");
  }
  if (j.formato !== EXTENSAO_PROJETO || !Array.isArray(j.pecas)) throw new Error("O arquivo não é um projeto do WJSlicer3D.");
  const c = j.config ?? {};
  const pecas: PecaProjeto[] = [];
  for (const x of j.pecas) {
    let bruto = deBase64(x.dados);
    if (x.gz) bruto = await passar(bruto, new DecompressionStream("gzip"));
    if (!(x.nv > 0 && x.nt > 0) || bruto.length !== x.nv * 12 + x.nt * 12 + x.nt) throw new Error(`A peça ${x.nome || ""} do projeto está incompleta.`);
    const copia = bruto.slice();
    const pos = new Float32Array(copia.buffer, 0, x.nv * 3), tri = new Uint32Array(copia.buffer, x.nv * 12, x.nt * 3);
    const cores = copia.slice(x.nv * 12 + x.nt * 12);
    for (let k = 0; k < tri.length; k++) if (tri[k] >= x.nv) throw new Error(`A peça ${x.nome || ""} do projeto tem triângulos fora da malha.`);
    for (let k = 0; k < cores.length; k++) if (cores[k] >= MAX_CORES) cores[k] = 0;
    pecas.push({ nome: x.nome, copias: Math.max(1, Math.min(50, Math.round(x.copias) || 1)), pos: pos.slice(), tri: tri.slice(), cores });
  }
  const maquina = MAQUINAS.some((m) => m.id === c.maquina) ? c.maquina! : MAQUINAS[0].id;
  const padrao = filamentosPadrao();
  const filamentos = Array.from({ length: MAX_CORES }, (_, k) => ({ ...padrao[k], ...(c.filamentos?.[k] ?? {}) }));
  return {
    nome: j.nome || "Projeto de impressão", maquina, material: c.material ?? "pla",
    perfil: c.perfil ? limparDiferencas(c.perfil) : diferencasDeAjustes(maquina, c.ajustes), precos: c.precos ?? {},
    filamentos, trocas: c.trocas ?? {}, ...(c.orcamento ? { orcamento: c.orcamento } : {}), pecas,
  };
}
