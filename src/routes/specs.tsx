import { createFileRoute } from "@tanstack/react-router";
import { optionalString } from "../lib/search-params";
import { SpecCatalogueScreen } from "../screens/SpecCatalogueScreen";

export const Route = createFileRoute("/specs")({
  // `into`: the repository the parts are for ("owner/repo"), when it was chosen first.
  // `from` and `part`: a catalogue and a shared part's permanent id, to open that part straight away (an update).
  validateSearch: (search: Record<string, unknown>): { into?: string | undefined; from?: string | undefined; part?: string | undefined } => ({
    into: optionalString(search.into),
    from: optionalString(search.from),
    part: optionalString(search.part),
  }),
  component: SpecCatalogueScreen,
});
