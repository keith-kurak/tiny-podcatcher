package dev.podcatch.app.data

import android.content.Context
import android.content.SharedPreferences
import dev.podcatch.app.playback.PlaybackState
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import org.json.JSONArray
import org.json.JSONObject

data class WatchEpisode(
    val guid: String,
    val title: String,
    val podcastTitle: String,
    val podcastId: String,
    val audioUrl: String,
    val duration: String,
    val pubDate: String,
    val artworkUrl: String,
    val downloadProgress: Int = 0,
    val localPath: String? = null,
    /** Cached artwork file on disk, so the list renders offline. */
    val artworkPath: String? = null,
    val error: Boolean = false,
    /**
     * The podcast's own artwork. Shown until [artworkPath] exists, so a row never sits
     * blank while the episode's artwork downloads. Empty from a phone that predates watch
     * API 1.1.0, which does not send it.
     */
    val podcastArtworkUrl: String = "",
    /** Cached copy of [podcastArtworkUrl]. Often the same file as [artworkPath]. */
    val podcastArtworkPath: String? = null,
) {
    /** Every cached artwork file this episode points at. */
    val artworkPaths: List<String>
        get() = listOfNotNull(artworkPath, podcastArtworkPath)
}

/**
 * The watch's view of the episodes the phone has queued for it.
 *
 * Backed by [SharedPreferences]. Wear OS kills app processes aggressively, and
 * WorkManager will start a fresh process to run a worker — so treat process death
 * as the normal case. Anything that reads this state must call [load] first, or it
 * will see an empty list and conclude there is nothing to download.
 */
object SyncedWatchEpisodes {
    private const val PREFS_NAME = "watch-episodes"
    private const val KEY_EPISODES = "episodes"
    private const val KEY_REMOVED = "removedGuids"

    /** While a download runs, write progress to disk at most every this many percent. */
    private const val PROGRESS_PERSIST_STEP = 5

    private var prefs: SharedPreferences? = null

    /** True once [load] has run in this process, whether or not it found anything. */
    @Volatile
    private var loaded = false

    /**
     * True when a stored list was found on disk. Distinguishes "the watch has nothing
     * queued" from "this process has no idea what is queued" — the two look identical
     * in [episodes] but mean very different things to a caller.
     */
    @Volatile
    var hasStoredList = false
        private set

    /**
     * Last percent written to disk per guid, so progress updates do not thrash it.
     * Concurrent: the download worker writes from an IO thread while Data Layer
     * callbacks mutate it from the main thread.
     */
    private val lastPersistedProgress = ConcurrentHashMap<String, Int>()

    /**
     * Episodes the user removed on the watch, which the phone has not yet acknowledged.
     *
     * A removal is a strong statement: the episode must stay gone. But the phone owns the
     * queue, so its next list still contains the episode until it processes the request —
     * and that request can be lost outright, because the phone's handler lives in its JS
     * app and only runs while that app is open.
     *
     * These tombstones make the removal stick anyway. [update] filters them out of any
     * incoming list, so no sync and no replayed DataItem can resurrect the episode, and
     * [PhoneRequests.resendPendingRemovals] keeps asking until the phone complies.
     *
     * Persisted, because the whole point is surviving process death and reconnection.
     */
    private val removedGuids = mutableSetOf<String>()

    /** Removals still waiting on the phone. Snapshot — safe to iterate. */
    val pendingRemovals: Set<String>
        @Synchronized get() = removedGuids.toSet()

    private val _episodes = MutableStateFlow<List<WatchEpisode>>(emptyList())
    val episodes: StateFlow<List<WatchEpisode>> = _episodes.asStateFlow()

    /** Directory where episode audio files are downloaded. Set by [init]. */
    var episodesDir: File? = null

    /** Directory where podcast artwork is cached. Defaults to [episodesDir]/artwork. */
    val artworkDir: File?
        get() = episodesDir?.let { File(it, "artwork") }

    /** Stable on-disk name for an artwork URL, shared by episodes of the same podcast. */
    fun artworkFile(artworkUrl: String): File? {
        if (artworkUrl.isBlank()) return null
        val name = Integer.toHexString(artworkUrl.hashCode()) + ".img"
        return artworkDir?.let { File(it, name) }
    }

    /** Path of the cached copy of [artworkUrl], or null when it is not cached. */
    private fun cachedArtworkPath(artworkUrl: String): String? =
        artworkFile(artworkUrl)?.takeIf { it.exists() }?.absolutePath

