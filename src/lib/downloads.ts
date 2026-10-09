// Downloading release assets and source archives.
//
// Rust resolves GitHub's download redirect to a short-lived signed link
// (src-tauri/src/github.rs), which Android's download manager then fetches
// (Downloads.kt): progress in a notification, the file in Downloads,
// opened when tapped. Without that bridge (desktop, browser) the link opens
// in the browser, which downloads it.

import { backend, type DownloadTarget } from "./backend";
import { useAppMutation } from "../queries/mutation";

export interface DownloadFile {
  name: string;
  contentType: string;
}

export function useDownload() {
  return useAppMutation({
    mutationFn: async ({ target, file }: { target: DownloadTarget; file: DownloadFile }) => {
      const url = await backend.downloadUrl(target);
      if (window.GhCommanderDownloads?.download(url, file.name, file.contentType)) return "manager" as const;
      await backend.openUrl(url);
      return "browser" as const;
    },
    success: ({ file }, how) => (how === "manager" ? `Downloading ${file.name}…` : null),
  });
}
