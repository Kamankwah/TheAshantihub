import React from "react";
import { Composition } from "remotion";
import { CLIPS } from "./clips";
import { ClipVideo } from "./components/ClipVideo";
import { Placeholder } from "./components/Placeholder";
import { SIZE } from "./layout";
import { FPS } from "./theme";
import type { Format } from "./types";

const FORMATS: Format[] = ["vertical", "landscape"];

export const Root: React.FC = () => (
  <>
    {CLIPS.flatMap((clip) =>
      FORMATS.map((format) => (
        <Composition
          key={`${clip.id}-${format}`}
          id={`${clip.id}-${format}`}
          component={ClipVideo}
          durationInFrames={Math.round(clip.duration * FPS)}
          fps={FPS}
          width={SIZE[format].w}
          height={SIZE[format].h}
          defaultProps={{ clipId: clip.id, format }}
        />
      )),
    )}
    {/* Dev only: renders the labelled stand-in screenshots (npm run placeholders). */}
    <Composition
      id="Placeholder"
      component={Placeholder}
      durationInFrames={1}
      fps={FPS}
      width={1170}
      height={2532}
      defaultProps={{ label: "placeholder", w: 1170, h: 2532 }}
      calculateMetadata={({ props }) => ({ width: props.w, height: props.h })}
    />
  </>
);
