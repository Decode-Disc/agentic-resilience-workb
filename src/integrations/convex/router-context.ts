import type { ConvexQueryClient } from "@convex-dev/react-query"
import type { QueryClient } from "@tanstack/react-query"
import type { ConvexReactClient } from "convex/react"

export interface AppRouterContext {
  convexClient: ConvexReactClient
  convexQueryClient: ConvexQueryClient
  queryClient: QueryClient
}
