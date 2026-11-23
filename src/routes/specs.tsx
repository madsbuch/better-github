import { createFileRoute } from "@tanstack/react-router";
import { optionalString } from "../lib/search-params";
import { SpecCatalogueScreen } from "../screens/SpecCatalogueScreen";

export const Route = createFileRoute("/specs")({
  // `into`: the repository the parts are for ("owner/repo"), when it was chosen first.
  validateSearch: (search: Record<string, unknown>): { into?: string | undefined } => ({ into: optionalString(search.into) }),
  component: SpecCatalogueScreen,
});
