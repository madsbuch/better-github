import { createFileRoute } from "@tanstack/react-router";
import { SETTINGS_SECTIONS, type SettingsSection } from "../../lib/nav";
import { oneOf } from "../../lib/search-params";
import { SettingsScreen } from "../../screens/SettingsScreen";

export const Route = createFileRoute("/settings/$section")({
  params: {
    // Only the sections that exist; anything else isn't a settings page.
    parse: (raw): { section: SettingsSection } | false => {
      const section = oneOf(raw.section, SETTINGS_SECTIONS);
      return section === undefined ? false : { section };
    },
    stringify: (params) => ({ section: params.section }),
  },
  component: SectionRoute,
});

function SectionRoute() {
  const { section } = Route.useParams();
  return <SettingsScreen section={section} />;
}
