import QRCode from "qrcode";

/**
 * Generate a QR code as an SVG string.
 *
 * Uses the `qrcode` npm package under the hood, configured for
 * high error-correction (level "M") and the requested pixel size.
 *
 * @param data  The string to encode (typically `verification_uri_complete`).
 * @param size  Width and height of the SVG in pixels. Defaults to 256.
 * @returns     A complete SVG document as a string.
 */
export async function generateQRSvg(
  data: string,
  size: number = 256,
): Promise<string> {
  const svg = await QRCode.toString(data, {
    type: "svg",
    width: size,
    margin: 2,
    errorCorrectionLevel: "M",
  });
  return svg;
}

/**
 * Generate a QR code as a data URL suitable for use in `<img src="...">`.
 *
 * Returns a `data:image/svg+xml;base64,...` string.
 *
 * @param data  The string to encode.
 * @param size  Width and height in pixels. Defaults to 256.
 */
export async function generateQRDataUrl(
  data: string,
  size: number = 256,
): Promise<string> {
  const svg = await generateQRSvg(data, size);
  const base64 = btoa(svg);
  return `data:image/svg+xml;base64,${base64}`;
}
