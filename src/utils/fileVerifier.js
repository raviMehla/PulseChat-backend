/**
 * Verifies if the file buffer contents match the declared MIME type using standard binary magic numbers.
 * Supports checking standard image, video, zip, and pdf signatures to prevent MIME spoofing.
 *
 * @param {Buffer} buffer - The file buffer.
 * @param {string} declaredMime - The client-supplied MIME type string.
 * @returns {boolean} True if the content matches or is allowed under generic file types.
 */
export const verifyFileMimeType = (buffer, declaredMime) => {
  if (!buffer || buffer.length < 4) return false;

  const header = buffer.toString("hex", 0, 4).toUpperCase();
  const asciiHeader = buffer.toString("ascii", 0, 4);

  // 1. JPEG: FFD8FF
  if (header.startsWith("FFD8FF")) {
    return declaredMime.startsWith("image/jpeg") || declaredMime.startsWith("image/");
  }

  // 2. PNG: 89504E47
  if (header === "89504E47") {
    return declaredMime.startsWith("image/png") || declaredMime.startsWith("image/");
  }

  // 3. GIF: GIF8 (GIF87a / GIF89a)
  if (asciiHeader.startsWith("GIF8")) {
    return declaredMime.startsWith("image/gif") || declaredMime.startsWith("image/");
  }

  // 4. WEBP: RIFF at offset 0 and WEBP at offset 8
  if (asciiHeader.startsWith("RIFF") && buffer.length >= 12 && buffer.toString("ascii", 8, 12) === "WEBP") {
    return declaredMime.startsWith("image/webp") || declaredMime.startsWith("image/");
  }

  // 5. PDF: %PDF
  if (asciiHeader.startsWith("%PDF")) {
    return declaredMime === "application/pdf" || declaredMime.startsWith("application/") || declaredMime.startsWith("file/");
  }

  // 6. ZIP: PK (504B0304)
  if (header === "504B0304") {
    return declaredMime.startsWith("application/zip") || declaredMime.startsWith("application/x-zip") || declaredMime.startsWith("file/");
  }

  // 7. MP4: ftyp at offset 4
  if (buffer.length >= 12 && buffer.toString("ascii", 4, 8) === "ftyp") {
    return declaredMime.startsWith("video/mp4") || declaredMime.startsWith("video/");
  }

  // If the file is declared as an image or a video, but it did not match any of the standard image/video signatures above, reject it.
  if (declaredMime.startsWith("image/") || declaredMime.startsWith("video/")) {
    return false;
  }

  // Allow other generic files (txt, documents, etc.)
  return true;
};
