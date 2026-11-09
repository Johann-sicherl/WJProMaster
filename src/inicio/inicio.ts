// Página inicial do WJProMaster: uma caixa para cada software do ecossistema.
// Leve de propósito (sem Three.js nem kernel): abre na hora; o WJCAD só é baixado quando
// o usuário entra nele. Roteiro e especificação de cada face: docs/global/.

import "./inicio.css";
import { botaoDiagnostico } from "../comum/diagnostico";
import { registrarComAtualizacao } from "../comum/atualizacao";

interface Face {
  id: string;
  nome: string;
  descricao: string;
  /** Endereço (relativo à página inicial) quando já existe. */
  url?: string;
  /** Fase do roteiro global em que chega (docs/global/README.md §4). */
  fase?: string;
  /** Texto do selo quando não é simplesmente "Abrir". */
  selo?: string;
  icone: string;
}

const C = "#2f7fd0"; // traço de destaque (mesmo acento do app)
const svg = (corpo: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${corpo}</svg>`;

const FACES: Face[] = [
  {
    id: "cad", nome: "WJCAD", url: "cad/",
    descricao: "CAD paramétrico: esboço, recursos, chapa metálica, planificado e DXF.",
    icone: svg(`<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9" stroke="${C}"/>`),
  },
  {
    id: "pdm", nome: "WJPDM", url: "pdm/",
    descricao: "Diretório do WJCAD: cofre, versões e revisões, aprovações, itens e lista de materiais.",
    icone: svg(`<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 10.5l3 1.7v3.4L12 17.3l-3-1.7v-3.4z" stroke="${C}"/>`),
  },
  {
    id: "planilha", nome: "WJPlan", url: "planilha/",
    descricao: "Planilhas com fórmulas avançadas, tabelas dinâmicas, gráficos e otimizador.",
    icone: svg(`<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M3 14h18M9 4v16"/><path d="M12.5 17l2-5 2 3 2-4" stroke="${C}"/>`),
  },
  {
    id: "documentos", nome: "WJWrite", url: "documento/",
    descricao: "Documentos com estilos, sumário, campos ligados aos projetos e controle de alterações.",
    icone: svg(`<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/><path d="M9 11h6M9 14h6M9 17h4" stroke="${C}"/>`),
  },
  {
    id: "apresentacoes", nome: "WJApresentation", url: "apresentacao/",
    descricao: "Apresentações com temas, animações, modo apresentador e peças 3D do WJCAD.",
    icone: svg(`<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M12 16v4M8 20h8"/><path d="M7 12l3-3 2 2 4-4" stroke="${C}"/>`),
  },
  {
    id: "cronograma", nome: "WJCronProject", url: "cronograma/",
    descricao: "Cronogramas com Gantt, caminho crítico, recursos, linhas de base e valor agregado.",
    icone: svg(`<path d="M4 4v16h16"/><path d="M7 7h6M10 11h7M8 15h5" stroke="${C}" stroke-width="2.4"/>`),
  },
  {
    id: "erp", nome: "WJERP", url: "erp/",
    descricao: "Gestão integrada ao WJPDM e ao WJCAD: compras, estoque, PCP/MRP, vendas e financeiro.",
    icone: svg(`<path d="M4 20V10l4-3v13M8 20V7l5 3v10M13 20v-7l7-3v10"/><path d="M3 20h18" stroke="${C}"/>`),
  },
  {
    id: "flow", nome: "WJFlow", url: "flow/",
    descricao: "Túnel de vento virtual para as peças do WJCAD: Cd, sustentação, forças e cortes do escoamento.",
    icone: svg(`<path d="M3 8h9a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h7"/><path d="M14 8.5c2 .8 2 2.2 0 3" stroke="${C}"/>`),
  },
  {
    id: "tarefas", nome: "WJTaskPlan", url: "tarefas/",
    descricao: "Tarefas em pastas, escritas à mão com a caneta: estados, prazos com alerta e painel.",
    icone: svg(`<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8l1.5 1.5L12 7M8 13l1.5 1.5L12 12" stroke="${C}"/><path d="M14 8h3M14 13h3M8 17.5h9"/>`),
  },
  {
    // Especificação em docs/global/wjcalceng.md; primeiro módulo: centro de gravidade em 2D.
    id: "calceng", nome: "WJCalcEng", url: "calceng/",
    descricao: "Cálculos de engenharia do curso: centro de gravidade e momento de inércia de figuras desenhadas, com cotas.",
    icone: svg(`<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M7.5 7h9M7.5 11h3M13.5 11h3M7.5 15h3"/><circle cx="15" cy="16" r="2.6" stroke="${C}"/><path d="M15 13.4V16h2.6" stroke="${C}"/>`),
  },
  {
    // Especificação em docs/global/wjgolddiamond.md; construtores paramétricos de joias (J0–J6).
    id: "joia", nome: "WJGoldDiamond", url: "joia/",
    descricao: "Modelagem 3D de joias: aro por tamanho, gemas, garras, inglesa, pavé, gravação, peso em ouro e STL para fundição.",
    icone: svg(`<path d="M5 9l3-4h8l3 4-7 8z"/><path d="M5 9h14M9.5 5L12 9l2.5-4" stroke="${C}"/><ellipse cx="12" cy="17.5" rx="6" ry="3"/>`),
  },
  {
    // Editor de vídeo (V1); especificação em docs/global/wjvideomaker.md; teste do aparelho em video/aparelho/.
    id: "video", nome: "WJVideoMaker", url: "video/",
    descricao: "Editor de vídeo: cortar, acelerar ou desacelerar, juntar vídeos e fotos, texto sobre a imagem e exportar MP4.",
    icone: svg(`<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 9h18M3 15h18M7 5v4M12 5v4M17 5v4M7 15v4M12 15v4M17 15v4"/><path d="M10.5 10.5v3l2.5-1.5z" stroke="${C}"/>`),
  },
];

