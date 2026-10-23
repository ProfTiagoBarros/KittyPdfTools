/**
 * Idioma de referencia do projeto.
 *
 * Este arquivo e a FONTE DA VERDADE das chaves: o tipo `MessageKey` deriva dele, portanto
 * qualquer outro idioma que esqueca uma chave quebra o build (ver `messages/en.ts`).
 */
export const ptBR = {
  'app.name': 'PDFKitty',
  'app.tagline': 'Seus PDFs nunca saem do seu computador.',

  'locale.label': 'Idioma',

  'nav.home': 'Inicio',
  'nav.tools': 'Ferramentas',

  'tool.merge.name': 'Unir',
  'tool.merge.description': 'Combine varios PDFs em um unico documento.',
  'tool.split.name': 'Dividir',
  'tool.split.description': 'Quebre um documento em varios arquivos, por faixa ou por tamanho.',
  'tool.extract.name': 'Extrair',
  'tool.extract.description': 'Recorte as paginas escolhidas para um unico arquivo.',
  'tool.compress.name': 'Compactar',
  'tool.compress.description': 'Reduza o tamanho do arquivo, com ou sem perda de qualidade.',
  'tool.ocr.name': 'OCR',
  'tool.ocr.description': 'Reconheca texto em PDFs digitalizados, localmente.',
  'tool.sign.name': 'Assinar',
  'tool.sign.description': 'Assine com certificado ICP-Brasil A1, sem enviar sua chave.',
  'tool.redact.name': 'Ofuscar',
  'tool.redact.description': 'Remova trechos sensiveis de forma irreversivel.',

  'workspace.dropzone.title': 'Arraste PDFs aqui',
  'workspace.dropzone.hint': 'Os arquivos ficam no seu computador. Nada e enviado.',
  'workspace.dropzone.button': 'Escolher arquivos',
  'workspace.empty': 'Nenhuma pagina ainda.',
  'workspace.loading': 'Lendo arquivo...',
  'workspace.pageLabel': 'Pagina {number}',
  'workspace.pageOf': 'Pagina {number} de {file}',
  'workspace.pageMatches': 'Contem o termo buscado',
  'workspace.sourcePage': 'p. {number}',
  'workspace.thumbnailUnavailable':
    'Miniatura indisponivel; pagina identificada pelo arquivo de origem',

  'action.rotateLeft': 'Girar para a esquerda',
  'action.moveBack': 'Mover uma posicao para tras',
  'action.moveForward': 'Mover uma posicao para a frente',
  'action.rotateRight': 'Girar para a direita',
  'action.duplicate': 'Duplicar',
  'action.preview': 'Ver a pagina de perto',

  'preview.position': 'Pagina {position} de {total}',
  'preview.pageLabel': 'Pagina {number} de {file}',
  'preview.previous': 'Pagina anterior',
  'preview.next': 'Proxima pagina',
  'preview.move': 'Mover',
  'preview.zoom': 'Ampliar',
  'preview.fit': 'Ajustar a tela',
  'preview.close': 'Fechar',
  'preview.failed': 'Nao foi possivel desenhar esta pagina.',
  'action.delete': 'Excluir',
  'action.selectAll': 'Selecionar tudo',
  'action.clearSelection': 'Limpar selecao',
  'action.undo': 'Desfazer',
  'action.redo': 'Refazer',
  'action.export': 'Exportar PDF',
  'action.exporting': 'Exportando...',

  'panel.title': 'Propriedades',
  'panel.documents': 'Arquivos',
  'panel.removeDocument': 'Remover arquivo',
  'panel.noSelection': 'Selecione paginas para agir sobre varias de uma vez.',
  'panel.selectedCount': '{count} pagina(s) selecionada(s)',
  'panel.pageCount': '{count} pagina(s)',

  'bottom.totalPages': '{count} pagina(s) no documento final',
  'search.label': 'Buscar nos documentos',
  'search.placeholder': 'Buscar um termo...',
  'search.clear': 'Limpar busca',
  'search.searching': 'Procurando...',
  'search.results': '{count} pagina(s) com o termo',
  'search.noText':
    'Nenhuma pagina tem texto pesquisavel. Use o OCR para tornar o documento pesquisavel.',
  'bottom.selected': '{count} selecionada(s)',

  'error.loadFailed': 'Nao foi possivel ler {file}. O arquivo pode estar corrompido ou protegido.',
  'save.failed': 'Nao foi possivel salvar o arquivo.',
  'generation.copyFailed':
    'Nao encontrei o arquivo salvo. Ele pode ter sido movido ou apagado; gere de novo para outra copia.',
  'generation.tooBigToKeep':
    'Arquivo grande demais para guardar na memoria do navegador. Gere de novo para outra copia.',
  'generation.saveAgain': 'Ultimo arquivo gerado — clique para salvar de novo',

  'split.mode': 'Modo de divisao',
  'split.mode.ranges': 'Por intervalo',
  'split.mode.ranges.hint': 'Um arquivo para cada faixa.',
  'split.mode.size': 'Dividir por tamanho',
  'split.mode.size.hint': 'Volumes que caibam no limite.',
  'split.ranges.label': 'Faixas (uma por arquivo)',
  'split.size.label': 'Tamanho maximo por arquivo (MB)',
  'split.run': 'Dividir',
  'split.running': 'Dividindo...',
  'split.result': 'Resultado',
  'split.oversized':
    'Algumas paginas sozinhas ja passam do limite, entao as partes {pages} ficaram maiores que o pedido.',
  'split.noResult': 'Nenhuma divisao feita ainda.',
  'split.packed': '{count} arquivo(s) empacotado(s) no ZIP gerado',

  'pageRange.placeholder': '1-5, 8, 11-15',
  'pageRange.hint': 'Clique nas miniaturas para escolher, ou escreva as paginas aqui.',
  'pageRange.count': '{count} pagina(s) escolhida(s)',
  'pageRange.selectAll': 'Todas',
  'pageRange.clear': 'Limpar',

  'compress.mode': 'Como compactar',
  'compress.mode.lossless': 'Sem perda',
  'compress.mode.lossless.hint': 'Mantem texto e imagem. Ganho menor.',
  'compress.mode.quality': 'Forte, por qualidade',
  'compress.mode.quality.hint': 'Rasteriza as paginas. Perde o texto.',
  'compress.mode.target': 'Forte, ate caber',
  'compress.mode.target.hint': 'Ajusta a qualidade ate o limite de tamanho.',
  'compress.removeOcr': 'Remover a camada de texto do OCR',
  'compress.removeOcr.hint':
    'E o que mais pesa num PDF reconhecido. A pagina nao muda; o documento deixa de ser pesquisavel.',
  'compress.quality': 'Qualidade',
  'compress.quality.high': 'Alta',
  'compress.quality.medium': 'Media',
  'compress.quality.low': 'Baixa',
  'compress.target.label': 'Caber em (MB)',
  'compress.target.hint':
    'Cada tentativa gera o documento inteiro, entao isto pode demorar em arquivos grandes.',
  'compress.run': 'Compactar',
  'compress.running': 'Compactando...',
  'compress.result': 'Resultado',
  'compress.noResult': 'Nenhuma compactacao feita ainda.',
  'compress.summary': 'De {before} para {after} — {percent}% menor',
  'compress.grew':
    'O arquivo ficou MAIOR: de {before} para {after}. Este documento nao e digitalizado — rasterizar paginas de texto aumenta o tamanho. Use "Sem perda".',
  'compress.ocrRemoved': '{blocks} bloco(s) de texto invisivel removido(s)',
  'compress.missedTarget':
    'Nao foi possivel chegar ao limite pedido. Este e o menor arquivo que consegui gerar.',
  'compress.confirm.title': 'O PDF sera recomprimido',
  'compress.confirm.body':
    'Cada pagina sera convertida em imagem e gravada em JPEG. O arquivo fica bem menor.',
  'compress.confirm.rasterized':
    'O documento deixa de ter texto pesquisavel: a busca, a copia de trecho e a camada de OCR se perdem, e a nitidez cai.',
  'compress.confirm.losslessHint':
    'Se voce so quer tirar o peso do OCR, use "Sem perda" — o texto visivel continua intacto.',
  'compress.confirm.cancel': 'Cancelar',
  'compress.confirm.accept': 'Compactar mesmo assim',

  'extract.pages': 'Paginas a extrair',
  'extract.pages.label': 'Paginas',
  'extract.explanation':
    'Gera UM arquivo com as paginas escolhidas, na ordem em que forem pedidas.',
  'extract.run': 'Extrair',
  'extract.running': 'Extraindo...',

  'coreError.unknown': 'Algo deu errado. Tente novamente.',
  'coreError.EMPTY_COMPOSITION': 'Nao ha paginas para gerar o documento.',
  'coreError.DUPLICATE_SOURCE': 'O arquivo "{source}" foi carregado duas vezes.',
  'coreError.UNKNOWN_SOURCE': 'O arquivo "{source}" nao esta mais carregado.',
  'coreError.PAGE_OUT_OF_RANGE': 'A pagina pedida nao existe no arquivo "{source}".',
  'coreError.INVALID_ROTATION': 'A rotacao precisa ser multiplo de 90 graus.',
  'coreError.DOCUMENT_HAS_NO_PAGES': 'O documento nao tem paginas.',
  'coreError.EMPTY_RANGE_SPEC': 'Informe ao menos um intervalo, por exemplo 1-5, 8, 11-15.',
  'coreError.INVALID_RANGE_PART': 'Nao entendi "{part}". Use formatos como 1-5, 8 ou 11-.',
  'coreError.REVERSED_RANGE': 'Em "{part}", o fim vem antes do inicio.',
  'coreError.INVALID_PAGE_NUMBER':
    'Em "{part}", o numero da pagina e invalido: paginas comecam em 1.',
  'coreError.PAGE_DOES_NOT_EXIST': 'A pagina {page} nao existe: o documento tem {total}.',
  'coreError.INVALID_MAX_BYTES': 'O tamanho maximo precisa ser maior que zero.',
  'coreError.INVALID_SCALE': 'A resolucao precisa ser maior que zero.',
  'coreError.REDACTION_PAGE_OUT_OF_RANGE': 'A pagina marcada para ofuscar nao existe no documento.',
  'coreError.INVALID_MAX_EDGE': 'O tamanho da miniatura precisa ser maior que zero.',
  'coreError.NO_CANVAS_CONTEXT': 'Seu navegador nao conseguiu preparar a area de desenho.',
  'coreError.INTERNAL': 'Encontramos um problema interno. Se repetir, avise a gente.',

  'ocr.title': 'Reconhecimento de texto',
  'ocr.description': 'Torna um PDF digitalizado pesquisavel, sem alterar o que aparece na pagina.',
  'ocr.language': 'Idioma: Portugues (Brasil)',
  'ocr.skipWithText': 'Pular paginas que ja tem texto',
  'ocr.skipWithText.hint': 'OCR e lento. Pagina que ja e pesquisavel nao precisa dele.',
  'ocr.scopeAll': 'Reconhecer todo o documento',
  'ocr.scopeSelection': 'Reconhecer {count} pagina(s) selecionada(s)',
  'ocr.run': 'Reconhecer texto',
  'ocr.running': 'Reconhecendo...',
  'ocr.result': 'Resultado',
  'ocr.noResult': 'Nenhum reconhecimento feito ainda.',
  'ocr.recognized': '{count} pagina(s) reconhecida(s)',
  'ocr.skipped': '{count} pagina(s) puladas por ja terem texto',
  'ocr.words': '{count} palavra(s) na camada de busca',
  'ocr.wordsDropped': '{count} palavra(s) descartadas por caracteres nao suportados',

  'redact.title': 'Ofuscacao',
  'redact.description': 'Arraste sobre a pagina para marcar o que deve ser apagado.',
  'redact.viewerLabel': 'Pagina {number}, area de marcacao',
  'redact.pages': 'Paginas',
  'redact.marks': 'Regioes marcadas',
  'redact.noMarks': 'Nenhuma regiao marcada ainda.',
  'redact.markLabel': 'Pagina {page}, regiao {index}',
  'redact.removeMark': 'Remover regiao {index} da pagina {page}',
  'redact.clear': 'Limpar marcacoes',
  'redact.run': 'Ofuscar',
  'redact.running': 'Ofuscando...',
  'redact.confirm.title': 'Confirmar ofuscacao',
  'redact.confirm.regions': '{regions} regiao(oes) em {pages} pagina(s) serao apagadas.',
  'redact.confirm.irreversible': 'O conteudo apagado nao pode ser recuperado no arquivo gerado.',
  'redact.confirm.rasterized':
    'As paginas afetadas viram imagem e perdem o texto pesquisavel. As demais ficam intactas.',
  'redact.confirm.ocrHint': 'A busca pode ser recuperada depois com a ferramenta de OCR.',
  'redact.confirm.accept': 'Ofuscar e baixar',
  'redact.confirm.cancel': 'Cancelar',
  'redact.done': 'Pronto: {pages} pagina(s) ofuscada(s).',

  'sign.title': 'Assinatura digital',
  'sign.description': 'Assina com certificado ICP-Brasil A1. A chave nao sai do seu computador.',
  'sign.certificate': 'Certificado A1 (.pfx)',
  'sign.choose': 'Escolher certificado',
  'sign.passphrase': 'Senha do certificado',
  'sign.load': 'Carregar certificado',
  'sign.loading': 'Lendo certificado...',
  'sign.subject': 'Titular',
  'sign.issuer': 'Emissor',
  'sign.validity': 'Validade',
  'sign.expired': 'Este certificado esta vencido.',
  'sign.remove': 'Remover certificado',
  'sign.reason': 'Motivo',
  'sign.location': 'Local',
  'sign.run': 'Assinar e baixar',
  'sign.running': 'Assinando...',
  'sign.done': 'Documento assinado.',
  'sign.localOnly': 'Assinatura sem carimbo de tempo: nada e enviado pela rede.',
  'sign.sessionEnded': 'O certificado foi descarregado da memoria apos a assinatura.',
  'signError.INVALID_PASSWORD': 'Senha incorreta para este certificado.',
  'signError.INVALID_CERTIFICATE': 'Nao foi possivel ler este arquivo como certificado A1.',
  'signError.NO_CERTIFICATE_IN_FILE': 'O arquivo nao contem um certificado utilizavel.',
  'signError.SIGN_FAILED': 'Nao foi possivel assinar o documento.',

  'unsupported.title': 'Este navegador nao consegue exibir paginas',
  'unsupported.detail':
    'Falta suporte a OffscreenCanvas, usado para desenhar as paginas fora da thread principal. Miniaturas, ofuscacao e OCR ficam indisponiveis aqui.',
  'unsupported.workaround': 'Unir, dividir e assinar continuam funcionando normalmente.',

  'privacy.explanation':
    'Nenhum arquivo e enviado para servidores. Todo o processamento acontece no seu navegador.',
} as const;

/** Chave valida de traducao. Derivada do idioma de referencia. */
export type MessageKey = keyof typeof ptBR;

/** Contrato que todo idioma deve cumprir integralmente. */
export type Messages = Record<MessageKey, string>;
