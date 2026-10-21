// 페이로드 앞 16바이트(발행 시각과 순번) 뒤의 문자열 변환
type Decoder = { decode(input: Uint8Array): string };

const Native = (globalThis as { TextDecoder?: new () => Decoder }).TextDecoder;
const native = Native === undefined ? undefined : new Native();

export const decoderName = native === undefined ? 'manual' : 'TextDecoder';

export function decode(item: ArrayBuffer) {
  const bytes = new Uint8Array(item, 16);
  if (native !== undefined) {
    return native.decode(bytes);
  }
  let text = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return text;
}

export function seqOf(item: ArrayBuffer) {
  return new DataView(item).getFloat64(8, true);
}
