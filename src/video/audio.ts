// WJVideoMaker — reamostragem do áudio para a exportação (puro, testado em scripts/teste-video.ts).
// Cada clipe chega na taxa e no número de canais do arquivo dele; o codificador quer tudo igual
// (48 kHz, estéreo). O reamostrador converte bloco a bloco, sem emendas entre blocos, e aplica a
// velocidade do clipe junto: ler a entrada `velocidade` vezes mais depressa acelera o som (o tom
// acompanha, como uma fita acelerada). Interpolação linear: suficiente para voz e música de fundo.

export const TAXA_SAIDA = 48_000;

export class Reamostrador {
  /** Amostras de entrada avançadas por amostra de saída. */
  private passo: number;
  /** Posição (em amostras de entrada) da próxima amostra de saída, relativa ao bloco atual. */
  private pos = 0;
  /** Última amostra (E, D) do bloco anterior, para interpolar a emenda. */
  private ultimo: [number, number] | null = null;

  constructor(taxaEntrada: number, velocidade = 1, taxaSaida = TAXA_SAIDA) {
    this.passo = (taxaEntrada * velocidade) / taxaSaida;
  }

  /** Converte um bloco (canais planos) em estéreo na taxa de saída. */
  processar(canais: Float32Array[]): [Float32Array, Float32Array] {
    const n = canais[0]?.length ?? 0;
    if (!n) return [new Float32Array(0), new Float32Array(0)];
    const e = canais[0], d = canais[1] ?? canais[0]; // mono vira estéreo; mais de 2 canais: os 2 primeiros
    if (!this.ultimo && this.pos < 0) this.pos = 0; // sem bloco anterior: começa na 1ª amostra
    const max = this.pos <= n - 1 ? Math.floor((n - 1 - this.pos) / this.passo) + 2 : 0;
    const outE = new Float32Array(max), outD = new Float32Array(max);
    let k = 0;
    while (this.pos <= n - 1 && k < max) {
      const i = Math.floor(this.pos);
      const f = this.pos - i;
      const e0 = i < 0 ? this.ultimo![0] : e[i], d0 = i < 0 ? this.ultimo![1] : d[i];
      const e1 = f > 0 ? e[i + 1] : e0, d1 = f > 0 ? d[i + 1] : d0;
      outE[k] = e0 + (e1 - e0) * f;
      outD[k] = d0 + (d1 - d0) * f;
      k++;
      this.pos += this.passo;
    }
    this.pos -= n;
    this.ultimo = [e[n - 1], d[n - 1]];
    return [outE.subarray(0, k), outD.subarray(0, k)];
  }
}
