// Worker do WJGoldDiamond: OpenCascade e manifold-3d fora da thread da interface. Só o pedido mais recente
// é atendido; cada pedido manda primeiro a prévia (peças juntas, sem booleanas nem concordância: aparece na
// hora) e depois a joia final (união e cortes na malha, concordância se ligada; final.ts). STL sai da malha
// final; STEP pelo OpenCascade (geometria.ts), só a parte paramétrica.

import opencascade from "replicad-opencascadejs";
import wasmUrl from "replicad-opencascadejs/wasm?url";
import { setOC } from "replicad";
import { construir, pecas } from "./geometria";
import { montar, secao, type DocJoia, type GrupoTexto } from "./regras";
import { construirMalha, juntar, malhaDe, previaMalha } from "./final";
import { malhaVista } from "./concordancia";
import type { Malha } from "./escultura";
import { carregarManifold, stlBinario } from "./uniao";
import manifoldUrl from "manifold-3d/manifold.wasm?url";
import { makeCylinder } from "replicad";

export type PedidoJoia =
  | { tipo: "gerar"; seq: number; doc: DocJoia; grupos: GrupoTexto[]; larguraTexto: number }
  | { tipo: "exportar"; seq: number; formato: "stl" | "step"; fabricar: boolean };

export type RespostaJoia =
  | { tipo: "pronto" }
  | { tipo: "falha-inicial"; mensagem: string }
  | { tipo: "malha"; seq: number; final: boolean; pos: Float32Array; nor: Float32Array; idx: Uint32Array; volume: number; area: number; avisos: string[]; ms: number; comEsculturas: boolean; concordancia?: { acrescimo: number; grupos: number; voxels: number } }
  | { tipo: "arquivo"; seq: number; bytes: ArrayBuffer }
  | { tipo: "erro"; seq: number; mensagem: string };

const enviar = (r: RespostaJoia, t: Transferable[] = []) => (self as unknown as Worker).postMessage(r, t);

let atual: { doc: DocJoia; grupos: GrupoTexto[]; larguraTexto: number; malha: Malha } | null = null;
let pendente: PedidoJoia | null = null;
let agendado = false;
const manifold = () => carregarManifold(manifoldUrl);

function traduzir(e: unknown): string {
  const m = e instanceof Error ? e.message : "";
  return m && !/^\d+$/.test(m) ? m : "O kernel não conseguiu montar a joia com esses valores. Desfaça a última alteração ou mude as medidas.";
}

/** Normais com quebra nas arestas vivas e envio (transferindo os buffers). */
function mandar(seq: number, final: boolean, m: Malha, volume: number, area: number, avisos: string[], t0: number, comEsculturas: boolean, conc?: { acrescimo: number; grupos: number; voxels: number }) {
  const v = malhaVista(m);
  enviar({ tipo: "malha", seq, final, pos: v.pos, nor: v.nor, idx: v.idx, volume, area, avisos, ms: performance.now() - t0, comEsculturas, concordancia: conc }, [v.pos.buffer, v.nor.buffer, v.idx.buffer]);
}

/** Atende só o último pedido de geração; deixa novas mensagens chegarem entre a prévia e a final. */
function processar() {
  agendado = false;
  const p = pendente;
  pendente = null;
  if (!p || p.tipo !== "gerar") return;
  const t0 = performance.now();
  try {
    // prévia: aro + peças do kernel sem booleanas e as peças em malha (fios avançados, folhas) só juntas
    const m = montar(p.doc);
    const pc = pecas(p.doc, p.grupos, p.larguraTexto, true, m);
    const prev = juntar([malhaDe(pc.aro), ...pc.partes.map((x) => malhaDe(x.s)), previaMalha(p.doc, m)]);
    mandar(p.seq, false, prev, NaN, NaN, [], t0, false);
  } catch {
    /* a prévia é opcional */
  }
  setTimeout(async () => {
    if (pendente) return; // pedido mais novo já agendado
    try {
      const w = await manifold();
      if (pendente) return;
      const r = construirMalha(w, p.doc, p.grupos, p.larguraTexto, { concordancia: p.doc.concordancia.ativo });
      atual = { doc: p.doc, grupos: p.grupos, larguraTexto: p.larguraTexto, malha: r.malha };
      mandar(p.seq, true, r.malha, r.volume, r.area, r.avisos, t0, p.doc.esculturas.some((e) => e.ativo), r.concordancia);
    } catch (e) {
      enviar({ tipo: "erro", seq: p.seq, mensagem: traduzir(e) });
    }
  }, 0);
}

/** Canais de alimentação unidos à malha final (sem refazer a joia). */
async function comCanais(d: DocJoia, malha: Malha): Promise<Malha> {
  const f = d.fabricacao;
  if (!(f.canais > 0)) return malha;
  const w = await manifold(), R = montar(d).R, tb = secao(d.aro, Math.PI).t;
  const lixo: any[] = [];
  const mf = (x: Malha) => {
    const mesh = new w.Mesh({ numProp: 3, vertProperties: x.pos, triVerts: x.tri });
    mesh.merge();
    const r = new w.Manifold(mesh);
    lixo.push(r);
    return r;
  };
  try {
    const partes = [mf(malha)];
    for (let k = 0; k < f.canais; k++) {
      const a = ((180 + (k - (f.canais - 1) / 2) * 15) * Math.PI) / 180, dir: [number, number, number] = [Math.sin(a), Math.cos(a), 0];
      partes.push(mf(malhaDe(makeCylinder(f.diamCanal / 2, f.compCanal + 0.4, [dir[0] * (R + tb - 0.4), dir[1] * (R + tb - 0.4), 0], dir))));
    }
    const u = w.Manifold.union(partes);
    lixo.push(u);
    const o = u.getMesh();
    return { pos: Float32Array.from({ length: o.numVert * 3 }, (_, i) => o.vertProperties[Math.floor(i / 3) * o.numProp + (i % 3)]), tri: Uint32Array.from(o.triVerts) };
  } finally {
    for (const x of lixo) x.delete?.();
  }
}

self.onmessage = (ev: MessageEvent<PedidoJoia>) => {
  const p = ev.data;
  if (p.tipo === "gerar") {
    pendente = p;
    if (!agendado) {
      agendado = true;
      setTimeout(processar, 0);
    }
    return;
  }
  void (async () => {
    try {
      if (!atual) throw new Error("A joia ainda não foi gerada.");
      const d = atual.doc;
      let bytes: ArrayBuffer;
      if (p.formato === "stl") {
        // STL da malha final (peça única, com a concordância); fundição: canais e contração
        const m = p.fabricar ? await comCanais(d, atual.malha) : atual.malha;
        bytes = stlBinario(m, p.fabricar ? 1 + d.fabricacao.contracao / 100 : 1);
      } else {
        // STEP: sólido do OpenCascade (só a parte paramétrica: sem fios avançados, folhas e esculturas)
        const r = construir(d, atual.grupos, atual.larguraTexto);
        bytes = await r.forma.blobSTEP().arrayBuffer();
      }
      enviar({ tipo: "arquivo", seq: p.seq, bytes }, [bytes]);
    } catch (e) {
      enviar({ tipo: "erro", seq: p.seq, mensagem: traduzir(e) });
    }
  })();
};

(async () => {
  try {
    const OC = await (opencascade as unknown as (o: object) => Promise<unknown>)({ locateFile: () => wasmUrl });
    setOC(OC as never);
    enviar({ tipo: "pronto" });
    void manifold();
  } catch (e) {
    enviar({ tipo: "falha-inicial", mensagem: e instanceof Error ? e.message : String(e) });
  }
})();
