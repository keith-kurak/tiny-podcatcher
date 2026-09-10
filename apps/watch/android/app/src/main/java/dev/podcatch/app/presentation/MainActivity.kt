package dev.podcatch.app.presentation

import android.Manifest
import android.app.Application
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Vibrator
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.basicMarquee
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.Download
import androidx.compose.material.icons.rounded.ErrorOutline
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.SignalWifiOff
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.ScalingLazyListState
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.wear.compose.foundation.lazy.items
import androidx.wear.compose.material.Card
import androidx.wear.compose.material.Chip
import androidx.wear.compose.material.ChipDefaults
import androidx.wear.compose.material.CircularProgressIndicator
import androidx.wear.compose.material.Icon
import androidx.wear.compose.material.ListHeader
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.dialog.Alert
import androidx.wear.compose.material.dialog.Dialog
import androidx.wear.compose.material.PositionIndicator
import androidx.wear.compose.material.Scaffold
import androidx.wear.compose.material.Text
import androidx.wear.compose.material.TimeText
import androidx.wear.compose.material.Vignette
import androidx.wear.compose.material.VignettePosition
import androidx.wear.compose.navigation.SwipeDismissableNavHost
import androidx.wear.compose.navigation.composable
import androidx.wear.compose.navigation.rememberSwipeDismissableNavController
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import com.google.android.horologist.annotations.ExperimentalHorologistApi
import com.google.android.horologist.audio.SystemAudioRepository
import com.google.android.horologist.audio.ui.VolumeScreen
import com.google.android.horologist.audio.ui.VolumeViewModel
import com.google.android.horologist.compose.ambient.AmbientAware
import com.google.android.horologist.compose.ambient.AmbientState
import androidx.work.ExistingWorkPolicy
import androidx.work.WorkManager
import coil.compose.AsyncImage
import com.google.android.gms.wearable.DataClient
import com.google.android.gms.wearable.DataEvent
import com.google.android.gms.wearable.DataEventBuffer
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.Wearable
import dev.podcatch.app.data.DataLayerContract
import dev.podcatch.app.data.DownloadRunGuard
import dev.podcatch.app.data.EpisodeDownloadWorker
import dev.podcatch.app.data.PhoneRequests
import dev.podcatch.app.data.PlaybackProgressSync
import dev.podcatch.app.data.WatchEpisode
import dev.podcatch.app.data.SyncedSettings
import dev.podcatch.app.data.SyncedSubscriptions
import dev.podcatch.app.data.SyncedWatchEpisodes
import dev.podcatch.app.data.UpNextQueue
import dev.podcatch.app.data.WatchDownloadStatusReporter
import dev.podcatch.app.playback.EpisodeProgress
import dev.podcatch.app.playback.EpisodeStatus
import dev.podcatch.app.playback.PlaybackState
import dev.podcatch.app.playback.statusOf
import java.io.File
import kotlinx.coroutines.launch
import dev.podcatch.app.presentation.theme.PodcatchTheme

class MainActivity : ComponentActivity(), DataClient.OnDataChangedListener {

