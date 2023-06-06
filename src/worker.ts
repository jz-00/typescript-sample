import { Env } from "./env"
import { handleCdnRequest } from "./routes"

type Fetch = (
    request: Request,
    env: Env,
    ctx: ExecutionContext
) => Promise<Response>

export const fetch: Fetch = async (request, env): Promise<Response> => {
    const url = new URL(request.url)
    const params = { env, request, url }

    return (await handleCdnRequest(params)) ?? notFound()
}
