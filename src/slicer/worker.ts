// WJSlicer3D: worker que guarda a malha na posição de impressão, gira, apoia e estima (o fatiamento
// de uma peça grande leva alguns segundos e não pode travar a tela).

import { estimar, type Ajustes, type MalhaImpressao, type Resultado } from "./fatiar";
import { centralizar, malhaDeStl, malhaDeTriangulos, melhorApoio, orientarMalha, type Eixo } from "./malha";
import { maquinaPorId, materialDa, type IdMaterial } from "./perfis";

export type PedidoSlicer =
  | { tipo: "stl"; bytes: Uint8Array }
  /** malha do WJCAD (Y para cima): fica em pé (Z para cima) */
  | { tipo: "cad"; vertices: Float32Array; triangulos: Uint32Array }
  | { tipo: "girar"; eixo: Eixo; quartos: number }
  | { tipo: "apoio" }
  | { tipo: "estimar"; seq: number; maquina: string; material: IdMaterial; precoKg: number; ajustes: Ajustes };

export type RespostaSlicer =
  | { tipo: "malha"; pos: Float32Array; tri: Uint32Array }
  | { tipo: "progresso"; seq: number; f: number }
  | { tipo: "resultado"; seq: number; r: Resultado }
  | { tipo: "erro"; seq?: number; msg: string };

let malha: MalhaImpressao | null = null;
const enviar = (r: RespostaSlicer, t: Transferable[] = []) => (self as unknown as Worker).postMessage(r, t);

function mostrar(m: MalhaImpressao) {
  malha = centralizar(m);
  enviar({ tipo: "malha", pos: malha.pos.slice(), tri: malha.tri });
}

self.onmessage = (e: MessageEvent<PedidoSlicer>) => {
  const p = e.data;
  try {
    if (p.tipo === "stl") mostrar(malhaDeStl(p.bytes));
    else if (p.tipo === "cad") mostrar(orientarMalha(malhaDeTriangulos(p.vertices, p.triangulos), "x", 1));
    else if (!malha) throw new Error("Abra um STL primeiro.");
    else if (p.tipo === "girar") mostrar(orientarMalha(malha, p.eixo, p.quartos));
    else if (p.tipo === "apoio") mostrar(melhorApoio(malha));
    else if (p.tipo === "estimar") {
      const maq = maquinaPorId(p.maquina);
      const mat = { ...materialDa(maq, p.material), precoKg: p.precoKg };
      let ultimo = 0;
      const r = estimar(malha, maq, mat, p.ajustes, (f) => {
        const agora = performance.now();
        if (agora - ultimo > 80) {
          ultimo = agora;
          enviar({ tipo: "progresso", seq: p.seq, f });
        }
      });
      enviar({ tipo: "resultado", seq: p.seq, r });
    }
  } catch (err) {
    enviar({ tipo: "erro", seq: p.tipo === "estimar" ? p.seq : undefined, msg: (err as Error).message || String(err) });
  }
};
