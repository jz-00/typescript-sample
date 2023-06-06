import { Env } from '../env'

export interface HandleRouteRequestParams {
    env: Env
    request: Request
    url: URL
}

export type HandleRouteRequest = (
    params: HandleRouteRequestParams
) => Promise<Response | undefined>
