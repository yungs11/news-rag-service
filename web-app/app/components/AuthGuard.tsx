"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { isLoggedIn } from "@/lib/auth";

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (pathname !== "/login" && !isLoggedIn()) {
      router.replace("/login");
    }
  }, [pathname, router]);

  if (pathname !== "/login" && !isLoggedIn()) {
    return null;
  }

  return <>{children}</>;
}
