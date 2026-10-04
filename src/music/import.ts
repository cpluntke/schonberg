// Score file import: dispatch by extension (.musicxml/.xml/.mxl/.mid/.midi).
import { strFromU8, unzipSync } from 'fflate';
import type { Score } from './types';
import { parseMusicXML } from './musicxml';
import { parseMidi } from './midi';

/** Decode XML bytes honouring BOMs (UTF-8, UTF-16 LE/BE) and the encoding declaration. */
export function decodeXmlBytes(bytes: Uint8Array): string {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder('utf-8').decode(bytes.subarray(3));
  // UTF-16 without BOM: "<\0" or "\0<"
  if (bytes.length >= 2 && bytes[0] === 0x3c && bytes[1] === 0x00) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes.length >= 2 && bytes[0] === 0x00 && bytes[1] === 0x3c) return new TextDecoder('utf-16be').decode(bytes);
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 200));
  const enc = head.match(/encoding\s*=\s*["']([\w-]+)["']/i)?.[1]?.toLowerCase();
  if (enc && enc !== 'utf-8' && enc !== 'utf8') {
    try {
      return new TextDecoder(enc).decode(bytes);
    } catch {
      /* unknown label → fall through */
    }
  }
  return new TextDecoder('utf-8').decode(bytes);
}

/** Extract the root MusicXML document from an .mxl (zip) archive. */
export function extractMxl(data: Uint8Array): string {
  let files: ReturnType<typeof unzipSync>;
  try {
    files = unzipSync(data);
  } catch {
    throw new Error('Invalid MusicXML archive: this .mxl file could not be unzipped (damaged or incomplete download?)');
  }
  const names = Object.keys(files);
  let root: string | undefined;
  const container = names.find((n) => n.toLowerCase() === 'meta-inf/container.xml');
  if (container) {
    const xml = decodeXmlBytes(files[container]);
    const m = xml.match(/<rootfile[^>]*full-path\s*=\s*["']([^"']+)["']/i);
    if (m && files[m[1]]) root = m[1];
  }
  if (!root) {
    root = names.find((n) => !/^meta-inf\//i.test(n) && /\.(musicxml|xml)$/i.test(n));
  }
  if (!root) throw new Error('No MusicXML document found in .mxl archive');
  return decodeXmlBytes(files[root]);
}

function baseName(name: string): string {
  return name.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '');
}

export async function importScoreFile(name: string, data: ArrayBuffer): Promise<Score> {
  const bytes = new Uint8Array(data);
  const ext = (name.match(/\.([^.]+)$/)?.[1] ?? '').toLowerCase();
  if (ext === 'mid' || ext === 'midi' || ext === 'smf' || ext === 'kar') {
    return parseMidi(bytes, { title: baseName(name) });
  }
  if (ext === 'mxl' || (bytes[0] === 0x50 && bytes[1] === 0x4b)) {
    return withFallbackTitle(parseMusicXML(extractMxl(bytes)), name);
  }
  if (ext === 'musicxml' || ext === 'xml' || ext === '') {
    return withFallbackTitle(parseMusicXML(decodeXmlBytes(bytes)), name);
  }
  // sniff MIDI header
  if (bytes[0] === 0x4d && bytes[1] === 0x54 && bytes[2] === 0x68 && bytes[3] === 0x64) return parseMidi(bytes, { title: baseName(name) });
  throw new Error(`Unsupported file type ".${ext}" (use .musicxml, .xml, .mxl, .mid)`);
}

function withFallbackTitle(s: Score, name: string): Score {
  if (s.title === 'Untitled') s.title = baseName(name);
  return s;
}
