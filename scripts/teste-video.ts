// Teste do WJVideoMaker em Node: tempo em microssegundos e quadros (fps racional), código de tempo,
// classificação de arquivos de mídia, recomendações do teste do aparelho (fase V0) e o projeto de
// edição (V1): cortar, aparar, velocidade, reduzir o tempo, mover, textos, plano de quadros e tamanho.
import { FPS_PADRAO, codigoDeTempo, duracaoDoQuadro, duracaoLegivel, encaixarNoQuadro, quadroDoTempo, tempoDoQuadro, type Fps } from "../src/video/tempo";
import {
  adicionarTexto, ajustarDuracao, apararNoCursor, caixaInteira, definirDuracaoFoto, definirTempoTexto, definirTrecho, definirVelocidade, dimensoes, dividir,
  duplicarClipe, duracaoClipe, duracaoTotal, excluirClipe, inserirMidia, linhaDoTempo, localizar, moverClipe, planoDeQuadros, projetoNovo, quebrarLinhas,
  taxaParaTamanho, taxaVideo, tamanhoEstimadoMb, textosEm, validarProjeto, type Midia,
} from "../src/video/projeto";
import { Reamostrador } from "../src/video/audio";
import { classificarArquivo, ehHeic, fluxosEmTempoReal, recomendar, taxaBits, textoRecomendacao, type Medidas } from "../src/video/capacidade";

