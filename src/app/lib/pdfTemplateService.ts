import { jsPDF } from 'jspdf';
import autoTable, { UserOptions } from 'jspdf-autotable';
import { PDFDocument } from 'pdf-lib';

export class PDFTemplateService {
  public doc: jsPDF;
  public currentY: number;
  
  // Rendered height of the letterhead graphic (in mm), measured from the top of the page.
  // The letterhead asset is US Letter (612x792pt) while content pages are A4 (595.28x841.89pt).
  // exportWithLetterhead() scales the letterhead to FIT (uniform scale, no distortion) and
  // centers it, which leaves a blank margin above/below the artwork. Re-derived from the
  // original 55mm (tuned against the old non-uniform stretch, v-scale ~1.063) as:
  //   blank top margin (~12.6mm, from vertical centering) + scaled header graphic height
  //   (55 / 1.063 native mm * new fit-scale 0.973 ~= 50.3mm) ≈ 63mm.
  // Treat as a hand-tuned constant; verify visually against a rendered PDF if the letterhead
  // asset or page size ever changes.
  private headerHeight: number = 63;
  private footerTop: number;

  // The letterhead PDF asset (public/letterhead.pdf) has its own baked-in footer band —
  // a horizontal rule plus "This is a computer-generated document..." / "Page 1" text —
  // burned into the artwork itself (see the note in exportWithLetterhead() on why we
  // can't suppress or edit it). It's a US Letter page (612x792pt) fit-scaled and centered
  // onto an A4 content page, so that band does NOT sit flush with the bottom margin the
  // way the dynamically-drawn footer does; it lands well above it. Body content used to be
  // allowed to flow all the way down to just above the dynamic footer, overlapping this
  // band. Derived from the artwork's own text position (pdftotext -bbox on letterhead.pdf:
  // the rule above the disclaimer starts at y=589.49pt of 792pt, i.e. 202.51pt from its own
  // bottom edge), transformed through the same fitScale/centering math as
  // exportWithLetterhead(): fitScale = min(595.28/612, 841.89/792) = 0.9727, letterhead
  // bottom offset = (841.89 - 792*0.9727)/2 = 35.76pt, so the rule lands at
  // 35.76 + 202.51*0.9727 = 232.7pt (~82.1mm) from the bottom of the final A4 page, i.e.
  // ~214.9mm from the top. Re-derive this if the letterhead asset or page size changes.
  private letterheadFooterBandTop: number = 214.9;

  private bodyTop: number;
  private bodyBottom: number;
  
  private margins = {
    left: 25.4, // 1 inch
    right: 25.4, // 1 inch
    bottom: 25.4, // 1 inch
  };

  private pageWidth: number;
  private pageHeight: number;

  constructor(orientation: 'p' | 'l' = 'p') {
    this.doc = new jsPDF({ orientation, unit: 'mm', format: 'a4' });
    this.pageWidth = this.doc.internal.pageSize.getWidth();
    this.pageHeight = this.doc.internal.pageSize.getHeight();

    this.footerTop = this.pageHeight - this.margins.bottom - 10; // footer positioned above bottom margin

    // Calculate printable body region below letterhead and above footer. Must clear
    // whichever comes first: the dynamically-drawn "Generated: ... / Page X of Y" line,
    // or the letterhead artwork's own baked-in footer band (see letterheadFooterBandTop) —
    // a few mm of buffer above the latter so a heading's ascender doesn't touch its rule.
    this.bodyTop = this.headerHeight + 7; // ensure content starts below the letterhead
    this.bodyBottom = Math.min(this.footerTop - 10, this.letterheadFooterBandTop - 6);
    this.currentY = this.bodyTop;
  }

  public getDoc() {
    return this.doc;
  }

  public getCurrentY() {
    return this.currentY;
  }
  
  public setCurrentY(y: number) {
      this.currentY = y;
  }

  public getContentWidth(): number {
    return this.pageWidth - this.margins.left - this.margins.right;
  }

  // Unified vertical-rhythm formula for headings: approximate single-line text height
  // (fontSize in pt -> mm, with the ~1.15 line-height factor baked in) plus a fixed
  // spacing gap below the heading. Replaces three independently hand-picked constants
  // (6+7, 6+8, 5.5+8) that produced slightly inconsistent spacing for similarly-sized
  // headings; results stay within ~1.5mm of the previous values.
  private headingSpacing(fontSize: number): number {
    return fontSize * 0.4 + 8;
  }

