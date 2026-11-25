// Ponte entre a interface e o Web Worker do kernel.
// Só a regeneração mais recente importa: no máximo uma reconstrução fica no worker; as que chegam
// enquanto ela roda esperam na fila e a mais nova substitui a anterior (prévia cancelada a cada toque
// novo). O mesmo estado nunca é reconstruído duas vezes: o ✓ de um comando reaproveita a prévia.

import type { LeituraMontagem } from "./importar";
import { marcar } from "../comum/medicao";
import { assinaturaDados, LIMITE_DADOS_UMA_VEZ, PREFIXO_ENVIADO, type Feature, type Referencia } from "../model";
import type { PedidoKernel, RespostaKernel } from "./worker";
import type { InfoReferencia, ResultadoRegeneracao } from "./regenerar";
import type { Corte, Projecao } from "./projecao";
import type { Camera, Orientacao } from "../desenho/modelo";
import type { ResumoPlanificado } from "./dxf";
import type { PropriedadesMassa, PropriedadesSecao, ResultadoMedida, ResultadoVerificacao } from "./avaliar";

type SemSeq<T> = T extends unknown ? Omit<T, "seq"> : never;

/** Peça de um componente: malha, topologia (para selecionar e posicionar), volume e erros. */
export type ResultadoComponente = Pick<ResultadoRegeneracao, "malha" | "topologia" | "coresFaces" | "corpos" | "volume" | "erros" | "facesPorRecurso" | "suportes"> & {
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
  /** reconstrução que está no worker agora (as mensagens seguintes esperam em `fila`) */
  private emVoo: { seq: number; chave: string; pedido: PedidoKernel } | null = null;
  /** mensagens já copiadas (como estavam no momento do pedido) esperando a reconstrução em voo voltar */
  private fila: { pedido: PedidoKernel; msg: unknown; chave?: string }[] = [];
  /** última reconstrução devolvida pelo worker: o mesmo estado pedido de novo é entregue sem recalcular */
  private ultimoResultado: { chave: string; r: ResultadoRegeneracao; ms: number } | null = null;
  /** seq da reconstrução em voo que já vale como pedido final sem prévia (✓ durante a prévia) */
  private semPreviaNoSeq = 0;
  /** reconstruções feitas pelo worker e reaproveitadas (roteiro de desempenho) */
  readonly contagem = { enviadas: 0, reaproveitadas: 0, descartadas: 0 };

  readonly pronto: Promise<void>;

  /** Material removido da prévia, que chega depois da peça (`aoRegenerar`) da mesma reconstrução. */
  aoPrevia: (m: ResultadoRegeneracao["previaRemovido"], ms: number) => void = () => {};

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
            if (this.emVoo?.seq === r.seq) {
              this.ultimoResultado = { chave: this.emVoo.chave, r: r.resultado, ms: r.ms };
              this.emVoo = null;
            }
            if (r.seq === this.ultimaRegeneracao) {
              marcar("kernel:volta");
              this.aoRegenerar(r.seq === this.semPreviaNoSeq ? semPrevia(r.resultado) : r.resultado, r.ms);
              marcar("kernel:aplicado");
            } else this.contagem.descartadas++;
            this.esvaziarFila();
            break;
          case "previa":
            if (r.seq === this.ultimaRegeneracao && r.seq !== this.semPreviaNoSeq) {
              this.aoPrevia(r.malha, r.ms);
              marcar("previa:aplicada");
            }
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
              // a reconstrução em voo volta para o worker com o mesmo seq (continua em voo)
              if (this.emVoo?.seq === r.seq) this.postar(this.emVoo.pedido);
              else if (pd) this.postar(pd);
              break;
            }
            this.pendentes.get(r.seq)?.falha(new Error(r.mensagem));
            this.pendentes.delete(r.seq);
            if (this.emVoo?.seq === r.seq) {
              this.emVoo = null;
              this.esvaziarFila();
            }
            break;
        }
      };
    });
  }

  /**
   * `previa`: id do recurso em edição (o kernel devolve o material que ele tira). Mesmo documento da
   * última reconstrução (o ✓ logo depois da prévia): entrega o resultado já calculado, sem a prévia;
   * se ele ainda está no worker, a volta dele já vale como final.
   */
  regenerar(features: Feature[], planificar = false, previa?: string) {
    const seq = ++this.seq;
    const chave = chaveDoEstado(features, planificar);
    this.ultimaRegeneracao = seq;
    const pedido: PedidoKernel = (this.ultimoRegenerar = { tipo: "regenerar", seq, features, planificar, previa });
    if (!previa) {
      if (!this.fila.length && this.emVoo?.chave === chave) {
        // ✓ com a prévia ainda no worker: a volta dela é a peça final
        this.ultimaRegeneracao = this.semPreviaNoSeq = this.emVoo.seq;
        this.contagem.reaproveitadas++;
        return;
      }
      const u = this.ultimoResultado;
      if (!this.fila.length && !this.emVoo && u?.chave === chave) {
        this.contagem.reaproveitadas++;
        queueMicrotask(() => {
          if (this.ultimaRegeneracao !== seq) return;
          this.aoRegenerar(semPrevia(u.r), u.ms);
          marcar("kernel:aplicado");
        });
        return;
      }
    }
    // toque novo enquanto a anterior ainda espera: a que esperava não vale mais (prévia cancelada)
    const ult = this.fila[this.fila.length - 1];
    if (ult?.pedido.tipo === "regenerar") {
      this.fila.pop();
      this.contagem.descartadas++;
    }
    this.fila.push({ pedido, msg: this.copiar(pedido), chave });
    this.esvaziarFila();
  }

  /** Manda o que espera na fila até sair uma reconstrução (ela segura as seguintes até voltar). */
  private esvaziarFila() {
    while (!this.emVoo && this.fila.length) {
      const { pedido, msg, chave } = this.fila.shift()!;
      if (pedido.tipo === "regenerar") {
        this.emVoo = { seq: pedido.seq, chave: chave!, pedido };
        this.contagem.enviadas++;
        marcar("kernel:envio");
      }
      this.postarMsg(pedido, msg);
    }
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
      // outra peça regenerada no worker (montagem/desenho): a última peça dele deixa de ser esta
      if (pedido.tipo === "componente") this.ultimoResultado = null;
      const msg = this.copiar(pedido);
      if (this.emVoo || this.fila.length) this.fila.push({ pedido, msg });
      else this.postarMsg(pedido, msg);
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
  propSecao(ref: Referencia) {
    return this.pedir<PropriedadesSecao>({ tipo: "propSecao", ref });
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

  private postar(p: PedidoKernel) {
    this.postarMsg(p, this.copiar(p));
  }

  private postarMsg(p: PedidoKernel, msg: unknown) {
    if (p.tipo === "montagemStep" || p.tipo === "simplificarStl") this.worker.postMessage(p, [p.bytes.buffer]);
    else this.worker.postMessage(msg);
  }

  private copiar(p: PedidoKernel): unknown {
    if (p.tipo === "montagemStep" || p.tipo === "simplificarStl") return p; // bytes vão transferidos
    // cópia limpa: objetos da UI não vão para o worker. Conteúdo importado grande (STEP/STL de
    // dezenas de MB) vai uma vez; depois, só a assinatura
    const enviados = this.enviados;
    return JSON.parse(JSON.stringify(p, function (this: { id?: string }, k, v) {
      if (k !== "dados" || typeof v !== "string" || v.length < LIMITE_DADOS_UMA_VEZ || !this?.id) return v;
      const sig = assinaturaDados(this.id, v);
      if (enviados.has(sig)) return PREFIXO_ENVIADO + sig;
      enviados.add(sig);
      return v;
    }));
  }
}

/** Estado que a reconstrução depende: a árvore (conteúdo importado grande pela assinatura) e o planificado. */
function chaveDoEstado(features: Feature[], planificar: boolean): string {
  return JSON.stringify({ features, planificar }, function (this: { id?: string }, k, v) {
    return k === "dados" && typeof v === "string" && v.length >= LIMITE_DADOS_UMA_VEZ && this?.id ? assinaturaDados(this.id, v) : v;
  });
}

/** O resultado da prévia como peça final: sem o material removido nem as regiões do Dividir. */
function semPrevia(r: ResultadoRegeneracao): ResultadoRegeneracao {
  return { ...r, previaRemovido: null, regioes: undefined };
}
