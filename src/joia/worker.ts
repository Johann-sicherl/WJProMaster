// Worker do WJGoldDiamond: OpenCascade fora da thread da interface. Só o pedido mais recente
// é atendido; cada pedido manda primeiro a prévia (aro + cabeça) e depois a joia completa.

import opencascade from "replicad-opencascadejs";
import wasmUrl from "replicad-opencascadejs/wasm?url";
import { setOC, type Shape3D } from "replicad";
import { construir, medidas, paraFabricar } from "./geometria";
import type { DocJoia, GrupoTexto } from "./regras";

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

function malha(forma: Shape3D, seq: number, final: boolean, avisos: string[], t0: number) {
  const m = forma.mesh({ tolerance: 0.01, angularTolerance: 8 });
  const pos = new Float32Array(m.vertices), nor = new Float32Array(m.normals), idx = new Uint32Array(m.triangles);
  // a prévia é um composto sem booleanas: volume e área só na versão final
  const { volume, area } = final ? medidas(forma) : { volume: NaN, area: NaN };
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
    malha(previa.forma, p.seq, false, [], t0);
  } catch {
    /* a prévia é opcional */
  }
  setTimeout(() => {
    if (pendente) return; // pedido mais novo já agendado
    try {
      const r = construir(p.doc, p.grupos, p.larguraTexto);
      atual = { forma: r.forma, doc: p.doc };
      malha(r.forma, p.seq, true, r.avisos, t0);
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
  try {
    if (!atual) throw new Error("A joia ainda não foi gerada.");
    const s = p.fabricar ? paraFabricar(atual.doc, atual.forma, true) : atual.forma;
    const blob = p.formato === "step" ? s.blobSTEP() : s.blobSTL({ tolerance: 0.005, angularTolerance: 3, binary: true } as never);
    void blob.arrayBuffer().then((bytes) => enviar({ tipo: "arquivo", seq: p.seq, bytes }, [bytes]));
  } catch (e) {
    enviar({ tipo: "erro", seq: p.seq, mensagem: traduzir(e) });
  }
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