  public addTitle(title: string) {
    this.checkPageBreak(25);
    this.doc.setFont('times', 'bold');
    this.doc.setFontSize(16);
    this.doc.setTextColor(0, 0, 0);
    this.doc.text(title, this.pageWidth / 2, this.currentY, { align: 'center', baseline: 'top' });
    this.currentY += this.headingSpacing(16);
  }

  public addMainHeading(heading: string) {
    this.checkPageBreak(20);
    this.doc.setFont('times', 'bold');
    this.doc.setFontSize(16);
    this.doc.setTextColor(0, 0, 0);
    this.doc.text(heading, this.margins.left, this.currentY, { align: 'left', baseline: 'top' });
    this.currentY += this.headingSpacing(16);
  }

  public addSectionHeading(heading: string) {
    this.checkPageBreak(18);
    this.doc.setFont('times', 'bold');
    this.doc.setFontSize(14);
    this.doc.setTextColor(0, 0, 0);
    this.doc.text(heading, this.margins.left, this.currentY, { align: 'left', baseline: 'top' });
    this.currentY += this.headingSpacing(14);
  }

  public addParagraph(text: string) {
    this.doc.setFont('times', 'normal');
    this.doc.setFontSize(12);
    this.doc.setTextColor(0, 0, 0);
    this.doc.setLineHeightFactor(1.15);

    const maxTextWidth = this.pageWidth - this.margins.left - this.margins.right;
    const textLines = this.doc.splitTextToSize(text, maxTextWidth);
    const textHeight = textLines.length * 4.23 * 1.15;

    this.checkPageBreak(textHeight + 6);

    this.doc.text(textLines, this.margins.left, this.currentY, { align: 'left', baseline: 'top' });
    this.currentY += textHeight + 6;
  }

  private normalizeTableHeaders(headers: string[][] | string[]): string[][] {
    if (!Array.isArray(headers)) {
      return [[String(headers)]];
    }
    if (headers.length === 0) {
      return [];
    }
    if (typeof headers[0] === 'string') {
      return [headers as string[]];
    }
    return headers as string[][];
  }

  private getDefaultTableOptions(): UserOptions {
    return {
      theme: 'grid',
      startY: this.currentY,
      margin: {
        // Used by jspdf-autotable to reset cursor.y on every new page it creates internally
        // during pagination. Must match bodyTop so continuation pages leave room for the
        // letterhead header instead of resuming at y=0 (under/through the header band).
        top: this.bodyTop,
        bottom: this.pageHeight - this.bodyBottom,
        left: this.margins.left,
        right: this.margins.right,
      },
      styles: {
        font: 'times',
        fontSize: 12,
        valign: 'top',
        overflow: 'linebreak',
        cellPadding: 4,
        lineColor: [200, 200, 200],
        lineWidth: 0.1,
        textColor: [0, 0, 0],
        // NOT 'wrap': jspdf-autotable sizes each 'wrap' column independently up to the
        // *full* available page width based on its own unwrapped content, so a long cell
        // (e.g. a "Business Insight" sentence) claims close to the whole row's width and
        // pushes the table past the right margin instead of wrapping. The default 'auto'
        // distributes/shrinks column widths to fit tableWidth first, wrapping text (via
        // overflow:'linebreak' above) to whatever space that leaves.
      },
      headStyles: {
        fontStyle: 'bold',
        halign: 'left',
        fillColor: [240, 240, 240],
        textColor: [0, 0, 0],
      },
      bodyStyles: {
        halign: 'left',
      },
      pageBreak: 'auto',
      showHead: 'everyPage',
      tableWidth: this.pageWidth - this.margins.left - this.margins.right,
    } as UserOptions;
  }

  public addTable(headers: string[][] | string[], body: any[][], options: UserOptions = {}) {
    const normalizedHeaders = this.normalizeTableHeaders(headers);

    // Reserve enough room for a header row plus at least one data row before starting the
    // table here; reuses the shared checkPageBreak helper instead of an ad-hoc check.
    this.checkPageBreak(30);

    autoTable(this.doc, {
      head: normalizedHeaders,
      body,
      ...this.getDefaultTableOptions(),
      ...options,
    });

    // @ts-ignore
    this.currentY = this.doc.lastAutoTable?.finalY ? this.doc.lastAutoTable.finalY + 8 : this.currentY;
  }
  
