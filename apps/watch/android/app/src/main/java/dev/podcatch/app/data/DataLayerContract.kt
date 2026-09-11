package dev.podcatch.app.data

/**
 * Kotlin mirror of packages/shared/src/datalayer.ts.
 *
 * The phone app (TypeScript) and this watch app (Kotlin) cannot share code, so this
 * contract is duplicated by hand — in THREE places. The third is the phone's native
 * bridge:
 *     apps/mobile/modules/wear-data-layer/android/.../WearDataLayerModule.kt
 *
 * ANY change must be made in all three, or phone <-> watch sync breaks silently.
 *
 * A change here may also need a watch API version bump — see BuildConfig.WATCH_API_VERSION,
 * packages/shared/src/watch-api-version.json, and the compatibility rules in
 * docs/watch-sync.md section 2.
 */
object DataLayerContract {
    // DataClient item paths (persistent, replicated DataItems)
    const val PATH_SUBSCRIPTIONS = "/podcatch/subscriptions"
    const val PATH_WATCH_EPISODES = "/podcatch/watch-episodes"
    const val PATH_SETTINGS = "/podcatch/settings"
    // Listen positions. One path per writer: two writers on one path would each
    // overwrite the other's copy before anyone merged them.
    const val PATH_PLAYBACK_PROGRESS_PHONE = "/podcatch/playback-progress/phone"
    const val PATH_PLAYBACK_PROGRESS_WATCH = "/podcatch/playback-progress/watch"
    // MessageClient paths (transient RPC)
    const val PATH_REQUEST_SYNC = "/podcatch/request-sync"
    const val PATH_REQUEST_DOWNLOAD_STATUS = "/podcatch/request-download-status"
    const val PATH_WATCH_DOWNLOAD_STATUS = "/podcatch/watch-download-status"
    const val PATH_REMOVE_WATCH_EPISODE = "/podcatch/remove-watch-episode"
    const val PATH_RETRY_WATCH_EPISODE = "/podcatch/retry-watch-episode"

    // Keys inside the SUBSCRIPTIONS DataMap
    const val KEY_ITEMS = "items"
    const val KEY_UPDATED_AT = "updatedAt"

    // CapabilityClient capability names
    const val CAPABILITY_PHONE_APP = "podcatch_phone"
    const val CAPABILITY_WATCH_APP = "podcatch_watch"
}