    /** Wire up preferences and the episodes directory. Cheap and idempotent. */
    fun init(context: Context) {
        val app = context.applicationContext
        if (prefs == null) {
            prefs = app.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        }
        if (episodesDir == null) {
            episodesDir = File(app.filesDir, "episodes")
        }
    }

    /**
     * Restore the episode list from disk if this process has not done so yet.
     *
     * The first call wins. A later call cannot clobber a live in-memory list with a
     * staler copy from disk.
     */
    @Synchronized
    fun load(context: Context) {
        init(context)
        if (loaded) return
        loaded = true

        // Restored before the early return below: a watch can have pending removals and no
        // stored episode list at the same time, and dropping them would let the phone's
        // next sync bring the episodes back.
        prefs?.getString(KEY_REMOVED, null)?.let { rawRemoved ->
            val removedArray = JSONArray(rawRemoved)
            for (i in 0 until removedArray.length()) {
                removedArray.optString(i, "").takeIf { it.isNotBlank() }?.let(removedGuids::add)
            }
        }

        val raw = prefs?.getString(KEY_EPISODES, null) ?: return
        hasStoredList = true

        val restored = mutableListOf<WatchEpisode>()
        val array = JSONArray(raw)
        for (i in 0 until array.length()) {
            val obj = array.optJSONObject(i) ?: continue
            restored.add(storedEpisode(obj))
        }
        // Only adopt the stored list if nothing has populated us in the meantime —
        // a Data Layer event racing this load holds fresher data than disk does.
        if (_episodes.value.isEmpty()) {
            _episodes.value = restored
        }
    }

    /** Read a full record, including download state, as written by [persist]. */
    private fun storedEpisode(obj: JSONObject): WatchEpisode {
        // A file can be deleted out from under us (cache clear, manual removal), so a
        // stored path is only trusted when it still exists.
        val storedPath = obj.optString("localPath", "").takeIf { it.isNotBlank() }
        val localPath = storedPath?.takeIf { File(it).exists() }
        val storedArtwork = obj.optString("artworkPath", "").takeIf { it.isNotBlank() }
        val artworkPath = storedArtwork?.takeIf { File(it).exists() }
        val storedPodcastArtwork = obj.optString("podcastArtworkPath", "").takeIf { it.isNotBlank() }
        val podcastArtworkPath = storedPodcastArtwork?.takeIf { File(it).exists() }
        val storedProgress = obj.optInt("downloadProgress", 0)
        val progress = when {
            localPath != null -> 100
            // The record claimed a finished file that is no longer there. Its stored
            // 100% is meaningless now, and reporting it would show the phone a
            // completed download that does not exist.
            storedPath != null -> 0
            else -> storedProgress
        }
        return WatchEpisode(
            guid = obj.optString("guid", ""),
            title = obj.optString("title", ""),
            podcastTitle = obj.optString("podcastTitle", ""),
            podcastId = obj.optString("podcastId", ""),
            audioUrl = obj.optString("audioUrl", ""),
            duration = obj.optString("duration", ""),
            pubDate = obj.optString("pubDate", ""),
            artworkUrl = obj.optString("artworkUrl", ""),
            downloadProgress = progress,
            localPath = localPath,
            artworkPath = artworkPath,
            error = obj.optBoolean("error", false),
            podcastArtworkUrl = obj.optString("podcastArtworkUrl", ""),
            podcastArtworkPath = podcastArtworkPath,
        )
    }

    private fun WatchEpisode.toStoredJson(): JSONObject = JSONObject().apply {
        put("guid", guid)
        put("title", title)
        put("podcastTitle", podcastTitle)
        put("podcastId", podcastId)
        put("audioUrl", audioUrl)
        put("duration", duration)
        put("pubDate", pubDate)
        put("artworkUrl", artworkUrl)
        put("downloadProgress", downloadProgress)
        put("localPath", localPath ?: "")
        put("artworkPath", artworkPath ?: "")
        put("error", error)
        put("podcastArtworkUrl", podcastArtworkUrl)
        put("podcastArtworkPath", podcastArtworkPath ?: "")
    }

