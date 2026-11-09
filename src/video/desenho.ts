// WJVideoMaker — desenho de um quadro: a mídia inteira centrada (faixas pretas no que sobra) e os
// textos por cima. O MESMO código serve à prévia (canvas da página) e à exportação (OffscreenCanvas
// no Worker), para o vídeo exportado sair igual ao que se vê na tela.

import { caixaInteira, quebrarLinhas, type Texto } from "./projeto";

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Fundo preto e a mídia inteira centrada no quadro W×H. */
export function desenharMidia(ctx: Ctx, W: number, H: number, fonte: CanvasImageSource | null, sw: number, sh: number) {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  if (!fonte || !(sw > 0) || !(sh > 0)) return;
  const r = caixaInteira(sw, sh, W, H);
  ctx.drawImage(fonte, r.x, r.y, r.w, r.h);
}

const fonteDe = (t: Texto, px: number) => `${t.negrito ? "700" : "400"} ${px}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;

/** Caixa ocupada pelo texto no quadro (para tocar e arrastar o texto na prévia). */
export function caixaDoTexto(ctx: Ctx, W: number, H: number, t: Texto): { x: number; y: number; w: number; h: number; linhas: string[]; px: number } {
  const px = Math.max(8, Math.round(t.tamanho * H));
  ctx.font = fonteDe(t, px);
  const linhas = quebrarLinhas(t.texto, W * 0.9, (s) => ctx.measureText(s).width);
  const alturaLinha = px * 1.25;
  const largura = Math.max(...linhas.map((l) => ctx.measureText(l).width), px * 0.5);
  const pad = px * 0.35;
  const w = largura + pad * 2, h = alturaLinha * linhas.length + pad * 2;
  return { x: t.x * W - w / 2, y: t.y * H - h / 2, w, h, linhas, px };
}

/** Desenha os textos (na ordem: o último fica por cima). */
export function desenharTextos(ctx: Ctx, W: number, H: number, textos: Texto[]) {
  for (const t of textos) {
    if (!t.texto.trim()) continue;
    const c = caixaDoTexto(ctx, W, H, t);
    if (t.fundo) {
      ctx.globalAlpha = 0.6;
      ctx.fillStyle = t.corFundo;
      ctx.beginPath();
      ctx.roundRect(c.x, c.y, c.w, c.h, c.px * 0.25);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.font = fonteDe(t, c.px);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = t.cor;
    if (!t.fundo) {
      // sem faixa: contorno escuro para ler sobre qualquer imagem
      ctx.lineJoin = "round";
      ctx.lineWidth = Math.max(2, c.px * 0.12);
      ctx.strokeStyle = "rgba(0,0,0,.75)";
    }
    const alturaLinha = c.px * 1.25;
    c.linhas.forEach((l, i) => {
      const y = c.y + c.px * 0.35 + alturaLinha * (i + 0.5);
      if (!t.fundo) ctx.strokeText(l, t.x * W, y);
      ctx.fillText(l, t.x * W, y);
    });
  }
}
