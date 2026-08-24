import type { QueryClient } from "@tanstack/react-query";
import {
  getGetDispatchQueryKey,
  getGetViajeQueryKey,
  getListDispatchesQueryKey,
  getListSalesQueryKey,
  getListTrasladosQueryKey,
  getListViajesQueryKey,
} from "@workspace/api-client-react";

/**
 * The planning queues and trip views describe the same operational membership.
 * Remove before invalidating so an HTTP 304 cannot keep an operator on stale data.
 */
export function refreshViajeOperationalData(
  queryClient: QueryClient,
  options: { viajeId?: number; dispatchIds?: number[] } = {},
) {
  const keys = [
    getListSalesQueryKey(),
    getListTrasladosQueryKey(),
    getListDispatchesQueryKey(),
    getListViajesQueryKey(),
    ...(options.viajeId ? [getGetViajeQueryKey(options.viajeId)] : []),
    ...(options.dispatchIds ?? []).map((id) => getGetDispatchQueryKey(id)),
  ];

  for (const queryKey of keys) {
    queryClient.removeQueries({ queryKey });
    queryClient.invalidateQueries({ queryKey });
  }
}