    @Synchronized
    private fun persist() {
        val p = prefs ?: return
        val array = JSONArray()
        for (episode in _episodes.value) array.put(episode.toStoredJson())
        val removed = JSONArray()
        for (guid in removedGuids) removed.put(guid)
        p.edit()
            .putString(KEY_EPISODES, array.toString())
            .putString(KEY_REMOVED, removed.toString())
            .apply()
        hasStoredList = true
    }

    /** Apply a fresh episode list pushed from the phone. */
    fun update(json: String?) {
        if (json == null) return
        val existing = _episodes.value.associateBy { it.guid }
        val list = mutableListOf<WatchEpisode>()
        val newGuids = mutableSetOf<String>()
        val incomingGuids = mutableSetOf<String>()
        val tombstoned = pendingRemovals
        val array = JSONArray(json)
        for (i in 0 until array.length()) {
            val obj = array.optJSONObject(i) ?: continue
            val guid = obj.optString("guid", "")
            incomingGuids.add(guid)
            // A removal made on the watch outranks the phone's list until the phone
            // acknowledges it. Without this, the next sync — or a DataItem replayed on
            // reconnect — silently restores the episode and downloads it all over again.
            if (guid in tombstoned) continue
            newGuids.add(guid)
            val prev = existing[guid]
            // Check in-memory state first, then fall back to checking disk
            val localPath = prev?.localPath ?: run {
                val file = episodesDir?.let { File(it, "$guid.mp3") }
                if (file?.exists() == true) file.absolutePath else null
            }
            val artworkUrl = obj.optString("artworkUrl", "")
            val artworkPath = prev?.artworkPath ?: cachedArtworkPath(artworkUrl)
            // Optional: absent from a phone older than watch API 1.1.0.
            val podcastArtworkUrl = obj.optString("podcastArtworkUrl", "")
            val podcastArtworkPath = prev?.podcastArtworkPath?.takeIf {
                prev.podcastArtworkUrl == podcastArtworkUrl
            } ?: cachedArtworkPath(podcastArtworkUrl)
            list.add(
                WatchEpisode(
                    guid = guid,
                    title = obj.optString("title", ""),
                    podcastTitle = obj.optString("podcastTitle", ""),
                    podcastId = obj.optString("podcastId", ""),
                    audioUrl = obj.optString("audioUrl", ""),
                    duration = obj.optString("duration", ""),
                    pubDate = obj.optString("pubDate", ""),
                    artworkUrl = artworkUrl,
                    downloadProgress = if (localPath != null) 100 else (prev?.downloadProgress ?: 0),
                    localPath = localPath,
                    artworkPath = artworkPath,
                    // A failure is sticky. Clearing it here would silently re-arm a
                    // failed episode on every sync from the phone; retry is manual.
                    error = prev?.error ?: false,
                    podcastArtworkUrl = podcastArtworkUrl,
                    podcastArtworkPath = podcastArtworkPath,
                )
            )
        }
        // Delete downloaded files for episodes removed from the watch list
        val keptArtwork = list.flatMap { it.artworkPaths }.toSet()
        for ((guid, ep) in existing) {
            if (guid in newGuids) continue
            ep.localPath?.let { File(it).delete() }
            for (path in ep.artworkPaths) if (path !in keptArtwork) File(path).delete()
            // Partial downloads are kept across attempts so they can resume, so a
            // removed episode has to take its .tmp with it.
            episodesDir?.let { File(it, "$guid.mp3.tmp").delete() }
            PlaybackState.forget(guid)
            lastPersistedProgress.remove(guid)
        }
        _episodes.value = list
        // The phone has honoured every removal it no longer lists, so stop tracking those.
        // Holding them forever would also block the user deliberately re-adding the same
        // episode from the phone later.
        forgetConfirmedRemovals(incomingGuids)
        // An episode that has left the list cannot play, so it cannot be up next. Left in,
        // it would be invisible but still occupy one of the queue's five slots.
        UpNextQueue.pruneTo(list.map { it.guid }.toSet())
        persist()
    }

    /**
     * Drop tombstones for episodes the phone has stopped sending.
     *
     * Absence from the incoming list is the phone's acknowledgement. There is no explicit
     * ack message, and adding one would mean a fourth path across three hand-mirrored
     * contract files for information the list already carries.
     */
    @Synchronized
    private fun forgetConfirmedRemovals(incomingGuids: Set<String>) {
        removedGuids.retainAll(incomingGuids)
    }

