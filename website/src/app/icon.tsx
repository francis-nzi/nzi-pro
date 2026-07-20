import { ImageResponse } from "next/og";

export const size = { width: 48, height: 48 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 12,
          background: "linear-gradient(135deg, #174d2f, #2b7142)",
          color: "#f7f3ea",
          fontSize: 20,
          fontWeight: 700,
          letterSpacing: -1,
        }}
      >
        NZI
      </div>
    ),
    size
  );
}
