import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { savePdf } from '../save-pdf';

const save = vi.fn<(options: unknown) => Promise<string | null>>();
const invoke = vi.fn<(cmd: string, args: unknown, options: unknown) => Promise<void>>();

vi.mock('@tauri-apps/plugin-dialog', () => ({ save: (options: unknown) => save(options) }));
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args: unknown, options: unknown) => invoke(cmd, args, options),
}));

const BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
const ARQUIVO = new Blob([BYTES], { type: 'application/pdf' });

/** O que cada chamada de gravacao levou: corpo e cabecalhos, na ordem. */
function pedacosGravados() {
  return invoke.mock.calls
    .filter(([cmd]) => cmd === 'plugin:saf-save|write_chunk')
    .map(([, corpo, opcoes]) => ({
      tamanho: (corpo as Uint8Array).length,
      append: (opcoes as { headers: { append: string } }).headers.append,
    }));
}

const createObjectURL = vi.fn<(objeto: Blob) => string>();
const revokeObjectURL = vi.fn<(url: string) => void>();

/** Marca o app instalado do mesmo jeito que o Tauri marca: um global na janela. */
function pretendToBeTauri(): void {
  Object.defineProperty(window, '__TAURI_INTERNALS__', {
    value: { invoke: vi.fn() },
    configurable: true,
  });
}

describe('savePdf', () => {
  beforeEach(() => {
    save.mockReset();
    invoke.mockReset().mockResolvedValue(undefined);
    createObjectURL.mockReset().mockReturnValue('blob:fake');
    revokeObjectURL.mockReset();
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
  });

  afterEach(() => {
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
  });

  describe('no navegador', () => {
    it('entrega pelo <a download> e libera a URL no mesmo escopo', async () => {
      const click = vi
        .spyOn(HTMLAnchorElement.prototype, 'click')
        .mockImplementation(() => undefined);

      await savePdf(ARQUIVO, 'saida.pdf');

      expect(createObjectURL).toHaveBeenCalledOnce();
      expect(click).toHaveBeenCalledOnce();
      // Regra de Ouro 3: nao existe caminho em que a URL fique viva.
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake');
      expect(save).not.toHaveBeenCalled();

      click.mockRestore();
    });
  });

  describe('no app instalado', () => {
    beforeEach(pretendToBeTauri);

    it('pergunta onde salvar e grava no caminho escolhido', async () => {
      save.mockResolvedValue('/escolhido/saida.pdf');

      await savePdf(ARQUIVO, 'saida.pdf');

      expect(save).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: 'saida.pdf' }));
      // O destino viaja no cabecalho e os bytes como corpo binario — nunca em JSON.
      expect(invoke).toHaveBeenCalledWith('plugin:saf-save|write_chunk', BYTES, {
        headers: { destination: '/escolhido/saida.pdf', append: '0' },
      });
      // So no fim o destino recebe o arquivo: uma falha no meio nao estraga o que ja existia.
      expect(invoke.mock.lastCall?.slice(0, 2)).toEqual([
        'plugin:saf-save|finish_write',
        { destination: '/escolhido/saida.pdf' },
      ]);
      // O caminho da web nao pode acontecer junto: no WebView do Android ele nao salva nada.
      expect(createObjectURL).not.toHaveBeenCalled();
    });

    it('arquivo grande vai em pedacos de 8 MB: o primeiro zera, os demais acrescentam', async () => {
      save.mockResolvedValue('/escolhido/grande.pdf');
      const oitoMb = 8 * 1024 * 1024;
      const grande = new Blob([new Uint8Array(oitoMb * 2 + 10)]);

      await savePdf(grande, 'grande.pdf');

      expect(pedacosGravados()).toEqual([
        { tamanho: oitoMb, append: '0' },
        { tamanho: oitoMb, append: '1' },
        { tamanho: 10, append: '1' },
      ]);
      expect(invoke.mock.lastCall?.slice(0, 2)).toEqual([
        'plugin:saf-save|finish_write',
        { destination: '/escolhido/grande.pdf' },
      ]);
    });

    it('falha num pedaco nao conclui a gravacao', async () => {
      save.mockResolvedValue('/escolhido/saida.pdf');
      invoke.mockRejectedValueOnce(new Error('disco cheio'));

      await expect(savePdf(ARQUIVO, 'saida.pdf')).rejects.toThrow('disco cheio');
      expect(invoke).not.toHaveBeenCalledWith('plugin:saf-save|finish_write', expect.anything());
    });

    it('nao grava nada quando o usuario cancela o seletor', async () => {
      save.mockResolvedValue(null);

      await savePdf(ARQUIVO, 'saida.pdf');

      expect(invoke).not.toHaveBeenCalled();
    });

    it('propaga falha de gravacao, para a interface poder avisar', async () => {
      save.mockResolvedValue('/escolhido/saida.pdf');
      invoke.mockRejectedValue(new Error('disco cheio'));

      await expect(savePdf(ARQUIVO, 'saida.pdf')).rejects.toThrow('disco cheio');
    });
  });
});
