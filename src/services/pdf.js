/* Renders an incident brief as an A4 PDF (jsPDF, loaded on demand). */
import { formatRM } from '../data/reference';

const BRAND = [47, 111, 219]; // template primary (#2f6fdb)
const INK = [15, 31, 29];
const MUTED = [91, 118, 114];
const LINE = [205, 222, 219];
const M = 16; // page margin, mm

// The built-in Helvetica font only covers WinAnsi characters: map the common
// extras and drop anything else rather than printing garbage.
const SAFE = { '≈': 'approx.', '≥': '>=', '≤': '<=', '→': '->', '←': '<-', 'σ': ' SD', '−': '-', '✓': 'v', '…': '...', '‑': '-' };
const WIN_ANSI_EXTRA = new Set([0x2013, 0x2014, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022]);
const keep = (c) => {
  const code = c.codePointAt(0);
  return c === '\n' || c === '\t' || (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WIN_ANSI_EXTRA.has(code);
};
const pdfSafe = (s) => Array.from(String(s ?? ''), (c) => SAFE[c] ?? (keep(c) ? c : '')).join('');

function imageSize(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

/**
 * brief:    LLM or offline brief (see server/llm.js ReportSchema)
 * caseFile: from services/caseFile.js
 * images:   [{ dataUrl, caption }]
 */
export async function buildReportPdf({ brief, caseFile, images = [] }) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const CW = W - 2 * M;
  let y = 0;

  const ensure = (h) => { if (y + h > H - 18) { doc.addPage(); y = 18; } };
  const font = (size, style = 'normal', color = INK) => { doc.setFont('helvetica', style); doc.setFontSize(size); doc.setTextColor(...color); };
  const para = (text, { size = 9.5, style = 'normal', color = INK, indent = 0, gap = 1.6 } = {}) => {
    font(size, style, color);
    const lines = doc.splitTextToSize(pdfSafe(text), CW - indent);
    const lh = size * 0.42;
    lines.forEach((ln) => { ensure(lh); doc.text(ln, M + indent, y); y += lh; });
    y += gap;
  };
  const heading = (text) => {
    ensure(12);
    y += 2;
    font(11, 'bold', BRAND);
    doc.text(pdfSafe(text).toUpperCase(), M, y);
    y += 1.6;
    doc.setDrawColor(...BRAND);
    doc.setLineWidth(0.4);
    doc.line(M, y, M + CW, y);
    y += 5;
  };
  const bullet = (text) => {
    font(9.5);
    const lines = doc.splitTextToSize(pdfSafe(text), CW - 5);
    lines.forEach((ln, i) => { ensure(4.2); if (i === 0) doc.text('•', M + 1, y); doc.text(ln, M + 5, y); y += 4.1; });
    y += 0.8;
  };
  const table = (cols, rows) => {
    const widths = cols.map((c) => c.w * CW);
    const drawRow = (cells, bold) => {
      font(8.5, bold ? 'bold' : 'normal', bold ? MUTED : INK);
      const wrapped = cells.map((c, i) => doc.splitTextToSize(pdfSafe(c), widths[i] - 2));
      const h = Math.max(...wrapped.map((w) => w.length)) * 3.7 + 2.4;
      ensure(h);
      let x = M;
      wrapped.forEach((w, i) => { doc.text(w, x + 1, y + 3.4); x += widths[i]; });
      y += h;
      doc.setDrawColor(...LINE);
      doc.setLineWidth(0.2);
      doc.line(M, y, M + CW, y);
    };
    drawRow(cols.map((c) => c.label.toUpperCase()), true);
    rows.forEach((r) => drawRow(r, false));
    y += 3;
  };

  /* Header band */
  doc.setFillColor(...BRAND);
  doc.rect(0, 0, W, 30, 'F');
  font(8, 'bold', [214, 228, 250]);
  doc.text('DEWAN BANDARAYA KUCHING UTARA  ·  GUARDGRID', M, 10);
  font(15, 'bold', [255, 255, 255]);
  doc.text('Incident Brief for PDRM', M, 18);
  font(8.5, 'normal', [228, 237, 252]);
  doc.text(pdfSafe(`Laporan ringkas insiden untuk PDRM  ·  Ref ${caseFile.reference}`), M, 24.5);
  y = 38;

  font(13, 'bold');
  doc.splitTextToSize(pdfSafe(brief.title), CW).forEach((ln) => { doc.text(ln, M, y); y += 5.6; });
  y += 1;
  table(
    [{ label: 'Prepared', w: 0.25 }, { label: 'Event', w: 0.25 }, { label: 'Alert level', w: 0.2 }, { label: 'Estimated loss', w: 0.3 }],
    [[`${caseFile.preparedAt} MYT`, caseFile.event.id, `${caseFile.event.alertLevel} · ${caseFile.event.status}`, formatRM(caseFile.estimatedLoss.totalRM)]],
  );

  heading('Summary');
  para(brief.summary, { size: 10 });
  para(`Ringkasan: ${brief.ringkasanBM}`, { size: 9, style: 'italic', color: MUTED });

  heading('What, where, when');
  table([{ label: 'Item', w: 0.16 }, { label: 'Detail', w: 0.84 }], [
    ['What', brief.what],
    ['Where', `${brief.where}\nMap: ${caseFile.location.map}`],
    ['When', brief.when],
  ]);

  if (brief.sequenceOfEvents?.length) {
    heading('Sequence of events');
    table([{ label: 'Time (MYT)', w: 0.26 }, { label: 'Event', w: 0.74 }], brief.sequenceOfEvents.map((s) => [s.time, s.event]));
  }

  heading('Evidence');
  brief.evidence.forEach((e) => bullet(`${e.ref}: ${e.description}`));
  for (const [i, img] of images.entries()) {
    const size = await imageSize(img.dataUrl);
    if (!size) continue;
    const w = Math.min(CW, 150);
    const h = (w * size.h) / size.w;
    ensure(h + 8);
    doc.addImage(img.dataUrl, 'JPEG', M, y, w, h);
    y += h + 3.5;
    para(`E${i + 1}. ${img.caption}`, { size: 8, color: MUTED });
  }

  heading('Linked suspicious scrap sales');
  if (caseFile.linkedScrapSales.length) {
    table(
      [{ label: 'Sale', w: 0.12 }, { label: 'Dealer / date', w: 0.28 }, { label: 'Material', w: 0.2 }, { label: 'Seller', w: 0.17 }, { label: 'Why linked', w: 0.23 }],
      caseFile.linkedScrapSales.map((s) => {
        const rel = brief.linkedScrapSales.find((b) => b.transactionId === s.transactionId);
        return [s.transactionId, `${s.dealer} (${s.dealerLicence})\n${s.date}`, `${s.material}, ${s.weightKg} kg`, `${s.sellerIcMasked}\nref ${s.sellerRef}`, rel?.relevance || `${s.daysAfterEvent} d after, ${s.kmFromSite} km`];
      }),
    );
    para('Links are investigative leads from automated screening, not proof of handling stolen goods.', { size: 8, color: MUTED });
  } else {
    para('No suspicious scrap sales were recorded within 14 days and 15 km of the event.');
  }

  heading('Estimated loss');
  table([{ label: 'Item', w: 0.75 }, { label: 'RM', w: 0.25 }], [
    ...caseFile.estimatedLoss.items.map((i) => [i.item, formatRM(i.rm)]),
    ['Total', formatRM(caseFile.estimatedLoss.totalRM)],
  ]);
  para(brief.lossBasis, { size: 8.5, color: MUTED });

  heading('Requested police actions');
  brief.requestedPoliceActions.forEach(bullet);
  heading('DBKU actions');
  brief.dbkuActions.forEach(bullet);

  ensure(26);
  y += 4;
  font(9, 'normal', MUTED);
  doc.text('Prepared by: ______________________', M, y);
  doc.text('Received by (PDRM): ______________________', M + CW / 2, y);
  y += 6;
  doc.text('Date: ____________', M, y);
  doc.text('Police report no.: ____________', M + CW / 2, y);

  /* Footer on every page */
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    font(7, 'normal', MUTED);
    doc.text(pdfSafe(`GuardGrid prototype · mock data · drafted by ${brief.model || 'LLM'}; verify before submission`), M, H - 8);
    doc.text(`${p} / ${pages}`, W - M, H - 8, { align: 'right' });
  }
  return doc;
}
