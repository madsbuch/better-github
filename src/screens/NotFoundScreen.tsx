import { Screen } from "../components/Screen";
import { EmptyState } from "../components/ui";
import { useNav } from "../lib/nav";

export function NotFoundScreen() {
  const nav = useNav();
  return (
    <Screen title="Not found">
      <EmptyState title="Nothing here">This link isn't something the app can open.</EmptyState>
      <div className="center" style={{ paddingTop: 0 }}>
        <button className="btn" onClick={nav.back}>
          Go back
        </button>
      </div>
    </Screen>
  );
}
