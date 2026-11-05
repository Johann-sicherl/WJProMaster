// WJVideoMaker — tempo da linha do tempo (puro, testado em scripts/teste-video.ts).
// Todo tempo é inteiro em microssegundos (a unidade do WebCodecs); as edições caem em
// fronteiras de quadro do projeto, com taxa de quadros racional (29,97 = 30000/1001).

/** Taxa de quadros racional: [numerador, denominador] quadros por segundo. */
export type Fps = readonly [number, number];

export const FPS_PADRAO: { nome: string; fps: Fps }[] = [
  { nome: "24", fps: [24, 1] },
  { nome: "25", fps: [25, 1] },
  { nome: "29,97", fps: [30000, 1001] },
  { nome: "30", fps: [30, 1] },
  { nome: "50", fps: [50, 1] },
  { nome: "59,94", fps: [60000, 1001] },
  { nome: "60", fps: [60, 1] },
];

const US = 1_000_000;

/** Quadros por segundo em número decimal. */
export const fpsDecimal = ([n, d]: Fps) => n / d;

/** Início (µs) do quadro q. */
export const tempoDoQuadro = (q: number, [n, d]: Fps) => Math.round((q * d * US) / n);

/**
 * Quadro que está na tela no tempo t (µs). A folga de meio microssegundo evita que um tempo
 * arredondado por `tempoDoQuadro` caia no quadro anterior.
 */
export const quadroDoTempo = (t: number, [n, d]: Fps) => Math.floor(((t + 0.5) * n) / (d * US));

/** Duração (µs) de um quadro (arredondada; para somar quadros use `tempoDoQuadro`). */
export const duracaoDoQuadro = (fps: Fps) => tempoDoQuadro(1, fps);

/** Leva o tempo para a fronteira de quadro mais próxima. */
export const encaixarNoQuadro = (t: number, [n, d]: Fps) => tempoDoQuadro(Math.round((t * n) / (d * US)), [n, d]);

/**
 * Código de tempo HH:MM:SS:QQ (sem desconto de quadros; em 29,97 conta 30 quadros por "segundo",
 * como a contagem de quadros simples dos editores).
 */
export function codigoDeTempo(t: number, fps: Fps): string {
  const base = Math.round(fpsDecimal(fps));
  const q = quadroDoTempo(Math.max(0, t), fps);
  const qq = q % base;
  const s = Math.floor(q / base);
  const dois = (v: number) => String(v).padStart(2, "0");
  return `${dois(Math.floor(s / 3600))}:${dois(Math.floor(s / 60) % 60)}:${dois(s % 60)}:${dois(qq)}`;
}

/** Duração legível: "1 min 05 s", "12,3 s", "1 h 02 min". */
export function duracaoLegivel(t: number): string {
  const s = t / US;
  if (s < 60) return `${s.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${String(Math.floor(s % 60)).padStart(2, "0")} s`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
}
