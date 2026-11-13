package dev.podcatch.app.data

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Log
import java.io.File
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * Keeps cached artwork at watch size.
 *
 * Feeds publish cover art at up to 3000 × 3000 px, often several megabytes. The watch never
 * draws it larger than its own screen, but decoding the full file on every list load is
 * what made artwork appear late. A cached copy at [MAX_EDGE_PX] decodes in a fraction of
 * the time, and takes a fraction of the storage.
 */
object ArtworkScaler {
    private const val TAG = "ArtworkScaler"

    /** Longest side of cached artwork. A little over the width of a large Wear screen. */
    const val MAX_EDGE_PX = 480

    /** A file at or under this size is left alone without being decoded. */
    private const val SMALL_ENOUGH_BYTES = 200L * 1024

    private const val JPEG_QUALITY = 85

    /**
     * Write [source] to [dest], scaled down so its longest side is at most [MAX_EDGE_PX].
     * [source] and [dest] may be the same file.
     *
     * [dest] is replaced in one rename, so a reader never sees it missing or half written.
     *
     * @return false when [source] cannot be decoded as an image. [dest] is then unchanged.
     */
    fun downscaleInto(source: File, dest: File): Boolean {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(source.path, bounds)
        val longest = max(bounds.outWidth, bounds.outHeight)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return false

        if (longest <= MAX_EDGE_PX) {
            if (source != dest) source.renameTo(dest)
            return true
        }

        // A power-of-two subsample is decoded cheaply, and keeps the bitmap in memory
        // small. The exact scale is applied after it.
        var sample = 1
        while (longest / (sample * 2) >= MAX_EDGE_PX) sample *= 2
        val decoded = BitmapFactory.decodeFile(
            source.path,
            BitmapFactory.Options().apply { inSampleSize = sample },
        ) ?: return false

        val scale = MAX_EDGE_PX.toFloat() / max(decoded.width, decoded.height)
        val scaled = if (scale < 1f) {
            Bitmap.createScaledBitmap(
                decoded,
                (decoded.width * scale).roundToInt().coerceAtLeast(1),
                (decoded.height * scale).roundToInt().coerceAtLeast(1),
                true,
            )
        } else {
            decoded
        }

        val tmp = File(dest.path + ".scaled")
        return try {
            tmp.outputStream().use { scaled.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, it) }
            tmp.renameTo(dest).also { if (it && source != dest) source.delete() }
        } catch (e: Exception) {
            Log.w(TAG, "Could not write scaled artwork for ${dest.name}", e)
            tmp.delete()
            false
        } finally {
            if (scaled !== decoded) scaled.recycle()
            decoded.recycle()
        }
    }

    /**
     * Scale down every cached file in [dir] that is still at feed size. For artwork cached
     * by a build older than this scaler. Cheap once done: a small file is skipped on its
     * size alone.
     */
    fun shrinkAll(dir: File?) {
        val files = dir?.listFiles { f -> f.isFile && f.name.endsWith(".img") } ?: return
        for (file in files) {
            if (file.length() <= SMALL_ENOUGH_BYTES) continue
            runCatching { downscaleInto(file, file) }
                .onFailure { Log.w(TAG, "Could not shrink ${file.name}", it) }
        }
    }
}
