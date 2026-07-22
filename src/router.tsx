import { ConvexQueryClient } from "@convex-dev/react-query"
import { ConvexAuthProvider } from "@convex-dev/auth/react"
import { QueryClient } from "@tanstack/react-query"
import { createRouter as createTanStackRouter } from "@tanstack/react-router"
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query"
import { ConvexReactClient } from "convex/react"

import { clientEnv } from "@/config/env"

import { routeTree } from "./routeTree.gen"

export function getRouter() {
  const convexClient = new ConvexReactClient(clientEnv.VITE_CONVEX_URL, {
    unsavedChangesWarning: false,
  })
  const convexQueryClient = new ConvexQueryClient(convexClient)
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        queryFn: convexQueryClient.queryFn(),
        queryKeyHashFn: convexQueryClient.hashFn(),
      },
    },
  })

  convexQueryClient.connect(queryClient)

  const router = createTanStackRouter({
    routeTree,
    context: { convexClient, convexQueryClient, queryClient },
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
    scrollRestoration: true,
    Wrap: ({ children }) => (
      <ConvexAuthProvider client={convexClient}>{children}</ConvexAuthProvider>
    ),
  })

  setupRouterSsrQueryIntegration({ router, queryClient })

  return router
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
