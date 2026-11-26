// WJSlicer3D: worker que guarda as peças da mesa (malha na posição de impressão, cópias), gira, apoia,
// organiza, fatia e guarda os caminhos de cada camada para a prévia. O fatiamento de uma mesa cheia
// leva alguns segundos e não pode travar a tela do tablet.

import { ajustesDe, PERFIL_PADRAO, resolver } from "./camadas";
import type { Plano } from "./esquema";
import { fatiarPlaca, type MalhaImpressao, type Previa, type Resultado } from "./fatiar";
import type { Filamento } from "./cores";
import { centralizar, malhaDeStl, malhaDeTriangulos, melhorApoio, orientarMalha, organizar, type Eixo } from "./malha";
import { maquinaPorId, materialDa, type ConfigTroca, type IdMaterial } from "./perfis";

export type PedidoSlicer =
  | { tipo: "stl"; nome: string; bytes: Uint8Array }
  /** malha do WJCAD (Y para cima): fica em pé (Z para cima) */
  | { tipo: "cad"; nome: string; vertices: Float32Array; triangulos: Uint32Array }
  | { tipo: "girar"; id: number; eixo: Eixo; quartos: number }
  | { tipo: "apoio"; id: number }
  | { tipo: "copias"; id: number; n: number }
  | { tipo: "remover"; id: number }
  /** mesa da máquina e folga entre as peças: reorganiza */
  | { tipo: "mesa"; mesa: [number, number]; folga: number }
  /** pintura de uma peça (cor 0–3 de cada triângulo) */
  | { tipo: "cores"; id: number; cores: Uint8Array }
  /** abre um projeto salvo: troca todas as peças da mesa */
  | { tipo: "projeto"; pecas: { nome: string; copias: number; pos: Float32Array; tri: Uint32Array; cores: Uint8Array }[] }
  /** pede as peças (malha, cópias, pintura) para salvar o projeto */
  | { tipo: "exportar" }
  | { tipo: "estimar"; seq: number; maquina: string; material: IdMaterial; precoKg: number; perfil: Plano; filamentos: Filamento[]; troca: ConfigTroca }
  | { tipo: "camada"; seq: number; i: number };

export interface PecaInfo {
  id: number;
  nome: string;
  triangulos: number;
  dims: [number, number, number];
  posicoes: [number, number][];
}

export type RespostaSlicer =
  /** lista de peças; `malhas` só das que mudaram de forma */
  | { tipo: "pecas"; lista: PecaInfo[]; malhas: { id: number; pos: Float32Array; tri: Uint32Array; cores: Uint8Array }[] }
  | { tipo: "projetoPecas"; pecas: { nome: string; copias: number; pos: Float32Array; tri: Uint32Array; cores: Uint8Array }[] }
  | { tipo: "progresso"; seq: number; f: number }
  | { tipo: "resultado"; seq: number; r: Resultado }
  | { tipo: "camada"; seq: number; i: number; z: number; seg: Float32Array; parte: Uint8Array }
  | { tipo: "erro"; seq?: number; msg: string };

interface Peca {
  id: number;
  nome: string;
  malha: MalhaImpressao;
  copias: number;
  posicoes: [number, number][];
  /** cor (0–3) de cada triângulo */
  cores: Uint8Array;
}

let pecas: Peca[] = [];
let proximoId = 1;
let mesa: [number, number] = [256, 256];
let folga = 6;
let previa: Previa | null = null;
let alturas: number[] = [];
let seqPrevia = 0;
const enviar = (r: RespostaSlicer, t: Transferable[] = []) => (self as unknown as Worker).postMessage(r, t);

function dims(m: MalhaImpressao): [number, number, number] {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < m.pos.length; i += 3)
    for (let k = 0; k < 3; k++) {
      mn[k] = Math.min(mn[k], m.pos[i + k]);
      mx[k] = Math.max(mx[k], m.pos[i + k]);
    }
  return [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]];
}

/** Reorganiza a mesa e manda a lista (e as malhas que mudaram) à tela. */
function publicar(mudaram: Peca[]) {
  const pos = organizar(pecas.map((p) => ({ malha: p.malha, copias: p.copias })), mesa, folga);
  pecas.forEach((p, k) => (p.posicoes = pos[k]));
  previa = null;
  enviar({
    tipo: "pecas",
    lista: pecas.map((p) => ({ id: p.id, nome: p.nome, triangulos: p.malha.tri.length / 3, dims: dims(p.malha), posicoes: p.posicoes })),
    malhas: mudaram.map((p) => ({ id: p.id, pos: p.malha.pos.slice(), tri: p.malha.tri, cores: p.cores.slice() })),
  });
}

