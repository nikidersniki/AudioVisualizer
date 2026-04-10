function readID3Title(storedRecord) {
    return new Promise((resolve) => {
        const file = storedRecord.file;

        // WAV files never have ID3 tags — skip immediately
        if (!file || file.type === 'audio/wav' || file.name.endsWith('.wav')) {
            resolve(null);
            return;
        }

        if (!(file instanceof Blob)) {
            console.warn('Not a Blob:', file);
            resolve(null);
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            const buf = new Uint8Array(e.target.result);

            if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) {
                const title = parseID3v2(buf);
                if (title) { resolve(title); return; }
            }

            if (buf.length >= 128) {
                const tail = buf.slice(buf.length - 128);
                if (tail[0] === 0x54 && tail[1] === 0x41 && tail[2] === 0x47) {
                    const title = new TextDecoder('latin1')
                        .decode(tail.slice(3, 33))
                        .replace(/\0+$/, '').trim();
                    if (title) { resolve(title); return; }
                }
            }

            resolve(null);
        };

        reader.readAsArrayBuffer(file.slice(0, 256 * 1024));
    });
}

function parseID3v2(buf) {
  // ID3v2 tag size (bytes 6-9) uses 7 bits per byte (synchsafe)
  const tagSize =
    ((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) |
    ((buf[8] & 0x7f) <<  7) |  (buf[9] & 0x7f);

  const version = buf[3]; // 3 = ID3v2.3, 4 = ID3v2.4
  let offset = 10;       // frames start after the 10-byte header

  while (offset < tagSize) {
    // Frame ID: 4 chars (ID3v2.3/2.4) or 3 chars (ID3v2.2)
    const frameID = new TextDecoder()
      .decode(buf.slice(offset, offset + 4));

    if (!frameID.trim()) break; // padding

    // Frame size (bytes 4-7 of frame header)
    const frameSize = version === 4
      ? ((buf[offset+4] & 0x7f) << 21) | ((buf[offset+5] & 0x7f) << 14) |
        ((buf[offset+6] & 0x7f) <<  7) |  (buf[offset+7] & 0x7f)
      : (buf[offset+4] << 24) | (buf[offset+5] << 16) |
        (buf[offset+6] <<  8) |  buf[offset+7];

    if (frameSize <= 0) break;

    if (frameID === 'TIT2') { // Title frame
      const data = buf.slice(offset + 10, offset + 10 + frameSize);
      const encoding = data[0];
      const charset = encoding === 1 || encoding === 2 ? 'utf-16' : 'utf-8';
      return new TextDecoder(charset)
        .decode(data.slice(1))
        .replace(/^\uFEFF/, '') // strip BOM
        .replace(/\0+$/, '')
        .trim();
    }

    offset += 10 + frameSize; // advance to next frame
  }
  return null;
}