// Malha facetada da gema (para a vista): triângulos soltos (faces planas), no referencial local
// da gema: cintura de y = 0 a y = cintura, coroa para +y, pavilhão para −y, contorno (a, b) → (a, y, −b).
import { contorno, proporcoes, type Gema, type P2 } from "./regras";

export function malhaGema(g: Gema): Float32Array {
  const pr = proporcoes(g);
  const n = g.lapidacao === "redonda" ? 16 : 32;
  const base = contorno(g.lapidacao, g.comprimento, g.largura, n);
  const k = base.length;
  const yT = pr.cintura + pr.coroa, yP = -pr.pavilhao;
  // mesa girada meio passo (redonda) para formar as facetas da coroa
  const meia = (p: P2, q: P2): P2 => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  const mesa = base.map((p, i) => (g.lapidacao === "redonda" ? meia(p, base[(i + 1) % k]) : p)).map(([x, y]) => [x * pr.mesa, y * pr.mesa] as P2);
  const cul = base.map(([x, y]) => [x * pr.culaca, y * pr.culaca] as P2);
  const out: number[] = [];
  const v = (p: P2, y: number) => out.push(p[0], y, -p[1]);
  const tri = (a: P2, ya: number, b: P2, yb: number, c: P2, yc: number) => { v(a, ya); v(b, yb); v(c, yc); };
  const C: P2 = [0, 0];
  for (let i = 0; i < k; i++) {
    const j = (i + 1) % k;
    // cintura
    tri(base[i], 0, base[j], 0, base[j], pr.cintura);
    tri(base[i], 0, base[j], pr.cintura, base[i], pr.cintura);
    // coroa
    tri(base[i], pr.cintura, base[j], pr.cintura, mesa[i], yT);
    tri(mesa[(i + k - 1) % k], yT, base[i], pr.cintura, mesa[i], yT);
    // mesa
    tri(C, yT, mesa[i], yT, mesa[j], yT);
    // pavilhão
    if (pr.culaca > 0) {
      tri(base[j], 0, base[i], 0, cul[i], yP);
      tri(base[j], 0, cul[i], yP, cul[j], yP);
      tri(C, yP, cul[j], yP, cul[i], yP);
    } else tri(base[j], 0, base[i], 0, C, yP);
  }
  return new Float32Array(out);
}