function nova(nome: string, m: MalhaImpressao, cores?: Uint8Array, copias = 1) {
  const p: Peca = { id: proximoId++, nome, malha: centralizar(m), copias, posicoes: [], cores: cores ?? new Uint8Array(m.tri.length / 3) };
  pecas.push(p);
  publicar([p]);
}

function peca(id: number): Peca {
  const p = pecas.find((x) => x.id === id);
  if (!p) throw new Error("Peça não encontrada na mesa.");
  return p;
}

self.onmessage = (e: MessageEvent<PedidoSlicer>) => {
  const p = e.data;
  try {
    if (p.tipo === "stl") nova(p.nome, malhaDeStl(p.bytes));
    else if (p.tipo === "cad") nova(p.nome, orientarMalha(malhaDeTriangulos(p.vertices, p.triangulos), "x", 1));
    else if (p.tipo === "girar") {
      const x = peca(p.id);
      x.malha = centralizar(orientarMalha(x.malha, p.eixo, p.quartos));
      publicar([x]);
    } else if (p.tipo === "apoio") {
      const x = peca(p.id);
      x.malha = centralizar(melhorApoio(x.malha));
      publicar([x]);
    } else if (p.tipo === "cores") {
      const x = peca(p.id);
      if (p.cores.length === x.cores.length) x.cores = p.cores;
      previa = null;
    } else if (p.tipo === "projeto") {
      pecas = [];
      const novas: Peca[] = p.pecas.map((q) => ({ id: proximoId++, nome: q.nome, malha: { pos: q.pos, tri: q.tri }, copias: q.copias, posicoes: [], cores: q.cores }));
      pecas = novas;
      publicar(novas);
    } else if (p.tipo === "exportar") {
      enviar({ tipo: "projetoPecas", pecas: pecas.map((x) => ({ nome: x.nome, copias: x.copias, pos: x.malha.pos.slice(), tri: x.malha.tri.slice(), cores: x.cores.slice() })) });
    } else if (p.tipo === "copias") {
      peca(p.id).copias = Math.max(1, Math.min(50, Math.round(p.n)));
      publicar([]);
    } else if (p.tipo === "remover") {
      pecas = pecas.filter((x) => x.id !== p.id);
      publicar([]);
    } else if (p.tipo === "mesa") {
      mesa = p.mesa;
      folga = p.folga;
      publicar([]);
    } else if (p.tipo === "estimar") {
      if (!pecas.length) throw new Error("Abra um STL primeiro.");
      // o Processo vem das camadas (sistema 0,20 Padrão + diferenças do projeto): mesmo resultado de antes
      const res = resolver({ maquina: p.maquina, sistema: PERFIL_PADRAO, projeto: p.perfil });
      const maq = { ...maquinaPorId(p.maquina), processo: res.processo };
      const mat = { ...materialDa(maq, p.material), precoKg: p.precoKg };
      let ultimo = 0;
      const { r, previa: pv } = fatiarPlaca(
        pecas.map((x) => ({ nome: x.nome, malha: x.malha, posicoes: x.posicoes, cores: x.cores })), maq, mat, ajustesDe(res),
        (f) => {
          const agora = performance.now();
          if (agora - ultimo > 80) {
            ultimo = agora;
            enviar({ tipo: "progresso", seq: p.seq, f });
          }
        },
        { filamentos: p.filamentos, troca: p.troca },
      );
      previa = pv;
      alturas = r.alturas;
      seqPrevia = p.seq;
      enviar({ tipo: "resultado", seq: p.seq, r });
    } else if (p.tipo === "camada") {
      if (!previa || p.seq !== seqPrevia) return;
      const i = Math.max(0, Math.min(previa.seg.length - 1, p.i));
      const seg = previa.seg[i].slice(), parte = previa.parte[i].slice();
      enviar({ tipo: "camada", seq: p.seq, i, z: alturas[i], seg, parte }, [seg.buffer, parte.buffer]);
    }
  } catch (err) {
    enviar({ tipo: "erro", seq: p.tipo === "estimar" ? p.seq : undefined, msg: (err as Error).message || String(err) });
  }
};
