// Worker do gerador imagens → modelo 3D: recorta as silhuetas (guarda a de cada vista) e gera o
// casco, a superfície, a redução para a quantidade de faces pedida e o STL — fora da thread da UI.

import { gerarCasco, silhuetaDaImagem, stlBinario, type Eixo, type NomeVista, type Silhueta } from "./casco";
import { malhaDoStl, simplificarStl } from "../kernel/stl";

export type PedidoImg =
  | { tipo: "silhueta"; vista: NomeVista; w: number; h: number; rgba: Uint8ClampedArray; tol: number; seq: number }
  | { tipo: "remover"; vista: NomeVista }
  | { tipo: "gerar"; medida: { eixo: Eixo; valor: number }; faces: number; nome: string };

export type RespostaImg =
  | { tipo: "silhueta"; vista: NomeVista; seq: number; mascara?: Uint8Array; caixa?: [number, number, number, number]; erro?: string }
  | { tipo: "andamento"; texto: string }
  | {
      tipo: "pronto"; stl: Uint8Array; vertices: Float32Array; normais: Float32Array; triangulos: Uint32Array;
      volume: number | null; dim: { W: number; H: number; D: number }; N: number; faces: number; ms: number;
    }
  | { tipo: "erro"; texto: string };

const silhuetas: Partial<Record<NomeVista, Silhueta>> = {};
const responder = (r: RespostaImg, t: Transferable[] = []) => (self as unknown as Worker).postMessage(r, t);

self.onmessage = (e: MessageEvent<PedidoImg>) => {
  const p = e.data;
  if (p.tipo === "remover") {
    delete silhuetas[p.vista];
    return;
  }
  if (p.tipo === "silhueta") {
    try {
      const s = silhuetaDaImagem(p.rgba, p.w, p.h, p.tol);
      silhuetas[p.vista] = s;
      responder({ tipo: "silhueta", vista: p.vista, seq: p.seq, mascara: s.m.slice(), caixa: [s.x0, s.y0, s.x1, s.y1] });
    } catch (err) {
      delete silhuetas[p.vista];
      responder({ tipo: "silhueta", vista: p.vista, seq: p.seq, erro: (err as Error).message });
    }
    return;
  }
  const t0 = performance.now();
  try {
    const r = gerarCasco(silhuetas, p.medida, p.faces, (texto) => responder({ tipo: "andamento", texto }));
    let stl = stlBinario(r.malha, p.nome);
    // a grade já mira um pouco acima do pedido: só reduz se passou de 8% (a redução custa mais que
    // gerar e arredonda a superfície)
    if (r.malha.tri.length / 3 > p.faces * 1.08) {
      responder({ tipo: "andamento", texto: "Ajustando a quantidade de faces…" });
      stl = simplificarStl(stl, p.faces).bytes;
    }
    const m = malhaDoStl(stl);
    responder(
      { tipo: "pronto", stl, vertices: m.vertices, normais: m.normais, triangulos: m.triangulos, volume: m.volume, dim: r.dim, N: r.N, faces: m.triangulos.length / 3, ms: performance.now() - t0 },
      [stl.buffer, m.vertices.buffer, m.normais.buffer, m.triangulos.buffer],
    );
  } catch (err) {
    responder({ tipo: "erro", texto: (err as Error).message });
  }
};
