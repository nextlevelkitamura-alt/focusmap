import React from "react";
import {
  AbsoluteFill,
  OffthreadVideo,
  Sequence,
  staticFile,
  useVideoConfig,
} from "remotion";
import { SUBTITLES } from "./subtitles";
import { STAGES } from "./stages";

const FPS = 30;
const STAGE_SECONDS = 14;

/**
 * 各ステージのクリップを順番に並べる。
 * 実素材のMP4長と STAGE_SECONDS のズレは、素材到着後に微調整する想定。
 */
export const OAuthDemo: React.FC = () => {
  const { fps } = useVideoConfig();
  const stageFrames = STAGE_SECONDS * fps;

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {STAGES.map((stage, index) => (
        <Sequence
          key={stage.id}
          from={index * stageFrames}
          durationInFrames={stageFrames}
        >
          <StageClip file={stage.file} fallback={stage.description} />
        </Sequence>
      ))}

      {SUBTITLES.map((sub) => (
        <Sequence
          key={sub.stage}
          from={Math.round(sub.start * fps)}
          durationInFrames={Math.max(1, Math.round((sub.end - sub.start) * fps))}
        >
          <SubtitleBar text={sub.text} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};

const StageClip: React.FC<{ file: string; fallback: string }> = ({
  file,
  fallback,
}) => {
  let src: string | null = null;
  try {
    src = staticFile(`../raw/${file}`);
  } catch {
    src = null;
  }

  if (!src) {
    return (
      <AbsoluteFill
        style={{
          backgroundColor: "#111",
          color: "#fff",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, sans-serif",
          fontSize: 48,
        }}
      >
        [missing clip] {fallback}
      </AbsoluteFill>
    );
  }

  return <OffthreadVideo src={src} />;
};

const SubtitleBar: React.FC<{ text: string }> = ({ text }) => {
  return (
    <AbsoluteFill
      style={{
        justifyContent: "flex-end",
        alignItems: "center",
        paddingBottom: 80,
      }}
    >
      <div
        style={{
          backgroundColor: "rgba(0,0,0,0.78)",
          color: "#fff",
          padding: "16px 32px",
          borderRadius: 8,
          fontSize: 36,
          fontWeight: 600,
          maxWidth: "85%",
          lineHeight: 1.35,
          textAlign: "center",
          fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
        }}
      >
        {text}
      </div>
    </AbsoluteFill>
  );
};

export const VIDEO_FPS = FPS;
export const VIDEO_DURATION_SECONDS = STAGES.length * STAGE_SECONDS;
