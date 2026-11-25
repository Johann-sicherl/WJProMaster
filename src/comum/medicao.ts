// Marcas de tempo do caminho interface ↔ kernel (P1 de 24/11/2026: filete lento no tablet). Aparecem no
// painel Desempenho do navegador e o roteiro de desempenho (scripts/roteiro-desempenho.cjs) as lê.
// Limite para não acumular numa sessão longa: passou dele, recomeça.

let quantas = 0;

export function marcar(nome: string) {
  if (++quantas > 400) {
    performance.clearMarks();
    quantas = 1;
  }
  performance.mark(nome);
}
