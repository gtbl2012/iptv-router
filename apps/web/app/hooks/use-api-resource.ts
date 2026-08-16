import * as React from "react"

interface FrontendEnvironment {
  VITE_DEMO_MODE?: string
}

const environment = import.meta.env as unknown as FrontendEnvironment

export const DEMO_MODE = environment.VITE_DEMO_MODE === "true"

type ResourceStatus = "loading" | "ready" | "offline" | "demo"

interface ResourceState<T> {
  status: ResourceStatus
  data: T | null
  error: string | null
  refresh: () => void
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "API 请求失败"
}

export function useApiResource<T>(
  loader: (signal: AbortSignal) => Promise<T>,
  demoData?: T
): ResourceState<T> {
  const [revision, setRevision] = React.useState(0)
  const [state, setState] = React.useState<Omit<ResourceState<T>, "refresh">>({
    status: "loading",
    data: null,
    error: null,
  })

  React.useEffect(() => {
    const controller = new AbortController()

    void loader(controller.signal)
      .then((data) => setState({ status: "ready", data, error: null }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        if (DEMO_MODE && demoData !== undefined) {
          setState({
            status: "demo",
            data: demoData,
            error: errorMessage(error),
          })
          return
        }
        setState({ status: "offline", data: null, error: errorMessage(error) })
      })

    return () => controller.abort()
  }, [demoData, loader, revision])

  const refresh = React.useCallback(() => {
    setState((current) => ({
      status: "loading",
      data: current.data,
      error: null,
    }))
    setRevision((current) => current + 1)
  }, [])

  return { ...state, refresh }
}