    /**
     * The download worker runs as a foreground service, and from Android 13 a foreground
     * service notification is **not displayed** unless POST_NOTIFICATIONS is granted. The
     * download itself still runs either way, so this only affects whether the user can see
     * it happening.
     */
    private val requestNotificationPermission =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            Log.d(TAG, "POST_NOTIFICATIONS granted=$granted")
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)
        requestNotificationPermissionIfNeeded()
        // Opening the app is the deliberate act that re-arms downloads after the
        // crash-loop breaker trips. onResume enqueues the worker, so this must come first.
        DownloadRunGuard.resetBreaker(this)
        SyncedWatchEpisodes.load(this)
        SyncedWatchEpisodes.artworkDir?.mkdirs()
        SyncedSettings.load(this)
        UpNextQueue.load(this)
        PlaybackState.init(this)
        setContent { PodcatchApp() }
    }

    override fun onResume() {
        super.onResume()
        Wearable.getDataClient(this).addListener(this)
        // Read any data that was replicated before we started listening
        Wearable.getDataClient(this)
            .getDataItems()
            .addOnSuccessListener { items ->
                for (item in items) {
                    val dataMap = DataMapItem.fromDataItem(item).dataMap
                    val json = dataMap.getString(DataLayerContract.KEY_ITEMS)
                    when (item.uri.path) {
                        DataLayerContract.PATH_SETTINGS -> {
                            Log.d(TAG, "Read existing settings from Data Layer")
                            SyncedSettings.update(json)
                        }
                        DataLayerContract.PATH_PLAYBACK_PROGRESS_PHONE -> {
                            Log.d(TAG, "Read existing playback progress from Data Layer")
                            PlaybackProgressSync.applyFromPhone(this@MainActivity, json)
                        }
                        DataLayerContract.PATH_SUBSCRIPTIONS -> {
                            Log.d(TAG, "Read existing subscriptions from Data Layer")
                            SyncedSubscriptions.update(json)
                        }
                        DataLayerContract.PATH_WATCH_EPISODES -> {
                            Log.d(TAG, "Read existing watch episodes from Data Layer")
                            SyncedWatchEpisodes.update(json)
                            PhoneRequests.resendPendingRemovals(this@MainActivity)
                            WatchDownloadStatusReporter.reportStatus(this@MainActivity)
                            enqueueDownloads()
                        }
                    }
                }
                items.release()
            }
    }

    override fun onPause() {
        Wearable.getDataClient(this).removeListener(this)
        super.onPause()
    }

    override fun onDataChanged(events: DataEventBuffer) {
        for (event in events) {
            if (event.type != DataEvent.TYPE_CHANGED) continue
            val dataMap = DataMapItem.fromDataItem(event.dataItem).dataMap
            val json = dataMap.getString(DataLayerContract.KEY_ITEMS)
            when (event.dataItem.uri.path) {
                DataLayerContract.PATH_SUBSCRIPTIONS -> {
                    Log.d(TAG, "Live data change: subscriptions updated")
                    SyncedSubscriptions.update(json)
                }
                DataLayerContract.PATH_PLAYBACK_PROGRESS_PHONE -> {
                    Log.d(TAG, "Live data change: playback progress updated")
                    PlaybackProgressSync.applyFromPhone(this@MainActivity, json)
                }
                DataLayerContract.PATH_WATCH_EPISODES -> {
                    Log.d(TAG, "Live data change: watch episodes updated")
                    SyncedWatchEpisodes.update(json)
                    PhoneRequests.resendPendingRemovals(this@MainActivity)
                    WatchDownloadStatusReporter.reportStatus(this@MainActivity)
                    enqueueDownloads()
                }
            }
        }
    }

    /**
     * Ask once per install, on first launch. POST_NOTIFICATIONS did not exist before API 33,
     * and minSdk here is 30, so the check is required.
     */
    private fun requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        val granted = checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
        if (granted) return
        requestNotificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
    }

    private fun enqueueDownloads() {
        val hasWork = SyncedWatchEpisodes.episodes.value.any { episode ->
            (episode.localPath == null && episode.audioUrl.isNotBlank()) ||
                (episode.artworkPath == null && episode.artworkUrl.isNotBlank())
        }
        if (!hasWork) return

        WorkManager.getInstance(this).enqueueUniqueWork(
            EpisodeDownloadWorker.UNIQUE_WORK_NAME,
            ExistingWorkPolicy.KEEP,
            // Expedited: the watch app is open, so someone is waiting on this. The
            // automatic Data Layer path deliberately does not spend quota here.
            EpisodeDownloadWorker.buildRequest(this, expedited = true),
        )
        Log.d(TAG, "Enqueued episode download worker")
    }

    companion object {
        private const val TAG = "PodcatchMain"
    }
}

/**
 * Long-press menu for an episode.
 *
 * Downloading is automatic, so Retry only appears for something not yet on disk. Remove
 * applies to any episode — a downloaded one is exactly what you want to clear off a watch.
 */
