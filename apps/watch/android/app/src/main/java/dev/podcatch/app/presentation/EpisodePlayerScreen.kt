package dev.podcatch.app.presentation

import android.app.Application
import android.content.ComponentName
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.blur
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material.Button
import androidx.wear.compose.material.ButtonDefaults
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.concurrent.futures.await
import androidx.media3.common.Player
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Text
import com.google.android.horologist.annotations.ExperimentalHorologistApi
import com.google.android.horologist.audio.ui.VolumeViewModel
import com.google.android.horologist.audio.ui.components.actions.SetVolumeButton
import com.google.android.horologist.media.data.repository.PlayerRepositoryImpl
import com.google.android.horologist.media.model.Media
import com.google.android.horologist.media.ui.components.PodcastControlButtons
import com.google.android.horologist.media.ui.components.animated.AnimatedMediaInfoDisplay
import com.google.android.horologist.media.ui.screens.player.PlayerScreen
import com.google.android.horologist.media.ui.state.PlayerUiState
import com.google.android.horologist.media.ui.state.model.MediaUiModel
import com.google.android.horologist.media.ui.state.PlayerViewModel
import dev.podcatch.app.data.SyncedWatchEpisodes
import dev.podcatch.app.data.WatchEpisode
import dev.podcatch.app.playback.PlaybackService
import dev.podcatch.app.playback.PlaybackState
import kotlin.time.Duration.Companion.milliseconds
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.launch

@OptIn(ExperimentalHorologistApi::class)
@Composable
fun EpisodePlayerScreen(
    guid: String,
    volumeViewModel: VolumeViewModel,
    onVolumeClick: () -> Unit,
    onSpeedClick: () -> Unit,
) {
    val episodes by SyncedWatchEpisodes.episodes.collectAsState()
    val episode = episodes.find { it.guid == guid }
    if (episode == null || episode.localPath == null) return

    val context = LocalContext.current
    val application = context.applicationContext as Application

    val playerViewModel: EpisodePlayerViewModel = viewModel(
        factory = object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : ViewModel> create(modelClass: Class<T>): T {
                return EpisodePlayerViewModel(application, episode) as T
            }
        },
    )

    val volumeUiState by volumeViewModel.volumeUiState.collectAsState()

    /*
      PlayerScreen builds its own FocusRequester when it is not given one, and asks for focus
      through `requestFocusOnHierarchyActive` — which fires when this screen becomes the
      active part of the hierarchy, and not again after that. On the very first launch of a
      new install, the POST_NOTIFICATIONS dialog owns the window at that moment, so the
      request lands on an unfocused window and is lost: the crown does nothing until
      something re-composes the screen, such as a trip to the volume or speed screen. That is
      also why it never recurs — the permission is only ever asked for once per install.

      Owning the requester here lets it be re-asked for whenever the window comes back, which
      covers the permission dialog and every other window that can steal focus.
    */
    val focusRequester = remember { FocusRequester() }
    val windowInfo = LocalWindowInfo.current
    LaunchedEffect(windowInfo) {
        snapshotFlow { windowInfo.isWindowFocused }
            .filter { it }
            .collect {
                // Throws if no focusable node is attached yet, which is not worth crashing
                // over: the crown is an accelerator here, never the only way through.
                runCatching { focusRequester.requestFocus() }
            }
    }

    // Poll elapsed time from the MediaController
    var elapsedMs by remember { mutableLongStateOf(0L) }
    var durationMs by remember { mutableLongStateOf(0L) }
    LaunchedEffect(playerViewModel) {
        while (true) {
            playerViewModel.controller?.let { ctrl ->
                elapsedMs = ctrl.currentPosition
                durationMs = ctrl.duration.coerceAtLeast(0L)
            }
            delay(1000L)
        }
    }

    PlayerScreen(
        playerViewModel = playerViewModel,
        volumeViewModel = volumeViewModel,
        focusRequester = focusRequester,
        background = { _ -> ArtworkBackdrop(episode) },
        mediaDisplay = { playerUiState ->
            MediaInfoWithElapsed(playerUiState, elapsedMs, durationMs)
        },
        controlButtons = { playerUiController, playerUiState ->
            PodcastControlButtons(
                playerController = playerUiController,
                playerUiState = playerUiState,
            )
        },
        buttons = { _ ->
            Row {
                SetVolumeButton(
                    onVolumeClick = onVolumeClick,
                    volumeUiState = volumeUiState,
                )
                Button(
                    onClick = onSpeedClick,
                    modifier = Modifier.size(ButtonDefaults.SmallButtonSize),
                    colors = ButtonDefaults.secondaryButtonColors(),
                ) {
                    val speed = playerViewModel.currentSpeed
                    val label = if (speed == speed.toInt().toFloat()) {
                        "${speed.toInt()}x"
                    } else {
                        "${speed}x"
                    }
                    Text(label, style = MaterialTheme.typography.caption2)
                }
            }
        },
    )
}

