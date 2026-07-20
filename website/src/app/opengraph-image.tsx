import { ImageResponse } from "next/og";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
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
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 88,
            height: 88,
            borderRadius: 24,
            background: "linear-gradient(135deg, #174d2f, #2b7142)",
            color: "#f7f3ea",
            fontSize: 32,
            fontWeight: 700,
            letterSpacing: -1,
            marginBottom: 40,
          }}
        >
          NZI
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 56,
            fontWeight: 700,
            color: "#122018",
            lineHeight: 1.1,
            maxWidth: 900,
          }}
        >
          Net Zero International
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 28,
            color: "#5c685f",
            marginTop: 20,
            maxWidth: 820,
          }}
        >
          Carbon accounting, carbon reduction plans and Net Zero support
        </div>
      </div>
    ),
    size
  );
}
