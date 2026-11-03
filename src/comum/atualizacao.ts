// Versão nova publicada: o service worker novo assume a página e aparece uma faixa "Atualizar".
// Um app aberto há horas (aba ou PWA que o Android mantém na memória) não recarrega sozinho,
// então continuava na versão antiga sem que o usuário percebesse.

const CSS = `.wj-atualizar{position:fixed;left:50%;top:8px;transform:translateX(-50%);z-index:9999;display:flex;gap:10px;align-items:center;
background:#1f6fd1;color:#fff;border-radius:10px;padding:8px 10px 8px 14px;box-shadow:0 4px 16px rgba(0,0,0,.25);font:14px system-ui,sans-serif;max-width:calc(100vw - 32px)}
.wj-atualizar button{min-height:36px;border:0;border-radius:8px;padding:0 14px;font:inherit;cursor:pointer;background:#fff;color:#1f6fd1;font-weight:600}
.wj-atualizar button[data-x]{background:transparent;color:#fff;padding:0 8px}`;

function faixa() {
  if (document.querySelector(".wj-atualizar")) return;
  document.head.append(Object.assign(document.createElement("style"), { textContent: CSS }));
  const f = document.createElement("div");
  f.className = "wj-atualizar";
  f.setAttribute("role", "status");
  f.innerHTML = `<span>Versão nova do WJProMaster disponível.</span><button data-a>Atualizar</button><button data-x title="Depois">✕</button>`;
  f.querySelector<HTMLElement>("[data-a]")!.onclick = () => location.reload();
  f.querySelector<HTMLElement>("[data-x]")!.onclick = () => f.remove();
  document.body.append(f);
}

/** Registra o service worker e avisa quando uma versão nova for publicada. */
export function registrarComAtualizacao() {
  if (!("serviceWorker" in navigator) || !import.meta.env.PROD) return;
  const sw = navigator.serviceWorker;
  sw.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {});
  // sem controlador = primeira instalação (o claim também dispara controllerchange): não é versão nova
  if (!sw.controller) return;
  sw.addEventListener("controllerchange", faixa);
  // confere ao voltar para o app e a cada 30 min (o navegador só confere sozinho ao navegar)
  const conferir = () => void sw.getRegistration().then((r) => r?.update()).catch(() => {});
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") conferir();
  });
  setInterval(conferir, 30 * 60 * 1000);
}