let falhas = 0;
function igual(nome: string, obtido: unknown, esperado: unknown) {
  const ok = typeof esperado === "number" && typeof obtido === "number" ? Math.abs(obtido - esperado) < 1e-6 : String(obtido) === String(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "ok  " : "FALHA"} ${nome}: ${String(obtido)}${ok ? "" : ` (esperado ${String(esperado)})`}`);
}

// --- tempo ---
const f30: Fps = [30, 1];
const f2997: Fps = [30000, 1001];
igual("30 qps: quadro 1 começa em 33 333 µs", tempoDoQuadro(1, f30), 33333);
igual("30 qps: quadro 30 = 1 s", tempoDoQuadro(30, f30), 1_000_000);
igual("30 qps: 999 999 µs ainda é o quadro 29", quadroDoTempo(999_999, f30), 29);
igual("29,97: quadro 30000 = 1001 s", tempoDoQuadro(30000, f2997), 1001_000_000);
// ida e volta exata para todos os fps padrão, em 2 h de vídeo
let idaVolta = true;
for (const { fps } of FPS_PADRAO)
  for (const q of [0, 1, 2, 29, 59, 1799, 107_891, 215_784, 431_568])
    if (quadroDoTempo(tempoDoQuadro(q, fps), fps) !== q) idaVolta = false;
igual("quadro → tempo → quadro sem desvio (todos os fps, até 2 h)", idaVolta, true);
igual("duração do quadro em 25 qps", duracaoDoQuadro([25, 1]), 40000);
igual("encaixa 50 000 µs no quadro de 30 qps mais próximo", encaixarNoQuadro(50_000, f30), 66667);
igual("encaixa 40 000 µs (mais perto do quadro 1)", encaixarNoQuadro(40_000, f30), 33333);
igual("código de tempo 1 h 01 min 01 s quadro 15", codigoDeTempo(tempoDoQuadro((3661 * 30) + 15, f30), f30), "01:01:01:15");
igual("código de tempo em 29,97 conta 30 quadros", codigoDeTempo(tempoDoQuadro(45, f2997), f2997), "00:00:01:15");
igual("duração legível curta", duracaoLegivel(12_340_000), "12,3 s");
igual("duração legível em minutos", duracaoLegivel(65_900_000), "1 min 05 s");
igual("duração legível em horas", duracaoLegivel(3_720_000_000), "1 h 02 min");

// --- arquivos ---
igual("MOV do iPhone é vídeo", classificarArquivo("IMG_0001.MOV"), "video");
igual("foto HEIC é imagem", classificarArquivo("foto.heic"), "imagem");
igual("HEIC detectado pelo nome", ehHeic("Foto.HEIF"), true);
igual("HEIC detectado pelo tipo", ehHeic("sem-extensao", "image/heic"), true);
igual("JPEG não é HEIC", ehHeic("a.jpg", "image/jpeg"), false);
igual("legenda SRT", classificarArquivo("aula.srt"), "legenda");
igual("LUT .cube", classificarArquivo("filme.cube"), "lut");
igual("sem extensão, pelo tipo MIME", classificarArquivo("gravacao", "audio/webm"), "audio");
igual("PDF não é mídia", classificarArquivo("manual.pdf", "application/pdf"), null);
igual("taxa 1080p30 ≈ 12,4 Mbit/s", taxaBits(1920, 1080, 30), 12_400_000);

// --- recomendações ---
// tablet de entrada: 1080p só um vídeo em tempo real, sem 4K, sem AAC
const tablet: Medidas = {
  decodificacao: [
    { res: 720, fluxos: 1, fpsPorFluxo: 240 }, { res: 720, fluxos: 2, fpsPorFluxo: 110 }, { res: 720, fluxos: 3, fpsPorFluxo: 50 }, { res: 720, fluxos: 4, fpsPorFluxo: 30 },
    { res: 1080, fluxos: 1, fpsPorFluxo: 95 }, { res: 1080, fluxos: 2, fpsPorFluxo: 33 }, { res: 1080, fluxos: 3, fpsPorFluxo: 14 },
  ],
  composicao1080: 70,
  exportacao: [{ res: 1080, fluxos: 1, fps: 24 }, { res: 1080, fluxos: 2, fps: 12 }],
  codificaH264: { 720: "hardware", 1080: "hardware", 2160: "nao" },
  codificaVp9: { 720: "software", 1080: "software", 2160: "nao" },
  codificaAac: false,
  codificaOpus: true,
};
igual("fluxos 720p em tempo real (≥ 36 qps)", fluxosEmTempoReal(tablet.decodificacao, 720), 3);
igual("fluxos 1080p em tempo real", fluxosEmTempoReal(tablet.decodificacao, 1080), 1);
const r = recomendar(tablet);
igual("tablet: proxy acima de 1080p", r.proxyAcima, 1080);
igual("tablet: prévia completa (1 vídeo 1080p e composição rápida)", r.qualidadePrevia, "completa");
igual("tablet: exporta até 1080p", r.exportarAte, 1080);
igual("tablet: MP4 com Opus quando falta AAC", r.formatoSaida, "MP4 (H.264 + Opus)");
igual("tablet: 1 min exporta em 1,25 min", r.minutosPorMinuto1, 1.25);
igual("tablet: 2 vídeos exportam em 2,5 min/min", r.minutosPorMinuto2, 2.5);
igual("tablet: avisa 4K não medido", r.avisos.some((a) => a.includes("4K")), true);
igual("tablet: avisa transições em 1080p", r.avisos.some((a) => a.includes("Transições")), true);
igual("texto do resumo tem 5 linhas + avisos", textoRecomendacao(r).length, 5 + r.avisos.length);

// computador forte: 4K liso, AAC, 4K por hardware
const pc: Medidas = {
  decodificacao: [{ res: 1080, fluxos: 4, fpsPorFluxo: 300 }, { res: 2160, fluxos: 1, fpsPorFluxo: 120 }, { res: 2160, fluxos: 2, fpsPorFluxo: 60 }],
  composicao1080: 400,
  exportacao: [{ res: 1080, fluxos: 1, fps: 150 }],
  codificaH264: { 720: "hardware", 1080: "hardware", 2160: "hardware" },
  decodificaH264: { 720: "hardware", 1080: "hardware", 2160: "hardware" },
  decodificaHevc10: true,
  codificaVp9: {},
  codificaAac: true,
  codificaOpus: true,
};
const rp = recomendar(pc);
igual("computador: proxy não precisa", rp.proxyAcima, null);
igual("computador: exporta 4K", rp.exportarAte, 2160);
igual("computador: MP4 H.264 + AAC", rp.formatoSaida, "MP4 (H.264 + AAC)");
igual("computador: sem avisos", rp.avisos.length, 0);

// 4K só por software: não recomenda exportar 4K
const rs = recomendar({ ...pc, codificaH264: { 720: "hardware", 1080: "hardware", 2160: "software" } });
igual("4K por software: exporta só até 1080p", rs.exportarAte, 1080);

// aparelho fraco sem codificador
const fraco = recomendar({ decodificacao: [{ res: 720, fluxos: 1, fpsPorFluxo: 20 }], exportacao: [], codificaH264: {}, codificaVp9: {}, codificaAac: false, codificaOpus: false });
igual("fraco: prévia em um quarto", fraco.qualidadePrevia, "um quarto");
igual("fraco: proxy acima de 720p", fraco.proxyAcima, 720);
igual("fraco: não exporta", fraco.formatoSaida, "nenhum");

// números reais do TCL Tab A1 Plus (V0, 05/11/2026): 4K decodifica só por software
const tcl: Medidas = {
  decodificacao: [
    { res: 720, fluxos: 1, fpsPorFluxo: 199 }, { res: 720, fluxos: 2, fpsPorFluxo: 107 }, { res: 720, fluxos: 3, fpsPorFluxo: 100 }, { res: 720, fluxos: 4, fpsPorFluxo: 76 },
    { res: 1080, fluxos: 1, fpsPorFluxo: 103 }, { res: 1080, fluxos: 2, fpsPorFluxo: 76 }, { res: 1080, fluxos: 3, fpsPorFluxo: 35 }, { res: 1080, fluxos: 4, fpsPorFluxo: 32 },
    { res: 2160, fluxos: 1, fpsPorFluxo: 101 }, { res: 2160, fluxos: 2, fpsPorFluxo: 65 }, { res: 2160, fluxos: 3, fpsPorFluxo: 40 }, { res: 2160, fluxos: 4, fpsPorFluxo: 30 },
  ],
  composicao1080: 54,
  exportacao: [{ res: 1080, fluxos: 1, fps: 22 }, { res: 1080, fluxos: 2, fps: 20 }],
  codificaH264: { 720: "hardware", 1080: "hardware", 2160: "software" },
  decodificaH264: { 720: "hardware", 1080: "hardware", 2160: "software" },
  decodificaHevc10: false,
  codificaVp9: { 720: "software", 1080: "software", 2160: "software" },
  codificaAac: true,
  codificaOpus: true,
};
const rt = recomendar(tcl);
igual("TCL: 2 vídeos 1080p juntos", rt.fluxos1080, 2);
igual("TCL: 4K por software → proxy acima de 1080p", rt.proxyAcima, 1080);
igual("TCL: prévia completa", rt.qualidadePrevia, "completa");
igual("TCL: exporta até 1080p (4K só por software)", rt.exportarAte, 1080);
igual("TCL: MP4 H.264 + AAC", rt.formatoSaida, "MP4 (H.264 + AAC)");
igual("TCL: 1 min exporta em ≈ 1,36 min", Math.round(rt.minutosPorMinuto1! * 100) / 100, 1.36);
igual("TCL: avisa 4K por software", rt.avisos.some((a) => a.includes("4K só decodifica por software")), true);
igual("TCL: avisa HDR 10 bits", rt.avisos.some((a) => a.includes("10 bits")), true);
igual("TCL: avisa a 3ª camada", rt.avisos.some((a) => a.includes("Até 2 vídeos")), true);

// --- projeto de edição (V1) ---
const S = 1_000_000;
const vidA: Midia = { id: "a", nome: "obra.mp4", tipo: "video", duracaoUs: 10 * S, largura: 1920, altura: 1080, temAudio: true, tamanho: 1000 };
const vidB: Midia = { id: "b", nome: "drone.mov", tipo: "video", duracaoUs: 6 * S, largura: 1080, altura: 1920, temAudio: false, tamanho: 2000 };
const foto: Midia = { id: "f", nome: "peca.jpg", tipo: "imagem", duracaoUs: 0, largura: 4000, altura: 3000, temAudio: false, tamanho: 3000 };
const pj = projetoNovo("Teste");
const cA = inserirMidia(pj, vidA);
const cF = inserirMidia(pj, foto);
const cB = inserirMidia(pj, vidB);
igual("vídeo + foto + vídeo: 10 s + 4 s + 6 s = 20 s", duracaoTotal(pj), 20 * S);
igual("vídeo sem som entra mudo (volume 0)", cB.volume, 0);
igual("pista magnética: foto começa onde o vídeo acaba", linhaDoTempo(pj)[1].inicio, 10 * S);
igual("localizar 12 s cai na foto", localizar(pj, 12 * S)!.clipe.id, cF.id);
igual("localizar 15 s: 1 s dentro do 2º vídeo", localizar(pj, 15 * S)!.tMidia, 1 * S);
igual("localizar no fim exato = último quadro do último clipe", localizar(pj, 20 * S)!.clipe.id, cB.id);

// dividir (corte)
const tras = dividir(pj, 4 * S)!;
igual("dividir em 4 s: frente 0–4 s", `${cA.entradaUs}-${cA.saidaUs}`, `0-${4 * S}`);
igual("dividir em 4 s: trás 4–10 s", `${tras.entradaUs}-${tras.saidaUs}`, `${4 * S}-${10 * S}`);
igual("dividir não muda a duração total", duracaoTotal(pj), 20 * S);
igual("dividir fora de clipe (25 s) não faz nada", dividir(pj, 25 * S), null);
igual("dividir colado na ponta (a menos de 1 quadro) não faz nada", dividir(pj, 4 * S + 10_000), null);
igual("dividir encaixa no quadro (4,51 s → 4,5 s em 30 qps)", (() => { const q = projetoNovo(); inserirMidia(q, vidA); dividir(q, 4_510_000); return q.clipes[0].saidaUs; })(), 4_500_000);

// excluir o trecho do meio (cortar uma parte): o resto anda junto
excluirClipe(pj, tras.id);
igual("excluir trecho de 6 s: total 14 s", duracaoTotal(pj), 14 * S);
igual("pista fecha o vão: foto começa em 4 s", linhaDoTempo(pj)[1].inicio, 4 * S);

// aparar pelo cursor
const pa = projetoNovo();
const ca = inserirMidia(pa, vidA);
igual("aparar início no cursor (2 s)", apararNoCursor(pa, ca.id, "inicio", 2 * S), true);
igual("…o clipe começa em 2 s do vídeo e dura 8 s", `${ca.entradaUs} ${duracaoClipe(ca)}`, `${2 * S} ${8 * S}`);
igual("aparar fim no cursor (5 s da linha = 7 s do vídeo)", apararNoCursor(pa, ca.id, "fim", 5 * S), true);
igual("…trecho 2–7 s, 5 s na linha", `${ca.entradaUs}-${ca.saidaUs} ${duracaoClipe(ca)}`, `${2 * S}-${7 * S} ${5 * S}`);
igual("aparar com cursor fora do clipe não faz nada", apararNoCursor(pa, ca.id, "fim", 9 * S), false);
definirTrecho(pa, ca.id, -5 * S, 50 * S);
igual("trecho limitado ao vídeo (0–10 s)", `${ca.entradaUs}-${ca.saidaUs}`, `0-${10 * S}`);
definirTrecho(pa, ca.id, 3 * S, 3 * S);
igual("trecho de duração zero vira um quadro", ca.saidaUs - ca.entradaUs, 33333);

// velocidade e reduzir o tempo
const pv = projetoNovo();
const cv = inserirMidia(pv, vidA);
definirVelocidade(pv, cv.id, 2);
igual("2× acelera: 10 s viram 5 s", duracaoClipe(cv), 5 * S);
definirVelocidade(pv, cv.id, 0.5);
igual("0,5× câmera lenta: 10 s viram 20 s", duracaoClipe(cv), 20 * S);
definirVelocidade(pv, cv.id, 50);
igual("velocidade limitada a 10×", cv.velocidade, 10);
igual("localizar com 10×: 0,5 s na linha = 5 s do vídeo", localizar(pv, 500_000)!.tMidia, 5 * S);
ajustarDuracao(pv, cv.id, 4 * S);
igual("reduzir para 4 s sem cortar: velocidade 2,5×", cv.velocidade, 2.5);
igual("…e dura 4 s", duracaoClipe(cv), 4 * S);
const fv = inserirMidia(pv, foto);
igual("foto não tem velocidade", definirVelocidade(pv, fv.id, 2), false);
definirDuracaoFoto(pv, fv.id, 2.5 * S);
igual("duração da foto 2,5 s", duracaoClipe(fv), 2.5 * S);
ajustarDuracao(pv, fv.id, 1 * S);
igual("reduzir a foto para 1 s", duracaoClipe(fv), 1 * S);
// dividir clipe acelerado: o corte cai no tempo certo da mídia
const tras2 = dividir(pv, 2 * S)!;
igual("dividir clipe 2,5× em 2 s da linha = 5 s do vídeo", `${cv.saidaUs} ${tras2.entradaUs} ${tras2.velocidade}`, `${5 * S} ${5 * S} 2.5`);

// mover e duplicar
const pm = projetoNovo();
const m1 = inserirMidia(pm, vidA), m2 = inserirMidia(pm, foto), m3 = inserirMidia(pm, vidB);
moverClipe(pm, m3.id, 0);
igual("mover o 3º clipe para o início", pm.clipes.map((c) => c.midia).join(""), "baf");
moverClipe(pm, m3.id, 99);
igual("mover para além do fim = último", pm.clipes.map((c) => c.midia).join(""), "afb");
const d = duplicarClipe(pm, m1.id)!;
igual("duplicar põe a cópia logo depois", pm.clipes.map((c) => c.id).indexOf(d.id), 1);
igual("duplicar não mexe no original", m2.saidaUs, 4 * S);

// textos
const pt = projetoNovo();
inserirMidia(pt, vidA);
const tx = adicionarTexto(pt, 2 * S, "Montagem do suporte");
igual("texto novo: 3 s a partir do cursor", `${tx.inicioUs} ${tx.duracaoUs}`, `${2 * S} ${3 * S}`);
igual("texto visível em 3 s", textosEm(pt, 3 * S).length, 1);
igual("texto some em 5 s", textosEm(pt, 5 * S).length, 0);
const tx2 = adicionarTexto(pt, 9 * S);
igual("texto perto do fim encolhe até o fim do vídeo", tx2.duracaoUs, 1 * S);
definirTempoTexto(pt, tx.id, -1 * S, 0);
igual("tempo do texto limitado (início ≥ 0, ao menos 1 quadro)", `${tx.inicioUs} ${tx.duracaoUs}`, "0 33333");
definirTempoTexto(pt, tx.id, 8 * S, 6 * S);
igual("texto além do fim alonga o vídeo (fundo preto)", duracaoTotal(pt), 14 * S);
const medir = (s: string) => s.length * 10;
igual("quebra de linha nas palavras", quebrarLinhas("Peça de chapa 3 mm dobrada", 120, medir).join("|"), "Peça de|chapa 3 mm|dobrada");
igual("quebra manual mantida", quebrarLinhas("A\nB", 999, medir).join("|"), "A|B");

// plano de quadros da exportação
const pq = projetoNovo();
const q1 = inserirMidia(pq, vidA);
definirTrecho(pq, q1.id, 0, 1 * S);
const q2 = inserirMidia(pq, vidB);
definirTrecho(pq, q2.id, 2 * S, 3 * S);
definirVelocidade(pq, q2.id, 2);
const plano = [...planoDeQuadros(pq)];
igual("1 s + 0,5 s a 30 qps = 45 quadros", plano.length, 45);
igual("quadro 30 é o 1º do 2º clipe, em 2 s da mídia", `${plano[30].indiceClipe} ${plano[30].tMidia}`, `1 ${2 * S}`);
igual("quadro 31 (2×): 2 quadros de mídia depois", plano[31].tMidia, 2 * S + 66666);
igual("tempos de mídia crescentes dentro do clipe", plano.slice(30).every((q, i, a) => i === 0 || q.tMidia > a[i - 1].tMidia), true);
igual("último quadro dentro do trecho", plano[44].tMidia < 3 * S, true);

// quadro de saída e tamanho
igual("16:9 em 1080", dimensoes("16:9", 1080).join("×"), "1920×1080");
igual("9:16 em 720", dimensoes("9:16", 720).join("×"), "720×1280");
igual("4:5 em 1080", dimensoes("4:5", 1080).join("×"), "1080×1350");
igual("vídeo em pé num quadro deitado: faixas dos lados", (() => { const r = caixaInteira(1080, 1920, 1920, 1080); return `${Math.round(r.x)} ${Math.round(r.w)}`; })(), "656 608");
igual("qualidade alta 1080p30 ≈ 12,4 Mbit/s", taxaVideo(1920, 1080, 30, "alta"), 12_400_000);
const bps = taxaParaTamanho(16, 60 * S);
igual("caber em 16 MB num vídeo de 1 min", tamanhoEstimadoMb(60 * S, bps) <= 16, true);
igual("…usando quase todo o limite", tamanhoEstimadoMb(60 * S, bps) > 14.5, true);
igual("tamanho mínimo de taxa (200 kbit/s)", taxaParaTamanho(1, 3600 * S), 200_000);

// arquivo
const copia = validarProjeto(JSON.parse(JSON.stringify(pq)))!;
igual("projeto ida e volta pelo arquivo", JSON.stringify(copia), JSON.stringify(pq));
igual("arquivo que não é projeto", validarProjeto({ formato: "outro" }), null);
const sujo = validarProjeto({ formato: "wjvid", midias: [vidA], clipes: [{ id: "x", midia: "a", entradaUs: 0, saidaUs: S, velocidade: 99, volume: 7 }, { id: "y", midia: "zz" }], textos: [{ id: "t", tamanho: 9 }] })!;
igual("arquivo corrigido: velocidade e volume limitados, clipe sem mídia sai", `${sujo.clipes.length} ${sujo.clipes[0].velocidade} ${sujo.clipes[0].volume} ${sujo.textos[0].tamanho}`, "1 10 2 0.3");

// --- reamostragem do áudio (exportação) ---
const seno = (taxa: number, hz: number, s: number) => Float32Array.from({ length: Math.round(taxa * s) }, (_, i) => Math.sin((2 * Math.PI * hz * i) / taxa));
const cruzamentos = (x: Float32Array) => { let n = 0; for (let i = 1; i < x.length; i++) if ((x[i - 1] < 0) !== (x[i] < 0)) n++; return n; };
const juntar = (partes: Float32Array[]) => { const t = new Float32Array(partes.reduce((a, p) => a + p.length, 0)); let o = 0; for (const p of partes) (t.set(p, o), (o += p.length)); return t; };
{
  const x = seno(48000, 440, 1);
  const [e] = new Reamostrador(48000, 1).processar([x]);
  igual("48 kHz → 48 kHz, 1×: igual à entrada", e.length === x.length && e.every((v, i) => Math.abs(v - x[i]) < 1e-6), true);
  const y = seno(44100, 440, 1);
  const [e2] = new Reamostrador(44100, 1).processar([y]);
  igual("44,1 kHz → 48 kHz: 48 000 amostras por segundo (±1)", Math.abs(e2.length - 48000) <= 1, true);
  igual("44,1 kHz → 48 kHz: mesma frequência (880 cruzamentos ±2)", Math.abs(cruzamentos(e2) - 880) <= 2, true);
  const [e3] = new Reamostrador(48000, 2).processar([x]);
  igual("velocidade 2×: metade das amostras", Math.abs(e3.length - 24000) <= 1, true);
  igual("velocidade 2×: o tom dobra (440 → 880 Hz, mesmos cruzamentos em metade do tempo)", Math.abs(cruzamentos(e3) - 880) <= 2, true);
  const [e4] = new Reamostrador(48000, 0.5).processar([x]);
  igual("velocidade 0,5×: o dobro das amostras", Math.abs(e4.length - 96000) <= 2, true);
  // em blocos de tamanhos variados: mesmo resultado que de uma vez (sem emendas)
  const r = new Reamostrador(44100, 1.5);
  const partes: Float32Array[] = [];
  let o = 0;
  for (const tam of [1000, 37, 4410, 1, 9000, 30000]) {
    if (o >= y.length) break;
    partes.push(r.processar([y.subarray(o, Math.min(y.length, o + tam))])[0]);
    o += tam;
  }
  if (o < y.length) partes.push(r.processar([y.subarray(o)])[0]);
  const deUmaVez = new Reamostrador(44100, 1.5).processar([y])[0];
  const emBlocos = juntar(partes);
  igual("em blocos = de uma vez (mesmo tamanho)", emBlocos.length, deUmaVez.length);
  igual("em blocos = de uma vez (mesmas amostras)", emBlocos.every((v, i) => Math.abs(v - deUmaVez[i]) < 1e-5), true);
  const [me, md] = new Reamostrador(48000, 1).processar([Float32Array.of(0.1, 0.2, 0.3)]);
  igual("mono vira estéreo (os dois lados iguais)", Array.from(me).join() === Array.from(md).join() && me.length === 3, true);
}

if (falhas) {
  console.error(`\n${falhas} falha(s) no teste do WJVideoMaker`);
  process.exit(1);
}
console.log("\nWJVideoMaker: tudo ok");
