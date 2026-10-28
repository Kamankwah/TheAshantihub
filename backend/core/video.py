"""Video checks and conversion with ffprobe/ffmpeg.

Every call is a subprocess with an argument list (never a shell) and a timeout. A missing binary, a timeout, a bad
file or a non-zero exit all raise `VideoError`, whose text is fixed plain words: the tool's own output is kept in
`.detail` for the server log only and is never shown to anyone."""
import json
import logging
import os
import subprocess

logger = logging.getLogger(__name__)

MAX_SECONDS = 60
PROBE_TIMEOUT = 30
CONVERT_TIMEOUT = 900
POSTER_TIMEOUT = 60
UNREADABLE = "We could not read this video. Try another file."


class VideoError(Exception):
    """The tool could not read or convert the file. `str()` is safe to show; `detail` is for logs."""

    def __init__(self, message=UNREADABLE, detail=""):
        super().__init__(message)
        self.detail = detail


def _run(args, timeout):
    try:
        result = subprocess.run(args, capture_output=True, timeout=timeout, check=False)
    except FileNotFoundError as exc:
        raise VideoError(detail=f"{args[0]} is not installed: {exc}") from None
    except subprocess.TimeoutExpired:
        raise VideoError(detail=f"{args[0]} timed out") from None
    except OSError as exc:
        raise VideoError(detail=str(exc)) from None
    if result.returncode != 0:
        detail = result.stderr.decode("utf-8", "replace")[-500:]
        logger.warning("%s failed: %s", args[0], detail)
        raise VideoError(detail=detail)
    return result.stdout


def probe(path):
    """{"duration": seconds (float), "size": bytes, "width", "height"} of a video file. Raises VideoError when the
    file has no video stream or no readable length."""
    out = _run(
        ["ffprobe", "-v", "error", "-protocol_whitelist", "file", "-print_format", "json", "-show_format", "-show_streams", str(path)], PROBE_TIMEOUT,
    )
    try:
        data = json.loads(out or b"{}")
        stream = next(s for s in data.get("streams", []) if s.get("codec_type") == "video")
        duration = float(data["format"]["duration"])
        size = int(data["format"].get("size") or 0)
    except (ValueError, KeyError, TypeError, StopIteration):
        raise VideoError(detail="no video stream or duration") from None
    return {"duration": duration, "size": size, "width": stream.get("width"), "height": stream.get("height")}


# "720p" means the short side is at most 720: a 1280x720 box for landscape, 720x1280 for portrait. The box is also
# clamped to the input size so nothing is ever upscaled; dimensions stay even for H.264.
SCALE = (
    "scale='min(if(gte(iw,ih),1280,720),iw)':'min(if(gte(iw,ih),720,1280),ih)'"
    ":force_original_aspect_ratio=decrease:force_divisible_by=2"
)


def convert_to_web_mp4(src, dst):
    """H.264 video + AAC audio in an MP4 with the index first (`faststart`), short side at most 720, at most 60
    seconds, without metadata (phone clips carry GPS), subtitles or data streams."""
    _run(
        [
            "ffmpeg", "-nostdin", "-y", "-protocol_whitelist", "file", "-i", str(src), "-t", str(MAX_SECONDS),
            "-map_metadata", "-1", "-sn", "-dn", "-vf", SCALE,
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", str(dst),
        ],
        CONVERT_TIMEOUT,
    )


def _frame_at(src, dst, second):
    _run(
        ["ffmpeg", "-nostdin", "-y", "-protocol_whitelist", "file", "-ss", str(second), "-i", str(src),
         "-frames:v", "1", "-q:v", "3", str(dst)],
        POSTER_TIMEOUT,
    )
    return os.path.exists(dst) and os.path.getsize(dst) > 0


def poster_frame(src, dst):
    """One JPEG frame from about a second in (the first frame for a clip shorter than that), used as the preview."""
    if not _frame_at(src, dst, 1) and not _frame_at(src, dst, 0):
        raise VideoError(detail="no frame")
