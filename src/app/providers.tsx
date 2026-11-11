"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { useState } from "react";
import { LanguageProvider } from "@/components/providers/language-provider";
import { NamesProvider } from "@/components/providers/names-provider";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 15_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  );

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <LanguageProvider>
        <NamesProvider>
          <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        </NamesProvider>
      </LanguageProvider>
    </ThemeProvider>
  );
}
