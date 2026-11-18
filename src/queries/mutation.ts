import {
  useMutation,
  useQueryClient,
  type QueryClient,
  type QueryFilters,
  type QueryKey,
  type UseMutationResult,
} from "@tanstack/react-query";
import { errorMessage } from "../lib/api";
import { toast } from "../lib/toast";

interface AppMutationOptions<TVars, TData> {
  mutationFn: (vars: TVars) => Promise<TData>;
  /**
   * Query key prefixes this changes (see `affects` in keys.ts). They are
   * invalidated after success, and the mutation resolves once the queries on
   * screen have refetched, so the UI never shows the pre-mutation state.
   */
  invalidates?: readonly QueryKey[] | ((vars: TVars, data: TData) => readonly QueryKey[]);
  /** Updates the cache right away; return the undo, which runs on failure. */
  optimistic?: (vars: TVars, queryClient: QueryClient) => Promise<Undo> | Undo;
  /** Toast shown on success. */
  success?: string | ((vars: TVars, data: TData) => string | null);
  /** Show GitHub's error message as a toast. Defaults to true. */
  toastErrors?: boolean;
}

export type Undo = () => void;

/** `useMutation` with the app's invalidation, optimistic update and toast conventions. */
export function useAppMutation<TVars = void, TData = unknown>(
  options: AppMutationOptions<TVars, TData>,
): UseMutationResult<TData, unknown, TVars, { undo?: Undo }> {
  const queryClient = useQueryClient();
  return useMutation<TData, unknown, TVars, { undo?: Undo }>({
    mutationFn: options.mutationFn,
    onMutate: async (vars) => (options.optimistic ? { undo: await options.optimistic(vars, queryClient) } : {}),
    onError: (error, _vars, context) => {
      context?.undo?.();
      if (options.toastErrors !== false) toast.show(errorMessage(error), "error");
    },
    onSuccess: async (data, vars) => {
      const message = typeof options.success === "function" ? options.success(vars, data) : options.success;
      if (message !== null && message !== undefined && message !== "") toast.show(message, "success");
      const stale = typeof options.invalidates === "function" ? options.invalidates(vars, data) : (options.invalidates ?? []);
      await Promise.all(stale.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
    },
  });
}

/**
 * Optimistically rewrites every cached query matching `filters` and returns
 * an undo. In-flight fetches are cancelled first so they can't overwrite the
 * optimistic value.
 */
export async function patchQueries<T>(
  queryClient: QueryClient,
  filters: QueryFilters,
  update: (old: T) => T,
): Promise<Undo> {
  await queryClient.cancelQueries(filters);
  const previous = queryClient.getQueriesData<T>(filters);
  for (const [queryKey, data] of previous) {
    if (data !== undefined) queryClient.setQueryData<T>(queryKey, update(data));
  }
  return () => previous.forEach(([queryKey, data]) => queryClient.setQueryData(queryKey, data));
}
