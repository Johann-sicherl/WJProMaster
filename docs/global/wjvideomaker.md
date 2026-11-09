# WJVideoMaker — edição de vídeo avançada

Face do WJProMaster para **editar vídeos e fotos** numa linha do tempo com várias pistas: cortar,
montar, títulos, transições, efeitos, cor, áudio e exportação. Pedido do Johann em 05/11/2026.
Roda no **celular, tablet e computador** (navegador Chrome/Edge e PWA), tudo **no aparelho**
(sem servidor), e usa mídia do **Google Drive, da pasta do dispositivo, do pendrive e da galeria**.

- Página: `video/` · código: `src/video/` · motor puro testado: `src/video/linha.ts`, `tempo.ts`,
  `quadros.ts` (`scripts/teste-video.ts`) · teste do aparelho em `video/aparelho/`
- Arquivos: **tudo no cofre do WJPDM** — projeto **`.wjvid`** (linha do tempo + ids da mídia do cofre), mídia e exportações, pasta
  **"Vídeos"** · autosave no IndexedDB `wjvideo` · cache de mídia, miniaturas e proxies no **OPFS**
- Status: **V0 ✅** (teste do aparelho, `video/aparelho/`) · **V1 ✅ (08/11/2026)**: editor em `video/`
  (cortar, aparar, acelerar/desacelerar, reduzir o tempo, juntar vídeos e fotos, texto sobre a imagem,
  exportar MP4 com redução de tamanho; §16). Próxima: V2.

Legenda: ✅ existe · 🟡 parcial · **V0…V6** fase deste documento · ⏸ registrado, fora do escopo atual ·
❓ depende de decisão do Johann (§14).

---

## 1. Resumo da decisão

| Pergunta | Resposta |
|---|---|
| Inspiração funcional | **Wondershare Filmora** (editor de vídeo de consumo avançado): biblioteca de mídia → linha do tempo com pistas → títulos, transições, efeitos, cor, áudio → exportar. Fluxo parecido; **nada copiado** (§2). |
| Dá para editar vídeo no navegador do tablet? | **Sim.** O Chrome tem **WebCodecs** (decodificador e codificador de vídeo/áudio **do próprio aparelho, com aceleração de hardware**), **WebGL2** para compor os quadros e **Web Audio** para mixar. É o mesmo caminho dos editores web atuais. |
| O que limita no tablet do Johann? | O **TCL Tab A1 Plus** (Snapdragon 4 Gen 2) decodifica/codifica em hardware **até 1080p60**. Vídeo 4K abre, mas a edição usa **proxy** (cópia leve em 720p, §6.3) e a exportação fica em **até 1080p**. **Medido no V0: 2 vídeos 1080p ao mesmo tempo** em tempo real (transição, sobreposição), composição a 54 qps, exportação de 1 min em ≈ 1,4 min (§8). |
| Mídia fica onde? | **No cofre do WJPDM**, como todos os arquivos do WJProMaster (decisão do Johann, 06/11/2026): projetos, vídeos, fotos, áudios e exportações. Importar da galeria, do pendrive ou do Drive **copia para o cofre**. Para caber, vídeo/foto/áudio entra como **arquivo de mídia**: uma cópia só em cada lugar, sem pasta "(versões)" e sem duplicar no banco do aparelho (§7.2). |
| Formato de saída padrão | **MP4 (H.264 + AAC)**, que toca em tudo. Também WebM (VP9/AV1 + Opus), GIF, só áudio, quadro em PNG/JPEG (§9). |
| Dependência nova | **Uma**: `mediabunny` (MPL-2.0, sem dependências, TypeScript) para **ler e gravar contêineres** MP4/MOV/WebM/MKV/MP3/WAV. Codificar/decodificar é do navegador (WebCodecs): não vai codec no app (§10). |
| Onde fica no ecossistema | **Face separada e local** (como WJFlow e WJTaskPlan): não depende do servidor (G5). Integra com WJPDM (cofre), WJCAD/WJFlow (animações viram clipes) e WJApresentation (vídeo no slide) (§11). |

## 2. Inspiração sem cópia (regras do projeto aplicadas a vídeo)

- **Proibido na UI e no código**: o nome "Filmora" e nomes de produto/recurso da Wondershare
  (ex.: "Filmstock", nomes de pacotes de efeitos, "AI Copilot"), ícones, cores, telas, textos de ajuda,
  efeitos/modelos/títulos prontos deles, músicas e figurinhas do acervo deles, formato de projeto
  `.wfp` (proprietário: não abrir nem gravar) e engenharia reversa.
- **Também proibido na UI**: nomes de redes sociais/marcas nas predefinições de exportação
  ("YouTube", "Instagram", "TikTok", "WhatsApp"). As predefinições têm nomes genéricos: "Horizontal
  16:9 1080p", "Vertical 9:16 (vídeo curto)", "Quadrado 1:1", "Pequeno para mensagem". O
  **Compartilhar** do sistema (Web Share) leva o arquivo para qualquer app sem citar marca.
- **Permitido**: conceitos genéricos de edição (biblioteca, linha do tempo, pistas, aparar, dividir,
  pista magnética, quadros-chave, croma, LUT, transições, títulos, mixagem, *ducking*) e formatos
  abertos (MP4/ISO-BMFF, WebM/Matroska, MP3, WAV, FLAC, Ogg/Opus, PNG, JPEG, WebP, GIF, AVIF,
  SRT, WebVTT, LUT `.cube`).
- Efeitos, transições, títulos e elementos: **nossos** (shaders e SVG próprios), com nomes em
  português.
- Sem acervo de músicas/vídeos de terceiros embutido. Aviso de direitos autorais na exportação
  quando houver música importada (o usuário é responsável pelo que usa).

## 3. Casos de uso (para validar cada fase)

1. **Vídeo técnico de produto**: filmagens da peça/máquina + telas do WJCAD (animação girando) +
   títulos de cotas e setas + narração → MP4 1080p para cliente ou treinamento.
2. **Tutorial**: gravação de tela do computador + câmera no canto (sobreposição) + legendas SRT.
3. **Vídeo curto vertical (9:16)**: clipes do celular, cortes rápidos no ritmo da música (marcas de
   batida), textos animados, transições.
