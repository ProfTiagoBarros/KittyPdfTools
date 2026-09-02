import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { savePdf } from '../save-pdf';

const save = vi.fn<(options: unknown) => Promise<string | null>>();
const invoke = vi.fn<(cmd: string, args: unknown, options: unknown) => Promise<void>>();

vi.mock('@tauri-apps/plugin-dialog', () => ({ save: (options: unknown) => save(options) }));
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args: unknown, options: unknown) => invoke(cmd, args, options),
}));

const BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

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

      await savePdf(BYTES, 'saida.pdf');

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

      await savePdf(BYTES, 'saida.pdf');

      expect(save).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: 'saida.pdf' }));
      // O destino viaja no cabecalho e os bytes como corpo binario — nunca em JSON.
      expect(invoke).toHaveBeenCalledWith('plugin:saf-save|save_to_uri', BYTES, {
        headers: { destination: '/escolhido/saida.pdf' },
      });
      // O caminho da web nao pode acontecer junto: no WebView do Android ele nao salva nada.
      expect(createObjectURL).not.toHaveBeenCalled();
    });

    it('nao grava nada quando o usuario cancela o seletor', async () => {
      save.mockResolvedValue(null);

      await savePdf(BYTES, 'saida.pdf');

      expect(invoke).not.toHaveBeenCalled();
    });

    it('propaga falha de gravacao, para a interface poder avisar', async () => {
      save.mockResolvedValue('/escolhido/saida.pdf');
      invoke.mockRejectedValue(new Error('disco cheio'));

      await expect(savePdf(BYTES, 'saida.pdf')).rejects.toThrow('disco cheio');
    });
  });
});
