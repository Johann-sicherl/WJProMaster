// WJCalcEng — catálogo das calculadoras por matéria e a busca da lupa (puro, testado em
// scripts/teste-calceng.ts). Uma calculadora nova entra aqui com `pronto: true` quando existir.

export interface Calculadora {
  id: string;
  nome: string;
  /** Palavras que também acham a calculadora na busca (fórmulas, sinônimos). */
  chaves: string;
  pronto?: boolean;
}
export interface Materia {
  id: string;
  nome: string;
  calculadoras: Calculadora[];
}

export const MATERIAS: Materia[] = [
  {
    id: "estatica", nome: "Estática e geometria de massas",
    calculadoras: [
      { id: "cg2d", nome: "Centro de gravidade 2D", pronto: true, chaves: "centroide baricentro centro de massa momento de inercia area figura composta furo esboco steiner eixos paralelos" },
    ],
  },
  {
    id: "algebra", nome: "Álgebra",
    calculadoras: [
      { id: "eq1", nome: "Equação do 1º grau", pronto: true, chaves: "primeiro grau linear ax + b raiz" },
      { id: "eq2", nome: "Equação do 2º grau", pronto: true, chaves: "segundo grau quadratica bhaskara delta discriminante raizes parabola" },
      { id: "sistemas", nome: "Sistemas com várias variáveis", pronto: true, chaves: "sistema linear equacoes incognitas substituicao escalonamento" },
      { id: "inequacoes", nome: "Inequações", pronto: true, chaves: "desigualdade intervalo maior menor solucao" },
    ],
  },
  {
    id: "matrizes", nome: "Álgebra linear — matrizes",
    calculadoras: [
      { id: "cramer", nome: "Matriz 3×3 — Cramer", pronto: true, chaves: "regra de cramer determinante sistema 3x3 sarrus" },
      { id: "gauss", nome: "Matriz 3×3 — Gauss", pronto: true, chaves: "eliminacao de gauss escalonamento pivo sistema 3x3 jordan" },
      { id: "mult", nome: "Multiplicação de matrizes", pronto: true, chaves: "produto de matrizes linha por coluna 3x3" },
    ],
  },
  {
    id: "dinamica", nome: "Física — dinâmica",
    calculadoras: [
      { id: "newton", nome: "Leis de Newton", pronto: true, chaves: "forca massa aceleracao f = m a inercia acao reacao peso" },
      { id: "plano", nome: "Plano inclinado", pronto: true, chaves: "rampa angulo componente do peso normal seno cosseno" },
      { id: "atrito", nome: "Força de atrito", pronto: true, chaves: "coeficiente estatico cinetico normal mi" },
      { id: "trabalho", nome: "Trabalho", pronto: true, chaves: "energia forca deslocamento joule potencia" },
    ],
  },
];

/** Sem acentos, minúsculas, "×" = "x": a busca não depende de como se digita. */
export const normalizar = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/×/g, "x").replace(/º/g, "o").toLowerCase();

/**
 * Matérias com as calculadoras que casam com o texto (todas as palavras precisam aparecer no
 * nome, nas palavras-chave ou no nome da matéria). Texto vazio = tudo.
 */
export function buscarCalculadoras(texto: string): Materia[] {
  const termos = normalizar(texto).split(/\s+/).filter(Boolean);
  if (!termos.length) return MATERIAS;
  return MATERIAS.map((m) => ({
    ...m,
    calculadoras: m.calculadoras.filter((c) => {
      const alvo = normalizar(`${c.nome} ${c.chaves} ${m.nome}`);
      return termos.every((t) => alvo.includes(t));
    }),
  })).filter((m) => m.calculadoras.length);
}

export const calculadora = (id: string) => MATERIAS.flatMap((m) => m.calculadoras).find((c) => c.id === id);