/** Nome do último documento do WJCAD guardado neste aparelho (autosave). */
function ultimoDocumentoCad(): string | null {
  try {
    const d = JSON.parse(localStorage.getItem("jlscad:documento") ?? "null") as { nome?: string; features?: unknown[] } | null;
    return d?.features?.length ? d.nome ?? null : null;
  } catch {
    return null;
  }
}

function montarCaixas() {
  const lista = document.getElementById("caixas")!;
  const ultimo = ultimoDocumentoCad();
  for (const f of FACES) {
    const pronto = !!f.url;
    const el = document.createElement(pronto ? "a" : "div");
    el.className = `caixa${pronto ? "" : " em-breve"}`;
    if (el instanceof HTMLAnchorElement) el.href = f.url!;
    el.innerHTML = `
      <span class="caixa-icone">${f.icone}</span>
      <span class="caixa-texto">
        <strong>${f.nome}</strong>
        <span>${f.descricao}</span>
        ${pronto && f.id === "cad" && ultimo ? `<em class="caixa-nota">Continuar: ${ultimo.replace(/[<>&]/g, "")}</em>` : ""}
      </span>
      <span class="selo ${pronto ? "selo-ok" : ""}">${pronto ? f.selo ?? "Abrir" : `Em breve · ${f.fase}`}</span>`;
    if (!pronto) el.title = `${f.nome}: em desenvolvimento (fase ${f.fase} do roteiro)`;
    lista.appendChild(el);
  }
}

/** Mostra no rodapé se o WJCAD já está guardado para uso sem internet neste aparelho. */
async function estadoOffline() {
  const alvo = document.getElementById("estado-offline")!;
  if (!("caches" in window)) return;
  try {
    for (const k of await caches.keys()) {
      if (!k.startsWith("jlscad-")) continue;
      const c = await caches.open(k);
      const tem = (await c.keys()).some((r) => /replicad.*\.wasm$/.test(r.url));
      if (tem) {
        alvo.textContent = "✓ WJCAD guardado neste aparelho: abre rápido e funciona sem internet.";
        return;
      }
    }
    alvo.textContent = "Na primeira vez, o WJCAD baixa o núcleo geométrico (~7 MB). Depois ele fica guardado no aparelho.";
  } catch {
    /* sem acesso ao cache: não mostra nada */
  }
}

montarCaixas();
void estadoOffline();
{
  // ⚙ configurações gerais: perfil do dispositivo e onde ficam os dados de todos os apps
  // (pasta padrão do dispositivo, pendrive, Google Drive). Carregado só no toque: o início segue leve.
  const topo = document.querySelector(".topo")!;
  const cfg = document.createElement("button");
  cfg.className = "topo-botao";
  cfg.title = "Configurações do WJProMaster (dispositivo e pastas dos dados)";
  cfg.setAttribute("aria-label", "Configurações");
  cfg.innerHTML = svg(`<circle cx="12" cy="12" r="3.2" stroke="${C}"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>`);
  cfg.onclick = async () => {
    const { abrirCopias } = await import("../comum/cofre");
    // as tarefas (WJTaskPlan/) seguem as mesmas cópias: iguala junto com o cofre
    void abrirCopias(() => void import("../tarefas/copias").then((m) => m.sincronizarTarefas(false)).catch(() => {}), true);
  };
  topo.append(cfg);
  const b = botaoDiagnostico();
  if (b) topo.append(b);
}

// sincronia ao abrir/recarregar o início: cofre (WJPDM/) e tarefas (WJTaskPlan/) com a pasta do
// dispositivo, o pendrive e o Google Drive. Carregada depois que as caixas aparecem.
setTimeout(() => {
  void Promise.all([import("../comum/cofre"), import("../tarefas/copias")]).then(([cofre, tarefas]) => {
    void sincronizarTudo(cofre, tarefas);
    window.addEventListener(cofre.EVENTO_SINCRONIZADO, () => void tarefas.sincronizarTarefas(false).catch(() => {}));
  });
}, 300);
async function sincronizarTudo(cofre: typeof import("../comum/cofre"), tarefas: typeof import("../tarefas/copias")) {
  await cofre.sincronizarAoAbrir()?.catch(() => "");
  await tarefas.sincronizarTarefas(false).catch(() => {});
}

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  registrarComAtualizacao();
}

// versão publicada (vite.config.ts): confere se o aparelho já pegou a atualização
{
  const v = document.getElementById("versao");
  if (v) v.textContent = `v${__VERSAO__}`;
}