  public addImage(base64: string, format: string, width: number, height: number, alignment: 'center'|'left'|'right' = 'center') {
      this.checkPageBreak(height + 7); // Ensure image + 20px spacing fits
      let x = this.margins.left;
      if (alignment === 'center') {
          x = (this.pageWidth - width) / 2;
      } else if (alignment === 'right') {
          x = this.pageWidth - this.margins.right - width;
      }
      this.doc.addImage(base64, format, x, this.currentY, width, height);
      this.currentY += height + 7; // Height + 20px spacing below
  }

  public checkPageBreak(requiredHeight: number) {
     const remainingPageHeight = this.bodyBottom - this.currentY;
     if (requiredHeight > remainingPageHeight) {
         this.doc.addPage();
         this.currentY = this.bodyTop; // Reset to the top of the printable body region
     }
  }

  public async exportWithLetterhead(fileName: string): Promise<Uint8Array> {
    const pageCount = (this.doc.internal as any).getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      this.doc.setPage(i);
      this.doc.setFont('times', 'normal');
      this.doc.setFontSize(10);
      this.doc.setTextColor(0, 0, 0);

      // NOTE: the letterhead PDF asset (public/letterhead.pdf) already has its own baked-in
      // footer text (a disclaimer sentence + a static "Page 1") that cannot be edited since
      // it's a fixed binary design file. We intentionally do NOT draw our own disclaimer or
      // "Confidential" text here to avoid printing the disclaimer twice. We DO keep the
      // dynamically-generated "Page X of Y" below, since the letterhead's baked-in "Page 1"
      // is wrong on every page after the first and there is no way to suppress it from here.
      const dateText = new Date().toLocaleString('en-IN');
      this.doc.text(`Generated: ${dateText}`, this.margins.left, this.footerTop);

      const pageText = `Page ${i} of ${pageCount}`;
      this.doc.text(pageText, this.pageWidth - this.margins.right, this.footerTop, { align: 'right' });
    }

    const jsPdfArrayBuffer = this.doc.output('arraybuffer');
    let finalPdfBytes: Uint8Array;

    try {
      const response = await fetch('/letterhead.pdf');
      if (!response.ok) {
        throw new Error('Failed to load /letterhead.pdf');
      }
      const letterheadBytes = await response.arrayBuffer();

      const letterheadDoc = await PDFDocument.load(letterheadBytes);
      const contentDoc = await PDFDocument.load(jsPdfArrayBuffer);
      const finalDoc = await PDFDocument.create();

      const letterheadPage = await finalDoc.embedPage(letterheadDoc.getPage(0));
      const contentPages = await finalDoc.embedPages(contentDoc.getPages());
      const letterheadDims = letterheadPage.size();

      for (let i = 0; i < contentPages.length; i++) {
        const dims = contentPages[i].size();
        const page = finalDoc.addPage([dims.width, dims.height]);

        // The letterhead asset is US Letter (612x792pt) but content pages are A4
        // (595.28x841.89pt). Drawing it stretched to dims.width/height (as before) distorts
        // the artwork non-uniformly. Instead, scale to FIT (uniform scale, preserving aspect
        // ratio) so nothing is cut off, and center it — appropriate for a letterhead whose
        // artwork/margins should align consistently rather than be cropped.
        const fitScale = Math.min(dims.width / letterheadDims.width, dims.height / letterheadDims.height);
        const lhWidth = letterheadDims.width * fitScale;
        const lhHeight = letterheadDims.height * fitScale;
        const lhX = (dims.width - lhWidth) / 2;
        const lhY = (dims.height - lhHeight) / 2;

        page.drawPage(letterheadPage, {
          x: lhX,
          y: lhY,
          width: lhWidth,
          height: lhHeight,
        });

        page.drawPage(contentPages[i], {
          x: 0,
          y: 0,
          width: dims.width,
          height: dims.height,
        });
      }

      finalPdfBytes = await finalDoc.save();
    } catch (error) {
      console.error('Error merging letterhead:', error);
      finalPdfBytes = new Uint8Array(jsPdfArrayBuffer);
    }

    const blob = new Blob([finalPdfBytes], { type: 'application/pdf' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = fileName;
    link.click();
    return finalPdfBytes;
  }
}

