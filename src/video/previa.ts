// WJVideoMaker — visualizador. Toca o projeto com o <video> do próprio navegador (decodificador do
// aparelho, por hardware e fora da thread da interface), um elemento por mídia, e desenha num canvas
// o quadro + os textos (mesmo desenho da exportação, desenho.ts). Clipes seguidos da mesma mídia
// (depois de "Dividir") continuam sem pausa; troca de mídia pausa uma e toca a outra.

import { desenharMidia, desenharTextos } from "./desenho";
import { duracaoTotal, linhaDoTempo, localizar, textosEm, type Midia, type Projeto } from "./projeto";

type Fonte = { tipo: "video"; el: HTMLVideoElement; url: string } | { tipo: "foto"; bmp: ImageBitmap };

export class Previa {
  /** Tempo do cursor (µs). */
  tempo = 0;
  tocando = false;
  aoMudarTempo?: (t: number) => void;
  aoParar?: () => void;
  /** Mídia que não abriu (arquivo fora deste aparelho). */
  aoFaltarMidia?: (m: Midia) => void;
  private ctx: CanvasRenderingContext2D;
  private fontes = new Map<string, Promise<Fonte | null>>();
  private prontas = new Map<string, Fonte | null>();
  private atual: HTMLVideoElement | null = null;
  private raf = 0;
  private relogio = 0;
  private seq = 0;

  constructor(public canvas: HTMLCanvasElement, private projeto: () => Projeto, private arquivo: (id: string) => Promise<File | null>) {
    this.ctx = canvas.getContext("2d")!;
  }

  /** Tamanho interno do canvas (proporção do projeto). */
  dimensionar(w: number, h: number) {
    if (this.canvas.width === w && this.canvas.height === h) return;
    this.canvas.width = w;
    this.canvas.height = h;
    void this.mostrar();
  }

  private fonte(m: Midia): Promise<Fonte | null> {
    let f = this.fontes.get(m.id);
    if (f) return f;
    f = (async (): Promise<Fonte | null> => {
      const arq = await this.arquivo(m.id);
      if (!arq) {
        this.aoFaltarMidia?.(m);
        return null;
      }
      if (m.tipo === "imagem") return { tipo: "foto", bmp: await createImageBitmap(arq) };
      const el = document.createElement("video");
      el.muted = true;
      el.playsInline = true;
      el.preload = "auto";
      const url = URL.createObjectURL(arq);
      el.src = url;
      await new Promise<void>((ok) => {
        const fim = () => ok();
        el.addEventListener("loadeddata", fim, { once: true });
        el.addEventListener("error", fim, { once: true });
        setTimeout(fim, 8000);
      });
      return el.error ? null : { tipo: "video", el, url };
    })().catch(() => null);
    f.then((x) => this.prontas.set(m.id, x));
    this.fontes.set(m.id, f);
    return f;
  }

  /** Esquece a mídia (arquivo trocado por "Localizar…"). */
  esquecer(id: string) {
    const f = this.prontas.get(id);
    if (f?.tipo === "video") {
      f.el.pause();
      URL.revokeObjectURL(f.url);
    } else if (f?.tipo === "foto") f.bmp.close();
    this.fontes.delete(id);
    this.prontas.delete(id);
  }

  private desenhar(fonte: Fonte | null | undefined) {
    const p = this.projeto();
    const W = this.canvas.width, H = this.canvas.height;
    if (fonte?.tipo === "video") desenharMidia(this.ctx, W, H, fonte.el, fonte.el.videoWidth, fonte.el.videoHeight);
    else if (fonte?.tipo === "foto") desenharMidia(this.ctx, W, H, fonte.bmp, fonte.bmp.width, fonte.bmp.height);
    else desenharMidia(this.ctx, W, H, null, 0, 0);
    desenharTextos(this.ctx, W, H, textosEm(p, this.tempo));
  }

