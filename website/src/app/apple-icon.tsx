import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #174d2f, #2b7142)",
          color: "#f7f3ea",
          fontSize: 64,
          fontWeight: 700,
          letterSpacing: -2,
        }}
      >
        NZI
      </div>
    ),
    size
  );
}
