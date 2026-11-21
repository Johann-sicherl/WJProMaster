// WJGoldDiamond: modelos prontos montados só com construtores (puro: interface e testes em Node).
// "Anel folhas com oval" (J9a): aro BR 10 de 1,80 × 1,45 mm em ouro 750 amarelo, dividido perto da
// cabeça; oval 8 × 6 (rubi) ao longo do dedo; uma redonda em cada ponta da oval; de cada lado um
// leque de três navetes saindo da oval como folhas (a de 2,5 × 1,25 no meio do leque, na direção
// transversal; as de 2,0 × 1,0 a ±50°); ramos e gavinhas em fio (ornamento) e folhinhas de metal
// (escultura partindo da forma folha; o J9b troca por folhas paramétricas). Tudo editável.

import { codificar, formaInicial, type Escultura } from "./escultura";
import { gemaLivreNova, type GemaLivre } from "./gemasLivres";
import { esbocoNovoOrnamento, type FioCfg, type Ornamento } from "./ornamento";
import { diametroInterno, docNovo, type DocJoia, type Gema } from "./regras";

const RAD = Math.PI / 180;

/** Raio da elipse (semieixos ax no X e az no Z) na direção φ medida do X para o Z. */
const raioElipse = (ax: number, az: number, phi: number) => 1 / Math.sqrt((Math.cos(phi) / ax) ** 2 + (Math.sin(phi) / az) ** 2);

/** Ramos que sobem do aro dividido até o conjunto, moldura sob as gemas e gavinhas nos ombros. */
function ornamentoRamos(id: string, larguraAro: number): Ornamento {
  const esb = esbocoNovoOrnamento(`${id}-esb`, larguraAro, { comprimento: 6, largura: 8 }, 26);
  let n = 0;
  const pt = (x: number, y: number) => {
    const pid = `${id}-p${n++}`;
    esb.pontos.push({ id: pid, x, y });
    return pid;
  };
  const fios: Record<string, FioCfg> = {};
  const spline = (pts: [number, number][], cfg: FioCfg) => {
    const gid = `${id}-g${n++}`;
    esb.geos.push({ id: gid, tipo: "spline", pontos: pts.map(([x, y]) => pt(x, y)) });
    fios[gid] = cfg;
  };
  // moldura sob as gemas (um quadrante; a simetria fecha a volta): sob a redonda da ponta e sob o leque
  spline([[0, 5.3], [1.6, 4.95], [3.0, 3.9], [3.9, 2.4], [4.3, 0]], { d0: 0.8, a0: -0.55, a1: 0.45 });
  // ramo do aro dividido: sai do ombro (embutido no aro) e sobe até a moldura
  spline([[8.6, 0.35], [6.8, 0.9], [5.4, 1.9], [4.2, 2.9], [3.3, 3.6]], { d0: 0.9, d1: 0.8, a0: -0.25, a1: 0.85 });
  // gavinha (voluta) onde o aro se divide
  spline([[6.4, 1.0], [7.3, 1.8], [8.3, 1.75], [8.6, 1.15], [8.1, 0.95]], { d0: 0.7, d1: 0.6, a0: 0.05, a1: -0.12 });
  return { id, nome: "Ramos e gavinhas", ativo: true, esboco: esb, altura: 0, diametro: 0.8, simetria: "xy", envolver: true, pontas: true, fios, pontos: {} };
}

/** Folhinha de metal: forma "folha" da escultura engrossada para fundir (≥ 0,5 mm no centro). */
function folha(id: string, nome: string, lugar: Escultura["lugar"], espelhar: boolean): Escultura {
  const m = formaInicial("folha", 4);
  for (let i = 1; i < m.pos.length; i += 3) m.pos[i] = (m.pos[i] + 0.25) * 3.2 - 0.25;
  return { id, nome, ativo: true, base: "folha", nivel: 4, pos: codificar(m.pos), lugar, espelhar };
}

