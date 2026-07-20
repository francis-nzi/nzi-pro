import fs from "fs";
import path from "path";
import { ImageResponse } from "next/og";

export const size = { width: 48, height: 48 };
export const contentType = "image/png";

export default function Icon() {
  const markPath = path.join(process.cwd(), "public", "netzero-mark.png");
  const markBase64 = fs.readFileSync(markPath).toString("base64");

  return new ImageResponse(
    (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`data:image/png;base64,${markBase64}`}
        width={size.width}
        height={size.height}
        alt=""
      />
    ),
    size
  );
}
