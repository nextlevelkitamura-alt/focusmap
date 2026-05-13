import React from "react";
import { Composition } from "remotion";
import { OAuthDemo, VIDEO_FPS, VIDEO_DURATION_SECONDS } from "./OAuthDemo";

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="FocusmapOAuthDemo"
      component={OAuthDemo}
      durationInFrames={VIDEO_DURATION_SECONDS * VIDEO_FPS}
      fps={VIDEO_FPS}
      width={1920}
      height={1080}
    />
  );
};
