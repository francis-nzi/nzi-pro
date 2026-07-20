import fs from "fs";
import path from "path";
import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  const markPath = path.join(process.cwd(), "public", "netzero-mark.png");
  const markBase64 = fs.readFileSync(markPath).toString("base64");

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#ffffff",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`data:image/png;base64,${markBase64}`}
          width={152}
          height={152}
          alt=""
        />
      </div>
    ),
    size
  );
}