4. **Apresentação de fotos**: dezenas de fotos com zoom suave (pan & zoom), música com *fade*,
   duração por foto igual para todas.
5. **Registro de obra/fabricação**: vídeos do pendrive da câmera, acelerados (timelapse), com data
   e legenda, exportados pequenos para mandar por mensagem.

## 4. Fontes de mídia (pedido do Johann)

> **Decisão de 08/11/2026 (Johann):** "os documentos serão fornecidos pelo próprio dispositivo ou via
> WJPDM" — o editor **não analisa pastas**: importa pelo seletor de arquivos do aparelho (galeria,
> câmera, Downloads, pendrive) ou pelo explorador do cofre do WJPDM (o que está no Drive chega pelo
> WJPDM). Com isso o seletor do Google Drive (chave de API) deixou de ser necessário. A tabela abaixo
> é o levantamento original; o que vale na V1 está no §16.

| Fonte | Como entra | Abrir de novo depois | Limites |
|---|---|---|---|
| **Cofre do WJPDM** (lugar de todos os arquivos) | Biblioteca do projeto = explorador do cofre filtrado por mídia (pastas do WJPDM, padrão **Vídeos/Mídia**) | Pelo arquivo do cofre (URI `wj://pdm/...`): o editor lê o vídeo **direto da pasta do dispositivo** (cópia do cofre no tablet), por partes, sem carregar o arquivo inteiro | Pendrive e Drive recebem pela sincronia do cofre |
| **Galeria / câmera** (celular e tablet) | **Importar da galeria** (`<input accept="video/*,image/*" multiple>`) e **Gravar agora** (`capture`): **copia para o cofre** (pasta escolhida, padrão Vídeos/Mídia) | Já está no cofre | Tempo de cópia ≈ tamanho ÷ escrita da pasta do dispositivo (teste 2 do V0) |
| **Pendrive ou outra pasta fora do WJPDM** | **Importar arquivos** (`showOpenFilePicker`/`<input>`) ou **Importar pasta** (`showDirectoryPicker`): **copia para o cofre**, mantendo as subpastas | Já está no cofre | Vídeo que já está no WJPDM do pendrive não precisa importar: a sincronia traz para o tablet |
| **Google Drive** | **Importar do Drive** abre o **seletor do Google (Google Picker)**: escolher vídeos/fotos em todo o Meu Drive / Compartilhados comigo; o arquivo é **copiado para o cofre** (no Drive ele vai para Meu Drive/WJPDM/…) | Já está no cofre | Precisa de **chave de API do navegador** no projeto Google `wjpromaster` (pendente com o Johann). **Atenção:** com o escopo `drive.file`, um vídeo colocado à mão (pelo app do Drive) dentro de Meu Drive/WJPDM **não aparece** no cofre; é preciso usar "Importar do Drive" |
| **Cofre do WJPDM** | Explorador do cofre (mesmo de todos os apps): imagens, PDFs (1ª página como imagem ⏸), exportações de outras faces | Pelo URI `wj://pdm/...` | — |
| **Outras faces** | WJCAD: **Gravar animação da peça** (giro 360°, explosão de montagem ⏸) → clipe; WJFlow: animação do escoamento → clipe; WJApresentation: slides como imagens (§11) | Pelo URI | ⏸ depois da V2 |

**Por que o Google Picker e não ampliar o escopo do Drive:** o escopo atual (`drive.file`) só enxerga o
que o app criou. Ampliar para `drive.readonly` dá acesso a **todo** o Drive e é escopo "restrito" do
Google (exige verificação de segurança para sair do modo de teste). O Picker mantém o menor acesso:
o app só vê o arquivo que o usuário escolheu. Precisa de uma **chave de API do navegador** (pública,
restrita à origem `https://johann-sicherl.github.io` e só à Picker API) e do número do projeto — não é a
chave secreta. **Criar essa chave é acesso que a sessão não tem** (§14).

### 4.1 Formatos de entrada

Decodificar depende do aparelho (o V0 lista o que o aparelho do Johann aceita). Esperado no Chrome:

| Tipo | Contêiner | Codecs | Observação |
|---|---|---|---|
| Vídeo | MP4, MOV, M4V, WebM, MKV | **H.264** (todos), **H.265/HEVC** (Android e a maioria dos PCs com hardware; Windows às vezes não), VP8, VP9, AV1 (decodificação na maioria) | 10 bits/HDR: abre com conversão para SDR (mapa de tons simples); edição em HDR ⏸ |
| Áudio | MP3, M4A/AAC, WAV, FLAC, Ogg/Opus, WebM | AAC, MP3, Opus, Vorbis, FLAC, PCM | — |
| Imagem | JPEG, PNG, WebP, GIF (animado vira clipe), AVIF, SVG | — | **HEIC/HEIF (fotos de iPhone e de alguns Android) o Chrome não decodifica**: aviso claro com a dica de exportar como JPEG; decodificador próprio ⏸ |
| Legenda | SRT, WebVTT | — | — |
| LUT | `.cube` (1D/3D) | — | — |

