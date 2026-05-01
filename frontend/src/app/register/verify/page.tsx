import { Suspense } from "react";
import RegisterVerifyClient from "./verify-client";

export default function RegisterVerifyPage() {
  return (
    <Suspense fallback={null}>
      <RegisterVerifyClient />
    </Suspense>
  );
}
