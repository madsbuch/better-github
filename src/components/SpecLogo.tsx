// A shared part's logo: a square picture in the spec folder.
// Spec: SC2, SC6

import { useQuery } from "@tanstack/react-query";
import { SPEC_DIR } from "../lib/spec";
import { repoQueries } from "../queries/repos";

/** The logo at `src` (a path from the spec folder) on `gitRef`; an empty square while it loads or when there is none. */
export function SpecLogo({ owner, repo, gitRef, src, size = 40 }: { owner: string; repo: string; gitRef: string; src: string | undefined; size?: number }) {
  const file = useQuery({ ...repoQueries.blob(owner, repo, gitRef, `${SPEC_DIR}/${src ?? ""}`), enabled: src !== undefined && gitRef !== "" });
  const url = file.data?.kind === "image" ? file.data.meta.download_url : null;
  return url !== null && url !== "" ? (
    <img className="spec-logo" src={url} width={size} height={size} alt="" />
  ) : (
    <span className="spec-logo" style={{ width: size, height: size }} aria-hidden="true" />
  );
}
