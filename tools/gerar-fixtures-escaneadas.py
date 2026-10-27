"""PDFs sinteticos com o perfil de documentos escaneados, para medir memoria sem dados reais.

Cada pagina e um JPEG proprio de 2500x3530 px (A4 a 300 dpi) com ~690 KB, como uma folha
digitada e digitalizada. As quantidades reproduzem o lote que travou o app em 10/2026: oito
arquivos, 816 paginas, 551 MB.

Uso: python tools/gerar-fixtures-escaneadas.py <pasta-destino>
"""
import io
import random
import sys
from pathlib import Path

from PIL import Image, ImageDraw

PAGINAS_POR_ARQUIVO = [2, 122, 122, 96, 116, 116, 120, 122]
LARGURA, ALTURA = 2500, 3530


def pagina_escaneada() -> bytes:
    random.seed(7)
    img = Image.new('L', (LARGURA, ALTURA), 245)
    desenho = ImageDraw.Draw(img)
    # "Linhas de texto": blocos escuros pequenos, como uma folha digitada.
    for y in range(200, ALTURA - 200, 48):
        x = 180
        while x < LARGURA - 180:
            w = random.randint(8, 40)
            desenho.rectangle([x, y, x + w, y + random.randint(18, 26)], fill=random.randint(20, 90))
            x += w + random.randint(4, 14)
    # Ruido de digitalizacao.
    px = img.load()
    for _ in range(400_000):
        x, y = random.randrange(LARGURA), random.randrange(ALTURA)
        px[x, y] = max(0, min(255, px[x, y] + random.randint(-30, 30)))
    saida = io.BytesIO()
    img.convert('RGB').save(saida, 'JPEG', quality=55)
    return saida.getvalue()


def pdf(jpg: bytes, paginas: int) -> bytes:
    objetos = [b'<< /Type /Catalog /Pages 2 0 R >>']
    filhos = ' '.join(f'{3 + i * 3} 0 R' for i in range(paginas))
    objetos.append(f'<< /Type /Pages /Kids [{filhos}] /Count {paginas} >>'.encode())
    for i in range(paginas):
        pagina, conteudo, imagem = 3 + i * 3, 4 + i * 3, 5 + i * 3
        objetos.append(
            f'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] '
            f'/Resources << /XObject << /Im0 {imagem} 0 R >> >> /Contents {conteudo} 0 R >>'.encode()
        )
        fluxo = b'q 595 0 0 842 0 0 cm /Im0 Do Q'
        objetos.append(b'<< /Length %d >>\nstream\n' % len(fluxo) + fluxo + b'\nendstream')
        objetos.append(
            f'<< /Type /XObject /Subtype /Image /Width {LARGURA} /Height {ALTURA} '
            f'/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode '
            f'/Length {len(jpg)} >>\nstream\n'.encode() + jpg + b'\nendstream'
        )
    saida = bytearray(b'%PDF-1.4\n%\xe2\xe3\xcf\xd3\n')
    posicoes = []
    for numero, corpo in enumerate(objetos, start=1):
        posicoes.append(len(saida))
        saida += f'{numero} 0 obj\n'.encode() + corpo + b'\nendobj\n'
    xref = len(saida)
    saida += f'xref\n0 {len(objetos) + 1}\n0000000000 65535 f \n'.encode()
    for posicao in posicoes:
        saida += f'{posicao:010d} 00000 n \n'.encode()
    saida += f'trailer\n<< /Size {len(objetos) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF'.encode()
    return bytes(saida)


if __name__ == '__main__':
    destino = Path(sys.argv[1])
    destino.mkdir(parents=True, exist_ok=True)
    jpg = pagina_escaneada()
    for indice, paginas in enumerate(PAGINAS_POR_ARQUIVO, start=1):
        (destino / f'sintetico-{indice}-{paginas}p.pdf').write_bytes(pdf(jpg, paginas))
    print(f'{len(PAGINAS_POR_ARQUIVO)} arquivos, {sum(PAGINAS_POR_ARQUIVO)} paginas, '
          f'{len(jpg) // 1024} KB por pagina, em {destino}')
