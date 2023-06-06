import { Env } from "./env"

// Verify and decode Google JWT in a Cloudflare Worker

export interface User {
    uid: string
}

export const getUser = async ({
    env,
    request,
}: {
    env: Env
    request: Request
}): Promise<User | undefined> => {
    // extract JWT from request Authorization header
    const [, token] =
        /^Bearer\s+(.+)$/.exec(request.headers.get("Authorization") ?? "") ?? []

    return token ? verifyIdToken({ env, token }) : undefined
}

const GOOGLE_JWKS_KEY = "jwks"

const getGoogleJWKS = async ({
    env,
}: {
    env: Env
}): Promise<ReturnType<typeof createLocalJWKSet>> => {
    // check cache for JWKS used to verify JWT
    let jwks = await env.GOOGLE_AUTH_KV.get<JSONWebKeySet>(GOOGLE_JWKS_KEY, {
        type: "json",
    })

    if (!jwks) {
        logger.log("Requesting Google JWKS")
        const response = await fetch(
            "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"
        )
        jwks = await response.json()

        // extract TTL from header
        const [, publicKeysTTLStr] =
            response.headers.get("cache-control")?.match(/\s+max-age=(\S+)/) ||
            []
        const keysTTL = parseInt(publicKeysTTLStr || "0")

        logger.log(`Caching Google JWKS, TTL ${keysTTL}`)
        env.GOOGLE_AUTH_KV.put(GOOGLE_JWKS_KEY, JSON.stringify(jwks), {
            expirationTtl: keysTTL, // expire according to cache-control header
        })
    } else {
        // logger.log(`Using cached Google JWKS`)
    }

    if (!jwks) {
        throw "JWKS Error: Google JWKS not found"
    }

    return createLocalJWKSet(jwks)
}

export interface VerifyIdTokenParams {
    env: Env
    token: string
    throwErrors?: boolean
}

const verifyIdToken = async ({
    env,
    token,
    throwErrors = false,
}: VerifyIdTokenParams): Promise<User | undefined> => {
    try {
        if (!env.GOOGLE_PROJECT_ID) {
            throw "GOOGLE_PROJECT_ID not set"
        }

        const { payload } = await jwtVerify(
            token,
            await getGoogleJWKS({ env }),
            {
                algorithms: ["RS256"],
                audience: env.GOOGLE_PROJECT_ID,
                issuer: `https://securetoken.google.com/${env.GOOGLE_PROJECT_ID}`,
            }
        )

        // use decoded payload for additional checks specified by Google
        // https://firebase.google.com/docs/auth/admin/verify-id-tokens#verify_id_tokens_using_a_third-party_jwt_library
        const now = Date.now() / 1000
        const { iat, auth_time, sub } = payload as JWTPayload & {
            auth_time?: number
        }
        if (!iat || iat >= now) throw "JWT Error: invalid iat"
        if (!auth_time || auth_time >= now) throw "JWT Error: invalid auth_time"
        if (!sub) throw "JWT Error: invalid sub"

        return { uid: sub } // payload subject is the user id
    } catch (e) {
        if (throwErrors) {
            throw e
        } else {
            logger.error(e)
        }
    }
}