  /** Mostra o quadro do tempo atual (parado). */
  async mostrar(): Promise<void> {
    const n = ++this.seq;
    const p = this.projeto();
    const loc = localizar(p, this.tempo);
    const m = loc && p.midias.find((x) => x.id === loc.clipe.midia);
    if (!loc || !m) return this.desenhar(null);
    const f = await this.fonte(m);
    if (n !== this.seq || this.tocando) return;
    if (f?.tipo === "video") {
      const alvo = loc.tMidia / 1e6;
      if (Math.abs(f.el.currentTime - alvo) > 0.001) {
        f.el.currentTime = alvo;
        await new Promise<void>((ok) => {
          f.el.addEventListener("seeked", () => ok(), { once: true });
          setTimeout(ok, 3000);
        });
        if (n !== this.seq || this.tocando) return;
      }
    }
    this.desenhar(f);
  }

  /** Leva o cursor ao tempo t (para de tocar). */
  async buscar(t: number) {
    this.pausar();
    this.tempo = Math.max(0, Math.min(t, duracaoTotal(this.projeto())));
    this.aoMudarTempo?.(this.tempo);
    await this.mostrar();
  }

  tocar() {
    if (this.tocando) return;
    const total = duracaoTotal(this.projeto());
    if (!(total > 0)) return;
    if (this.tempo >= total - 1000) this.tempo = 0;
    this.tocando = true;
    this.seq++;
    this.relogio = performance.now();
    const laco = () => {
      if (!this.tocando) return;
      this.passo();
      if (this.tocando) this.raf = requestAnimationFrame(laco);
    };
    this.raf = requestAnimationFrame(laco);
  }

  pausar() {
    if (!this.tocando) return;
    this.tocando = false;
    cancelAnimationFrame(this.raf);
    this.atual?.pause();
    this.atual = null;
    this.seq++;
  }

  private passo() {
    const agora = performance.now();
    const dt = (agora - this.relogio) * 1000;
    this.relogio = agora;
    const p = this.projeto();
    const total = duracaoTotal(p);
    const loc = localizar(p, this.tempo);
    const m = loc && p.midias.find((x) => x.id === loc.clipe.midia);
    let fonte: Fonte | null | undefined = null;
    if (!loc || !m) {
      this.atual?.pause();
      this.atual = null;
      this.tempo += dt; // só textos (depois do último clipe)
    } else {
      void this.fonte(m);
      fonte = this.prontas.get(m.id);
      if (fonte === undefined) {
        // ainda abrindo a mídia: espera sem andar o relógio
      } else if (fonte === null || fonte.tipo === "foto") {
        this.atual?.pause();
        this.atual = null;
        this.tempo += dt;
      } else {
        const el = fonte.el;
        const c = loc.clipe;
        if (this.atual !== el) {
          this.atual?.pause();
          this.atual = el;
        }
        el.playbackRate = c.velocidade;
        el.muted = c.volume === 0;
        el.volume = Math.min(1, c.volume);
        const alvo = loc.tMidia / 1e6;
        if (el.paused || el.seeking || el.readyState < 2) {
          if (el.paused) {
            if (Math.abs(el.currentTime - alvo) > 0.05) el.currentTime = alvo;
            void el.play().catch(() => {});
          }
        } else if (Math.abs(el.currentTime - alvo) > 0.3) {
          el.currentTime = alvo; // clipe seguinte de outro trecho da mesma mídia
        } else {
          const t = loc.inicio + (el.currentTime * 1e6 - c.entradaUs) / c.velocidade;
          this.tempo = Math.max(this.tempo, Math.min(t, loc.fim));
        }
        if (el.ended || el.currentTime * 1e6 >= c.saidaUs - 1000) this.tempo = Math.max(this.tempo, loc.fim);
      }
      // já abre a mídia do próximo clipe para a troca não engasgar
      const l = linhaDoTempo(p);
      const prox = l[loc.indice + 1];
      const mp = prox && p.midias.find((x) => x.id === prox.clipe.midia);
      if (mp) void this.fonte(mp);
    }
    if (this.tempo >= total) {
      this.tempo = total;
      this.pausar();
      this.desenhar(fonte);
      this.aoMudarTempo?.(this.tempo);
      this.aoParar?.();
      return;
    }
    this.desenhar(fonte);
    this.aoMudarTempo?.(this.tempo);
  }
}