export function anelFolhasOval(): DocJoia {
  const b = docNovo();
  const central: Gema = { lapidacao: "oval", material: "rubi", comprimento: 8, largura: 6 };
  const d: DocJoia = {
    ...b,
    nome: "Anel folhas com oval",
    liga: "au750a",
    aro: { ...b.aro, norma: "BR", tamanho: 10, perfil: "reto", largura: 1.8, espessura: 1.45, larguraBase: 1.8, espessuraBase: 1.45, dividido: 0.6, divisao: 32, afastamento: 1.7 },
    // eixo longo ao longo do dedo (girar 90°), cintura 1,35 mm acima do aro
    cabeca: { ...b.cabeca, tipo: "garras", gema: central, garras: 4, diamGarra: 0.92, elevacao: 1.35, galeria: true, pontaGarra: "bolinha", girar: 90 },
  };
  // altura da cintura da central (para converter a posição desejada em θ)
  const R = diametroInterno("BR", 10) / 2;
  const yC = R + d.aro.espessura + d.cabeca.elevacao;
  const ax = central.largura / 2, az = central.comprimento / 2, folgaGema = 0.3;
  const livres: GemaLivre[] = [];
  const nova = (nome: string, gema: Gema, x: number, z: number, alt: number, giro: number, incl: number, sim: GemaLivre["simetria"]) => {
    const g = gemaLivreNova(`livre${livres.length + 1}`, livres.length + 1, gema.lapidacao);
    const Y = yC + alt;
    Object.assign(g, { nome, gema, th: Math.round((Math.atan2(x, Y) / RAD) * 100) / 100, z: Math.round(z * 100) / 100, altura: alt, refAltura: "central", giro, inclinacao: incl, seguir: false, diamGarra: 0.6, simetria: sim });
    livres.push(g);
  };
  // redondas nas pontas da oval (ao longo do dedo)
  nova("Redonda 2,4 (ponta)", { lapidacao: "redonda", material: "diamante", comprimento: 2.4, largura: 2.4 }, 0, az + folgaGema + 1.2, -0.3, 0, 0, "nenhuma");
  nova("Redonda 2,0 (ponta)", { lapidacao: "redonda", material: "diamante", comprimento: 2, largura: 2 }, 0, -(az + folgaGema + 1.0), -0.3, 0, 0, "nenhuma");
  // leques: a de 2,5 × 1,25 no meio (transversal, 0°), as de 2,0 × 1,0 a ±50°; esquerda ↔ direita pela simetria
  nova("Navete 2,5 × 1,25 (meio do leque)", { lapidacao: "navete", material: "diamante", comprimento: 2.5, largura: 1.25 }, ax + folgaGema + 1.25, 0, -0.4, 0, 12, "x");
  const phi = 50 * RAD, rn = raioElipse(ax, az, phi) + folgaGema + 1.0;
  nova("Navete 2,0 × 1,0 (leque, ±50°)", { lapidacao: "navete", material: "diamante", comprimento: 2, largura: 1 }, rn * Math.cos(phi), rn * Math.sin(phi), -0.4, -50, 10, "xy");
  d.gemasLivres = livres;
  d.ornamentos = [ornamentoRamos("ramos", d.aro.largura)];
  // folhinhas entre as navetes (±25° do leque) e nos ombros, com a cópia do outro lado do aro
  const rf = ax + 1.15, xf = rf * Math.cos(25 * RAD), zf = rf * Math.sin(25 * RAD);
  const thf = Math.atan2(xf, yC) / RAD;
  const altF = Math.hypot(xf, yC - 1.15) - R - d.aro.espessura;
  d.esculturas = [
    folha("folha1", "Folhinha entre navetes (frente)", { th: thf, z: zf, altura: altF, tamanho: 1.3, rx: 0, ry: -25, rz: -12 }, true),
    folha("folha2", "Folhinha entre navetes (trás)", { th: thf, z: -zf, altura: altF, tamanho: 1.3, rx: 0, ry: 25, rz: -12 }, true),
    folha("folha3", "Folhinha do ombro (frente)", { th: 40, z: 0.55, altura: -0.22, tamanho: 1.6, rx: 0, ry: -20, rz: 0 }, true),
    folha("folha4", "Folhinha do ombro (trás)", { th: 40, z: -0.55, altura: -0.22, tamanho: 1.6, rx: 0, ry: 20, rz: 0 }, true),
  ];
  return d;
}