Arquivo que o aparelho não decodifica: mensagem útil ("Este vídeo é H.265 e este computador não tem
o decodificador; converta para H.264 ou abra no tablet"), nunca falha silenciosa. Conversão com
`ffmpeg.wasm` como plano B foi **avaliada e descartada por ora** (§10).

## 5. Interface

Mesma casca das outras faces (`src/comum/casca.ts`): barra superior, faixa de comandos por abas,
painel de comando à esquerda com ✓/✕, barra de contexto ao selecionar, menu de contexto (botão
direito / toque longo 0,6 s), status embaixo, aba **Cofre** na lateral direita, desfazer por
fotografias, autosave, várias janelas, faixa "Cofre:" ao abrir.

### 5.1 Áreas (tablet e computador, paisagem)

```
┌ barra superior: logo · Arquivo · nome do projeto · ↶ ↷ · 💾 · Exportar ─────────────────┐
├ abas: Mídia · Editar · Texto · Áudio · Transições · Efeitos · Cor · Exportar ────────────┤
├ faixa de ícones da aba ativa ─────────────────────────────────────────────────────────────┤
│ Biblioteca / painel de    │            VISUALIZADOR (quadro do projeto)    │ Propriedades │
│ comando (esquerda,        │   ▶ ⏸ ⏮ ⏭  00:01:12;05 / 00:03:40  qualidade │ do clipe     │
│ recolhível)               │                                                │ (direita)    │
├───────────────────────────┴────────────────────────────────────────────────┴──────────────┤
│ LINHA DO TEMPO: régua · cursor · marcadores · pistas V3 V2 V1 (vídeo/foto/texto)          │
│                 A1 A2 (áudio) com forma de onda · zoom · ímã · dividir · excluir         │
├ status: resolução · fps · duração · uso do cache · aceleração de hardware ────────────────┤
```

- **Celular (retrato)**: visualizador em cima, linha do tempo embaixo, ferramentas numa **gaveta
  inferior** (padrão dos editores de celular); biblioteca em tela cheia ao tocar em "+".
  Projeto vertical 9:16 é o padrão no celular.
- **Tablet**: alvos ≥ 44 px; alças de aparar grandes; **lupa de precisão** ao aparar com o dedo;
  a caneta apara com precisão de quadro.
- **Computador**: botões compactos, atalhos completos (§5.4), arrastar e soltar da área de trabalho
  para a biblioteca, segundo monitor com o visualizador em tela cheia ⏸.

### 5.2 Abas e comandos

| Aba | Comandos | Fase |
|---|---|---|
| **Mídia** | Biblioteca = pastas de mídia do cofre; Importar para o cofre (galeria, arquivos, pasta/pendrive, Drive), Gravar (câmera, microfone, tela no computador), filtros (vídeo/foto/áudio/em uso), ordenar, Localizar no cofre, Criar proxy | V1 (gravar V3) |
| **Editar** | Dividir no cursor, Aparar início/fim até o cursor, Excluir, Excluir e fechar o vão, Duplicar, Congelar quadro, Separar áudio, Agrupar, Velocidade, Inverter, Cortar e ampliar (recorte), Girar/espelhar, Transformar (posição, escala, rotação, opacidade), Sobreposição (imagem sobre imagem), Tela dividida, Pan & zoom em foto, Estabilizar ⏸, Rastrear movimento ⏸ | V1–V2 |
| **Texto** | Título, Subtítulo/legenda, Rótulo inferior (nome/cargo), Créditos rolando, Texto com contorno/sombra/fundo, animação de entrada/saída, Legendas (importar/exportar SRT/VTT), Seta e cota (para vídeo técnico) | V2 (legendas V5) |
| **Áudio** | Volume, *fade* in/out, quadros-chave de volume, Normalizar (LUFS), Abafar música sob a voz (*ducking*), Equalizador, Redução de ruído simples, Mudo/solo da pista, Narração (gravar no cursor), Marcar batidas, Detectar silêncios | V3 |
| **Transições** | Dissolver, Pelo preto/branco, Deslizar, Empurrar, Cortina (linear, circular, diagonal), Ampliar, Desfocar, Girar; duração e alinhamento (no fim, centro, início do corte) | V2 |
| **Efeitos** | Desfoque (inteiro, área, fundo de vídeo vertical), Mosaico/pixelar (esconder placa/rosto, com área que segue quadros-chave), Nitidez, Vinheta, Granulado, Preto e branco, Sépia, Espelho, Croma (fundo verde/azul), Máscara (retângulo, elipse, desenho à mão com a caneta, invertida, suavizada), Modos de mesclagem | V4 |
| **Cor** | Correção básica (exposição, contraste, realces, sombras, branco/preto, saturação, vibração, temperatura, matiz), Curvas RGB, HSL por faixa de cor, **LUT `.cube`**, Copiar/colar cor entre clipes, Comparar antes/depois, Escopos (histograma, forma de onda) ⏸ | V4 |
| **Exportar** | Predefinições genéricas, resolução, fps, qualidade/taxa, faixa (tudo ou entre marcas), só áudio, GIF, quadro atual como imagem, salvar no cofre/pasta/pendrive/Drive, Compartilhar | V1 (GIF e extras V5) |

### 5.3 Linha do tempo (núcleo do app)

- **Pistas**: vídeo/imagem/texto em cima (a de cima cobre a de baixo), áudio embaixo. Sem número
  fixo; o app avisa quando o projeto pede mais decodificações simultâneas do que o aparelho aguenta
  (número medido no V0).
- **Pista principal magnética** (opcional, ligada por padrão): excluir ou encurtar um clipe fecha o
  vão; clipes das outras pistas ficam **presos** ao clipe principal em que começam e andam com ele.
- **Operações**: mover (arrastar), aparar pelas bordas, dividir (no cursor ou com a caneta sobre o
  clipe), *ripple* (aparar empurrando o resto), *roll* (mover o corte entre dois clipes), *slip*
  (trocar o trecho mostrado sem mudar a posição) — V2, deslizar, copiar/colar atributos.
- **Ímã** (encaixe) no cursor, nas bordas dos clipes, marcadores e batidas; tecla para desligar
  temporariamente.
- **Precisão de quadro**: todo tempo é **inteiro em microssegundos** (a unidade do WebCodecs) e as
  edições caem em fronteiras de quadro do projeto (fps racional: 24, 25, 29,97, 30, 50, 59,94, 60).
- **Quadros-chave** em qualquer propriedade numérica (posição, escala, rotação, opacidade, volume,
  intensidade de efeito, cor), com interpolação linear, suave (Bézier com alças) e degrau.
- **Marcadores** no projeto e no clipe (nome, cor, nota), navegar entre eles, exportar como capítulos
  do MP4 ⏸.
- **Miniaturas** ao longo do clipe e **forma de onda** do áudio, geradas em segundo plano (Worker) e
  guardadas no cache OPFS.
- **Zoom** da linha do tempo: pinça com 2 dedos, roda com Ctrl, `+`/`−`; rolar com 2 dedos ou roda.
- **Toque**: 1 dedo arrasta o clipe tocado / rola o fundo; 2 dedos pinça e rola; toque longo = menu.
  Caneta: apara/divide com precisão; dedo nunca move clipe por engano durante a rolagem (limiar de
  movimento, como na Montagem do WJCAD).

### 5.4 Atalhos (computador e teclado do tablet)

Comuns a todas as faces: Ctrl+Z/Y/S/C/V/X/F/P. Próprios desta face (propostos, padrão do mercado de
edição, não nome registrado):

| Tecla | Ação |
|---|---|
| Espaço | tocar/pausar |
| J / K / L | trás / pausa / frente (repetir acelera) |
| ← / → | um quadro; Shift: 1 s |
| ↑ / ↓ | corte anterior / próximo |
| Home / End | início / fim |
| I / O | marca de entrada / saída (exportar faixa) |
| Ctrl+B ou S | dividir no cursor |
| Q / W | aparar o início / o fim até o cursor |
| Delete / Shift+Delete | excluir / excluir e fechar o vão |
| M | marcador |
| N | ímã liga/desliga |
| `+` / `−` | zoom da linha do tempo |
| Ctrl+E | exportar |

## 6. Motor (arquitetura)

### 6.1 Peças

| Parte | Onde roda | Tecnologia |
|---|---|---|
| Modelo do projeto e operações da linha do tempo (dividir, aparar, *ripple*, ímã, quadros-chave, "o que está na tela no tempo t") | thread da UI, **puro e testado em Node** (`src/video/linha.ts`, `tempo.ts`) | TypeScript |
| Leitura de contêiner e amostras | Worker | `mediabunny` (`BlobSource` para arquivo/pasta/pendrive/OPFS; `UrlSource` com cabeçalho de acesso para o Drive) |
| Decodificação | Worker | WebCodecs `VideoDecoder`/`AudioDecoder` (hardware); `ImageDecoder` para fotos e GIF |
| Composição dos quadros (pistas, transformações, transições, efeitos, cor, texto) | Worker com `OffscreenCanvas` | **WebGL2** (shaders próprios); `VideoFrame` vai direto para textura, sem cópia na CPU. WebGPU ⏸ (o WebGL2 é mais garantido nos Android de entrada) |
| Texto | Worker | Canvas 2D → textura (fontes do sistema + poucas fontes livres OFL embutidas) |
| Áudio no visualizador | thread de áudio | Web Audio (`AudioWorklet` com o mixador) sincronizado ao relógio de áudio |
| Áudio na exportação | Worker | mixador puro (mesmo código) gerando PCM → `AudioEncoder` |
| Exportação | Worker | composição quadro a quadro → `VideoEncoder` (hardware) → `mediabunny` grava MP4/WebM direto no arquivo de destino (`FileSystemWritableFileStream`) ou no OPFS |
| Miniaturas, forma de onda, proxies, detecção de cenas/silêncios/batidas | Worker de fundo, baixa prioridade | WebCodecs + funções puras testadas |

Regra do projeto mantida: **nada pesado na thread da UI**; o visualizador recebe o quadro pronto
(`ImageBitmap`/`VideoFrame` transferido) e só desenha.

### 6.2 Reprodução em tempo real

- Pré-busca: o Worker decodifica à frente do cursor (fila pequena; **todo `VideoFrame` é fechado
  logo após o uso** — vazamento de quadro trava o decodificador no Android).
- **Qualidade do visualizador**: Automática / Completa / Metade / Um quarto. Na automática, se o
  aparelho não acompanha, baixa a resolução da prévia e, por último, pula quadros (o áudio nunca
  engasga).
- **Pré-renderizar trecho** (barra colorida sobre a régua: verde = pronto, amarelo = pode engasgar,
  vermelho = pesado): trechos com muitos efeitos podem ser renderizados para o cache e tocados lisos.
- Busca (arrastar o cursor): mostra o quadro-chave mais próximo na hora e o quadro exato logo depois.

### 6.3 Proxies e cache

- **Proxy**: cópia em 720p (ou 540p no celular) H.264 com quadros-chave frequentes, criada em
  segundo plano para vídeos acima do que o aparelho edita liso (4K, HEVC 10 bits, taxa muito alta).
  A edição usa o proxy; **a exportação sempre usa o original**. Liga/desliga por projeto.
- Cache descartável no **OPFS** (`wjvideo/cache/<impressão digital>/`): proxies, miniaturas, formas de
  onda e trechos pré-renderizados (os originais ficam só no cofre). Tela "Cache" com tamanho por
  projeto e **Limpar**. Pedir armazenamento persistente (`navigator.storage.persist`).

### 6.4 Exportação

- Composição no mesmo motor do visualizador, mas **sem pular quadros** e na resolução final.
- Progresso com tempo restante real; **mantém a tela ligada** (Wake Lock) e avisa que o Android pode
  pausar a exportação se o app for para segundo plano; **retomar** de onde parou ⏸.
- Destino: **o cofre** (padrão "Vídeos/Exportados", como arquivo de mídia, sem versões), gravado
  direto na pasta do dispositivo enquanto exporta; depois a sincronia leva ao pendrive e ao Drive.
  **Compartilhar** (enviar para outros apps) continua disponível.

## 7. Projeto `.wjvid` e o cofre

### 7.1 Formato

JSON versionado (como os demais), pequeno — a mídia não vai dentro:

```
{ versao, nome,
  config: { largura, altura, fps: [num, den], amostragemAudio, corFundo },
  midias: [ { id, nome, tipo, arquivo: "<id do arquivo no cofre>", digital: { tamanho, duracaoUs, hashInicioFim },
             largura, altura, fps, temAudio } ],
  pistas: [ { id, tipo: "video"|"audio", nome, mudo, travada, oculta } ],
  clipes: [ { id, pista, midia?, inicioUs, duracaoUs, entradaUs, velocidade, preso?,
             transformar, efeitos: [], cor, audio, texto?, chaves: { <prop>: [[tUs, valor, curva]] } } ],
  transicoes: [ { entre: [clipeA, clipeB], tipo, duracaoUs, alinhamento } ],
  marcadores: [], legendas: [] }
```

- Autosave contínuo (IndexedDB `wjvideo`, por janela como nas outras faces) e desfazer por
  fotografias (leve, porque o JSON é pequeno).
- **Impressão digital** (tamanho + duração + hash do primeiro e do último MB): reencontra a mídia se
  ela mudar de lugar, e recusa trocar por outro arquivo com o mesmo nome.

### 7.2 Cofre — tudo no WJPDM (decisão do Johann, 06/11/2026)

- Pasta da face **"Vídeos"** no cofre: projetos `.wjvid` (fluxo de sempre: primeiro salvar abre o
  explorador e publica a versão 1; GO-OUT/GO-IN), **Vídeos/Mídia** (originais importados) e
  **Vídeos/Exportados** (vídeos prontos). O usuário pode criar outras pastas.
- O `.wjvid` guarda o **id do arquivo do cofre** de cada mídia; a tabela de referências do WJPDM
  registra "projeto usa mídia" (**Usado em**: excluir um vídeo usado por um projeto avisa).

**Por que "arquivo de mídia" (mudança no cofre, primeira parte da V1).** Hoje cada arquivo do cofre
fica no banco do aparelho (IndexedDB), na pasta do dispositivo duas vezes (`.wjpdm/blobs/` e o
arquivo visível) e mais uma vez em "(versões)"; o mesmo no pendrive e no Drive. Para um documento
de 50 kB isso não importa; um vídeo de 1 GB ocuparia ≈ 4 GB no tablet e de novo no pendrive e no
Drive, e o banco do navegador tem só ≈ 10 GB. O arquivo de mídia muda isso:

| Item | Documento (como hoje) | Arquivo de mídia (vídeo, foto, áudio, exportação) |
|---|---|---|
| Banco do aparelho (IndexedDB) | conteúdo + registro | **só o registro** (nome, pasta, tamanho, impressão digital, duração) |
| Pasta do dispositivo / pendrive | `.wjpdm/blobs/` + arquivo visível + "(versões)" | **só o arquivo visível** (o conteúdo é ele mesmo) |
| Google Drive | idem, envio em uma requisição | **só o arquivo**, envio **retomável** em partes de 8 MB (o envio atual em uma requisição é para até 5 MB) |
| Versões | uma por GO-IN | **sem versões** (vídeo não se edita no lugar; o projeto `.wjvid` é que tem versões) |
| GO-OUT/GO-IN | sim | não (entra publicado; excluir vai para a lixeira, 30 dias) |
| Sincronia | a mais recente vence | igual; conferência por tamanho + impressão digital (não relê GB à toa) |

- **Sem pasta do dispositivo configurada** (ex.: computador sem cópia em pasta): a mídia fica no
  OPFS do app, com aviso de espaço.
- **Drive**: o espaço gratuito é 15 GB; a faixa "Cofre:" avisa quando o Drive estiver perto do fim.
  Opção por cópia "levar vídeos ao Drive" (ligada por padrão, pode ser desligada para economizar).
- **Pendrive**: vídeos copiam na primeira sincronia com progresso (MB/s medido no teste 2 do V0).

### 7.3 Mídia offline

Ao abrir o projeto, cada mídia é procurada no cofre: pasta do dispositivo → pendrive → Drive (baixa
para a pasta do dispositivo). Não achou (arquivo ainda não sincronizado ou excluído): o clipe fica com
faixa "mídia offline" e a biblioteca mostra **Localizar no cofre…** (a impressão digital confere). O projeto abre e edita normalmente; só a exportação exige tudo presente.

## 8. Requisitos não funcionais (metas, conferidas no V0 no TCL Tab A1 Plus)

**Medições do V0 no TCL Tab A1 Plus (05/11/2026, Chrome 156, Adreno 613, 8 núcleos, ≈ 4 GB informados
pelo navegador, 10,2 GB de espaço para o app, armazenamento persistente):**

| Item | Resultado |
|---|---|
| Hardware de vídeo | H.264 e H.265 8 bits **abrem e exportam por hardware até 1080p**; VP9 abre por hardware até 1080p; **4K só por software** (H.264/VP9/AV1); **H.265 10 bits (HDR) não abre** |
| Áudio | AAC, Opus, MP3, FLAC e PCM abrem; **AAC e Opus exportam** |
| Imagens | JPEG, PNG, WebP, GIF, AVIF; **HEIC não** |
| Decodificar 1080p (qps de cada vídeo) | 1 → 103 · **2 → 76** · 3 → 35 · 4 → 32 (tempo real = 36) |
| Decodificar 720p | 1 → 199 · 2 → 107 · 3 → 100 · 4 → 76 |
| Decodificar 4K (amostra sintética leve, por software) | 1 → 101 · 2 → 65; **não vale para vídeo de câmera** (taxa muito maior) |
| Composição WebGL2 no Worker, 1080p (2 vídeos + cor + título) | **54 qps** |
| Exportação 1080p H.264, 10 s | 1 vídeo **22 qps** (1 min em ≈ 1,4 min) · 2 vídeos 20 qps (≈ 1,5 min) |
| Cache OPFS, 64 MB | escrita 161 MB/s · leitura 1 808 MB/s |
| Pasta do WJPDM (dispositivo/pendrive) | a medir: o teste 2 agora lê as cópias do cofre e mede escrita (64 MB temporários) e leitura do maior vídeo |

**Limites adotados para a V1 (tirados daí):**
- Prévia em **qualidade completa** (1080p) com até **2 vídeos ao mesmo tempo**; a partir do 3º vídeo
  sobreposto, a prévia daquele trecho cai para metade da resolução (ou pré-renderizar o trecho).
- Vídeo **4K** entra com **proxy** em 720p/1080p (criado em segundo plano); exportação **até 1080p**.
- H.265 10 bits (HDR): mensagem clara ao importar ("grave sem HDR ou converta").
- Exportação padrão **MP4 (H.264 + AAC)** por hardware: ≈ 1,4 min por minuto de vídeo.
- Correção feita com esses números: o resumo só dispensa o proxy se o 4K decodificar **por hardware**
  (a amostra sintética 4K é leve demais para representar vídeo de câmera).

| Item | Meta |
|---|---|
| Abrir o app (sem projeto) | < 2 s; o motor de vídeo só carrega ao abrir/criar projeto |
| Tamanho baixado da página | < 400 kB comprimido além da casca (sem `ffmpeg.wasm`, sem framework) |
| Interação na linha do tempo (arrastar, aparar, zoom) | 60 qps com 200 clipes |
| Reprodução 1080p30, 1 pista de vídeo + títulos | tempo real, qualidade completa |
| Transição/sobreposição 1080p (2 vídeos) | tempo real em metade da resolução |
| Exportar 1 min de 1080p30 simples | ≤ 2 min no tablet (medir); ≤ tempo real no computador |
| Memória | sem crescer durante reprodução longa (quadros fechados, cache com limite) |
| Offline | tudo funciona sem internet, exceto Drive e Picker |
| Falhas | erro de decodificação de um clipe não derruba o projeto: o clipe fica marcado e o resto toca |

## 9. Exportação — formatos e predefinições

| Predefinição (nome genérico) | Contêiner | Vídeo | Áudio |
|---|---|---|---|
| Horizontal 16:9 1080p (padrão) | MP4 | H.264, 1920×1080, fps do projeto, ~12 Mbit/s | AAC 192 kbit/s |
| Horizontal 16:9 4K (só computador/aparelho que codifica 4K) | MP4 | H.264 ou H.265 | AAC |
| Vertical 9:16 (vídeo curto) | MP4 | H.264 1080×1920 | AAC |
| Quadrado 1:1 / Retrato 4:5 | MP4 | H.264 | AAC |
| Pequeno para mensagem | MP4 | H.264 720p, taxa calculada para caber no tamanho alvo (ex.: 16 MB) | AAC 96 kbit/s |
| Web aberto | WebM | VP9 ou AV1 | Opus |
| Animação curta | GIF | paleta otimizada, até 480 px | — |
| Só áudio | M4A (AAC) / WAV / Opus | — | — |
| Quadro atual | PNG / JPEG | — | — |

- Se o aparelho não tiver codificador **AAC** (alguns Linux), o app avisa e oferece Opus em MP4 ou
  WebM. O V0 lista os codificadores do aparelho.
- Taxa: constante ou "qualidade" (variável); quadro-chave a cada 2 s; legendas embutidas no MP4 ⏸ ou
  queimadas no vídeo; capítulos a partir dos marcadores ⏸.

## 10. Dependências e alternativas avaliadas

| Opção | Decisão | Motivo |
|---|---|---|
| **WebCodecs** (navegador) | ✅ usar | aceleração de hardware, sem baixar codec, licença dos codecs coberta pelo sistema/navegador |
| **mediabunny** (MPL-2.0, projeto conhecido, TS, zero dependências, *tree-shaking*) | ✅ proposta (única dependência nova) | lê e grava MP4/MOV/WebM/MKV/MP3/WAV/Ogg com acesso por partes (não carrega o vídeo inteiro na memória); escrever um demuxador/muxador próprio seria semanas de trabalho com muitos casos de borda (MOV de celular, edit lists, rotação). Revisar `pnpm-lock.yaml` e respeitar os 3 dias de `minimumReleaseAge` |
| mp4box.js + mp4-muxer + webm-muxer | ✕ | três bibliotecas para o que a mediabunny faz sozinha (é a sucessora das duas últimas, do mesmo autor) |
| ffmpeg.wasm | ✕ por ora (⏸ plano B para formatos exóticos) | ~25–30 MB, sem aceleração de hardware (10–50× mais lento), multithread exige COOP/COEP (que quebra o login do Google) e a licença depende do build (LGPL/GPL) |
| Editores/frameworks web prontos (com licença comercial ou de outro produto) | ✕ | licença, peso, e a interface tem de ser a nossa |
| Fontes | ✅ fontes do sistema + 3–5 fontes livres (OFL) embutidas sob demanda | sem baixar fontes da internet em tempo de uso |
| IA local (recorte de fundo, legenda automática) | ⏸ | modelos de dezenas de MB; avaliar depois (V6), opcional e com download sob demanda |

## 11. Integrações

| Com | O quê | Fase |
|---|---|---|
| **WJPDM** | projeto `.wjvid` no cofre; exportação no cofre; mídia de imagens do cofre; "Usado em" (o vídeo usa a revisão B da peça) | V1 |
| **WJCAD** | menu Arquivo → **Gravar animação** (giro 360° da peça na vista atual, duração e fundo escolhidos) gera um clipe e abre no WJVideoMaker; atalho de navegação, o WJCAD não ganha comandos de vídeo | V5 |
| **WJFlow** | animação do corte do escoamento (velocidade/pressão) como clipe | V5 |
| **WJApresentation** | inserir vídeo exportado no slide (com corte de início/fim no slide) | V5 |
| **WJWrite** | quadro do vídeo como figura; link para o vídeo no cofre | ⏸ |
| **WJTaskPlan** | — | — |

## 12. Roteiro do WJVideoMaker

| Fase | Entrega | Critério de pronto |
|---|---|---|
| **V0** ✅ | **Teste do aparelho** (`video/aparelho/`, como o do WJFlow): lista codecs de decodificação e codificação com aceleração (H.264/HEVC/VP9/AV1/AAC/Opus) e resoluções aceitas; mede decodificação simultânea (1, 2, 3 vídeos 1080p), composição WebGL2 e exportação de 10 s; espaço do OPFS; seletores de pasta/pendrive | ✅ números do TCL anotados (§8) e limites da V1 definidos |
| **V1** ✅ | **Editor** (08/11/2026, foco pedido pelo Johann: "apenas um editor de vídeo, como corte, redução de tempo, aceleração e redução de vídeo, anexar vídeo com imagem, colocar texto sobre imagens e vídeos"): página `video/`; importar do aparelho e do WJPDM; pista principal magnética de vídeos e fotos + pista de textos; dividir, aparar (pelo cursor ou arrastando a alça), excluir fechando o vão, mover, duplicar; velocidade 0,1×–10× e "duração na linha do tempo" (reduz o tempo sem cortar); duração da foto; volume/mudo; texto sobre a imagem (arrastar no vídeo, posição, tamanho, cor, faixa, negrito); formato 16:9/9:16/1:1/4:5; exportar MP4 (resolução, qualidade ou tamanho máximo em MB) para o aparelho, Compartilhar ou o WJPDM; `.wjvid` no cofre; desfazer/refazer, autosave | roteiro de navegador no tablet: importar, dividir, 2×, aparar com o dedo, texto, desfazer, exportar e conferir duração, imagem e som do MP4 ✅ |
| **V2** | **Montagem completa**: pistas ilimitadas, transformar (posição/escala/rotação/opacidade), recorte, girar/espelhar, sobreposição e tela dividida, pan & zoom em foto, **quadros-chave**, velocidade (constante, inverter, congelar), **títulos** e rótulos com animação, **transições**, marcadores, *roll*/*slip*, agrupar, copiar atributos | caso 1 (vídeo técnico) e caso 3 sem áudio avançado |
| **V3** | **Áudio**: várias pistas, forma de onda, quadros-chave de volume, normalizar (LUFS), *ducking*, equalizador, redução de ruído simples, **gravar narração**, detectar silêncios (cortar automaticamente), marcar batidas | caso 3 completo (cortes no ritmo) |
| **V4** | **Cor e efeitos**: correção básica, curvas, HSL, **LUT `.cube`**, croma, máscaras (inclusive desenhadas com a caneta), desfoque/mosaico de área com quadros-chave, vinheta, modos de mesclagem, antes/depois | croma e LUT conferidos com imagem de referência |
| **V5** | **Acabamento**: proxies automáticos, pré-renderizar trecho, legendas SRT/VTT (importar, editar, exportar, queimar), GIF, só áudio, quadro como imagem, WebM, "pequeno para mensagem", detecção de cenas, empacotar projeto, integrações WJCAD/WJFlow/WJApresentation, gravação de tela (computador) | caso 2 (tutorial com legendas) |
| **V6** ⏸ | **Avançado** (decidir com o Johann): estabilização, rastreamento de movimento (texto/mosaico seguindo um objeto), recorte de fundo sem croma (IA local), legenda automática por fala (servidor G5 ou modelo local), reenquadrar automático 16:9 → 9:16, modelos de projeto, escopos de cor, HDR, rampas de velocidade, retomar exportação | — |

Cada fase é entregue utilizável no tablet, testada simulando o tablet (1280×800, toque, perfil
Tablet) e publicada na hora (regras 6, 7 e 9).

## 13. Testes

- **Node** (`scripts/teste-video.ts`, entra no `pnpm teste`): aritmética de tempo em µs e quadros
  (24/25/29,97/30/60), dividir/aparar/*ripple*/*roll*/*slip*, pista magnética e clipes presos, ímã,
  interpolação de quadros-chave, "camadas visíveis no tempo t" com transições, mixador de áudio
  (ganho, *fade*, *ducking*), normalização LUFS, detecção de silêncio e de batidas em sinais
  sintéticos, cálculo de taxa para tamanho alvo, leitura/gravação de SRT/VTT e `.cube`, validação e
  migração do `.wjvid`.
- **Navegador** (Playwright, perfil Tablet): importar vídeos de teste **gerados pelo próprio teste**
  (sem arquivo de terceiros no repositório), editar, exportar MP4 curto e conferir duração, resolução
  e alguns quadros por cor; mídia offline → Localizar.
- O Chromium do Playwright no Linux não tem codificador H.264/AAC: os testes de exportação usam
  VP9/Opus ali e a exportação MP4 é conferida no tablet (V0 e cada entrega).

## 14. Decisões (05/11/2026: "seguir as recomendações")

1. ~~Mídia fora do cofre~~ → **trocado pelo Johann em 06/11/2026: "use a mesma pasta do WJPDM,
   centralize todos os arquivos lá"**. Tudo no cofre, com o arquivo de mídia do §7.2.
2. ~~Seletor do Google Drive com chave de API~~ → **dispensado em 08/11/2026** (a mídia vem do aparelho
   ou do WJPDM, que já traz o que está no Drive). Texto original: seletor do Google Drive com **chave de API do navegador**: falta o Johann criar a chave (Google
   Cloud, projeto `wjpromaster` → APIs e serviços → ativar "Google Picker API" → Credenciais → Criar
   credencial → Chave de API → restringir a sites `https://johann-sicherl.github.io/*` e à Picker API) e
   mandar a chave (ela é pública, vai no código). Até lá, a V1 sai com pasta, pendrive e galeria.
3. Uso principal: sem preferência; fica a ordem do roteiro (V2 montagem → V3 áudio → V4 cor).
4. **1080p** no tablet; 4K só no computador (ajustado pelas medições do V0).
5. Exportação no cofre **sem versões**.
6. Extensão **`.wjvid`** e pasta **"Vídeos"** no cofre.

Texto original das perguntas (para referência):

1. **Mídia no cofre?** Recomendação: **não** (vínculos + cache no aparelho + "Empacotar projeto"
   quando quiser levar tudo). Alternativa: pasta "Vídeos/Mídia" no cofre **sem versões**, copiada só
   para a pasta do dispositivo e o pendrive (não para o Drive).
2. **Chave de API para o seletor do Google Drive**: criar no projeto Google `wjpromaster` uma chave de
   API do navegador, restrita a `https://johann-sicherl.github.io` e à Picker API (passo a passo vai
   no PR da V1). Sem ela, a V1 sai com pasta, pendrive e galeria, e o Drive entra quando a chave
   existir.
3. **Uso principal** (define a ordem de V2–V4): vídeo técnico de produto/treinamento, vídeo curto
   vertical, ou fotos/registro de obra?
4. **Resolução máxima**: no tablet, **1080p** é o teto do hardware; 4K fica só no computador. Ok?
5. **Exportação no cofre com versões ou sem?** Recomendação: sem (o vídeo é refeito a partir do
   projeto, que é versionado).
6. **Extensão `.wjvid`** e pasta da face **"Vídeos"** no cofre: ok?

## 15. Nome

**WJVideoMaker**, definido pelo Johann em 05/11/2026. "Video" e "Maker" são palavras genéricas, mas
"Movie Maker" é marca da Microsoft e há apps com "Video Maker" no nome: fazer a busca no INPI antes
de registrar (README §6). Na UI nunca aparece o nome do software de referência.

## 16. Estado (08/11/2026)

- Especificação e levantamento de requisitos: este documento; decisões no §14.
- **V0 ✅** — página `video/aparelho/` (caixa **WJVideoMaker → "Teste do aparelho"** no início):
  - Formatos: tabela de vídeo (H.264, H.265, H.265 10 bits, VP9, VP9 10 bits, AV1, VP8 × 720p/1080p/4K,
    abre/exporta, hardware ou software), áudio (AAC, Opus, MP3, FLAC, PCM) e imagens (inclusive HEIC).
  - Medição no Worker (`src/video/aparelho-worker.ts`), sem dependência nova: gera amostra sintética
    com o codificador do aparelho; decodifica 1–4 vídeos ao mesmo tempo; composição WebGL2 em
    OffscreenCanvas (2 vídeos + cor + título); exportação de 10 s com 1 e 2 vídeos; cache OPFS.
  - Teste 2 (06/11/2026): lê as cópias do cofre (pasta do dispositivo e pendrive, `WJPDM/` sem
    `.wjpdm` e "(versões)"), lista a mídia, mede escrita de 64 MB (arquivo temporário apagado) e a
    leitura contínua e com saltos do maior vídeo.
    Galeria: cada arquivo abre ou não (HEIC com aviso).
  - Resumo com recomendações (`recomendar` em `src/video/capacidade.ts`): vídeos simultâneos, proxy,
    qualidade da prévia, resolução e formato de exportação, minutos por minuto exportado.
  - Funções puras em `src/video/tempo.ts` (µs ↔ quadros, fps racional, código de tempo) e
    `capacidade.ts`, testadas em `scripts/teste-video.ts` (no `pnpm teste`).
- Números do TCL medidos e limites da V1 definidos (§8).
- **V1 ✅ (08/11/2026) — editor** (`video/`, caixa WJVideoMaker → Abrir no início):
  - **Importar**: "Do aparelho" (seletor de arquivos: galeria, câmera, Downloads, pendrive) e "Do
    WJPDM" (explorador do cofre, `lerBlobDoCofre`). Cada mídia é lida pela `mediabunny` (duração,
    tamanho do quadro já girado, se tem som, se o aparelho decodifica; HEIC e H.265 10 bits com
    mensagem clara) e uma cópia fica no armazenamento do app (OPFS `wjvideo/midia/<id>`, `midias.ts`)
    para o projeto reabrir. Mídia ausente neste aparelho (projeto aberto em outro): marca "Fora deste
    aparelho · Localizar…".
  - **Linha do tempo** (`main.ts`): pista principal magnética (vídeos e fotos em sequência, sem vão) +
    pista de textos; régua com zoom (−/+, Ctrl+roda, pinça com dois dedos, "mostrar tudo"); toque na
    régua busca; toque no bloco seleciona; arrastar o bloco **reordena** (marca laranja de inserção);
    **alças** nas pontas **aparam** (vídeo: trecho da mídia; foto/texto: duração); toque longo ou botão
    direito abre o menu (dividir, aparar, velocidades, duplicar, excluir).
  - **Comandos** (faixa Editar/Texto/Exportar e atalhos): Dividir (S ou Ctrl+B), Aparar início (Q) / fim
    (W) pelo cursor, Velocidade (0,25×…8×, ou qualquer valor 0,1×–10× no painel), Som, Mover antes/depois,
    Duplicar, Excluir (Delete), Adicionar texto (T), Espaço toca, ←/→ um quadro, Home/End, Ctrl+Z/Y.
  - **Painel à direita**: clipe (começa/termina no vídeo, velocidade, **duração na linha do tempo** —
    mudar ajusta a velocidade, volume 0–200 %), foto (duração), texto (conteúdo, tempo, posição,
    tamanho, cor, negrito, faixa e cor da faixa), projeto (formato, quadros por segundo, duração).
  - **Prévia** (`previa.ts`): `<video>` do navegador por mídia (hardware), velocidade pelo
    `playbackRate`, clipes seguidos da mesma mídia sem pausa; texto arrastável no vídeo.
  - **Exportar** (`exportar-worker.ts`, Worker): MP4 H.264 (H.265/VP9/AV1 se faltar) + AAC (Opus se
    faltar); resolução 1080/720/480/360 no lado menor; qualidade alta/boa/econômica ou **tamanho máximo
    em MB** (taxa calculada); estimativa do tamanho antes; progresso com tempo restante, tela acesa,
    cancelar. Quadros pela `CanvasSink` (rotação do celular aplicada) + textos (mesmo `desenho.ts` da
    prévia); áudio contínuo convertido para 48 kHz estéreo com a velocidade do clipe pelo reamostrador
    próprio (`audio.ts`; o tom acompanha a velocidade), silêncio nas fotos e clipes mudos. Arquivo
    gravado aos poucos no OPFS (nome interno sem acento). Pronto: **Salvar no WJPDM…** (explorador do
    cofre; reexportar com o mesmo nome **substitui**, sem acumular versões — `exportarComo(..., { semVersoes })`),
    **Baixar no aparelho** ou **Compartilhar**.
  - **Projeto** `.wjvid` no cofre (pasta da face "Vídeos", app `video` no `cofre.ts`), autosave
    `wjvid:documento`, desfazer por fotografias. Celular começa em 9:16.
  - **Testes**: `scripts/teste-video.ts` (119 verificações: cortes, aparar, velocidade, reduzir tempo,
    mover, textos, plano de quadros, tamanho/taxa, arquivo, reamostrador) e roteiro de navegador no
    tablet (importar MP4 + foto gerados no próprio teste, dividir, 2×, aparar com o dedo, texto,
    desfazer, exportar e conferir o MP4: duração, quadro, texto, foto, 440 Hz/880 Hz/silêncio), mouse
    no computador (reordenar, aparar, menu, Ctrl+roda), celular (sem rolagem lateral), salvar e
    reabrir pelo cofre, exportar no WJPDM duas vezes (substitui).
  - Dependência nova: **`mediabunny` 1.65.2** (MPL-2.0, sem dependências além de tipos), só no editor
    (importação e Worker de exportação), conforme o §10.
- Limites da V1 (para as próximas fases): áudio acelerado muda o tom (manter o tom = V3); uma pista de
  vídeo (sobreposição/tela dividida = V2); sem transições, música separada nem efeitos de cor (V2–V4);
  a mídia fica no armazenamento do app de cada aparelho (no outro aparelho: "Localizar…"; levar a mídia
  junto pelo cofre = "arquivo de mídia", §7.2).
