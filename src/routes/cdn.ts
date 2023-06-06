import { Env } from "../env"
import { getUser, User } from "../auth"
import { HandleRouteRequest } from "./types"

export interface MediaId {
    access: string
    uid: string
    filename: string
}

const getMediaKey = ({ access, uid, filename }: MediaId): string => {
    return `${access}/${uid}/${filename}`
}

export interface MediaParams {
    env: Env
    request: Request
    user?: User
    media: MediaId
}

const handleAuthorized = async ({
    authorized,
    handler,
}: {
    authorized: boolean
    handler: () => Promise<Response>
}) => {
    return authorized ? handler() : forbidden()
}

const getMedia = async ({
    env,
    user,
    media,
}: MediaParams): Promise<Response> => {
    return handleAuthorized({
        authorized:
            media.access === MediaAccess.PUBLIC || media.uid === user?.uid,
        handler: async () => {
            const key = getMediaKey(media)
            const obj = await env.CF_BUCKET.get(key)

            if (obj) {
                const headers = new Headers()
                obj.writeHttpMetadata(headers)
                headers.append("Content-Length", obj.size.toString())
                return new Response(obj.body, { headers })
            } else {
                return notFound()
            }
        },
    })
}

const postMedia = async ({ env, request, user, media }: MediaParams) => {
    return handleAuthorized({
        authorized:
            (media.access === MediaAccess.PUBLIC && !!user?.uid) ||
            (media.access === MediaAccess.USER && media.uid === user?.uid),
        handler: async () => {
            const key = getMediaKey(media)
            const obj = await env.CF_BUCKET.head(key)

            if (!obj) {
                const httpMetadata = new Headers()
                const contentType = request.headers.get("Content-Type")

                if (contentType) {
                    httpMetadata.append("Content-Type", contentType)
                }

                await env.CF_BUCKET.put(key, request.body, {
                    httpMetadata,
                })

                const replaceFilename = request.headers.get(
                    CustomHeader.REPLACE
                )

                if (replaceFilename) {
                    const deleted = await deleteMedia({
                        env,
                        request,
                        user,
                        media: { ...media, filename: replaceFilename },
                    })

                    if (deleted.status !== HTTP.OK.status) {
                        logger.error(deleted)
                    }
                }

                return ok()
            } else {
                logger.warn("postMedia: key already in use:", key)
                return badRequest("key already in use")
            }
        },
    })
}

const deleteMedia = async ({ env, user, media }: MediaParams) => {
    return handleAuthorized({
        authorized: media.uid === user?.uid,
        handler: async () => {
            const key = getMediaKey(media)
            const obj = await env.CF_BUCKET.head(key)

            if (obj) {
                await env.CF_BUCKET.delete(key)
                return ok()
            } else {
                return notFound()
            }
        },
    })
}

export const handleMediaRequest = async (
    params: MediaParams
): Promise<Response> => {
    switch (params.request.method) {
        case MediaOp.GET:
            return getMedia(params)
        case MediaOp.POST:
            return postMedia(params)
        case MediaOp.DELETE:
            return deleteMedia(params)
        default:
            return methodNotAllowed(params.request)
    }
}

export const listMedia = async ({ env }: { env: Env }): Promise<Response> => {
    const objs = await env.CF_BUCKET.list({ limit: 10 })
    return new Response(JSON.stringify(objs.objects, null, 4))
}

export const handleCdnRequest: HandleRouteRequest = async ({
    env,
    request,
    url,
}) => {
    if (url.hostname === env.CDN_PATH) {
        // testing...
        if (env.ENVIRONMENT === "development" && url.pathname === "/list") {
            return listMedia({ env })
        }
        // ...testing

        const media = parseMediaFilepath(url.pathname)

        if (media) {
            const user = await getUser({ env, request })

            return handleMediaRequest({
                env,
                request,
                user,
                media,
            })
        } else {
            logger.warn("handleCdnRequest: invalid path:", url.pathname)
            return badRequest("invalid path")
        }
    }
}
