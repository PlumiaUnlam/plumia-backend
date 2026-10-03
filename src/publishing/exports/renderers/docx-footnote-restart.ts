import JSZip from 'jszip';

const DOCUMENT_XML_PATH = 'word/document.xml';
const SECT_PR_OPEN = /<w:sectPr\b[^>]*>/g;
const FOOTNOTE_RESTART_XML =
  '<w:footnotePr><w:numRestart w:val="eachPage"/></w:footnotePr>';

/**
 * Patches a generated .docx buffer so Word restarts footnote numbering on
 * every physical page at display/print time (product requirement). The
 * `docx` package (v9.5.1) has no API for OOXML's `w:footnotePr/w:numRestart`,
 * so this injects it directly into word/document.xml after Packer.toBuffer().
 *
 * Our document always has exactly two sections (cover page, then content).
 * Per OOXML's CT_SectPr child order, the LAST section's properties are the
 * final `<w:sectPr>` emitted as a direct child of `<w:body>` — confirmed
 * empirically to be the content section (it carries `pgNumType w:start="1"`).
 * `w:footnotePr` must come after `w:headerReference`/`w:footerReference` (if
 * present) and before `w:type`/`w:pgSz` — inserting right before that
 * section's `<w:pgSz` satisfies the schema regardless of whether header/
 * footer references are present.
 *
 * Endnotes are intentionally left untouched: Word's native continuous
 * per-document numbering already satisfies "endnotes never reset".
 */
export async function restartFootnotesEachPage(
  buffer: Buffer,
): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.files[DOCUMENT_XML_PATH]?.async('string');
  if (!xml) {
    return buffer;
  }

  const sectPrOpenMatches = [...xml.matchAll(SECT_PR_OPEN)];
  const lastSectPrOpen = sectPrOpenMatches[sectPrOpenMatches.length - 1];
  if (!lastSectPrOpen || lastSectPrOpen.index === undefined) {
    return buffer;
  }

  const contentSectionStart = lastSectPrOpen.index + lastSectPrOpen[0].length;
  const pgSzIndex = xml.indexOf('<w:pgSz', contentSectionStart);
  const insertAt = pgSzIndex === -1 ? contentSectionStart : pgSzIndex;

  const patchedXml =
    xml.slice(0, insertAt) + FOOTNOTE_RESTART_XML + xml.slice(insertAt);

  zip.file(DOCUMENT_XML_PATH, patchedXml);
  return zip.generateAsync({ type: 'nodebuffer' });
}
