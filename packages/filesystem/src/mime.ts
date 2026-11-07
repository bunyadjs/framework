import { extname } from "node:path";

/** File extension (lower case, with the dot) to MIME type, for every disk. */
const MIME_BY_EXT: Record<string, string> = {
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".html": "text/html",
  ".htm": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".json": "application/json",
  ".xml": "application/xml",
  ".pdf": "application/pdf",
  ".zip": "application/zip",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

export const DEFAULT_MIME_TYPE = "application/octet-stream";

/** The MIME type for a path, from its extension; `application/octet-stream` when it is not known. */
export function mimeTypeForPath(path: string): string {
  return MIME_BY_EXT[extname(path).toLowerCase()] ?? DEFAULT_MIME_TYPE;
}
