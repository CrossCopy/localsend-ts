import { type Client, type ClientOptions, type Config, type RequestOptions, type RequestResult } from "@hey-api/client-fetch"

type BuildUrlOptions = {
  url: string
  query?: Record<string, string>
}

/**
 * Simple Deno HTTP client adapter that uses Deno's native fetch API
 */
export class DenoClient {
  private config: Config<ClientOptions> = { baseUrl: "" }

  constructor(private baseUrl: string) {
    this.config.baseUrl = baseUrl
  }

  async get<TData = unknown, TError = unknown, ThrowOnError extends boolean = boolean>(
    options: RequestOptions<ThrowOnError, string>
  ): Promise<RequestResult<TData, TError, ThrowOnError>> {
    return this.request<TData, TError, ThrowOnError>({ ...options, method: 'GET' })
  }

  async post<TData = unknown, TError = unknown, ThrowOnError extends boolean = boolean>(
    options: RequestOptions<ThrowOnError, string>
  ): Promise<RequestResult<TData, TError, ThrowOnError>> {
    return this.request<TData, TError, ThrowOnError>({ ...options, method: 'POST' })
  }

  async request<TData = unknown, TError = unknown, ThrowOnError extends boolean = boolean>(
    options: RequestOptions<ThrowOnError, string>
  ): Promise<RequestResult<TData, TError, ThrowOnError>> {
    const { method = 'GET', url, body, headers, query } = options
    const urlObj = new URL(this.baseUrl + String(url))
    
    if (query) {
      Object.entries(query).forEach(([key, value]) => {
        urlObj.searchParams.append(key, String(value))
      })
    }

    try {
      const response = await fetch(urlObj.toString(), {
        method,
        headers: {
          "Content-Type": "application/json",
          ...headers
        },
        body: body ? JSON.stringify(body) : undefined
      })

      const data = await response.json()

      if (!response.ok) {
        return {
          data: undefined,
          error: data as TError,
          request: new Request(urlObj.toString()),
          response
        } as unknown as RequestResult<TData, TError, ThrowOnError>
      }

      return {
        data: data as TData,
        request: new Request(urlObj.toString()),
        response
      } as unknown as RequestResult<TData, TError, ThrowOnError>
    } catch (error) {
      return {
        data: undefined,
        error: error as TError,
        request: new Request(urlObj.toString()),
        response: new Response()
      } as unknown as RequestResult<TData, TError, ThrowOnError>
    }
  }

  buildUrl(options: any): string {
    const urlObj = new URL(this.baseUrl + String(options.url))
    if (options.query) {
      Object.entries(options.query).forEach(([key, value]) => {
        urlObj.searchParams.append(key, String(value))
      })
    }
    return urlObj.toString()
  }

  getConfig(): Config<ClientOptions> {
    return this.config
  }

  setConfig(config: Config<ClientOptions>): Config<ClientOptions> {
    this.config = config
    return config
  }
}

/**
 * Create a Deno-specific client
 */
export function createDenoClient(baseUrl: string): Client {
  return new DenoClient(baseUrl) as unknown as Client
} 