@OptIn(ExperimentalHorologistApi::class)
class EpisodePlayerViewModel(
    application: Application,
    private val episode: WatchEpisode,
    private val repository: PlayerRepositoryImpl = PlayerRepositoryImpl(),
) : PlayerViewModel(repository) {

    var controller: MediaController? = null
        private set

    var currentSpeed by mutableFloatStateOf(1.0f)
        private set

    init {
        PlaybackState.init(application)
        currentSpeed = PlaybackState.getSavedSpeed()

        viewModelScope.launch {
            val sessionToken = SessionToken(
                application,
                ComponentName(application, PlaybackService::class.java),
            )
            val ctrl = MediaController.Builder(application, sessionToken)
                .buildAsync()
                .await()
            controller = ctrl

            // The player itself is the source of truth for what is loaded — after
            // a process restart the in-memory currentGuid is gone, but the service
            // may still hold this episode.
            val loadedGuid = ctrl.currentMediaItem?.mediaId
            if (loadedGuid == episode.guid) {
                repository.connect(ctrl) {}
                ctrl.setPlaybackSpeed(currentSpeed)
                PlaybackState.setCurrentEpisode(episode.guid)
                startPositionAutosave()
                return@launch
            }

            // Save position of the previously loaded episode before switching
            if (loadedGuid != null && ctrl.currentPosition > 0L) {
                PlaybackState.savePosition(
                    loadedGuid,
                    ctrl.currentPosition,
                    ctrl.duration.coerceAtLeast(0L),
                )
            }

            repository.connect(ctrl) {}

            // Restore the saved position as the start position — seeking after
            // setMedia is not reliable while the player is still idle.
            // A finished episode starts over.
            val saved = PlaybackState.getProgress(episode.guid)
            val startPosition = if (saved.completed) 0L else saved.positionMs

            repository.setMediaList(
                listOf(
                    Media(
                        id = episode.guid,
                        uri = episode.localPath ?: "",
                        title = episode.title,
                        artist = episode.podcastTitle,
                    ),
                ),
                index = 0,
                position = startPosition.milliseconds,
            )

            // setMediaList only calls Player.setMediaItems — it does not prepare, and
            // Horologist only prepares when you press play. Until then the session's player
            // sits in STATE_IDLE holding an item, which the system media controls render as a
            // permanent spinner with dead transport buttons. Preparing here costs nothing
            // (the file is local, playWhenReady is still false) and means the session is
            // honest about its state from the moment the episode is loaded.
            if (ctrl.playbackState == Player.STATE_IDLE) ctrl.prepare()

            PlaybackState.setCurrentEpisode(episode.guid)

            ctrl.setPlaybackSpeed(currentSpeed)

            startPositionAutosave()
        }
    }

    /**
     * Persist the position every few seconds. onCleared/onDestroy do not run when
     * the app is force-closed, so periodic saves are what survive a kill.
     */
    private fun startPositionAutosave() {
        viewModelScope.launch {
            while (true) {
                delay(POSITION_SAVE_INTERVAL_MS)
                val ctrl = controller ?: continue
                if (!ctrl.isConnected) continue
                if (ctrl.currentMediaItem?.mediaId != episode.guid) continue
                PlaybackState.savePosition(
                    episode.guid,
                    ctrl.currentPosition,
                    ctrl.duration.coerceAtLeast(0L),
                )
            }
        }
    }

    fun setSpeed(speed: Float) {
        currentSpeed = speed
        controller?.setPlaybackSpeed(speed)
        PlaybackState.saveSpeed(speed)
    }

    override fun onCleared() {
        // Save position of current episode
        controller?.let { ctrl ->
            if (ctrl.isConnected && ctrl.currentMediaItem?.mediaId == episode.guid) {
                PlaybackState.savePosition(
                    episode.guid,
                    ctrl.currentPosition,
                    ctrl.duration.coerceAtLeast(0L),
                )
            }
        }
        /*
          A MediaController binds PlaybackService, and Horologist's PlayerViewModel does not
          release either the controller or the repository — it has no onCleared at all. Left
          alone, every visit to the player screen leaks a bound controller: the service can
          then never actually stop, because `stopSelf` does nothing while clients are bound,
          so a session with a stale episode outlives clearing the app from recents. Release
          the controller and close the repository that wraps it, in that order.
        */
        repository.close()
        controller?.release()
        controller = null
        super.onCleared()
    }

    companion object {
        private const val POSITION_SAVE_INTERVAL_MS = 5_000L
    }
}

/**
 * The episode's artwork behind the player, faint and blurred.
 *
 * Kept dim enough that the controls, the title, and the progress ring read exactly as
 * they do on black. The blur removes the artwork's own text and edges, which would
 * otherwise compete with the controls' outlines.
 */
@Composable
private fun BoxScope.ArtworkBackdrop(episode: WatchEpisode) {
    EpisodeArtwork(
        episode = episode,
        modifier = Modifier
            .matchParentSize()
            .alpha(BACKDROP_ALPHA)
            .blur(BACKDROP_BLUR),
    )
}

private const val BACKDROP_ALPHA = 0.25f
private val BACKDROP_BLUR = 16.dp

@OptIn(ExperimentalHorologistApi::class)
@Composable
private fun MediaInfoWithElapsed(
    playerUiState: PlayerUiState,
    elapsedMs: Long,
    durationMs: Long,
) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        // Scrolls a long episode title instead of truncating it, with edge fades.
        AnimatedMediaInfoDisplay(
            media = playerUiState.media,
            loading = !playerUiState.connected || playerUiState.media is MediaUiModel.Loading,
        )
        if (durationMs > 0L) {
            Text(
                text = "${formatTime(elapsedMs)} / ${formatTime(durationMs)}",
                style = MaterialTheme.typography.caption3,
                textAlign = TextAlign.Center,
            )
        }
    }
}

private fun formatTime(ms: Long): String {
    val totalSeconds = ms / 1000
    val hours = totalSeconds / 3600
    val minutes = (totalSeconds % 3600) / 60
    val seconds = totalSeconds % 60
    return if (hours > 0) {
        "%d:%02d:%02d".format(hours, minutes, seconds)
    } else {
        "%d:%02d".format(minutes, seconds)
    }
}
