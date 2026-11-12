import * as React from "react"

const MOBILE_BREAKPOINT = 768
const QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

function subscribe(callback: () => void) {
  const mql = window.matchMedia(QUERY)
  mql.addEventListener("change", callback)
  return () => mql.removeEventListener("change", callback)
}

/**
 * Reactive `window.innerWidth < 768` flag.
 *
 * Implemented with `useSyncExternalStore` instead of the previous
 * setState-inside-an-effect pattern (which the React lint rules reject and
 * which rendered one frame with a wrong value). The server snapshot is
 * always `false`, matching the previous SSR behaviour.
 */
export function useIsMobile() {
  return React.useSyncExternalStore(
    subscribe,
    () => window.innerWidth < MOBILE_BREAKPOINT,
    () => false,
  )
}