    /**
     * Record a removal and write it to disk immediately.
     *
     * Persisted here rather than relying on the caller, because [removeEpisode] returns
     * early when the episode is not in this process's list — and that early return is
     * exactly the case where the tombstone matters most.
     */
    @Synchronized
    private fun rememberRemoval(guid: String) {
        if (guid.isBlank()) return
        if (!removedGuids.add(guid)) return
        persist()
    }

    fun updateProgress(guid: String, progress: Int) {
        _episodes.update { list ->
            list.map { if (it.guid == guid) it.copy(downloadProgress = progress) else it }
        }
        // Persisting every whole percent would mean hundreds of writes per episode.
        val last = lastPersistedProgress[guid] ?: -1
        if (last < 0 || progress / PROGRESS_PERSIST_STEP != last / PROGRESS_PERSIST_STEP) {
            lastPersistedProgress[guid] = progress
            persist()
        }
    }

    fun markDownloaded(guid: String, localPath: String) {
        _episodes.update { list ->
            list.map {
                if (it.guid == guid) {
                    it.copy(downloadProgress = 100, localPath = localPath, error = false)
                } else {
                    it
                }
            }
        }
        lastPersistedProgress.remove(guid)
        persist()
    }

    /**
     * Point every episode using [artworkUrl] at the cached file, as its own artwork or as
     * its podcast's.
     */
    fun markArtworkDownloaded(artworkUrl: String, path: String) {
        _episodes.update { list ->
            list.map {
                var ep = it
                if (ep.artworkUrl == artworkUrl) ep = ep.copy(artworkPath = path)
                if (ep.podcastArtworkUrl == artworkUrl) ep = ep.copy(podcastArtworkPath = path)
                ep
            }
        }
        persist()
    }

    /** Artwork URLs that some episode uses and that are not cached yet. Podcast artwork first. */
    fun missingArtworkUrls(): List<String> {
        val list = _episodes.value
        val podcast = list.filter { it.podcastArtworkPath == null }.map { it.podcastArtworkUrl }
        val episode = list.filter { it.artworkPath == null }.map { it.artworkUrl }
        return (podcast + episode).filter { it.isNotBlank() }.distinct()
    }

    fun markError(guid: String) {
        _episodes.update { list ->
            // Progress resets so the row reads as failed rather than stuck at a
            // percentage it will never move past.
            list.map { if (it.guid == guid) it.copy(error = true, downloadProgress = 0) else it }
        }
        lastPersistedProgress.remove(guid)
        persist()
    }

    /**
     * Drop an episode locally, freeing its files, and remember that it must stay gone.
     *
     * Removing on the watch is a strong statement, so it is recorded as a tombstone in
     * [removedGuids] rather than treated as a hint. The phone still owns the queue and is
     * asked to do the same, but until it complies the tombstone keeps its list from
     * restoring the episode. See [pendingRemovals].
     */
    fun removeEpisode(guid: String) {
        rememberRemoval(guid)
        val episode = _episodes.value.firstOrNull { it.guid == guid } ?: return
        episode.localPath?.let { File(it).delete() }
        episodesDir?.let { File(it, "$guid.mp3.tmp").delete() }
        // Artwork is shared between episodes of the same podcast, so it is only removed
        // when no remaining episode still points at it.
        val others = _episodes.value.filter { it.guid != guid }
        for (artwork in episode.artworkPaths) {
            if (others.none { artwork in it.artworkPaths }) File(artwork).delete()
        }
        PlaybackState.forget(guid)
        lastPersistedProgress.remove(guid)
        UpNextQueue.remove(guid)
        _episodes.update { list -> list.filterNot { it.guid == guid } }
        persist()
    }

    /** Clear a failure so the worker will pick this episode up again. Manual retry only. */
    fun clearError(guid: String) {
        _episodes.update { list ->
            list.map { if (it.guid == guid) it.copy(error = false) else it }
        }
        persist()
    }

    /**
     * Clear every failure flag, making the whole queue eligible again.
     *
     * Backs the phone's refresh button: "sync" is the obvious thing to reach for when
     * something is stuck, and having it skip precisely the episodes that need attention
     * was the wrong reading of the word.
     *
     * @return true when anything actually changed, so the caller can skip a needless
     * re-enqueue and status broadcast.
     */
    fun clearAllErrors(): Boolean {
        if (_episodes.value.none { it.error }) return false
        _episodes.update { list -> list.map { if (it.error) it.copy(error = false) else it } }
        persist()
        return true
    }
}
