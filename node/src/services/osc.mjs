const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);

export function encodeOsc9(message) {
  const clean = String(message).replace(new RegExp('[' + ESC + BEL + ']', 'g'), '');
  return ESC + ']9;' + clean + BEL;
}

export function encodeOsc777(message) {
  const clean = String(message).replace(new RegExp('[' + ESC + BEL + ']', 'g'), '');
  return ESC + ']777;notify;AIDE;' + clean + BEL;
}
