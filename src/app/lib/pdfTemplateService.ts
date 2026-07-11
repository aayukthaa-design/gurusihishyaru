import { jsPDF } from 'jspdf';
import autoTable, { UserOptions } from 'jspdf-autotable';
import { PDFDocument } from 'pdf-lib';

export class PDFTemplateService {
  public doc: jsPDF;
  public currentY: number;
  
  private headerHeight: number = 55; // Rendered height of the letterhead graphic (in mm)
  private footerTop: number;
  
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

    // Calculate printable body region below letterhead and above footer
    this.bodyTop = this.headerHeight + 7; // ensure content starts below the letterhead
    this.bodyBottom = this.footerTop - 10; // keep content above footer
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

  public addTitle(title: string) {
    this.checkPageBreak(25);
    this.doc.setFont('times', 'bold');
    this.doc.setFontSize(16);
    this.doc.setTextColor(0, 0, 0);
    this.doc.text(title, this.pageWidth / 2, this.currentY, { align: 'center', baseline: 'top' });
    this.currentY += 6 + 7;
  }

  public addMainHeading(heading: string) {
    this.checkPageBreak(20);
    this.doc.setFont('times', 'bold');
    this.doc.setFontSize(16);
    this.doc.setTextColor(0, 0, 0);
    this.doc.text(heading, this.margins.left, this.currentY, { align: 'left', baseline: 'top' });
    this.currentY += 6 + 8;
  }

  public addSectionHeading(heading: string) {
    this.checkPageBreak(18);
    this.doc.setFont('times', 'bold');
    this.doc.setFontSize(14);
    this.doc.setTextColor(0, 0, 0);
    this.doc.text(heading, this.margins.left, this.currentY, { align: 'left', baseline: 'top' });
    this.currentY += 5.5 + 8;
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
        top: 0,
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
        cellWidth: 'wrap',
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
      willDrawCell: (data) => {
        if (data.row.section === 'body' && data.cell.raw && typeof data.cell.raw === 'string') {
          const maxWidth = this.pageWidth - this.margins.left - this.margins.right - 6;
          data.cell.raw = this.doc.splitTextToSize(data.cell.raw, maxWidth);
        }
      },
    } as UserOptions;
  }

  public addTable(headers: string[][] | string[], body: any[][], options: UserOptions = {}) {
    const normalizedHeaders = this.normalizeTableHeaders(headers);

    if (this.currentY >= this.bodyBottom - 15) {
      this.doc.addPage();
      this.currentY = this.bodyTop;
    }

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

      const generatedText = 'This is a computer-generated document and does not require a signature.';
      this.doc.text(generatedText, this.margins.left, this.footerTop);

      const dateText = new Date().toLocaleString('en-IN');
      this.doc.text(`Generated: ${dateText}`, this.margins.left, this.footerTop + 5);

      this.doc.text('Confidential', this.pageWidth / 2, this.footerTop, { align: 'center' });

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

      for (let i = 0; i < contentPages.length; i++) {
        const dims = contentPages[i].size();
        const page = finalDoc.addPage([dims.width, dims.height]);

        page.drawPage(letterheadPage, {
          x: 0,
          y: 0,
          width: dims.width,
          height: dims.height,
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

