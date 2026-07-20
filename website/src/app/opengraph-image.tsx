import fs from "fs";
import path from "path";
import { ImageResponse } from "next/og";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  const logoPath = path.join(process.cwd(), "public", "netzero-logo.png");
  const logoBase64 = fs.readFileSync(logoPath).toString("base64");

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px",
          background: "linear-gradient(135deg, #f7f3ea 0%, #efe7d6 100%)",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`data:image/png;base64,${logoBase64}`}
          width={420}
          height={165}
          alt=""
          style={{ marginBottom: 48 }}
        />
        <div
          style={{
            display: "flex",
            fontSize: 40,
            fontWeight: 700,
            color: "#122018",
            lineHeight: 1.2,
            maxWidth: 900,
          }}
        >
          Carbon accounting, carbon reduction plans and Net Zero support
        </div>
      </div>
    ),
    size
  );
}
