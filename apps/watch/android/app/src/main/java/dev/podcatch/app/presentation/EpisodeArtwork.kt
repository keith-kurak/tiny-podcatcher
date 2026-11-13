package dev.podcatch.app.presentation

import androidx.compose.foundation.layout.Box
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import coil.compose.AsyncImage
import dev.podcatch.app.data.WatchEpisode
import java.io.File

/**
 * An episode's artwork, with its podcast's artwork underneath.
 *
 * Two layers rather than one image whose source changes. When the episode's own artwork
 * arrives, it loads on top of what is already drawn, so the slot never goes blank between
 * the two. Swapping one image's source would clear it while the new file decodes.
 *
 * The network URL is used only when nothing is cached at all. Fetching over the watch's
 * Bluetooth proxy is slow, and the download worker caches the file soon after.
 *
 * Draws nothing when no artwork is known. The caller sizes and shapes the slot, and gives
 * it a background, so the row keeps its layout either way.
 */
@Composable
fun EpisodeArtwork(
    episode: WatchEpisode,
    modifier: Modifier = Modifier,
    contentScale: ContentScale = ContentScale.Crop,
) {
    val podcastFile = episode.podcastArtworkPath
        // Same file as the episode's own artwork: the top layer covers it already.
        ?.takeIf { it != episode.artworkPath }
        ?.let(::File)
    val episodeModel: Any? = episode.artworkPath?.let(::File)
        ?: episode.artworkUrl.takeIf { it.isNotBlank() && episode.podcastArtworkPath == null }

    Box(modifier) {
        if (podcastFile != null) {
            AsyncImage(
                model = podcastFile,
                contentDescription = null,
                contentScale = contentScale,
                modifier = Modifier.matchParentSize(),
            )
        }
        if (episodeModel != null) {
            AsyncImage(
                model = episodeModel,
                contentDescription = null,
                contentScale = contentScale,
                modifier = Modifier.matchParentSize(),
            )
        }
    }
}
