/**
 * Simple Deno HTTP client adapter that uses Deno's native fetch API
 */
export class DenoClient {
  constructor(private baseUrl: string) {}

  async get<T = unknown>(url: string | { url: string }, options: { headers?: HeadersInit } = {}): Promise<T> {
    const path = typeof url === 'string' ? url : url.url
    const response = await fetch(this.baseUrl + path, {
      method: "GET",
      headers: options.headers
    })

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    return response.json()
  }

  async post<T = unknown>(
    url: string | { url: string },
    options: {
      body?: unknown
      headers?: HeadersInit
      query?: Record<string, string>
    } = {}
  ): Promise<T> {
    const path = typeof url === 'string' ? url : url.url
    const urlObj = new URL(this.baseUrl + path)
    if (options.query) {
      Object.entries(options.query).forEach(([key, value]) => {
        urlObj.searchParams.append(key, value)
      })
    }

    // Handle body from SDK format
    let requestBody: string | undefined
    if (options.body) {
      // If body is an object with a 'body' property, use that
      if (typeof options.body === 'object' && 'body' in options.body) {
        // For Hono's validator, we need to send the body directly without wrapping
        const body = (options.body as any).body
        requestBody = JSON.stringify({
          ...body,
          deviceModel: body.deviceModel || "",
          deviceType: body.deviceType || "desktop"
        })
      } else {
        requestBody = JSON.stringify(options.body)
      }
    }

    try {
      const response = await fetch(urlObj.toString(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...options.headers
        },
        body: requestBody
      })

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({ message: "Unknown error" }))
        throw new Error(`HTTP error! status: ${response.status}, message: ${errorBody.message}`)
      }

      return response.json()
    } catch (error) {
      console.error("Error making request:", error)
      throw error
    }
  }
}

/**
 * Create a Deno-specific client
 */
export function createDenoClient(baseUrl: string): DenoClient {
  return new DenoClient(baseUrl)
} 