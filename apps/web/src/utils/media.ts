/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */


export function mimeTypeToExtension(mimeType: string): string {
  const normalizedMimeType = mimeType.toLowerCase().trim().split(';')[0].trim();

  const mimeToExtMap: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/svg+xml': '.svg',
    'image/bmp': '.bmp',
    'image/tiff': '.tiff',
    'image/x-icon': '.ico',
    'image/vnd.microsoft.icon': '.ico',
    'image/avif': '.avif',
    'image/heic': '.heic',
    'image/heif': '.heif',

    'application/pdf': '.pdf',
    'text/plain': '.txt',

    'audio/mpeg': '.mp3',
    'audio/mp3': '.mp3',
    'audio/wav': '.wav',
    'audio/wave': '.wav',
    'audio/x-wav': '.wav',
    'audio/ogg': '.ogg',
    'audio/aac': '.aac',
    'audio/m4a': '.m4a',
    'audio/flac': '.flac',
    'audio/webm': '.webm',

    'video/mp4': '.mp4',
    'video/mpeg': '.mpeg',
    'video/quicktime': '.mov',
    'video/x-msvideo': '.avi',
    'video/webm': '.webm',
    'video/ogg': '.ogv',
    'video/3gpp': '.3gp',
    'video/x-flv': '.flv',
    'video/x-ms-wmv': '.wmv',

    'text/html': '.html',
    'text/javascript': '.js',
    'application/javascript': '.js',
    'application/json': '.json',
    'application/x-subrip': '.srt',
    'text/vtt': '.vtt',
    'text/xml': '.xml',
    'application/xml': '.xml',
  };

  return mimeToExtMap[normalizedMimeType] || '.bin';
}

export function stripExtension(name: string): string {
  const dotIndex = name.lastIndexOf('.');
  if (dotIndex <= 0) return name;
  return name.slice(0, dotIndex);
}
