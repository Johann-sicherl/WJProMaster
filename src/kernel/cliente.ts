// Ponte entre a interface e o Web Worker do kernel.
// Só a regeneração mais recente importa: pedidos antigos que chegarem atrasados são descartados.

import type { LeituraMontagem } from "./importar";
import { assinaturaDados, LIMITE_DADOS_UMA_VEZ, PREFIXO_ENVIADO, type Feature, type Referencia } from "../model";
import type { PedidoKernel, RespostaKernel } from "./worker";
import type { InfoReferencia, ResultadoRegeneracao } from "./regenerar";
import type { Corte, Projecao } from "./projecao";
import type { Camera, Orientacao } from "../desenho/modelo";
import type { ResumoPlanificado } from "./dxf";
import type { PropriedadesMassa, ResultadoMedida, ResultadoVerificacao } from "./avaliar";

type SemSeq<T> = T extends unknown ? Omit<T, "seq"> : never;

/** Peça de um componente: malha, topologia (para selecionar e posicionar), volume e erros. */
export type ResultadoComponente = Pick<ResultadoRegeneracao, "malha" | "topologia" | "volume" | "erros" | "facesPorRecurso" | "suportes"> & {
  /** planos de referência da peça (esboços neles: cotas mostradas na montagem) */
  planos?: Extract<InfoReferencia, { tipo: "plano" }>[];
  /** só com planificar: linhas de dobra (3D) e o plano da chapa planificada */
  dobras?: [number, number, number][][];
  plano?: { olho: [number, number, number]; direita: [number, number, number] };
};

export class ClienteKernel {
  private worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  private seq = 0;
  private ultimaRegeneracao = 0;
  private pendentes = new Map<number, { ok: (v: unknown) => void; falha: (e: Error) => void; pedido: PedidoKernel }>();
  /** conteúdos importados grandes que o kernel já recebeu (vão só pela assinatura) */
  private enviados = new Set<string>();
  private ultimoRegenerar: PedidoKernel | null = null;

  readonly pronto: Promise<void>;

  constructor(private aoRegenerar: (r: ResultadoRegeneracao, ms: number) => void = () => {}) {
    this.pronto = new Promise((ok, falha) => {
      this.worker.onmessage = (ev: MessageEvent<RespostaKernel>) => {
        const r = ev.data;
        switch (r.tipo) {
          case "pronto":
            ok();
            break;
          case "falha-inicial":
            falha(new Error(r.mensagem));
            break;
          case "regenerado":
            if (r.seq === this.ultimaRegeneracao) this.aoRegenerar(r.resultado, r.ms);
            break;
          case "resposta":
            this.pendentes.get(r.seq)?.ok(r.dados);
            this.pendentes.delete(r.seq);
            break;
          case "erro":
            // o kernel não tem mais o conteúdo importado: manda de novo, completo
            if (r.mensagem === "__REENVIAR_DADOS__") {
              this.enviados.clear();
              const pd = this.pendentes.get(r.seq)?.pedido ?? (r.seq === this.ultimaRegeneracao ? this.ultimoRegenerar : null);
              if (pd) this.enviar(pd);
              break;
            }
            this.pendentes.get(r.seq)?.falha(new Error(r.mensagem));
            this.pendentes.delete(r.seq);
            break;
        }
      };
    });
  }

  /** `previa`: id do recurso em edição (o kernel devolve o material que ele tira). */
  regenerar(features: Feature[], planificar = false, previa?: string) {
    this.ultimaRegeneracao = ++this.seq;
    this.ultimoRegenerar = { tipo: "regenerar", seq: this.seq, features, planificar, previa };
    this.enviar(this.ultimoRegenerar);
  }

  /** DXF do planificado (da última regeneração) e o resumo da lista de corte. */
  dxf(nome: string) {
    return this.pedir<{ dxf: string; resumo: ResumoPlanificado }>({ tipo: "dxf", nome });
  }

  private pedir<T>(p: SemSeq<PedidoKernel>): Promise<T> {
    const seq = ++this.seq;
    return new Promise<T>((ok, falha) => {
      const pedido = { ...p, seq } as PedidoKernel;
      this.pendentes.set(seq, { ok: ok as (v: unknown) => void, falha, pedido });
      this.enviar(pedido);
    });
  }

  exportar(formato: "step" | "stl") {
    return this.pedir<Blob>({ tipo: "exportar", formato });
  }
  medir(refs: Referencia[]) {
    return this.pedir<ResultadoMedida>({ tipo: "medir", refs });
  }
  massa() {
    return this.pedir<PropriedadesMassa>({ tipo: "massa" });
  }
  verificar() {
    return this.pedir<ResultadoVerificacao>({ tipo: "verificar" });
  }
  /** Vista de desenho: projeção dos sólidos (chaves de `componente`) em suas posições. */
  projetar(itens: { chave: string; t: { pos: [number, number, number]; rot: [number, number, number, number] } }[], orientacao: Orientacao | Camera, tol = 0.2, corte?: Corte) {
    return this.pedir<Projecao>({ tipo: "projetar", itens, orientacao, tol, ...(corte ? { corte } : {}) });
  }
  interferencia(itens: { comp: string; chave: string; t: { pos: [number, number, number]; rot: [number, number, number, number] } }[]) {
    return this.pedir<{ a: string; b: string; volume: number }[]>({ tipo: "interferencia", itens });
  }
  massaPecas(chaves: string[]) {
    return this.pedir<Record<string, { volume: number; area: number; centro: [number, number, number] }>>({ tipo: "massaPecas", chaves });
  }
  medirMontagem(itens: { chave: string; t: { pos: [number, number, number]; rot: [number, number, number, number] } }[], refs: Referencia[]) {
    return this.pedir<ResultadoMedida>({ tipo: "medirMontagem", itens, refs });
  }
  /** Regenera a peça de um componente (montagem/desenho); o sólido fica guardado no kernel pela chave. */
  componente(chave: string, features: Feature[], planificar = false) {
    return this.pedir<ResultadoComponente>({ tipo: "componente", chave, features, ...(planificar ? { planificar } : {}) });
  }

  /** Montagem STEP: corpos (STEP de cada peça) e instâncias posicionadas. Os bytes vão transferidos. */
  montagemStep(bytes: Uint8Array) {
    return this.pedir<LeituraMontagem>({ tipo: "montagemStep", bytes });
  }

  /** STL grande → no máximo `alvo` triângulos (no worker: a tela não trava). Os bytes vão transferidos. */
  simplificarStl(bytes: Uint8Array, alvo: number) {
    return this.pedir<{ bytes: Uint8Array; triangulos: number; original: number }>({ tipo: "simplificarStl", bytes, alvo });
  }

  private enviar(p: PedidoKernel) {
    if (p.tipo === "montagemStep" || p.tipo === "simplificarStl") return this.worker.postMessage(p, [p.bytes.buffer]);
    // cópia limpa: objetos da UI não vão para o worker. Conteúdo importado grande (STEP/STL de
    // dezenas de MB) vai uma vez; depois, só a assinatura
    const enviados = this.enviados;
    this.worker.postMessage(JSON.parse(JSON.stringify(p, function (this: { id?: string }, k, v) {
      if (k !== "dados" || typeof v !== "string" || v.length < LIMITE_DADOS_UMA_VEZ || !this?.id) return v;
      const sig = assinaturaDados(this.id, v);
      if (enviados.has(sig)) return PREFIXO_ENVIADO + sig;
      enviados.add(sig);
      return v;
    })));
  }
}
