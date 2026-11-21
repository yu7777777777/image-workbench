export interface LatestRelease {
  tag: string
  url: string
}

export function useVersionCheck() {
  return {
    latestRelease: null,
    dismiss: () => {},
  }
}