@Composable
private fun EpisodeActionsDialog(
    visible: Boolean,
    episode: WatchEpisode?,
    queued: Boolean,
    queueFull: Boolean,
    onDismiss: () -> Unit,
    onRetry: () -> Unit,
    onToggleUpNext: () -> Unit,
    onRemove: () -> Unit,
) {
    val isDownloaded = episode?.localPath != null
    // Visibility is its own flag, not `episode != null`. The caller keeps the episode around
    // after acting on it so the exit animation renders the state the user actually saw.
    Dialog(showDialog = visible, onDismissRequest = onDismiss) {
        Alert(
            title = {
                Text(
                    text = episode?.title.orEmpty(),
                    style = MaterialTheme.typography.title3,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                    textAlign = TextAlign.Center,
                )
            },
            message = {
                Text(
                    text = when {
                        episode?.error == true -> "Download failed"
                        isDownloaded -> "On this watch"
                        else -> "Not downloaded yet"
                    },
                    style = MaterialTheme.typography.caption2,
                    textAlign = TextAlign.Center,
                )
            },
        ) {
            if (!isDownloaded) {
                item {
                    Chip(
                        label = { Text("Retry download") },
                        onClick = onRetry,
                        colors = ChipDefaults.primaryChipColors(),
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
            // Only for something already on the watch. Queuing an episode that has not
            // downloaded would promise a playback this watch cannot deliver.
            //
            // A full queue shows a disabled chip saying so, rather than hiding the
            // option — an action that silently vanishes reads as a bug.
            if (isDownloaded) {
                item {
                    Chip(
                        label = {
                            Text(
                                when {
                                    queued -> "Remove from Up Next"
                                    queueFull -> "Up Next is full"
                                    else -> "Add to Up Next"
                                },
                            )
                        },
                        onClick = onToggleUpNext,
                        enabled = queued || !queueFull,
                        colors = ChipDefaults.primaryChipColors(),
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
            item {
                Chip(
                    label = { Text("Remove from watch") },
                    onClick = onRemove,
                    colors = ChipDefaults.secondaryChipColors(),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            item {
                Chip(
                    label = { Text("Cancel") },
                    onClick = onDismiss,
                    colors = ChipDefaults.secondaryChipColors(),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
    }
}

/**
 * Clear the failure flag and wake the download worker.
 *
 * `KEEP` is safe now that auto-retry and its backoff are gone: if a worker is already
 * running it re-reads the episode list on every loop pass, so clearing the flag makes
 * this episode eligible without needing to replace the work.
 */
/**
 * Drop an episode from the watch queue.
 *
 * Removed locally straight away so the row disappears on tap, and the phone is asked to do
 * the same. The phone owns the queue, so if that request is lost its next sync restores the
 * episode rather than the two silently diverging.
 */
private fun removeEpisodeFromWatch(context: android.content.Context, guid: String) {
    SyncedWatchEpisodes.removeEpisode(guid)
    PhoneRequests.removeWatchEpisode(context, guid)
    WatchDownloadStatusReporter.reportStatus(context)
}

private fun retryEpisodeDownload(context: android.content.Context, episode: WatchEpisode) {
    if (episode.audioUrl.isBlank()) return
    SyncedWatchEpisodes.clearError(episode.guid)

    WorkManager.getInstance(context).enqueueUniqueWork(
        EpisodeDownloadWorker.UNIQUE_WORK_NAME,
        // REPLACE, not KEEP: a network failure now schedules a retry with a backoff, and
        // KEEP would let that pending retry silently swallow the tap. Replacing a running
        // worker is safe — partial downloads resume from their `.tmp`.
        ExistingWorkPolicy.REPLACE,
        // User-initiated and the user is watching the screen — worth expedited quota.
        EpisodeDownloadWorker.buildRequest(context, expedited = true),
    )
}

@OptIn(ExperimentalHorologistApi::class)
@Composable
fun PodcatchApp() {
    PodcatchTheme {
        val navController = rememberSwipeDismissableNavController()
        /*
          One instance for the whole app, deliberately built here rather than inside the
          player screen.

          Horologist's volume state is not read from AudioManager — SystemAudioRepository
          derives it from MediaRouter's selected route, and only refreshes it when a route
          callback fires. Built lazily on the player screen, its very first read happens
          against a MediaRouter that has not resolved a route yet, which reports no volume
          and no volume control: hence a mute icon over loud audio, and a crown that turns
          nothing. Creating it with the app registers that callback at startup, so the route
          is settled long before the player screen is opened.

          It also means the player screen's volume button and the volume screen read the same
          state. They used to hold one repository each, and could disagree.
        */
        val application = LocalContext.current.applicationContext as Application
        val volumeViewModel: VolumeViewModel = viewModel(
            factory = object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T {
                    val audioRepository = SystemAudioRepository.fromContext(application)
                    val vibrator = application.getSystemService(Vibrator::class.java)
                    return VolumeViewModel(
                        audioRepository,
                        audioRepository,
                        onCleared = { audioRepository.close() },
                        vibrator,
                    ) as T
                }
            },
        )
        // Hoisted so the Scaffold's position indicator can read it. The Scaffold sits
        // above the NavHost and otherwise has no way to know what is scrolling.
        val episodeListState = rememberScalingLazyListState()
        // Enables always-on, so the display dims into ambient with the app still
        // shown, instead of the system covering it with a screenshot and the time.
        AmbientAware { ambientState ->
            val isAmbient = ambientState is AmbientState.Ambient
            Scaffold(
                timeText = { if (!isAmbient) TimeText() },
                // Auto-hides when the list is idle, so it costs nothing on the player
                // and speed screens even though it is bound to the episode list.
                positionIndicator = {
                    if (!isAmbient) PositionIndicator(scalingLazyListState = episodeListState)
                },
                // Fades the top and bottom edges, which keeps rounded-screen content from
                // looking sheared off.
                vignette = {
                    if (!isAmbient) Vignette(vignettePosition = VignettePosition.TopAndBottom)
                },
            ) {
                SwipeDismissableNavHost(
                    navController = navController,
                    startDestination = "episodeList",
                ) {
                    composable("episodeList") {
                        EpisodeListScreen(
                            listState = episodeListState,
                            isAmbient = isAmbient,
                            onEpisodeClick = { episode ->
                                navController.navigate(
                                    "player/${Uri.encode(episode.guid)}",
                                )
                            },
                            onNowPlayingClick = { guid ->
                                navController.navigate("player/${Uri.encode(guid)}")
                            },
                        )
                    }
                    composable("player/{guid}") { backStackEntry ->
                        val guid = backStackEntry.arguments?.getString("guid")
                            ?: return@composable
                        EpisodePlayerScreen(
                            guid = Uri.decode(guid),
                            volumeViewModel = volumeViewModel,
                            onVolumeClick = { navController.navigate("volume") },
                            onSpeedClick = { navController.navigate("speed") },
                        )
                    }
                    composable("volume") {
                        VolumeScreen(volumeViewModel = volumeViewModel)
                    }
                    composable("speed") {
                        val playerEntry = remember(navController) {
                            navController.getBackStackEntry("player/{guid}")
                        }
                        val playerViewModel: EpisodePlayerViewModel = viewModel(
                            viewModelStoreOwner = playerEntry,
                        )
                        SpeedScreen(
                            currentSpeed = playerViewModel.currentSpeed,
                            onSpeedSelected = { speed -> playerViewModel.setSpeed(speed) },
                            onBack = { navController.popBackStack() },
                        )
                    }
                }
            }
        }
    }
}

/**
 * One episode row.
 *
 * Extracted so the Up Next group and the rest of the list cannot drift apart — they are
 * the same rows, only grouped.
 */
@Composable
private fun EpisodeCard(
    episode: WatchEpisode,
    progress: EpisodeProgress?,
    isPlaying: Boolean,
    waitingForWifi: Boolean,
    onClick: () -> Unit,
    onLongClick: () -> Unit,
) {
    val isDownloaded = episode.localPath != null
    Card(
        // The real gestures live on the Row below. A child clickable wins over the Card's
        // own, and only the child supports long-press — Wear Compose Material 1.4 has no
        // Card(onLongClick).
        onClick = {},
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 2.dp)
            .alpha(if (isDownloaded) 1f else 0.6f),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier
                .fillMaxWidth()
                .combinedClickable(
                    // Tapping a non-downloaded episode used to start a download that was
                    // frequently discarded by KEEP while the toast said otherwise.
                    // Downloading is automatic; the only manual action is retrying.
                    onClick = { if (isDownloaded) onClick() },
                    onLongClick = onLongClick,
                ),
        ) {
            val artworkModel = episode.artworkPath?.let { File(it) }
                ?: episode.artworkUrl.takeIf { it.isNotBlank() }
            if (artworkModel != null) {
                AsyncImage(
                    model = artworkModel,
                    contentDescription = episode.podcastTitle,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier
                        .size(36.dp)
                        .clip(RoundedCornerShape(6.dp)),
                )
                Spacer(modifier = Modifier.width(8.dp))
            }
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = episode.title,
                    style = MaterialTheme.typography.body2,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    // Loops for as long as the title overflows, the way YouTube Music does.
                    // The 3-repeat default parks on the clipped start of the title, and a
                    // title cut off mid-word with no ellipsis is what Play flagged under
                    // the Wear font-size guideline: at a large font nearly every title
                    // overflows, so nearly every row ends up sitting cut.
                    modifier = Modifier.basicMarquee(iterations = Int.MAX_VALUE),
                )
                Text(
                    text = episode.podcastTitle,
                    style = MaterialTheme.typography.caption2,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Spacer(modifier = Modifier.width(6.dp))
            if (isDownloaded) {
                EpisodeStatusIndicator(progress = progress, isPlaying = isPlaying)
            } else if (waitingForWifi && episode.downloadProgress == 0 && !episode.error) {
                Icon(
                    imageVector = Icons.Rounded.SignalWifiOff,
                    contentDescription = "Waiting for Wi-Fi",
                    tint = Color(0xFFFFB300),
                    modifier = Modifier.size(18.dp),
                )
            } else if (episode.error) {
                // Distinct from "not downloaded yet" so the long-press retry has something
                // to be discoverable from.
                Icon(
                    imageVector = Icons.Rounded.ErrorOutline,
                    contentDescription = "Download failed — long press to retry",
                    tint = Color(0xFFFF6B6B),
                    modifier = Modifier.size(18.dp),
                )
            } else if (episode.downloadProgress != 0) {
                Text(
                    // Negative means the server sent no Content-Length, so there is no
                    // percentage to show — only "in progress".
                    text = if (episode.downloadProgress > 0) {
                        "${episode.downloadProgress}%"
                    } else {
                        "…"
                    },
                    style = MaterialTheme.typography.caption3,
                )
            } else {
                Icon(
                    imageVector = Icons.Rounded.Download,
                    contentDescription = "Not downloaded",
                    tint = Color.Gray,
                    modifier = Modifier.size(18.dp),
                )
            }
        }
    }
}

/** Yellow dot = new, ring = part-listened, grey check = finished. */
@Composable
private fun EpisodeStatusIndicator(progress: EpisodeProgress?, isPlaying: Boolean) {
    if (isPlaying) {
        Box(contentAlignment = Alignment.Center, modifier = Modifier.size(18.dp)) {
            CircularProgressIndicator(
                progress = (progress?.fraction ?: 0f).coerceAtLeast(0.03f),
                indicatorColor = MaterialTheme.colors.primary,
                trackColor = Color.DarkGray,
                strokeWidth = 2.dp,
                modifier = Modifier.fillMaxSize(),
            )
            Icon(
                imageVector = Icons.Rounded.PlayArrow,
                contentDescription = "Playing",
                tint = MaterialTheme.colors.primary,
                modifier = Modifier.size(11.dp),
            )
        }
        return
    }
    when (statusOf(progress)) {
        EpisodeStatus.NEW -> Box(
            modifier = Modifier
                .size(10.dp)
                .clip(CircleShape)
                .background(Color(0xFFFFC107)),
        )
        EpisodeStatus.IN_PROGRESS -> CircularProgressIndicator(
            progress = (progress?.fraction ?: 0f).coerceAtLeast(0.03f),
            indicatorColor = MaterialTheme.colors.primary,
            trackColor = Color.DarkGray,
            strokeWidth = 3.dp,
            modifier = Modifier.size(18.dp),
        )
        EpisodeStatus.COMPLETE -> Icon(
            imageVector = Icons.Rounded.CheckCircle,
            contentDescription = "Finished",
            tint = Color.Gray,
            modifier = Modifier.size(18.dp),
        )
    }
}

@Composable
fun EpisodeListScreen(
    listState: ScalingLazyListState,
    isAmbient: Boolean,
    onEpisodeClick: (WatchEpisode) -> Unit,
    onNowPlayingClick: (String) -> Unit,
) {
    val episodes by SyncedWatchEpisodes.episodes.collectAsState()
    val progressByGuid by PlaybackState.progress.collectAsState()
    val playingGuid by PlaybackState.playingGuid.collectAsState()
    val nowPlaying = episodes.firstOrNull { it.guid == playingGuid }
    val context = LocalContext.current
    val wifiOnly by SyncedSettings.wifiOnlyDownloads.collectAsState()
    // Recomputed whenever the setting changes or the list recomposes. Good enough for a
    // status hint; the UNMETERED constraint is what actually gates the download.
    val waitingForWifi = wifiOnly && SyncedSettings.isWaitingForWifi(context)
    // The episode whose long-press menu is open, held as a snapshot rather than looked up
    // from `episodes` by guid. Removing an episode takes it out of the list immediately, and
    // a lookup would go null while the dialog is still animating out — which rendered the
    // "not downloaded yet / Retry download" variant for a frame on the way past.
    var menuEpisode by remember { mutableStateOf<WatchEpisode?>(null) }
    var menuVisible by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    val upNextGuids by UpNextQueue.guids.collectAsState()
    // Queued episodes float to the top in QUEUE order, not list order — the queue is a
    // play order, and showing it sorted any other way would misrepresent what plays next.
    val queuedEpisodes = upNextGuids.mapNotNull { guid -> episodes.firstOrNull { it.guid == guid } }
    val restEpisodes = episodes.filterNot { it.guid in upNextGuids }
    val menuQueued = menuEpisode?.let { UpNextQueue.contains(it.guid) } == true

    EpisodeActionsDialog(
        visible = menuVisible,
        episode = menuEpisode,
        queued = menuQueued,
        queueFull = UpNextQueue.isFull,
        onDismiss = { menuVisible = false },
        onRetry = {
            menuEpisode?.let { retryEpisodeDownload(context, it) }
            menuVisible = false
        },
        onToggleUpNext = {
            menuEpisode?.let {
                if (UpNextQueue.contains(it.guid)) {
                    UpNextQueue.remove(it.guid)
                } else if (UpNextQueue.add(it.guid)) {
                    // Queuing inserts the Up Next section ABOVE the current scroll
                    // position, and the list keeps that position — so on a screen showing
                    // two or three rows the whole thing happens off-screen and reads as
                    // "nothing happened". Scrolling to the top is the confirmation.
                    scope.launch { listState.animateScrollToItem(0) }
                }
            }
            menuVisible = false
        },
        onRemove = {
            menuEpisode?.let { removeEpisodeFromWatch(context, it.guid) }
            menuVisible = false
        },
    )

    // Only while audio is actually playing, and never in ambient. Reserve its height in
    // the list so the last row is not permanently sitting underneath it.
    val showNowPlaying = nowPlaying != null && !isAmbient

    Box(modifier = Modifier.fillMaxSize()) {
        ScalingLazyColumn(
            state = listState,
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(
                // TimeText is an overlay, so the list has to reserve its height itself.
                // The clock is sp-sized and grows with the user's font setting; a fixed
                // 32dp let the first row sit under the clock at the larger sizes.
                top = 32.dp * LocalDensity.current.fontScale,
                start = 8.dp,
                end = 8.dp,
                bottom = if (showNowPlaying) NOW_PLAYING_CHIP_RESERVE else 0.dp,
            ),
        ) {
            if (episodes.isEmpty()) {
                item {
                    Text(
                        text = "No episodes queued",
                        style = MaterialTheme.typography.body1,
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                    )
                }
            } else {
                // Queued episodes float to the top under their own heading. The headings
                // only appear when something is queued — a lone "All episodes" heading
                // above an unchanged list is noise.
                if (queuedEpisodes.isNotEmpty()) {
                    item { ListHeader { Text("Up Next") } }
                    items(queuedEpisodes, key = { "upnext:${it.guid}" }) { episode ->
                        EpisodeCard(
                            episode = episode,
                            progress = progressByGuid[episode.guid],
                            isPlaying = episode.guid == playingGuid,
                            waitingForWifi = waitingForWifi,
                            onClick = { onEpisodeClick(episode) },
                            onLongClick = {
                                menuEpisode = episode
                                menuVisible = true
                            },
                        )
                    }
                    item { ListHeader { Text("All episodes") } }
                }
                items(restEpisodes, key = { it.guid }) { episode ->
                    EpisodeCard(
                        episode = episode,
                        progress = progressByGuid[episode.guid],
                        isPlaying = episode.guid == playingGuid,
                        waitingForWifi = waitingForWifi,
                        onClick = { onEpisodeClick(episode) },
                        onLongClick = {
                            menuEpisode = episode
                            menuVisible = true
                        },
                    )
                }
            }
        }

        if (nowPlaying != null && showNowPlaying) {
            NowPlayingBar(
                episode = nowPlaying,
                fraction = progressByGuid[nowPlaying.guid]?.fraction ?: 0f,
                onClick = { onNowPlayingClick(nowPlaying.guid) },
                modifier = Modifier.align(Alignment.BottomCenter),
            )
        }
    }
}

/**
 * A live equalizer: bars that rise and fall while audio plays.
 *
 * Drawn rather than using `Icons.Rounded.GraphicEq`, because that is a static vector with
 * no way to animate its paths. Four bars on independent, deliberately non-harmonic
 * durations — in lockstep they read as a loading spinner rather than as audio.
 *
 * The heights are synthetic, not driven by the audio signal. Real amplitude would mean
 * `android.media.audiofx.Visualizer`, which needs `RECORD_AUDIO`; asking for the
 * microphone to animate a 16dp glyph is a bad trade on a watch.
 *
 * Only ever composed while playback is active and out of ambient, so it never animates
 * against a dimmed screen or an idle player.
 */
@Composable
private fun EqualizerBars(
    tint: Color,
    modifier: Modifier = Modifier,
) {
    val transition = rememberInfiniteTransition(label = "equalizer")

    // Coprime-ish durations so the pattern takes a long time to visibly repeat.
    val bars = listOf(
        BarSpec(durationMs = 430, low = 0.30f, high = 1.00f),
        BarSpec(durationMs = 610, low = 0.85f, high = 0.25f),
        BarSpec(durationMs = 500, low = 0.45f, high = 0.95f),
        BarSpec(durationMs = 710, low = 1.00f, high = 0.35f),
    )

    val heights = bars.mapIndexed { index, spec ->
        transition.animateFloat(
            initialValue = spec.low,
            targetValue = spec.high,
            animationSpec = infiniteRepeatable(
                animation = tween(spec.durationMs, easing = FastOutSlowInEasing),
                repeatMode = RepeatMode.Reverse,
            ),
            label = "bar$index",
        )
    }

    Canvas(modifier = modifier) {
        // n bars separated by n-1 gaps of the same width.
        val unit = size.width / (bars.size * 2 - 1)
        heights.forEachIndexed { index, height ->
            val barHeight = (size.height * height.value).coerceAtLeast(unit)
            drawRoundRect(
                color = tint,
                topLeft = Offset(x = index * 2 * unit, y = size.height - barHeight),
                size = Size(width = unit, height = barHeight),
                cornerRadius = CornerRadius(unit / 2),
            )
        }
    }
}

private data class BarSpec(val durationMs: Int, val low: Float, val high: Float)

private val NOW_PLAYING_BAR_HEIGHT = 48.dp

/** Reserved at the end of the list so [NowPlayingBar] never covers the last row. */
private val NOW_PLAYING_CHIP_RESERVE = NOW_PLAYING_BAR_HEIGHT + 8.dp

/**
 * Bottom-anchored shortcut back to the episode that is currently playing.
 *
 * The playing episode can sit anywhere in the list, so without this the only way back to
 * the player is to find its row again.
 *
 * Deliberately a full-width square band rather than a floating pill: it runs flush into
 * the bottom of the display so the round bezel clips its ends, which reads as part of the
 * screen furniture instead of a card sitting on top of the list. The flat top edge, drawn
 * as an explicit accent rule, is the only border it needs.
 */
@Composable
private fun NowPlayingBar(
    episode: WatchEpisode,
    fraction: Float,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    // Opaque, not translucent — list rows scrolling underneath a see-through band is
    // unreadable. Composited over black so it stays a solid colour while still being
    // derived from the theme accent.
    val accent = MaterialTheme.colors.primary
    val background = accent.copy(alpha = 0.28f).compositeOver(Color.Black)

    Box(
        modifier = modifier
            .fillMaxWidth()
            .height(NOW_PLAYING_BAR_HEIGHT)
            .background(background)
            .clickable(onClick = onClick),
    ) {
        // The top rule doubles as the progress bar: accent for elapsed, a dimmed accent
        // for what is left. It reads as a border first and a gauge second, which is the
        // right priority for something this small.
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(3.dp)
                .background(accent.copy(alpha = 0.25f))
                .align(Alignment.TopCenter),
        ) {
            Box(
                modifier = Modifier
                    .fillMaxWidth(fraction.coerceIn(0f, 1f))
                    .fillMaxHeight()
                    .background(accent),
            )
        }
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier
                .align(Alignment.TopCenter)
                // Vertical and horizontal padding trade directly against each other: the
                // lower the content sits, the narrower the chord across the round display,
                // so the further in from each edge it has to start.
                //
                // Measured on a 454px 320dpi round screen, with the row's lowest point as
                // the binding constraint:
                //     top  8dp -> touches at 46dp side padding
                //     top 11dp -> touches at 51dp
                //     top 14dp -> touches at 55dp
                //     top 20dp -> touches at 67dp
                // Those are the *touch* points, not comfortable values — sitting on them
                // puts content right against the bezel. 58dp adds ~14px of visible gap at
                // top = 11dp, leaving ~178px for the title, which the marquee scrolls.
                .padding(top = 11.dp, start = 58.dp, end = 58.dp),
        ) {
            // Not a play/pause glyph — tapping this opens the player, it does not toggle
            // playback, and a transport icon would promise otherwise.
            EqualizerBars(
                tint = accent,
                modifier = Modifier
                    .size(16.dp)
                    .semantics { contentDescription = "Now playing" },
            )
            Spacer(modifier = Modifier.width(6.dp))
            Text(
                text = episode.title,
                style = MaterialTheme.typography.caption2,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                // Titles are routinely wider than the visible chord, and this is the one
                // place you cannot tap through to read the full title. Loops rather than
                // parking clipped, for the same reason as the episode card title.
                modifier = Modifier.basicMarquee(iterations = Int.MAX_VALUE),
            )
        }
    }
}
