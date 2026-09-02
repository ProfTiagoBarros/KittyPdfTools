/**
 * PDF minimo e valido, montado a mao.
 *
 * Escrito byte a byte de proposito: um fixture gerado pelo proprio `pdf-lib` faria os testes
 * de interface dependerem da biblioteca que eles deveriam estar exercitando de fora.
 */
export function minimalPdf(pages: number): string {
  const objects: string[] = [];
  const kids = Array.from({ length: pages }, (_unused, index) => `${4 + index * 2} 0 R`).join(' ');

  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages} >>`);
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

  for (let index = 0; index < pages; index += 1) {
    const contentRef = 5 + index * 2;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 300] ` +
        `/Resources << /Font << /F1 3 0 R >> >> /Contents ${contentRef} 0 R >>`,
    );
    const stream = `BT /F1 24 Tf 20 150 Td (P${index + 1}) Tj ET`;
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  }

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  return pdf;
}
