import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { imageSize } from './image-size.ts';

/** Re-exported so callers need only this module. */
export const imageSizeOf = imageSize;

/**
 * Resizing, without taking on a dependency for it.
 *
 * A 1200×1200 photograph shown in a 68px swatch is 400 kB of bandwidth to
 * render a thumbnail — on one product page that added up to 7.5 MB, which on a
 * phone on 4G is most of your visitors leaving before anything appears.
 *
 * There is no way to re-encode an image in pure Node, so this uses whatever the
 * machine already has. `sips` ships with macOS and `magick` with ImageMagick;
 * `sharp` is used when it happens to be installed but is never required. When
 * none is available it says so and the original is kept, rather than failing
 * an import over a thumbnail.
 */
export type Resizer = 'magick' | 'convert' | 'cwebp' | 'sips' | null;

const available = new Map<string, boolean>();
function has(tool: string): boolean {
  const known = available.get(tool);
  if (known !== undefined) return known;
  try {
    // Args go to sh directly rather than through `shell: true`, which would
    // concatenate them unescaped.
    execFileSync('/bin/sh', ['-c', `command -v ${tool}`], { stdio: 'ignore' });
    available.set(tool, true);
    return true;
  } catch {
    available.set(tool, false);
    return false;
  }
}

/**
 * The right tool depends on the format, not only on what is installed.
 *
 * `sips` ships with macOS and will happily *read* a WebP and then write
 * nothing at all when asked for one back — which is how a resize pass reports
 * success and changes not a single byte. WebP goes to `cwebp`, libwebp's own
 * encoder; ImageMagick handles anything, when it is there.
 */
export function resizerFor(ext: string): Resizer {
  const webp = ext.toLowerCase() === '.webp';
  if (webp && has('cwebp')) return 'cwebp';
  if (has('magick')) return 'magick';
  if (has('convert')) return 'convert';
  if (!webp && has('sips')) return 'sips';
  return null;
}

/** True when at least one format can be resized on this machine. */
export function findResizer(): Resizer {
  return resizerFor('.webp') ?? resizerFor('.jpg');
}

export function resizerName(): string {
  return [
    resizerFor('.webp') ? `webp via ${resizerFor('.webp')}` : 'webp: none (brew install webp)',
    resizerFor('.jpg') ? `jpeg/png via ${resizerFor('.jpg')}` : 'jpeg/png: none',
  ].join(', ');
}

/**
 * Re-encode `buf` so its longest side is at most `width`, keeping the format.
 * Returns null when there is no resizer for this format, when the image is
 * already smaller, or when the result would not be smaller on the wire.
 */
export function resize(buf: Buffer, width: number, ext: string): Buffer | null {
  const tool = resizerFor(ext);
  if (!tool) return null;
  const size = imageSize(buf);
  if (size && Math.max(size.width, size.height) <= width) return null;

  const dir = mkdtempSync(join(tmpdir(), 'oxj-rs-'));
  const src = join(dir, 'in' + ext);
  const out = join(dir, 'out' + ext);
  try {
    writeFileSync(src, buf);
    if (tool === 'cwebp') {
      // A "0" means derive that axis from the aspect ratio, so pin whichever
      // side is longer or a portrait image comes back wider than asked for.
      const portrait = size ? size.height > size.width : false;
      const dims = portrait ? ['-resize', '0', String(width)] : ['-resize', String(width), '0'];
      execFileSync('cwebp', [...dims, '-q', '82', src, '-o', out], { stdio: 'ignore' });
    } else if (tool === 'sips') {
      // sips writes in place unless told otherwise, hence --out.
      execFileSync('sips', ['-Z', String(width), src, '--out', out], { stdio: 'ignore' });
    } else {
      // ">" means "only shrink", so a small source is never upscaled.
      execFileSync(tool, [src, '-resize', `${width}x${width}>`, '-quality', '82', out], { stdio: 'ignore' });
    }
    if (!existsSync(out)) return null;
    const result = readFileSync(out);
    // A "resize" that grew the file is not one worth serving.
    return result.length > 0 && result.length < buf.length ? result : null;
  } catch {
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Gallery widths: 160 for a thumbnail strip, 400 a phone card, 800 a phone
 * hero, 1200 a desktop hero. Without the 160 a row of six 64px thumbnails
 * pulls six 400px files — 300 kB to draw 24 mm of screen.
 */
export const GALLERY_WIDTHS = [160, 400, 800, 1200];

/**
 * A swatch is two things at once: a 68 px chip, and — on click — the hero
 * image, because each colourway is its own photograph. So the stored file is
 * kept big enough to be a hero on a phone, and the chip is served from the
 * small siblings beside it.
 */
export const SWATCH_WIDTH = 800;
export const SWATCH_CHIP_WIDTHS = [160, 320];

/** "01.webp" + 400 → "01-400.webp". The convention the storefront's srcset uses. */
export function widthVariantPath(path: string, width: number): string {
  const dot = path.lastIndexOf('.');
  return dot === -1 ? `${path}-${width}` : `${path.slice(0, dot)}-${width}${path.slice(dot)}`;
}

/**
 * Crop an inset percentage off every edge, keeping the format.
 *
 * Supplier photographs often carry their own spec overlay — "Wt: 8.40g/pair",
 * "Material: Alloy", dimension arrows — burnt into the image at the edges with
 * the piece centred. It is invisible in a 68px chip and looks like someone
 * else's packaging the moment the image becomes the hero. There is nothing to
 * do about it but crop, or reshoot.
 */
export function cropInset(buf: Buffer, percent: number, ext: string): Buffer | null {
  const tool = resizerFor(ext);
  const size = imageSize(buf);
  if (!tool || !size || percent <= 0 || percent >= 40) return null;

  const dx = Math.round((size.width * percent) / 100);
  const dy = Math.round((size.height * percent) / 100);
  const w = size.width - dx * 2;
  const h = size.height - dy * 2;
  if (w < 100 || h < 100) return null;

  const dir = mkdtempSync(join(tmpdir(), 'oxj-cr-'));
  const src = join(dir, 'in' + ext);
  const out = join(dir, 'out' + ext);
  try {
    writeFileSync(src, buf);
    if (tool === 'cwebp') {
      execFileSync('cwebp', ['-crop', String(dx), String(dy), String(w), String(h), '-q', '86', src, '-o', out], { stdio: 'ignore' });
    } else if (tool === 'sips') {
      // sips crops from the centre outwards, which is what an even inset is.
      execFileSync('sips', ['-c', String(h), String(w), src, '--out', out], { stdio: 'ignore' });
    } else {
      execFileSync(tool, [src, '-crop', `${w}x${h}+${dx}+${dy}`, '+repage', '-quality', '86', out], { stdio: 'ignore' });
    }
    if (!existsSync(out)) return null;
    const result = readFileSync(out);
    return result.length > 0 ? result : null;
  } catch {
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
