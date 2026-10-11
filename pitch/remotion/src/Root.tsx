import { Composition } from "remotion";
import { Thread } from "./Thread";
import { durationOf, THREADS } from "./threads";
import { FPS, PT_H, PT_W, SCALE } from "./theme";

// One composition per thread. IDs become the video file names in pitch/deck/public/videos.
export const RemotionRoot: React.FC = () => (
  <>
    {Object.entries(THREADS).map(([id, items]) => (
      <Composition
        key={id}
        id={id}
        component={Thread}
        defaultProps={{ items }}
        durationInFrames={durationOf(items)}
        fps={FPS}
        width={PT_W * SCALE}
        height={PT_H * SCALE}
      />
    ))}
  </>
);
