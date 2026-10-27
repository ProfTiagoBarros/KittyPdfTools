import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { LongOperationNotice } from '@/components/workspace/long-operation-notice';
import {
  beginLongOperation,
  reportLongOperationProgress,
  useLongOperation,
} from '../long-operation';

beforeEach(() => {
  useLongOperation.setState({ running: 0, progress: null });
});

describe('operacao longa', () => {
  it('operacoes sobrepostas: o aviso so sai quando a ULTIMA termina', () => {
    const fimAbrir = beginLongOperation();
    const fimBuscar = beginLongOperation();

    fimAbrir();
    expect(useLongOperation.getState().running).toBe(1);

    fimBuscar();
    expect(useLongOperation.getState().running).toBe(0);
  });

  it('terminar duas vezes nao desequilibra o contador', () => {
    const outra = beginLongOperation();
    const fim = beginLongOperation();

    fim();
    fim();

    expect(useLongOperation.getState().running).toBe(1);
    outra();
  });

  it('o progresso some junto com a ultima operacao', () => {
    const fim = beginLongOperation();
    reportLongOperationProgress(0.4);

    fim();

    expect(useLongOperation.getState().progress).toBeNull();
  });
});

describe('LongOperationNotice', () => {
  it('nada na tela sem operacao em andamento', () => {
    render(<LongOperationNotice />);
    expect(screen.queryByTestId('long-operation')).toBeNull();
  });

  it('diz que o programa esta trabalhando, com o progresso quando houver', () => {
    render(<LongOperationNotice />);

    let fim = () => undefined as void;
    act(() => {
      fim = beginLongOperation();
      reportLongOperationProgress(0.25);
    });

    expect(screen.getByRole('alertdialog')).toHaveTextContent(
      'O programa esta realizando uma operacao demorada, aguarde por uns instantes.',
    );
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25');
    // Cobre a tela, por cima de tudo, fora da casca.
    expect(screen.getByTestId('long-operation').parentElement).toBe(document.body);

    act(() => fim());
    expect(screen.queryByTestId('long-operation')).toBeNull();
  });
});
