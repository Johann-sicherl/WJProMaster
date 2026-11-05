// Teste do WJVideoMaker em Node: tempo em microssegundos e quadros (fps racional), código de tempo,
// classificação de arquivos de mídia e recomendações do teste do aparelho (fase V0).
import { FPS_PADRAO, codigoDeTempo, duracaoDoQuadro, duracaoLegivel, encaixarNoQuadro, quadroDoTempo, tempoDoQuadro, type Fps } from "../src/video/tempo";
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

if (falhas) {
  console.error(`\n${falhas} falha(s) no teste do WJVideoMaker`);
  process.exit(1);
}
console.log("\nWJVideoMaker: tudo ok");
