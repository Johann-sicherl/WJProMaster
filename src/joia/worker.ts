// Worker do WJGoldDiamond: OpenCascade fora da thread da interface. Só o pedido mais recente
// é atendido; cada pedido manda primeiro a prévia (aro + cabeça) e depois a joia completa.

import opencascade from "replicad-opencascadejs";
import wasmUrl from "replicad-opencascadejs/wasm?url";
import { setOC, type Shape3D } from "replicad";
import { construir, medidas, paraFabricar } from "./geometria";
import { diametroInterno, superficie, type DocJoia, type GrupoTexto } from "./regras";
import { malhasNoMundo } from "./escultura";
import manifoldUrl from "manifold-3d/manifold.wasm?url";

/** Esculturas ativas no mundo (vazio = nenhuma). */
const esculturasDe = (d: DocJoia) => (d.esculturas.some((e) => e.ativo) ? malhasNoMundo(d.esculturas, diametroInterno(d.aro.norma, d.aro.tamanho) / 2, (th) => superficie(d.aro, th, 0)) : []);

export type PedidoJoia =
  | { tipo: "gerar"; seq: number; doc: DocJoia; grupos: GrupoTexto[]; larguraTexto: number }
  | { tipo: "exportar"; seq: number; formato: "stl" | "step"; fabricar: boolean };

export type RespostaJoia =
  | { tipo: "pronto" }
  | { tipo: "falha-inicial"; mensagem: string }
  | { tipo: "malha"; seq: number; final: boolean; pos: Float32Array; nor: Float32Array; idx: Uint32Array; volume: number; area: number; avisos: string[]; ms: number }
  | { tipo: "arquivo"; seq: number; bytes: ArrayBuffer }
  | { tipo: "erro"; seq: number; mensagem: string };

const enviar = (r: RespostaJoia, t: Transferable[] = []) => (self as unknown as Worker).postMessage(r, t);

let atual: { forma: Shape3D; doc: DocJoia } | null = null;
let pendente: PedidoJoia | null = null;
let agendado = false;

function traduzir(e: unknown): string {
  const m = e instanceof Error ? e.message : "";
  return m && !/^\d+$/.test(m) ? m : "O kernel não conseguiu montar a joia com esses valores. Desfaça a última alteração ou mude as medidas.";
}

async function malha(forma: Shape3D, seq: number, final: boolean, avisos: string[], t0: number, doc?: DocJoia) {
  const m = forma.mesh({ tolerance: 0.01, angularTolerance: 8 });
  const pos = new Float32Array(m.vertices), nor = new Float32Array(m.normals), idx = new Uint32Array(m.triangles);
  // a prévia é um composto sem booleanas: volume e área só na versão final
  let { volume, area } = final ? medidas(forma) : { volume: NaN, area: NaN };
  const esc = final && doc ? esculturasDe(doc) : [];
  if (esc.length) {
    // com escultura: peso e área da união (metal + esculturas) pelo manifold-3d
    const { carregarManifold, unir } = await import("./uniao");
    const u = unir(await carregarManifold(manifoldUrl), forma, esc);
    if (Number.isFinite(u.volume)) ({ volume, area } = u);
    avisos = [...avisos, ...u.avisos];
  }
  enviar({ tipo: "malha", seq, final, pos, nor, idx, volume, area, avisos, ms: performance.now() - t0 }, [pos.buffer, nor.buffer, idx.buffer]);
}

/** Atende só o último pedido de geração; deixa novas mensagens chegarem entre a prévia e a final. */
function processar() {
  agendado = false;
  const p = pendente;
  pendente = null;
  if (!p || p.tipo !== "gerar") return;
  const t0 = performance.now();
  try {
    const previa = construir(p.doc, p.grupos, p.larguraTexto, true);
    void malha(previa.forma, p.seq, false, [], t0);
  } catch {
    /* a prévia é opcional */
  }
  setTimeout(async () => {
    if (pendente) return; // pedido mais novo já agendado
    try {
      const r = construir(p.doc, p.grupos, p.larguraTexto);
      atual = { forma: r.forma, doc: p.doc };
      await malha(r.forma, p.seq, true, r.avisos, t0, p.doc);
    } catch (e) {
      enviar({ tipo: "erro", seq: p.seq, mensagem: traduzir(e) });
    }
  }, 0);
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
      const d = atual.doc, esc = esculturasDe(d);
      let bytes: ArrayBuffer;
      if (esc.length && p.formato === "stl") {
        // com escultura: STL da união numa peça só (contração aplicada na malha final)
        const { carregarManifold, unir, stlBinario } = await import("./uniao");
        const base = p.fabricar ? paraFabricar(d, atual.forma, true, false) : atual.forma;
        const u = unir(await carregarManifold(manifoldUrl), base, esc);
        bytes = stlBinario(u.malha, p.fabricar ? 1 + d.fabricacao.contracao / 100 : 1);
      } else {
        const s = p.fabricar ? paraFabricar(d, atual.forma, true) : atual.forma;
        bytes = await (p.formato === "step" ? s.blobSTEP() : s.blobSTL({ tolerance: 0.005, angularTolerance: 3, binary: true } as never)).arrayBuffer();
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
  } catch (e) {
    enviar({ tipo: "falha-inicial", mensagem: e instanceof Error ? e.message : String(e) });
  }
})();
