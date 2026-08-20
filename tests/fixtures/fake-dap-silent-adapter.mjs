let buffer = Buffer.alloc(0);

process.stdin.on('data', chunk => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const headerEnd = buffer.indexOf('\r\n\r\n');
    if (headerEnd < 0) return;
    const header = buffer.subarray(0, headerEnd).toString('utf8');
    const match = /Content-Length:\s*(\d+)/i.exec(header);
    if (!match) {
      buffer = buffer.subarray(headerEnd + 4);
      continue;
    }
    const length = Number(match[1]);
    const start = headerEnd + 4;
    if (buffer.length < start + length) return;
    const raw = buffer.subarray(start, start + length).toString('utf8');
    buffer = buffer.subarray(start + length);
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      continue;
    }
    if (message.command === 'initialize') {
      const response = JSON.stringify({ seq: message.seq, type: 'response', request_seq: message.seq, command: 'initialize', success: true, body: { capabilities: {} } });
      process.stdout.write(`Content-Length: ${Buffer.byteLength(response)}\r\n\r\n${response}`);
    }
  }
});