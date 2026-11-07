# WJCAD dentro do WJProMaster

O WJCAD é o antigo JLSCAD (arquivos `.wjcad`; abre `.jlscad` e `.cadt`). A especificação funcional completa do CAD continua em `docs/funcional/`:
- [features](../funcional/features.md)
- [sketch](../funcional/sketch.md)
- [chapa](../funcional/chapa.md)
- [avaliar](../funcional/avaliar.md)
- [referência do guia](../funcional/referencia-introducao.md)

Aqui fica só o que o CAD precisa **expor ou receber** para fazer parte do ecossistema.

## 1. Migração para o monorepo (G0)
- `src/` atual → `apps/cad/src/`. Núcleo de UI comum (abas, painel ✓/✕, árvore, menus, barra de
  status, perfis de dispositivo, gaveta, lupa) extraído para `packages/nucleo`. Ícones vão para
  `packages/icones`.
- O kernel (replicad/OpenCascade) continua só no CAD, carregado sob demanda. As outras faces nunca
  o baixam.
- Testes atuais (`teste-kernel`, `teste-esboco`, `teste-recursos`) continuam passando sem mudança
  de comportamento.

## 2. O que o CAD expõe (G1/G5)
- **Propriedades da peça** (janela Arquivo → Propriedades): padrão e personalizadas.
  - Padrão: código, descrição, material, massa, volume, área, caixa delimitadora.
  - Personalizadas: valores ou fórmulas como `=Massa*1,1`.
  - Por configuração.
- **Objetos endereçáveis** `wj://cad/<arquivo>/…`: propriedade, cota (`D1@Esboço1`), parâmetro de
  recurso, configuração, vista salva, planificado, lista de corte.
- **Funções para o motor comum**: `WJ.CAD(arquivo; nome)`.
- **Exportações de liberação** (chamadas pelo PDM, em Worker, sem UI):
  - STEP, STL;
  - DXF do planificado;
  - PDF/PNG de vistas;
  - malha leve (glTF) para o visualizador 3D.
- **Cotas de inspeção** (G7+): marcar cota como característica crítica, com tolerância. Alimenta o
  plano de inspeção do ERP.

## 3. O que o CAD recebe
- Material com densidade e custo do cadastro do ERP. A lista de materiais atual vira o fallback offline.
- Itens comprados (parafusos, perfis, componentes) para inserir quando houver montagens ⏸.
- Valores de células da Planilha para variáveis globais e tabela de configurações.
- Estado do WJPDM (o diretório do WJCAD, ver [pdm.md](pdm.md)): estado/revisão no título, travado quando liberado, check-out/check-in pelo menu
  Arquivo.

## 4. Pendências do CAD que entram na G1
- Chapa: (canto automático, itens da árvore e dobra esboçada, junta e meia-esquadria ✅)
  cantos, desdobrar/dobrar, converter em chapa.
- Fase 5: propriedades de seção.
- Fase 3: filete variável/de face, furo avançado.

## 5. Imagem → modelo 3D (pedido do Johann em 07/11/2026) — ⏸ fase G5

- **O que é:** aba nova no WJCAD (muda a regra das "só quatro áreas de comando" quando for feita) para
  gerar um modelo 3D a partir de **até 8 imagens das vistas** (frente, trás, esquerda, direita, cima,
  baixo, frente-esquerda, frente-direita), com escolha da **quantidade de faces: 1,5 M, 1 M, 500 mil e
  50 mil**. O resultado entra como **corpo de malha** (o mesmo caminho do STL grande: mede, simplifica,
  vira sólido editável quando couber).
- **Referência funcional:** o gerador de 3D por imagens da Tencent (Hunyuan3D). Fatos levantados em
  07/11/2026: pesos abertos só até a versão **2.1** (licença Tencent Hunyuan **não comercial**; o 2.x
  aceita até 4 vistas); as **8 vistas** e a faixa de **40 mil a 1,5 M faces** são do **3.x**, só como
  serviço pago por API. Precisa de placa de vídeo NVIDIA (6–24 GB): **não roda no tablet nem no
  navegador**, e o Johann **não tem NVIDIA** no computador.
- **Decisão (07/11/2026):** deixar para a **G5**, junto com o servidor do WJProMaster. Caminho previsto:
  serviço por API com a chave guardada no servidor (nunca no app); o app envia as imagens e recebe a
  malha (GLB/OBJ/STL), reduzida à quantidade de faces escolhida. Revisar a licença/termos do serviço e
  o custo por geração antes de implementar.
